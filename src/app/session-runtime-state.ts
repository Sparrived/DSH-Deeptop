export type SessionIndicator = "idle" | "running" | "completed" | "error";

type SessionRuntimeState = {
  sessionId: string;
  running: boolean;
};

export function updateSessionRunning<T extends SessionRuntimeState>(
  sessions: T[],
  sessionId: string,
  running: boolean,
): T[] {
  if (!sessionId) return sessions;
  let changed = false;
  const next = sessions.map((session) => {
    if (session.sessionId !== sessionId || session.running === running) return session;
    changed = true;
    return { ...session, running };
  });
  return changed ? next : sessions;
}

export function updateSessionIndicator(
  indicators: Record<string, SessionIndicator>,
  sessionId: string,
  running: boolean,
): Record<string, SessionIndicator> {
  if (!sessionId) return indicators;
  const indicator = running
    ? "running"
    : indicators[sessionId] === "error" ? "error" : "completed";
  if (indicators[sessionId] === indicator) return indicators;
  return { ...indicators, [sessionId]: indicator };
}

export function markSessionError(
  indicators: Record<string, SessionIndicator>,
  sessionId: string,
): Record<string, SessionIndicator> {
  if (!sessionId || indicators[sessionId] === "error") return indicators;
  return { ...indicators, [sessionId]: "error" };
}

/**
 * Reconcile indicators after DSH restarts: any session the runtime reports as
 * NOT running but that we still show as "running" is stale (the crash never
 * delivered the running=false flip). Reset those to "idle" so the sidebar does
 * not look stuck on a crashed session. Leaves "error"/"completed" and any
 * genuinely running session untouched.
 */
export function reconcileSessionIndicators(
  indicators: Record<string, SessionIndicator>,
  sessions: ReadonlyArray<{ sessionId: string; running: boolean }>,
): Record<string, SessionIndicator> {
  let next = indicators;
  for (const session of sessions) {
    if (session.running) continue;
    if (next[session.sessionId] === "running") {
      next = { ...next, [session.sessionId]: "idle" };
    }
  }
  return next;
}

export function removeSessionRecordEntry<T>(
  entries: Record<string, T>,
  sessionId: string,
): Record<string, T> {
  if (!sessionId || !Object.prototype.hasOwnProperty.call(entries, sessionId)) return entries;
  const next = { ...entries };
  delete next[sessionId];
  return next;
}
