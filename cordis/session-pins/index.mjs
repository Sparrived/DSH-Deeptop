// Host-owned workspace session pins. The service keeps pin state in the DSH
// storage domain and leaves workspace/session projections to the desktop bridge.
// The legacy JSON file is imported once so existing desktop profiles retain pins.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { normalizeSessionPinIds, parseLegacySessionPinStore, pinnedForWorkspace } from './model.mjs'

const sessionPinRowSchema = z.object({
  sessionIds: z.array(z.string().min(1)),
})
const sessionPinStateSchema = z.object({
  legacyImported: z.boolean(),
})
const sessionPinDomainSpec = defineDomain({
  name: 'session_pins',
  version: 1,
  global: {
    schema: sessionPinStateSchema,
    initial: { legacyImported: false },
  },
  tables: {
    workspaces: domainTable(sessionPinRowSchema),
  },
})

function legacyStorePath(ctx) {
  const home = ctx.get?.('dshHome') || process.env.DSH_HOME
  if (typeof home !== 'string' || !home.trim()) throw new Error('session pins require DSH_HOME')
  return join(home, 'profiles', 'desktop', 'session-pins.json')
}

async function readLegacyStore(ctx) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(legacyStorePath(ctx), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw new Error(`无法读取旧版会话置顶配置：${error.message}`)
  }
  return parseLegacySessionPinStore(parsed)
}

export class SessionPinsService extends Service {
  static inject = ['storageDomain', 'workspaceRegistry']

  table
  global
  operationTail = Promise.resolve()
  mutationAdmissionOpen = true

  constructor(ctx) {
    super(ctx, 'sessionPins')
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(sessionPinDomainSpec)
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await this.operationTail
      await domain.close()
    }, 'session-pins.domainClose')
    await this.importLegacyStore()
  }

  /** Return valid pinned sessions that still belong to one workspace. */
  forWorkspace(workspace) {
    const workspaceId = workspace?.id ?? workspace?.workspaceId
    const row = this.requireTable().get(String(workspaceId ?? ''))
    return pinnedForWorkspace(workspace, row?.sessionIds)
  }

  /** Update one workspace pin and return the ordered pin ids. */
  setSessionPinned(workspaceId, sessionId, pinned) {
    if (typeof workspaceId !== 'string' || workspaceId.trim() === ''
      || typeof sessionId !== 'string' || sessionId.trim() === ''
      || typeof pinned !== 'boolean') {
      throw new Error('sessionPins.setSessionPinned requires workspaceId, sessionId and pinned')
    }
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (!workspace) throw new Error(`workspace "${workspaceId}" not found`)
    if (!workspace.sessionIds.includes(sessionId)) {
      throw new Error(`session "${sessionId}" is not accounted by workspace "${workspaceId}"`)
    }
    return this.enqueue(async () => {
      const current = this.forWorkspace(workspace)
      const next = pinned
        ? [...current.filter(id => id !== sessionId), sessionId]
        : current.filter(id => id !== sessionId)
      if (next.length === 0) await this.requireTable().delete(workspaceId)
      else await this.requireTable().put(workspaceId, { sessionIds: next })
      return { workspaceId, pinnedSessionIds: next }
    })
  }

  /** Remove every pin attached to one workspace. */
  clearWorkspace(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId.trim() === '') return Promise.resolve()
    return this.enqueue(async () => {
      await this.requireTable().delete(workspaceId)
    })
  }

  /** Remove a session from all workspace pin rows. */
  clearSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') return Promise.resolve()
    return this.enqueue(async () => {
      const table = this.requireTable()
      for (const [workspaceId, row] of table.entries()) {
        const next = normalizeSessionPinIds(row.sessionIds).filter(id => id !== sessionId)
        if (next.length === row.sessionIds.length) continue
        if (next.length === 0) await table.delete(workspaceId)
        else await table.put(workspaceId, { sessionIds: next })
      }
    })
  }

  requireTable() {
    if (this.table === undefined) throw new Error('session pins service is not started yet')
    return this.table
  }

  enqueue(operation) {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('session pins service is disposing'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async importLegacyStore() {
    const current = this.global.get()
    if (current.legacyImported) return
    const legacy = await readLegacyStore(this.ctx)
    const table = this.requireTable()
    for (const [workspaceId, sessionIds] of Object.entries(legacy)) {
      if (table.get(workspaceId) === undefined) await table.put(workspaceId, { sessionIds })
    }
    await this.global.set({ ...current, legacyImported: true })
  }
}

export default SessionPinsService
