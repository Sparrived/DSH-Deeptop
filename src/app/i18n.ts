/**
 * 轻量 i18n：中英文资源与语言切换。
 *
 * Deeptop 的 UI 文案以中文为主（WebUI 产品语言），英文资源覆盖核心界面
 * （设置导航、主操作、会话列表、输入区）。`t()` 返回当前语言下的文案，
 * 未收录的 key 回退中文原文，避免界面出现空洞。
 *
 * 语言选择持久化到本地（`deeptop.locale`），并通过官方 `locale` 设置命名
 * 空间与 Host 共享（与 ui-theme 同一模式）；`locale` 缺省时回退中文。
 */

export type UiLocale = "zh" | "en";

export const UI_LOCALES: UiLocale[] = ["zh", "en"];

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "zh" || value === "en";
}

export const LOCALE_STORAGE_KEY = "deeptop.locale";
export const LOCALE_SETTINGS_NS = "locale";

/** 读取本地持久化的语言；无效或缺失时回退中文。 */
export function readStoredLocale(): UiLocale {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isUiLocale(saved) ? saved : "zh";
  } catch {
    return "zh";
  }
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

/** 文案目录：zh 原文 + en 翻译。缺失时 t() 回退中文。 */
const MESSAGES: Record<string, { zh: string; en: string }> = {
  // 设置导航
  "settings.title": { zh: "设置", en: "Settings" },
  "settings.appearance": { zh: "外观", en: "Appearance" },
  "settings.theme": { zh: "主题", en: "Theme" },
  "settings.background": { zh: "背景工作台", en: "Backgrounds" },
  "settings.typography": { zh: "文字", en: "Typography" },
  "settings.css": { zh: "CSS 主题", en: "CSS Theme" },
  "settings.general": { zh: "通用", en: "General" },
  "settings.dock": { zh: "Dock", en: "Dock" },
  "settings.keyboard": { zh: "按键", en: "Keyboard" },
  "settings.models": { zh: "模型", en: "Models" },
  "settings.presets": { zh: "Agent Preset", en: "Agent Presets" },
  "settings.plugins": { zh: "插件", en: "Plugins" },
  "settings.logs": { zh: "日志", en: "Logs" },
  "settings.about": { zh: "关于", en: "About" },
  "settings.pets": { zh: "宠物", en: "Pets" },
  "settings.language": { zh: "语言 / Language", en: "Language" },
  "settings.language.hint": { zh: "界面语言；会同步到 DSH 设置", en: "UI language; synced to DSH settings" },

  // 会话侧栏
  "sidebar.newSession": { zh: "新建会话", en: "New session" },
  "sidebar.search": { zh: "搜索会话", en: "Search sessions" },
  "sidebar.workspaces": { zh: "工作区", en: "Workspaces" },

  // 输入区
  "composer.placeholder": { zh: "输入消息，开始与 DSH 对话", en: "Type a message to start a conversation with DSH" },
  "composer.send": { zh: "发送消息", en: "Send message" },
  "composer.stop": { zh: "取消当前回合", en: "Stop current turn" },
  "composer.attach": { zh: "添加图片附件", en: "Attach images" },
  "composer.permission": { zh: "权限", en: "Permission" },

  // 通用操作
  "common.cancel": { zh: "取消", en: "Cancel" },
  "common.save": { zh: "保存", en: "Save" },
  "common.close": { zh: "关闭", en: "Close" },
  "common.delete": { zh: "删除", en: "Delete" },
  "common.copy": { zh: "复制", en: "Copy" },
  "common.retry": { zh: "重试", en: "Retry" },
  "common.open": { zh: "打开", en: "Open" },
  "common.confirm": { zh: "确认", en: "Confirm" },
};

export function t(key: string, locale: UiLocale): string {
  const message = MESSAGES[key];
  if (!message) return key;
  if (locale === "en" && message.en) return message.en;
  return message.zh;
}

export function hasTranslation(key: string): boolean {
  return key in MESSAGES;
}