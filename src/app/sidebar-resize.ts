/**
 * 侧栏宽度拖拽的纯计算。
 *
 * 侧栏宽度是 .workspace-layout 的第一条网格轨道：拖拽期间每一帧都改 React
 * 状态会让整棵对话树跟着重渲染，展开中的思考块还要重新排版，于是拖动分隔线
 * 时对话区明显卡顿。因此这里只提供取值计算，App 在拖拽期间把实时宽度写进
 * CSS 变量，松手才提交一次状态。
 *
 * 宽度的下限、上限与默认值集中在这里，避免拖拽、初始读取与设置面板各写一份。
 */

/** localStorage 中的侧栏宽度偏好键；与 deeptop.sidebar-collapsed 分开保存。 */
export const SIDEBAR_WIDTH_STORAGE_KEY = "deeptop.sidebar-width";

export const SIDEBAR_WIDTH_MIN = 300;
export const SIDEBAR_WIDTH_MAX = 440;
export const SIDEBAR_WIDTH_DEFAULT = 320;

/** 拖拽期间的实时宽度；只写在 .workspace-layout 的内联样式上，不进 React 状态。 */
export const SIDEBAR_DRAG_WIDTH_VAR = "--sidebar-drag-width";

/** 收敛任意来源的宽度到合法区间；非有限值（缺失或损坏的偏好）回落到默认宽度。 */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}

/** 指针相对按下点移动后的侧栏宽度。 */
export function sidebarWidthFromDrag(startWidth: number, startX: number, clientX: number): number {
  return clampSidebarWidth(startWidth + clientX - startX);
}
