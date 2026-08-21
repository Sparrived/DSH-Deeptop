import type { DshGoalProjection } from "../lib/desktop";

type CurrentGoalBarProps = {
  activeGoal: DshGoalProjection["goal"] | null;
  roundsStarted: number;
  collapsed: boolean;
  onOpen: () => void;
  onToggleCollapsed: () => void;
};

const phaseLabels: Record<DshGoalProjection["goal"]["phase"], string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  complete: "已完成",
};

const phaseMarks: Record<DshGoalProjection["goal"]["phase"], string> = {
  active: "↗",
  paused: "Ⅱ",
  blocked: "!",
  complete: "✓",
};

export function CurrentGoalBar({ activeGoal, roundsStarted, collapsed, onOpen, onToggleCollapsed }: CurrentGoalBarProps) {
  if (!activeGoal) return null;

  const maxRounds = Math.max(0, activeGoal.maxGoalRounds);
  const safeRounds = Math.max(0, roundsStarted);
  const progress = maxRounds > 0 ? Math.min(100, (safeRounds / maxRounds) * 100) : 0;

  return (
    <aside className={`current-goal-bar ${activeGoal.phase}${collapsed ? " collapsed" : ""}`} aria-label="当前 Goal">
      <button type="button" className="current-goal-bar-main" onClick={onOpen} title="打开 Goal 管理面板">
        <span className="current-goal-mark" aria-hidden="true">{phaseMarks[activeGoal.phase]}</span>
        <span className="current-goal-copy">
          <span className="current-goal-heading">
            <span className="current-goal-kicker">当前 Goal</span>
            <span className="current-goal-status"><i aria-hidden="true" />{phaseLabels[activeGoal.phase]}</span>
          </span>
          <strong className="current-goal-objective" title={activeGoal.objective}>{activeGoal.objective}</strong>
          {activeGoal.blockedReason && <span className="current-goal-reason">{activeGoal.blockedReason.message}</span>}
        </span>
        <span className="current-goal-progress">
          <span className="current-goal-progress-label"><span>回合</span><strong>{safeRounds} / {maxRounds}</strong></span>
          <span className="current-goal-progress-track" role="progressbar" aria-label="Goal 回合进度" aria-valuemin={0} aria-valuemax={maxRounds} aria-valuenow={Math.min(safeRounds, maxRounds)}><i style={{ width: `${progress}%` }} /></span>
        </span>
      </button>
      <button type="button" className="current-goal-manage" onClick={onOpen} aria-label="打开 Goal 管理面板" title="管理 Goal">管理</button>
      <button
        type="button"
        className="current-goal-collapse-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开当前 Goal" : "向上收起当前 Goal"}
        title={collapsed ? "展开当前 Goal" : "向上收起当前 Goal"}
      ><span aria-hidden="true">⌃</span></button>
    </aside>
  );
}
