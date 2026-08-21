export const WORKSPACE_FILES_CONTEXT_MENU_SELECTOR = ".workspace-files-context-menu";

export const TASK_CONTEXT_MENU_SELECTOR = ".task-context-menu";

export const OWNED_CONTEXT_MENU_SELECTOR = [
  ".session-row",
  ".workspace-row",
  ".workspace-group-header",
  ".workspace-file-main",
  ".task-item",
  WORKSPACE_FILES_CONTEXT_MENU_SELECTOR,
  TASK_CONTEXT_MENU_SELECTOR,
].join(", ");

/** 应用自有的浮动右键菜单容器。这些菜单通过 createPortal 渲染到 document.body，
 *  物理位置不在触发它的 Dock/控件内，但属于交互上下文，不应计为“外部点击”。 */
export const FLOATING_CONTEXT_MENU_SELECTOR = [
  ".session-context-menu",
  ".workspace-context-menu",
  ".workspace-files-context-menu",
  ".task-context-menu",
].join(", ");

/** 判断原生事件目标是否位于应用自有的右键菜单触发区域内。 */
export function isWithinSelector(target: EventTarget | null, selector: string): boolean {
  if (!target || typeof target !== "object") return false;
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") return false;
  return Boolean((closest as (value: string) => unknown).call(target, selector));
}

export type FloatingMenuPosition = { left: number; top: number };

/** 浮动右键菜单与视口边缘之间保留的最小间距。 */
export const MENU_VIEWPORT_PADDING = 10;

/** 计算浮动右键菜单在视口内的最终位置。默认以光标为左上角向下展开；
 *  下方空间不足时切换为向上展开（菜单底边对齐光标），两个方向都限制在视口内并保留间距，
 *  保证菜单完整显示在窗体内、不被裁切。 */
export function positionFloatingMenu(
  cursorX: number,
  cursorY: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = MENU_VIEWPORT_PADDING,
): FloatingMenuPosition {
  const maxLeft = Math.max(padding, viewportWidth - menuWidth - padding);
  const left = Math.min(Math.max(cursorX, padding), maxLeft);
  const spaceBelow = viewportHeight - cursorY - padding;
  const spaceAbove = cursorY - padding;
  const flipsUp = spaceBelow < menuHeight && spaceAbove >= menuHeight;
  const preferredTop = flipsUp ? cursorY - menuHeight : cursorY;
  const maxTop = Math.max(padding, viewportHeight - menuHeight - padding);
  const top = Math.min(Math.max(preferredTop, padding), maxTop);
  return { left, top };
}
