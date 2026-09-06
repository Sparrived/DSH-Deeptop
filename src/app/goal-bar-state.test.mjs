import assert from "node:assert/strict";
import test from "node:test";
import { nextGoalBarState } from "./goal-bar-state.ts";

test("keeps the first loaded Goal collapsed", () => {
  assert.deepEqual(nextGoalBarState({ initialized: false, projectionLoaded: false, phase: undefined }), { initialized: false, collapsed: true });
  assert.deepEqual(nextGoalBarState({ initialized: false, projectionLoaded: true, phase: "active" }), { initialized: true, collapsed: true });
});

test("preserves automatic expansion after the initial Goal projection", () => {
  assert.deepEqual(nextGoalBarState({ initialized: true, projectionLoaded: true, phase: "active" }), { initialized: true, collapsed: false });
  assert.deepEqual(nextGoalBarState({ initialized: true, projectionLoaded: true, phase: "paused" }), { initialized: true, collapsed: false });
  assert.deepEqual(nextGoalBarState({ initialized: true, projectionLoaded: true, phase: "complete" }), { initialized: true, collapsed: true });
});
