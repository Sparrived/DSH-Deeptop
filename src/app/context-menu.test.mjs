import assert from "node:assert/strict";
import test from "node:test";
import { isWithinSelector, positionFloatingMenu, OWNED_CONTEXT_MENU_SELECTOR, FLOATING_CONTEXT_MENU_SELECTOR } from "./context-menu.ts";

function targetMatching(selectorPart) {
  return {
    closest(selector) {
      return selector.includes(selectorPart) ? this : null;
    },
  };
}

test("recognizes file and task rows plus their portal menus as owned context targets", () => {
  assert.equal(isWithinSelector(targetMatching(".workspace-file-main"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-files-context-menu"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-row"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-group-header"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-item"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-context-menu"), OWNED_CONTEXT_MENU_SELECTOR), true);
});

test("does not exempt unrelated targets from the native context-menu suppression", () => {
  assert.equal(isWithinSelector(targetMatching(".conversation-panel"), OWNED_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(null, OWNED_CONTEXT_MENU_SELECTOR), false);
});

test("recognizes every floating right-click menu the dock must not treat as outside", () => {
  assert.equal(isWithinSelector(targetMatching(".session-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-files-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
});

test("floating context-menu selector does not exempt non-menu surfaces", () => {
  assert.equal(isWithinSelector(targetMatching(".conversation-panel"), FLOATING_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(targetMatching(".workspace-file-main"), FLOATING_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(targetMatching(".task-item"), FLOATING_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(null, FLOATING_CONTEXT_MENU_SELECTOR), false);
});

test("keeps the menu downward when the space below the cursor is enough", () => {
  assert.deepEqual(positionFloatingMenu(600, 300, 200, 260, 900, 900), { left: 600, top: 300 });
});

test("flips upward when the space below is not enough and above suffices", () => {
  // 光标 y=700，下方仅剩 190px，不足以放下 260px 高的菜单；底部对齐光标向上展开。
  assert.deepEqual(positionFloatingMenu(600, 700, 200, 260, 900, 900), { left: 600, top: 440 });
});

test("clamps left into the viewport when the menu would overflow the right edge", () => {
  assert.deepEqual(positionFloatingMenu(880, 300, 200, 260, 900, 900), { left: 690, top: 300 });
});

test("keeps the viewport padding at the left and top edges", () => {
  assert.deepEqual(positionFloatingMenu(3, 4, 200, 260, 900, 900), { left: 10, top: 10 });
});

test("keeps the menu inside the window when neither direction has enough room", () => {
  // 菜单高于窗口（含间距），只能贴顶显示，不允许负坐标。
  assert.deepEqual(positionFloatingMenu(400, 500, 200, 1300, 900, 900), { left: 400, top: 10 });
  // 光标贴近底部且上方也放不下完整菜单时，限制在窗口内而不是跟随光标裁切。
  assert.deepEqual(positionFloatingMenu(400, 890, 200, 1000, 900, 900), { left: 400, top: 10 });
});

test("fits a menu wider than the viewport with padding", () => {
  assert.deepEqual(positionFloatingMenu(450, 300, 1000, 260, 900, 900), { left: 10, top: 300 });
});
