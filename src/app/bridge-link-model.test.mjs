import assert from "node:assert/strict";
import test from "node:test";
import {
  bridgeLinkReduce,
  initialBridgeLinkSnapshot,
  retryableBridgeFailure,
} from "./bridge-link-model.ts";

test("starts unknown and becomes available/unavailable from status events", () => {
  let state = initialBridgeLinkSnapshot();
  assert.equal(state.phase, "unknown");
  state = bridgeLinkReduce(state, { type: "status", available: true, message: "DSH 已就绪" });
  assert.deepEqual(state, { phase: "available", message: "DSH 已就绪", changedAt: state.changedAt });
  state = bridgeLinkReduce(state, { type: "status", available: false, message: "DSH 已停止" });
  assert.equal(state.phase, "unavailable");
  assert.equal(state.message, "DSH 已停止");
});

test("keeps the same snapshot for duplicate status events", () => {
  let state = initialBridgeLinkSnapshot();
  state = bridgeLinkReduce(state, { type: "status", available: true, message: "DSH 已就绪" });
  const again = bridgeLinkReduce(state, { type: "status", available: true, message: "DSH 已就绪" });
  assert.equal(again, state);
});

test("reset returns to unknown", () => {
  let state = bridgeLinkReduce(initialBridgeLinkSnapshot(), { type: "status", available: true, message: "ready" });
  state = bridgeLinkReduce(state, { type: "reset" });
  assert.equal(state.phase, "unknown");
  assert.equal(state.message, "");
});

test("only bridge-unavailable failures are retryable", () => {
  assert.equal(retryableBridgeFailure("bridge-unavailable"), true);
  assert.equal(retryableBridgeFailure("reference-unavailable"), false);
  assert.equal(retryableBridgeFailure("session-not-found"), false);
  assert.equal(retryableBridgeFailure(undefined), false);
});
