import { DockFrame } from "./DockFrame";
import { SubagentTree } from "./SubagentTree";
import { subagentActivityLabel, subagentDisplayName, subagentModeLabel, type ChildSubagentEntry } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { subagentTreeKey } from "../app/ui-model";
import type { DshSubagentCatalog } from "../lib/desktop";

type SubagentDockProps = {
  entries: ChildSubagentEntry[];
  dockOpen: boolean;
  selectedId: string | null;
  /** Lazily loaded catalogs keyed by `parent\u0000child`; null = loading. */
  catalogs: Record<string, DshSubagentCatalog | null>;
  expandedBranches: Record<string, boolean>;
  loadingErrors?: Record<string, string>;
  locale?: UiLocale;
  onToggleDock: () => void;
  /** Open any depth entry; carries the direct parent session id. */
  onOpen: (entry: ChildSubagentEntry, parentSessionId: string, treeKey: string) => void;
  onToggleBranch: (treeKey: string) => void;
};

export function SubagentDock({ entries, dockOpen, selectedId, catalogs, expandedBranches, loadingErrors, locale = "zh", onToggleDock, onOpen, onToggleBranch }: SubagentDockProps) {
  if (entries.length === 0) return null;
  const runningCount = entries.filter((entry) => entry.activity === "running").length;

  return (
    <DockFrame
      id="subagent-dock"
      className="subagent-dock"
      collapsed={!dockOpen}
      label={t("subagent.label", locale)}
      title={t("subagent.title", locale)}
      kicker={t("common.currentSession", locale)}
      icon="◈"
      railExtra={<span className="subagent-dock-count">{entries.length}</span>}
      total={`${runningCount}/${entries.length}`}
      toggleGlyph="‹"
      onToggle={onToggleDock}
      railClassName="subagent-dock-rail"
      markClassName="subagent-dock-mark"
      cardClassName="subagent-dock-card"
      headerClassName="subagent-dock-header"
      headingClassName="subagent-dock-heading"
      kickerClassName="subagent-dock-kicker"
      headerActionsClassName="subagent-dock-header-actions"
      totalClassName="subagent-dock-total"
      toggleClassName="subagent-dock-toggle"
      bodyClassName="subagent-dock-body"
    >
      <SubagentTree
        entries={entries}
        rootSessionId="."
        selectedId={selectedId}
        catalogs={catalogs}
        expanded={expandedBranches}
        loadingError={loadingErrors}
        locale={locale}
        onToggleBranch={onToggleBranch}
        onOpen={(entry, parentSessionId) => onOpen(entry, parentSessionId, subagentTreeKey(parentSessionId, entry.id))}
      />
    </DockFrame>
  );
}

export { subagentActivityLabel, subagentDisplayName, subagentModeLabel };