// Git dock 的纯投影模型：只做派生与格式化，不调用 Bridge / React / Tauri。

import type { WorkspaceGitBranch, WorkspaceGitFile } from "../lib/desktop";

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

/** 文件状态的中文说明。 */
export function gitFileLabel(file: WorkspaceGitFile): string {
  if (file.status === "untracked") return "未跟踪";
  if (file.status === "conflicted") return "冲突";
  if (file.isRenamed) return "已重命名";
  if (file.code.includes("D")) return "已删除";
  if (file.code.includes("A")) return "已添加";
  if (file.status === "staged") return "已暂存";
  if (file.status === "staged-changed") return "暂存 + 修改";
  return "已修改";
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

/** 把 unix 秒时间格式化为相对中文时间。 */
export function formatRelativeTime(unixSeconds: number, now = Date.now()): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const elapsedSeconds = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (elapsedSeconds < 60) return "刚刚";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
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
