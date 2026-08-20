import assert from "node:assert/strict";
import test from "node:test";
import { missingAgentPresetInfo } from "./missing-preset.ts";

class DshApiError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

test("missingAgentPresetInfo reads structured DSH preset errors", () => {
  const info = missingAgentPresetInfo(new DshApiError(
    'agent-presets: preset "project-release" not found (available: standard, code)',
    { agentPreset: "project-release", available: ["standard", "code"] },
  ));
  assert.deepEqual(info, {
    missingPreset: "project-release",
    availablePresets: ["standard", "code"],
  });
});

test("missingAgentPresetInfo supports wrapped resume messages", () => {
  const info = missingAgentPresetInfo(new Error(
    'internal: resume failed for session "session-1": Error: agent-presets: preset "deleted" not found (available: standard, minimal)',
  ));
  assert.deepEqual(info, {
    missingPreset: "deleted",
    availablePresets: ["standard", "minimal"],
  });
});

test("missingAgentPresetInfo returns null for unrelated failures", () => {
  assert.equal(missingAgentPresetInfo(new Error("session log is corrupt")), null);
});
