import { randomBytes, randomUUID } from 'node:crypto'
import { open, readFile, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { installSkillFromSource } from './skill-installer.mjs'
import { repairCorruptLog } from './session-repair.mjs'

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
  await workspace.attachSession(payload.sessionId)
  return {
    workspace: {
      workspaceId: workspace.id,
      path: workspace.path,
      title: workspace.title,
      sessionIds: [...workspace.sessionIds],
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
  }
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
    if (ctx.get?.('sessions')?.get?.(sessionId) !== undefined || ctx.get?.('agents')?.get?.(sessionId) !== undefined) {
      throw new Error(`session "${sessionId}" is still running; stop it before deleting it`)
    }

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
    case 'workspace.list': return api.workspace.list(request)
    case 'workspace.create': return api.workspace.create(request)
    case 'workspace.attachSession': return attachWorkspaceSession(ctx, payload)
    case 'workspace.rename': return api.workspace.rename(request)
    case 'workspace.delete': return api.workspace.delete(request)
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
    case 'plugin.list': return ctx.pluginInventory.list()
    case 'respond': return api.respond(payload)
    default: throw new Error(`desktop bridge does not expose ${JSON.stringify(method)}`)
  }
}
