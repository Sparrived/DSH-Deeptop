// 冲突解决的纯投影：把三方内容组合成"解决结果"、统计剩余冲突标记。
// 不调用 React / Tauri / Bridge，可在 Node 测试中直接导入。

import type { WorkspaceGitConflict } from "../lib/desktop";

/** 可一键采用的解决方向（基础版本只用于查看，不作为结果）。 */
export type GitConflictSide = "ours" | "theirs" | "both";

/** 三方视图里可以选择查看的内容来源。 */
export type GitConflictView = "result" | "ours" | "theirs" | "base";

/** 某一侧是否有内容可用（缺失表示该侧没有版本，例如文件被删除）。 */
export function conflictSideAvailability(
  conflict: Pick<WorkspaceGitConflict, "base" | "ours" | "theirs">,
): Record<"base" | "ours" | "theirs", boolean> {
  return {
    base: conflict.base !== null,
    ours: conflict.ours !== null,
    theirs: conflict.theirs !== null,
  };
}

/** 补上结尾换行：拼接两侧内容时保证不会把两行粘在一起。 */
function withTrailingNewline(text: string): string {
  if (text.length === 0) return text;
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * 按选择组合解决内容：
 * - `ours` / `theirs`：直接取该侧文本（缺失按空串处理）；
 * - `both`：当前版本在前、传入版本在后，中间保证有换行分隔。
 */
export function conflictResolutionContent(
  side: GitConflictSide,
  conflict: Pick<WorkspaceGitConflict, "base" | "ours" | "theirs">,
): string {
  const ours = conflict.ours ?? "";
  const theirs = conflict.theirs ?? "";
  if (side === "ours") return ours;
  if (side === "theirs") return theirs;
  if (ours.length === 0) return theirs;
  if (theirs.length === 0) return ours;
  return `${withTrailingNewline(ours)}${theirs}`;
}

/** 统计还剩多少处未解决的冲突标记（以 `<<<<<<<` 起始行计）。 */
export function countConflictMarkers(text: string | null): number {
  if (!text) return 0;
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("<<<<<<<")) count += 1;
  }
  return count;
}

/** 三方内容里 git 自动合并后的"结果"草稿：工作区内容缺失时退化为空串。 */
export function initialConflictDraft(conflict: Pick<WorkspaceGitConflict, "worktree">): string {
  return conflict.worktree ?? "";
}
