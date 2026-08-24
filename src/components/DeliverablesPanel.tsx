import { pathBasename, type TranscriptItem } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import type { DshSessionSummary } from "../lib/desktop";
import { DockFrame } from "./DockFrame";

type DeliverablesPanelProps = {
  item: TranscriptItem;
  activeSession: DshSessionSummary | null;
  collapsed: boolean;
  locale?: UiLocale;
  onToggle: () => void;
  onOpenSessionPath: (path: string) => void | Promise<void>;
};

function fileTypeLabel(path: string) {
  const name = pathBasename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "FILE";
  return name.slice(dot + 1).toUpperCase().slice(0, 6);
}

function fileDirectory(path: string, locale: UiLocale) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0) return t("deliverables.workspaceDir", locale);
  const directory = normalized.slice(0, separator);
  return directory || t("deliverables.workspaceDir", locale);
}

export function DeliverablesPanel({ item, activeSession, collapsed, locale = "zh", onToggle, onOpenSessionPath }: DeliverablesPanelProps) {
  const files = item.files ?? [];
  const fileDiffs = item.fileDiffs ?? {};
  const diffTotals = Object.values(fileDiffs).reduce(
    (totals, diff) => ({ added: totals.added + diff.added, removed: totals.removed + diff.removed }),
    { added: 0, removed: 0 },
  );
  const totalDiffLines = diffTotals.added + diffTotals.removed;
  return (
    <DockFrame
      id="deliverables-dock"
      className="deliverables-panel"
      collapsed={collapsed}
      label={t("deliverables.title", locale)}
      title={t("deliverables.title", locale)}
      kicker={t("deliverables.kicker", locale)}
      icon={null}
      markClassName="deliverables-mark"
      total={t("deliverables.fileCount", locale, { count: files.length })}
      onToggle={onToggle}
      railClassName="deliverables-panel-rail"
      cardClassName="deliverables-panel-card"
      headerClassName="deliverables-panel-header"
      headingClassName="deliverables-panel-heading"
      kickerClassName="deliverables-panel-kicker"
      headerActionsClassName="deliverables-panel-header-actions"
      totalClassName="deliverables-panel-total"
      toggleClassName="deliverables-panel-toggle"
      bodyClassName="deliverables-panel-body"
    >
      <div className="deliverables-panel-summary">
        <span className="live">{t("deliverables.fileCount", locale, { count: files.length })}</span>
        <span className="deliverables-diff-total" aria-label={t("deliverables.diffAria", locale, { lines: totalDiffLines, added: diffTotals.added, removed: diffTotals.removed })}>
          {t("deliverables.diffTotal", locale, { lines: totalDiffLines })}
          <b className="diff-added">+{diffTotals.added}</b>
          <b className="diff-removed">−{diffTotals.removed}</b>
        </span>
        <span>{t("deliverables.writtenToWorkspace", locale)}</span>
      </div>
      <div className="deliverables-panel-files">
        <div className="deliverables-files">
          {files.map((path) => {
            const diff = fileDiffs[path];
            return (
              <button className="deliverable-file" type="button" key={`${item.key}-${path}`} onClick={() => void onOpenSessionPath(path)} title={path} aria-label={diff ? t("deliverables.openFileAriaDetailed", locale, { path, added: diff.added, removed: diff.removed }) : t("deliverables.openFileAria", locale, { path })}>
                <span className="deliverable-file-type" aria-hidden="true">{fileTypeLabel(path)}</span>
                <span className="deliverable-file-copy"><strong>{pathBasename(path)}</strong><small>{fileDirectory(path, locale)}</small></span>
                {diff && <span className="deliverable-file-diff" aria-label={t("deliverables.addedRemoved", locale, { added: diff.added, removed: diff.removed })}><b>+{diff.added}</b><b>−{diff.removed}</b></span>}
                <span className="deliverable-file-open" aria-hidden="true">↗</span>
              </button>
            );
          })}
        </div>
      </div>
      {activeSession?.cwd && (
        <div className="deliverables-actions">
          <button type="button" className="deliverables-folder" onClick={() => void onOpenSessionPath(".")}>
            <span className="folder-icon" aria-hidden="true" />{t("deliverables.showInFolder", locale)}
          </button>
        </div>
      )}
    </DockFrame>
  );
}
