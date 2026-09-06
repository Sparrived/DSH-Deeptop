import { t, type UiLocale } from "../app/i18n";
import type { DshGoalProjection } from "../lib/desktop";

type CurrentGoalBarProps = {
  activeGoal: DshGoalProjection["goal"] | null;
  roundsStarted: number;
  collapsed: boolean;
  locale?: UiLocale;
  onOpen: () => void;
  onToggleCollapsed: () => void;
};

function goalPhaseLabel(phase: DshGoalProjection["goal"]["phase"], locale: UiLocale) {
  switch (phase) {
    case "active": return t("goal.phaseActive", locale);
    case "paused": return t("goal.phasePaused", locale);
    case "blocked": return t("goal.phaseBlocked", locale);
    case "complete": return t("goal.phaseComplete", locale);
  }
}

const phaseMarks: Record<DshGoalProjection["goal"]["phase"], string> = {
  active: "↗",
  paused: "Ⅱ",
  blocked: "!",
  complete: "✓",
};

export function CurrentGoalBar({ activeGoal, roundsStarted, collapsed, locale = "zh", onOpen, onToggleCollapsed }: CurrentGoalBarProps) {
  if (!activeGoal) return null;

  const maxRounds = Math.max(0, activeGoal.maxGoalRounds);
  const safeRounds = Math.max(0, roundsStarted);
  const progress = maxRounds > 0 ? Math.min(100, (safeRounds / maxRounds) * 100) : 0;

  return (
    <aside className={`current-goal-bar ${activeGoal.phase}${collapsed ? " collapsed" : ""}`} aria-label={t("goal.current", locale)}>
      <button type="button" className="current-goal-bar-main" onClick={onOpen} title={t("goal.openPanel", locale)} disabled={collapsed}>
        <span className="current-goal-mark" aria-hidden="true">{phaseMarks[activeGoal.phase]}</span>
        <span className="current-goal-copy">
          <span className="current-goal-heading">
            <span className="current-goal-kicker">{t("goal.current", locale)}</span>
            <span className="current-goal-status"><i aria-hidden="true" />{goalPhaseLabel(activeGoal.phase, locale)}</span>
          </span>
          <strong className="current-goal-objective" title={activeGoal.objective}>{activeGoal.objective}</strong>
          {activeGoal.blockedReason && <span className="current-goal-reason">{activeGoal.blockedReason.message}</span>}
        </span>
        <span className="current-goal-progress">
          <span className="current-goal-progress-label"><span>{t("goal.rounds", locale)}</span><strong>{safeRounds} / {maxRounds}</strong></span>
          <span className="current-goal-progress-track" role="progressbar" aria-label={t("goal.roundProgressAria", locale)} aria-valuemin={0} aria-valuemax={maxRounds} aria-valuenow={Math.min(safeRounds, maxRounds)}><i style={{ width: `${progress}%` }} /></span>
        </span>
      </button>
      <button type="button" className="current-goal-manage" onClick={onOpen} aria-label={t("goal.openPanel", locale)} title={t("goal.manage", locale)} disabled={collapsed}>{t("goal.manage", locale)}</button>
      <button
        type="button"
        className="current-goal-collapse-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("goal.expand", locale) : t("goal.collapse", locale)}
        title={collapsed ? t("goal.expand", locale) : t("goal.collapse", locale)}
      ><span aria-hidden="true">{collapsed ? "›" : "‹"}</span></button>
    </aside>
  );
}
