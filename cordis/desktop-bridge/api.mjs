// Desktop Host API adapter over DSH 0.1.3-alpha.2 in-process services.
//
// The retired `ctx.apiProxy` facade used RPC envelopes and HTTP; the same
// verbs are owned by Typert Remote services
// (TypertRemoteService = plain Cordis Service + @Remote wire markers), so this
// module calls them directly on the shared Cordis tree.
//
// Success returns plain values (frontend invokeBridge unwraps bare values;
// desktop.ts accepts `{ result: ... }` envelopes too). Failures throw coded
// errors; DesktopBridge maps them to the wire error frame preserving
// code/message/details.

/** Build a coded desktop error. */
export function codedError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

/** Re-throw a RemoteError-style error under a desktop code when mapped. */
export function remoteError(error, mapping) {
  const code = typeof error?.code === 'string' ? error.code : undefined
  const mapped = code !== undefined && mapping && mapping[code] !== undefined ? mapping[code] : code
  const failure = new Error(error?.message ?? String(error))
  failure.code = mapped ?? 'gateway/internal'
  if (error?.details !== undefined) failure.details = error.details
  return failure
}

/** Resolve one Session to its live Agent; session-not-found when detached. */
export function resolveAgent(ctx, sessionId) {
  const agent = ctx.get?.('agents')?.get?.(sessionId)
  if (!agent) {
    const error = new Error(`session ${JSON.stringify(sessionId)} not found`)
    error.code = 'session-not-found'
    error.details = { sessionId }
    throw error
  }
  return agent
}

/** Optional live Agent for a Session, undefined when detached. */
export function optionalAgent(ctx, sessionId) {
  return ctx.get?.('agents')?.get?.(sessionId)
}

/**
 * Require a Cordis service by key; throws the named desktop error when absent.
 */
export function requireService(ctx, key, errorCode, message) {
  const service = ctx.get?.(key)
  if (service === undefined) {
    throw codedError(errorCode, message, { capability: key })
  }
  return service
}
