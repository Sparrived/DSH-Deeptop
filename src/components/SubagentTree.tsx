import { subagentDisplayName, type ChildSubagentEntry } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { subagentTreeKey } from "../app/ui-model";
import type { DshSubagentAddress, DshSubagentCatalog } from "../lib/desktop";

function subagentActivityText(activity: ChildSubagentEntry["activity"], locale: UiLocale) {
  return t(activity === "running" ? "subagent.running" : "subagent.stopped", locale);
}

function subagentModeText(mode: ChildSubagentEntry["mode"], locale: UiLocale) {
  return t(mode === "continuable" ? "subagent.continuable" : "subagent.oneShot", locale);
}

function subagentTitle(entry: ChildSubagentEntry, index: number, locale: UiLocale) {
  return entry.label?.trim() || t("subagent.fallbackName", locale, { index: String(index + 1).padStart(2, "0") });
}

/**
 * Recursive subagent lineage. The official `subagent.list` is already the
 * recursive interface: any child session id can be used as the next
 * `parentSessionId`, and entries carry `hasChildren` so a branch is rendered
 * only after the user expands it (lazy loading). This mirrors the official
 * WebUI catalog rows, which recurse one level per loaded catalog.
 */

type SubagentTreeProps = {
  /** Direct children of this branch root. */
  entries: ChildSubagentEntry[];
  rootSessionId: string;
  selectedId: string | null;
  /** Lazily loaded catalogs keyed by parent session id; null = loading. */
  catalogs: Record<string, DshSubagentCatalog | null>;
  /** Expand state keeps the branch open across refresh cycles. */
  expanded: Record<string, boolean>;
  loadingError?: Record<string, string>;
  locale?: UiLocale;
  onToggleBranch: (treeKey: string) => void;
  /** Open a child; parentSessionId is the direct parent this row hangs under. */
  onOpen: (entry: ChildSubagentEntry, parentSessionId: string) => void;
};

function TreeRows({ entries, rootSessionId, selectedId, catalogs, expanded, loadingError, locale = "zh", onToggleBranch, onOpen, depth }: SubagentTreeProps & { depth: number }) {
  return <>
    {entries.map((entry, index) => {
      const treeKey = subagentTreeKey(rootSessionId, entry.id);
      const branchOpen = Boolean(expanded[treeKey]);
      const catalog = catalogs[treeKey];
      const error = loadingError?.[treeKey];
      const name = subagentTitle(entry, index, locale);
      return <div className="subagent-tree-row" data-depth={depth} key={entry.id}>
        <div className={`subagent-tree-line${branchOpen ? " expanded" : ""}`}>
          {entry.hasChildren
            ? <button
              className="subagent-tree-disclosure"
              type="button"
              onClick={() => onToggleBranch(treeKey)}
              aria-expanded={branchOpen}
              aria-label={branchOpen ? t("subagent.collapseBranchAria", locale, { name }) : t("subagent.expandBranchAria", locale, { name })}
              title={branchOpen ? t("subagent.collapse", locale) : t("subagent.expandBranch", locale)}
            >{branchOpen ? "▾" : "▸"}</button>
            : <span className="subagent-tree-spacer" aria-hidden="true" />}
          <button
            className={`subagent-tree-entry${selectedId === entry.id ? " selected" : ""}`}
            type="button"
            onClick={() => onOpen(entry, rootSessionId)}
            aria-pressed={selectedId === entry.id}
            title={t("subagent.openRecord", locale, { name })}
          >
            <span className={`subagent-tree-status ${entry.activity}`} aria-hidden="true"><i /></span>
            <span className="subagent-tree-copy"><strong>{name}</strong><small>{subagentActivityText(entry.activity, locale)} · {subagentModeText(entry.mode, locale)}</small></span>
          </button>
        </div>
        {branchOpen && (catalog === null && error === undefined ? (
          <div className="subagent-tree-loading" role="status">{t("subagent.loadingBranch", locale)}</div>
        ) : error ? (
          <div className="subagent-tree-loading error" role="status">{error}</div>
        ) : catalog && catalog.entries.length > 0 ? (
          <div className="subagent-tree-children">
            <TreeRows
              entries={catalog.entries.filter((item): item is ChildSubagentEntry => item.kind === "child")}
              rootSessionId={entry.id}
              selectedId={selectedId}
              catalogs={catalogs}
              expanded={expanded}
              loadingError={loadingError}
              locale={locale}
              onToggleBranch={onToggleBranch}
              onOpen={onOpen}
              depth={depth + 1}
            />
          </div>
        ) : (
          <div className="subagent-tree-loading">{t("subagent.noDeeperBranch", locale)}</div>
        ))}
      </div>;
    })}
  </>;
}

export function SubagentTree(props: SubagentTreeProps) {
  if (props.entries.length === 0) return null;
  return <nav className="subagent-tree" aria-label={t("subagent.treeAria", props.locale ?? "zh")}>
    <TreeRows {...props} depth={0} />
  </nav>;
}

export type { DshSubagentAddress };
export { subagentDisplayName };