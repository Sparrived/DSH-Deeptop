// Git dock 的纯投影模型：只做派生与格式化，不调用 Bridge / React / Tauri。

import type { WorkspaceGitBranch, WorkspaceGitFile } from "../lib/desktop";
import type { UiLocale } from "./i18n.ts";

export type GitFileState = "conflicted" | "staged" | "unstaged" | "untracked";

/** 按文件在暂存区/工作区的状态归入单一分组。 */
export function gitFileState(file: WorkspaceGitFile): GitFileState {
  if (file.status === "untracked") return "untracked";
  if (file.status === "conflicted") return "conflicted";
  if (file.status === "staged" || file.status === "staged-changed") return "staged";
  return "unstaged";
}

export type GitFileGroups = Record<GitFileState, WorkspaceGitFile[]>;

/** 保持输入顺序地把文件分到 冲突 / 暂存 / 工作区 / 未跟踪 四组。 */
export function groupGitFiles(files: WorkspaceGitFile[]): GitFileGroups {
  const groups: GitFileGroups = { conflicted: [], staged: [], unstaged: [], untracked: [] };
  for (const file of files) {
    const key = gitFileState(file);
    groups[key].push(file);
  }
  return groups;
}

/** 该文件能否执行“暂存”动作（未跟踪、工作区修改或冲突待解决）。 */
export function canStageFile(file: WorkspaceGitFile): boolean {
  return gitFileState(file) === "unstaged" || gitFileState(file) === "untracked" || gitFileState(file) === "conflicted";
}

/** 该文件能否执行“取消暂存”动作。 */
export function canUnstageFile(file: WorkspaceGitFile): boolean {
  return gitFileState(file) === "staged";
}

/** 文件行内标记（? ! R A D M），与文件看板一致。 */
export function gitFileMark(file: WorkspaceGitFile): string {
  if (file.status === "untracked") return "?";
  if (file.status === "conflicted") return "!";
  if (file.isRenamed) return "R";
  if (file.code.includes("A")) return "A";
  if (file.code.includes("D")) return "D";
  return "M";
}

/** 文件状态文案。 */
const GIT_FILE_LABELS: Record<string, { zh: string; en: string }> = {
  untracked: { zh: "未跟踪", en: "Untracked" },
  conflicted: { zh: "冲突", en: "Conflicted" },
  renamed: { zh: "已重命名", en: "Renamed" },
  deleted: { zh: "已删除", en: "Deleted" },
  added: { zh: "已添加", en: "Added" },
  staged: { zh: "已暂存", en: "Staged" },
  stagedChanged: { zh: "暂存 + 修改", en: "Staged + modified" },
  modified: { zh: "已修改", en: "Modified" },
};

function localeText(pair: { zh: string; en: string }, locale: UiLocale): string {
  return locale === "en" ? pair.en : pair.zh;
}

/** 文件状态说明。 */
export function gitFileLabel(file: WorkspaceGitFile, locale: UiLocale = "zh"): string {
  const key =
    file.status === "untracked" ? "untracked"
    : file.status === "conflicted" ? "conflicted"
    : file.isRenamed ? "renamed"
    : file.code.includes("D") ? "deleted"
    : file.code.includes("A") ? "added"
    : file.status === "staged" ? "staged"
    : file.status === "staged-changed" ? "stagedChanged"
    : "modified";
  return localeText(GIT_FILE_LABELS[key], locale);
}

export type DiffLineKind = "meta" | "hunk" | "add" | "remove" | "context";

/** 给统一 diff 的每一行分类，用于高亮。 */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("new file mode")
    || line.startsWith("deleted file mode") || line.startsWith("similarity index")
    || line.startsWith("rename ") || line.startsWith("Binary files") || line.startsWith("Cannot display")
    || line.startsWith("\\ No newline") || line === "--") return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

/** 把 unix 秒时间格式化为相对时间。 */
export function formatRelativeTime(unixSeconds: number, now = Date.now(), locale: UiLocale = "zh"): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const elapsedSeconds = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (elapsedSeconds < 60) return locale === "en" ? "just now" : "刚刚";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return locale === "en" ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "en" ? `${hours} hr ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return locale === "en" ? "yesterday" : "昨天";
  if (days < 30) return locale === "en" ? `${days} days ago` : `${days} 天前`;
  const date = new Date(unixSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type GitBranchGroups = { local: WorkspaceGitBranch[]; remote: WorkspaceGitBranch[] };

/** 把分支列表分成 本地 / 远程 两组（远程按 origin/x 保留远程名）。 */
export function groupGitBranches(branches: WorkspaceGitBranch[]): GitBranchGroups {
  const local: WorkspaceGitBranch[] = [];
  const remote: WorkspaceGitBranch[] = [];
  for (const branch of branches) {
    (branch.isRemote ? remote : local).push(branch);
  }
  return { local, remote };
}

/** 提交图谱车道配色：按列索引循环取色，让连续车道在同一列上保持同色。 */
export const GIT_GRAPH_LANE_COLORS = [
  "#f5d99b", // 金色
  "#8ab4f8", // 蓝色
  "#ff7b72", // 红色
  "#79d8a8", // 绿色
  "#d2a8ff", // 紫色
  "#79d8d8", // 青色
] as const;

export function gitGraphLaneColor(column: number): string {
  const palette = GIT_GRAPH_LANE_COLORS;
  const index = ((column % palette.length) + palette.length) % palette.length;
  return palette[index];
}

export type GitRefKind = "head" | "tag" | "branch";

/** 分类 git `%D` 装饰引用。仅凭装饰文本无法可靠区分本地与远程分支
 *（本地分支也允许包含 `/`），因此只分 当前分支指向 / 标签 / 其他引用。 */
export function gitRefKind(ref: string): GitRefKind {
  const trimmed = ref.trim();
  if (trimmed.startsWith("HEAD")) return "head";
  if (trimmed.startsWith("tag:")) return "tag";
  return "branch";
}
