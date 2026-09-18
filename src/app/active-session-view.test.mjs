import assert from "node:assert/strict";
import test from "node:test";
import { buildActiveSessionView, freezeActiveSessionView, snapshotActiveSessionView } from "./active-session-view.ts";

function session(index, patch = {}) {
  return {
    sessionId: `session-${index}`,
    updatedAt: index,
    running: false,
    blank: false,
    ...patch,
  };
}

function workspace(index, sessionIds, pinnedSessionIds = []) {
  return {
    workspaceId: `workspace-${index}`,
    path: `C:\\work\\project-${index}`,
    title: `Project ${index}`,
    sessionIds,
    pinnedSessionIds,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function options(patch = {}) {
  return {
    archivedSessionIds: new Set(),
    indicators: {},
    pendingSessionIds: new Set(),
    ...patch,
  };
}

function ids(groups) {
  return groups.map((group) => ({
    workspaceId: group.workspaceId,
    sessionIds: group.sessions.map((item) => item.sessionId),
  }));
}

test("projects pinned and working sessions from every workspace", () => {
  const sessions = [
    session(1),
    session(2, { running: true }),
    session(3),
    session(4),
  ];
  const workspaces = [
    workspace(1, ["session-1", "session-2"], ["session-1"]),
    workspace(2, ["session-3", "session-4"], ["session-3"]),
  ];

  const result = buildActiveSessionView(sessions, workspaces, options({
    indicators: { "session-4": "running" },
  }));

  assert.deepEqual(ids(result.pinned), [
    { workspaceId: "workspace-1", sessionIds: ["session-1"] },
    { workspaceId: "workspace-2", sessionIds: ["session-3"] },
  ]);
  assert.deepEqual(ids(result.working), [
    { workspaceId: "workspace-1", sessionIds: ["session-2"] },
    { workspaceId: "workspace-2", sessionIds: ["session-4"] },
  ]);
  assert.equal(result.total, 4);
});

test("keeps a pinned running session only in the pinned section", () => {
  const sessions = [session(1, { running: true }), session(2, { running: true })];
  const workspaces = [workspace(1, ["session-1", "session-2"], ["session-1"])];

  const result = buildActiveSessionView(sessions, workspaces, options());

  assert.deepEqual(result.pinned[0].sessions.map((item) => item.sessionId), ["session-1"]);
  assert.deepEqual(result.working[0].sessions.map((item) => item.sessionId), ["session-2"]);
  assert.equal(result.total, 2);
});

test("filters archived, blank, subagent, unregistered and stale pinned sessions", () => {
  const sessions = [
    session(1, { running: true }),
    session(2, { running: true, blank: true }),
    session(3, { running: true, origin: "subagent" }),
    session(4, { running: true }),
    session(5, { running: true }),
    session(6),
  ];
  const workspaces = [workspace(1, ["session-1", "session-2", "session-3", "session-4"], ["session-1", "session-6"])];

  const result = buildActiveSessionView(sessions, workspaces, options({
    archivedSessionIds: new Set(["session-4"]),
  }));

  assert.deepEqual(result.pinned[0].sessions.map((item) => item.sessionId), ["session-1"]);
  assert.deepEqual(result.working, []);
  assert.equal(result.total, 1);
});

test("preserves pin order and sorts working sessions by recent activity within a workspace", () => {
  const sessions = [session(1, { running: true }), session(2, { running: true }), session(3), session(4)];
  const workspaces = [workspace(1, ["session-1", "session-2", "session-3", "session-4"], ["session-4", "session-3"])];

  const result = buildActiveSessionView(sessions, workspaces, options());

  assert.deepEqual(result.pinned[0].sessions.map((item) => item.sessionId), ["session-4", "session-3"]);
  assert.deepEqual(result.working[0].sessions.map((item) => item.sessionId), ["session-2", "session-1"]);
});

test("excludes finished sessions and keeps only working, errored and pending ones", () => {
  const sessions = [session(1), session(2), session(3), session(4), session(5), session(6), session(7)];
  const workspaces = [workspace(1, sessions.map((item) => item.sessionId))];

  const result = buildActiveSessionView(sessions, workspaces, options({
    indicators: {
      "session-2": "completed",
      "session-3": "cancelled",
      "session-4": "error",
      "session-5": "max-tokens",
      "session-6": "idle",
    },
    pendingSessionIds: new Set(["session-7"]),
  }));

  // 已完成、已取消、达到上限和就绪都不属于活跃列表。
  assert.deepEqual(ids(result.working), [{ workspaceId: "workspace-1", sessionIds: ["session-7", "session-4"] }]);
  assert.equal(result.total, 2);
});

test("treats a running session as active even when its indicator is terminal", () => {
  const sessions = [session(1, { running: true })];
  const workspaces = [workspace(1, ["session-1"])];

  const result = buildActiveSessionView(sessions, workspaces, options({
    indicators: { "session-1": "completed" },
  }));

  assert.deepEqual(result.working[0].sessions.map((item) => item.sessionId), ["session-1"]);
});

test("freezes snapshot members when they finish while the view is open", () => {
  const sessions = [session(1, { running: true }), session(2, { running: true })];
  const workspaces = [workspace(1, ["session-1", "session-2"])];

  const snapshot = snapshotActiveSessionView(
    buildActiveSessionView(sessions, workspaces, options()),
    new Set(sessions.map((item) => item.sessionId)),
  );
  // 浏览期间两个会话都结束运行：成员必须留在原位，只更新为实时结果。
  const live = buildActiveSessionView(
    sessions.map((item) => ({ ...item, running: false })),
    workspaces,
    options({ indicators: { "session-1": "completed", "session-2": "error" } }),
  );

  // 完成的行退出活跃集合；出错的行仍然活跃。
  assert.deepEqual(ids(live.working), [{ workspaceId: "workspace-1", sessionIds: ["session-2"] }]);
  const frozen = freezeActiveSessionView(snapshot, live);
  assert.deepEqual(frozen.working[0].sessions.map((item) => item.sessionId), ["session-2", "session-1"]);
  assert.deepEqual(frozen.working[0].sessions.map((item) => item.running), [false, false]);
  assert.equal(frozen.total, 2);
});

test("appends only sessions created after the snapshot", () => {
  const workspaces = [workspace(1, ["session-1", "session-2", "session-3"])];
  const snapshot = snapshotActiveSessionView(
    buildActiveSessionView([session(1, { running: true })], workspaces, options()),
    // 快照登记了当时已知的 session-1 与 session-2；session-3 之后才新建。
    new Set(["session-1", "session-2"]),
  );
  const live = buildActiveSessionView(
    [session(1, { running: true }), session(2, { running: true }), session(3, { running: true })],
    workspaces,
    options(),
  );

  const frozen = freezeActiveSessionView(snapshot, live);
  assert.deepEqual(ids(frozen.working), [{ workspaceId: "workspace-1", sessionIds: ["session-3", "session-1"] }]);
  assert.equal(frozen.total, 2);
});
