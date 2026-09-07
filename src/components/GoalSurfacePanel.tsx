import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check, CircleAlert, Pause, Plus } from "lucide-react";
import { t, type UiLocale } from "../app/i18n";
import type { DshGoalProjection } from "../lib/desktop";

export type GoalAction = "edit" | "pause" | "resume" | "complete" | "clear";

type GoalSurfacePanelProps = {
  activeGoal: DshGoalProjection["goal"] | null;
  roundsStarted: number;
  draft: string;
  maxRoundsDraft: string;
  busy: boolean;
  locale?: UiLocale;
  onDraftChange: (value: string) => void;
  onMaxRoundsChange: (value: string) => void;
  onMutate: (action: GoalAction) => void | Promise<unknown>;
  onCreate: () => void | Promise<unknown>;
};

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

function roundProgress(roundsStarted: number, maxRounds: number) {
  if (maxRounds <= 0) return 0;
  return Math.min(100, Math.max(0, (Math.max(0, roundsStarted) / maxRounds) * 100));
}

export function GoalSurfacePanel({
  activeGoal,
  roundsStarted,
  draft,
  maxRoundsDraft,
  busy,
  locale = "zh",
  onDraftChange,
  onMaxRoundsChange,
  onMutate,
  onCreate,
}: GoalSurfacePanelProps) {
  const phase = activeGoal?.phase;
  const objective = activeGoal?.objective ?? "";
  const maxRounds = activeGoal?.maxGoalRounds ?? 0;
  const revision = activeGoal?.revision ?? 0;
  const progress = roundProgress(roundsStarted, maxRounds);
  const [clearArmed, setClearArmed] = useState(false);
  const [creatingReplacement, setCreatingReplacement] = useState(false);
  const showCreateForm = !activeGoal || creatingReplacement;

  return (
    <div className="goal-management-panel">
      {!showCreateForm ? (
        <>
          <section className={`goal-management-summary ${phase ?? ""}`}>
            <div className="goal-management-mark" aria-hidden="true">{phase ? phaseMarks[phase] : ""}</div>
            <div className="goal-management-summary-copy">
              <div className="goal-management-kicker"><span>{t("goal.current", locale)}</span><b>{phase ? goalPhaseLabel(phase, locale) : ""}</b></div>
              <strong>{objective}</strong>
              <small>{t("goal.summaryHint", locale)}</small>
            </div>
          </section>

          <section className="goal-management-progress" aria-label={t("goal.progressAria", locale)}>
            <div className="goal-management-progress-head"><span>{t("goal.roundBudget", locale)}</span><strong>{Math.max(0, roundsStarted)} / {maxRounds}</strong></div>
            <div className="goal-management-progress-track" role="progressbar" aria-label={t("goal.roundProgressAria", locale)} aria-valuemin={0} aria-valuemax={maxRounds} aria-valuenow={Math.min(Math.max(0, roundsStarted), maxRounds)}><i style={{ width: `${progress}%` }} /></div>
            <div className="goal-management-stats"><span><b>Revision</b>{revision}</span><span><b>{t("goal.roundsLeft", locale)}</b>{Math.max(0, maxRounds - Math.max(0, roundsStarted))}</span><span><b>{t("goal.autoContinue", locale)}</b>{phase === "active" ? t("goal.enabled", locale) : t("goal.phasePaused", locale)}</span></div>
          </section>

          {activeGoal.blockedReason && <div className="goal-management-alert" role="alert"><strong>{t("goal.needsAttention", locale)}</strong><span>{activeGoal.blockedReason.message}</span></div>}

          <section className="goal-management-editor">
            <div className="goal-management-section-heading"><span>{t("goal.settingsTitle", locale)}</span><small>{t("goal.settingsHint", locale)}</small></div>
            <label><span>{t("goal.objectiveField", locale)}</span><textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder={t("goal.objectivePlaceholder", locale)} rows={3} disabled={busy} /></label>
            <label><span>{t("goal.maxRoundsField", locale)}</span><input type="number" min="1" step="1" value={maxRoundsDraft} onChange={(event) => onMaxRoundsChange(event.target.value)} disabled={busy} /><small>{t("goal.maxRoundsHint", locale)}</small></label>
            <button type="button" className="confirm goal-save-button" disabled={busy || !draft.trim()} onClick={() => void onMutate("edit")}>{busy ? t("goal.saving", locale) : t("goal.saveSettings", locale)}</button>
          </section>

          <section className="goal-management-actions">
            <div className="goal-management-section-heading"><span>{t("goal.phaseControl", locale)}</span><small>{t("goal.phaseControlHint", locale)}</small></div>
            <div className="goal-management-action-grid">
              {phase === "active" && <button type="button" disabled={busy} onClick={() => void onMutate("pause")}>{t("goal.pause", locale)}</button>}
              {(phase === "paused" || phase === "blocked") && <button type="button" className="confirm" disabled={busy} onClick={() => void onMutate("resume")}>{t("goal.resume", locale)}</button>}
              {phase !== "complete" && <button type="button" disabled={busy} onClick={() => void onMutate("complete")}>{t("goal.markComplete", locale)}</button>}
              {phase === "complete" && <button type="button" className="confirm" disabled={busy} onClick={() => setCreatingReplacement(true)}>{t("goal.createNew", locale)}</button>}
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (!clearArmed) {
                    setClearArmed(true);
                    return;
                  }
                  setClearArmed(false);
                  void onMutate("clear");
                }}
              >{clearArmed ? t("goal.clearConfirm", locale) : t("goal.clear", locale)}</button>
            </div>
          </section>
        </>
      ) : (
        <form className="goal-management-empty" onSubmit={(event) => { event.preventDefault(); void onCreate(); }}>
          <div className="goal-management-empty-mark" aria-hidden="true"><Plus /></div>
          <div><strong>{activeGoal ? t("goal.createNext", locale) : t("goal.createFirst", locale)}</strong><p>{activeGoal ? t("goal.createNextHint", locale) : t("goal.createFirstHint", locale)}</p></div>
          <label><span>{t("goal.objectiveField", locale)}</span><textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder={t("goal.objectivePlaceholder", locale)} rows={3} disabled={busy} autoFocus /></label>
          <label><span>{t("goal.maxRoundsField", locale)} <em>{t("goal.optional", locale)}</em></span><input type="number" min="1" step="1" value={maxRoundsDraft} onChange={(event) => onMaxRoundsChange(event.target.value)} placeholder={t("goal.defaultRoundsPlaceholder", locale)} disabled={busy} /></label>
          <div className="goal-management-empty-actions">
            <button type="submit" className="confirm" disabled={busy || !draft.trim()}>{busy ? t("goal.creating", locale) : t("goal.create", locale)}</button>
            {activeGoal && <button type="button" disabled={busy} onClick={() => setCreatingReplacement(false)}>{t("goal.backToCurrent", locale)}</button>}
          </div>
        </form>
      )}
    </div>
  );
}
