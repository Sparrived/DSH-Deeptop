import { useMemo, useState } from "react";
import type { UiLocale } from "./i18n";
import { t } from "./i18n";

/**
 * Tool result visual renderer.
 *
 * Renders the official tool result text as a structured card:
 *   - JSON output -> collapsible tree of typed leaves with line/char stats
 *   - plain text -> pre block + line/char meta
 *   - HTML / binary -> pre with truncated notice
 *
 * Long results fold automatically; the structured view is the default
 * and the caller can swap to a raw pre via the View raw button.
 */

const JSON_TREE_MAX_LINES = 60;
const PLAIN_TEXT_MAX_LINES = 60;
const MAX_TREE_DEPTH = 5;

export type ResultStats = { lines: number; chars: number };

export function resultStats(text: string): ResultStats {
  if (!text) return { lines: 0, chars: 0 };
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return { lines, chars: text.length };
}

export function tryParseJson(text: string): { value: unknown; ok: boolean } {
  if (!text) return { value: undefined, ok: false };
  const trimmed = text.trim();
  if (!trimmed) return { value: undefined, ok: false };
  if (trimmed[0] !== "{" && trimmed[0] !== "[") return { value: undefined, ok: false };
  try {
    return { value: JSON.parse(trimmed), ok: true };
  } catch {
    return { value: undefined, ok: false };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^<(!doctype|html|body|div|span|p|table|svg|head|section|article|main|nav|header|footer)\b/i.test(trimmed);
}

type JsonLine = { indent: number; content: React.ReactNode; isMeta: boolean; isClose: boolean };

function buildJsonLines(value: unknown, indent: number, key?: string): JsonLine[] {
  if (indent >= MAX_TREE_DEPTH) {
    return [{ indent, content: <span className="tool-tree-truncated">…</span>, isMeta: false, isClose: false }];
  }
  if (value === null) return [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-null">null</span></>, isMeta: false, isClose: false }];
  if (typeof value === "string") return [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-string">"{value}"</span></>, isMeta: false, isClose: false }];
  if (typeof value === "number" || typeof value === "boolean") return [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-number">{String(value)}</span></>, isMeta: false, isClose: false }];
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-meta">[]</span></>, isMeta: false, isClose: false }];
    const lines: JsonLine[] = [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-meta">[</span></>, isMeta: false, isClose: false }];
    for (const [index, item] of value.entries()) {
      lines.push(...buildJsonLines(item, indent + 1, String(index)));
    }
    lines.push({ indent, content: <span className="tool-tree-meta">]</span>, isMeta: false, isClose: true });
    return lines;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-meta">{"{}"}</span></>, isMeta: false, isClose: false }];
    const lines: JsonLine[] = [{ indent, content: <><span className="tool-tree-key">{key !== undefined ? <>{key}: </> : null}</span><span className="tool-tree-meta">{"{"}</span></>, isMeta: false, isClose: false }];
    for (const [entryKey, entryValue] of entries) {
      lines.push(...buildJsonLines(entryValue, indent + 1, entryKey));
    }
    lines.push({ indent, content: <span className="tool-tree-meta">{"}"}</span>, isMeta: false, isClose: true });
    return lines;
  }
  return [{ indent, content: <>{key !== undefined ? <>{key}: </> : null}{String(value)}</>, isMeta: false, isClose: false }];
}

function JsonTree({ value, maxLines, locale }: { value: unknown; maxLines: number; locale: UiLocale }) {
  const allLines = useMemo(() => buildJsonLines(value, 0), [value]);
  const [expanded, setExpanded] = useState(false);
  const visibleLines = expanded ? allLines : allLines.slice(0, maxLines);
  const hidden = allLines.length - visibleLines.length;
  return (
    <div className="tool-result-tree">
      <div className="tool-result-tree-body">
        {visibleLines.map((line, index) => (
          <div key={index} className="tool-result-tree-line" style={{ paddingLeft: `${line.indent * 14}px` }}>
            {line.content}
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <button type="button" className="tool-fold-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("conversation.tool.collapse", locale) : t("conversation.tool.expandAll", locale)}
        </button>
      )}
    </div>
  );
}

function PlainTextView({ text, maxLines, locale }: { text: string; maxLines: number; locale: UiLocale }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const visibleLines = expanded ? lines : lines.slice(0, maxLines);
  const hidden = lines.length - visibleLines.length;
  return (
    <div className="tool-result-text">
      <pre className="tool-result-text-body">{visibleLines.join("\n")}{hidden > 0 && !expanded ? "…" : ""}</pre>
      {hidden > 0 && (
        <button type="button" className="tool-fold-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("conversation.tool.collapse", locale) : t("conversation.tool.expandAll", locale)}
        </button>
      )}
    </div>
  );
}

export function ToolResultView({ text, locale }: { text: string; locale: UiLocale }) {
  const stats = useMemo(() => resultStats(text), [text]);
  const parsed = useMemo(() => tryParseJson(text), [text]);

  let body: React.ReactNode;
  if (parsed.ok) {
    body = <JsonTree value={parsed.value} maxLines={JSON_TREE_MAX_LINES} locale={locale} />;
  } else if (looksLikeHtml(text)) {
    body = (
      <div className="tool-result-html">
        <pre className="tool-result-text-body">{text}</pre>
        <p className="tool-result-note">{t("conversation.fetch.truncated", locale)}</p>
      </div>
    );
  } else {
    body = <PlainTextView text={text} maxLines={PLAIN_TEXT_MAX_LINES} locale={locale} />;
  }

  return (
    <div className="tool-result">
      <div className="tool-result-meta">
        <span className="tool-result-stats">{t("conversation.tool.resultStats", locale, { lines: stats.lines, chars: stats.chars })}</span>
      </div>
      {body}
    </div>
  );
}
