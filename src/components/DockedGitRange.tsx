import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { listGitRange, type WorkspaceGitCommit } from "../lib/desktop";
import { errorText } from "../app/model";
import { formatRelativeTime } from "../app/git-model";
import { useDockSettings } from "../app/dock-settings";
import { t, type UiLocale } from "../app/i18n";

/**
 * 右栏的 `git-range` 内容标签：列出 `base..head` 之间的提交
 * （incoming = 远端有而我没有；outgoing = 我有而远端没有）。
 * 点一行直接开对应的 `git-commit` 标签，沿用 Phase 2 的提交详情视图。
 */
export type DockedGitRangeProps = {
  cwd: string;
  base: string;
  head: string;
  locale?: UiLocale;
  onError: (message: string) => void;
};

export function DockedGitRange({ cwd, base, head, locale = "zh", onError }: DockedGitRangeProps) {
  const { openTab } = useDockSettings();
  const [commits, setCommits] = useState<WorkspaceGitCommit[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listGitRange(cwd, base, head, 100)
      .then((next) => {
        if (active) setCommits(next);
      })
      .catch((failure) => {
        if (!active) return;
        setCommits(null);
        onError(t("git.error.readRangeFailed", locale, { error: errorText(failure, locale) }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, base, head, locale, onError]);

  function openCommit(commit: WorkspaceGitCommit) {
    openTab({
      kind: "git-commit",
      title: commit.subject || commit.shortHash,
      detail: commit.shortHash,
      contentKey: `commit:${commit.hash}`,
      payload: { cwd, hash: commit.hash },
    });
  }

  return (
    <div className="dock-git-range">
      <div className="git-diff-header">
        <span className="git-diff-path" title={`${base}..${head}`}>
          {base.slice(0, 7)}..{head.slice(0, 7)}
        </span>
        <span className="git-range-count">
          {commits ? t("git.rangeCount", locale, { count: commits.length }) : ""}
        </span>
      </div>
      {loading && commits === null ? (
        <div className="git-empty">{t("git.loadingRange", locale)}</div>
      ) : !commits || commits.length === 0 ? (
        <div className="git-empty">{t("git.emptyRange", locale)}</div>
      ) : (
        <div className="git-history-list dock-git-range-list">
          {commits.map((commit) => (
            <button
              key={commit.hash}
              type="button"
              className="git-commit-row"
              onClick={() => openCommit(commit)}
              title={t("git.rangeOpenCommit", locale, { subject: commit.subject })}
            >
              <span className="git-commit-short">{commit.shortHash}</span>
              <span className="git-commit-main">
                <span className="git-commit-subject">{commit.subject}</span>
                <span className="git-commit-meta">{commit.author} · {formatRelativeTime(commit.timestamp, undefined, locale)}</span>
              </span>
              <ArrowUpRight className="git-range-open-icon" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
