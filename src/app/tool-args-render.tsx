import { useMemo, useState } from "react";
import type { UiLocale } from "./i18n";
import { t } from "./i18n";
import { isPrimaryToolArgument, orderedToolArguments, parseToolArgs, toolArgsLayout, toolTodoItems, type ToolArgsLayout, type ToolArgsObject, type ToolTodoItem } from "./tool-call-display";

/**
 * Render durable tool arguments as task-oriented rows. Every call keeps a
 * lossless raw fallback, while known tool families use a small semantic accent
 * for their primary input instead of a generic JSON grid.
 */

type FieldKind = "path" | "command" | "longtext" | "url" | "pattern" | "list" | "kv";

const PATH_KEYS = new Set(["path", "file", "filepath", "filePath", "file_path", "cwd", "workdir", "target", "targetPath", "targetFile", "source", "sourcePath", "destination", "dest", "dir", "directory", "from", "to"]);
const COMMAND_KEYS = new Set(["command", "cmd", "shell_command", "shellCommand", "exec", "script", "bash", "code"]);
const LONGTEXT_KEYS = new Set(["query", "prompt", "text", "content", "message", "input", "objective", "plan", "old_string", "new_string", "justification"]);
const URL_KEYS = new Set(["url", "endpoint", "href", "uri"]);
const PATTERN_KEYS = new Set(["regex", "pattern", "glob", "match", "include", "exclude"]);
const LIST_KEYS = new Set(["args", "argv", "flags", "options", "parameters", "params", "items", "lines", "ids", "queries", "todos"]);

const VISIBLE_FIELDS = 8;
const LONG_TEXT_PREVIEW = 280;
const COMMAND_PREVIEW = 560;
const MAX_DEPTH = 4;

function classify(key: string, value: unknown): FieldKind {
  const lowered = key.toLowerCase();
  if (PATH_KEYS.has(key) || PATH_KEYS.has(lowered)) return typeof value === "string" ? "path" : "kv";
  if (COMMAND_KEYS.has(key) || COMMAND_KEYS.has(lowered)) return typeof value === "string" ? "command" : "kv";
  if (LONGTEXT_KEYS.has(key) || LONGTEXT_KEYS.has(lowered)) return typeof value === "string" && value.length > 32 ? "longtext" : "kv";
  if (URL_KEYS.has(key) || URL_KEYS.has(lowered)) return typeof value === "string" ? "url" : "kv";
  if (PATTERN_KEYS.has(key) || PATTERN_KEYS.has(lowered)) return typeof value === "string" ? "pattern" : "kv";
  if (LIST_KEYS.has(key) || LIST_KEYS.has(lowered)) return Array.isArray(value) ? "list" : "kv";
  if (Array.isArray(value)) return "list";
  return "kv";
}

function detectShell(command: string): string {
  if (/^\s*(function|const|let|var|return|if|for|while)\b/mu.test(command)) return "js";
  if (/^\s*(def|class|import|from|print|lambda)\b/mu.test(command)) return "py";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/im.test(command)) return "sql";
  return "sh";
}

function CommandTokens({ command, preview }: { command: string; preview: boolean }) {
  const parts: Array<{ text: string; type: "op" | "flag" | "string" | "plain" | "gap" }> = [];
  const re = /('[^']*'|"[^"]*"|--?[A-Za-z0-9][\w-]*|[&|<>();]+|\S+)/gu;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(command)) !== null) {
    if (match.index > consumed) parts.push({ text: command.slice(consumed, match.index), type: "gap" });
    const token = match[0];
    consumed = match.index + token.length;
    const type = /^['"]/u.test(token) ? "string" : /^-{1,2}/u.test(token) ? "flag" : /^[&|<>();]+$/u.test(token) ? "op" : "plain";
    parts.push({ text: token, type });
    if (preview && consumed >= COMMAND_PREVIEW) {
      parts.push({ text: "…", type: "plain" });
      break;
    }
  }
  return <>{parts.map((part, index) => <span key={index} className={`tool-token tool-token-${part.type}`}>{part.text}</span>)}</>;
}

function PatternHighlight({ pattern }: { pattern: string }) {
  const parts: Array<{ text: string; type: "star" | "class" | "anchor" | "plain" }> = [];
  const re = /(\*\*|\*|\?|\[[^\]]+\]|\^|\$)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pattern)) !== null) {
    if (match.index > lastIndex) parts.push({ text: pattern.slice(lastIndex, match.index), type: "plain" });
    const token = match[0];
    parts.push({ text: token, type: token === "**" || token === "*" ? "star" : token.startsWith("[") ? "class" : "anchor" });
    lastIndex = match.index + token.length;
  }
  if (lastIndex < pattern.length) parts.push({ text: pattern.slice(lastIndex), type: "plain" });
  return <>{parts.map((part, index) => <span key={index} className={`tool-token tool-pattern-${part.type}`}>{part.text}</span>)}</>;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function JsonPreview({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth >= MAX_DEPTH) return <span className="tool-tree-truncated">…</span>;
  if (value === null) return <span className="tool-tree-null">null</span>;
  if (typeof value === "string") return <span className="tool-tree-string">&quot;{value}&quot;</span>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="tool-tree-number">{String(value)}</span>;
  if (Array.isArray(value)) return <span className="tool-tree-array">[{value.length === 0 ? "" : `…${value.length}`} ]</span>;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return <span className="tool-tree-object">{entries.length === 0 ? "{}" : `{…${entries.length}…}`}</span>;
  }
  return <span>{String(value)}</span>;
}

function FieldValue({ value, locale }: { value: unknown; locale: UiLocale }) {
  if (value === undefined || value === "") return <span className="tool-field-empty">{t("conversation.tool.emptyValue", locale)}</span>;
  if (value === null) return <span className="tool-tree-null">null</span>;
  if (typeof value === "string") return <code className="tool-field-string">{value}</code>;
  if (typeof value === "number" || typeof value === "boolean") return <code className="tool-field-number">{String(value)}</code>;
  return <span className="tool-field-tree"><JsonPreview value={value} /></span>;
}

function PathField({ value, locale, onOpenPath }: { value: string; locale: UiLocale; onOpenPath?: (path: string) => void | Promise<void> }) {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const segments = value.split(/[\\/]/u).filter(Boolean);
  if (segments.length === 0) return <code className="tool-field-string">{value}</code>;
  async function open() {
    if (!onOpenPath) return;
    setOpening(true);
    setError("");
    try {
      await onOpenPath(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setOpening(false);
    }
  }
  return <span className="tool-path-wrap"><span className="tool-path">
    {segments.map((segment, index) => <span key={index} className={`tool-path-segment${index === segments.length - 1 ? " is-last" : ""}`}>{segment}</span>)}
    {onOpenPath && <button type="button" className="tool-path-open" disabled={opening} onClick={() => void open()} aria-label={t("deliverables.openFileAria", locale, { path: value })}><span aria-hidden="true">↗</span></button>}
  </span>{error && <small className="tool-field-open-error">{error}</small>}</span>;
}

function LongTextField({ value, locale }: { value: string; locale: UiLocale }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length <= LONG_TEXT_PREVIEW) return <p className="tool-longtext">{value}</p>;
  return <div className="tool-longtext-wrap">
    <p className="tool-longtext">{expanded ? value : `${value.slice(0, LONG_TEXT_PREVIEW)}…`}</p>
    <button type="button" className="tool-fold-toggle" onClick={() => setExpanded((current) => !current)}>{expanded ? t("conversation.tool.collapse", locale) : t("conversation.tool.expandAll", locale)}</button>
  </div>;
}

function CommandField({ value, locale, keyName }: { value: string; locale: UiLocale; keyName?: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = !expanded && value.length > COMMAND_PREVIEW;
  return <div className="tool-command">
    <div className="tool-command-meta">{keyName && <span className="tool-command-key">{keyName}</span>}<span className="tool-command-prompt" aria-hidden="true">$</span><span className="tool-command-shell">{t("conversation.tool.commandShell", locale)} · {detectShell(value)}</span></div>
    <pre className="tool-command-body"><CommandTokens command={value} preview={preview} /></pre>
    {value.length > COMMAND_PREVIEW && <button type="button" className="tool-fold-toggle" onClick={() => setExpanded((current) => !current)}>{expanded ? t("conversation.tool.collapse", locale) : t("conversation.tool.expandAll", locale)}</button>}
  </div>;
}

function UrlField({ value, onOpenUrl }: { value: string; onOpenUrl?: (url: string) => void | Promise<void> }) {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const host = hostOf(value);
  let rest = "";
  try {
    const parsed = new URL(value);
    rest = parsed.pathname + parsed.search + parsed.hash;
  } catch {
    rest = value.startsWith(host) ? value.slice(host.length) : value;
  }
  async function open() {
    if (!onOpenUrl) return;
    setOpening(true);
    setError("");
    try {
      await onOpenUrl(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setOpening(false);
    }
  }
  return <span className="tool-url-wrap"><button type="button" className="tool-url" disabled={!onOpenUrl || opening} onClick={() => void open()}><strong>{host || value}</strong><small>{rest}</small></button>{error && <small className="tool-field-open-error">{error}</small>}</span>;
}

function ListField({ value, locale }: { value: unknown[]; locale: UiLocale }) {
  if (value.length === 0) return <span className="tool-field-empty">[]</span>;
  return <ul className="tool-list">{value.map((item, index) => <li className="tool-list-item" key={index}><FieldValue value={item} locale={locale} /></li>)}</ul>;
}

function TodoListField({ todos, locale }: { todos: ToolTodoItem[]; locale: UiLocale }) {
  if (todos.length === 0) return <span className="tool-field-empty">[]</span>;
  const labels: Record<ToolTodoItem["status"], string> = {
    pending: t("todo.pending", locale),
    in_progress: t("todo.inProgress", locale),
    completed: t("todo.completed", locale),
  };
  return <ol className="tool-todo-list" aria-label={t("todo.listLabel", locale)}>
    {todos.map((todo, index) => <li className={`tool-todo-item ${todo.status}`} key={`${todo.status}-${todo.content}-${index}`}>
      <span className="tool-todo-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <span className="tool-todo-status" aria-hidden="true">{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "•" : ""}</span>
      <span className="tool-todo-content">{todo.content}</span>
      <span className="tool-todo-label">{labels[todo.status]}</span>
    </li>)}
  </ol>;
}

function FieldRow({ toolName, keyName, kind, value, locale, onOpenPath, onOpenUrl, layout, primary }: {
  toolName?: string;
  keyName: string;
  kind: FieldKind;
  value: unknown;
  locale: UiLocale;
  onOpenPath?: (path: string) => void | Promise<void>;
  onOpenUrl?: (url: string) => void | Promise<void>;
  layout: ToolArgsLayout;
  primary: boolean;
}) {
  const todos = (toolName?.toLowerCase() === "todo_write" || toolName?.toLowerCase() === "write_todo") && keyName === "todos" ? toolTodoItems(value) : undefined;
  const normalizedToolName = toolName?.trim().toLowerCase();
  const isPowerShellCommand = (normalizedToolName === "pwsh" || normalizedToolName === "powershell") && kind === "command" && typeof value === "string";
  if (isPowerShellCommand) return <CommandField value={value} locale={locale} keyName={keyName} />;

  const prominent = primary || (layout === "terminal" && kind === "command") || (layout === "web" && kind === "url") || (layout === "delegation" && kind === "longtext");
  return <div className={`tool-field tool-field-${todos ? "todos" : kind}${prominent ? " is-prominent" : ""}`}>
    <span className="tool-field-key">{keyName}</span>
    <div className="tool-field-value">
      {todos ? <TodoListField todos={todos} locale={locale} />
        : kind === "path" && typeof value === "string" ? <PathField value={value} locale={locale} onOpenPath={onOpenPath} />
        : kind === "command" && typeof value === "string" ? <CommandField value={value} locale={locale} />
          : kind === "longtext" && typeof value === "string" ? <LongTextField value={value} locale={locale} />
            : kind === "url" && typeof value === "string" ? <UrlField value={value} onOpenUrl={onOpenUrl} />
              : kind === "pattern" && typeof value === "string" ? <code className="tool-field-pattern"><PatternHighlight pattern={value} /></code>
                : kind === "list" && Array.isArray(value) ? <ListField value={value} locale={locale} />
                  : <FieldValue value={value} locale={locale} />}
    </div>
  </div>;
}

export function ToolArgsView({ text, toolName, args, locale, onOpenPath, onOpenUrl }: {
  text: string;
  toolName?: string;
  /** Parsed once by the call header when it also needs the call description. */
  args?: ToolArgsObject;
  locale: UiLocale;
  onOpenPath?: (path: string) => void | Promise<void>;
  onOpenUrl?: (url: string) => void | Promise<void>;
}) {
  const parsed = useMemo(() => args ?? parseToolArgs(text), [args, text]);
  const [expanded, setExpanded] = useState(false);

  if (!parsed) return <div className="tool-args tool-args-fallback"><pre className="tool-args-raw-fallback">{text}</pre></div>;

  const entries = orderedToolArguments(toolName, parsed);
  if (entries.length === 0) return <div className="tool-args tool-args-empty">{t("conversation.tool.emptyValue", locale)}</div>;

  const layout = toolArgsLayout(toolName, parsed);
  const classified = entries.map(([key, value]) => ({ key, kind: classify(key, value), value }));
  const visible = expanded ? classified : classified.slice(0, VISIBLE_FIELDS);
  const hidden = classified.length - visible.length;

  return <div className={`tool-args tool-args-${layout}`}>
    <div className="tool-args-rows">
      {visible.map((entry) => <FieldRow key={entry.key} toolName={toolName} keyName={entry.key} kind={entry.kind} value={entry.value} locale={locale} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} layout={layout} primary={isPrimaryToolArgument(toolName, entry.key)} />)}
    </div>
    {hidden > 0 && <button type="button" className="tool-args-more" onClick={() => setExpanded(true)}>{t("conversation.tool.moreFields", locale, { count: hidden })}</button>}
  </div>;
}
