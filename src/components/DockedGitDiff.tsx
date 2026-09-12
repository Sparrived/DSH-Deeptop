import { useEffect, useState } from "react";
import { applyGitPatch, getGitFileDiff } from "../lib/desktop";
import { errorText } from "../app/model";
import { buildHunkPatch, parseGitDiff } from "../app/git-diff";
import { notifyGitChanged } from "../app/git-events";
import { t, type UiLocale } from "../app/i18n";
import { GitDiffBody } from "./GitDiffBody";

/**
 * 右栏的 `git-diff` 内容标签：工作区 / 暂存区单个文件的差异，支持 hunk 级暂存。
 * 初始来源来自标签载荷，标签内可以再切换，用于和变更列表、图谱并排对照。
 * 暂存后广播 `git-changed`，左侧 Dock 面板据此刷新自己的投影。
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
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);

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
  }, [cwd, path, worktreeStaged, locale, onError, revision]);

  async function applyHunks(hunkLines: number[]) {
    const patch = buildHunkPatch(parseGitDiff(text ?? ""), hunkLines);
    if (!patch) return;
    setBusy(true);
    try {
      await applyGitPatch(cwd, patch, true, worktreeStaged);
    } catch (failure) {
      onError(t("git.error.applyPatchFailed", locale, { error: errorText(failure, locale) }));
    } finally {
      setBusy(false);
      notifyGitChanged("diff");
      setRevision((current) => current + 1);
    }
  }

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
        <GitDiffBody
          text={text}
          locale={locale}
          renderHunkAction={(hunk) => (
            <button type="button" disabled={busy} onClick={() => void applyHunks([hunk.line])}>
              {worktreeStaged ? t("git.unstageHunk", locale) : t("git.stageHunk", locale)}
            </button>
          )}
        />
      )}
    </div>
  );
}
