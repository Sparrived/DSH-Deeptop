import type { DshHistoryEntry } from "../lib/desktop";

export type SessionIndicator =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "max-tokens"
  | "blocked"
  | "interrupted";

const terminalIndicators = new Set<SessionIndicator>([
  "completed",
  "error",
  "cancelled",
  "max-tokens",
  "blocked",
  "interrupted",
]);

/** Map the durable turn-end reason to the sidebar's terminal indicator. */
export function sessionIndicatorForTurnEnd(reason: unknown): SessionIndicator {
  const kind = reason && typeof reason === "object" && "kind" in reason
    ? (reason as { kind?: unknown }).kind
    : undefined;
  switch (kind) {
    case "error": return "error";
    case "aborted": return "cancelled";
    case "max-tokens": return "max-tokens";
    case "blocked": return "blocked";
    case "interrupted": return "interrupted";
    case "completed": return "completed";
    default: return "completed";
  }
}

/** Read the latest durable turn ending for a cold session sidebar row. */
export function sessionIndicatorForHistory(entries: readonly DshHistoryEntry[]): SessionIndicator | undefined {
  let latest: DshHistoryEntry | undefined;
  for (const entry of entries) {
    if (entry.event.type !== "turn/end" || (latest && entry.event.seq <= latest.event.seq)) continue;
    latest = entry;
  }
  return latest ? sessionIndicatorForTurnEnd(latest.event.data.reason) : undefined;
}

/** Apply a recorded turn ending without allowing the later idle event to erase it. */
export function updateSessionIndicatorForTurnEnd(
  indicators: Record<string, SessionIndicator>,
  sessionId: string,
  reason: unknown,
): Record<string, SessionIndicator> {
  if (!sessionId) return indicators;
  const indicator = sessionIndicatorForTurnEnd(reason);
  if (indicators[sessionId] === indicator) return indicators;
  return { ...indicators, [sessionId]: indicator };
}

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
  const current = indicators[sessionId];
  const indicator = running
    ? "running"
    : current !== undefined && terminalIndicators.has(current) ? current : "completed";
  if (current === indicator) return indicators;
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
 * Reconcile indicators after DSH restarts: a running row without a closing
 * turn/end event was interrupted while the runtime was unavailable.
 */
export function reconcileSessionIndicators(
  indicators: Record<string, SessionIndicator>,
  sessions: ReadonlyArray<{ sessionId: string; running: boolean }>,
): Record<string, SessionIndicator> {
  let next = indicators;
  for (const session of sessions) {
    if (session.running) continue;
    if (next[session.sessionId] === "running") {
      next = { ...next, [session.sessionId]: "interrupted" };
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
