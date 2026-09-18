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
  /** 挂起审批或提问的会话：没有运行状态也属于活跃。 */
  pendingSessionIds: ReadonlySet<string>;
};

function isEligibleSession(session: DshSessionSummary, archivedSessionIds: ReadonlySet<string>) {
  return !archivedSessionIds.has(session.sessionId)
    && !session.blank
    && session.origin !== "subagent";
}

/**
 * 活跃成员：正在运行、运行出错，或等待用户审批/回答。
 * 已完成、已取消等终态不属于活跃列表，否则侧栏会退化成"全部会话"。
 */
export function isActiveSessionMember(
  session: DshSessionSummary,
  indicator: SessionIndicator | undefined,
  pendingSessionIds: ReadonlySet<string>,
) {
  return session.running
    || indicator === "running"
    || indicator === "error"
    || pendingSessionIds.has(session.sessionId);
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
      .filter((session) => isActiveSessionMember(session, options.indicators[session.sessionId], options.pendingSessionIds))
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

/** 进入活跃视图时冻结的成员快照。 */
export type ActiveSessionSnapshot = {
  view: ActiveSessionView;
  /** 冻结时刻已经登记的会话；只有此后新建的会话才允许补入。 */
  knownSessionIds: ReadonlySet<string>;
};

export function snapshotActiveSessionView(
  view: ActiveSessionView,
  knownSessionIds: ReadonlySet<string>,
): ActiveSessionSnapshot {
  // 复制一份：调用方后续新建的会话不能算作"快照时已知"。
  return { view, knownSessionIds: new Set(knownSessionIds) };
}

/**
 * 冻结活跃列表：成员按快照渲染，只补入快照之后新建且当前活跃的会话。
 * 浏览期间结束运行的会话留在原位并改为显示实时结果（已完成/出错等），
 * 因此列表既不会在用户眼前增删，状态文案也仍然是实时的。
 */
export function freezeActiveSessionView(
  snapshot: ActiveSessionSnapshot,
  live: ActiveSessionView,
): ActiveSessionView {
  const liveById = new Map<string, DshSessionSummary>();
  [...live.pinned, ...live.working].forEach((group) => {
    group.sessions.forEach((session) => liveById.set(session.sessionId, session));
  });
  // 冻结行优先取实时摘要（标题、运行状态保持最新）；已退出活跃集合的行沿用快照摘要，
  // 但清掉陈旧的运行标记，交给实时状态指示器显示该行的最终结果。
  const resolve = (session: DshSessionSummary) => {
    const liveSession = liveById.get(session.sessionId);
    if (liveSession) return liveSession;
    return session.running ? { ...session, running: false } : session;
  };
  const clone = (groups: ActiveSessionWorkspaceGroup[]) => groups.map((group) => ({
    ...group,
    sessions: group.sessions.map(resolve),
  }));

  const pinned = clone(snapshot.view.pinned);
  const working = clone(snapshot.view.working);
  const displayedSessionIds = new Set<string>();
  [...pinned, ...working].forEach((group) => group.sessions.forEach((session) => displayedSessionIds.add(session.sessionId)));

  const workingByWorkspaceId = new Map(working.map((group) => [group.workspaceId, group]));
  live.working.forEach((group) => {
    // 快照里没有、也不是快照之后新建的会话一律忽略：冻结列表只接受新会话。
    const additions = group.sessions
      .filter((session) => !snapshot.knownSessionIds.has(session.sessionId) && !displayedSessionIds.has(session.sessionId))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    if (additions.length === 0) return;
    additions.forEach((session) => displayedSessionIds.add(session.sessionId));
    const target = workingByWorkspaceId.get(group.workspaceId);
    // 新会话插到该工作区现有行之前：既保持"最近在前"的读法，也不重排已冻结的行。
    if (target) target.sessions.unshift(...additions);
    else {
      const created = { ...group, sessions: additions };
      working.push(created);
      workingByWorkspaceId.set(group.workspaceId, created);
    }
  });

  return {
    pinned,
    working,
    total: pinned.reduce((count, group) => count + group.sessions.length, 0)
      + working.reduce((count, group) => count + group.sessions.length, 0),
  };
}
