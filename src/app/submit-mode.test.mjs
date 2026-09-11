import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubmitMode } from "./submit-mode.ts";

test("keeps the chosen mode while a turn is running", () => {
  assert.equal(resolveSubmitMode("queue", true), "queue");
  assert.equal(resolveSubmitMode("steer", true), "steer");
});

test("always queues when the session is idle", () => {
  // `agent.steer` would classify an idle submission as a step-level insertion
  // instead of an ordinary user turn, so an idle send must never steer.
  assert.equal(resolveSubmitMode("steer", false), "queue");
  assert.equal(resolveSubmitMode("queue", false), "queue");
});
