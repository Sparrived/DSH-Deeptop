import type { DshSettingsDescription } from "../lib/desktop";

/**
 * Deepen the local theme ↔ Host `ui-theme` preference sync (pure helpers).
 *
 * The official `ui-theme` namespace carries one field `preference` with the
 * values `light | dark | system` (default `system`). The desktop registers the
 * same namespace through the bridge so the local appearance picker can
 * persist to and adopt from the shared settings.yaml — mirroring the official
 * web client's read/write path (settings.describe / settings.mutate).
 */

export type UiThemePreference = "light" | "dark" | "system";

const UI_THEME_NS = "ui-theme";

export function isUiThemePreference(value: unknown): value is UiThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Read the preference from a settings.describe result; undefined when absent. */
export function uiThemePreferenceFromSettings(settings: DshSettingsDescription | null | undefined): UiThemePreference | undefined {
  const namespace = settings?.namespaces.find((item) => item.ns === UI_THEME_NS);
  const preference = namespace && typeof namespace.value === "object" && namespace.value !== null
    ? (namespace.value as Record<string, unknown>).preference
    : undefined;
  return isUiThemePreference(preference) ? preference : undefined;
}

/** The mutate ops used to persist a preference through settings.mutate. */
export function uiThemePreferenceOps(preference: UiThemePreference): Array<{ op: "set"; path: string[]; value: unknown }> {
  return [{ op: "set", path: ["preference"], value: preference }];
}

/** Whether a document-updated host event targets the ui-theme namespace. */
export function isUiThemeDocumentUpdated(args: unknown[] | undefined): boolean {
  return Array.isArray(args) && args[0] === UI_THEME_NS;
}