export const WORKSPACE_FILES_CONTEXT_MENU_SELECTOR = ".workspace-files-context-menu";

export const TASK_CONTEXT_MENU_SELECTOR = ".task-context-menu";

export const OWNED_CONTEXT_MENU_SELECTOR = [
  ".session-row",
  ".workspace-group-header",
  ".workspace-file-main",
  ".task-item",
  WORKSPACE_FILES_CONTEXT_MENU_SELECTOR,
  TASK_CONTEXT_MENU_SELECTOR,
].join(", ");

/** 判断原生事件目标是否位于应用自有的右键菜单触发区域内。 */
export function isWithinSelector(target: EventTarget | null, selector: string): boolean {
  if (!target || typeof target !== "object") return false;
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") return false;
  return Boolean((closest as (value: string) => unknown).call(target, selector));
}
