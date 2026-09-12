export type GoalBarPhase = "active" | "paused" | "blocked" | "complete" | undefined;

/** 已经处理过的 Goal 身份，用来判断什么时候该重新决定条状面板的展开状态。 */
export type GoalBarState = {
  initialized: boolean;
  goalId: string | null;
  phase: GoalBarPhase;
};

export function emptyGoalBarState(): GoalBarState {
  return { initialized: false, goalId: null, phase: undefined };
}

/** 没有 Goal 或 Goal 已完成时收起；进行中、暂停、受阻都应保持可见。 */
export function goalBarAutoCollapsed(phase: GoalBarPhase) {
  return phase === undefined || phase === "complete";
}

type GoalBarStateInput = {
  state: GoalBarState;
  projectionLoaded: boolean;
  goalId: string | null;
  phase: GoalBarPhase;
};

/**
 * 返回 `collapsed: null` 表示保持用户当前的折叠选择。
 * 只有三种时刻会覆盖它：首次拿到 projection、Goal 身份变化、以及进入受阻或完成阶段
 * （前者必须被看见，后者收敛成一行）。
 */
export function nextGoalBarState({ state, projectionLoaded, goalId, phase }: GoalBarStateInput): GoalBarState & { collapsed: boolean | null } {
  if (!projectionLoaded) return { ...state, collapsed: null };
  const decided = (collapsed: boolean) => ({ initialized: true, goalId, phase, collapsed });
  if (!state.initialized || goalId !== state.goalId) return decided(goalBarAutoCollapsed(phase));
  if (phase !== state.phase) {
    if (phase === "blocked" || phase === "complete" || state.phase === "complete") return decided(goalBarAutoCollapsed(phase));
    return { ...state, phase, collapsed: null };
  }
  return { ...state, collapsed: null };
}
