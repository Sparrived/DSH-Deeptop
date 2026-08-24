import type { DshProvider, DshSettingsNamespace } from "../lib/desktop";
import type { ProviderSettingsPatch } from "./model-types";
import type { UiLocale } from "./i18n.ts";

/** 面向用户的错误文案，zh/en 双份。 */
const ERROR_LABELS: Record<string, { zh: string; en: string }> = {
  "model-unavailable": { zh: "当前模型不可用，请检查 Provider 配置或切换模型", en: "The current model is unavailable. Check the Provider config or switch models." },
  "invalid-time-zone": { zh: "客户端时区无效，请重试", en: "Invalid client timezone. Please try again." },
  "attachment-error": { zh: "图片未通过当前部署的限制", en: "The image does not meet this deployment's limits." },
  IMAGE_DIMENSION_TOO_LARGE: { zh: "图片尺寸超过当前部署限制", en: "Image dimensions exceed this deployment's limits." },
  IMAGE_TOO_MANY_PIXELS: { zh: "图片像素数超过当前部署限制", en: "Image pixel count exceeds this deployment's limits." },
  IMAGE_PIXELS_TOO_LARGE: { zh: "图片像素数超过当前部署限制", en: "Image pixel count exceeds this deployment's limits." },
  IMAGE_TOO_LARGE: { zh: "图片大小超过当前部署限制", en: "Image size exceeds this deployment's limits." },
  TOO_MANY_IMAGES: { zh: "图片数量超过当前部署限制", en: "Image count exceeds this deployment's limits." },
  IMAGES_TOO_LARGE: { zh: "本条消息的图片总大小超过当前部署限制", en: "Total image size for this message exceeds this deployment's limits." },
  MESSAGE_IMAGE_BYTES_TOO_LARGE: { zh: "本条消息的图片总大小超过当前部署限制", en: "Total image size for this message exceeds this deployment's limits." },
  "reference-unavailable": { zh: "引用服务当前不可用", en: "The reference service is currently unavailable." },
  "session-not-found": { zh: "目标会话不存在或已关闭", en: "The target session does not exist or has been closed." },
  "request-timeout": { zh: "DSH 请求超时，请重试", en: "DSH request timed out. Please try again." },
  "bridge-timeout": { zh: "DSH 响应超时，请重试", en: "DSH response timed out. Please try again." },
  "bridge-unavailable": { zh: "DSH 运行时未就绪或已退出，请等待恢复或重启 Deeptop", en: "The DSH runtime is not ready or has exited. Wait for it to recover or restart Deeptop." },
  "bridge-disconnected": { zh: "DSH 响应通道已断开，请重启 Deeptop", en: "The DSH response channel disconnected. Restart Deeptop." },
  "workspace-unavailable": { zh: "工作区目录当前不可用（磁盘未连接、目录被移动或删除），无法确认会话归属", en: "The workspace directory is currently unavailable (disk disconnected, or the directory was moved or deleted), so session ownership cannot be confirmed." },
};

function errorLabel(code: unknown, reason: string | undefined, locale: UiLocale): string | undefined {
  const key = (reason ? (reason in ERROR_LABELS ? reason : undefined) : undefined)
    ?? (typeof code === "string" ? (code in ERROR_LABELS ? code : undefined) : undefined);
  if (key === undefined) return undefined;
  const pair = ERROR_LABELS[key];
  return locale === "en" ? pair.en : pair.zh;
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
    throw new Error(locale === "en" ? "Settings content must be a JSON object" : "设置内容必须是 JSON 对象");
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
