import { useState } from "react";
import type { DshGoalProjection } from "../lib/desktop";

export type GoalAction = "edit" | "pause" | "resume" | "complete" | "clear";

type GoalSurfacePanelProps = {
  activeGoal: DshGoalProjection["goal"] | null;
  roundsStarted: number;
  draft: string;
  maxRoundsDraft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onMaxRoundsChange: (value: string) => void;
  onMutate: (action: GoalAction) => void | Promise<unknown>;
  onCreate: () => void | Promise<unknown>;
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
              <div className="goal-management-kicker"><span>当前 Goal</span><b>{phase ? phaseLabels[phase] : ""}</b></div>
              <strong>{objective}</strong>
              <small>持续目标会跨越多个会话回合，DSH 会在每次 projection 更新后同步这里的状态。</small>
            </div>
          </section>

          <section className="goal-management-progress" aria-label="Goal 进度">
            <div className="goal-management-progress-head"><span>回合预算</span><strong>{Math.max(0, roundsStarted)} / {maxRounds}</strong></div>
            <div className="goal-management-progress-track" role="progressbar" aria-label="Goal 回合进度" aria-valuemin={0} aria-valuemax={maxRounds} aria-valuenow={Math.min(Math.max(0, roundsStarted), maxRounds)}><i style={{ width: `${progress}%` }} /></div>
            <div className="goal-management-stats"><span><b>Revision</b>{revision}</span><span><b>剩余回合</b>{Math.max(0, maxRounds - Math.max(0, roundsStarted))}</span><span><b>自动续行</b>{phase === "active" ? "已启用" : "已暂停"}</span></div>
          </section>

          {activeGoal.blockedReason && <div className="goal-management-alert" role="alert"><strong>需要处理</strong><span>{activeGoal.blockedReason.message}</span></div>}

          <section className="goal-management-editor">
            <div className="goal-management-section-heading"><span>目标设置</span><small>修改会创建新的 revision，不会改变当前阶段。</small></div>
            <label><span>目标</span><textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="例如：完成登录模块" rows={3} disabled={busy} /></label>
            <label><span>最大回合数</span><input type="number" min="1" step="1" value={maxRoundsDraft} onChange={(event) => onMaxRoundsChange(event.target.value)} disabled={busy} /><small>增加预算后，受阻或耗尽预算的 Goal 才可以继续恢复。</small></label>
            <button type="button" className="confirm goal-save-button" disabled={busy || !draft.trim()} onClick={() => void onMutate("edit")}>{busy ? "正在保存…" : "保存目标设置"}</button>
          </section>

          <section className="goal-management-actions">
            <div className="goal-management-section-heading"><span>阶段控制</span><small>这些操作会立即写入当前会话的 Goal projection。</small></div>
            <div className="goal-management-action-grid">
              {phase === "active" && <button type="button" disabled={busy} onClick={() => void onMutate("pause")}>暂停 Goal</button>}
              {(phase === "paused" || phase === "blocked") && <button type="button" className="confirm" disabled={busy} onClick={() => void onMutate("resume")}>恢复 Goal</button>}
              {phase !== "complete" && <button type="button" disabled={busy} onClick={() => void onMutate("complete")}>标记完成</button>}
              {phase === "complete" && <button type="button" className="confirm" disabled={busy} onClick={() => setCreatingReplacement(true)}>创建新 Goal</button>}
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
              >{clearArmed ? "再次点击确认清除" : "清除 Goal"}</button>
            </div>
          </section>
        </>
      ) : (
        <form className="goal-management-empty" onSubmit={(event) => { event.preventDefault(); void onCreate(); }}>
          <div className="goal-management-empty-mark" aria-hidden="true">＋</div>
          <div><strong>{activeGoal ? "创建下一个会话目标" : "为这个会话设定一个持续目标"}</strong><p>{activeGoal ? "当前 Goal 已完成。创建新 Goal 会替换已完成的目标，并从新的 revision 开始。" : "Goal 会被 DSH 持久化，并在后续回合中继续推进。你可以随时暂停、恢复或调整回合预算。"}</p></div>
          <label><span>目标</span><textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="例如：完成登录模块" rows={3} disabled={busy} autoFocus /></label>
          <label><span>最大回合数 <em>可选</em></span><input type="number" min="1" step="1" value={maxRoundsDraft} onChange={(event) => onMaxRoundsChange(event.target.value)} placeholder="使用 DSH 默认值" disabled={busy} /></label>
          <div className="goal-management-empty-actions">
            <button type="submit" className="confirm" disabled={busy || !draft.trim()}>{busy ? "正在创建…" : "创建 Goal"}</button>
            {activeGoal && <button type="button" disabled={busy} onClick={() => setCreatingReplacement(false)}>返回当前 Goal</button>}
          </div>
        </form>
      )}
    </div>
  );
}
