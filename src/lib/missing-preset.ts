export interface MissingAgentPresetInfo {
  missingPreset: string;
  availablePresets: string[];
}

/** Extract the explicit replacement choices from a missing-preset resume error. */
export function missingAgentPresetInfo(error: unknown): MissingAgentPresetInfo | null {
  const candidate = error as { code?: unknown; details?: unknown };
  const details = candidate?.code !== "agent-preset-not-found"
    ? null
    : typeof candidate.details === "object" && candidate.details !== null
    ? candidate.details as Record<string, unknown>
    : null;
  const detailPreset = details?.agentPreset;
  const detailAvailable = details?.available;
  if (typeof detailPreset === "string") {
    return {
      missingPreset: detailPreset,
      availablePresets: Array.isArray(detailAvailable)
        ? detailAvailable.filter((item): item is string => typeof item === "string")
        : [],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /agent-presets: preset "([^"]+)" not found \(available: ([^)]*)\)/.exec(message);
  if (!match) return null;
  return {
    missingPreset: match[1],
    availablePresets: match[2] === "none"
      ? []
      : match[2].split(",").map((item) => item.trim()).filter(Boolean),
  };
}
