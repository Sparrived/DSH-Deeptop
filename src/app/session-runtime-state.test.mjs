import assert from "node:assert/strict";
import test from "node:test";
import {
  markSessionError,
  reconcileSessionIndicators,
  removeSessionRecordEntry,
  sessionIndicatorForHistory,
  sessionIndicatorForTurnEnd,
  updateSessionIndicator,
  updateSessionRunning,
} from "./session-runtime-state.ts";

test("marks only the failed session as stopped", () => {
  const first = { sessionId: "session-1", running: true, title: "first" };
  const second = { sessionId: "session-2", running: true, title: "second" };

  const result = updateSessionRunning([first, second], "session-1", false);

  assert.deepEqual(result, [
    { sessionId: "session-1", running: false, title: "first" },
    second,
  ]);
  assert.equal(result[1], second);
});

test("keeps an error indicator after the stopped status arrives", () => {
  const failed = markSessionError({ "session-1": "running" }, "session-1");
  const stopped = updateSessionIndicator(failed, "session-1", false);

  assert.deepEqual(stopped, { "session-1": "error" });
  assert.deepEqual(updateSessionIndicator(stopped, "session-1", true), { "session-1": "running" });
});

test("removes only stale interaction state for the failed session", () => {
  const current = {
    "session-1": { rpcId: "rpc-1" },
    "session-2": { rpcId: "rpc-2" },
  };

  assert.deepEqual(removeSessionRecordEntry(current, "session-1"), {
    "session-2": { rpcId: "rpc-2" },
  });
  assert.equal(removeSessionRecordEntry(current, "missing"), current);
});

test("keeps every terminal indicator when the runtime becomes idle", () => {
  for (const indicator of ["completed", "error", "cancelled", "max-tokens", "blocked", "interrupted"]) {
    assert.deepEqual(updateSessionIndicator({ "session-1": indicator }, "session-1", false), { "session-1": indicator });
  }
});

test("maps turn endings to distinct sidebar indicators", () => {
  assert.equal(sessionIndicatorForTurnEnd({ kind: "completed" }), "completed");
  assert.equal(sessionIndicatorForTurnEnd({ kind: "error" }), "error");
  assert.equal(sessionIndicatorForTurnEnd({ kind: "aborted", reason: { kind: "user" } }), "cancelled");
  assert.equal(sessionIndicatorForTurnEnd({ kind: "max-tokens" }), "max-tokens");
  assert.equal(sessionIndicatorForTurnEnd({ kind: "blocked" }), "blocked");
  assert.equal(sessionIndicatorForTurnEnd({ kind: "interrupted" }), "interrupted");
  assert.equal(sessionIndicatorForTurnEnd({ kind: "unknown" }), "completed");
});

test("reads the latest turn ending from a session history", () => {
  const event = (seq, type, data = {}) => ({ event: { seq, time: seq, type, data } });
  assert.equal(sessionIndicatorForHistory([
    event(1, "turn/end", { reason: { kind: "error" } }),
    event(2, "assistant/message"),
    event(3, "turn/end", { reason: { kind: "aborted", reason: { kind: "user" } } }),
  ]), "cancelled");
  assert.equal(sessionIndicatorForHistory([event(1, "assistant/message")]), undefined);
});

test("resets stale running indicators to interrupted after DSH restarts", () => {
  const indicators = {
    "session-1": "running", // crashed mid-turn, never received running=false
    "session-2": "running", // still genuinely running
    "session-3": "error",
    "session-4": "completed",
  };
  const sessions = [
    { sessionId: "session-1", running: false },
    { sessionId: "session-2", running: true },
    { sessionId: "session-3", running: false },
    { sessionId: "session-4", running: false },
  ];

  const reconciled = reconcileSessionIndicators(indicators, sessions);

  assert.deepEqual(reconciled, {
    "session-1": "interrupted",
    "session-2": "running",
    "session-3": "error",
    "session-4": "completed",
  });
});

test("leaves indicators untouched when nothing is stale", () => {
  const indicators = { "session-1": "idle", "session-2": "running" };
  const sessions = [
    { sessionId: "session-1", running: false },
    { sessionId: "session-2", running: true },
  ];

  assert.equal(reconcileSessionIndicators(indicators, sessions), indicators);
});
