import { useMemo, useState } from "react";
import type { UiLocale } from "./i18n";
import { t } from "./i18n";

/**
 * Tool call argument visual renderer.
 *
 * Renders the official tool call text (a JSON-serialized args object)
 * as a structured field-by-field card instead of a plain pre block.
 * Each field is routed by key + value type:
 *   - path-like keys (path/file/cwd/...) -> path chip
 *   - command-like keys -> shell-style command block
 *   - long text -> collapsible prose
 *   - url-like keys -> URL chip (host + path)
 *   - regex/glob/pattern -> highlighted pattern
 *   - array-like values -> bullet list
 *   - everything else -> generic key/value row
 *
 * When the JSON cannot be parsed into an object, the original text is
 * rendered as a pre block under a fallback class so the call remains
 * lossless and the structured view never drops information.
 */

type ArgsObject = Record<string, unknown>;

type FieldKind = "path" | "command" | "longtext" | "url" | "pattern" | "list" | "kv";

const PATH_KEYS = new Set(["path", "file", "filepath", "filePath", "cwd", "target", "targetPath", "targetFile", "source", "sourcePath", "destination", "dest", "dir", "directory", "from", "to"]);
const COMMAND_KEYS = new Set(["command", "cmd", "shell_command", "shellCommand", "exec", "script", "bash"]);
const LONGTEXT_KEYS = new Set(["query", "prompt", "text", "content", "message", "input"]);
const URL_KEYS = new Set(["url", "endpoint", "href", "uri"]);
const PATTERN_KEYS = new Set(["regex", "pattern", "glob", "match", "include", "exclude"]);
const LIST_KEYS = new Set(["args", "argv", "flags", "options", "parameters", "params", "items", "lines", "ids"]);

const VISIBLE_FIELDS = 6;
const LONG_TEXT_PREVIEW = 240;
const COMMAND_PREVIEW = 480;
const MAX_DEPTH = 4;

function classify(key: string, value: unknown): FieldKind {
  const lowered = key.toLowerCase();
  if (PATH_KEYS.has(key) || PATH_KEYS.has(lowered)) return typeof value === "string" && /[\\/]/u.test(value) ? "path" : "kv";
  if (COMMAND_KEYS.has(key) || COMMAND_KEYS.has(lowered)) return typeof value === "string" ? "command" : "kv";
  if (LONGTEXT_KEYS.has(key) || LONGTEXT_KEYS.has(lowered)) return typeof value === "string" && value.length > 32 ? "longtext" : "kv";
  if (URL_KEYS.has(key) || URL_KEYS.has(lowered)) return typeof value === "string" ? "url" : "kv";
  if (PATTERN_KEYS.has(key) || PATTERN_KEYS.has(lowered)) return typeof value === "string" ? "pattern" : "kv";
  if (LIST_KEYS.has(key) || LIST_KEYS.has(lowered)) return Array.isArray(value) ? "list" : "kv";
  if (Array.isArray(value)) return "list";
  return "kv";
}

function isPlainObject(value: unknown): value is ArgsObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseToolArgs(text: string): ArgsObject | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (isPlainObject(parsed)) return parsed;
    if (typeof parsed === "string") {
      const inner = JSON.parse(parsed);
      if (isPlainObject(inner)) return inner;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function detectShell(command: string): string {
  if (/^\s*(function|const|let|var|return|if|for|while)\b/mu.test(command)) return "js";
  if (/^\s*(def|class|import|from|print|lambda)\b/mu.test(command)) return "py";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/im.test(command)) return "sql";
  if (/[|&;<>()]/u.test(command) || /\$\{|`[^`]+`/u.test(command)) return "sh";
  return "sh";
}

function CommandTokens({ command, preview }: { command: string; preview: boolean }) {
  const parts: Array<{ text: string; type: "op" | "flag" | "string" | "plain" | "gap" }> = [];
  const re = /('[^']*'|"[^"]*"|--?[A-Za-z0-9][\w-]*|[&|<>();]+|\S+)/gu;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(command)) !== null) {
    if (match.index > consumed) {
      parts.push({ text: command.slice(consumed, match.index), type: "gap" });
    }
    const token = match[0];
    consumed = match.index + token.length;
    let type: "op" | "flag" | "string" | "plain" = "plain";
    if (/^['"]/u.test(token)) type = "string";
    else if (/^-{1,2}/u.test(token)) type = "flag";
    else if (/^[&|<>();]+$/u.test(token)) type = "op";
    parts.push({ text: token, type });
    if (preview && consumed >= COMMAND_PREVIEW) {
      parts.push({ text: "…", type: "plain" });
      break;
    }
  }
  if (!preview && command.length > COMMAND_PREVIEW) parts.push({ text: "…", type: "plain" });
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={`tool-token tool-token-${part.type}`}>{part.text}</span>
      ))}
    </>
  );
}

function PatternHighlight({ pattern }: { pattern: string }) {
  const parts: Array<{ text: string; type: "star" | "class" | "anchor" | "plain" }> = [];
  const re = /(\*\*|\*|\?|\[[^\]]+\]|\^|\$)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pattern)) !== null) {
    if (match.index > lastIndex) parts.push({ text: pattern.slice(lastIndex, match.index), type: "plain" });
    const m = match[0];
    if (m === "**" || m === "*") parts.push({ text: m, type: "star" });
    else if (m.startsWith("[")) parts.push({ text: m, type: "class" });
    else parts.push({ text: m, type: "anchor" });
    lastIndex = match.index + m.length;
  }
  if (lastIndex < pattern.length) parts.push({ text: pattern.slice(lastIndex), type: "plain" });
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={`tool-token tool-pattern-${p.type}`}>{p.text}</span>
      ))}
    </>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth >= MAX_DEPTH) return <span className="tool-tree-truncated">…</span>;
  if (value === null) return <span className="tool-tree-null">null</span>;
  if (typeof value === "string") return <span className="tool-tree-string">"{value}"</span>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="tool-tree-number">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="tool-tree-meta">[]</span>;
    return <span className="tool-tree-array">[…{value.length}]</span>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as ArgsObject);
    if (entries.length === 0) return <span className="tool-tree-meta">{"{}"}</span>;
    return <span className="tool-tree-object">{"{…"}{entries.length}{"…}"}</span>;
  }
  return <span>{String(value)}</span>;
}

function FieldValue({ value, locale, onOpenPath }: {
  value: unknown;
  locale: UiLocale;
  onOpenPath?: (path: string) => void;
}) {
  if (value === undefined) return <span className="tool-field-empty">{t("conversation.tool.emptyValue", locale)}</span>;
  if (value === null) return <span className="tool-tree-null">null</span>;
  if (typeof value === "string") {
    if (!value) return <span className="tool-field-empty">{t("conversation.tool.emptyValue", locale)}</span>;
    return <code className="tool-field-string">{value}</code>;
  }
  if (typeof value === "number" || typeof value === "boolean") return <code className="tool-field-number">{String(value)}</code>;
  if (Array.isArray(value) || typeof value === "object") return <span className="tool-field-tree"><JsonTree value={value} /></span>;
  return <code className="tool-field-string">{String(value)}</code>;
}

function PathField({ value, onOpenPath }: { value: string; onOpenPath?: (path: string) => void }) {
  const segments = value.split(/[\\/]/u).filter(Boolean);
  return (
    <span className="tool-path">
      {segments.map((segment, index) => (
        <span key={index} className={`tool-path-segment${index === segments.length - 1 ? " is-last" : ""}`}>{segment}</span>
      ))}
      {onOpenPath && (
        <button type="button" className="tool-path-open" onClick={() => onOpenPath(value)} aria-label={value}>
          <span aria-hidden="true">↗</span>
        </button>
      )}
    </span>
  );
}

function LongTextField({ value, locale }: { value: string; locale: UiLocale }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length <= LONG_TEXT_PREVIEW) return <p className="tool-longtext">{value}</p>;
  return (
    <div className="tool-longtext-wrap">
      <p className="tool-longtext">{expanded ? value : `${value.slice(0, LONG_TEXT_PREVIEW)}…`}</p>
      <button type="button" className="tool-fold-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? t("conversation.tool.collapse", locale) : t("conversation.tool.expandAll", locale)}
      </button>
    </div>
  );
}

function CommandField({ value, locale }: { value: string; locale: UiLocale }) {
  const [expanded, setExpanded] = useState(false);
  const shell = detectShell(value);
  const preview = !expanded && value.length > COMMAND_PREVIEW;
  return (
    <div className="tool-command">
      <span className="tool-command-prompt" aria-hidden="true">$</span>
      <span className="tool-command-shell">{t("conversation.tool.commandShell", locale)} · {shell}</span>
      <pre className="tool-command-body"><CommandTokens command={value} preview={preview} /></pre>
      {value.length > COMMAND_PREVIEW && (
        <button type="button" className="tool-fold-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("conversation.tool.collapse", locale) : t("conversation.tool.expandAll", locale)}
        </button>
      )}
    </div>
  );
}

function UrlField({ value }: { value: string }) {
  const host = hostOf(value);
  let rest = "";
  try {
    const u = new URL(value);
    rest = u.pathname + u.search + u.hash;
  } catch {
    rest = value.startsWith(host) ? value.slice(host.length) : value;
  }
  return (
    <a className="tool-url" href={value} target="_blank" rel="noreferrer">
      <strong>{host || value}</strong>
      <small>{rest}</small>
    </a>
  );
}

function ListField({ value, locale }: { value: unknown[]; locale: UiLocale }) {
  if (value.length === 0) return <span className="tool-field-empty">[]</span>;
  return (
    <ul className="tool-list">
      {value.map((item, index) => (
        <li className="tool-list-item" key={index}>
          {typeof item === "string" || typeof item === "number" || typeof item === "boolean"
            ? <code className="tool-field-string">{String(item)}</code>
            : <FieldValue value={item} locale={locale} />}
        </li>
      ))}
    </ul>
  );
}

function FieldRow({ keyName, kind, value, locale, onOpenPath }: {
  keyName: string;
  kind: FieldKind;
  value: unknown;
  locale: UiLocale;
  onOpenPath?: (path: string) => void;
}) {
  return (
    <div className={`tool-field tool-field-${kind}`}>
      <span className="tool-field-key">{keyName}</span>
      <span className="tool-field-value">
        {kind === "path" && typeof value === "string" ? <PathField value={value} onOpenPath={onOpenPath} />
          : kind === "command" && typeof value === "string" ? <CommandField value={value} locale={locale} />
            : kind === "longtext" && typeof value === "string" ? <LongTextField value={value} locale={locale} />
              : kind === "url" && typeof value === "string" ? <UrlField value={value} />
                : kind === "pattern" && typeof value === "string" ? <code className="tool-field-pattern"><PatternHighlight pattern={value} /></code>
                  : kind === "list" && Array.isArray(value) ? <ListField value={value} locale={locale} />
                    : <FieldValue value={value} locale={locale} onOpenPath={onOpenPath} />}
      </span>
    </div>
  );
}

export function ToolArgsView({ text, locale, onOpenPath }: {
  text: string;
  locale: UiLocale;
  onOpenPath?: (path: string) => void;
}) {
  const parsed = useMemo(() => parseToolArgs(text), [text]);
  const [expanded, setExpanded] = useState(false);

  if (!parsed) {
    return (
      <div className="tool-args tool-args-fallback">
        <pre className="tool-args-raw-fallback">{text}</pre>
      </div>
    );
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return <div className="tool-args tool-args-empty">{t("conversation.tool.emptyValue", locale)}</div>;
  }

  const classified = entries.map(([k, v]) => ({ key: k, kind: classify(k, v), value: v }));
  const visible = expanded ? classified : classified.slice(0, VISIBLE_FIELDS);
  const hidden = classified.length - visible.length;

  return (
    <div className="tool-args">
      <div className="tool-args-grid">
        {visible.map((entry) => (
          <FieldRow key={entry.key} keyName={entry.key} kind={entry.kind} value={entry.value} locale={locale} onOpenPath={onOpenPath} />
        ))}
      </div>
      {hidden > 0 && (
        <button type="button" className="tool-args-more" onClick={() => setExpanded(true)}>
          {t("conversation.tool.moreFields", locale, { count: hidden })}
        </button>
      )}
    </div>
  );
}
