import type { DshProvider, DshSettingsNamespace } from "../lib/desktop";
import type { ProviderSettingsPatch } from "./model-types";

export function errorText(error: unknown) {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return typeof code === "string" ? `${code}: ${error.message}` : error.message;
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

export function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("设置内容必须是 JSON 对象");
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
