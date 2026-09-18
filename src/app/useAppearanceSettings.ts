import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { t, type UiLocale } from "./i18n.ts";
import type {
  AppearanceSettings,
  AppTheme,
  BackgroundConfig,
  BackgroundSettings,
  BackgroundZone,
} from "./model-types";
import { defaultWorkingIndicator, normalizeWorkingIndicator } from "./working-indicator";
import { defaultToolEffect, normalizeToolEffect, toolEffectClass, toolEffectInk } from "./tool-effect";
import {
  ensureThemeFiles,
  openThemesDirectory as openThemesDirectoryCommand,
  pickThemeCss,
  readThemeCss,
  scanThemes as scanThemesCommand,
  type ThemeFilesInfo,
} from "../lib/desktop";

/** 内置主题按显示顺序排列的固定清单；外部主题（themes/ 下用户放入的）按字母序追加。 */
export const BUILTIN_THEME_IDS: readonly AppTheme[] = ["monokai-pro", "one-dark", "gov"] as const;
const DEFAULT_THEME_ID: AppTheme = "monokai-pro";
const CUSTOM_THEME_ID: AppTheme = "custom";

/** 给定主题 id 与 themesDir，拼接 `<themesDir>/<id>.css` 绝对路径。custom 不走此约定。 */
export function themeCssPathFor(themesDir: string | null | undefined, id: AppTheme): string {
  if (id === CUSTOM_THEME_ID) return "";
  if (!themesDir) return "";
  const safeId = id.replace(/[\\/:*?"<>|]/g, "_");
  return `${themesDir.replace(/[\\/]+$/, "")}/${safeId}.css`;
}

/** 背景图作用区域，顺序即工作台页面的展示顺序。 */
export const backgroundZones: BackgroundZone[] = ["global", "windowbar", "sidebar", "conversation", "composer", "dock"];

export const backgroundZoneLabels: Record<BackgroundZone, { labelKey: string; hintKey: string }> = {
  global: { labelKey: "background.zone.global.label", hintKey: "background.zone.global.hint" },
  windowbar: { labelKey: "background.zone.windowbar.label", hintKey: "background.zone.windowbar.hint" },
  sidebar: { labelKey: "background.zone.sidebar.label", hintKey: "background.zone.sidebar.hint" },
  conversation: { labelKey: "background.zone.conversation.label", hintKey: "background.zone.conversation.hint" },
  composer: { labelKey: "background.zone.composer.label", hintKey: "background.zone.composer.hint" },
  dock: { labelKey: "background.zone.dock.label", hintKey: "background.zone.dock.hint" },
};

/** 各区域面板表面的默认不透明度（%）；global 无独立面板，不使用该值。 */
export const defaultPanelOpacity: Record<BackgroundZone, number> = {
  global: 100,
  windowbar: 94,
  sidebar: 92,
  conversation: 91,
  composer: 91,
  dock: 92,
};

export function defaultBackgroundConfig(zone?: BackgroundZone): BackgroundConfig {
  return {
    image: "",
    name: "",
    opacity: 0.18,
    panelOpacity: zone ? defaultPanelOpacity[zone] : 86,
    blur: 0,
    size: "cover",
    position: "center",
  };
}

export function defaultBackgrounds(): BackgroundSettings {
  return {
    global: defaultBackgroundConfig("global"),
    windowbar: defaultBackgroundConfig("windowbar"),
    sidebar: defaultBackgroundConfig("sidebar"),
    conversation: defaultBackgroundConfig("conversation"),
    composer: defaultBackgroundConfig("composer"),
    dock: defaultBackgroundConfig("dock"),
  };
}

/** 只要任意区域设置了背景图，或手动调整了某区域面板不透明度，应用就进入自定义背景模式。 */
export function hasAnyBackground(backgrounds: BackgroundSettings): boolean {
  return backgroundZones.some((zone) => {
    const config = backgrounds[zone];
    if (!config) return false;
    if (config.image) return true;
    if (zone !== "global" && config.panelOpacity !== defaultPanelOpacity[zone]) return true;
    return false;
  });
}

export const defaultAppearance: AppearanceSettings = {
  fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  codeFontFamily: '"Cascadia Mono", Consolas, monospace',
  messageFontSize: 15,
  messageLineHeight: 1.7,
  streamingFadeDuration: 520,
  streamingFadeInk: 0.3,
  workingIndicator: defaultWorkingIndicator,
  toolEffect: defaultToolEffect,
  backgrounds: defaultBackgrounds(),
  customCss: "",
  customCssName: "",
  customCssEnabled: false,
  themeCssPath: "",
};

export const appearanceFontPresets = [
  { value: defaultAppearance.fontFamily, labelKey: "appearance.font.system" },
  { value: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif', labelKey: "appearance.font.yahei" },
  { value: '"Noto Sans SC", "Noto Sans CJK SC", sans-serif', labelKey: "appearance.font.notoSans" },
  { value: 'Georgia, "Times New Roman", serif', labelKey: "appearance.font.serif" },
];

export const appearanceCodeFontPresets = [
  { value: defaultAppearance.codeFontFamily, labelKey: "appearance.codeFont.cascadia" },
  { value: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', labelKey: "appearance.codeFont.jetbrainsMono" },
  { value: '"Sarasa Mono SC", "Cascadia Mono", Consolas, monospace', labelKey: "appearance.codeFont.sarasa" },
];

const THEME_CSS_PATH_MAX = 2000;
const BACKGROUND_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBackgroundConfig(value: unknown, fallback?: BackgroundConfig): BackgroundConfig {
  const defaults = fallback ?? defaultBackgroundConfig();
  if (!value || typeof value !== "object") return defaults;
  const record = value as Partial<BackgroundConfig>;
  return {
    image: typeof record.image === "string" && /^(?:https?:|data:image\/)/i.test(record.image) ? record.image : "",
    name: typeof record.name === "string" ? record.name : "",
    opacity: boundedNumber(record.opacity, defaults.opacity, 0.05, 0.45),
    panelOpacity: boundedNumber(record.panelOpacity, defaults.panelOpacity, 0, 100),
    blur: boundedNumber(record.blur, defaults.blur, 0, 16),
    size: record.size === "contain" ? "contain" : "cover",
    position: BACKGROUND_POSITIONS.includes(record.position as (typeof BACKGROUND_POSITIONS)[number])
      ? record.position as BackgroundConfig["position"]
      : defaults.position,
  };
}

type LegacyAppearance = Partial<AppearanceSettings> & {
  backgroundImage?: unknown;
  backgroundName?: unknown;
  backgroundOpacity?: unknown;
  backgroundBlur?: unknown;
  backgroundSize?: unknown;
  backgroundPosition?: unknown;
};

/** 从存储值解析分区背景；兼容旧版扁平字段（迁移到 global）。 */
function migrateBackgrounds(value: LegacyAppearance): BackgroundSettings {
  const backgrounds = defaultBackgrounds();
  if (value.backgrounds && typeof value.backgrounds === "object") {
    const record = value.backgrounds as Record<string, unknown>;
    for (const zone of backgroundZones) {
      backgrounds[zone] = parseBackgroundConfig(record[zone], defaultBackgrounds()[zone]);
    }
    return backgrounds;
  }
  if (typeof value.backgroundImage === "string" && /^(?:https?:|data:image\/)/i.test(value.backgroundImage)) {
    backgrounds.global = {
      ...backgrounds.global,
      image: value.backgroundImage,
      name: typeof value.backgroundName === "string" ? value.backgroundName : "",
      opacity: boundedNumber(value.backgroundOpacity, backgrounds.global.opacity, 0.05, 0.45),
      blur: boundedNumber(value.backgroundBlur, backgrounds.global.blur, 0, 16),
      size: value.backgroundSize === "contain" ? "contain" : "cover",
      position: BACKGROUND_POSITIONS.includes(value.backgroundPosition as (typeof BACKGROUND_POSITIONS)[number])
        ? value.backgroundPosition as BackgroundConfig["position"]
        : backgrounds.global.position,
    };
  }
  return backgrounds;
}

function readAppearanceSettings(): AppearanceSettings {
  try {
    const value = JSON.parse(localStorage.getItem("deeptop.appearance") || "null") as LegacyAppearance | null;
    if (!value || typeof value !== "object") return defaultAppearance;
    const customCss = typeof value.customCss === "string" && value.customCss.length <= 500_000 ? value.customCss : "";
    const themeCssPath = typeof value.themeCssPath === "string" && value.themeCssPath.length <= THEME_CSS_PATH_MAX
      ? value.themeCssPath
      : "";
    return {
      ...defaultAppearance,
      ...value,
      fontFamily: typeof value.fontFamily === "string" && value.fontFamily.trim() ? value.fontFamily : defaultAppearance.fontFamily,
      codeFontFamily: typeof value.codeFontFamily === "string" && value.codeFontFamily.trim() ? value.codeFontFamily : defaultAppearance.codeFontFamily,
      messageFontSize: boundedNumber(value.messageFontSize, defaultAppearance.messageFontSize, 14, 18),
      messageLineHeight: boundedNumber(value.messageLineHeight, defaultAppearance.messageLineHeight, 1.35, 2.2),
      streamingFadeDuration: boundedNumber(value.streamingFadeDuration, defaultAppearance.streamingFadeDuration, 150, 1500),
      streamingFadeInk: boundedNumber(value.streamingFadeInk, defaultAppearance.streamingFadeInk, 0.05, 1),
      workingIndicator: normalizeWorkingIndicator(value.workingIndicator),
      toolEffect: normalizeToolEffect(value.toolEffect),
      backgrounds: migrateBackgrounds(value),
      customCss,
      customCssName: customCss && typeof value.customCssName === "string" ? value.customCssName : "",
      customCssEnabled: value.customCssEnabled === true && Boolean(customCss),
      themeCssPath,
    };
  } catch {
    return defaultAppearance;
  }
}

function readAppTheme(): AppTheme {
  try {
    const saved = localStorage.getItem("deeptop.dark-theme");
    // 接受任意非空字符串主题 id（用户可能在 themes/ 里放过自定义主题）；
    // 空字符串或非字符串则回退到默认主题。
    if (typeof saved === "string" && saved.length > 0 && saved.length <= 200) return saved;
  } catch {
    // 存储不可用时回退到默认。
  }
  return DEFAULT_THEME_ID;
}

type UseAppearanceSettingsOptions = {
  locale: UiLocale;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export function useAppearanceSettings({ locale, onNotice, onError }: UseAppearanceSettingsOptions) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(readAppearanceSettings);
  const [appTheme, setAppThemeState] = useState<AppTheme>(readAppTheme);
  const [themeFilesInfo, setThemeFilesInfo] = useState<ThemeFilesInfo | null>(null);
  const [themePathCss, setThemePathCss] = useState("");
  const [themePathError, setThemePathError] = useState("");
  const [themePathLoading, setThemePathLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [themeIds, setThemeIds] = useState<string[]>([]);

  function updateAppearance(patch: Partial<AppearanceSettings>) {
    // Field-level edits may temporarily contain an empty line while the user types;
    // persisted values are normalized again when the app starts or imports a config.
    setAppearance((current) => ({ ...current, ...patch }));
  }

  function updateBackground(zone: BackgroundZone, patch: Partial<BackgroundConfig>) {
    setAppearance((current) => ({
      ...current,
      backgrounds: {
        ...current.backgrounds,
        [zone]: { ...current.backgrounds[zone], ...patch },
      },
    }));
  }

  function clearBackground(zone: BackgroundZone) {
    setAppearance((current) => ({
      ...current,
      backgrounds: {
        ...current.backgrounds,
        [zone]: { ...current.backgrounds[zone], image: "", name: "" },
      },
    }));
  }

  function handleBackgroundFile(zone: BackgroundZone, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onNotice(t("appearance.notice.imageType", locale));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value || value.length > 4_000_000) {
        onError(t("appearance.notice.imageTooLarge", locale));
        return;
      }
      updateBackground(zone, { image: value, name: file.name });
      onNotice(t("appearance.notice.imageApplied", locale, { name: file.name }));
    });
    reader.addEventListener("error", () => onError(t("appearance.notice.imageReadFailed", locale)));
    reader.readAsDataURL(file);
  }

  function handleThemeFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".css") && file.type !== "text/css") {
      onNotice(t("appearance.notice.cssType", locale));
      return;
    }
    if (file.size > 512_000) {
      onError(t("appearance.notice.cssTooLarge512", locale));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value) {
        onError(t("appearance.notice.cssEmpty", locale));
        return;
      }
      if (value.length > 500_000) {
        onError(t("appearance.notice.cssTooLarge500", locale));
        return;
      }
      updateAppearance({ customCss: value, customCssName: file.name, customCssEnabled: true });
      onNotice(t("appearance.notice.cssImported", locale, { name: file.name }));
    });
    reader.addEventListener("error", () => onError(t("appearance.notice.cssReadFailed", locale)));
    reader.readAsText(file);
  }

  /** 首次启动时确保默认主题文件就绪，并扫描 themes/ 下所有可用主题 id；空的主题路径补成当前 appTheme 对应的外部文件。 */
  useEffect(() => {
    let cancelled = false;
    void ensureThemeFiles()
      .then((info) => {
        if (cancelled || !info) return;
        setThemeFilesInfo(info);
        setAppearance((current) => {
          if (current.themeCssPath.trim()) return current;
          if (appTheme === CUSTOM_THEME_ID) return current;
          return { ...current, themeCssPath: themeCssPathFor(info.themesDir, appTheme) };
        });
        return scanThemesCommand();
      })
      .then((ids) => {
        if (cancelled || !ids) return;
        setThemeIds(ids);
      })
      .catch(() => {
        // 浏览器预览等场景没有桌面桥，保持内置兜底配色。
      });
    return () => {
      cancelled = true;
    };
    // 仅在挂载时执行一次：appTheme 取初始值即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 用户主动"重新扫描"：从 themes/ 重新拉取主题 id 列表。 */
  const rescanThemes = useCallback(async () => {
    try {
      const ids = await scanThemesCommand();
      setThemeIds(ids);
      onNotice(t("appearance.notice.themesRescanned", locale, { count: ids.length }));
    } catch (error) {
      onError(errorText(error));
    }
  }, [locale, onNotice, onError]);

  /** 按主题路径读取外部 CSS（输入防抖，停顿后读取）；路径为空或读取失败时清空已注入内容。 */
  useEffect(() => {
    const path = appearance.themeCssPath.trim();
    if (!path) {
      setThemePathCss("");
      setThemePathError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setThemePathLoading(true);
      readThemeCss(path)
        .then((result) => {
          if (cancelled) return;
          setThemePathCss(result.content);
          setThemePathError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setThemePathCss("");
          setThemePathError(errorText(error));
        })
        .finally(() => {
          if (!cancelled) setThemePathLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [appearance.themeCssPath, reloadToken]);

  /** 把外部主题 CSS 注入为独立的 <style>，与「导入 CSS」互不覆盖。 */
  useEffect(() => {
    const styleId = "deeptop-theme-path";
    const existing = document.getElementById(styleId);
    if (!appearance.themeCssPath.trim() || !themePathCss) {
      existing?.remove();
      return;
    }
    const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
    style.id = styleId;
    style.textContent = themePathCss;
    if (!style.isConnected) document.head.appendChild(style);
    return () => style.remove();
  }, [appearance.themeCssPath, themePathCss]);

  useEffect(() => {
    try {
      localStorage.setItem("deeptop.appearance", JSON.stringify(appearance));
    } catch {
      onError(t("appearance.notice.persistFailed", locale));
    }
  }, [appearance, onNotice, onError]);

  useEffect(() => {
    try {
      localStorage.setItem("deeptop.dark-theme", appTheme);
    } catch {
      // 持久化失败不阻塞使用。
    }
  }, [appTheme]);

  useEffect(() => {
    const styleId = "deeptop-imported-theme";
    const existing = document.getElementById(styleId);
    if (!appearance.customCssEnabled || !appearance.customCss) {
      existing?.remove();
      return;
    }
    const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
    style.id = styleId;
    style.textContent = appearance.customCss;
    if (!style.isConnected) document.head.appendChild(style);
    return () => style.remove();
  }, [appearance.customCss, appearance.customCssEnabled]);

  function setAppTheme(value: AppTheme) {
    setAppThemeState(value);
    if (value === CUSTOM_THEME_ID) return;
    if (!themeFilesInfo) {
      onNotice(t("appearance.notice.themeDesktopOnly", locale));
      return;
    }
    updateAppearance({
      themeCssPath: themeCssPathFor(themeFilesInfo.themesDir, value),
    });
  }

  async function handlePickThemeCss() {
    try {
      const path = await pickThemeCss();
      if (!path) return;
      setAppThemeState("custom");
      updateAppearance({ themeCssPath: path });
      onNotice(t("appearance.notice.themePicked", locale));
    } catch (error) {
      onError(errorText(error));
    }
  }

  function reloadThemeCss() {
    setReloadToken((value) => value + 1);
    onNotice(t("appearance.notice.reloadTheme", locale));
  }

  async function openThemesDirectory() {
    try {
      await openThemesDirectoryCommand();
    } catch (error) {
      onError(errorText(error));
    }
  }

  function resetAppearance() {
    setAppearance((current) => ({
      ...defaultAppearance,
      workingIndicator: { ...defaultWorkingIndicator, texts: [...defaultWorkingIndicator.texts] },
      toolEffect: { ...defaultToolEffect },
      themeCssPath: themeFilesInfo ? themeCssPathFor(themeFilesInfo.themesDir, DEFAULT_THEME_ID) : current.themeCssPath,
    }));
    setAppThemeState(DEFAULT_THEME_ID);
    onNotice(t("appearance.notice.resetDefault", locale));
  }

  const appearanceFontPreset = useMemo(
    () => appearanceFontPresets.some((item) => item.value === appearance.fontFamily) ? appearance.fontFamily : "custom",
    [appearance.fontFamily],
  );
  const appearanceCodeFontPreset = useMemo(
    () => appearanceCodeFontPresets.some((item) => item.value === appearance.codeFontFamily) ? appearance.codeFontFamily : "custom",
    [appearance.codeFontFamily],
  );

  /** 工具特效的 class 只随设置变化，跟外观对象一起记忆，避免流式期间反复重算。 */
  const appearanceToolEffectClass = useMemo(() => toolEffectClass(appearance.toolEffect), [appearance.toolEffect]);

  /** 生成全局 + 各分区的 CSS 变量，驱动 styles.css 中的背景图层。 */
  const appearanceStyle = useMemo(() => {
    const backgroundUrl = (zone: BackgroundZone) => {
      const config = appearance.backgrounds[zone];
      return config.image ? `url(${JSON.stringify(config.image)})` : "none";
    };
    const style: Record<string, string> = {
      "--app-font-family": appearance.fontFamily,
      "--mono": appearance.codeFontFamily,
      "--message-font-size": `${appearance.messageFontSize}px`,
      "--message-line-height": String(appearance.messageLineHeight),
      "--stream-fade-duration": `${appearance.streamingFadeDuration}ms`,
      "--stream-fade-ink": String(appearance.streamingFadeInk),
      "--working-indicator-color": appearance.workingIndicator.color,
      "--working-indicator-gradient-color": appearance.workingIndicator.gradientColor,
      "--tool-effect-ink": toolEffectInk(appearance.toolEffect),
      "--app-background-image": backgroundUrl("global"),
      "--app-background-opacity": String(appearance.backgrounds.global.opacity),
      "--app-background-blur": `${appearance.backgrounds.global.blur}px`,
      "--app-background-size": appearance.backgrounds.global.size,
      "--app-background-position": appearance.backgrounds.global.position,
    };
    for (const zone of backgroundZones) {
      if (zone === "global") continue;
      const config = appearance.backgrounds[zone];
      style[`--bg-${zone}-image`] = backgroundUrl(zone);
      style[`--bg-${zone}-opacity`] = String(config.opacity);
      style[`--bg-${zone}-panel-opacity`] = `${config.panelOpacity}%`;
      style[`--bg-${zone}-blur`] = `${config.blur}px`;
      style[`--bg-${zone}-size`] = config.size;
      style[`--bg-${zone}-position`] = config.position;
    }
    return style as CSSProperties;
  }, [appearance]);

  return {
    appearance,
    appearanceStyle,
    appearanceToolEffectClass,
    appearanceFontPreset,
    appearanceCodeFontPreset,
    appearanceFontPresets,
    appearanceCodeFontPresets,
    appTheme,
    themeFilesInfo,
    themePathError,
    themePathLoading,
    themeIds,
    updateAppearance,
    updateBackground,
    clearBackground,
    handleBackgroundFile,
    handleThemeFile,
    setAppTheme,
    handlePickThemeCss,
    reloadThemeCss,
    openThemesDirectory,
    rescanThemes,
    resetAppearance,
  };
}
