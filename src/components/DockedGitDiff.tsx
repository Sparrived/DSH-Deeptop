import { useEffect, useState } from "react";
import { getGitFileDiff } from "../lib/desktop";
import { errorText } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { GitDiffBody } from "./GitDiffBody";

/**
 * 右栏的 `git-diff` 内容标签：工作区 / 暂存区单个文件的差异。
 * 初始来源来自标签载荷，标签内可以再切换，用于和变更列表、图谱并排对照。
 */
export type DockedGitDiffProps = {
  cwd: string;
  path: string;
  staged: boolean;
  locale?: UiLocale;
  onError: (message: string) => void;
};

export function DockedGitDiff({ cwd, path, staged, locale = "zh", onError }: DockedGitDiffProps) {
  const [worktreeStaged, setWorktreeStaged] = useState(staged);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getGitFileDiff(cwd, path, worktreeStaged)
      .then((next) => {
        if (active) setText(next);
      })
      .catch((failure) => {
        if (!active) return;
        setText(null);
        setError(errorText(failure, locale));
        onError(t("git.error.readDiffFailed", locale, { error: errorText(failure, locale) }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, path, worktreeStaged, locale, onError]);

  return (
    <div className="dock-git-diff">
      <div className="git-diff-header">
        <span className="git-diff-path" title={path}>{path}</span>
        <div className="git-diff-mode" role="group" aria-label={t("git.diffSourceAria", locale)}>
          <button type="button" className={!worktreeStaged ? "selected" : ""} onClick={() => setWorktreeStaged(false)}>{t("git.diffWorktree", locale)}</button>
          <button type="button" className={worktreeStaged ? "selected" : ""} onClick={() => setWorktreeStaged(true)}>{t("git.diffStaged", locale)}</button>
        </div>
      </div>
      {loading ? (
        <div className="git-diff-empty">{t("git.loadingDiff", locale)}</div>
      ) : error ? (
        <div className="git-diff-empty">{error}</div>
      ) : (
        <GitDiffBody text={text} locale={locale} />
      )}
    </div>
  );
}
