import type { WorkspaceGitFileStat } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

/**
 * 提交改动的文件列表（路径 + 增删行数）。
 *
 * 两个宿主共用：右栏 `git-commit` 标签（点击在标签内展开差异）
 * 与图谱里展开的提交行（点击在右栏打开该文件的差异标签）。
 */
export type GitCommitFilesProps = {
  files: WorkspaceGitFileStat[];
  /** 当前高亮的文件（右栏标签内展开时用）。 */
  activePath?: string | null;
  onOpenFile: (path: string) => void;
  locale?: UiLocale;
};

export function GitCommitFiles({ files, activePath = null, onOpenFile, locale = "zh" }: GitCommitFilesProps) {
  return (
    <div className="git-commit-detail-files">
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          className={`git-commit-file-row ${activePath === file.path ? "active" : ""}`}
          onClick={() => onOpenFile(file.path)}
          title={t("git.viewFileDiff", locale, { path: file.path })}
        >
          <span className="git-commit-file-path" title={file.path}>{file.path}</span>
          <span className="git-commit-file-stats">
            {file.additions > 0 && <span className="git-stat-add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="git-stat-del">−{file.deletions}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
