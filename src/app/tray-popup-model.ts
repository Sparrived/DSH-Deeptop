export type TrayThemeMode = "system" | "light" | "dark";
export type ResolvedTrayTheme = "light" | "dark";

export interface TrayThemeStorage {
  getItem(key: string): string | null;
}

export interface TrayThemePreferences {
  mode: TrayThemeMode;
  fontFamily: string;
  themeCssPath: string;
  customCss: string;
}

interface TrayPopupSessionItem {
  sessionId: string;
  title: string;
  context?: string;
  status: string;
}

interface TrayPopupSnapshot {
  unread: TrayPopupSessionItem[];
  recent: TrayPopupSessionItem[];
  more: TrayPopupSessionItem[];
}

const DEFAULT_FONT_FAMILY = '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif';
const MAX_FONT_FAMILY_CHARS = 1000;
const MAX_THEME_PATH_CHARS = 2000;
const MAX_CUSTOM_CSS_CHARS = 500_000;

function parseThemeMode(value: string | null): TrayThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

/** Read the presentation-only subset shared by the main window and tray popup. */
export function readTrayThemePreferences(storage: TrayThemeStorage): TrayThemePreferences {
  const fallback: TrayThemePreferences = {
    mode: parseThemeMode(storage.getItem("deeptop.theme")),
    fontFamily: DEFAULT_FONT_FAMILY,
    themeCssPath: "",
    customCss: "",
  };
  try {
    const parsed = JSON.parse(storage.getItem("deeptop.appearance") || "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    const fontFamily = typeof parsed.fontFamily === "string"
      && parsed.fontFamily.trim()
      && parsed.fontFamily.length <= MAX_FONT_FAMILY_CHARS
      ? parsed.fontFamily
      : fallback.fontFamily;
    const themeCssPath = typeof parsed.themeCssPath === "string"
      && parsed.themeCssPath.length <= MAX_THEME_PATH_CHARS
      ? parsed.themeCssPath.trim()
      : "";
    const customCss = parsed.customCssEnabled === true
      && typeof parsed.customCss === "string"
      && parsed.customCss.length <= MAX_CUSTOM_CSS_CHARS
      ? parsed.customCss
      : "";
    return { ...fallback, fontFamily, themeCssPath, customCss };
  } catch {
    return fallback;
  }
}

/** Resolve the user's system/light/dark choice for the popup document. */
export function resolveTrayTheme(mode: TrayThemeMode, systemPrefersDark: boolean): ResolvedTrayTheme {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

function trayPopupItemsEqual(left: TrayPopupSessionItem[], right: TrayPopupSessionItem[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && item.sessionId === candidate.sessionId
      && item.title === candidate.title
      && item.context === candidate.context
      && item.status === candidate.status;
  });
}

/** Avoid rerendering the hidden popup when the projected session menu is unchanged. */
export function trayPopupSnapshotsEqual(left: TrayPopupSnapshot, right: TrayPopupSnapshot): boolean {
  return trayPopupItemsEqual(left.unread, right.unread)
    && trayPopupItemsEqual(left.recent, right.recent)
    && trayPopupItemsEqual(left.more, right.more);
}

/** Return the next focus index for a vertical menu, wrapping at both ends. */
export function nextTrayMenuIndex(key: string, currentIndex: number, itemCount: number): number | null {
  if (itemCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  if (key === "ArrowUp") return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
  return null;
}
