import type { ReactNode } from "react";
import { ArrowUpRight, Check, ChevronsLeft, ChevronsRight, CircleAlert, Pause, Play } from "lucide-react";
import { t, type UiLocale } from "../app/i18n";
import type { DshGoalProjection } from "../lib/desktop";

type CurrentGoalBarProps = {
  activeGoal: DshGoalProjection["goal"] | null;
  roundsStarted: number;
  collapsed: boolean;
  busy?: boolean;
  locale?: UiLocale;
  onOpen: () => void;
  onToggleCollapsed: () => void;
  onTogglePhase: () => void;
};

/** 回合是离散单位，预算在刻度上限内就逐回合画出来；更大的预算退回连续轨道。 */
const tickRoundsLimit = 16;

function goalPhaseLabel(phase: DshGoalProjection["goal"]["phase"], locale: UiLocale) {
  switch (phase) {
    case "active": return t("goal.phaseActive", locale);
    case "paused": return t("goal.phasePaused", locale);
    case "blocked": return t("goal.phaseBlocked", locale);
    case "complete": return t("goal.phaseComplete", locale);
  }
}

const phaseMarks: Record<DshGoalProjection["goal"]["phase"], ReactNode> = {
  active: <ArrowUpRight />,
  paused: <Pause />,
  blocked: <CircleAlert />,
  complete: <Check />,
};

export function CurrentGoalBar({ activeGoal, roundsStarted, collapsed, busy = false, locale = "zh", onOpen, onToggleCollapsed, onTogglePhase }: CurrentGoalBarProps) {
  if (!activeGoal) return null;

  const phase = activeGoal.phase;
  const phaseLabel = goalPhaseLabel(phase, locale);
  const maxRounds = Math.max(0, activeGoal.maxGoalRounds);
  const safeRounds = Math.max(0, roundsStarted);
  const progress = maxRounds > 0 ? Math.min(100, (safeRounds / maxRounds) * 100) : 0;
  const tickRounds = maxRounds > 0 && maxRounds <= tickRoundsLimit ? maxRounds : 0;
  const reason = activeGoal.blockedReason?.message;
  // 收起时仍保留阶段图标：颜色变化是"这里有一个 Goal"的唯一提示。
  if (collapsed) {
    return (
      <aside className={`current-goal-bar ${phase} collapsed`} aria-label={t("goal.current", locale)}>
        <button
          type="button"
          className="current-goal-collapse-toggle"
          onClick={onToggleCollapsed}
          aria-expanded={false}
          aria-label={t("goal.expand", locale)}
          title={`${t("goal.expand", locale)} · ${phaseLabel} · ${activeGoal.objective}`}
        >
          <span className="current-goal-mark" aria-hidden="true">{phaseMarks[phase]}</span>
          <ChevronsLeft aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className={`current-goal-bar ${phase}`} aria-label={t("goal.current", locale)}>
      <button type="button" className="current-goal-bar-main" onClick={onOpen} title={t("goal.openPanel", locale)}>
        <span className="current-goal-mark" aria-hidden="true">{phaseMarks[phase]}</span>
        <span className="current-goal-copy">
          <span className="current-goal-lead">
            <span className="current-goal-status"><i aria-hidden="true" />{phaseLabel}</span>
            <strong className="current-goal-objective" title={activeGoal.objective}>{activeGoal.objective}</strong>
          </span>
          <span className="current-goal-meta">
            <span className={`current-goal-rounds${tickRounds ? " ticks" : " track"}`} aria-hidden="true">
              {tickRounds
                ? Array.from({ length: tickRounds }, (_, index) => <i key={index} className={index < safeRounds ? "done" : ""} />)
                : <i className="fill" style={{ width: `${progress}%` }} />}
            </span>
            <span className="current-goal-rounds-label">{t("goal.rounds", locale)} <strong>{safeRounds} / {maxRounds}</strong></span>
            {reason && <span className="current-goal-reason" title={reason}>{reason}</span>}
          </span>
        </span>
      </button>
      {phase !== "complete" && <button
        type="button"
        className="current-goal-quick"
        onClick={onTogglePhase}
        disabled={busy}
        aria-label={phase === "active" ? t("goal.pause", locale) : t("goal.resume", locale)}
        title={phase === "active" ? t("goal.pause", locale) : t("goal.resume", locale)}
      >{phase === "active" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>}
      <button type="button" className="current-goal-manage" onClick={onOpen} aria-label={t("goal.openPanel", locale)} title={t("goal.manage", locale)}>{t("goal.manage", locale)}</button>
      <button
        type="button"
        className="current-goal-collapse-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={true}
        aria-label={t("goal.collapse", locale)}
        title={t("goal.collapse", locale)}
      ><ChevronsRight aria-hidden="true" /></button>
    </aside>
  );
}
