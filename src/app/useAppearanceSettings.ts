import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  AppearanceSettings,
  AppTheme,
  BackgroundConfig,
  BackgroundSettings,
  BackgroundZone,
} from "./model-types";
import {
  ensureThemeFiles,
  openThemesDirectory as openThemesDirectoryCommand,
  pickThemeCss,
  readThemeCss,
  type ThemeFilesInfo,
} from "../lib/desktop";

/** 背景图作用区域，顺序即工作台页面的展示顺序。 */
export const backgroundZones: BackgroundZone[] = ["global", "windowbar", "sidebar", "conversation", "composer", "dock"];

export const backgroundZoneLabels: Record<BackgroundZone, { label: string; hint: string }> = {
  global: { label: "全局", hint: "整个应用窗口的底层背景，未被其他区域覆盖时透出" },
  windowbar: { label: "标题栏", hint: "顶部窗口栏区域" },
  sidebar: { label: "侧栏", hint: "左侧会话侧栏" },
  conversation: { label: "对话栏", hint: "消息对话区域（含对话标题）" },
  composer: { label: "对话框", hint: "底部消息输入区域" },
  dock: { label: "工具面板", hint: "右侧待办 / 交付物 / 工作区文件 / 子 Agent 面板" },
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
  backgrounds: defaultBackgrounds(),
  customCss: "",
  customCssName: "",
  customCssEnabled: false,
  themeCssPath: "",
};

export const appearanceFontPresets = [
  { value: defaultAppearance.fontFamily, label: "系统无衬线" },
  { value: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif', label: "微软雅黑" },
  { value: '"Noto Sans SC", "Noto Sans CJK SC", sans-serif', label: "Noto Sans" },
  { value: 'Georgia, "Times New Roman", serif', label: "衬线阅读" },
];

export const appearanceCodeFontPresets = [
  { value: defaultAppearance.codeFontFamily, label: "Cascadia Mono" },
  { value: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', label: "JetBrains Mono" },
  { value: '"Sarasa Mono SC", "Cascadia Mono", Consolas, monospace', label: "更纱黑体 Mono" },
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
    return saved === "one-dark" || saved === "monokai-pro" || saved === "custom" ? saved : "monokai-pro";
  } catch {
    return "monokai-pro";
  }
}

type UseAppearanceSettingsOptions = {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export function useAppearanceSettings({ onNotice, onError }: UseAppearanceSettingsOptions) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(readAppearanceSettings);
  const [appTheme, setAppThemeState] = useState<AppTheme>(readAppTheme);
  const [themeFilesInfo, setThemeFilesInfo] = useState<ThemeFilesInfo | null>(null);
  const [themePathCss, setThemePathCss] = useState("");
  const [themePathError, setThemePathError] = useState("");
  const [themePathLoading, setThemePathLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  function updateAppearance(patch: Partial<AppearanceSettings>) {
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
      onNotice("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value || value.length > 4_000_000) {
        onError("背景图过大，请选择 3 MB 以内的图片");
        return;
      }
      updateBackground(zone, { image: value, name: file.name });
      onNotice(`已应用背景图：${file.name}`);
    });
    reader.addEventListener("error", () => onError("读取背景图失败"));
    reader.readAsDataURL(file);
  }

  function handleThemeFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".css") && file.type !== "text/css") {
      onNotice("请选择 CSS 文件");
      return;
    }
    if (file.size > 512_000) {
      onError("CSS 主题过大，请选择 512 KB 以内的文件");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value) {
        onError("CSS 主题为空");
        return;
      }
      if (value.length > 500_000) {
        onError("CSS 主题过大，请选择 500 KB 以内的文件");
        return;
      }
      updateAppearance({ customCss: value, customCssName: file.name, customCssEnabled: true });
      onNotice(`已导入 CSS 主题：${file.name}`);
    });
    reader.addEventListener("error", () => onError("读取 CSS 主题失败"));
    reader.readAsText(file);
  }

  /** 首次启动时确保默认主题文件就绪，并把空的主题路径补成默认的 Monokai Pro 外部文件。 */
  useEffect(() => {
    let cancelled = false;
    void ensureThemeFiles()
      .then((info) => {
        if (cancelled || !info) return;
        setThemeFilesInfo(info);
        setAppearance((current) => {
          if (current.themeCssPath.trim()) return current;
          const fallback = appTheme === "one-dark" ? info.oneDark : info.monokaiPro;
          return { ...current, themeCssPath: fallback };
        });
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
      onError("外观已应用，但背景图或 CSS 主题过大，重启后可能无法保留");
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
    if (value === "custom") return;
    if (!themeFilesInfo) {
      onNotice("内置主题仅在桌面端可用");
      return;
    }
    updateAppearance({
      themeCssPath: value === "one-dark" ? themeFilesInfo.oneDark : themeFilesInfo.monokaiPro,
    });
  }

  async function handlePickThemeCss() {
    try {
      const path = await pickThemeCss();
      if (!path) return;
      setAppThemeState("custom");
      updateAppearance({ themeCssPath: path });
      onNotice("已选择外部主题 CSS 文件");
    } catch (error) {
      onError(errorText(error));
    }
  }

  function reloadThemeCss() {
    setReloadToken((value) => value + 1);
    onNotice("正在重新加载主题 CSS");
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
      themeCssPath: themeFilesInfo ? themeFilesInfo.monokaiPro : current.themeCssPath,
    }));
    setAppThemeState("monokai-pro");
    onNotice("外观已恢复默认");
  }

  const appearanceFontPreset = useMemo(
    () => appearanceFontPresets.some((item) => item.value === appearance.fontFamily) ? appearance.fontFamily : "custom",
    [appearance.fontFamily],
  );
  const appearanceCodeFontPreset = useMemo(
    () => appearanceCodeFontPresets.some((item) => item.value === appearance.codeFontFamily) ? appearance.codeFontFamily : "custom",
    [appearance.codeFontFamily],
  );

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
    appearanceFontPreset,
    appearanceCodeFontPreset,
    appearanceFontPresets,
    appearanceCodeFontPresets,
    appTheme,
    themeFilesInfo,
    themePathError,
    themePathLoading,
    updateAppearance,
    updateBackground,
    clearBackground,
    handleBackgroundFile,
    handleThemeFile,
    setAppTheme,
    handlePickThemeCss,
    reloadThemeCss,
    openThemesDirectory,
    resetAppearance,
  };
}
