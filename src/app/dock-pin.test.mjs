import assert from "node:assert/strict";
import test from "node:test";
import {
  PINNABLE_DOCKS,
  computePinLayerWidths,
  isDockPinned,
  isValidDockId,
  normalizePinnedDocks,
  withDockPinned,
} from "./dock-pin.ts";

test("validates dock ids with the same rules as the Rust bridge", () => {
  assert.equal(isValidDockId("terminal-dock"), true);
  assert.equal(isValidDockId("a".repeat(100)), true);
  assert.equal(isValidDockId(""), false);
  assert.equal(isValidDockId("bad id"), false);
  assert.equal(isValidDockId("x".repeat(101)), false);
  assert.equal(isValidDockId(42), false);
});

test("normalizes pinned maps by dropping unknown ids and non-boolean values", () => {
  assert.deepEqual(normalizePinnedDocks(null), {});
  assert.deepEqual(normalizePinnedDocks("nope"), {});
  assert.deepEqual(
    normalizePinnedDocks({ "todo-dock": true, "unknown-dock": true, "git-dock": "yes", bad: true }),
    { "todo-dock": true },
  );
});

test("toggles pins without mutating the input and drops falsy entries", () => {
  const original = { "todo-dock": true };
  const added = withDockPinned(original, "git-dock", true);
  assert.deepEqual(added, { "todo-dock": true, "git-dock": true });
  assert.deepEqual(original, { "todo-dock": true });

  const removed = withDockPinned(added, "todo-dock", false);
  assert.deepEqual(removed, { "git-dock": true });
  assert.deepEqual(withDockPinned(added, "not-a-dock", true), added);
  assert.equal(isDockPinned(removed, "todo-dock"), false);
  assert.ok(PINNABLE_DOCKS.length >= 7);
});

test("pinned expanded docks contribute their column width to their side", () => {
  const widths = computePinLayerWidths({
    pinned: { "git-dock": true },
    expandedById: { "git-dock": true },
  });
  assert.deepEqual(widths, { left: 600, right: 0 });
});

test("sums multiple pinned docks per side and skips collapsed ones", () => {
  const widths = computePinLayerWidths({
    pinned: { "todo-dock": true, "subagent-dock": true, "terminal-dock": true, "git-dock": true },
    expandedById: { "todo-dock": true, "subagent-dock": false, "terminal-dock": true, "git-dock": true },
  });
  // 收起的 subagent 不占位；左侧 terminal+git，右侧 todo。
  assert.deepEqual(widths, { left: 560 + 600, right: 286 });
});

test("pinned but collapsed docks occupy no width", () => {
  const widths = computePinLayerWidths({
    pinned: { "terminal-dock": true, "deliverables-dock": true },
    expandedById: {},
  });
  assert.deepEqual(widths, { left: 0, right: 0 });
});

test("unpinned expanded docks are ignored", () => {
  const widths = computePinLayerWidths({
    pinned: {},
    expandedById: { "git-dock": true, "todo-dock": true },
  });
  assert.deepEqual(widths, { left: 0, right: 0 });
});
