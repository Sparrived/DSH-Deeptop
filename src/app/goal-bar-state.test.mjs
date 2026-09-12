import assert from "node:assert/strict";
import test from "node:test";
import { emptyGoalBarState, goalBarAutoCollapsed, nextGoalBarState } from "./goal-bar-state.ts";

const loaded = (goalId, phase) => ({ initialized: true, goalId, phase });

test("reports which phases start collapsed", () => {
  assert.equal(goalBarAutoCollapsed(undefined), true);
  assert.equal(goalBarAutoCollapsed("complete"), true);
  assert.equal(goalBarAutoCollapsed("active"), false);
  assert.equal(goalBarAutoCollapsed("paused"), false);
  assert.equal(goalBarAutoCollapsed("blocked"), false);
});

test("the first loaded Goal follows its phase instead of staying collapsed", () => {
  assert.equal(nextGoalBarState({ state: emptyGoalBarState(), projectionLoaded: true, goalId: "g1", phase: "active" }).collapsed, false);
  assert.equal(nextGoalBarState({ state: emptyGoalBarState(), projectionLoaded: true, goalId: "g1", phase: "paused" }).collapsed, false);
  assert.equal(nextGoalBarState({ state: emptyGoalBarState(), projectionLoaded: true, goalId: null, phase: undefined }).collapsed, true);
});

test("an unloaded projection keeps the current collapse state", () => {
  const next = nextGoalBarState({ state: loaded("g1", "active"), projectionLoaded: false, goalId: null, phase: undefined });
  assert.equal(next.collapsed, null);
});

test("a new Goal identity re-decides the expanded state", () => {
  assert.equal(nextGoalBarState({ state: loaded("g1", "complete"), projectionLoaded: true, goalId: "g2", phase: "active" }).collapsed, false);
  assert.equal(nextGoalBarState({ state: loaded("g1", "active"), projectionLoaded: true, goalId: "g2", phase: "complete" }).collapsed, true);
});

test("ordinary phase changes keep the user's manual collapse", () => {
  assert.equal(nextGoalBarState({ state: loaded("g1", "active"), projectionLoaded: true, goalId: "g1", phase: "paused" }).collapsed, null);
  assert.equal(nextGoalBarState({ state: loaded("g1", "paused"), projectionLoaded: true, goalId: "g1", phase: "paused" }).collapsed, null);
});

test("blocked and complete phases force their own visibility", () => {
  assert.equal(nextGoalBarState({ state: loaded("g1", "active"), projectionLoaded: true, goalId: "g1", phase: "blocked" }).collapsed, false);
  assert.equal(nextGoalBarState({ state: loaded("g1", "active"), projectionLoaded: true, goalId: "g1", phase: "complete" }).collapsed, true);
  assert.equal(nextGoalBarState({ state: loaded("g1", "complete"), projectionLoaded: true, goalId: "g1", phase: "active" }).collapsed, false);
});

test("a forced decision is remembered so it is not repeated", () => {
  const next = nextGoalBarState({ state: loaded("g1", "active"), projectionLoaded: true, goalId: "g1", phase: "blocked" });
  assert.deepEqual(next, { initialized: true, goalId: "g1", phase: "blocked", collapsed: false });
  assert.equal(nextGoalBarState({ state: next, projectionLoaded: true, goalId: "g1", phase: "blocked" }).collapsed, null);
});
