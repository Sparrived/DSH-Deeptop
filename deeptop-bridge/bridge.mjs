import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { routeDesktopRequest } from './routes.mjs'
import { initNetworkProxy, stopSystemProxyWatch } from './network-proxy.mjs'

const PROTOCOL = 'deeptop/1'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

// Keep structured bridge errors (code/details) intact across the process
// boundary so the frontend can degrade by error code instead of message
// matching. Errors without a code stay plain strings for backward compatibility.
export function bridgeErrorFrame(error) {
  const code = error instanceof Error && typeof error.code === 'string' && error.code.trim() ? error.code : undefined
  if (code === undefined) return errorMessage(error)
  return {
    code,
    message: errorMessage(error),
    ...(error.details === undefined ? {} : { details: error.details }),
  }
}

// Stack traces are forwarded as diagnostics (not as the user-facing error) so
// developers can troubleshoot failed desktop requests from the log viewer.
function errorDetail(error) {
  if (error instanceof Error && error.stack) return error.stack
  return errorMessage(error)
}

export class DesktopBridge {
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

    // 在开始读取请求前安装已保存的代理，避免重启后的首个模型请求绕过代理。
    const proxyResult = await initNetworkProxy()
    if (!proxyResult.ok) {
      console.warn(`[deeptop-bridge] 初始化网络代理失败：${proxyResult.error}`)
    }

    this.input = createInterface({ input: process.stdin, crlfDelay: Infinity })
    this.input.on('line', line => { void this.handleLine(line) })
    this.input.on('close', () => {
      if (!this.closed) this.abort.abort()
    })

    void this.forwardEvents('mux')
    void this.forwardEvents('host')
    this.write({ type: 'ready', protocol: PROTOCOL })
  }

  async handleLine(line) {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      this.write({ type: 'protocol-error', message: 'deeptop-bridge received invalid JSON' })
      return
    }
    if (!isRecord(request) || typeof request.id !== 'string' || typeof request.method !== 'string') {
      this.write({ type: 'protocol-error', message: 'deeptop-bridge request requires string id and method' })
      return
    }

    try {
      const response = await routeDesktopRequest(
        this.ctx,
        request.method,
        isRecord(request.payload) ? request.payload : {},
        this.abort.signal,
      )
      this.write({ type: 'response', id: request.id, response })
    } catch (error) {
      this.write({ type: 'response', id: request.id, error: bridgeErrorFrame(error) })
      this.write({
        type: 'diagnostic',
        level: 'error',
        message: `desktop request ${request.method} failed: ${errorDetail(error)}`,
      })
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
        this.write({ type: 'event', channel, frame: { rpcId: frame.rpcId, payload: frame.payload } })
      }
    } catch (error) {
      if (!this.closed && !this.abort.signal.aborted) {
        this.write({ type: 'diagnostic', level: 'error', message: `${channel} event stream ended: ${errorDetail(error)}` })
      }
    }
  }

  write(frame) {
    process.stdout.write(`${JSON.stringify(frame)}\n`)
  }

  writeFatal(error) {
    this.write({ type: 'fatal', message: errorDetail(error) })
  }

  dispose() {
    this.closed = true
    this.abort.abort()
    stopSystemProxyWatch()
    this.input?.close()
  }
}
