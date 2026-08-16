export const SEND_SHORTCUT_OPTIONS = ["Enter", "Ctrl+Enter"] as const;
export type SendShortcut = typeof SEND_SHORTCUT_OPTIONS[number];
export const DEFAULT_SEND_SHORTCUT: SendShortcut = "Enter";
export const SEND_SHORTCUT_STORAGE_KEY = "deeptop.send-shortcut";

type ShortcutKeyboardEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> & { isComposing?: boolean };

export function isSendShortcut(value: string | null | undefined): value is SendShortcut {
  return value === "Enter" || value === "Ctrl+Enter";
}

export function shortcutMatches(event: ShortcutKeyboardEvent, shortcut: SendShortcut) {
  if (event.isComposing || event.key !== "Enter") return false;
  if (shortcut === "Enter") {
    return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  }
  return event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

export function readSendShortcut() {
  if (typeof window === "undefined") return DEFAULT_SEND_SHORTCUT;
  try {
    const stored = window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY);
    return isSendShortcut(stored) ? stored : DEFAULT_SEND_SHORTCUT;
  } catch {
    return DEFAULT_SEND_SHORTCUT;
  }
}
