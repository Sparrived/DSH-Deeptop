import assert from "node:assert/strict";
import test from "node:test";
import { buildActiveSessionView } from "./active-session-view.ts";

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
    ...patch,
  };
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

  assert.deepEqual(result.pinned.map((group) => ({
    workspaceId: group.workspaceId,
    sessionIds: group.sessions.map((item) => item.sessionId),
  })), [
    { workspaceId: "workspace-1", sessionIds: ["session-1"] },
    { workspaceId: "workspace-2", sessionIds: ["session-3"] },
  ]);
  assert.deepEqual(result.working.map((group) => ({
    workspaceId: group.workspaceId,
    sessionIds: group.sessions.map((item) => item.sessionId),
  })), [
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
