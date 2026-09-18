// 侧栏拖拽的取值与拖拽路径契约。
//
// 回归背景：拖拽曾经逐帧调用 setSidebarWidth，根 App 每帧重渲染整棵对话树，
// 展开中的思考块还要跟着重新排版，于是在思考展开时拖侧栏明显卡顿。现在实时
// 宽度只写在 .workspace-layout 的 CSS 变量上，松手才提交一次状态。
// 这里既锁定纯计算，也用源码扫描锁住“pointermove 不再改状态”这条契约。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clampSidebarWidth,
  SIDEBAR_DRAG_WIDTH_VAR,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthFromDrag,
} from "./sidebar-resize.ts";

test("clamps any stored or dragged width into the usable range", () => {
  assert.equal(clampSidebarWidth(320), 320);
  assert.equal(clampSidebarWidth(SIDEBAR_WIDTH_MIN - 1), SIDEBAR_WIDTH_MIN);
  assert.equal(clampSidebarWidth(SIDEBAR_WIDTH_MAX + 1), SIDEBAR_WIDTH_MAX);
  // 缺失或损坏的偏好读出来是 NaN，必须回落到默认宽度而不是把侧栏拖没。
  assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_WIDTH_DEFAULT);
  assert.equal(clampSidebarWidth(Number.POSITIVE_INFINITY), SIDEBAR_WIDTH_DEFAULT);
});

test("follows the pointer offset from the press point, clamped", () => {
  assert.equal(sidebarWidthFromDrag(320, 500, 560), 380);
  assert.equal(sidebarWidthFromDrag(320, 500, 400), 300);
  // 超出上下限时停在边界，不把分隔线拖出可恢复的范围。
  assert.equal(sidebarWidthFromDrag(320, 500, 900), SIDEBAR_WIDTH_MAX);
  assert.equal(sidebarWidthFromDrag(320, 500, 0), SIDEBAR_WIDTH_MIN);
});

/** 切出拖拽 effect 的函数体（从 settle 到监听清理结束），用于锁定它的行为。 */
async function readDragEffect() {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const start = app.indexOf("const settle = (commit: boolean) => {");
  // 从 effect 起点往后找，避免命中窗口失焦装饰动画里同名的 handleBlur。
  const end = app.indexOf('window.removeEventListener("blur", handleBlur);', start);
  assert.ok(start > 0 && end > start, "the sidebar drag effect must stay in App.tsx");
  return { app, effect: app.slice(start, end) };
}

test("keeps the live width out of React state while the pointer moves", async () => {
  const { effect } = await readDragEffect();
  const moveHandler = /const handlePointerMove = [\s\S]*?\n    \};/.exec(effect)?.[0];
  assert.ok(moveHandler, "the pointermove handler must stay in the drag effect");
  // 这条断言就是本次卡顿的回归点：逐帧 setState 会重渲染整棵树。
  assert.doesNotMatch(moveHandler, /setSidebarWidth/);
  assert.match(moveHandler, /style\.setProperty\(SIDEBAR_DRAG_WIDTH_VAR/);
  assert.match(moveHandler, /sidebarWidthFromDrag\(/);
  // 实时宽度只写在网格变量上，状态只在松手时提交一次。
  assert.match(effect, /if \(commit\) setSidebarWidth\(resize\.preview\);/);
});

test("guards the drag by pointer id and aborts on cancel or focus loss", async () => {
  const { effect } = await readDragEffect();
  // 只响应发起拖拽的那个指针，多指触摸不会互相抢夺宽度。
  assert.match(effect, /event\.pointerId !== resize\.pointerId/);
  assert.match(effect, /document\.addEventListener\("pointercancel", handlePointerCancel\)/);
  assert.match(effect, /window\.addEventListener\("blur", handleBlur\)/);
  // 取消必须撤销而不是提交：半途宽度不能留在偏好里。
  assert.match(effect, /const handlePointerCancel = [\s\S]*?settle\(false\);/);
  assert.match(effect, /const handleBlur = \(\) => settle\(false\);/);
});

test("starts the drag only from a primary button press", async () => {
  const { app } = await readDragEffect();
  const downHandler = /onPointerDown=\{\(event\) => \{[\s\S]*?\n          \}\}/.exec(app)?.[0];
  assert.ok(downHandler, "the resizer pointerdown handler must stay in App.tsx");
  assert.match(downHandler, /if \(event\.button !== 0\) return;/);
  // 网格元素在按下时解析一次，拖拽期间不再重新查询。
  assert.match(downHandler, /closest\("\.workspace-layout"\)/);
  assert.match(downHandler, /document\.body\.classList\.add\("sidebar-resizing"\)/);
});

test("the layout consumes the drag variable for the column and the handle", async () => {
  const css = await readFile(new URL("../styles/15-final-overrides.css", import.meta.url), "utf8");
  assert.equal(SIDEBAR_DRAG_WIDTH_VAR, "--sidebar-drag-width");
  // 侧栏列与分隔线位置都要跟随实时宽度，否则手柄会停在松手前的位置。
  assert.match(css, /grid-template-columns:\s*var\(--sidebar-drag-width, var\(--sidebar-width/);
  assert.match(css, /\.sidebar-resizer\s*\{\s*left:\s*calc\(var\(--sidebar-drag-width, var\(--sidebar-width/);
});
