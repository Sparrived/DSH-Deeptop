import assert from "node:assert/strict";
import test from "node:test";
import { firstSessionForWorkspace } from "./workspace-session-selection.ts";

const sessions = [
  { sessionId: "s1", updatedAt: 1, running: false, blank: false },
  { sessionId: "s2", updatedAt: 2, running: false, blank: false },
  { sessionId: "s3", updatedAt: 3, running: false, blank: false },
];
const workspaceA = {
  workspaceId: "w1",
  path: "D:\\Code\\A",
  title: "A",
  sessionIds: ["missing", "s2", "s1"],
  createdAt: "",
  updatedAt: "",
};
const workspaceB = {
  workspaceId: "w2",
  path: "D:\\Code\\B",
  title: "B",
  sessionIds: ["s3"],
  createdAt: "",
  updatedAt: "",
};

test("uses the registered workspace session order without a remote refresh", () => {
  const bySession = new Map([["s1", workspaceA], ["s2", workspaceA], ["s3", workspaceB]]);
  assert.equal(firstSessionForWorkspace(workspaceA.path, workspaceA, sessions, bySession)?.sessionId, "s2");
});

test("selects the first ungrouped session for the runtime workspace", () => {
  const bySession = new Map([["s1", workspaceA], ["s2", workspaceA]]);
  assert.equal(firstSessionForWorkspace("", null, sessions, bySession)?.sessionId, "s3");
});

test("does not borrow a session when a registered workspace has no visible conversations", () => {
  const bySession = new Map([["s1", workspaceA], ["s2", workspaceA], ["s3", workspaceB]]);
  assert.equal(firstSessionForWorkspace(workspaceB.path, workspaceB, sessions.slice(0, 2), bySession), null);
});
