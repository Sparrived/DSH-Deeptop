import { DockFrame } from "./DockFrame";
import {
  subagentActivityLabel,
  subagentDisplayName,
  subagentModeLabel,
  type ChildSubagentEntry,
} from "../app/model";

type SubagentDockProps = {
  entries: ChildSubagentEntry[];
  dockOpen: boolean;
  selectedId: string | null;
  onToggleDock: () => void;
  onToggle: (entry: ChildSubagentEntry, index: number) => void;
};

export function SubagentDock({ entries, dockOpen, selectedId, onToggleDock, onToggle }: SubagentDockProps) {
  if (entries.length === 0) return null;
  const runningCount = entries.filter((entry) => entry.activity === "running").length;

  return (
    <DockFrame
      id="subagent-dock"
      className="subagent-dock"
      collapsed={!dockOpen}
      label="子 Agent 书签"
      title="子 Agent"
      kicker="当前会话"
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
      <nav className="subagent-bookmark-list" aria-label="子 Agent 书签">
        {entries.map((entry, index) => {
          const label = subagentDisplayName(entry, index);
          const selected = selectedId === entry.id;
          return (
            <button
              className={`subagent-bookmark ${selected ? "selected" : ""}`}
              data-tone={`tone-${index % 4}`}
              type="button"
              key={entry.id}
              onClick={() => onToggle(entry, index)}
              title={`打开 ${label} 的执行情况`}
              aria-pressed={selected}
            >
              <span className={`subagent-bookmark-status ${entry.activity}`} aria-hidden="true"><i /></span>
              <span className="subagent-bookmark-copy"><strong>{label}</strong><small>{subagentActivityLabel(entry.activity)} · {subagentModeLabel(entry.mode)}</small></span>
              <span className="subagent-bookmark-number">{String(index + 1).padStart(2, "0")}</span>
            </button>
          );
        })}
      </nav>
    </DockFrame>
  );
}
