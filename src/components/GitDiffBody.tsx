import type { ReactNode } from "react";
import { gitDiffLineKinds, parseGitDiff, type GitDiffHunk } from "../app/git-diff";
import { t, type UiLocale } from "../app/i18n";

/**
 * Git 统一差异的渲染：按行分类着色；空内容给出说明而不是留白。
 *
 * 传入 `renderHunkAction` 时会在每个 hunk 头上渲染一个动作按钮
 * （hunk 级暂存/取消暂存），此时行内改成"文本 + 动作"的弹性布局；
 * 不传时保持纯文本渲染，读起来与之前完全一致。
 */
export type GitDiffBodyProps = {
  text: string | null;
  locale?: UiLocale;
  renderHunkAction?: (hunk: GitDiffHunk, index: number) => ReactNode;
};

export function GitDiffBody({ text, locale = "zh", renderHunkAction }: GitDiffBodyProps) {
  if (!text || !text.trim()) {
    return <div className="git-diff-empty">{t("git.emptyDiff", locale)}</div>;
  }
  const lines = text.split("\n");
  const kinds = gitDiffLineKinds(text);
  if (!renderHunkAction) {
    return (
      <div className="git-diff-body">
        {lines.map((line, index) => (
          <div key={index} className={`git-diff-line git-diff-line-${kinds[index]}`}>{line || "\u00a0"}</div>
        ))}
      </div>
    );
  }

  const hunksByLine = new Map(parseGitDiff(text).hunks.map((hunk, index) => [hunk.line, { hunk, index }]));
  return (
    <div className="git-diff-body git-diff-body-actionable">
      {lines.map((line, index) => {
        const entry = hunksByLine.get(index + 1);
        return (
          <div key={index} className={`git-diff-line git-diff-line-${kinds[index]}`}>
            <span className="git-diff-line-text">{line || "\u00a0"}</span>
            {entry && <span className="git-diff-hunk-action">{renderHunkAction(entry.hunk, entry.index)}</span>}
          </div>
        );
      })}
    </div>
  );
}
