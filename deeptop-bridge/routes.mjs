import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { installSkillFromSource } from './skill-installer.mjs'
import { repairCorruptLog } from './session-repair.mjs'
import { describePluginConfig, filterInventory, mutatePluginConfig } from './plugin-config.mjs'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function invokeRemote(ctx, payload, signal) {
  if (!isRecord(payload)
    || typeof payload.namespace !== 'string'
    || payload.namespace.trim() === ''
    || typeof payload.method !== 'string'
    || payload.method.trim() === ''
    || !isRecord(payload.args)) {
    throw new Error('remote.invoke requires namespace, method and object args')
  }
  const gateway = ctx.get?.('typertGateway')
  if (!gateway || typeof gateway.invoke !== 'function') {
    throw new Error('remote.invoke requires @deepseek-ai/dsh-api-gateway')
  }
  return {
    value: await gateway.invoke({
      namespace: payload.namespace,
      method: payload.method,
      args: payload.args,
      signal,
    }),
  }
}

function referenceAgent(ctx, payload, method) {
  if (!isRecord(payload) || typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    throw new Error(method + ' requires sessionId');
  }
  if (payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 256)) {
    throw new Error(method + ' query must be a string no longer than 256 characters');
  }
  const agent = ctx.get?.('agents')?.get?.(payload.sessionId);
  if (!agent) { const error = new Error('session ' + JSON.stringify(payload.sessionId) + ' not found'); error.code = 'session-not-found'; throw error; }
  return agent;
}

async function referenceFiles(ctx, payload, signal) {
  const agent = referenceAgent(ctx, payload, 'reference.files');
  const service = ctx.get?.('fileReferences');
  if (!service || typeof service.list !== 'function') { const error = new Error('file reference service is unavailable'); error.code = 'reference-unavailable'; throw error; }
  signal?.throwIfAborted();
  return { items: await service.list(agent, payload.query ?? '', signal) };
}

async function referenceSessions(ctx, payload, signal) {
  const agent = referenceAgent(ctx, payload, 'reference.sessions');
  const service = ctx.get?.('sessionReferenceResolver');
  if (!service || typeof service.remoteExportCandidates !== 'function') { const error = new Error('session reference service is unavailable'); error.code = 'reference-unavailable'; throw error; }
  signal?.throwIfAborted();
  return { items: await service.remoteExportCandidates(agent, payload.query ?? '', signal) };
}

async function exportSessionZip(ctx, payload, signal) {
  if (!isRecord(payload)
    || typeof payload.sessionId !== 'string'
    || payload.sessionId.trim() === ''
    || (payload.includeDescendants !== undefined && typeof payload.includeDescendants !== 'boolean')) {
    throw new Error('session.exportZip requires sessionId and an optional boolean includeDescendants')
  }
  const response = await ctx.apiProxy.downloads.sessionLog({
    sessionId: payload.sessionId,
    ...(payload.includeDescendants === true ? { includeDescendants: true } : {}),
  }, signal)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `session export failed with HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const safeSessionId = payload.sessionId.replace(/[^A-Za-z0-9_-]/g, '_')
  return {
    base64: bytes.toString('base64'),
    contentType: response.headers.get('content-type') || 'application/zip',
    filename: `dsh-session-${safeSessionId}.zip`,
    size: bytes.byteLength,
  }
}

const SESSION_PIN_STORE_VERSION = 1
let sessionPinMutationTail = Promise.resolve()

function sessionPinStorePath(ctx) {
  const home = ctx.get?.('dshHome') || process.env.DSH_HOME
  if (typeof home !== 'string' || !home.trim()) throw new Error('session pinning requires DSH_HOME')
  return join(home, 'profiles', 'desktop', 'session-pins.json')
}

function normalizeSessionPinIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(item => typeof item === 'string' && item.trim() !== ''))]
}

async function readSessionPinStore(ctx) {
  let path
  try {
    path = sessionPinStorePath(ctx)
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (!isRecord(parsed) || parsed.version !== SESSION_PIN_STORE_VERSION || !isRecord(parsed.workspaces)) return {}
    return Object.fromEntries(Object.entries(parsed.workspaces).map(([workspaceId, sessionIds]) => [
      workspaceId,
      normalizeSessionPinIds(sessionIds),
    ]))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw new Error(`无法读取会话置顶配置：${error.message}`)
  }
}

async function writeSessionPinStore(ctx, workspaces) {
  const path = sessionPinStorePath(ctx)
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify({ version: SESSION_PIN_STORE_VERSION, workspaces }, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}

function enqueueSessionPinMutation(operation) {
  const result = sessionPinMutationTail.then(operation)
  sessionPinMutationTail = result.then(() => undefined, () => undefined)
  return result
}

function pinnedForWorkspace(workspace, pinnedSessionIds = []) {
  const accounted = new Set(workspace.sessionIds)
  return normalizeSessionPinIds(pinnedSessionIds).filter(sessionId => accounted.has(sessionId))
}

async function clearWorkspacePins(ctx, workspaceId) {
  try {
    sessionPinStorePath(ctx)
  } catch {
    return
  }
  return enqueueSessionPinMutation(async () => {
    const pins = await readSessionPinStore(ctx)
    if (!(workspaceId in pins)) return
    const nextStore = { ...pins }
    delete nextStore[workspaceId]
    await writeSessionPinStore(ctx, nextStore)
  })
}

async function clearSessionPins(ctx, sessionId) {
  try {
    sessionPinStorePath(ctx)
  } catch {
    return
  }
  return enqueueSessionPinMutation(async () => {
    const pins = await readSessionPinStore(ctx)
    const nextStore = Object.fromEntries(Object.entries(pins).map(([workspaceId, sessionIds]) => [
      workspaceId,
      sessionIds.filter(item => item !== sessionId),
    ]).filter(([, sessionIds]) => sessionIds.length > 0))
    if (JSON.stringify(nextStore) === JSON.stringify(pins)) return
    await writeSessionPinStore(ctx, nextStore)
  })
}

function workspaceSnapshot(workspace, pinnedSessionIds = []) {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    pinnedSessionIds: pinnedForWorkspace(workspace, pinnedSessionIds),
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

async function attachWorkspaceSession(ctx, payload) {
  if (!isRecord(payload)
    || typeof payload.workspaceId !== 'string'
    || payload.workspaceId.trim() === ''
    || typeof payload.sessionId !== 'string'
    || payload.sessionId.trim() === '') {
    throw new Error('workspace.attachSession requires workspaceId and sessionId')
  }
  const registry = ctx.get?.('workspaceRegistry')
  if (!registry || typeof registry.get !== 'function') {
    throw new Error('workspace.attachSession requires @deepseek-ai/dsh-workspace')
  }
  const workspace = registry.get(payload.workspaceId)
  if (!workspace || typeof workspace.attachSession !== 'function') {
    throw new Error(`workspace "${payload.workspaceId}" not found`)
  }
  const previousWorkspace = typeof registry.list === 'function'
    ? registry.list().find(item => item?.id !== workspace.id && item?.sessionIds?.includes(payload.sessionId))
    : undefined
  await workspace.attachSession(payload.sessionId)
  if (previousWorkspace !== undefined) await clearSessionPins(ctx, payload.sessionId)
  const pins = await readSessionPinStore(ctx)
  return { workspace: workspaceSnapshot(workspace, pins[workspace.id]) }
}

async function setSessionPinned(ctx, payload) {
  if (!isRecord(payload)
    || typeof payload.workspaceId !== 'string'
    || payload.workspaceId.trim() === ''
    || typeof payload.sessionId !== 'string'
    || payload.sessionId.trim() === ''
    || typeof payload.pinned !== 'boolean') {
    throw new Error('workspace.setSessionPinned requires workspaceId, sessionId and pinned')
  }
  const registry = ctx.get?.('workspaceRegistry')
  if (!registry || typeof registry.get !== 'function') {
    throw new Error('workspace.setSessionPinned requires @deepseek-ai/dsh-workspace')
  }
  const workspace = registry.get(payload.workspaceId)
  if (!workspace) throw new Error(`workspace "${payload.workspaceId}" not found`)
  if (!workspace.sessionIds.includes(payload.sessionId)) {
    throw new Error(`session "${payload.sessionId}" is not accounted by workspace "${payload.workspaceId}"`)
  }
  return enqueueSessionPinMutation(async () => {
    const pins = await readSessionPinStore(ctx)
    const current = pinnedForWorkspace(workspace, pins[workspace.id])
    const next = payload.pinned
      ? [...current.filter(sessionId => sessionId !== payload.sessionId), payload.sessionId]
      : current.filter(sessionId => sessionId !== payload.sessionId)
    const nextStore = { ...pins }
    if (next.length === 0) delete nextStore[workspace.id]
    else nextStore[workspace.id] = next
    await writeSessionPinStore(ctx, nextStore)
    return { workspaceId: workspace.id, pinnedSessionIds: next }
  })
}

async function decorateWorkspaceListResponse(ctx, response) {
  if (!isRecord(response) || !isRecord(response.result) || response.result.ok !== true || !isRecord(response.result.value)) return response
  const pins = await readSessionPinStore(ctx)
  const value = response.result.value
  return {
    ...response,
    result: {
      ...response.result,
      value: {
        ...value,
        items: Array.isArray(value.items) ? value.items.map(workspace => ({
          ...workspace,
          pinnedSessionIds: pinnedForWorkspace(workspace, pins[workspace.workspaceId]),
        })) : value.items,
      },
    },
  }
}

async function decorateWorkspaceMutationResponse(ctx, response) {
  if (!isRecord(response) || !isRecord(response.result) || response.result.ok !== true || !isRecord(response.result.value)) return response
  const value = response.result.value
  if (!isRecord(value.workspace)) return response
  const pins = await readSessionPinStore(ctx)
  return {
    ...response,
    result: {
      ...response.result,
      value: {
        ...value,
        workspace: {
          ...value.workspace,
          pinnedSessionIds: pinnedForWorkspace(value.workspace, pins[value.workspace.workspaceId]),
        },
      },
    },
  }
}

async function deleteWorkspace(ctx, request, payload) {
  const response = await ctx.apiProxy.workspace.delete(request)
  if (isRecord(response) && isRecord(response.result) && response.result.ok === true) {
    await clearWorkspacePins(ctx, payload.workspaceId)
  }
  return response
}

function sessionIdFromPayload(payload, method) {
  if (!isRecord(payload) || typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    throw new Error(`${method} requires sessionId`)
  }
  return payload.sessionId
}

function archiveRegistry(ctx) {
  const registry = ctx.get?.('workspaceRegistry')
  if (!registry
    || typeof registry.enqueueOperation !== 'function'
    || !registry.global
    || typeof registry.global.get !== 'function'
    || typeof registry.global.set !== 'function') {
    throw new Error('session archive mutations require the current @deepseek-ai/dsh-workspace registry')
  }
  return registry
}

function archiveState(registry) {
  const state = typeof registry.requireState === 'function' ? registry.requireState() : registry.state
  if (!isRecord(state) || !Array.isArray(state.archivedSessionIds)) {
    throw new Error('session archive mutations require a readable workspace registry state')
  }
  return state
}

async function persistArchivedSessionIds(registry, state, archivedSessionIds) {
  const current = await registry.global.get()
  if (!isRecord(current)) throw new Error('workspace registry global state is unavailable')
  await registry.global.set({ ...current, archivedSessionIds })
  // ponytail: the official workspace package has archive-only APIs; keep its in-memory
  // snapshot aligned with the durable global for the two missing desktop actions.
  registry.state = { ...state, archivedSessionIds }
  return archivedSessionIds
}

async function restoreWorkspaceSession(ctx, payload) {
  const sessionId = sessionIdFromPayload(payload, 'workspace.restoreSession')
  const registry = archiveRegistry(ctx)
  return registry.enqueueOperation(async () => {
    const state = archiveState(registry)
    const archivedSessionIds = [...state.archivedSessionIds]
    if (!archivedSessionIds.includes(sessionId)) return { archivedSessionIds }
    const nextArchivedSessionIds = archivedSessionIds.filter((id) => id !== sessionId)
    await persistArchivedSessionIds(registry, state, nextArchivedSessionIds)
    return { archivedSessionIds: nextArchivedSessionIds }
  })
}

function liveSession(ctx, sessionId) {
  const session = ctx.get?.('sessions')?.get?.(sessionId)
  const agent = ctx.get?.('agents')?.get?.(sessionId)
  return { session, agent }
}

function parentSessionIdFromAgent(agent) {
  const candidates = [
    agent?.parentSessionId,
    agent?.header?.parentSessionId,
    agent?.session?.parentSessionId,
    agent?.address?.parentSessionId,
  ]
  return candidates.find((value) => typeof value === 'string' && value.trim() !== '')
}

async function waitForSessionStopped(ctx, sessionId, signal) {
  const configuredTimeout = Number(ctx.get?.('sessionStopTimeoutMs'))
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(0, configuredTimeout) : 5000
  const deadline = Date.now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    const live = liveSession(ctx, sessionId)
    if (live.session === undefined && live.agent === undefined) return
    if (Date.now() >= deadline) {
      throw new Error(`session "${sessionId}" did not stop after the cancellation request`)
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
  }
}

async function stopSessionBeforeDelete(ctx, sessionId, signal) {
  const live = liveSession(ctx, sessionId)
  if (live.session === undefined && live.agent === undefined) return
  signal?.throwIfAborted()

  const parentSessionId = parentSessionIdFromAgent(live.agent)
  if (live.agent !== undefined && parentSessionId && typeof ctx.apiProxy?.subagents?.interrupt === 'function') {
    await ctx.apiProxy.subagents.interrupt({
      rpcId: randomUUID(),
      payload: { parentSessionId, childSessionId: sessionId, mode: 'continuable' },
    })
  } else if (typeof ctx.apiProxy?.sessions?.cancel === 'function') {
    await ctx.apiProxy.sessions.cancel({ rpcId: randomUUID(), payload: { sessionId } })
  } else {
    throw new Error(`session "${sessionId}" is still running and the host cannot cancel it`)
  }
  await waitForSessionStopped(ctx, sessionId, signal)
}

async function deleteArchivedSession(ctx, payload, signal) {
  const sessionId = sessionIdFromPayload(payload, 'workspace.deleteArchivedSession')
  const registry = archiveRegistry(ctx)
  const persistence = ctx.get?.('sessionPersistence')
  if (!persistence || typeof persistence.list !== 'function' || typeof persistence.locate !== 'function') {
    throw new Error('session deletion requires a persistence backend with artifact locations')
  }
  return registry.enqueueOperation(async () => {
    signal?.throwIfAborted()
    const state = archiveState(registry)
    if (!state.archivedSessionIds.includes(sessionId)) {
      throw new Error(`session "${sessionId}" is not archived`)
    }
    await stopSessionBeforeDelete(ctx, sessionId, signal)

    const header = (await persistence.list(signal)).find((item) => item?.id === sessionId)
    signal?.throwIfAborted()
    if (!header) throw new Error(`session "${sessionId}" was not found in persistence`)
    const location = persistence.locate(header)
    if (!location || typeof location.path !== 'string' || !isAbsolute(location.path)) {
      throw new Error('the current persistence backend does not expose a deletable session artifact')
    }

    await rm(location.path, { force: true })
    for (const workspace of registry.list()) await workspace.detachSession(sessionId)
    const nextArchivedSessionIds = state.archivedSessionIds.filter((id) => id !== sessionId)
    await persistArchivedSessionIds(registry, state, nextArchivedSessionIds)
    registry.headers?.delete(sessionId)
    registry.sessionPaths?.delete(sessionId)
    registry.invalidSessionPaths?.delete(sessionId)
    await clearSessionPins(ctx, sessionId)
    return { deleted: true, archivedSessionIds: nextArchivedSessionIds }
  })
}

/** Read one session artifact under a revision-stable loop, like DSH's own reader. */
async function readStableArtifact(path, signal) {
  for (;;) {
    signal?.throwIfAborted()
    const before = await stat(path, { bigint: true })
    const buffer = await readFile(path, { signal })
    signal?.throwIfAborted()
    const after = await stat(path, { bigint: true })
    if (before.size === after.size && before.mtimeNs === after.mtimeNs && before.ino === after.ino) {
      return buffer
    }
  }
}

/** Durable replace of a session artifact: fsync a sibling temp file, then rename. */
async function writeArtifactAtomically(path, bytes) {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.repair.tmp`
  const handle = await open(tmp, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/**
 * Repair a session log that DSH refuses to open after a crash left a torn
 * JSONL tail inside the last complete Zstandard frame. Committed records are
 * preserved; the uncommitted torn tail is dropped. When the log is already
 * readable it is left untouched and `repaired` is false.
 */
async function repairCorruptSession(ctx, payload, signal) {
  const sessionId = sessionIdFromPayload(payload, 'session.repairCorrupt')
  const persistence = ctx.get?.('sessionPersistence')
  if (!persistence || typeof persistence.list !== 'function' || typeof persistence.locate !== 'function') {
    throw new Error('session.repairCorrupt requires a persistence backend with artifact locations')
  }
  if (ctx.get?.('sessions')?.get?.(sessionId) !== undefined || ctx.get?.('agents')?.get?.(sessionId) !== undefined) {
    throw new Error(`session "${sessionId}" 仍在运行，请先停止它再修复日志`)
  }
  const header = (await persistence.list(signal)).find((item) => item?.id === sessionId)
  signal?.throwIfAborted()
  if (!header) throw new Error(`session "${sessionId}" 在持久化存储中不存在`)
  const location = persistence.locate(header)
  if (!location || typeof location.path !== 'string' || !isAbsolute(location.path)) {
    throw new Error('当前持久化后端不暴露可修复的会话日志文件')
  }
  const buffer = await readStableArtifact(location.path, signal)
  const repair = repairCorruptLog(buffer)
  if (!repair.changed) {
    return { repaired: false, recoveredEvents: repair.recoveredEvents, droppedTorn: repair.droppedTorn, droppedSeqGap: repair.droppedSeqGap }
  }
  await writeArtifactAtomically(location.path, repair.bytes)
  return { repaired: true, recoveredEvents: repair.recoveredEvents, droppedTorn: repair.droppedTorn, droppedSeqGap: repair.droppedSeqGap }
}

function messageAnnotations(ctx) {
  const service = ctx.get?.('messageAnnotations')
  if (!service || typeof service.list !== 'function' || typeof service.put !== 'function' || typeof service.delete !== 'function') {
    throw new Error('message annotations plugin is unavailable')
  }
  return service
}

async function enrichModelGroups(ctx, groups) {
  if (!Array.isArray(groups)) return groups
  return Promise.all(groups.map(async group => {
    if (!isRecord(group) || !Array.isArray(group.models)) return group
    const models = await Promise.all(group.models.map(async model => {
      if (!isRecord(model) || typeof model.id !== 'string' || typeof group.id !== 'string') return model
      try {
        const info = await ctx.llm.resolveModelInfo(group.id, model.id)
        const contextWindow = info?.context?.contextWindow
        const inputModalities = Array.isArray(info?.inputModalities)
          ? info.inputModalities.filter(value => value === 'text' || value === 'image')
          : undefined
        return {
          ...model,
          ...(typeof contextWindow === 'number' && Number.isInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
          ...(inputModalities && inputModalities.length > 0 ? { inputModalities } : {}),
        }
      } catch {
        return model
      }
    }))
    return { ...group, models }
  }))
}

async function enrichModelCatalog(ctx, response, includeCurrent) {
  const result = response?.result
  if (!result?.ok || !isRecord(result.value)) return response
  try {
    const groups = await enrichModelGroups(ctx, result.value.groups)
    const value = { ...result.value, groups }
    if (includeCurrent) {
      const current = result.value.current
      if (isRecord(current) && typeof current.provider === 'string' && typeof current.model === 'string') {
        const info = await ctx.llm.resolveModelInfo(current.provider, current.model)
        const contextWindow = info?.context?.contextWindow
        if (typeof contextWindow === 'number' && Number.isInteger(contextWindow) && contextWindow > 0) value.contextWindow = contextWindow
      }
    }
    return { ...response, result: { ...result, value } }
  } catch {
    return response
  }
}

async function sessionModels(ctx, request) {
  return enrichModelCatalog(ctx, await ctx.apiProxy.sessions.models(request), true)
}

async function hostModels(ctx, request) {
  return enrichModelCatalog(ctx, await ctx.apiProxy.llm.models(request), false)
}

export async function routeDesktopRequest(ctx, method, payload, signal) {
  const api = ctx.apiProxy
  const request = { rpcId: randomUUID(), payload }
  switch (method) {
    case 'session.list': return api.sessions.list(request)
    case 'session.search': return api.sessions.search(request, signal)
    case 'session.create': return api.sessions.create(request)
    case 'session.history': return api.sessions.history(request)
    case 'session.models': return sessionModels(ctx, request)
    case 'reference.files': return referenceFiles(ctx, payload, signal)
    case 'reference.sessions': return referenceSessions(ctx, payload, signal)
    case 'session.selectModel': return api.sessions.selectModel(request)
    case 'session.rename': return api.sessions.rename(request)
    case 'session.fork': return api.sessions.fork(request)
    case 'session.prompt': return api.sessions.prompt(request)
    case 'session.attachment': return api.sessions.attachment(request)
    case 'session.exportZip': return exportSessionZip(ctx, payload, signal)
    case 'session.updateQueue': return api.sessions.updateQueue(request)
    case 'session.cancel': return api.sessions.cancel(request)
    case 'session.repairCorrupt': return repairCorruptSession(ctx, payload, signal)
    case 'subagent.list': return api.subagents.list(request, signal)
    case 'subagent.history': return api.subagents.history(request, signal)
    case 'subagent.prompt': return api.subagents.prompt(request, signal)
    case 'subagent.interrupt': return api.subagents.interrupt(request)
    case 'host.pickDirectory': return api.host.pickDirectory(request, signal)
    case 'host.listDirectory': return api.host.listDirectory(request, signal)
    case 'host.createDirectory': return api.host.createDirectory(request)
    case 'host.openPath': return api.host.openPath(request, signal)
    case 'workspace.list': return decorateWorkspaceListResponse(ctx, await api.workspace.list(request))
    case 'workspace.create': return decorateWorkspaceMutationResponse(ctx, await api.workspace.create(request))
    case 'workspace.attachSession': return attachWorkspaceSession(ctx, payload)
    case 'workspace.setSessionPinned': return setSessionPinned(ctx, payload)
    case 'workspace.rename': return decorateWorkspaceMutationResponse(ctx, await api.workspace.rename(request))
    case 'workspace.delete': return deleteWorkspace(ctx, request, payload)
    case 'workspace.insertSessionBefore': return api.workspace.insertSessionBefore(request)
    case 'workspace.archiveSession': return api.workspace.archiveSession(request)
    case 'workspace.restoreSession': return restoreWorkspaceSession(ctx, payload)
    case 'workspace.deleteArchivedSession': return deleteArchivedSession(ctx, payload, signal)
    case 'messageAnnotations.list': return messageAnnotations(ctx).list(payload)
    case 'messageAnnotations.put': return messageAnnotations(ctx).put(payload)
    case 'messageAnnotations.delete': return messageAnnotations(ctx).delete(payload)
    case 'skill.list': return api.skills.list(request)
    case 'skill.install': return installSkillFromSource(payload, { signal })
    case 'agentPreset.list': return api.agentPresets.list(request)
    case 'agentPreset.select': return api.agentPresets.select(request)
    case 'agentPreset.read': return api.agentPresets.read(request)
    case 'agentPreset.copy': return api.agentPresets.copy(request)
    case 'agentPreset.openDocument': return api.agentPresets.openDocument(request, signal)
    case 'agentPreset.remove': return api.agentPresets.remove(request)
    case 'goal.create': return api.goals.create(request)
    case 'goal.edit': return api.goals.edit(request)
    case 'goal.pause': return api.goals.pause(request)
    case 'goal.resume': return api.goals.resume(request)
    case 'goal.complete': return api.goals.complete(request)
    case 'goal.clear': return api.goals.clear(request)
    case 'settings.describe': return api.settings.describe(request)
    case 'settings.openDocument': return api.settings.openDocument(request, signal)
    case 'settings.update': return api.settings.update(request)
    case 'settings.replace': return api.settings.replace(request)
    case 'settings.mutate': return api.settings.mutate(request)
    case 'credentials.describe': return api.credentials.describe(request)
    case 'credentials.set': return api.credentials.set(request)
    case 'credentials.unset': return api.credentials.unset(request)
    case 'llm.providers': return api.llm.providers(request)
    case 'host.describe': return api.host.describe(request)
    case 'llm.models': return hostModels(ctx, request)
    case 'llm.discoverModels': return api.llm.discoverModels(request, signal)
    case 'remote.invoke': return invokeRemote(ctx, payload, signal)
    case 'plugin.list': return filterInventory(await ctx.pluginInventory.list())
    case 'plugin.config.describe': return describePluginConfig(ctx)
    case 'plugin.config.mutate': return mutatePluginConfig(ctx, payload)
    case 'respond': return api.respond(payload)
    default: throw new Error(`desktop bridge does not expose ${JSON.stringify(method)}`)
  }
}
