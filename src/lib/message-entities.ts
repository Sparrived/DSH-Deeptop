export type MessageEntityKind = "file" | "connection";

export type MessageEntity = {
  kind: MessageEntityKind;
  value: string;
  start: number;
  end: number;
};

export type MessageEntitySegment =
  | { kind: "text"; value: string }
  | { kind: MessageEntityKind; value: string };

export const FILE_LINK_PREFIX = "deeptop-file:";

const URL_PATTERN = /https?:\/\/[^\s<>{}|\\^`[\]"'，。；：！？、）》】]+/gi;
const WINDOWS_PATH_PATTERN = /(?<![\w])(?:[A-Za-z]:[\\/](?:[^\s<>:"|?*，。；：！？、）》】]+[\\/]?)+|\\\\[^\s<>:"|?*，。；：！？、）》】]+(?:[\\/][^\s<>:"|?*，。；：！？、）》】]+)+)/g;
const UNIX_PATH_PATTERN = /(?<![\w.])\/(?:[^\s<>:"'`，。；：！？、）》】]+\/)*[^\s<>:"'`，。；：！？、）》】]+/g;
const RELATIVE_PATH_PATTERN = /(?<![\w./-])(?:\.\.?[\\/])?(?:[A-Za-z0-9_@-]+[\\/])+[A-Za-z0-9_.@-]+/g;
const PATH_EXTENSION_PATTERN = /\.(?:[a-z0-9]{1,12})$/i;
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、）》】》'"`]+$/;

function trimEntity(value: string): string {
  let result = value.replace(TRAILING_PUNCTUATION, "");
  while (result.endsWith(")") && (result.match(/\(/g)?.length ?? 0) < (result.match(/\)/g)?.length ?? 0)) {
    result = result.slice(0, -1);
  }
  return result;
}

function looksLikePath(value: string): boolean {
  if (value.length < 3 || /[\n\r]/.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) return true;
  return (value.startsWith("./") || value.startsWith("../") || value.startsWith(".\\") || value.startsWith("..\\") || value.includes("/"))
    && (PATH_EXTENSION_PATTERN.test(value) || value.startsWith("./") || value.startsWith("../") || value.startsWith(".\\") || value.startsWith("..\\"));
}

function addMatch(matches: MessageEntity[], kind: MessageEntityKind, rawValue: string, start: number) {
  const value = trimEntity(rawValue);
  if (!value) return;
  const end = start + value.length;
  if (matches.some((match) => start < match.end && end > match.start)) return;
  matches.push({ kind, value, start, end });
}

/** Find displayable file paths and safe http(s) connections in plain message text. */
export function recognizeMessageEntities(text: string): MessageEntity[] {
  if (!text) return [];
  const matches: MessageEntity[] = [];
  for (const match of text.matchAll(URL_PATTERN)) addMatch(matches, "connection", match[0], match.index ?? 0);
  for (const pattern of [WINDOWS_PATH_PATTERN, UNIX_PATH_PATTERN, RELATIVE_PATH_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      if (!looksLikePath(match[0])) continue;
      addMatch(matches, "file", match[0], match.index ?? 0);
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

export function splitMessageEntities(text: string): MessageEntitySegment[] {
  const entities = recognizeMessageEntities(text);
  if (entities.length === 0) return text ? [{ kind: "text", value: text }] : [];
  const segments: MessageEntitySegment[] = [];
  let cursor = 0;
  for (const entity of entities) {
    if (entity.start > cursor) segments.push({ kind: "text", value: text.slice(cursor, entity.start) });
    segments.push({ kind: entity.kind, value: entity.value });
    cursor = entity.end;
  }
  if (cursor < text.length) segments.push({ kind: "text", value: text.slice(cursor) });
  return segments;
}

export function entityHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function decodeFileLink(href: string): string | null {
  if (!href.startsWith(FILE_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(FILE_LINK_PREFIX.length));
  } catch {
    return null;
  }
}

export function pathLabel(path: string): { name: string; directory: string } {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0) return { name: normalized, directory: "路径" };
  return { name: normalized.slice(separator + 1) || normalized, directory: normalized.slice(0, separator) || "路径" };
}
