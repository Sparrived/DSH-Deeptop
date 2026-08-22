import assert from "node:assert/strict";
import test from "node:test";
import {
  PINNABLE_DOCKS,
  computeConversationPadding,
  hasConversationPadding,
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

test("pinned expanded docks reserve shelf inset, rail, gap and column width per side", () => {
  const padding = computeConversationPadding({
    pinned: { "git-dock": true },
    expandedById: { "git-dock": true },
    todoVisible: false,
    todoCollapsed: true,
  });
  // git：货架内缩 16 + 轨道 44 + 间距 12 + 分栏 600
  assert.deepEqual(padding, { left: 16 + 44 + 12 + 600, right: 0 });
});

test("sums multiple pinned docks on the same side and skips collapsed ones", () => {
  const padding = computeConversationPadding({
    pinned: { "todo-dock": true, "subagent-dock": true, "terminal-dock": true },
    expandedById: { "todo-dock": true, "subagent-dock": false, "terminal-dock": true },
    todoVisible: true,
    todoCollapsed: false,
  });
  // 右侧只算展开的 todo（16 + 44 + 12 + 286），收起的 subagent 不占位；
  // terminal 钉住展开在左侧；todo 已钉住展开，旧规则不再叠加。
  assert.deepEqual(padding, { left: 16 + 44 + 12 + 560, right: 16 + 44 + 12 + 286 });
});

test("keeps the legacy todo padding when nothing is pinned", () => {
  const expanded = computeConversationPadding({
    pinned: {},
    expandedById: {},
    todoVisible: true,
    todoCollapsed: false,
  });
  assert.deepEqual(expanded, { left: 0, right: 286 + 32 });

  const collapsed = computeConversationPadding({
    pinned: {},
    expandedById: {},
    todoVisible: true,
    todoCollapsed: true,
  });
  assert.deepEqual(collapsed, { left: 0, right: 44 + 32 });
  assert.equal(hasConversationPadding(collapsed), true);
});

test("legacy todo padding still applies when an unrelated dock is pinned", () => {
  const padding = computeConversationPadding({
    pinned: { "deliverables-dock": true },
    expandedById: { "deliverables-dock": true },
    todoVisible: true,
    todoCollapsed: false,
  });
  // deliverables 分栏（16 + 44 + 12 + 286）+ 旧 todo 让位 318
  assert.deepEqual(padding, { left: 0, right: 16 + 44 + 12 + 286 + 286 + 32 });
});

test("collapsed pinned todo falls back to the legacy collapsed reserve", () => {
  const padding = computeConversationPadding({
    pinned: { "todo-dock": true },
    expandedById: {},
    todoVisible: true,
    todoCollapsed: true,
  });
  assert.deepEqual(padding, { left: 0, right: 44 + 32 });
});

test("reports whether any reservation exists", () => {
  assert.equal(hasConversationPadding({ left: 0, right: 0 }), false);
  assert.equal(hasConversationPadding({ left: 12, right: 0 }), true);
});
