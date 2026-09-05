import { randomBytes } from 'node:crypto'
import { mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { repairCorruptLog } from './session-repair.mjs'
import { resolveDshHome } from './dsh-home.mjs'
import { parseGitHubSource } from '../skill-installer/installer.mjs'
import { describePluginConfig, filterInventory, mutatePluginConfig } from './plugin-config.mjs'
import {
  cancelManagedSkillInstall,
  describeToolSettings,
  ensureManagedSkillDirectory,
  installManagedSkill,
  managedSkillInstallStatus,
  mutateMcpSettings,
  removeManagedSkill,
} from './tool-config.mjs'
import {
  deleteUiPluginStorage,
  getUiPluginBundle,
  getUiPluginModule,
  getUiPluginStorage,
  invokeUiPluginRemote,
  listUiPlugins,
  setUiPluginStorage,
} from '../ui-registry/routes.mjs'
import { loadProxySetting, resolveEffectiveProxy, setProxySetting } from './network-proxy.mjs'
import { compactHistoryEntries } from './display-history.mjs'
import { codedError, resolveAgent, requireService } from './api.mjs'
import { unfoldRecords } from './session-records.mjs'
import { buildZip } from './zip-writer.mjs'
import {
  agentPresetCopy,
  agentPresetList,
  agentPresetOpenDocument,
  agentPresetRead,
  agentPresetRemove,
  agentPresetSelect,
  credentialsDescribe,
  credentialsSet,
  credentialsUnset,
  goalClear,
  goalComplete,
  goalCreate,
  goalEdit,
  goalPause,
  goalResume,
  hostCreateDirectory,
  hostDescribe,
  hostListDirectory,
  hostModels,
  hostOpenPath,
  hostPickDirectory,
  llmDiscoverModels,
  llmProviders,
  respond,
  sessionAttachment,
  sessionCancel,
  sessionCreate,
  sessionFork,
  sessionHistory,
  sessionList,
  sessionModels,
  sessionPrompt,
  sessionRename,
  sessionSearch,
  sessionSelectModel,
  sessionUpdateQueue,
  settingsDescribe,
  settingsMutate,
  settingsOpenDocument,
  settingsReplace,
  settingsUpdate,
  skillList,
  subagentHistory,
  subagentInterrupt,
  subagentList,
  subagentPrompt,
  workspaceArchiveSession,
  workspaceCreate,
  workspaceInsertSessionBefore,
  workspaceList,
  workspaceRename,
} from './desktop-api.mjs'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// rc.1 keeps the registry's durable archive set but publishes no restore or
// permanent-delete verbs; the desktop composes those two mutations against
// the registry's public `global`/`state` fields under one private serial
// chain per registry so concurrent requests cannot interleave.
const archiveMutationChains = new WeakMap()

function serializeArchiveMutation(registry, operation) {
  const tail = archiveMutationChains.get(registry) ?? Promise.resolve()
  const next = tail.then(operation, operation)
  archiveMutationChains.set(registry, next.catch(() => undefined))
  return next
}

function requireToolSettings(ctx, { nativeDirectory = false } = {}) {
  if (resolveDshHome(ctx) === undefined) {
    throw codedError('tools-unavailable', '工具设置需要可用的 DSH_HOME', { capability: 'tools' })
  }
  if (nativeDirectory) {
    const sessionController = ctx.get?.('sessionController')
    const canOpen = typeof sessionController?.canOpenWorkspacePath === 'function'
      ? sessionController.canOpenWorkspacePath()
      : false
    if (!canOpen) {
      throw codedError('host-unavailable', '打开 Skills 目录需要 Host 原生目录服务', { capability: 'session.openWorkspacePath' })
    }
  }
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
  const persistence = ctx.get?.('sessionPersistence')
  if (!persistence || typeof persistence.readRaw !== 'function') {
    throw codedError('session-export-unavailable', '会话导出需要可用的会话持久化后端', { capability: 'sessionPersistence' })
  }
  const flush = ctx.get?.('sessions')
  signal?.throwIfAborted()
  const headers = await persistence.list(signal)
  const safeSessionId = payload.sessionId.replace(/[^A-Za-z0-9_-]/g, '_')

  const rawFor = async sessionId => {
    signal?.throwIfAborted()
    if (flush && typeof flush.get === 'function' && typeof flush.flush === 'function') {
      const live = flush.get(sessionId)
      if (live !== undefined) await flush.flush(live)
    }
    signal?.throwIfAborted()
    const raw = await persistence.readRaw(sessionId, signal)
    if (raw === undefined) throw new Error(`session ${JSON.stringify(sessionId)} 没有可导出的日志文件`)
    return raw
  }

  const root = await rawFor(payload.sessionId)
  const entries = [{ path: root.filename, content: root.content }]
  if (payload.includeDescendants === true) {
    const pending = [payload.sessionId]
    const seen = new Set([payload.sessionId])
    while (pending.length > 0) {
      const parent = pending.shift()
      for (const header of headers) {
        if (header?.parentSession !== parent || header.origin !== 'subagent' || seen.has(header.id)) continue
        seen.add(header.id)
        const raw = await rawFor(header.id)
        entries.push({ path: `subagents/${header.id.replace(/[^A-Za-z0-9_-]/g, '_')}/${raw.filename}`, content: raw.content })
        pending.push(header.id)
      }
    }
  }
  const archive = buildZip(entries)
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'deeptop-session-export-'))
  const tempPath = join(directory, 'session.zip')
  try {
    const handle = await open(tempPath, 'w')
    try {
      await handle.writeFile(archive)
    } finally {
      await handle.close()
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return {
    tempPath,
    contentType: 'application/zip',
    filename: `dsh-session-${safeSessionId}.zip`,
    size: archive.byteLength,
  }
}

function optionalSessionPins(ctx) {
  const service = ctx.get?.('sessionPins')
  if (!service
    || typeof service.forWorkspace !== 'function'
    || typeof service.setSessionPinned !== 'function'
    || typeof service.clearWorkspace !== 'function'
    || typeof service.clearSession !== 'function') return undefined
  return service
}

function sessionPins(ctx) {
  const service = optionalSessionPins(ctx)
  if (service === undefined) {
    throw new Error('session pinning requires the deeptop-bridge/session-pins Cordis plugin')
  }
  return service
}

function workspaceSnapshot(workspace, pinnedSessionIds = []) {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    pinnedSessionIds,
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
  try {
    await workspace.attachSession(payload.sessionId)
  } catch (error) {
    // The official entity rejects when the session's stored cwd cannot be
    // confirmed to be the workspace directory (missing drive, moved or
    // deleted directory). That is a recoverable environment condition, not
    // a request fault: tag it so the frontend can explain instead of
    // presenting the raw validation error.
    if (error instanceof Error && error.message.includes('cannot attach session')) {
      const wrapped = new Error(error.message)
      wrapped.code = 'workspace-unavailable'
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
  const service = optionalSessionPins(ctx)
  if (previousWorkspace !== undefined && service !== undefined) await service.clearSession(payload.sessionId)
  return { workspace: workspaceSnapshot(workspace, service?.forWorkspace(workspace) ?? []) }
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
  return sessionPins(ctx).setSessionPinned(payload.workspaceId, payload.sessionId, payload.pinned)
}

async function decorateWorkspaceListResponse(ctx, value) {
  if (!isRecord(value) || !Array.isArray(value.items)) return value
  const service = optionalSessionPins(ctx)
  return {
    ...value,
    items: value.items.map(workspace => ({
      ...workspace,
      pinnedSessionIds: service?.forWorkspace(workspace) ?? [],
    })),
  }
}

async function decorateWorkspaceMutationResponse(ctx, value) {
  if (!isRecord(value) || !isRecord(value.workspace)) return value
  const service = optionalSessionPins(ctx)
  return {
    ...value,
    workspace: {
      ...value.workspace,
      pinnedSessionIds: service?.forWorkspace(value.workspace) ?? [],
    },
  }
}

async function deleteWorkspace(ctx, payload) {
  const controller = ctx.get?.('workspaceController')
  if (!controller || typeof controller.delete !== 'function') {
    throw codedError('workspace-unavailable', 'workspace.delete 需要 @deepseek-ai/dsh-api-workspace-controller', { capability: 'workspaceController' })
  }
  const value = await controller.delete(isRecord(payload) ? payload : {})
  await optionalSessionPins(ctx)?.clearWorkspace(isRecord(payload)?.workspaceId)
  return value
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
    || !registry.global
    || typeof registry.global.get !== 'function'
    || typeof registry.global.set !== 'function'
    || !Array.isArray(registry.state?.archivedSessionIds)) {
    throw new Error('session archive mutations require the current @deepseek-ai/dsh-workspace registry')
  }
  return registry
}

function archiveState(registry) {
  const state = registry.state
  if (!isRecord(state) || !Array.isArray(state.archivedSessionIds)) {
    throw new Error('session archive mutations require a readable workspace registry state')
  }
  return state
}

async function persistArchivedSessionIds(registry, state, archivedSessionIds) {
  await registry.global.set({ ...state, archivedSessionIds })
  // Keep the registry's in-memory snapshot aligned with the durable global
  // for the two desktop-only mutations the official surface does not offer.
  registry.state = { ...state, archivedSessionIds }
  return archivedSessionIds
}

async function restoreWorkspaceSession(ctx, payload) {
  const sessionId = sessionIdFromPayload(payload, 'workspace.restoreSession')
  const registry = archiveRegistry(ctx)
  return serializeArchiveMutation(registry, async () => {
    const state = archiveState(registry)
    const archivedSessionIds = [...state.archivedSessionIds]
    if (!archivedSessionIds.includes(sessionId)) return { archivedSessionIds }
    const nextArchivedSessionIds = archivedSessionIds.filter((id) => id !== sessionId)
    await persistArchivedSessionIds(registry, state, nextArchivedSessionIds)
    return { archivedSessionIds: nextArchivedSessionIds }
  })
}

function attachedSession(ctx, sessionId) {
  const session = ctx.get?.('sessions')?.get?.(sessionId)
  const agent = ctx.get?.('agents')?.get?.(sessionId)
  return { session, agent }
}

function assertSessionDetachedForDelete(ctx, sessionId) {
  const attached = attachedSession(ctx, sessionId)
  if (attached.session === undefined && attached.agent === undefined) return
  const error = new Error(
    `会话 "${sessionId}" 仍附着在当前 Deeptop Host（不代表仍在运行）；请重启 DSH 运行时后再永久删除`,
  )
  error.code = 'session-attached'
  error.details = { sessionId }
  throw error
}

async function finalizeArchivedSessionDeletion(ctx, registry, state, sessionId) {
  await optionalSessionPins(ctx)?.clearSession(sessionId)
  for (const workspace of registry.list()) await workspace.detachSession(sessionId)
  const nextArchivedSessionIds = state.archivedSessionIds.filter((id) => id !== sessionId)
  await persistArchivedSessionIds(registry, state, nextArchivedSessionIds)
  registry.headers?.delete(sessionId)
  registry.sessionPaths?.delete(sessionId)
  registry.invalidSessionPaths?.delete(sessionId)
  return { deleted: true, archivedSessionIds: nextArchivedSessionIds }
}

async function deleteArchivedSession(ctx, payload, signal) {
  const sessionId = sessionIdFromPayload(payload, 'workspace.deleteArchivedSession')
  const registry = archiveRegistry(ctx)
  return serializeArchiveMutation(registry, async () => {
    signal?.throwIfAborted()
    const state = archiveState(registry)
    if (!state.archivedSessionIds.includes(sessionId)) {
      return { deleted: false, archivedSessionIds: [...state.archivedSessionIds] }
    }

    const persistence = ctx.get?.('sessionPersistence')
    if (!persistence || typeof persistence.list !== 'function') {
      throw new Error('session deletion requires a persistence backend')
    }
    const header = (await persistence.list(signal)).find((item) => item?.id === sessionId)
    signal?.throwIfAborted()
    let artifactPath
    if (header !== undefined) {
      if (typeof persistence.locate !== 'function') {
        throw new Error('the current persistence backend does not expose a deletable session artifact')
      }
      const location = persistence.locate(header)
      if (!location || typeof location.path !== 'string' || !isAbsolute(location.path)) {
        throw new Error('the current persistence backend does not expose a deletable session artifact')
      }
      artifactPath = location.path
    }

    assertSessionDetachedForDelete(ctx, sessionId)
    signal?.throwIfAborted()
    if (artifactPath !== undefined) await rm(artifactPath, { force: true })
    return finalizeArchivedSessionDeletion(ctx, registry, state, sessionId)
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

async function openManagedSkillDirectory(ctx, signal) {
  requireToolSettings(ctx, { nativeDirectory: true })
  const path = await ensureManagedSkillDirectory(ctx)
  return hostOpenPath(ctx, { path }, signal)
}

/** Probe which official Host capabilities are mounted in the current profile. */
function probeDesktopCapabilities(ctx) {
  const get = typeof ctx.get === 'function' ? ctx.get : () => undefined
  const has = (value, method) => value !== undefined && value !== null && (method === undefined || typeof value[method] === 'function')
  const home = resolveDshHome(ctx)
  const sessionController = get('sessionController')
  const services = {
    bootstrap: true,
    sessions: has(sessionController, 'list') && (get('sessions') !== undefined || get('agents') !== undefined),
    workspace: has(get('workspaceController'), 'list') && has(get('workspaceRegistry'), 'get'),
    references: has(get('fileReferences'), 'list') && has(get('sessionReferenceResolver'), 'remoteExportCandidates'),
    annotations: has(get('messageAnnotations'), 'list'),
    subagents: has(get('subagents'), 'remoteExportList'),
    skills: has(get('sessionSkillCatalog'), 'list'),
    agentPresets: has(get('agentPresets'), 'remoteExportList'),
    goals: has(get('goals'), 'create'),
    settings: has(get('settingsController'), 'describe'),
    credentials: has(get('credentialsController'), 'describe'),
    llm: has(get('llm'), 'resolveModelInfo'),
    plugins: has(ctx.pluginInventory, 'list'),
    tools: home !== undefined && has(sessionController, 'canOpenWorkspacePath'),
    sessionExport: typeof get('sessionPersistence')?.readRaw === 'function',
    commands: has(get('typertGateway'), 'invoke'),
    uiPlugins: has(get('deeptopUiRegistry'), 'list'),
  }
  return { probedAt: Date.now(), services }
}

export async function routeDesktopRequest(ctx, method, payload, signal) {
  const payloadOf = () => payload
  switch (method) {
    case 'session.list': return sessionList(ctx, payloadOf(), signal)
    case 'session.search': return sessionSearch(ctx, payloadOf(), signal)
    case 'session.create': return sessionCreate(ctx, payloadOf())
    case 'session.history': {
      const { display = true, ...historyPayload } = payload
      const events = await sessionHistory(ctx, historyPayload, signal)
      return display ? { ...events, events: compactHistoryEntries(events.events) } : events
    }
    case 'session.models': return sessionModels(ctx, payloadOf())
    case 'reference.files': return referenceFiles(ctx, payload, signal)
    case 'reference.sessions': return referenceSessions(ctx, payload, signal)
    case 'session.selectModel': return sessionSelectModel(ctx, payloadOf())
    case 'session.rename': return sessionRename(ctx, payloadOf())
    case 'session.fork': return sessionFork(ctx, payloadOf())
    case 'session.prompt': return sessionPrompt(ctx, payloadOf(), signal)
    case 'session.attachment': return sessionAttachment(ctx, payloadOf())
    case 'session.exportZip': return exportSessionZip(ctx, payload, signal)
    case 'session.updateQueue': return sessionUpdateQueue(ctx, payloadOf())
    case 'session.cancel': return sessionCancel(ctx, payloadOf())
    case 'session.repairCorrupt': return repairCorruptSession(ctx, payload, signal)
    case 'subagent.list': return subagentList(ctx, payloadOf(), signal)
    case 'subagent.history': {
      const events = await subagentHistory(ctx, payloadOf(), signal)
      return { ...events, events: compactHistoryEntries(events.events) }
    }
    case 'subagent.prompt': return subagentPrompt(ctx, payloadOf(), signal)
    case 'subagent.interrupt': return subagentInterrupt(ctx, payloadOf())
    case 'host.pickDirectory': return hostPickDirectory(ctx, signal)
    case 'host.listDirectory': return hostListDirectory(ctx, payloadOf(), signal)
    case 'host.createDirectory': return hostCreateDirectory(ctx, payloadOf())
    case 'host.openPath': return hostOpenPath(ctx, payloadOf(), signal)
    case 'workspace.list': return decorateWorkspaceListResponse(ctx, await workspaceList(ctx, signal))
    case 'workspace.create': return decorateWorkspaceMutationResponse(ctx, await workspaceCreate(ctx, payloadOf()))
    case 'workspace.attachSession': return attachWorkspaceSession(ctx, payload)
    case 'workspace.setSessionPinned': return setSessionPinned(ctx, payload)
    case 'workspace.rename': return decorateWorkspaceMutationResponse(ctx, await workspaceRename(ctx, payloadOf()))
    case 'workspace.delete': return deleteWorkspace(ctx, payloadOf())
    case 'workspace.insertSessionBefore': return workspaceInsertSessionBefore(ctx, payloadOf())
    case 'workspace.archiveSession': return workspaceArchiveSession(ctx, payloadOf())
    case 'workspace.restoreSession': return restoreWorkspaceSession(ctx, payload)
    case 'workspace.deleteArchivedSession': return deleteArchivedSession(ctx, payload, signal)
    case 'messageAnnotations.list': return messageAnnotations(ctx).list(payload)
    case 'messageAnnotations.put': return messageAnnotations(ctx).put(payload)
    case 'messageAnnotations.delete': return messageAnnotations(ctx).delete(payload)
    case 'skill.list': return skillList(ctx, payloadOf(), signal)
    case 'skill.install': parseGitHubSource(payload); throw codedError('approval-required', 'Skill 安装必须通过 DSH skill-install 工具并完成审批')
    case 'tool.settings.describe': requireToolSettings(ctx); return describeToolSettings(ctx)
    case 'skill.settings.install': requireToolSettings(ctx); return installManagedSkill(ctx, payload, signal)
    case 'skill.settings.installStatus': requireToolSettings(ctx); return managedSkillInstallStatus(ctx, payload)
    case 'skill.settings.cancelInstall': requireToolSettings(ctx); return cancelManagedSkillInstall(ctx, payload)
    case 'skill.settings.remove': requireToolSettings(ctx); return removeManagedSkill(ctx, payload, signal)
    case 'skill.settings.openDirectory': return openManagedSkillDirectory(ctx, signal)
    case 'mcp.settings.mutate': requireToolSettings(ctx); return mutateMcpSettings(ctx, payload, signal)
    case 'agentPreset.list': return agentPresetList(ctx)
    case 'agentPreset.select': return agentPresetSelect(ctx, payloadOf())
    case 'agentPreset.read': return agentPresetRead(ctx, payloadOf())
    case 'agentPreset.copy': return agentPresetCopy(ctx, payloadOf())
    case 'agentPreset.openDocument': return agentPresetOpenDocument(ctx, payloadOf(), signal)
    case 'agentPreset.remove': return agentPresetRemove(ctx, payloadOf())
    case 'goal.create': return goalCreate(ctx, payloadOf())
    case 'goal.edit': return goalEdit(ctx, payloadOf())
    case 'goal.pause': return goalPause(ctx, payloadOf())
    case 'goal.resume': return goalResume(ctx, payloadOf())
    case 'goal.complete': return goalComplete(ctx, payloadOf())
    case 'goal.clear': return goalClear(ctx, payloadOf())
    case 'settings.describe': return settingsDescribe(ctx)
    case 'settings.openDocument': return settingsOpenDocument(ctx, signal)
    case 'settings.update': return settingsUpdate(ctx, payloadOf())
    case 'settings.replace': return settingsReplace(ctx, payloadOf())
    case 'settings.mutate': return settingsMutate(ctx, payloadOf())
    case 'credentials.describe': return credentialsDescribe(ctx, payloadOf())
    case 'credentials.set': return credentialsSet(ctx, payloadOf())
    case 'credentials.unset': return credentialsUnset(ctx, payloadOf())
    case 'llm.providers': return llmProviders(ctx, payloadOf())
    case 'host.describe': return hostDescribe(ctx)
    case 'llm.models': return hostModels(ctx, payloadOf())
    case 'llm.discoverModels': return llmDiscoverModels(ctx, payloadOf(), signal)
    case 'remote.invoke': return invokeRemote(ctx, payload, signal)
    case 'desktop.capabilities': return probeDesktopCapabilities(ctx)
    case 'ui.plugin.list': return listUiPlugins(ctx)
    case 'ui.plugin.module': return getUiPluginModule(ctx, payload)
    case 'ui.plugin.bundle': return getUiPluginBundle(ctx, payload)
    case 'ui.plugin.invoke': return invokeUiPluginRemote(ctx, payload, signal)
    case 'ui.plugin.storage.get': return getUiPluginStorage(ctx, payload)
    case 'ui.plugin.storage.set': return setUiPluginStorage(ctx, payload)
    case 'ui.plugin.storage.delete': return deleteUiPluginStorage(ctx, payload)
    case 'plugin.list': return filterInventory(await ctx.pluginInventory.list())
    case 'plugin.config.describe': return describePluginConfig(ctx)
    case 'plugin.config.mutate': return mutatePluginConfig(ctx, payload, signal)
    case 'network.getProxy': {
      const explicit = await loadProxySetting()
      const effective = await resolveEffectiveProxy()
      return { explicit, effective }
    }
    case 'network.setProxy': return setProxySetting(payload?.proxy)
    case 'respond': return respond(ctx, payload)
    default: throw new Error(`desktop bridge does not expose ${JSON.stringify(method)}`)
  }
}
