export type GoalBarPhase = "active" | "paused" | "blocked" | "complete" | undefined;

type GoalBarStateInput = {
  initialized: boolean;
  projectionLoaded: boolean;
  phase: GoalBarPhase;
};

/** Keep the first loaded Goal collapsed; later Goal ID/phase changes retain the existing automatic expansion rule. */
export function nextGoalBarState({ initialized, projectionLoaded, phase }: GoalBarStateInput) {
  if (!projectionLoaded) return { initialized: false, collapsed: true };
  if (!initialized) return { initialized: true, collapsed: true };
  return { initialized: true, collapsed: phase === "complete" };
}
