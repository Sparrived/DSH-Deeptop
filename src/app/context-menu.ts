export const WORKSPACE_FILES_CONTEXT_MENU_SELECTOR = ".workspace-files-context-menu";

export const TASK_CONTEXT_MENU_SELECTOR = ".task-context-menu";

export const OWNED_CONTEXT_MENU_SELECTOR = [
  ".session-row",
  ".workspace-group-row",
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
