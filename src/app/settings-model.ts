import type { DshProvider, DshSettingsNamespace } from "../lib/desktop";
import type { ProviderSettingsPatch } from "./model-types";
import { t, type UiLocale } from "./i18n.ts";

/** 错误 code/reason → 文案 key 映射（文案资源见 locales/zh.json · settings.error.*）。 */
const ERROR_KEYS: Record<string, string> = {
  "model-unavailable": "settings.error.modelUnavailable",
  "invalid-time-zone": "settings.error.invalidTimezone",
  "attachment-error": "settings.error.imageRejected",
  ATTACHMENT_NOT_FOUND: "settings.error.attachmentMissing",
  IMAGE_DIMENSION_TOO_LARGE: "settings.error.imageDimensionTooLarge",
  IMAGE_TOO_MANY_PIXELS: "settings.error.imageTooManyPixels",
  IMAGE_PIXELS_TOO_LARGE: "settings.error.imageTooManyPixels",
  IMAGE_TOO_LARGE: "settings.error.imageTooLarge",
  TOO_MANY_IMAGES: "settings.error.tooManyImages",
  IMAGES_TOO_LARGE: "settings.error.imagesTooLarge",
  MESSAGE_IMAGE_BYTES_TOO_LARGE: "settings.error.imagesTooLarge",
  "reference-unavailable": "settings.error.referenceUnavailable",
  "session-not-found": "settings.error.sessionNotFound",
  "request-timeout": "settings.error.requestTimeout",
  "bridge-timeout": "settings.error.bridgeTimeout",
  "bridge-unavailable": "settings.error.bridgeUnavailable",
  "bridge-disconnected": "settings.error.bridgeDisconnected",
  "native-conflict": "settings.error.mcpNativeConflict",
  "workspace-unavailable": "settings.error.workspaceUnavailable",
};

function errorLabel(code: unknown, reason: string | undefined, locale: UiLocale): string | undefined {
  const key = (reason ? (reason in ERROR_KEYS ? reason : undefined) : undefined)
    ?? (typeof code === "string" ? (code in ERROR_KEYS ? code : undefined) : undefined);
  return key === undefined ? undefined : t(ERROR_KEYS[key], locale);
}

export function errorText(error: unknown, locale: UiLocale = "zh") {
  if (error instanceof Error) {
    const apiError = error as Error & { code?: unknown; details?: unknown };
    const code = apiError.code;
    const details = apiError.details && typeof apiError.details === "object" && !Array.isArray(apiError.details)
      ? apiError.details as Record<string, unknown>
      : undefined;
    const reason = typeof details?.reason === "string" ? details.reason : undefined;
    if (typeof code === "string" || reason !== undefined) {
      const label = errorLabel(code, reason, locale);
      if (label) return locale === "en" ? `${label} (${error.message})` : `${label}（${error.message}）`;
      return typeof code === "string" ? `${code}: ${error.message}` : error.message;
    }
    return error.message;
  }
  return String(error);
}
export function jsonText(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export function parseJsonObject(value: string, locale: UiLocale = "zh"): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(t("settings.error.notJsonObject", locale));
  }
  return parsed as Record<string, unknown>;
}

export function valueAtPath(value: unknown, path: string[]) {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function credentialRefForProvider(provider: DshProvider, namespace: DshSettingsNamespace | undefined) {
  const profile = valueAtPath(namespace?.value, provider.settingsPath);
  const named = profile && typeof profile === "object" && !Array.isArray(profile)
    ? (profile as Record<string, unknown>).apiKeyEnv
    : undefined;
  if (typeof named === "string" && named.trim()) return named;
  return `${provider.provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

export function providerProfile(provider: DshProvider, namespace: DshSettingsNamespace | undefined) {
  const profile = valueAtPath(namespace?.value, provider.settingsPath);
  return profile && typeof profile === "object" && !Array.isArray(profile) ? profile as Record<string, unknown> : undefined;
}

export function providerModels(provider: DshProvider, namespace: DshSettingsNamespace | undefined): Array<Record<string, unknown>> {
  const value = valueAtPath(namespace?.value, [...provider.settingsPath, "models"]);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string"));
}

/** Return whether one provider model declares the canonical Max effort. */
export function modelHasMaxReasoning(model: Record<string, unknown>): boolean {
  const efforts = model.reasoningEfforts;
  return Boolean(efforts && typeof efforts === "object" && !Array.isArray(efforts) && Object.prototype.hasOwnProperty.call(efforts, "max"));
}

/**
 * Toggle the canonical Max effort without changing the model's other fields.
 * Removing the last thinking level removes the declaration entirely because the
 * DSH profile schema rejects an empty or Off-only reasoning declaration.
 */
export function toggleModelMaxReasoning(model: Record<string, unknown>): Record<string, unknown> {
  const next = { ...model };
  const efforts = model.reasoningEfforts;
  if (efforts && typeof efforts === "object" && !Array.isArray(efforts)) {
    const nextEfforts = { ...(efforts as Record<string, unknown>) };
    if (Object.prototype.hasOwnProperty.call(nextEfforts, "max")) {
      delete nextEfforts.max;
      if (Object.keys(nextEfforts).some((key) => key !== "off")) next.reasoningEfforts = nextEfforts;
      else delete next.reasoningEfforts;
    } else {
      next.reasoningEfforts = { ...nextEfforts, max: "max" };
    }
  } else {
    next.reasoningEfforts = { max: "max" };
  }
  return next;
}

export function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function settingsOps(
  original: unknown,
  next: unknown,
  path: string[],
  secrets: string[][],
): Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> {
  const secretAt = secrets.some((secret) => secret.length === path.length && secret.every((part, index) => part === path[index]));
  if (secretAt) return [];
  if (sameJson(original, next)) return [];
  if (typeof original === "object" && original !== null && !Array.isArray(original)
    && typeof next === "object" && next !== null && !Array.isArray(next)) {
    const oldObject = original as Record<string, unknown>;
    const newObject = next as Record<string, unknown>;
    const keys = new Set([...Object.keys(oldObject), ...Object.keys(newObject)]);
    return [...keys].flatMap((key) => {
      const childPath = [...path, key];
      const secretDescendant = secrets.some((secret) => secret.slice(0, childPath.length).every((part, index) => part === childPath[index]));
      if (!(key in newObject)) return secretDescendant ? [] : [{ op: "unset", path: childPath }];
      if (!(key in oldObject) && !secretDescendant) return [{ op: "set", path: childPath, value: newObject[key] }];
      return settingsOps(oldObject[key], newObject[key], childPath, secrets);
    });
  }
  return path.length > 0 ? [{ op: "set", path, value: next }] : [];
}

export type SettingsPathOp = { op: "set" | "unset"; path: string[]; value?: unknown };

/**
 * Build the path ops for saving one configurable provider profile. Only the
 * fields named in `patch` are considered, and only when their value actually
 * differs from the profile currently resolved (`current`). A Provider save is
 * therefore strictly limited to the edited fields — it never rewrites
 * unchanged values and never emits a wholesale profile replacement that could
 * drop unrelated stored fields such as `apiKeyEnv`.
 */
export function providerSettingsOps(
  settingsPath: string[],
  current: Record<string, unknown> | undefined,
  patch: ProviderSettingsPatch,
): SettingsPathOp[] {
  const ops: SettingsPathOp[] = [];
  const before = current ?? {};
  for (const key of ["baseURL", "api"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    const previous = before[key];
    if (value) {
      if (previous === value) continue;
      ops.push({ op: "set", path: [...settingsPath, key], value });
    } else {
      if (previous === undefined) continue;
      ops.push({ op: "unset", path: [...settingsPath, key] });
    }
  }
  if ("models" in patch) {
    const previous = before.models;
    const next = patch.models;
    if (sameJson(previous, next)) return ops;
    if (Array.isArray(next) && next.length > 0) {
      ops.push({ op: "set", path: [...settingsPath, "models"], value: next });
    } else if (previous !== undefined) {
      ops.push({ op: "unset", path: [...settingsPath, "models"] });
    }
  }
  return ops;
}

/**
 * Build the op that records `ref` as the provider profile's `apiKeyEnv` so the
 * credential reference survives settings rewrites. Returns undefined when the
 * profile already names an `apiKeyEnv` — a key saved for such a provider is
 * stored under the existing reference instead of rewriting the profile.
 */
export function providerApiKeyEnvOp(
  settingsPath: string[],
  current: Record<string, unknown> | undefined,
  ref: string,
): SettingsPathOp | undefined {
  const named = current && typeof current === "object" && !Array.isArray(current)
    ? (current as Record<string, unknown>).apiKeyEnv
    : undefined;
  if (typeof named === "string" && named.trim()) return undefined;
  return { op: "set", path: [...settingsPath, "apiKeyEnv"], value: ref };
}
