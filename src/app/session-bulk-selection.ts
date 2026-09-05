import type { DshSessionSummary } from "../lib/desktop";

/** Keeps only selected ids that are still available in the current list. */
export function retainSessionSelection(selectedIds: ReadonlySet<string>, sessions: readonly DshSessionSummary[]): Set<string> {
  const available = new Set(sessions.map((session) => session.sessionId));
  return new Set([...selectedIds].filter((sessionId) => available.has(sessionId)));
}

/** Returns selected sessions in the list's display order. */
export function selectedSessions(sessions: readonly DshSessionSummary[], selectedIds: ReadonlySet<string>): DshSessionSummary[] {
  return sessions.filter((session) => selectedIds.has(session.sessionId));
}

/** Toggles one session id without mutating React state. */
export function toggleSessionSelection(selectedIds: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

/** Selects every currently displayed session. */
export function selectAllSessions(sessions: readonly DshSessionSummary[]): Set<string> {
  return new Set(sessions.map((session) => session.sessionId));
}
