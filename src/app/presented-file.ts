/**
 * 交付文件卡片的应用内动作模型。
 *
 * 卡片主体预览既定文件（第 2 条），旁挂的 chevron 菜单提供两个原生动作：
 * 用默认应用打开、在文件管理器中显示。文件管理器名称由原生桥接声明为
 * `finder | explorer | directory`，不从 WebView 推断操作系统（上游
 * `ui-deliverables/src/presented.ts` 的 `PresentedHost`）。
 *
 * 阶段状态按「被查看会话 + 文件路径」记账，因此切换会话不会串台，重放
 * 同一动作会覆盖上一条状态而不是叠加。
 */

import type { PresentedFileManager } from "../lib/desktop";

/** 卡片菜单里的原生动作。 */
export type PresentedAction = "open" | "reveal";

/** 一次原生动作的阶段；`undefined` 表示尚未执行过。 */
export type PresentedOpenPhase = "opening" | "opened" | "revealing" | "revealed" | "error" | "revealError";

/** 原生宿主元数据；`null` 表示当前没有可用的原生宿主，菜单因此禁用。 */
export type PresentedHost = { fileManager: PresentedFileManager };

/** 阶段键：同一路径在不同会话里是两份独立状态。 */
export function presentedPhaseKey(sessionId: string | null | undefined, path: string): string {
  return `${sessionId ?? ""}::${path}`;
}

/** 动作仍在进行中：卡片显示进度，且不接受第二次点击。 */
export function presentedPending(phase: PresentedOpenPhase | undefined): boolean {
  return phase === "opening" || phase === "revealing";
}

/** 没有原生宿主或动作进行中时，菜单按钮与其条目都不可用。 */
export function presentedMenuDisabled(phase: PresentedOpenPhase | undefined, host: PresentedHost | null): boolean {
  return host === null || presentedPending(phase);
}

/** 阶段文案的键；`manager` 为真时组件用宿主文件管理器名称补齐 `{manager}`。 */
export function presentedStatusKey(
  phase: PresentedOpenPhase | undefined,
  fileManager: PresentedFileManager,
): { key: string; manager?: boolean } | null {
  const generic = fileManager === "directory";
  switch (phase) {
    case undefined:
      return null;
    case "opening":
      return { key: "deliverables.phase.opening" };
    case "opened":
      return { key: "deliverables.phase.opened" };
    case "error":
      return { key: "deliverables.phase.error" };
    case "revealError":
      return { key: "deliverables.phase.revealError" };
    case "revealing":
      return generic ? { key: "deliverables.phase.revealing" } : { key: "deliverables.phase.revealingNamed", manager: true };
    case "revealed":
      return generic ? { key: "deliverables.phase.revealed" } : { key: "deliverables.phase.revealedNamed", manager: true };
  }
}

/** 失败状态在卡片上以错误色显示。 */
export function presentedStatusIsError(phase: PresentedOpenPhase | undefined): boolean {
  return phase === "error" || phase === "revealError";
}

/** 文件管理器名称的文案键。 */
export function presentedFileManagerKey(fileManager: PresentedFileManager): string {
  switch (fileManager) {
    case "finder":
      return "deliverables.fileManager.finder";
    case "explorer":
      return "deliverables.fileManager.explorer";
    case "directory":
      return "deliverables.fileManager.directory";
  }
}
