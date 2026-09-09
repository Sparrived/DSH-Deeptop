// Host-channel event synthesis for the desktop bridge (DSH 0.1.3-alpha.2).
//
// The retired dsh-host-apiproxy `events.host` stream used to be the only host
// frame source. DSH owns the same facts in services/events the desktop
// subscribes directly:
//   api-session/added|removed|status|error  →  host/session-* frames
//   workspace registry writes               →  workspace/order/archive frames
//   allowlisted host events                 →  host/remote-event frames
// Frame shapes are the pre-existing desktop wire contract (frontend types in
// src/lib/desktop.ts), so no frontend change is required.

import { randomUUID } from 'node:crypto'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

// Allowlisted host events forwarded verbatim as host/remote-event. This is the
// legacy API_REMOTE_FORWARDED_EVENTS subset minus the api-session/* and
// waterfall events, which the desktop translates into its own frame shapes.
const FORWARDED_EMIT_EVENTS = [
  'agent-preset/selected',
  'commands/change',
  'credentials/reference-updated',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'llm/adapters-updated',
  'settings/document-updated',
]

export class HostEventSynthesizer {
  constructor(ctx, emit) {
    this.ctx = ctx
    this.emit = emit
    this.disposers = []
    this.committedWorkspaceIds = undefined
    this.committedWorkspaceOrder = undefined
    this.committedArchivedSessionIds = undefined
  }

  start() {
    const ctx = this.ctx
    const push = this.emit

    this.disposers.push(ctx.on('api-session/added', summary => {
      if (!isRecord(summary)) return
      push({
        rpcId: randomUUID(),
        payload: {
          type: 'host/session-added',
          sessionId: summary.sessionId,
          blank: summary.blank === true,
          ...(summary.parentSessionId === undefined ? {} : { parentSessionId: summary.parentSessionId }),
          ...(summary.origin === undefined ? {} : { origin: summary.origin }),
          ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
        },
      })
    }))

    this.disposers.push(ctx.on('api-session/removed', sessionId => {
      push({ rpcId: randomUUID(), payload: { type: 'host/session-removed', sessionId } })
    }))

    this.disposers.push(ctx.on('api-session/status', (sessionId, running) => {
      push({
        rpcId: randomUUID(),
        payload: { type: 'host/session-status', sessionId, running: running === true },
      })
    }))

    this.disposers.push(ctx.on('api-session/error', (sessionId, message) => {
      push({
        rpcId: randomUUID(),
        payload: { type: 'host/agent-error', sessionId, message: errorMessage(message) },
      })
    }))

    this.disposers.push(ctx.on('domain/changed', change => {
      this.onDomainChanged(change)
    }))

    for (const name of FORWARDED_EMIT_EVENTS) {
      // The allowlisted events are all plain emit events with JSON args; the
      // handler passes the raw argument list through.
      this.disposers.push(ctx.on(name, (...args) => {
        push({
          rpcId: randomUUID(),
          payload: { type: 'host/remote-event', event: name, args },
        })
      }))
    }
  }

  /** Mirror the workspace-controller feed over the durable workspace domain. */
  onDomainChanged(change) {
    if (!isRecord(change) || change.domain !== 'workspace') return
    const registry = this.ctx.get?.('workspaceRegistry')
    if (!registry) return
    if (this.committedWorkspaceIds === undefined) this.syncBaseline(registry)
    if (change.table === '') {
      // The durable registry singleton carries the display order and the
      // archived-session set (workspace-domain spec v2).
      if (change.operation !== 'put') return
      const state = isRecord(change.value) ? change.value : undefined
      if (!state || !Array.isArray(state.workspaceIds)) return
      const workspaceIds = state.workspaceIds
      for (const workspaceId of workspaceIds) {
        if (this.committedWorkspaceIds.has(workspaceId)) continue
        const workspace = typeof registry.get === 'function' ? registry.get(workspaceId) : undefined
        if (workspace === undefined) continue
        this.committedWorkspaceIds.add(workspaceId)
        this.emit({
          rpcId: randomUUID(),
          payload: { type: 'host/workspace-changed', workspace: workspaceView(workspace) },
        })
      }
      if (!sameStrings(this.committedWorkspaceOrder, workspaceIds)) {
        this.committedWorkspaceOrder = [...workspaceIds]
        this.emit({
          rpcId: randomUUID(),
          payload: { type: 'host/workspace-order-changed', workspaceIds: [...workspaceIds] },
        })
      }
      const archived = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : []
      if (!sameStrings(this.committedArchivedSessionIds, archived)) {
        this.committedArchivedSessionIds = [...archived]
        this.emit({
          rpcId: randomUUID(),
          payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [...archived] },
        })
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.committedWorkspaceIds.delete(change.key)) return
      this.emit({
        rpcId: randomUUID(),
        payload: { type: 'host/workspace-removed', workspaceId: change.key },
      })
      return
    }
    if (change.operation === 'put' && this.committedWorkspaceIds.has(change.key)) {
      this.emit({
        rpcId: randomUUID(),
        payload: { type: 'host/workspace-changed', workspace: recordView(change.key, change.value) },
      })
    }
  }

  /** Establish the committed id/order/archive sets from the live registry. */
  syncBaseline(registry) {
    const baseline = typeof registry.list === 'function' ? registry.list() : []
    this.committedWorkspaceIds = new Set(baseline.map(workspace => String(workspace?.id ?? workspace?.workspaceId)))
    this.committedWorkspaceOrder = baseline.map(workspace => String(workspace?.id ?? workspace?.workspaceId))
    const archived = registry.archivedSessionIds
    this.committedArchivedSessionIds = Array.isArray(archived) ? [...archived] : []
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose()
  }
}

function sameStrings(left, right) {
  const a = Array.isArray(left) ? left : []
  const b = Array.isArray(right) ? right : []
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** Project one authoritative registry entity to the desktop workspace shape. */
function workspaceView(workspace) {
  const row = isRecord(workspace) ? workspace : {}
  return {
    workspaceId: row.id ?? row.workspaceId,
    path: row.path,
    title: row.title,
    sessionIds: Array.isArray(row.sessionIds) ? [...row.sessionIds] : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Project a durable `workspaces` record (workspace-domain spec v2) to the desktop shape. */
function recordView(workspaceId, value) {
  const record = isRecord(value) ? value : {}
  return {
    workspaceId,
    path: record.path,
    title: record.title,
    sessionIds: Array.isArray(record.sessionIds) ? [...record.sessionIds] : [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
