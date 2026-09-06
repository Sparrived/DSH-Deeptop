import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

/** A user-initiated selection invalidates older workspace navigation work. */
export function isWorkspaceSelectionCurrent(selectionRequest: number | undefined, currentRequest: number): boolean {
  return selectionRequest === undefined || selectionRequest === currentRequest;
}

/**
 * Select the first conversation shown for a workspace using the already-loaded
 * workspace projection. Registered workspaces follow their authoritative
 * sessionIds order; the empty path represents sessions not owned by a workspace.
 */
export function firstSessionForWorkspace(
  workspacePath: string,
  workspace: DshWorkspace | null,
  visibleSessions: readonly DshSessionSummary[],
  workspaceBySessionId: ReadonlyMap<string, DshWorkspace>,
): DshSessionSummary | null {
  if (workspace) {
    const visibleById = new Map(visibleSessions.map((session) => [session.sessionId, session]));
    for (const sessionId of workspace.sessionIds) {
      const session = visibleById.get(sessionId);
      if (session) return session;
    }
    return null;
  }
  if (!workspacePath) {
    return visibleSessions.find((session) => !workspaceBySessionId.has(session.sessionId)) ?? null;
  }
  return null;
}
