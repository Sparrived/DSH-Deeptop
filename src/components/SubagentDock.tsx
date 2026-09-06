import { SubagentTree } from "./SubagentTree";
import { subagentActivityLabel, subagentDisplayName, subagentModeLabel, type ChildSubagentEntry } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { subagentTreeKey } from "../app/ui-model";
import type { DshSubagentCatalog } from "../lib/desktop";

type SubagentDockProps = {
  /** Session that directly owns the top-level catalog entries. */
  rootSessionId: string;
  entries: ChildSubagentEntry[];
  selectedId: string | null;
  /** Lazily loaded catalogs keyed by `parent\u0000child`; null = loading. */
  catalogs: Record<string, DshSubagentCatalog | null>;
  expandedBranches: Record<string, boolean>;
  loadingErrors?: Record<string, string>;
  locale?: UiLocale;
  /** Open any depth entry; carries the direct parent session id. */
  onOpen: (entry: ChildSubagentEntry, parentSessionId: string, treeKey: string) => void;
  onToggleBranch: (treeKey: string) => void;
};

/** The left navigation page of the shared utility panel's Subagent view. */
export function SubagentDock({ rootSessionId, entries, selectedId, catalogs, expandedBranches, loadingErrors, locale = "zh", onOpen, onToggleBranch }: SubagentDockProps) {
  if (!rootSessionId || entries.length === 0) {
    return <div className="subagent-tree-empty">{t("subagentSurface.empty", locale)}</div>;
  }

  return (
    <SubagentTree
      entries={entries}
      rootSessionId={rootSessionId}
      selectedId={selectedId}
      catalogs={catalogs}
      expanded={expandedBranches}
      loadingError={loadingErrors}
      locale={locale}
      onToggleBranch={onToggleBranch}
      onOpen={(entry, parentSessionId) => onOpen(entry, parentSessionId, subagentTreeKey(parentSessionId, entry.id))}
    />
  );
}

export { subagentActivityLabel, subagentDisplayName, subagentModeLabel };
