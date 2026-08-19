export type WindowCloseBehavior = "ask" | "hide-to-tray" | "exit";

export type WindowBehaviorSettings = {
  minimizeToTray: boolean;
  closeBehavior: WindowCloseBehavior;
};

export const DEFAULT_WINDOW_BEHAVIOR: WindowBehaviorSettings = {
  minimizeToTray: false,
  closeBehavior: "ask",
};

export function normalizeWindowBehavior(value: unknown): WindowBehaviorSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_WINDOW_BEHAVIOR };
  const candidate = value as Record<string, unknown>;
  const closeBehavior: WindowCloseBehavior = candidate.closeBehavior === "hide-to-tray" || candidate.closeBehavior === "exit"
    ? candidate.closeBehavior
    : "ask";
  return {
    minimizeToTray: candidate.minimizeToTray === true,
    closeBehavior,
  };
}

export function nextCloseBehavior(current: WindowBehaviorSettings, choice: "hide-to-tray" | "exit" | null): WindowBehaviorSettings {
  return choice ? { ...current, closeBehavior: choice } : current;
}
