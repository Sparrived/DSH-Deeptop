import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

export const name = 'deeptop-bridge'
export const inject = ['apiProxy', 'pluginInventory', 'llm']

const PROTOCOL = 'deeptop/1'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

class DesktopBridge {
  constructor(ctx) {
    this.ctx = ctx
    this.closed = false
    this.abort = new AbortController()
    this.input = undefined
  }

  async start() {
    await this.ctx.get('loader')?.await()
    if (this.closed) return
    if (this.ctx.get('apiProxy') === undefined) {
      throw new Error('deeptop-bridge requires @deepseek-ai/dsh-host-apiproxy')
    }

    this.input = createInterface({ input: process.stdin, crlfDelay: Infinity })
    this.input.on('line', line => { void this.handleLine(line) })
    this.input.on('close', () => {
      if (!this.closed) this.abort.abort()
    })

    void this.forwardEvents('mux')
    void this.forwardEvents('host')
    write({ type: 'ready', protocol: PROTOCOL })
  }

  async handleLine(line) {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      write({ type: 'protocol-error', message: 'deeptop-bridge received invalid JSON' })
      return
    }
    if (!isRecord(request) || typeof request.id !== 'string' || typeof request.method !== 'string') {
      write({ type: 'protocol-error', message: 'deeptop-bridge request requires string id and method' })
      return
    }

    try {
      const response = await this.call(request.method, isRecord(request.payload) ? request.payload : {})
      write({ type: 'response', id: request.id, response })
    } catch (error) {
      write({ type: 'response', id: request.id, error: errorMessage(error) })
    }
  }

  async sessionModels(request) {
    const response = await this.ctx.apiProxy.sessions.models(request)
    const result = response?.result
    if (!result?.ok || !isRecord(result.value)) return response
    const current = result.value.current
    if (!isRecord(current) || typeof current.provider !== 'string' || typeof current.model !== 'string') return response
    try {
      const info = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
      const contextWindow = info?.context?.contextWindow
      if (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0) return response
      const groups = Array.isArray(result.value.groups)
        ? await Promise.all(result.value.groups.map(async group => {
            if (!isRecord(group) || !Array.isArray(group.models)) return group
            const models = await Promise.all(group.models.map(async model => {
              if (!isRecord(model) || typeof model.id !== 'string') return model
              try {
                const modelInfo = await this.ctx.llm.resolveModelInfo(String(group.id), model.id)
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

  async call(method, payload) {
    const api = this.ctx.apiProxy
    const request = { rpcId: randomUUID(), payload }
    const signal = this.abort.signal
    switch (method) {
      case 'session.list': return api.sessions.list(request)
      case 'session.search': return api.sessions.search(request, signal)
      case 'session.create': return api.sessions.create(request)
      case 'session.history': return api.sessions.history(request)
      case 'session.models': return this.sessionModels(request)
      case 'session.selectModel': return api.sessions.selectModel(request)
      case 'session.rename': return api.sessions.rename(request)
      case 'session.fork': return api.sessions.fork(request)
      case 'session.prompt': return api.sessions.prompt(request)
      case 'session.attachment': return api.sessions.attachment(request)
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
      case 'plugin.list': return this.ctx.pluginInventory.list()
      case 'respond': return api.respond(payload)
      default: throw new Error(`desktop bridge does not expose ${JSON.stringify(method)}`)
    }
  }

  async forwardEvents(channel) {
    const api = this.ctx.apiProxy
    const request = { rpcId: randomUUID(), payload: {} }
    const stream = channel === 'mux'
      ? api.events.mux(request, this.abort.signal)
      : api.events.host(request, this.abort.signal)
    try {
      for await (const frame of stream) {
        if (this.closed) return
        write({ type: 'event', channel, frame: { rpcId: frame.rpcId, payload: frame.payload } })
      }
    } catch (error) {
      if (!this.closed && !this.abort.signal.aborted) {
        write({ type: 'diagnostic', level: 'error', message: `${channel} event stream ended: ${errorMessage(error)}` })
      }
    }
  }

  dispose() {
    this.closed = true
    this.abort.abort()
    this.input?.close()
  }
}

export function apply(ctx) {
  const bridge = new DesktopBridge(ctx)
  void bridge.start().catch(error => {
    write({ type: 'fatal', message: errorMessage(error) })
    ctx.get('appExit')?.(1)
  })
  return () => bridge.dispose()
}
