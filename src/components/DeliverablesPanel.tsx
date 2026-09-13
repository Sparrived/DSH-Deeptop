import type { TranscriptItem } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import type { PresentedHost, PresentedOpenPhase } from "../app/presented-file";
import type { DshSessionSummary } from "../lib/desktop";
import { DockFrame } from "./DockFrame";
import { PresentedFileCard } from "./PresentedFileCard";

type DeliverablesPanelProps = {
  item: TranscriptItem;
  activeSession: DshSessionSummary | null;
  collapsed: boolean;
  locale?: UiLocale;
  onToggle: () => void;
  embedded?: boolean;
  /** 在右栏停靠标签中打开交付文件；这是卡片主体的默认动作。 */
  onOpenFile: (path: string, location?: { line?: number }) => void | Promise<void>;
  /** 交给系统文件管理器；只用于“在文件夹中显示”。 */
  onOpenSessionPath: (path: string) => void | Promise<void>;
  /** 卡片菜单触发的原生动作（用默认应用打开 / 在文件管理器中显示）。 */
  onPresentedAction: (path: string, action: "open" | "reveal") => void | Promise<void>;
  /** 原生宿主元数据；缺失时卡片菜单禁用。 */
  presentedHost: PresentedHost | null;
  /** 按 `presentedPhaseKey(activeSessionId, path)` 记账的阶段状态。 */
  presentedPhaseOf: (path: string) => PresentedOpenPhase | undefined;
};

function fileDirectory(path: string, locale: UiLocale) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0) return t("deliverables.workspaceDir", locale);
  const directory = normalized.slice(0, separator);
  return directory || t("deliverables.workspaceDir", locale);
}

export function DeliverablesPanel({ item, activeSession, collapsed, locale = "zh", onToggle, embedded = false, onOpenSessionPath, onOpenFile, onPresentedAction, presentedHost, presentedPhaseOf }: DeliverablesPanelProps) {
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
      embedded={embedded}
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
          {files.map((path) => (
            <PresentedFileCard
              key={`${item.key}-${path}`}
              path={path}
              detail={fileDirectory(path, locale)}
              diff={fileDiffs[path]}
              locale={locale}
              phase={presentedPhaseOf(path)}
              host={presentedHost}
              onPreview={onOpenFile}
              onAction={onPresentedAction}
            />
          ))}
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
