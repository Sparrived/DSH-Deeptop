import assert from "node:assert/strict";
import test from "node:test";
import {
  PIN_LAYER_MAX_WIDTH,
  PIN_LAYER_MIN_WIDTH,
  PINNABLE_DOCKS,
  clampPinLayerWidth,
  computePinLayerWidths,
  isDockPinned,
  isValidDockId,
  normalizePinnedDocks,
  resolvePinLayerWidths,
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
    {},
  );
});

test("toggles pins without mutating the input and drops falsy entries", () => {
  const original = { "git-dock": true };
  const added = withDockPinned(original, "terminal-dock", true);
  assert.deepEqual(added, { "git-dock": true, "terminal-dock": true });
  assert.deepEqual(original, { "git-dock": true });

  const removed = withDockPinned(added, "git-dock", false);
  assert.deepEqual(removed, { "terminal-dock": true });
  assert.deepEqual(withDockPinned(added, "not-a-dock", true), added);
  assert.equal(isDockPinned(removed, "git-dock"), false);
  assert.equal(withDockPinned(added, "todo-dock", true), added);
  assert.equal(PINNABLE_DOCKS.length, 3);
});

test("pinned expanded docks contribute their column width to their side", () => {
  const widths = computePinLayerWidths({
    pinned: { "git-dock": true },
    expandedById: { "git-dock": true },
  });
  assert.deepEqual(widths, { left: 600, right: 0 });
});

test("sums expanded left docks and ignores removed right utility docks", () => {
  const widths = computePinLayerWidths({
    pinned: { "todo-dock": true, "terminal-dock": true, "workspace-files-dock": true, "git-dock": true },
    expandedById: { "todo-dock": true, "terminal-dock": true, "workspace-files-dock": false, "git-dock": true },
  });
  assert.deepEqual(widths, { left: 560 + 600, right: 0 });
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

test("clamps custom layer widths into the allowed range", () => {
  assert.equal(clampPinLayerWidth(420), 420);
  assert.equal(clampPinLayerWidth(10), PIN_LAYER_MIN_WIDTH);
  assert.equal(clampPinLayerWidth(99_999), PIN_LAYER_MAX_WIDTH);
  assert.equal(clampPinLayerWidth(480.6), 481);
  assert.equal(clampPinLayerWidth("300"), null);
  assert.equal(clampPinLayerWidth(Number.NaN), null);
  assert.equal(clampPinLayerWidth(undefined), null);
});

test("custom widths only apply to active sides and fall back to defaults", () => {
  const computed = computePinLayerWidths({
    pinned: { "git-dock": true },
    expandedById: { "git-dock": true },
  });
  assert.deepEqual(computed, { left: 600, right: 0 });
  // 拖拽后的自定义宽度覆盖默认求和。
  assert.deepEqual(
    resolvePinLayerWidths({ computed, custom: { left: 360 } }),
    { left: 360, right: 0 },
  );
  // 没有激活分栏时忽略自定义宽度，避免空层占位。
  const inactiveLeft = computePinLayerWidths({ pinned: {}, expandedById: { "git-dock": true } });
  assert.deepEqual(
    resolvePinLayerWidths({ computed: inactiveLeft, custom: { left: 360 } }),
    { left: 0, right: 0 },
  );
  // 缺失或越界的自定义值回退到默认宽度。
  assert.deepEqual(
    resolvePinLayerWidths({ computed, custom: {} }),
    { left: 600, right: 0 },
  );
  assert.deepEqual(
    resolvePinLayerWidths({ computed, custom: { left: 1_000_000, right: -5 } }),
    { left: PIN_LAYER_MAX_WIDTH, right: 0 },
  );
});
