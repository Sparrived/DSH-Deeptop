// Per-session durable tail registry for rc.1 history page cuts.
//
// rc.1 `sessionController.page()` has no "latest log" sentinel: its
// `throughSeq` is an inclusive real log cut obtained from the session's
// current durable tail. This registry remembers the tail each live
// `session/event` reveals and caches cold observations, so a history request
// can supply the cut without re-reading a cold session log per request. The
// bridge creates one registry and provides it on ctx (`deeptopSessionTails`);
// events-mux refreshes it while the desktop is connected.

const MAX_SESSIONS = 512

/** Bounded per-session tail registry (insertion-order eviction, last-write-wins). */
export function createSessionTailRegistry() {
  const tails = new Map()
  return {
    /** Record a live-observed seq for one session. */
    remember(sessionId, seq) {
      if (typeof sessionId !== 'string' || !Number.isSafeInteger(seq) || seq < 0) return
      if (!tails.has(sessionId) && tails.size >= MAX_SESSIONS) {
        const oldest = tails.keys().next().value
        if (oldest !== undefined) tails.delete(oldest)
      }
      tails.delete(sessionId)
      tails.set(sessionId, seq)
    },
    /** Cached durable tail seq for one session, undefined when unknown. */
    tailOf(sessionId) {
      return tails.get(sessionId)
    },
    drop(sessionId) {
      tails.delete(sessionId)
    },
    clear() {
      tails.clear()
    },
  }
}
