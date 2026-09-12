import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type UIEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import { isFilePath, type DshHistoryEntry, type DshPreset, type DshSessionSummary } from "../lib/desktop";
import type { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import type { UiHostActions } from "../lib/desktop-ui-runtime/types";
import { SlotOutlet } from "./SlotOutlet";
import { TurnRail } from "./TurnRail";
import type { TurnRailItem } from "../app/turn-rail-model";
import { MarkdownContent } from "../lib/markdown";

type MarkdownEntityActions = {
  onOpenPath?: (path: string, location?: { line?: number }) => void | Promise<void>;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenUrl?: (url: string) => void | Promise<void>;
};
import { TrajectoryView } from "./TrajectoryView";
import { isResultDomainCard, toolDomainCard, type ToolDomainCard } from "../app/tool-domain";
import { ToolArgsView } from "../app/tool-args-render";
import { displayToolName, hasVisibleToolArguments, parseToolArgs, toolArgsLayout, toolCallEditDiff, toolCallSummary } from "../app/tool-call-display";
import { ToolResultView } from "../app/tool-result-render";
import { entityHost } from "../lib/message-entities";
import { isWithinSelector, TRANSCRIPT_CONTEXT_MENU_SELECTOR, TRANSCRIPT_TEXT_SELECTOR } from "../app/context-menu";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import {
  formatClock,
  formatTokens,
  sessionPath,
  imageSource,
  presetDescription,
  presetDisplayName,
  type DiffSummary,
  type TranscriptItem,
} from "../app/model";
import type { MessageStats, TranscriptImage, WorkingIndicatorSettings } from "../app/model";
import { normalizeWorkingIndicator, workingIndicatorTextAt } from "../app/working-indicator";
import { t, type UiLocale } from "../app/i18n";

type ConversationTranscriptProps = {
  /** 界面语言：消息操作与标题按语言渲染。 */
  locale?: UiLocale;
  scrollRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  history: DshHistoryEntry[];
  transcript: TranscriptItem[];
  activeSession: DshSessionSummary | null;
  activeSessionId: string | null;
  activeRunning: boolean;
  loading: boolean;
  workingIndicator: WorkingIndicatorSettings;
  historyHasMore: boolean;
  historyLoadingOlder: boolean;
  transcriptFollowing: boolean;
  trajectoryOpen: boolean;
  workspace: string;
  runtimeDirectory: string;
  modelName: string;
  presets: DshPreset[];
  uiRuntime: DesktopUiRuntime;
  uiHost: UiHostActions;
  nextPreset: string | null;
  presetMenuOpen: boolean;
  onLoadImageAttachment?: (attachmentId: string) => Promise<string>;
  retryingMessageSeq?: number | null;
  onLoadOlder: () => void | Promise<void>;
  onFollowingChange: (following: boolean) => void;
  onJumpToLatest: () => void;
  onTogglePresetMenu: () => void;
  onStagePreset: (id: string) => void;
  onCopyMessage: (text: string) => void | Promise<void>;
  onCopySelection: (text: string) => void | Promise<void>;
  onRetryMessage?: (seq: number) => void | Promise<void>;
  onForkSession: (sessionId: string, seq?: number) => void | Promise<void>;
  onOpenSessionPath: (path: string, location?: { line?: number }) => void | Promise<void>;
  onOpenUrl: (url: string) => void | Promise<void>;
  /** Open a workflow member's child session (childId → subagent history). */
  onOpenWorkflowMember?: (childId: string, label: string) => void | Promise<void>;
  /** Optional turn rail ladder (whole-log turn navigation). Omit to hide. */
  turnItems?: readonly TurnRailItem[];
  /** Current (latest / navigated) turn whose rail mark is highlighted. */
  turnActiveTurn?: number | null;
  /** Turn whose jump is still paging history in; its rail mark pulses. */
  turnBusyTurn?: number | null;
  /** Navigate to one rail turn (scroll when loaded, page history first when not). */
  onTurnNavigate?: (item: TurnRailItem) => void;
};

function diffTextLines(text: string) {
  if (!text) return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n") : [];
}

function WorkingIndicator({ settings, locale }: { settings: WorkingIndicatorSettings; locale: UiLocale }) {
  const [index, setIndex] = useState(0);
  const safeSettings = useMemo(() => normalizeWorkingIndicator(settings), [settings]);
  const textKey = safeSettings.texts.join("\u0000");

  useEffect(() => {
    setIndex(0);
  }, [textKey]);

  useEffect(() => {
    if (safeSettings.texts.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => current + 1), safeSettings.rotationInterval);
    return () => window.clearInterval(timer);
  }, [safeSettings.rotationInterval, safeSettings.texts.length, textKey]);

  return (
    <div className={`agent-working effect-${safeSettings.effect}`} role="status" aria-label={t("conversation.working", locale)} style={{ "--working-indicator-color": safeSettings.color } as CSSProperties}>
      <span aria-hidden="true">{workingIndicatorTextAt(safeSettings, index)}</span>
    </div>
  );
}

function formatToolCall(text: string) {
  const value = text.trim();
  if (!value) return text;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return text;
  }
}

/**
 * 工具行渲染:
 *   - 默认展示「可视化卡片」:`ToolArgsView` 解析参数,`ToolResultView` 解析结果
 *   - 每个 part 顶部都有「查看原文」按钮,可独立切换回原始 JSON/文本
 *   - 保持原 tool-entry / tool-parts / DiffResult 视觉骨架,只在内部替换
 *     原本的 `<pre>` 内容;DiffResult 始终保留(属于「已有可视化」,按要求
 *     保留并继续渲染)。
 */
function ToolEntryView({
  item,
  diff,
  hasToolResult,
  toolStatus,
  locale,
  onOpenUrl,
  onOpenPath,
}: {
  item: TranscriptItem;
  diff: DiffSummary | undefined;
  hasToolResult: boolean;
  toolStatus: "error" | "returned" | "running";
  locale: UiLocale;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPath: (path: string, location?: { line?: number }) => void | Promise<void>;
}) {
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [showRawResult, setShowRawResult] = useState(false);
  const args = useMemo(() => parseToolArgs(item.text), [item.text]);
  const description = toolCallSummary(item.toolName, args);
  const argsLayout = toolArgsLayout(item.toolName, args ?? {});
  const hasVisibleArgs = hasVisibleToolArguments(item.toolName, args) || (args === undefined && Boolean(item.text.trim()));
  const editDiff = args ? toolCallEditDiff(item.toolName, args) : undefined;
  const displayName = displayToolName(item.toolName);
  return (
    <details className={`tool-entry tool-status-${toolStatus} tool-layout-${argsLayout} ${hasToolResult && hasVisibleArgs ? "tool-paired" : ""} ${!hasVisibleArgs ? "tool-result-only" : ""} ${item.toolResultError ? "tool-error" : ""}`} data-tool-status={toolStatus} open={item.toolResultError || undefined}>
      <summary>
        <span className="tool-summary-main"><span className="tool-state" aria-hidden="true" /><span className="tool-name">{displayName}</span></span>
        {description && <span className="tool-description">{description}</span>}
        {diff && <span className="tool-diff-badge" key={`${item.key}-diff-${diff.added}-${diff.removed}`} aria-label={t("conversation.tool.diffAria", locale, { added: diff.added, removed: diff.removed })}><b>+{diff.added}</b><b>-{diff.removed}</b></span>}
        <span className={`tool-status ${toolStatus}`}><span className="tool-status-dot" aria-hidden="true" />{item.toolResultError ? t("conversation.tool.error", locale) : hasToolResult ? t("conversation.tool.returned", locale) : t("conversation.tool.running", locale)}</span>
        <span className="tool-toggle" aria-hidden="true" />
      </summary>
      <div className="tool-parts">
        {item.domainCard && !isResultDomainCard(item.domainCard) && <section className="tool-part tool-domain-part"><div className="tool-part-label"><span>{t("conversation.tool.domainView", locale)}</span></div><ToolDomainCardView card={item.domainCard} locale={locale} onOpenUrl={onOpenUrl} /></section>}
        {hasVisibleArgs && <section className="tool-part tool-call-part">
          <div className="tool-part-label">
            <span>{t("conversation.tool.callArgs", locale)}</span>
            <div className="tool-part-label-right">
              <time>{formatClock(item.time)}</time>
              <button
                type="button"
                className={`tool-raw-toggle${showRawArgs ? " is-active" : ""}`}
                onClick={() => setShowRawArgs((v) => !v)}
                aria-pressed={showRawArgs}
              >{showRawArgs ? t("conversation.tool.collapseRaw", locale) : t("conversation.tool.viewRaw", locale)}</button>
            </div>
          </div>
          {showRawArgs
            ? <pre className="tool-call-arguments">{formatToolCall(item.text)}</pre>
            : <ToolArgsView text={item.text} toolName={item.toolName} args={args} locale={locale} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />}
          {item.toolDiff
            ? <DiffResult diff={item.toolDiff} locale={locale} />
            : editDiff && <EditCallDiff {...editDiff} locale={locale} />}
        </section>}
        {hasToolResult && (
          <section className={`tool-part tool-result-part ${item.toolResultError ? "tool-result-error" : ""}`}>
            <div className="tool-part-label">
              <span>{t("conversation.tool.result", locale)}</span>
              <div className="tool-part-label-right">
                <time>{formatClock(item.toolResultTime)}</time>
                <button
                  type="button"
                  className={`tool-raw-toggle${showRawResult ? " is-active" : ""}`}
                  onClick={() => setShowRawResult((v) => !v)}
                  aria-pressed={showRawResult}
                >{showRawResult ? t("conversation.tool.collapseRaw", locale) : t("conversation.tool.viewRaw", locale)}</button>
              </div>
            </div>
            {isResultDomainCard(item.domainCard) && <ToolDomainCardView card={item.domainCard} locale={locale} onOpenUrl={onOpenUrl} />}
            {item.toolResultDiff && <DiffResult key={`${item.key}-diff-${item.toolResultTime ?? "result"}`} diff={item.toolResultDiff} locale={locale} />}
            {item.toolResultText !== undefined && (
              showRawResult
                ? <pre>{item.toolResultText}</pre>
                : <ToolResultView text={item.toolResultText} locale={locale} />
            )}
          </section>
        )}
      </div>
    </details>
  );
}

function SearchSourcesCard({ card, locale, onOpenUrl }: { card: Extract<ToolDomainCard, { domain: "search" }>; locale: UiLocale; onOpenUrl: (url: string) => void | Promise<void> }) {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  async function open(url: string) {
    setOpening(url);
    setError("");
    try {
      await onOpenUrl(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setOpening(null);
    }
  }
  return <div className="tool-domain-card search-domain-card" aria-label={t("conversation.search.aria", locale)}>
    <div className="tool-domain-head"><strong>{t("conversation.search.title", locale)}</strong><span>{card.query || t("conversation.search.results", locale)}</span></div>
    {card.answer && <p className="search-answer">{card.answer}</p>}
    {card.sources.length > 0 && <ul className="search-source-list">
      {card.sources.map((source) => (
        <li className="search-source" key={source.url}>
          <button type="button" className="search-source-open" disabled={opening === source.url} onClick={() => void open(source.url)} title={t("conversation.search.openUrl", locale, { url: source.url })}>
            <span className="search-source-title">{source.title || entityHost(source.url)}</span>
            <small>{source.url}</small>
            {source.publishedAt && <em>{source.publishedAt}</em>}
            {source.snippet && <p>{source.snippet}</p>}
          </button>
        </li>
      ))}
    </ul>}
    {card.truncated && <p className="search-domain-note">{t("conversation.search.truncated", locale)}</p>}
    {error && <p className="search-domain-note error">{error}</p>}
  </div>;
}

function WebFetchCard({ card, locale, onOpenUrl }: { card: Extract<ToolDomainCard, { domain: "fetch" }>; locale: UiLocale; onOpenUrl: (url: string) => void | Promise<void> }) {
  const url = card.url ?? card.title;
  return <div className="tool-domain-card fetch-domain-card" aria-label={t("conversation.fetch.label", locale)}>
    <div className="tool-domain-head"><strong>{t("conversation.fetch.label", locale)}</strong>{typeof card.statusCode === "number" && <span>HTTP {card.statusCode}</span>}</div>
    <div className="fetch-domain-target"><strong>{entityHost(url)}</strong><small>{url}</small></div>
    {card.truncated && <p className="search-domain-note">{t("conversation.fetch.truncated", locale)}</p>}
    {card.url && <div className="fetch-domain-actions"><button type="button" onClick={() => void onOpenUrl(card.url!)}>{t("common.open", locale)}</button></div>}
  </div>;
}

function SkillLoadCard({ card, locale }: { card: Extract<ToolDomainCard, { domain: "skill" }>; locale: UiLocale }) {
  return <div className="tool-domain-card skill-domain-card" aria-label={t("conversation.skill.aria", locale)}>
    <div className="tool-domain-head"><strong>Skill</strong><span>{t("conversation.skill.intoContext", locale)}</span></div>
    <code className="skill-domain-name">{card.name}</code>
    <p className="skill-domain-note">{t("conversation.skill.note", locale)}</p>
  </div>;
}

/** Render one official tool-domain card from the presentation view. */
function ToolDomainCardView({ card, locale, onOpenUrl }: { card: ToolDomainCard; locale: UiLocale; onOpenUrl: (url: string) => void | Promise<void> }) {
  if (card.domain === "search") return <SearchSourcesCard card={card} locale={locale} onOpenUrl={onOpenUrl} />;
  if (card.domain === "fetch") return <WebFetchCard card={card} locale={locale} onOpenUrl={onOpenUrl} />;
  return <SkillLoadCard card={card} locale={locale} />;
}

// Value equality for the fields that affect how a transcript article renders.
// The transcript is rebuilt on every streamed delta, so items get fresh object
// identities even when their content is unchanged; these helpers let the memo
// comparator skip unchanged articles (and their markdown re-parse) entirely.

function sameImages(left: TranscriptImage[] | undefined, right: TranscriptImage[] | undefined) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (a.mediaType !== b.mediaType || a.data !== b.data || a.attachmentId !== b.attachmentId || a.name !== b.name) return false;
  }
  return true;
}

function sameStats(left: MessageStats | undefined, right: MessageStats | undefined) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.inputTokens === right.inputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheHitRate === right.cacheHitRate
    && left.runMs === right.runMs
    && left.ttftMs === right.ttftMs
    && left.tokensPerSecond === right.tokensPerSecond;
}

function sameDomainCard(left: ToolDomainCard | undefined, right: ToolDomainCard | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameItemFields(left: TranscriptItem, right: TranscriptItem) {
  if (left === right) return true;
  return left.kind === right.kind
    && left.key === right.key
    && left.label === right.label
    && left.text === right.text
    && left.seq === right.seq
    && left.seqFrom === right.seqFrom
    && left.messageId === right.messageId
    && left.time === right.time
    && left.toolName === right.toolName
    && left.toolCallId === right.toolCallId
    && left.toolState === right.toolState
    && left.toolResultText === right.toolResultText
    && left.toolResultTime === right.toolResultTime
    && left.toolResultError === right.toolResultError
    && left.toolDiff === right.toolDiff
    && left.toolResultDiff === right.toolResultDiff
    && left.source === right.source
    && left.contextRole === right.contextRole
    && left.contextForm === right.contextForm
    && left.contextSummary === right.contextSummary
    && left.injected === right.injected
    && left.streaming === right.streaming
    && left.workflow === right.workflow
    && sameImages(left.images, right.images)
    && sameStats(left.stats, right.stats)
    && sameDomainCard(left.domainCard, right.domainCard);
}

function diffLineCount(text: string) {
  if (!text) return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n").length : 0;
}

function EditCallDiff({ path, oldText, newText, locale }: { path: string; oldText: string; newText: string; locale: UiLocale }) {
  const diff: DiffSummary = {
    diffs: [{ path, oldText, newText }],
    added: diffLineCount(newText),
    removed: diffLineCount(oldText),
    files: 1,
  };
  return <DiffResult diff={diff} locale={locale} />;
}

function DiffResult({ diff, locale }: { diff: DiffSummary; locale: UiLocale }) {
  let lineIndex = 0;
  return (
    <div className="diff-result" aria-label={t("conversation.diff.aria", locale)}>
      <div className="diff-result-header">
        <strong>Diff</strong>
        <span className="diff-result-stats"><b className="diff-added">+{diff.added}</b><b className="diff-removed">-{diff.removed}</b><span>{t("conversation.diff.files", locale, { count: diff.files })}</span></span>
      </div>
      <div className="diff-result-body">
        {diff.diffs.map((hunk, hunkIndex) => {
          const removed = hunk.oldText === null ? [] : diffTextLines(hunk.oldText);
          const added = diffTextLines(hunk.newText);
          return (
            <section className="diff-file" key={`${hunk.path}-${hunkIndex}`}>
              <div className="diff-file-header"><code>{hunk.path}</code><span>hunk {hunkIndex + 1}</span></div>
              <div className="diff-lines">
                {removed.map((line, index) => {
                  const delay = `${Math.min(lineIndex++, 24) * 16}ms`;
                  return <div className="diff-line diff-line-removed" style={{ animationDelay: delay }} key={`${hunk.path}-${hunkIndex}-removed-${index}`}><span>-</span><code>{line || " "}</code></div>;
                })}
                {added.map((line, index) => {
                  const delay = `${Math.min(lineIndex++, 24) * 16}ms`;
                  return <div className="diff-line diff-line-added" style={{ animationDelay: delay }} key={`${hunk.path}-${hunkIndex}-added-${index}`}><span>+</span><code>{line || " "}</code></div>;
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function activeDiff(item: TranscriptItem) {
  return item.toolResultDiff ?? (item.toolResultText === undefined ? item.toolDiff : undefined);
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function formatTokensPerSecond(value: number) {
  const speed = Math.max(0, value);
  return speed >= 10 ? String(Math.round(speed)) : (Math.round(speed * 10) / 10).toFixed(1);
}

function MessageStatsLine({ stats, locale }: { stats?: MessageStats; locale: UiLocale }) {
  if (!stats) return null;
  const values = [
    stats.inputTokens === undefined ? null : <span key="input">{t("conversation.stats.input", locale, { value: formatTokens(stats.inputTokens) })}</span>,
    stats.outputTokens === undefined ? null : <span key="output">{t("conversation.stats.output", locale, { value: formatTokens(stats.outputTokens) })}</span>,
    stats.cacheHitRate === undefined ? null : <span key="cache">{t("conversation.stats.cache", locale, { percent: Math.round(stats.cacheHitRate) })}</span>,
    stats.runMs === undefined ? null : <span key="run">{t("conversation.stats.run", locale, { duration: formatDuration(stats.runMs) })}</span>,
    stats.ttftMs === undefined ? null : <span key="ttft">{t("conversation.stats.ttft", locale, { duration: formatDuration(stats.ttftMs) })}</span>,
    stats.tokensPerSecond === undefined ? null : <span key="speed">{formatTokensPerSecond(stats.tokensPerSecond)} tok/s</span>,
  ].filter((value) => value !== null);
  return values.length > 0 ? <div className="message-stats" aria-label={t("conversation.stats.aria", locale)}>{values}</div> : null;
}

function useIncrementalText(text: string, enabled = true) {
  const textNodeRef = useRef<Text | null>(null);
  const renderedLengthRef = useRef(0);
  const setBodyRef = useCallback((pre: HTMLPreElement | null) => {
    if (!pre) {
      textNodeRef.current = null;
      renderedLengthRef.current = 0;
      return;
    }
    const currentText = pre.textContent ?? "";
    let textNode = pre.firstChild?.nodeType === 3 ? pre.firstChild as Text : null;
    if (!textNode || pre.childNodes.length !== 1) {
      pre.replaceChildren();
      textNode = pre.ownerDocument.createTextNode(currentText);
      pre.appendChild(textNode);
    }
    textNodeRef.current = textNode;
    renderedLengthRef.current = textNode.data.length;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const textNode = textNodeRef.current;
    if (!textNode) return;
    const renderedLength = renderedLengthRef.current;
    const overlap = Math.min(32, renderedLength, text.length);
    const diverged = overlap > 0 && (
      text.slice(0, overlap) !== textNode.data.slice(0, overlap)
      || text.slice(renderedLength - overlap, renderedLength) !== textNode.data.slice(renderedLength - overlap, renderedLength)
    );
    if (text.length < renderedLength || diverged) textNode.data = text;
    else if (text.length > renderedLength) textNode.appendData(text.slice(renderedLength));
    renderedLengthRef.current = text.length;
  }, [enabled, text]);
  return setBodyRef;
}

const STREAMING_TEXT_FRAME_MS = 30;
const STREAMING_TEXT_MAX_TRAIL = 48;

export function nextStreamingTextFrame(visibleText: string, targetText: string) {
  if (visibleText === targetText || !targetText.startsWith(visibleText)) return targetText;
  const remaining = targetText.length - visibleText.length;
  const revealLength = remaining > STREAMING_TEXT_MAX_TRAIL
    ? remaining - STREAMING_TEXT_MAX_TRAIL
    : Math.max(1, Math.ceil(remaining * 0.3));
  let end = visibleText.length + revealLength;
  // Never paint half of a surrogate pair while revealing emoji or rare glyphs.
  if (end < targetText.length) {
    const previous = targetText.charCodeAt(end - 1);
    const next = targetText.charCodeAt(end);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += 1;
  }
  return targetText.slice(0, end);
}

function useSmoothStreamingText(text: string) {
  const [visibleText, setVisibleText] = useState(text);
  const targetTextRef = useRef(text);
  targetTextRef.current = text;
  const canAnimate = typeof window !== "undefined"
    && !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isPrefix = text.startsWith(visibleText);
  const needsFrame = canAnimate && isPrefix && visibleText !== text;

  useEffect(() => {
    if (!canAnimate || !isPrefix) {
      setVisibleText(targetTextRef.current);
      return;
    }
    if (!needsFrame) return;
    const timer = window.setTimeout(() => {
      setVisibleText((current) => nextStreamingTextFrame(current, targetTextRef.current));
    }, STREAMING_TEXT_FRAME_MS);
    return () => window.clearTimeout(timer);
    // Target-only updates intentionally keep the pending frame; the ref lets it
    // consume the latest burst instead of restarting the delay for every token.
  }, [canAnimate, isPrefix, needsFrame, visibleText]);

  return canAnimate && isPrefix ? visibleText : text;
}

// Pace bursty token batches into short, adaptive frames while continuing to
// parse the visible prefix as Markdown. Large backlogs fast-forward so the UI
// stays close to the model instead of replaying a long typewriter animation.
export const StreamingAssistantText = memo(function StreamingAssistantText({ text, locale, onOpenPath, onCheckPath, onOpenUrl }: { text: string; locale: UiLocale } & MarkdownEntityActions) {
  const visibleText = useSmoothStreamingText(text);
  return <MarkdownContent text={visibleText} className="message-text streaming-assistant-text" locale={locale} onOpenPath={onOpenPath} onCheckPath={onCheckPath} onOpenUrl={onOpenUrl} />;
}, (previous, next) => previous.text === next.text && previous.locale === next.locale);

function reasoningSummary(text: string, streaming: boolean) {
  if (!text) return "";
  if (!streaming) {
    let start = 0;
    while (start < text.length) {
      const end = text.indexOf("\n", start);
      if (end < 0) return text.slice(start);
      if (end > start) return text.slice(start, end);
      start = end + 1;
    }
    return "";
  }
  let end = text.length;
  while (end > 0) {
    const start = text.lastIndexOf("\n", end - 1) + 1;
    if (end > start) return text.slice(start, end);
    end = Math.max(0, start - 1);
  }
  return "";
}

// The reasoning body is mounted on demand and appended incrementally while its
// details entry remains open.
export const ReasoningEntry = memo(function ReasoningEntry({ text, streaming, locale }: { text: string; streaming: boolean; locale: UiLocale }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useIncrementalText(text, open);
  const summary = useMemo(
    () => reasoningSummary(text, streaming) || t("conversation.reasoning.fallback", locale),
    [text, streaming, locale],
  );

  return (
    <details
      className="reasoning-entry"
      data-state={streaming ? "running" : "ok"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary><span className="reasoning-marker">Think</span><em>{summary}</em></summary>
      {open && <div className="reasoning-body"><pre aria-live="off" ref={bodyRef} /></div>}
    </details>
  );
}, (prev, next) => prev.text === next.text && prev.streaming === next.streaming && prev.locale === next.locale);

type PreviewImage = { src: string; alt: string };

type PreviewGallery = { images: TranscriptImage[]; index: number };

function MessageImage({
  image,
  index,
  locale,
  onLoadAttachment,
  onOpen,
}: {
  image: TranscriptImage;
  index: number;
  locale: UiLocale;
  onLoadAttachment?: (attachmentId: string) => Promise<string>;
  onOpen: (image: PreviewImage) => void;
}) {
  const [src, setSrc] = useState(() => imageSource(image));
  const [state, setState] = useState<"loading" | "ready" | "error">(() => src ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const alt = image.name || t("conversation.image.messageAlt", locale, { index: index + 1 });

  useEffect(() => {
    let active = true;
    const inlineSource = imageSource(image);
    if (inlineSource) {
      setSrc(inlineSource);
      setState("ready");
      return () => { active = false; };
    }
    if (!image.attachmentId || !onLoadAttachment) {
      setSrc("");
      setState("error");
      return () => { active = false; };
    }
    setSrc("");
    setState("loading");
    void onLoadAttachment(image.attachmentId).then((loadedSource) => {
      if (!active) return;
      setSrc(loadedSource);
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [attempt, image, onLoadAttachment]);

  if (state === "loading") return <span className="message-image-placeholder" role="status">{t("conversation.image.loading", locale)}</span>;
  if (state === "error" || !src) {
    return <button className="message-image-placeholder error" type="button" onClick={() => setAttempt((value) => value + 1)} title={t("conversation.image.reload", locale)}>{t("conversation.image.loadError", locale)}</button>;
  }
  return <button
    className="message-image-link"
    type="button"
    onClick={() => onOpen({ src, alt })}
    title={t("conversation.image.zoomIn", locale)}
    aria-label={t("conversation.image.enlarge", locale, { name: alt })}
  >
    <img src={src} alt={alt} loading="lazy" onError={() => setState("error")} />
  </button>;
}

// Memoized by image value: the transcript rebuilds create fresh image objects
// every frame, but unchanged attachments should neither re-render nor re-trigger
// the attachment-loading effect inside MessageImage.
const MessageImages = memo(function MessageImages({
  images,
  locale,
  onLoadAttachment,
  onOpen,
}: {
  images: TranscriptImage[];
  locale: UiLocale;
  onLoadAttachment?: (attachmentId: string) => Promise<string>;
  onOpen: (image: PreviewImage, images: TranscriptImage[], index: number) => void;
}) {
  return <div className="message-images">
    {images.map((image, index) => <MessageImage
      image={image}
      index={index}
      locale={locale}
      onLoadAttachment={onLoadAttachment}
      onOpen={(preview) => onOpen(preview, images, index)}
      key={`${image.attachmentId ?? image.name ?? "inline"}-${index}`}
    />)}
  </div>;
}, (prev, next) => sameImages(prev.images, next.images) && prev.locale === next.locale);

/** Attachment gallery: current image with lazy load, prev/next, keyboard. */
function MessageLightbox({
  gallery,
  locale,
  onLoadAttachment,
  onClose,
  onNavigate,
}: {
  gallery: PreviewGallery;
  locale: UiLocale;
  onLoadAttachment?: (attachmentId: string) => Promise<string>;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const { images, index } = gallery;
  const current = images[index];
  const [src, setSrc] = useState<string | null>(() => current ? imageSource(current) || null : null);
  const [state, setState] = useState<"loading" | "ready" | "error">(() => src ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const alt = current?.name || t("conversation.image.alt", locale, { index: index + 1 });

  useEffect(() => {
    let active = true;
    if (!current) {
      setSrc(null);
      setState("error");
      return () => { active = false; };
    }
    const inline = imageSource(current);
    if (inline) {
      setSrc(inline);
      setState("ready");
      return () => { active = false; };
    }
    if (!current.attachmentId || !onLoadAttachment) {
      setSrc(null);
      setState("error");
      return () => { active = false; };
    }
    setSrc(null);
    setState("loading");
    void onLoadAttachment(current.attachmentId).then((loaded) => {
      if (!active) return;
      setSrc(loaded);
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [attempt, current, onLoadAttachment]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      if (event.key === "ArrowRight" && index < images.length - 1) onNavigate(index + 1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [images.length, index, onClose, onNavigate]);

  return <div className="message-lightbox" role="dialog" aria-modal="true" aria-label={t("conversation.image.gallery", locale)} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="message-lightbox-toolbar">
      <span>{index + 1} / {images.length} · {alt}</span>
      <button type="button" onClick={onClose} aria-label={t("conversation.image.closeGallery", locale)} title={t("conversation.image.closeEsc", locale)}><X aria-hidden="true" /></button>
    </div>
    <div className="message-lightbox-stage">
      {state === "loading" && <span className="message-image-placeholder" role="status">{t("conversation.image.loading", locale)}…</span>}
      {state === "error" && <button className="message-image-placeholder error" type="button" onClick={() => setAttempt((value) => value + 1)} title={t("conversation.image.reload", locale)}>{t("conversation.image.loadError", locale)}</button>}
      {state === "ready" && src !== null && <img className="message-lightbox-image" src={src} alt={alt} onClick={onClose} />}
    </div>
    {images.length > 1 && <div className="message-lightbox-nav">
      <button type="button" disabled={index === 0} onClick={() => onNavigate(index - 1)} aria-label={t("conversation.image.previous", locale)}><ChevronLeft aria-hidden="true" /></button>
      <div className="message-lightbox-thumbs">
        {images.map((image, thumbIndex) => (
          <button
            type="button"
            className={thumbIndex === index ? "active" : ""}
            key={`${image.attachmentId ?? image.name ?? "inline"}-${thumbIndex}`}
            onClick={() => onNavigate(thumbIndex)}
            aria-label={t("conversation.image.viewNth", locale, { index: thumbIndex + 1 })}
            title={image.name || t("conversation.image.alt", locale, { index: thumbIndex + 1 })}
          >
            <LightboxThumb image={image} />
          </button>
        ))}
      </div>
      <button type="button" disabled={index >= images.length - 1} onClick={() => onNavigate(index + 1)} aria-label={t("conversation.image.next", locale)}><ChevronRight aria-hidden="true" /></button>
    </div>}
  </div>;
}

function LightboxThumb({ image }: { image: TranscriptImage }) {
  const [src, setSrc] = useState<string | null>(() => imageSource(image) || null);
  useEffect(() => {
    setSrc(imageSource(image) || null);
  }, [image]);
  return src === null
    ? <span className="message-lightbox-thumb-placeholder" aria-hidden="true" />
    : <img src={src} alt="" loading="lazy" />;
}

type TranscriptArticleProps = {
  item: TranscriptItem;
  /** True only for entries appended after the active transcript was first painted. */
  entered: boolean;
  retryingMessageSeq: number | null;
  activeRunning: boolean;
  loading: boolean;
  activeSessionId: string | null;
  locale: UiLocale;
  uiRuntime: DesktopUiRuntime;
  uiHost: UiHostActions;
  onPreviewImage: (image: PreviewImage, images: TranscriptImage[], index: number) => void;
  onLoadImageAttachment?: (attachmentId: string) => Promise<string>;
  onCopyMessage: (text: string) => void | Promise<void>;
  onRequestCopyMenu: (item: TranscriptItem, x: number, y: number, target: EventTarget | null) => void;
  onRetryMessage?: (seq: number) => void | Promise<void>;
  onForkSession: (sessionId: string, seq?: number) => void | Promise<void>;
  onOpenPath: (path: string, location?: { line?: number }) => void | Promise<void>;
  onCheckPath: (path: string) => Promise<boolean>;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenWorkflowMember?: (childId: string, label: string) => void | Promise<void>;
};

/** Workflow state labels shown in the transcript heading (keys in conversation.workflow.status.*). */
function workflowStatusKey(status: string): string {
  if (status === "running") return "conversation.workflow.status.running";
  if (status === "completed") return "conversation.workflow.status.completed";
  if (status === "cancelled") return "conversation.workflow.status.cancelled";
  if (status === "interrupted") return "conversation.workflow.status.interrupted";
  return "conversation.workflow.status.failed";
}

function TranscriptArticleView({
  item,
  entered,
  retryingMessageSeq,
  activeRunning,
  loading,
  activeSessionId,
  locale,
  uiRuntime,
  uiHost,
  onPreviewImage,
  onLoadImageAttachment,
  onCopyMessage,
  onRequestCopyMenu,
  onRetryMessage,
  onForkSession,
  onOpenPath,
  onCheckPath,
  onOpenUrl,
  onOpenWorkflowMember,
}: TranscriptArticleProps) {
  const diff = activeDiff(item);
  const hasToolResult = item.toolResultText !== undefined || item.toolResultDiff !== undefined || isResultDomainCard(item.domainCard) || item.toolState === "result";
  const toolStatus = item.toolResultError ? "error" : hasToolResult ? "returned" : "running";
  const streamingAssistant = item.kind === "assistant" && item.streaming === true;
  return (
    <article
      className={`message-row ${item.kind}${item.injected ? " context-row" : ""}${item.kind === "tool" ? " tool-row" : ""}${streamingAssistant ? " is-streaming" : ""}${entered ? " is-entering" : ""}`}
      data-message-state={streamingAssistant ? "streaming" : "settled"}
      data-seq={item.seq}
      {...(item.seqFrom !== undefined && item.seqFrom !== item.seq ? { "data-seq-from": item.seqFrom } : {})}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return;
        if (!isWithinSelector(event.target, TRANSCRIPT_TEXT_SELECTOR)) return;
        event.preventDefault();
        onRequestCopyMenu(item, event.clientX, event.clientY, event.target);
      }}
    >
      {item.kind !== "tool" && item.kind !== "reasoning" && <div className="message-gutter"><span>{item.label}</span><time>{formatClock(item.time)}</time>{item.messageId && activeSessionId && (item.kind === "user" || item.kind === "assistant") && <SlotOutlet
        runtime={uiRuntime}
        slot="conversation.message.actions"
        variant="message-badge"
        context={{
          session: uiRuntime.sessionContext,
          activeSessionId,
          sessionGeneration: uiRuntime.sessionGeneration,
          locale,
          host: uiHost,
          message: { sessionId: activeSessionId, messageId: item.messageId, role: item.kind, ...(item.seq === undefined ? {} : { seq: item.seq }) },
        }}
        onActionError={(message) => uiHost.notify(message, "error")}
      />}</div>}
      <div className="message-content">
        {item.images && item.images.length > 0 && <MessageImages images={item.images} locale={locale} onLoadAttachment={onLoadImageAttachment} onOpen={onPreviewImage} />}
        {item.kind === "tool" ? (
          <ToolEntryView
            item={item}
            diff={diff}
            hasToolResult={hasToolResult}
            toolStatus={toolStatus}
            locale={locale}
            onOpenUrl={onOpenUrl}
            onOpenPath={onOpenPath}
          />
        ) : item.kind === "reasoning" ? (
          <ReasoningEntry text={item.text} streaming={Boolean(item.streaming)} locale={locale} />
        ) : item.kind === "workflow" ? (
          <details className={`workflow-entry workflow-status-${item.workflow?.status ?? "running"}`} data-workflow-status={item.workflow?.status ?? "running"} open={item.workflow?.status === "running"}>
            <summary><span className={`workflow-status ${item.workflow?.status ?? "running"}`} />{item.workflow?.name || item.text}<em>{item.workflow ? t(workflowStatusKey(item.workflow.status), locale) : "Workflow"}</em></summary>
            <div className="workflow-body">{item.workflow?.phases.length ? item.workflow.phases.map((phase, phaseIndex) => <div className="workflow-phase" key={`${item.key}-phase-${phaseIndex}`}><strong>{phase.phase || t("conversation.workflow.unnamedPhase", locale)}</strong><div>{phase.members.map((member) => {
              const childId = member.childId;
              const navigable = Boolean(childId && onOpenWorkflowMember);
              return <button
                className={`workflow-member ${member.status}${navigable ? " navigable" : ""}`}
                type="button"
                key={`${member.childId}-${member.label}`}
                onClick={() => { if (childId && onOpenWorkflowMember) onOpenWorkflowMember(childId, member.label); }}
                title={navigable ? t("conversation.workflow.openChild", locale, { id: childId.slice(0, 8) }) : undefined}
                disabled={!navigable}
              ><i />{member.label}</button>;
            })}</div></div>) : <span className="workflow-empty">{t("conversation.workflow.emptyMembers", locale)}</span>}</div>
          </details>
        ) : item.injected ? (
          <details className="injected-entry">
            <summary>
              <span className="injected-state" aria-hidden="true" />
              <strong>{item.label}</strong>
              {item.source && <><span className="injected-separator" aria-hidden="true" /><span className="injected-source">{item.source}</span></>}
              {item.contextSummary && <><span className="injected-separator" aria-hidden="true" /><span className="injected-summary">{item.contextSummary}</span></>}
            </summary>
            <div className="injected-body" data-context-form={item.contextForm ?? undefined}>
              <pre className="message-text">{item.text}</pre>
            </div>
          </details>
        ) : streamingAssistant ? (
          <StreamingAssistantText text={item.text} locale={locale} onOpenPath={onOpenPath} onCheckPath={onCheckPath} onOpenUrl={onOpenUrl} />
        ) : <MarkdownContent text={item.text} locale={locale} onOpenPath={onOpenPath} onCheckPath={onCheckPath} onOpenUrl={onOpenUrl} />}
        {item.kind === "assistant" && <MessageStatsLine stats={item.stats} locale={locale} />}
        {(item.kind === "user" || item.kind === "assistant") && (
          <div className="message-actions">
             {item.kind === "user" && item.seq !== undefined && onRetryMessage && (
               <button
                 type="button"
                 className="retry-message-button"
                 disabled={activeRunning || loading || retryingMessageSeq !== null}
                 onClick={() => void onRetryMessage(item.seq!)}
                 title={t("conversation.retry.title", locale)}
               >
                 {retryingMessageSeq === item.seq ? t("conversation.retry.retrying", locale) : t("common.retry", locale)}
               </button>
             )}
            <button type="button" onClick={() => void onCopyMessage(item.text)} title={t("conversation.copy.message", locale)}>{t("common.copy", locale)}</button>
            {item.messageId && activeSessionId && <SlotOutlet
              runtime={uiRuntime}
              slot="conversation.message.actions"
              variant="message-actions"
              context={{
                session: uiRuntime.sessionContext,
                activeSessionId,
                sessionGeneration: uiRuntime.sessionGeneration,
                locale,
                host: uiHost,
                message: { sessionId: activeSessionId, messageId: item.messageId, role: item.kind === "user" ? "user" : "assistant", ...(item.seq === undefined ? {} : { seq: item.seq }) },
              }}
              onActionError={(message) => uiHost.notify(message, "error")}
            />}
             {item.kind === "assistant" && item.seq !== undefined && activeSessionId && (
              <button type="button" onClick={() => void onForkSession(activeSessionId, item.seq)} title={t("conversation.forkFromMessage", locale)}>{t("conversation.fork", locale)}</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// Callbacks are intentionally not compared: they are either stable
// (onPreviewImage / onLoadImageAttachment) or safe to hold as stale closures
// because their visible state is represented by the compared props and the
// UI Runtime identity.
const TranscriptArticle = memo(TranscriptArticleView, (prev, next) => {
  if (!sameItemFields(prev.item, next.item)) return false;
  return prev.entered === next.entered
    && prev.retryingMessageSeq === next.retryingMessageSeq
    && prev.activeRunning === next.activeRunning
    && prev.loading === next.loading
    && prev.activeSessionId === next.activeSessionId
    && prev.locale === next.locale
    && prev.uiRuntime === next.uiRuntime
    && prev.uiHost === next.uiHost;
});

export function appendedTranscriptKeys(previousKeys: ReadonlySet<string>, transcript: readonly TranscriptItem[]) {
  let finalKnownIndex = -1;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (previousKeys.has(transcript[index].key)) {
      finalKnownIndex = index;
      break;
    }
  }
  // A full replacement under the same session is a projection reset, not a
  // newly appended turn. An empty prior projection is the one exception.
  if (previousKeys.size > 0 && finalKnownIndex === -1) return [];
  return transcript.slice(finalKnownIndex + 1).filter((item) => !previousKeys.has(item.key)).map((item) => item.key);
}

const TRANSCRIPT_ENTER_MS = 180;

function useEnteredTranscriptKeys(transcript: readonly TranscriptItem[], activeSessionId: string | null) {
  const seenRef = useRef<{ sessionId: string | null; keys: ReadonlySet<string> } | null>(null);
  const [entered, setEntered] = useState<{ sessionId: string | null; keys: ReadonlySet<string> }>(() => ({ sessionId: activeSessionId, keys: new Set() }));

  useEffect(() => {
    const previous = seenRef.current;
    const keys = new Set(transcript.map((item) => item.key));
    seenRef.current = { sessionId: activeSessionId, keys };
    // The initial/session-switch projection is history, not a newly arrived event.
    if (!previous || previous.sessionId !== activeSessionId) {
      setEntered({ sessionId: activeSessionId, keys: new Set() });
      return;
    }
    // Paging history prepends rows before known entries, so only appended
    // events receive an entrance animation.
    const additions = appendedTranscriptKeys(previous.keys, transcript);
    if (additions.length === 0) return;
    setEntered((current) => ({ sessionId: activeSessionId, keys: new Set([...current.keys, ...additions]) }));
  }, [activeSessionId, transcript]);

  useEffect(() => {
    if (entered.keys.size === 0) return;
    const timer = window.setTimeout(() => setEntered((current) => ({ ...current, keys: new Set() })), TRANSCRIPT_ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [entered]);

  return entered.sessionId === activeSessionId ? entered.keys : new Set<string>();
}

export function ConversationTranscript({
  locale = "zh",
  scrollRef,
  endRef,
  history,
  transcript,
  activeSession,
  activeSessionId,
  activeRunning,
  loading,
  workingIndicator,
  historyHasMore,
  historyLoadingOlder,
  transcriptFollowing,
  trajectoryOpen,
  workspace,
  runtimeDirectory,
  modelName,
  presets,
  uiRuntime,
  uiHost,
  nextPreset,
  presetMenuOpen,
  onLoadImageAttachment,
  retryingMessageSeq = null,
  onLoadOlder,
  onFollowingChange,
  onJumpToLatest,
  onTogglePresetMenu,
  onStagePreset,
  onCopyMessage,
  onCopySelection,
  onRetryMessage,
  onForkSession,
  onOpenSessionPath,
  onOpenUrl,
  onOpenWorkflowMember,
  turnItems,
  turnActiveTurn = null,
  turnBusyTurn = null,
  onTurnNavigate,
}: ConversationTranscriptProps) {
  const [previewGallery, setPreviewGallery] = useState<PreviewGallery | null>(null);
  const enteredTranscriptKeys = useEnteredTranscriptKeys(transcript, activeSessionId);

  // 会话文本右键复制菜单：右击选中文本时可复制选区，或复制整条消息。
  type TranscriptCopyMenu = {
    x: number;
    y: number;
    selection: string;
    message: string;
    hasMessageCopy: boolean;
  };
  const [copyMenu, setCopyMenu] = useState<TranscriptCopyMenu | null>(null);
  const { menuRef, menuAt } = useFloatingMenuPosition(copyMenu);

  useEffect(() => {
    if (!copyMenu) return;
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(TRANSCRIPT_CONTEXT_MENU_SELECTOR)) setCopyMenu(null);
    };
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(TRANSCRIPT_CONTEXT_MENU_SELECTOR)) return;
      setCopyMenu(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setCopyMenu(null);
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [copyMenu]);

  const requestCopyMenu = useCallback((item: TranscriptItem, x: number, y: number, target: EventTarget | null) => {
    // 只允许在可选中文本表面打开复制菜单：选区为空时该项置灰，但消息复制仍可用。
    if (!isWithinSelector(target, TRANSCRIPT_TEXT_SELECTOR)) return;
    const selection = typeof window === "undefined" ? "" : (window.getSelection()?.toString() ?? "");
    setCopyMenu({ x, y, selection, message: item.text, hasMessageCopy: item.kind !== "tool" });
  }, []);
  const checkPath = useCallback(async (path: string) => {
    if (!activeSession?.cwd) return false;
    return isFilePath(sessionPath(activeSession.cwd, path));
  }, [activeSession?.cwd]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    onFollowingChange(target.scrollHeight - target.scrollTop - target.clientHeight < 64);
  }

  const selectablePresets = presets.filter((preset) => !preset.broken);
  const selectedPresetId = nextPreset || selectablePresets.find((preset) => preset.isDefault)?.id || selectablePresets[0]?.id || "";

  return (
    <>
    <div className="transcript" ref={scrollRef} aria-live={trajectoryOpen ? undefined : "polite"} onScroll={handleScroll}>
      {!trajectoryOpen && turnItems !== undefined && onTurnNavigate !== undefined && (
        <TurnRail items={turnItems} activeTurn={turnActiveTurn} busyTurn={turnBusyTurn} onNavigate={onTurnNavigate} locale={locale} />
      )}
      {!trajectoryOpen && historyHasMore && (
        <button className="history-load-more" type="button" disabled={historyLoadingOlder} onClick={() => void onLoadOlder()}>
          {historyLoadingOlder ? t("conversation.history.loadingOlder", locale) : t("conversation.history.loadOlder", locale)}
        </button>
      )}
      {!trajectoryOpen && !transcriptFollowing && history.length > 0 && (
        <button className="transcript-jump" type="button" onClick={onJumpToLatest} title={t("conversation.history.jumpToLatest", locale)}>{t("conversation.history.jumpToLatest", locale)}</button>
      )}
      {trajectoryOpen ? (
        <TrajectoryView entries={history} active={activeRunning || loading} locale={locale} />
      ) : transcript.length === 0 && !loading ? (
        <div className="empty-conversation">
          <div className="empty-mark" role="img" aria-label="Deeptop">
            <span className="empty-mark-text" aria-hidden="true">Deeptop</span>
          </div>
          <h1>{activeSession ? t("conversation.empty.continue", locale) : t("conversation.empty.start", locale)}</h1>
          <p>{activeSession ? t("conversation.empty.continueHint", locale) : t("conversation.empty.startHint", locale)}</p>
          <div className="empty-meta"><span>{workspace || runtimeDirectory || t("conversation.empty.runtimeDir", locale)}</span><span>{modelName}</span></div>
          {!activeSession && selectablePresets.length > 0 && (
            <div className="preset-seat">
              <button className="preset-seat-trigger" type="button" aria-haspopup="menu" aria-expanded={presetMenuOpen} onClick={onTogglePresetMenu}>
                <span className="preset-seat-kicker">Agent Preset</span>
                <strong>{presetDisplayName(selectedPresetId, presets, locale)}</strong>
                <span className="preset-seat-chevron" aria-hidden="true"><ChevronDown /></span>
              </button>
              {presetMenuOpen && <div className="preset-seat-menu" role="menu" aria-label={t("conversation.preset.chooseAria", locale)}>
                {selectablePresets.map((preset) => <button className={preset.id === selectedPresetId ? "selected" : ""} type="button" role="menuitem" key={preset.id} onClick={() => onStagePreset(preset.id)}>
                  <span><strong>{presetDisplayName(preset.id, presets, locale)}</strong><small>{presetDescription(preset, locale)}</small></span>
                  {preset.id === selectedPresetId && <b aria-hidden="true"><Check /></b>}
                </button>)}
              </div>}
            </div>
          )}
        </div>
      ) : (
        <div className="transcript-inner">
          {transcript.filter((item) => item.kind !== "deliverables").map((item) => (
            <TranscriptArticle
              key={item.key}
              item={item}
              entered={enteredTranscriptKeys.has(item.key)}
               uiRuntime={uiRuntime}
              uiHost={uiHost}
              retryingMessageSeq={retryingMessageSeq}
              activeRunning={activeRunning}
              loading={loading}
              activeSessionId={activeSessionId}
              locale={locale}
              onPreviewImage={(image, images, index) => setPreviewGallery({ images, index })}
              onLoadImageAttachment={onLoadImageAttachment}
              onCopyMessage={onCopyMessage}
              onRequestCopyMenu={requestCopyMenu}
              onRetryMessage={onRetryMessage}
              onForkSession={onForkSession}
               onOpenPath={onOpenSessionPath}
               onCheckPath={checkPath}
               onOpenUrl={onOpenUrl}
              onOpenWorkflowMember={onOpenWorkflowMember}
            />
          ))}
          {(loading || activeRunning) && <WorkingIndicator settings={workingIndicator} locale={locale} />}
           <div ref={endRef} />
        </div>
      )}
    </div>
    {previewGallery && <MessageLightbox
      gallery={previewGallery}
      locale={locale}
      onLoadAttachment={onLoadImageAttachment}
      onClose={() => setPreviewGallery(null)}
      onNavigate={(index) => setPreviewGallery((current) => current ? { ...current, index } : current)}
    />}
    {copyMenu && createPortal(
      <div
        ref={menuRef}
        className="transcript-text-context-menu"
        role="menu"
        aria-label={t("conversation.copyMenu.aria", locale)}
        style={menuAt ? { left: menuAt.left, top: menuAt.top } : { left: copyMenu.x, top: copyMenu.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" role="menuitem" disabled={!copyMenu.selection} onClick={() => {
          const text = copyMenu.selection;
          setCopyMenu(null);
          if (text) void onCopySelection(text);
        }}>{t("conversation.copyMenu.selection", locale)}</button>
        {copyMenu.hasMessageCopy && <button type="button" role="menuitem" onClick={() => {
          const text = copyMenu.message;
          setCopyMenu(null);
          void onCopyMessage(text);
        }}>{t("conversation.copy.message", locale)}</button>}
      </div>,
      document.body,
    )}
    </>
  );
}
