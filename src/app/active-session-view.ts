import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";
import type { SessionIndicator } from "./session-runtime-state";

export type ActiveSessionWorkspaceGroup = {
  workspace: DshWorkspace;
  workspaceId: string;
  sessions: DshSessionSummary[];
};

export type ActiveSessionView = {
  pinned: ActiveSessionWorkspaceGroup[];
  working: ActiveSessionWorkspaceGroup[];
  total: number;
};

type ActiveSessionViewOptions = {
  archivedSessionIds: ReadonlySet<string>;
  indicators: Readonly<Record<string, SessionIndicator>>;
};

function isEligibleSession(session: DshSessionSummary, archivedSessionIds: ReadonlySet<string>) {
  return !archivedSessionIds.has(session.sessionId)
    && !session.blank
    && session.origin !== "subagent";
}

/**
 * Project all registered workspaces into the sidebar's cross-workspace active view.
 * A pinned running session stays in the pinned section so the same session never
 * appears twice; the row's status edge still communicates that it is running.
 */
export function buildActiveSessionView(
  sessions: readonly DshSessionSummary[],
  workspaces: readonly DshWorkspace[],
  options: ActiveSessionViewOptions,
): ActiveSessionView {
  const eligibleById = new Map(sessions
    .filter((session) => isEligibleSession(session, options.archivedSessionIds))
    .map((session) => [session.sessionId, session]));
  const pinnedSessionIds = new Set<string>();

  const pinned = workspaces.flatMap((workspace) => {
    const memberSessionIds = new Set(workspace.sessionIds);
    const workspaceSessions = (workspace.pinnedSessionIds ?? [])
      .filter((sessionId) => memberSessionIds.has(sessionId) && !pinnedSessionIds.has(sessionId))
      .map((sessionId) => eligibleById.get(sessionId))
      .filter((session): session is DshSessionSummary => session !== undefined);
    workspaceSessions.forEach((session) => pinnedSessionIds.add(session.sessionId));
    return workspaceSessions.length > 0
      ? [{ workspace, workspaceId: workspace.workspaceId, sessions: workspaceSessions }]
      : [];
  });

  const displayedSessionIds = new Set(pinnedSessionIds);
  const working = workspaces.flatMap((workspace) => {
    const workspaceSessions = workspace.sessionIds
      .map((sessionId) => eligibleById.get(sessionId))
      .filter((session): session is DshSessionSummary => session !== undefined)
      .filter((session) => !displayedSessionIds.has(session.sessionId))
      .filter((session) => session.running || options.indicators[session.sessionId] === "running")
      .sort((left, right) => right.updatedAt - left.updatedAt);
    workspaceSessions.forEach((session) => displayedSessionIds.add(session.sessionId));
    return workspaceSessions.length > 0
      ? [{ workspace, workspaceId: workspace.workspaceId, sessions: workspaceSessions }]
      : [];
  });

  return {
    pinned,
    working,
    total: pinned.reduce((count, group) => count + group.sessions.length, 0)
      + working.reduce((count, group) => count + group.sessions.length, 0),
  };
}
