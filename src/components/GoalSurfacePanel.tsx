import type { DshGoalProjection } from "../lib/desktop";

export type GoalAction = "edit" | "pause" | "resume" | "complete" | "clear";

interface GoalSurfacePanelProps {
  activeGoal: DshGoalProjection["goal"] | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onMutate: (action: GoalAction) => void | Promise<unknown>;
  onCreate: () => void | Promise<unknown>;
}

export function GoalSurfacePanel({ activeGoal, draft, onDraftChange, onMutate, onCreate }: GoalSurfacePanelProps) {
  return <div className="surface-content"><div className="surface-intro"><strong>Goal</strong><p>Goal 是会话级的持续目标，状态由 DSH projection 推送，操作使用 revision 做 CAS。</p></div>{activeGoal ? <div className="goal-panel"><div className="goal-status"><span>{activeGoal.phase}</span><strong>{activeGoal.objective}</strong></div>{activeGoal.blockedReason && <p className="surface-error">{activeGoal.blockedReason.message}</p>}<input value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="编辑目标" /><div className="surface-row-actions"><button onClick={() => void onMutate("edit")}>保存</button>{activeGoal.phase === "active" && <button onClick={() => void onMutate("pause")}>暂停</button>}{activeGoal.phase === "paused" && <button onClick={() => void onMutate("resume")}>恢复</button>}<button onClick={() => void onMutate("complete")}>完成</button><button onClick={() => void onMutate("clear")}>清除</button></div></div> : <div className="goal-panel"><p className="surface-muted">当前会话没有 Goal。</p><input value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onCreate(); }} placeholder="输入目标，例如：完成登录模块" /><button className="confirm" onClick={() => void onCreate()}>创建 Goal</button></div>}</div>;
}
