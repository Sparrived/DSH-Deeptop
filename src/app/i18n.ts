/**
 * 轻量 i18n：文案资源与语言切换。
 *
 * Deeptop 的 UI 文案以中文为主（WebUI 产品语言），英文资源覆盖全部用户
 * 可见文案。文案资源维护在 `src/app/locales/{zh,en}.json`（每语言一份
 * 扁平 key→文案 文件），新增语言只需新增一个 JSON 文件并扩展 `UiLocale`；
 * 缺失词条按「当前语言 → 英文 → 中文 → key」回退，界面不出现空洞；
 * `{name}` 占位符由 params 插值。
 *
 * 语言选择持久化到本地（`deeptop.locale`），并通过官方 `locale` 设置命名
 * 空间与 Host 共享（与 ui-theme 同一模式）；`locale` 缺省时回退中文。
 */

import zhMessages from "./locales/zh.json" with { type: "json" };
import enMessages from "./locales/en.json" with { type: "json" };

export type UiLocale = "zh" | "en";

export const UI_LOCALES: UiLocale[] = ["zh", "en"];

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "zh" || value === "en";
}

export const LOCALE_STORAGE_KEY = "deeptop.locale";
export const LOCALE_SETTINGS_NS = "locale";

/** 读取本地显式保存的语言；无效或缺失时返回 undefined。 */
export function storedLocalePreference(): UiLocale | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isUiLocale(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

/** 读取界面初始语言；本地没有显式选择时回退中文。 */
export function readStoredLocale(): UiLocale {
  return storedLocalePreference() ?? "zh";
}

export function writeStoredLocale(locale: UiLocale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The native webview may disable storage in a restricted preview.
  }
}

/** 从 settings.describe 中读取 Host locale 偏好（官方命名空间形状）。 */
export function localePreferenceFromSettings(settings: { namespaces?: Array<{ ns: string; value?: unknown }> } | null | undefined): UiLocale | undefined {
  const namespace = settings?.namespaces?.find((item) => item.ns === LOCALE_SETTINGS_NS);
  const preference = namespace && typeof namespace.value === "object" && namespace.value !== null
    ? (namespace.value as Record<string, unknown>).preference
    : undefined;
  return isUiLocale(preference) ? preference : undefined;
}

/** Host 写回 locale 偏好的 mutate ops。 */
export function localePreferenceOps(preference: UiLocale): Array<{ op: "set"; path: string[]; value: unknown }> {
  return [{ op: "set", path: ["preference"], value: preference }];
}

export function isLocaleDocumentUpdated(args: unknown[] | undefined): boolean {
  return Array.isArray(args) && args[0] === LOCALE_SETTINGS_NS;
}

/** 文案资源表：zh 为权威 key 集合，en 覆盖英文。 */
const written: Record<UiLocale, Record<string, string>> = {
  zh: zhMessages as Record<string, string>,
  en: enMessages as Record<string, string>,
};

export function t(key: string, locale: UiLocale, params?: Record<string, unknown>): string {
  const text = (written[locale]?.[key] ?? written.en[key] ?? written.zh[key]) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/gu, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function hasTranslation(key: string): boolean {
  return key in written.zh;
}