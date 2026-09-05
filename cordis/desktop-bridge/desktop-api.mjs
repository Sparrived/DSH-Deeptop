// Desktop Host API calls over DSH 0.1.2-rc.1 in-process Typert services.
//
// Each function maps one legacy `api.<namespace>.<method>` surface (the rc.2
// dsh-host-apiproxy facade) onto the rc.1 service that owns the verb:
// sessionController / workspaceController / settingsController /
// credentialsController / directoryPickerController / subagents /
// sessionSkillCatalog / agentPresets / goals / llm. Calls return plain
// values; failures throw coded errors (DesktopBridge maps them to the wire
// error frame). Where rc.1 dropped a verb the desktop surface still needs
// (history models assembly, host describe, session export), the desktop
// composes the value from rc.1 services itself.

import { randomUUID } from 'node:crypto'
import { codedError, requireService } from './api.mjs'
import { unfoldRecords } from './session-records.mjs'

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function sessionIdOf(payload, method) {
  const sessionId = isRecord(payload)?.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw codedError('bad-request', `${method} requires sessionId`, {})
  }
  return sessionId
}

function controller(ctx, key, errorCode = 'gateway/internal', message) {
  return requireService(ctx, key, errorCode, message ?? `${key} service is unavailable`)
}

function addressForSession(sessionId) {
  return { kind: 'session', sessionId }
}

// ── rc.1 history page cuts ─────────────────────────────────────────────────
//
// `sessionController.page()` rejects a missing/negative throughSeq: the value
// must be an inclusive seq that exists in the durable log. The desktop has no
// follow stream to learn that cut from, so the bridge keeps a per-session tail
// registry (fed by live session/event frames in events-mux) and resolves cold
// sessions with one read-only observation of the log tail.

function historyTailRegistry(ctx) {
  return ctx.get?.('deeptopSessionTails')
}

function pastCursorPageError(error) {
  return error instanceof Error
    && error.code === 'gateway/bad-request'
    && typeof error.message === 'string'
    && error.message.includes('past cursor')
}

function tailErrorCode(addressKind) {
  return addressKind === 'subagent' ? 'subagent/not-found' : 'session-not-found'
}

function tailErrorMessage(addressKind, sessionId) {
  return addressKind === 'subagent'
    ? 'subagent is unavailable'
    : `session "${sessionId}" not found`
}

function tailErrorDetails(addressKind, sessionId, request) {
  return addressKind === 'subagent'
    ? { parentSessionId: request.parentSessionId, childSessionId: sessionId, reason: 'unavailable' }
    : { sessionId }
}

/**
 * Resolve the current durable tail seq of one session (or null for an empty
 * log) with one cold-safe observation. Mirrors the official page() source
 * read: no activation, no projection computation, not-found becomes the same
 * wire code the official controller would throw.
 */
async function observeDurableTailSeq(ctx, sessionId, signal, addressKind, request) {
  const sessionQuery = requireService(ctx, 'sessionQuery', 'gateway/internal', 'sessionQuery service is unavailable')
  let observation
  try {
    observation = await sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
  } catch (error) {
    if (error instanceof Error && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      throw codedError(
        tailErrorCode(addressKind),
        tailErrorMessage(addressKind, sessionId),
        tailErrorDetails(addressKind, sessionId, request),
      )
    }
    throw error
  }
  try {
    return observation.events.at(-1)?.seq ?? null
  } finally {
    observation[Symbol.dispose]?.()
  }
}

/**
 * Run one page() with a real durable cut. Prefers the per-session tail cache;
 * a cold miss resolves the tail by observation. When a stale cached cut is
 * rejected because the durable log shrank (repair/rollback), evict the cache
 * and retry once with a fresh observation.
 */
async function pageWithDurableCut(ctx, sessionId, sessionController, request, signal, addressKind) {
  const registry = historyTailRegistry(ctx)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cached = registry?.tailOf?.(sessionId)
    let tail = cached
    if (tail === undefined) {
      tail = await observeDurableTailSeq(ctx, sessionId, signal, addressKind, request)
      if (tail === null) return { records: [], hasMore: false }
      registry?.remember?.(sessionId, tail)
    }
    try {
      return await sessionController.page({ ...request, throughSeq: tail }, signal)
    } catch (error) {
      if (attempt === 0 && cached !== undefined && pastCursorPageError(error)) {
        registry?.drop?.(sessionId)
        continue
      }
      throw error
    }
  }
  throw new Error('unreachable: pageWithDurableCut bounded retry loop exhausted')
}

// ── sessions.* ──────────────────────────────────────────────────────────────

export async function sessionList(ctx, payload, signal) {
  return controller(ctx, 'sessionController').list({}, signal)
}

export async function sessionSearch(ctx, payload, signal) {
  const query = typeof isRecord(payload)?.query === 'string' ? payload.query : ''
  return controller(ctx, 'sessionController').search({ query }, signal)
}

export async function sessionCreate(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { workspaceId, cwd, agentPreset } = payload
    if (typeof workspaceId === 'string') request.workspaceId = workspaceId
    if (typeof cwd === 'string') request.cwd = cwd
    if (typeof agentPreset === 'string') request.agentPreset = agentPreset
  }
  const value = await controller(ctx, 'sessionController').create(request)
  // rc.1 value is { sessionId }; the frontend contract carries optional agentPreset.
  return value
}

/**
 * One message-aligned history page. rc.1 page() takes a durable address, an
 * inclusive real log cut (`throughSeq`, from the session's current durable
 * tail) and an optional backward cursor. The value shape is the frontend
 * contract: { events, hasMore } with every event wrapped like the desktop wire
 * entry.
 */
export async function sessionHistory(ctx, payload, signal) {
  const sessionId = sessionIdOf(payload, 'session.history')
  const sessionController = controller(ctx, 'sessionController')
  const page = await pageWithDurableCut(ctx, sessionId, sessionController, {
    address: { kind: 'session', sessionId },
    ...(isRecord(payload) && typeof payload.beforeSeq === 'number' ? { beforeSeq: payload.beforeSeq } : {}),
    ...(isRecord(payload) && typeof payload.maxMessages === 'number' ? { maxMessages: payload.maxMessages } : {}),
  }, signal, 'session')
  return {
    events: unfoldRecords(page.records).map(event => ({ event })),
    hasMore: page.hasMore === true,
  }
}

export async function sessionSelectModel(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  if (typeof request.sessionId !== 'string'
    || typeof request.provider !== 'string'
    || typeof request.model !== 'string') {
    throw codedError('bad-request', 'session.selectModel requires sessionId, provider and model', {})
  }
  return controller(ctx, 'sessionController').selectModel(request)
}

export async function sessionRename(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { sessionId, title } = payload
    if (typeof sessionId === 'string') request.sessionId = sessionId
    if (typeof title === 'string') request.title = title
  }
  return controller(ctx, 'sessionController').rename(request)
}

export async function sessionFork(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { sessionId, atSeq, agentPreset } = payload
    if (typeof sessionId === 'string') request.sessionId = sessionId
    if (typeof atSeq === 'number') request.atSeq = atSeq
    if (typeof agentPreset === 'string') request.agentPreset = agentPreset
  }
  return controller(ctx, 'sessionController').fork(request)
}

export async function sessionPrompt(ctx, payload, signal) {
  const request = isRecord(payload) ? payload : {}
  const sessionId = request.sessionId
  if (typeof sessionId !== 'string') throw codedError('bad-request', 'session.prompt requires sessionId', {})
  if (!Array.isArray(request.content)) throw codedError('bad-request', 'session.prompt requires content', {})
  // rc.1 prompt requires a client-minted requestId and an explicit mode
  // ('queue' when the caller did not choose steer).
  const response = await controller(ctx, 'sessionController').prompt({
    sessionId,
    requestId: randomUUID(),
    mode: request.mode === 'steer' ? 'steer' : 'queue',
    content: request.content,
    ...(typeof request.clientTimeZone === 'string' ? { clientTimeZone: request.clientTimeZone } : {}),
  }, signal)
  return isRecord(response) ? response : { accepted: true }
}

export async function sessionAttachment(ctx, payload) {
  return controller(ctx, 'sessionController').attachment(isRecord(payload) ? payload : {})
}

export async function sessionUpdateQueue(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { sessionId, itemId, action } = payload
    if (typeof sessionId === 'string') request.sessionId = sessionId
    if (typeof itemId === 'string') request.itemId = itemId
    if (isRecord(action)) request.action = action
  }
  return controller(ctx, 'sessionController').updateQueue(request)
}

export async function sessionCancel(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { sessionId } = payload
    if (typeof sessionId === 'string') request.sessionId = sessionId
  }
  return controller(ctx, 'sessionController').cancel(request)
}

/**
 * Whole-log turn outline for one session from the registered `turnOutline`
 * projection unit (session-turn-outline). Entries are strictly increasing by
 * turn; each carries its `turn/start` seq so the client can page history
 * back through that seq to load the whole turn. Returns an empty list when
 * the profile has no projection registry / the unit is not mounted.
 */
export async function sessionTurnOutline(ctx, payload) {
  const sessionId = sessionIdOf(payload, 'session.turnOutline')
  const sessions = requireService(ctx, 'sessions', 'gateway/internal', 'sessions service is unavailable')
  const session = sessions.get(sessionId)
  if (!session) {
    throw codedError('session-not-found', `session ${JSON.stringify(sessionId)} not found`, { sessionId })
  }
  const projections = requireService(ctx, 'sessionProjections', 'gateway/internal', 'sessionProjections service is unavailable')
  const outline = projections.snapshot?.(session, ['turnOutline'])?.values?.turnOutline
  return { sessionId, entries: Array.isArray(outline) ? outline : [] }
}

/**
 * rc.1 model catalog plus desktop enrichments the frontend model picker
 * needs (current selection, image limits, resolved context window).
 */
export async function sessionModels(ctx, payload) {
  const sessionId = isRecord(payload) && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
  const sessionController = controller(ctx, 'sessionController')
  const catalog = await sessionController.modelCatalog()
  const { groups = [], failures = [], default: defaultSelection } = isRecord(catalog) ? catalog : {}
  const current = await currentSelection(ctx, sessionId)
  const routable = Array.isArray(isRecord(catalog)?.routableProviders)
    ? catalog.routableProviders.includes(current?.provider)
    : false
  const enriched = await enrichModelCatalogGroups(ctx, groups)
  const value = {
    groups: enriched,
    failures: Array.isArray(failures) ? failures : [],
    current,
    routable: routable === true,
  }
  const imageLimits = await imageLimitsOf(ctx, sessionId)
  if (imageLimits !== undefined) value.imageLimits = imageLimits
  if (isRecord(current) && typeof current.provider === 'string' && typeof current.model === 'string') {
    try {
      const info = await ctx.get?.('llm')?.resolveModelInfo?.(current.provider, current.model)
      const contextWindow = info?.context?.contextWindow
      if (typeof contextWindow === 'number' && Number.isInteger(contextWindow) && contextWindow > 0) {
        value.contextWindow = contextWindow
      }
    } catch {
      // Resolution failure leaves contextWindow absent; the picker still works.
    }
  }
  return value
}

async function currentSelection(ctx, sessionId) {
  const sessions = ctx.get?.('sessions')
  const session = typeof sessionId === 'string' ? sessions?.get?.(sessionId) : undefined
  if (session !== undefined) {
    const snapshot = ctx.get?.('sessionProjections')?.snapshot?.(session)
    const next = snapshot?.values?.modelSelection?.next
    if (isRecord(next)) return next
  }
  const defaultModel = ctx.get?.('agentDefaultModel')
  const fallback = defaultModel?.currentSelection?.()
  if (isRecord(fallback)) return fallback
  return undefined
}

async function imageLimitsOf(ctx, sessionId) {
  const attachments = ctx.get?.('attachments')
  const limits = attachments?.imageLimits
  return isRecord(limits) ? limits : undefined
}

async function enrichModelCatalogGroups(ctx, groups) {
  const llm = ctx.get?.('llm')
  if (!llm || typeof llm.resolveModelInfo !== 'function') return groups
  const output = []
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!isRecord(group) || !Array.isArray(group.models)) {
      output.push(group)
      continue
    }
    const models = []
    for (const model of group.models) {
      if (!isRecord(model) || typeof model.id !== 'string') {
        models.push(model)
        continue
      }
      try {
        const info = await llm.resolveModelInfo(group.id, model.id)
        const contextWindow = info?.context?.contextWindow
        const inputModalities = Array.isArray(info?.inputModalities)
          ? info.inputModalities.filter(value => value === 'text' || value === 'image')
          : undefined
        models.push({
          ...model,
          ...(typeof contextWindow === 'number' && Number.isInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
          ...(inputModalities && inputModalities.length > 0 ? { inputModalities } : {}),
        })
      } catch {
        models.push(model)
      }
    }
    output.push({ ...group, models })
  }
  return output
}

// ── subagents.* ─────────────────────────────────────────────────────────────

export async function subagentList(ctx, payload, signal) {
  const parentSessionId = isRecord(payload)?.parentSessionId
  if (typeof parentSessionId !== 'string') throw codedError('bad-request', 'subagent.list requires parentSessionId', {})
  return controller(ctx, 'subagents').remoteExportList(parentSessionId, signal)
}

export async function subagentHistory(ctx, payload, signal) {
  const request = isRecord(payload) ? payload : {}
  const childSessionId = request.childSessionId
  if (typeof request.parentSessionId !== 'string' || typeof childSessionId !== 'string') {
    throw codedError('bad-request', 'subagent.history requires parentSessionId and childSessionId', {})
  }
  const sessionController = controller(ctx, 'sessionController')
  const page = await pageWithDurableCut(ctx, childSessionId, sessionController, {
    address: {
      kind: 'subagent',
      parentSessionId: request.parentSessionId,
      childSessionId,
      mode: request.mode ?? 'continuable',
    },
    ...(typeof request.beforeSeq === 'number' ? { beforeSeq: request.beforeSeq } : {}),
    ...(typeof request.maxMessages === 'number' ? { maxMessages: request.maxMessages } : {}),
  }, signal, 'subagent')
  return {
    events: unfoldRecords(page.records).map(event => ({ event })),
    hasMore: page.hasMore === true,
  }
}

export async function subagentPrompt(ctx, payload, signal) {
  const request = isRecord(payload) ? payload : {}
  if (typeof request.parentSessionId !== 'string' || typeof request.childSessionId !== 'string') {
    throw codedError('bad-request', 'subagent.prompt requires parentSessionId and childSessionId', {})
  }
  if (request.mode !== undefined && request.mode !== 'continuable') {
    throw codedError('subagent/not-resumable', 'one-shot direct prompts are not supported by this DSH runtime', { childSessionId: request.childSessionId })
  }
  const content = request.content
  if (content === undefined) throw codedError('bad-request', 'subagent.prompt requires content', {})
  return controller(ctx, 'subagents').prompt({
    requestId: randomUUID(),
    parentSessionId: request.parentSessionId,
    childSessionId: request.childSessionId,
    mode: 'continuable',
    content,
    ...(typeof request.clientTimeZone === 'string' ? { clientTimeZone: request.clientTimeZone } : {}),
  }, signal)
}

export async function subagentInterrupt(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  if (typeof request.parentSessionId !== 'string' || typeof request.childSessionId !== 'string') {
    throw codedError('bad-request', 'subagent.interrupt requires parentSessionId and childSessionId', {})
  }
  return controller(ctx, 'subagents').interruptByParent(request.childSessionId, request.parentSessionId, 'continuable')
}

// ── host.* (directory picker + native open) ─────────────────────────────────

export async function hostPickDirectory(ctx, signal) {
  const picked = await controller(ctx, 'directoryPickerController').pick(signal)
  return { path: typeof picked === 'string' ? picked : null }
}

export async function hostListDirectory(ctx, payload, signal) {
  const path = isRecord(payload) && typeof payload.path === 'string' ? payload.path : undefined
  return controller(ctx, 'directoryPickerController').list(path, signal)
}

export async function hostCreateDirectory(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  if (typeof request.path !== 'string' || typeof request.name !== 'string') {
    throw codedError('bad-request', 'host.createDirectory requires path and name', {})
  }
  const created = await controller(ctx, 'directoryPickerController').createDirectory(request.path, request.name)
  return typeof created === 'string' ? { path: created } : created
}

export async function hostOpenPath(ctx, payload, signal) {
  const path = isRecord(payload) && typeof payload.path === 'string' ? payload.path : undefined
  if (path === undefined) throw codedError('bad-request', 'host.openPath requires path', {})
  return controller(ctx, 'sessionController').openWorkspacePath({ path }, signal)
}

/** rc.1 dropped host.describe; compose the one-shot host snapshot from services. */
export async function hostDescribe(ctx) {
  const agentDefaultModel = ctx.get?.('agentDefaultModel')
  const selection = agentDefaultModel?.currentSelection?.()
  return {
    version: undefined,
    cwd: process.cwd(),
    home: undefined,
    ...(isRecord(selection) ? { provider: selection.provider, model: selection.model } : {}),
    attachedSessions: ctx.get?.('agents')?.size ?? 0,
    canOpenPath: ctx.get?.('sessionController')?.canOpenWorkspacePath?.() ?? false,
  }
}

// ── workspace.* ─────────────────────────────────────────────────────────────

export async function workspaceList(ctx, signal) {
  const registry = controller(ctx, 'workspaceRegistry')
  const list = typeof registry.list === 'function' ? registry.list() : []
  return {
    items: list.map(workspaceView),
    archivedSessionIds: Array.isArray(registry.archivedSessionIds) ? [...registry.archivedSessionIds] : [],
  }
}

function workspaceView(workspace) {
  const row = isRecord(workspace) ? workspace : {}
  return {
    workspaceId: row.workspaceId ?? row.id,
    path: row.path,
    title: row.title,
    sessionIds: Array.isArray(row.sessionIds) ? [...row.sessionIds] : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function workspaceCreate(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { path, title } = payload
    if (typeof path === 'string') request.path = path
    if (typeof title === 'string') request.title = title
  }
  const value = await controller(ctx, 'workspaceController').create(request)
  return value
}

export async function workspaceRename(ctx, payload) {
  const request = {}
  if (isRecord(payload)) {
    const { workspaceId, title } = payload
    if (typeof workspaceId === 'string') request.workspaceId = workspaceId
    if (typeof title === 'string') request.title = title
  }
  return controller(ctx, 'workspaceController').rename(request)
}

export async function workspaceInsertSessionBefore(ctx, payload) {
  return controller(ctx, 'workspaceController').insertSessionBefore(isRecord(payload) ? payload : {})
}

export async function workspaceArchiveSession(ctx, payload) {
  return controller(ctx, 'workspaceController').archiveSession(isRecord(payload) ? payload : {})
}

// ── skills.* ────────────────────────────────────────────────────────────────

export async function skillList(ctx, payload, signal) {
  const sessionId = sessionIdOf(payload, 'skill.list')
  return controller(ctx, 'sessionSkillCatalog').list({ sessionId }, signal)
}

// ── agentPresets.* ──────────────────────────────────────────────────────────

export async function agentPresetList(ctx) {
  const presets = controller(ctx, 'agentPresets')
  const roster = await presets.remoteExportList()
  const hasDocument = ctx.get?.('settingsController')?.canOpenAgentPresetDirectory?.() ?? false
  return { ...roster, hasDocument }
}

export async function agentPresetSelect(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  const sessionId = request.sessionId
  const agentPreset = request.agentPreset
  if (typeof sessionId !== 'string' || typeof agentPreset !== 'string') {
    throw codedError('bad-request', 'agentPreset.select requires sessionId and agentPreset', {})
  }
  const selected = await controller(ctx, 'agentPresets').select(resolveAgent(ctx, sessionId), agentPreset)
  return { agentPreset: selected }
}

export async function agentPresetRead(ctx, payload) {
  const agentPreset = isRecord(payload)?.agentPreset
  if (typeof agentPreset !== 'string') throw codedError('bad-request', 'agentPreset.read requires agentPreset', {})
  const document = await controller(ctx, 'agentPresets').readDocument(agentPreset)
  return isRecord(document) ? { agentPreset: document.id ?? agentPreset, content: document.content } : document
}

export async function agentPresetCopy(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  if (typeof request.from !== 'string' || typeof request.agentPreset !== 'string') {
    throw codedError('bad-request', 'agentPreset.copy requires from and agentPreset', {})
  }
  await controller(ctx, 'agentPresets').remoteExportCopy(request.from, request.agentPreset, request.name)
  return {}
}

export async function agentPresetOpenDocument(ctx, payload, signal) {
  const agentPreset = isRecord(payload)?.agentPreset
  if (typeof agentPreset !== 'string') throw codedError('bad-request', 'agentPreset.openDocument requires agentPreset', {})
  return controller(ctx, 'settingsController').openAgentPresetDirectory(agentPreset, signal)
}

export async function agentPresetRemove(ctx, payload) {
  const agentPreset = isRecord(payload)?.agentPreset
  if (typeof agentPreset !== 'string') throw codedError('bad-request', 'agentPreset.remove requires agentPreset', {})
  await controller(ctx, 'agentPresets').remoteExportDelete(agentPreset)
  return {}
}

// ── goals.* ─────────────────────────────────────────────────────────────────

async function goalCall(ctx, method, payload) {
  const request = isRecord(payload) ? payload : {}
  const sessionId = request.sessionId
  if (typeof sessionId !== 'string') throw codedError('bad-request', `goal.${method} requires sessionId`, {})
  const agent = requireService(ctx, 'agents', 'gateway/internal', 'agents service is unavailable').get(sessionId)
  if (!agent) throw codedError('session-not-found', `session ${JSON.stringify(sessionId)} not found`, { sessionId })
  const goals = controller(ctx, 'goals')
  if (method === 'create') {
    const view = goals.create(agent, {
      objective: request.objective,
      ...(typeof request.maxGoalRounds === 'number' ? { maxGoalRounds: request.maxGoalRounds } : {}),
    })
    return isRecord(view) ? view : {}
  }
  if (method === 'edit') {
    const view = goals.edit(agent, request.ref, {
      ...(request.objective !== undefined ? { objective: request.objective } : {}),
      ...(request.maxGoalRounds !== undefined ? { maxGoalRounds: request.maxGoalRounds } : {}),
    })
    return isRecord(view) ? view : {}
  }
  // pause / resume / complete / clear mutate against the caller's expected
  // current revision (GoalRef) and answer with the fresh view (pause/resume/
  // complete) or the tombstone ref (clear).
  return goals[method](agent, request.ref)
}

export const goalCreate = (ctx, payload) => goalCall(ctx, 'create', payload)
export const goalEdit = (ctx, payload) => goalCall(ctx, 'edit', payload)
export const goalPause = (ctx, payload) => goalCall(ctx, 'pause', payload)
export const goalResume = (ctx, payload) => goalCall(ctx, 'resume', payload)
export const goalComplete = (ctx, payload) => goalCall(ctx, 'complete', payload)
export const goalClear = (ctx, payload) => goalCall(ctx, 'clear', payload)

// ── settings.* ──────────────────────────────────────────────────────────────

export async function settingsDescribe(ctx) {
  return controller(ctx, 'settingsController').describe()
}

export async function settingsOpenDocument(ctx, signal) {
  return controller(ctx, 'settingsController').openSettingsDocument(signal)
}

export async function settingsUpdate(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  return controller(ctx, 'settingsController').update(request.ns, request.patch, request.expectedRevision)
}

export async function settingsReplace(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  return controller(ctx, 'settingsController').replace(request.ns, request.value, request.expectedRevision)
}

export async function settingsMutate(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  return controller(ctx, 'settingsController').mutate(request.ns, request.ops, request.expectedRevision)
}

// ── credentials.* ───────────────────────────────────────────────────────────

export async function credentialsDescribe(ctx, payload) {
  const refs = isRecord(payload)?.refs
  if (!Array.isArray(refs)) throw codedError('bad-request', 'credentials.describe requires refs array', {})
  const credentials = await controller(ctx, 'credentialsController').describe(refs)
  return { credentials }
}

export async function credentialsSet(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  if (typeof request.ref !== 'string') throw codedError('bad-request', 'credentials.set requires ref', {})
  await controller(ctx, 'credentialsController').set(request.ref, String(request.value ?? ''))
  return {}
}

export async function credentialsUnset(ctx, payload) {
  const ref = isRecord(payload)?.ref
  if (typeof ref !== 'string') throw codedError('bad-request', 'credentials.unset requires ref', {})
  await controller(ctx, 'credentialsController').unset(ref)
  return {}
}

// ── llm.* ───────────────────────────────────────────────────────────────────

export async function llmProviders(ctx) {
  const llm = controller(ctx, 'llm')
  const directory = typeof llm.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() : []
  const routes = typeof llm.listProviders === 'function' ? llm.listProviders() : []
  const active = new Set(Array.isArray(routes) ? routes.map(route => route?.id).filter(id => typeof id === 'string') : [])
  const providers = []
  for (const entry of Array.isArray(directory) ? directory : []) {
    if (!isRecord(entry) || typeof entry.provider !== 'string') continue
    providers.push({
      provider: entry.provider,
      displayName: entry.displayName,
      settingsNs: entry.settingsNs,
      settingsPath: Array.isArray(entry.settingsPath) ? [...entry.settingsPath] : [],
      active: active.has(entry.provider),
      ...(entry.declared === undefined ? {} : { declared: entry.declared }),
    })
  }
  return { providers }
}

export async function hostModels(ctx) {
  const sessionController = controller(ctx, 'sessionController')
  const catalog = await sessionController.modelCatalog()
  return {
    groups: await enrichModelCatalogGroups(ctx, Array.isArray(catalog?.groups) ? catalog.groups : []),
    failures: Array.isArray(catalog?.failures) ? catalog.failures : [],
  }
}

export async function llmDiscoverModels(ctx, payload, signal) {
  const request = isRecord(payload) ? payload : {}
  const settingsNs = typeof request.settingsNs === 'string' ? request.settingsNs : undefined
  if (settingsNs === undefined) throw codedError('bad-request', 'llm.discoverModels requires settingsNs', {})
  const llm = controller(ctx, 'llm')
  if (typeof llm.discoverModels !== 'function') {
    throw codedError('gateway/internal', 'llm.discoverModels is unavailable', {})
  }
  const models = await llm.discoverModels(settingsNs, request, signal)
  return { models: Array.isArray(models) ? models : [] }
}

// ── respond (approval / question answers) ───────────────────────────────────

export async function respond(ctx, payload) {
  const request = isRecord(payload) ? payload : {}
  const answer = request.answer
  if (!isRecord(answer)) throw codedError('bad-request', 'respond requires an answer payload', {})
  const rpcId = request.rpcId ?? answer.rpcId
  if (typeof rpcId !== 'string') throw codedError('bad-request', 'respond requires an answerable rpc id', {})
  // The answer registry is owned by the desktop event layer (bridge.mjs):
  // approval/request and user-questions/request frames register their pending
  // rpcId here when they are forwarded to the frontend, and respond() settles
  // the matching waiter with the frontend's decision.
  const registry = controller(ctx, 'deeptopAnswerRegistry', 'answer-unavailable', '桌面应答注册表不可用')
  if (typeof registry.resolve !== 'function') {
    throw codedError('answer-unavailable', '桌面应答注册表不可用', { capability: 'deeptopAnswerRegistry' })
  }
  await registry.resolve(rpcId, answer)
  return { accepted: true }
}
