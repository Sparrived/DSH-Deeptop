import type { ModelSelection } from "./model-types";

export const DEFAULT_MODEL_STORAGE_KEY = "deeptop.session-default-model";
export const DEFAULT_PERMISSION_STORAGE_KEY = "deeptop.session-default-permission";

export type DefaultPermission = "read-only" | "workspace-write" | "danger-full-access";

function isModelSelection(value: unknown): value is ModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.provider === "string"
    && record.provider.trim().length > 0
    && typeof record.model === "string"
    && record.model.trim().length > 0
    && (record.reasoningEffort === undefined || typeof record.reasoningEffort === "string");
}

export function readStoredDefaultModel(): ModelSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY) || "null");
    return isModelSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredDefaultModel(selection: ModelSelection) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // The native webview may disable storage in a restricted preview.
  }
}

export function readStoredDefaultPermission(): DefaultPermission | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(DEFAULT_PERMISSION_STORAGE_KEY);
    return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredDefaultPermission(value: DefaultPermission) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEFAULT_PERMISSION_STORAGE_KEY, value);
  } catch {
    // The native webview may disable storage in a restricted preview.
  }
}
