export const DEFAULT_SEND_SHORTCUT = "Ctrl+Enter";
export const SEND_SHORTCUT_STORAGE_KEY = "deeptop.send-shortcut";

type ShortcutKeyboardEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

const modifierNames = new Set(["Ctrl", "Alt", "Shift", "Meta"]);
const keyAliases: Record<string, string> = {
  " ": "Space",
  Esc: "Escape",
  Del: "Delete",
};

function keyName(key: string) {
  if (keyAliases[key]) return keyAliases[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function normalizeShortcut(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = keyName(parts[parts.length - 1]);
  if (!key || modifierNames.has(key)) return null;
  const modifiers = new Set<string>(parts.slice(0, -1).map((part) => {
    const normalized = part.toLowerCase();
    if (normalized === "control" || normalized === "ctrl") return "Ctrl";
    if (normalized === "option" || normalized === "alt") return "Alt";
    if (normalized === "shift") return "Shift";
    if (normalized === "command" || normalized === "cmd" || normalized === "meta") return "Meta";
    return "";
  }).filter(Boolean));
  if (modifiers.size === 0) return null;
  return [...["Ctrl", "Alt", "Shift", "Meta"].filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function shortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
  ].filter(Boolean);
  if (modifiers.length === 0) return null;
  const key = keyName(event.key);
  if (!key || key === "Unidentified") return null;
  return [...modifiers, key].join("+");
}

export function shortcutMatches(event: ShortcutKeyboardEvent, shortcut: string) {
  return shortcutFromKeyboardEvent(event) === normalizeShortcut(shortcut);
}

export function readSendShortcut() {
  if (typeof window === "undefined") return DEFAULT_SEND_SHORTCUT;
  try {
    return normalizeShortcut(window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY)) ?? DEFAULT_SEND_SHORTCUT;
  } catch {
    return DEFAULT_SEND_SHORTCUT;
  }
}
