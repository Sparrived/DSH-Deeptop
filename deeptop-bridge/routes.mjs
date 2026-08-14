import { randomUUID } from 'node:crypto'

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

async function sessionModels(ctx, request) {
  const response = await ctx.apiProxy.sessions.models(request)
  const result = response?.result
  if (!result?.ok || !isRecord(result.value)) return response
  const current = result.value.current
  if (!isRecord(current) || typeof current.provider !== 'string' || typeof current.model !== 'string') return response
  try {
    const info = await ctx.llm.resolveModelInfo(current.provider, current.model)
    const contextWindow = info?.context?.contextWindow
    if (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0) return response
    const groups = Array.isArray(result.value.groups)
      ? await Promise.all(result.value.groups.map(async group => {
          if (!isRecord(group) || !Array.isArray(group.models)) return group
          const models = await Promise.all(group.models.map(async model => {
            if (!isRecord(model) || typeof model.id !== 'string') return model
            try {
              const modelInfo = await ctx.llm.resolveModelInfo(String(group.id), model.id)
              const modelWindow = modelInfo?.context?.contextWindow
              return typeof modelWindow === 'number' && Number.isInteger(modelWindow) && modelWindow > 0
                ? { ...model, contextWindow: modelWindow }
                : model
            } catch {
              return model
            }
          }))
          return { ...group, models }
        }))
      : result.value.groups
    return { ...response, result: { ...result, value: { ...result.value, contextWindow, groups } } }
  } catch {
    return response
  }
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
    case 'workspace.rename': return api.workspace.rename(request)
    case 'workspace.delete': return api.workspace.delete(request)
    case 'workspace.insertBefore': return api.workspace.insertBefore(request)
    case 'workspace.insertSessionBefore': return api.workspace.insertSessionBefore(request)
    case 'workspace.archiveSession': return api.workspace.archiveSession(request)
    case 'skill.list': return api.skills.list(request)
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
    case 'llm.models': return api.llm.models(request)
    case 'llm.discoverModels': return api.llm.discoverModels(request, signal)
    case 'remote.invoke': return invokeRemote(ctx, payload, signal)
    case 'plugin.list': return ctx.pluginInventory.list()
    case 'respond': return api.respond(payload)
    default: throw new Error(`desktop bridge does not expose ${JSON.stringify(method)}`)
  }
}
