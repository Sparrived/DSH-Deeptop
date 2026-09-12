import { diffLineKind } from "../app/git-model";
import { t, type UiLocale } from "../app/i18n";

/** Git 统一差异的只读渲染：按行分类着色；空内容给出说明而不是留白。 */
export function GitDiffBody({ text, locale = "zh" }: { text: string | null; locale?: UiLocale }) {
  if (!text || !text.trim()) {
    return <div className="git-diff-empty">{t("git.emptyDiff", locale)}</div>;
  }
  return (
    <div className="git-diff-body">
      {text.split("\n").map((line, index) => (
        <div key={index} className={`git-diff-line git-diff-line-${diffLineKind(line)}`}>{line || "\u00a0"}</div>
      ))}
    </div>
  );
}
