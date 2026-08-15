import assert from "node:assert/strict";
import test from "node:test";
import {
  markSessionError,
  removeSessionRecordEntry,
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
