import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  getGitCommitDetail,
  getGitCommitFileDiff,
  type WorkspaceGitCommitDetail,
} from "../lib/desktop";
import { errorText } from "../app/model";
import { formatRelativeTime } from "../app/git-model";
import { t, type UiLocale } from "../app/i18n";
import { GitCommitFiles } from "./GitCommitFiles";
import { GitDiffBody } from "./GitDiffBody";

/**
 * 提交详情视图：自己负责拉取提交信息与逐文件差异，宿主只需要给出哈希。
 *
 * 两个宿主共用它——左侧 Dock 面板的历史页与右栏的 `git-commit` 内容标签——
 * 因此刷新、错误提示与"逐文件展开"的行为只有一份实现。
 * 头部与动作行由宿主通过 `renderHeader` / `renderActions` 注入：
 * 动作会改动仓库并触发宿主自己的刷新，因此不放在这里。
 */
export type GitCommitDetailViewProps = {
  workspace: string;
  hash: string;
  locale?: UiLocale;
  onError: (message: string) => void;
  renderHeader?: (detail: WorkspaceGitCommitDetail) => ReactNode;
  renderActions?: (detail: WorkspaceGitCommitDetail) => ReactNode;
};

export function GitCommitDetailView({
  workspace,
  hash,
  locale = "zh",
  onError,
  renderHeader,
  renderActions,
}: GitCommitDetailViewProps) {
  const [detail, setDetail] = useState<WorkspaceGitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const diffRequestRef = useRef(0);

  useEffect(() => {
    const request = ++detailRequestRef.current;
    setLoading(true);
    setDetail(null);
    setDiffPath(null);
    setDiffText(null);
    setDiffError(null);
    void getGitCommitDetail(workspace, hash)
      .then((next) => {
        if (request === detailRequestRef.current) setDetail(next);
      })
      .catch((error) => {
        if (request !== detailRequestRef.current) return;
        onError(t("git.error.readDetailFailed", locale, { error: errorText(error, locale) }));
      })
      .finally(() => {
        if (request === detailRequestRef.current) setLoading(false);
      });
  }, [workspace, hash, locale, onError]);

  useEffect(() => {
    if (!diffPath) {
      setDiffText(null);
      setDiffError(null);
      return;
    }
    const request = ++diffRequestRef.current;
    setDiffLoading(true);
    setDiffError(null);
    let active = true;
    void getGitCommitFileDiff(workspace, hash, diffPath)
      .then((text) => {
        if (!active || request !== diffRequestRef.current) return;
        setDiffText(text);
      })
      .catch((error) => {
        if (!active || request !== diffRequestRef.current) return;
        setDiffText(null);
        setDiffError(errorText(error, locale));
      })
      .finally(() => {
        if (active && request === diffRequestRef.current) setDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [diffPath, workspace, hash, locale]);

  if (loading && !detail) {
    return <div className="git-empty">{t("git.loadingDetail", locale)}</div>;
  }
  if (!detail) {
    return <div className="git-empty">{t("git.error.readDetailFailed", locale, { error: t("git.emptyDiff", locale) })}</div>;
  }

  return (
    <div className="git-commit-detail">
      {renderHeader?.(detail) ?? (
        <div className="git-commit-detail-header">
          <span className="git-commit-short">{detail.hash.slice(0, 7)}</span>
          <span className="git-commit-subject">{detail.subject}</span>
        </div>
      )}
      <div className="git-commit-detail-meta">
        <span>{detail.author}</span>
        <span>{formatRelativeTime(detail.timestamp, undefined, locale)}</span>
        <span>{t("git.fileCount", locale, { count: detail.files.length })}</span>
      </div>
      {detail.body && <pre className="git-commit-detail-body">{detail.body}</pre>}
      <GitCommitFiles
        files={detail.files}
        activePath={diffPath}
        locale={locale}
        onOpenFile={(path) => setDiffPath((current) => (current === path ? null : path))}
      />
      {diffPath && (
        <div className="git-commit-diff">
          <div className="git-diff-header">
            <span className="git-diff-path" title={diffPath}>{diffPath}</span>
            <button type="button" className="git-diff-close" aria-label={t("git.closeFileDiff", locale)} onClick={() => setDiffPath(null)}><X aria-hidden="true" /></button>
          </div>
          {diffLoading ? (
            <div className="git-diff-empty">{t("git.loadingDiff", locale)}</div>
          ) : diffError ? (
            <div className="git-diff-empty">{diffError}</div>
          ) : (
            <GitDiffBody text={diffText} locale={locale} />
          )}
        </div>
      )}
      {renderActions && <div className="git-commit-detail-actions">{renderActions(detail)}</div>}
    </div>
  );
}
