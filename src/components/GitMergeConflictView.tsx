import { useEffect, useMemo, useState } from "react";
import { getGitConflict, resolveGitConflict, type WorkspaceGitConflict } from "../lib/desktop";
import { errorText } from "../app/model";
import {
  conflictResolutionContent,
  conflictSideAvailability,
  countConflictMarkers,
  initialConflictDraft,
  type GitConflictSide,
  type GitConflictView,
} from "../app/git-conflict";
import { notifyGitChanged } from "../app/git-events";
import { t, type UiLocale } from "../app/i18n";

/**
 * 冲突解决视图：左边选版本、右边编辑结果。
 *
 * 不引入三方合并编辑器的复杂交互，而是把三件事做扎实：
 * 1. 能看清「当前 / 传入 / 基础」三份内容（只读）；
 * 2. 能一键把结果替换成某一侧或两侧拼接（改的是草稿，不直接落盘）；
 * 3. 只有点「保存并标记已解决」才写回工作区并 `git add`，并提示还剩多少冲突标记。
 */
export type GitMergeConflictViewProps = {
  cwd: string;
  path: string;
  locale?: UiLocale;
  onError: (message: string) => void;
  /** 解决成功后通知宿主刷新（宿主自己决定要不要收起这个面板）。 */
  onResolved?: (path: string) => void;
};

export function GitMergeConflictView({
  cwd,
  path,
  locale = "zh",
  onError,
  onResolved,
}: GitMergeConflictViewProps) {
  const [conflict, setConflict] = useState<WorkspaceGitConflict | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<GitConflictView>("result");
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getGitConflict(cwd, path)
      .then((next) => {
        if (!active) return;
        setConflict(next);
        setDraft(initialConflictDraft(next));
        setView("result");
      })
      .catch((failure) => {
        if (!active) return;
        setConflict(null);
        onError(t("git.error.readConflictFailed", locale, { error: errorText(failure, locale) }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, path, locale, onError, revision]);

  const availability = useMemo(
    () => conflictSideAvailability(conflict ?? { base: null, ours: null, theirs: null }),
    [conflict],
  );
  const remaining = countConflictMarkers(draft);

  function adopt(side: GitConflictSide) {
    if (!conflict) return;
    setDraft(conflictResolutionContent(side, conflict));
    setView("result");
  }

  async function save() {
    setSaving(true);
    try {
      const result = await resolveGitConflict(cwd, path, draft);
      if (!result.ok) {
        onError(t("git.error.resolveConflictFailed", locale, { error: result.text || t("git.resultFailed", locale) }));
        return;
      }
      notifyGitChanged("changes");
      onResolved?.(path);
    } catch (failure) {
      onError(t("git.error.resolveConflictFailed", locale, { error: errorText(failure, locale) }));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !conflict) {
    return <div className="git-empty">{t("git.loadingConflict", locale)}</div>;
  }
  if (!conflict) {
    return <div className="git-empty">{t("git.error.readConflictFailed", locale, { error: t("git.emptyDiff", locale) })}</div>;
  }

  const shown = view === "result"
    ? draft
    : (view === "ours" ? conflict.ours : view === "theirs" ? conflict.theirs : conflict.base) ?? "";

  return (
    <div className="git-merge">
      <div className="git-diff-header">
        <span className="git-diff-path" title={path}>{path}</span>
        <div className="git-diff-mode" role="group" aria-label={t("git.mergeSideAria", locale)}>
          {(["result", "ours", "theirs", "base"] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={view === side ? "selected" : ""}
              onClick={() => setView(side)}
            >
              {side === "result" ? t("git.mergeResult", locale)
                : side === "ours" ? t("git.mergeOurs", locale)
                : side === "theirs" ? t("git.mergeTheirs", locale)
                : t("git.mergeBase", locale)}
            </button>
          ))}
        </div>
      </div>
      <div className="git-merge-actions">
        <button type="button" disabled={saving || !availability.ours} title={t("git.mergeAdoptOursTitle", locale)} onClick={() => adopt("ours")}>{t("git.mergeAdoptOurs", locale)}</button>
        <button type="button" disabled={saving || !availability.theirs} title={t("git.mergeAdoptTheirsTitle", locale)} onClick={() => adopt("theirs")}>{t("git.mergeAdoptTheirs", locale)}</button>
        <button type="button" disabled={saving || (!availability.ours && !availability.theirs)} title={t("git.mergeAdoptBothTitle", locale)} onClick={() => adopt("both")}>{t("git.mergeAdoptBoth", locale)}</button>
        <button type="button" className="confirm" disabled={saving} title={t("git.mergeSaveTitle", locale)} onClick={() => void save()}>
          {saving ? t("common.saving", locale) : t("git.mergeSave", locale)}
        </button>
      </div>
      <textarea
        className="git-merge-editor"
        value={shown}
        readOnly={view !== "result"}
        spellCheck={false}
        aria-label={t("git.mergeEditorAria", locale)}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className={`git-merge-hint${remaining > 0 ? " warn" : ""}`}>
        {remaining > 0
          ? t("git.mergeUnsolved", locale, { count: remaining })
          : t("git.mergeNoMarkers", locale)}
        {(!availability.ours || !availability.theirs) && (
          <span className="git-merge-hint-side">{t("git.mergeSideMissing", locale)}</span>
        )}
      </p>
    </div>
  );
}
