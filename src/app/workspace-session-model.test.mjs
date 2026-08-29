import assert from "node:assert/strict";
import test from "node:test";
import {
  indexWorkspacesBySessionId,
  reorderWorkspaceProjections,
  sessionsForWorkspace,
  upsertWorkspaceProjection,
  workspaceFromHostEvent,
  workspacePathForSession,
} from "./workspace-session-model.ts";

function session(sessionId, cwd = "D:/repo") {
  return { sessionId, cwd, updatedAt: 1, running: false, blank: false };
}

function workspace(workspaceId, sessionIds, overrides = {}) {
  return {
    workspaceId,
    path: `D:/${workspaceId}`,
    title: workspaceId,
    sessionIds,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("treats Host sessionIds as the only workspace membership source", () => {
  const registered = session("registered", "D:/repo");
  const sameDirectoryOnly = session("same-directory-only", "D:/repo");
  const repo = workspace("repo", [registered.sessionId], { path: "D:/repo" });

  assert.equal(indexWorkspacesBySessionId([repo]).get(registered.sessionId), repo);
  assert.equal(workspacePathForSession(registered.sessionId, [repo]), "D:/repo");
  assert.equal(workspacePathForSession(sameDirectoryOnly.sessionId, [repo]), "");
  assert.deepEqual(sessionsForWorkspace([registered, sameDirectoryOnly], [repo], null), [sameDirectoryOnly]);
  assert.deepEqual(sessionsForWorkspace([registered, sameDirectoryOnly], [repo], repo), [registered]);
});

test("keeps pinned sessions first inside their registered workspace", () => {
  const first = session("first");
  const second = session("second");
  const repo = workspace("repo", [first.sessionId, second.sessionId], { pinnedSessionIds: [second.sessionId] });
  assert.deepEqual(sessionsForWorkspace([first, second], [repo], repo).map((item) => item.sessionId), ["second", "first"]);
});

test("applies Host workspace snapshots without dropping desktop pin metadata", () => {
  const current = workspace("repo", ["one", "two"], { pinnedSessionIds: ["two", "gone"] });
  const changed = workspace("repo", ["two", "three"], { updatedAt: "2026-01-02T00:00:00.000Z" });
  assert.deepEqual(upsertWorkspaceProjection([current], changed), [{ ...changed, pinnedSessionIds: ["two"] }]);

  const other = workspace("other", []);
  assert.deepEqual(reorderWorkspaceProjections([current, other], ["other", "repo"]), [other, current]);
});

test("accepts complete Host workspace event snapshots and rejects incomplete payloads", () => {
  const repo = workspace("repo", ["one"]);
  assert.deepEqual(workspaceFromHostEvent(repo), repo);
  assert.equal(workspaceFromHostEvent({ ...repo, sessionIds: "one" }), null);
  assert.equal(workspaceFromHostEvent({ ...repo, updatedAt: undefined }), null);
});
