import { useEffect, useState } from "react";
import { getGitCommitFileDiff } from "../lib/desktop";
import { errorText } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { GitDiffBody } from "./GitDiffBody";

/**
 * 右栏的 `git-commit-file` 内容标签：某个提交里单个文件的差异。
 * 图谱里展开的提交行点文件时打开它——与右栏的其它标签并排查阅，
 * 而不是把差异塞进列表行里。
 */
export type DockedGitCommitFileProps = {
  cwd: string;
  hash: string;
  path: string;
  locale?: UiLocale;
  onError: (message: string) => void;
};

export function DockedGitCommitFile({ cwd, hash, path, locale = "zh", onError }: DockedGitCommitFileProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getGitCommitFileDiff(cwd, hash, path)
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
  }, [cwd, hash, path, locale, onError]);

  return (
    <div className="dock-git-diff">
      <div className="git-diff-header">
        <span className="git-diff-path" title={path}>{path}</span>
        <span className="git-range-count">{hash.slice(0, 7)}</span>
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
