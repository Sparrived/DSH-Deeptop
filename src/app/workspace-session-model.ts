import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

/** Build the authoritative session-to-workspace account from Host projections. */
export function indexWorkspacesBySessionId(workspaces: readonly DshWorkspace[]): Map<string, DshWorkspace> {
  const result = new Map<string, DshWorkspace>();
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) result.set(sessionId, workspace);
  }
  return result;
}

/** Resolve the selected workspace path for an existing session from Host membership only. */
export function workspacePathForSession(sessionId: string, workspaces: readonly DshWorkspace[]): string {
  return workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.path ?? "";
}

/** Project visible sessions for one registered workspace or the authoritative ungrouped account. */
export function sessionsForWorkspace(
  visibleSessions: readonly DshSessionSummary[],
  workspaces: readonly DshWorkspace[],
  selectedWorkspace: DshWorkspace | null,
): DshSessionSummary[] {
  if (!selectedWorkspace) {
    const accounted = indexWorkspacesBySessionId(workspaces);
    return visibleSessions.filter((session) => !accounted.has(session.sessionId));
  }
  const visibleById = new Map(visibleSessions.map((session) => [session.sessionId, session]));
  const pinned = new Set(selectedWorkspace.pinnedSessionIds ?? []);
  return selectedWorkspace.sessionIds
    .map((sessionId) => visibleById.get(sessionId))
    .filter((session): session is DshSessionSummary => session !== undefined)
    .sort((left, right) => Number(pinned.has(right.sessionId)) - Number(pinned.has(left.sessionId)));
}

/** Validate a workspace snapshot carried by a Host event. */
export function workspaceFromHostEvent(value: unknown): DshWorkspace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workspace = value as Record<string, unknown>;
  if (typeof workspace.workspaceId !== "string"
    || typeof workspace.path !== "string"
    || typeof workspace.title !== "string"
    || !Array.isArray(workspace.sessionIds)
    || !workspace.sessionIds.every((sessionId) => typeof sessionId === "string")
    || typeof workspace.createdAt !== "string"
    || typeof workspace.updatedAt !== "string") return null;
  const pinnedSessionIds = workspace.pinnedSessionIds;
  if (pinnedSessionIds !== undefined
    && (!Array.isArray(pinnedSessionIds) || !pinnedSessionIds.every((sessionId) => typeof sessionId === "string"))) return null;
  return workspace as unknown as DshWorkspace;
}

/** Apply a full Host workspace snapshot while retaining desktop-only pin metadata. */
export function upsertWorkspaceProjection(
  workspaces: readonly DshWorkspace[],
  workspace: DshWorkspace,
): DshWorkspace[] {
  const current = workspaces.find((item) => item.workspaceId === workspace.workspaceId);
  const nextWorkspace = workspace.pinnedSessionIds === undefined && current?.pinnedSessionIds !== undefined
    ? { ...workspace, pinnedSessionIds: current.pinnedSessionIds.filter((sessionId) => workspace.sessionIds.includes(sessionId)) }
    : workspace;
  return current
    ? workspaces.map((item) => item.workspaceId === workspace.workspaceId ? nextWorkspace : item)
    : [...workspaces, nextWorkspace];
}

/** Apply the durable Host workspace order and retain any snapshots not named by a partial event. */
export function reorderWorkspaceProjections(
  workspaces: readonly DshWorkspace[],
  workspaceIds: readonly string[],
): DshWorkspace[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const ordered = workspaceIds.map((workspaceId) => byId.get(workspaceId)).filter((workspace): workspace is DshWorkspace => workspace !== undefined);
  const included = new Set(ordered.map((workspace) => workspace.workspaceId));
  return [...ordered, ...workspaces.filter((workspace) => !included.has(workspace.workspaceId))];
}
