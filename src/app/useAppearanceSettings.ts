import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AppearanceSettings } from "./model-types";

export const defaultAppearance: AppearanceSettings = {
  fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  codeFontFamily: '"Cascadia Mono", Consolas, monospace',
  messageFontSize: 15,
  messageLineHeight: 1.7,
  backgroundImage: "",
  backgroundName: "",
  backgroundOpacity: 0.18,
  backgroundBlur: 0,
  backgroundSize: "cover",
  backgroundPosition: "center",
  customCss: "",
  customCssName: "",
  customCssEnabled: false,
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

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function readAppearanceSettings(): AppearanceSettings {
  try {
    const value = JSON.parse(localStorage.getItem("deeptop.appearance") || "null") as Partial<AppearanceSettings> | null;
    if (!value || typeof value !== "object") return defaultAppearance;
    const customCss = typeof value.customCss === "string" && value.customCss.length <= 500_000 ? value.customCss : "";
    const backgroundPosition = ["center", "top", "bottom", "left", "right"].includes(String(value.backgroundPosition))
      ? value.backgroundPosition as AppearanceSettings["backgroundPosition"]
      : defaultAppearance.backgroundPosition;
    return {
      ...defaultAppearance,
      ...value,
      fontFamily: typeof value.fontFamily === "string" && value.fontFamily.trim() ? value.fontFamily : defaultAppearance.fontFamily,
      codeFontFamily: typeof value.codeFontFamily === "string" && value.codeFontFamily.trim() ? value.codeFontFamily : defaultAppearance.codeFontFamily,
      messageFontSize: boundedNumber(value.messageFontSize, defaultAppearance.messageFontSize, 14, 18),
      messageLineHeight: boundedNumber(value.messageLineHeight, defaultAppearance.messageLineHeight, 1.35, 2.2),
      backgroundImage: typeof value.backgroundImage === "string" && /^(?:https?:|data:image\/)/i.test(value.backgroundImage) ? value.backgroundImage : "",
      backgroundName: typeof value.backgroundName === "string" ? value.backgroundName : "",
      backgroundOpacity: boundedNumber(value.backgroundOpacity, defaultAppearance.backgroundOpacity, 0.05, 0.45),
      backgroundBlur: boundedNumber(value.backgroundBlur, defaultAppearance.backgroundBlur, 0, 16),
      backgroundSize: value.backgroundSize === "contain" ? "contain" : "cover",
      backgroundPosition,
      customCss,
      customCssName: customCss && typeof value.customCssName === "string" ? value.customCssName : "",
      customCssEnabled: value.customCssEnabled === true && Boolean(customCss),
    };
  } catch {
    return defaultAppearance;
  }
}

type UseAppearanceSettingsOptions = {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export function useAppearanceSettings({ onNotice, onError }: UseAppearanceSettingsOptions) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(readAppearanceSettings);

  function updateAppearance(patch: Partial<AppearanceSettings>) {
    setAppearance((current) => ({ ...current, ...patch }));
  }

  function handleBackgroundFile(file: File | undefined) {
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
      updateAppearance({ backgroundImage: value, backgroundName: file.name });
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

  function resetAppearance() {
    setAppearance(defaultAppearance);
    onNotice("外观已恢复默认");
  }

  useEffect(() => {
    try {
      localStorage.setItem("deeptop.appearance", JSON.stringify(appearance));
    } catch {
      onError("外观已应用，但背景图或 CSS 主题过大，重启后可能无法保留");
    }
  }, [appearance, onNotice, onError]);

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

  const appearanceFontPreset = useMemo(
    () => appearanceFontPresets.some((item) => item.value === appearance.fontFamily) ? appearance.fontFamily : "custom",
    [appearance.fontFamily],
  );
  const appearanceCodeFontPreset = useMemo(
    () => appearanceCodeFontPresets.some((item) => item.value === appearance.codeFontFamily) ? appearance.codeFontFamily : "custom",
    [appearance.codeFontFamily],
  );
  const appearanceStyle = useMemo(() => ({
    "--app-font-family": appearance.fontFamily,
    "--mono": appearance.codeFontFamily,
    "--message-font-size": `${appearance.messageFontSize}px`,
    "--message-line-height": String(appearance.messageLineHeight),
    "--app-background-image": appearance.backgroundImage ? `url(${JSON.stringify(appearance.backgroundImage)})` : "none",
    "--app-background-opacity": String(appearance.backgroundOpacity),
    "--app-background-blur": `${appearance.backgroundBlur}px`,
    "--app-background-size": appearance.backgroundSize,
    "--app-background-position": appearance.backgroundPosition,
  } as CSSProperties), [appearance]);

  return {
    appearance,
    appearanceStyle,
    appearanceFontPreset,
    appearanceCodeFontPreset,
    appearanceFontPresets,
    appearanceCodeFontPresets,
    updateAppearance,
    handleBackgroundFile,
    handleThemeFile,
    resetAppearance,
  };
}
