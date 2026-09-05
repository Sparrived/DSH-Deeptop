import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { routeDesktopRequest } from './routes.mjs'
import { initNetworkProxy, stopSystemProxyWatch } from './network-proxy.mjs'
import { compactLiveEventFrames } from './display-history.mjs'
import { MuxEventSynthesizer } from './events-mux.mjs'
import { HostEventSynthesizer } from './events-host.mjs'
import { createSessionTailRegistry } from './session-tails.mjs'

const PROTOCOL = 'deeptop/1'
const LIVE_EVENT_FLUSH_MS = 16
const LIVE_EVENT_BATCH_LIMIT = 512

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

function awaitWritableDrain(output, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      output.off('drain', onDrain)
      output.off('close', onClose)
      output.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onDrain = () => { cleanup(); resolve() }
    const onClose = () => { cleanup(); reject(new Error('deeptop-bridge stdout closed before drain')) }
    const onError = error => { cleanup(); reject(error) }
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('deeptop-bridge write aborted')) }
    if (signal?.aborted) return onAbort()
    output.once('drain', onDrain)
    output.once('close', onClose)
    output.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Write one complete JSONL frame and honor Node writable backpressure. */
export async function writeBridgeFrame(output, frame, signal) {
  if (output.destroyed || output.closed || output.writableEnded) {
    throw new Error('deeptop-bridge stdout is already closed')
  }
  if (output.write(`${JSON.stringify(frame)}\n`)) return
  await awaitWritableDrain(output, signal)
}

export class DesktopBridge {
  constructor(ctx, output = process.stdout) {
    this.ctx = ctx
    this.output = output
    this.closed = false
    this.abort = new AbortController()
    this.input = undefined
    this.liveFrames = []
    this.liveFlushTimer = undefined
    this.liveFlushPromise = undefined
    this.writeTail = Promise.resolve()
    this.outputFailure = undefined
  }

  async start() {
    await this.ctx.get('loader')?.await()
    if (this.closed) return
    if (this.ctx.get('sessionController') === undefined || this.ctx.get('workspaceController') === undefined) {
      throw new Error('deeptop-bridge requires @deepseek-ai/dsh-api-session-controller and @deepseek-ai/dsh-api-workspace-controller')
    }

    // Live session/event frames keep the registry fresh; cold history reads
    // fall back to one observation when a session tail is not cached.
    this.sessionTails = createSessionTailRegistry()
    try {
      this.ctx.provide?.('deeptopSessionTails', this.sessionTails)
    } catch {
      // A duplicate provide (bridge restarted in the same fiber) keeps the
      // earlier registry; history requests still resolve via the shared ctx.
    }

    // 在开始读取请求前安装已保存的代理，避免重启后的首个模型请求绕过代理。
    const proxyResult = await initNetworkProxy()
    if (!proxyResult.ok) {
      console.warn(`[deeptop-bridge] 初始化网络代理失败：${proxyResult.error}`)
    }

    // The protocol handshake must be the first frame observed by Rust even if
    // an event stream can synchronously produce its first item.
    await this.write({ type: 'ready', protocol: PROTOCOL })
    this.input = createInterface({ input: process.stdin, crlfDelay: Infinity })
    this.input.on('line', line => {
      void this.handleLine(line).catch(error => this.failOutput(error))
    })
    this.input.on('close', () => {
      if (!this.closed) this.abort.abort()
    })

    this.muxEvents = new MuxEventSynthesizer(this.ctx, frame => this.queueLiveFrame(frame), this.abort.signal)
    this.muxEvents.provide(this.ctx)
    this.hostEvents = new HostEventSynthesizer(this.ctx, frame => {
      if (this.closed) return
      void this.write({ type: 'event', channel: 'host', frame }).catch(error => this.failOutput(error))
    })
    this.muxEvents.start().catch(error => this.failOutput(error))
    this.hostEvents.start()
  }

  async handleLine(line) {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      await this.write({ type: 'protocol-error', message: 'deeptop-bridge received invalid JSON' })
      return
    }
    if (!isRecord(request) || typeof request.id !== 'string' || typeof request.method !== 'string') {
      await this.write({ type: 'protocol-error', message: 'deeptop-bridge request requires string id and method' })
      return
    }

    let response
    try {
      response = await routeDesktopRequest(
        this.ctx,
        request.method,
        isRecord(request.payload) ? request.payload : {},
        this.abort.signal,
      )
    } catch (error) {
      await this.write({ type: 'response', id: request.id, error: bridgeErrorFrame(error) })
      await this.write({
        type: 'diagnostic',
        level: 'error',
        message: `desktop request ${request.method} failed: ${errorDetail(error)}`,
      })
      return
    }
    // Output failures are transport failures, never a second RPC response.
    await this.write({ type: 'response', id: request.id, response })
  }

  async flushLiveFrames() {
    if (this.liveFlushTimer !== undefined) clearTimeout(this.liveFlushTimer)
    this.liveFlushTimer = undefined
    if (this.liveFlushPromise) return this.liveFlushPromise
    const frames = this.liveFrames
    this.liveFrames = []
    if (frames.length === 0) return
    const flush = (async () => {
      for (const frame of compactLiveEventFrames(frames)) {
        await this.write({ type: 'event', channel: 'mux', frame })
      }
    })()
    this.liveFlushPromise = flush
    try {
      await flush
    } finally {
      if (this.liveFlushPromise === flush) this.liveFlushPromise = undefined
    }
  }

  async queueLiveFrame(frame) {
    if (this.liveFlushPromise) await this.liveFlushPromise
    this.liveFrames.push({ rpcId: frame.rpcId, payload: frame.payload })
    if (this.liveFrames.length >= LIVE_EVENT_BATCH_LIMIT) {
      await this.flushLiveFrames()
      return
    }
    if (this.liveFlushTimer === undefined) {
      this.liveFlushTimer = setTimeout(() => {
        void this.flushLiveFrames().catch(error => {
          if (!this.closed) {
            console.error(`[deeptop-bridge] flush live events failed: ${errorDetail(error)}`)
            this.failOutput(error)
          }
        })
      }, LIVE_EVENT_FLUSH_MS)
    }
  }

  failOutput(error) {
    if (this.closed || this.outputFailure) return
    this.outputFailure = error instanceof Error ? error : new Error(String(error))
    this.input?.pause()
    this.abort.abort(this.outputFailure)
    this.ctx.get?.('appExit')?.(1)
  }

  write(frame) {
    const write = this.writeTail.then(() => {
      if (this.outputFailure) throw this.outputFailure
      return writeBridgeFrame(this.output, frame, this.abort.signal)
    })
    this.writeTail = write.catch(() => undefined)
    void write.catch(error => this.failOutput(error))
    return write
  }

  writeFatal(error) {
    return this.write({ type: 'fatal', message: errorDetail(error) })
  }

  dispose() {
    this.closed = true
    if (this.liveFlushTimer !== undefined) clearTimeout(this.liveFlushTimer)
    this.liveFlushTimer = undefined
    this.liveFrames = []
    this.muxEvents?.dispose()
    this.hostEvents?.dispose()
    this.sessionTails?.clear()
    this.abort.abort()
    stopSystemProxyWatch()
    this.input?.close()
  }
}
