import type { PromptMode } from "./model-types";

/**
 * Resolve what one submission gesture actually delivers.
 *
 * Plain Enter and the primary Send button share this gesture, so the button can
 * never deliver something Enter would not. An idle session has no turn to
 * steer: `agent.steer` would accept the message but classify it as a step-level
 * insertion rather than an ordinary user turn. The send-mode picker therefore
 * records a preference, while this resolution decides the delivery.
 *
 * @param preferred - the user's chosen send mode.
 * @param running - whether the addressed session currently reports a running turn.
 * @returns the mode to submit with.
 */
export function resolveSubmitMode(preferred: PromptMode, running: boolean): PromptMode {
  return running ? preferred : "queue";
}
