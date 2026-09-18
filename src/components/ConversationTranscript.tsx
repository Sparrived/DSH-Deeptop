import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type UIEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, FileText, X, ZoomIn, ZoomOut } from "lucide-react";
import { createPortal } from "react-dom";
import { isFilePath, type DshHistoryEntry, type DshPreset, type DshSessionSummary } from "../lib/desktop";
import type { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import type { UiHostActions } from "../lib/desktop-ui-runtime/types";
import { SlotOutlet } from "./SlotOutlet";
import { TurnRail } from "./TurnRail";
import type { TurnRailItem } from "../app/turn-rail-model";
import { MarkdownContent } from "../lib/markdown";
import { appendInkRun, clearInkRuns, STREAM_INK_MAX_AGE, streamInkRuns, type InkSpan, type StreamInk, type StreamInkChunk } from "../lib/stream-ink";

type MarkdownEntityActions = {
  onOpenPath?: (path: string, location?: { line?: number }) => void | Promise<void>;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenUrl?: (url: string) => void | Promise<void>;
};
import { TrajectoryView } from "./TrajectoryView";
import { PtcProgramView } from "./PtcProgramView";
import type { PtcProgram } from "../app/ptc-program";
import { durationLabel } from "../app/trajectory";
import { isResultDomainCard, toolDomainCard, type ToolDomainCard } from "../app/tool-domain";
import { ToolArgsView } from "../app/tool-args-render";
import { displayToolName, hasVisibleToolArguments, parseToolArgs, toolArgsLayout, toolCallEditDiff, toolCallSummary } from "../app/tool-call-display";
import { ToolResultView } from "../app/tool-result-render";
import { imageResultEnvelope } from "../app/image-result-model";
import { entityHost } from "../lib/message-entities";
import { DisclosureEntry } from "./DisclosureEntry";
import { isWithinSelector, TRANSCRIPT_CONTEXT_MENU_SELECTOR, TRANSCRIPT_TEXT_SELECTOR } from "../app/context-menu";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { useImagePanZoom } from "../app/useImagePanZoom";
import { IMAGE_ZOOM_BUTTON_FACTOR, IMAGE_ZOOM_MAX, IMAGE_ZOOM_MIN } from "../app/image-preview-model";
import { applyStepToggle, groupTranscriptTurns, stepKindCounts, type TranscriptTurnGroup } from "../app/turn-group-model";
import { formatAttachmentBytes } from "../app/ui-model";
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
import type { DeliverableFileDiff, MessageStats, TranscriptFile, TranscriptImage, WorkingIndicatorSettings } from "../app/model";
import { normalizeWorkingIndicator, workingIndicatorEffectClass, workingIndicatorTextAt } from "../app/working-indicator";
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
  /**
   * 整轮（用户看到的这一件事）是否仍在推进：由 turn/start、子代理、后台任务、目标、
   * 待办、等待输入等信号合成。为真时当前轮次的中间步骤保持展开。
   */
  loopLive?: boolean;
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
    <div className={`agent-working ${workingIndicatorEffectClass(safeSettings)}`} role="status" aria-label={t("conversation.working", locale)} style={{ "--working-indicator-color": safeSettings.color, "--working-indicator-gradient-color": safeSettings.gradientColor } as CSSProperties}>
      {/* 「隐藏」只关掉可见文字，role="status" 仍把运行状态留给读屏。 */}
      {safeSettings.effect !== "hidden" && <span aria-hidden="true">{workingIndicatorTextAt(safeSettings, index)}</span>}
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
 * PTC 折叠条尾部的统计串：调用数 · 并行峰值 · 失败数 · 程序总耗时。
 * 只列出真实存在的数字：没有并行、没有失败、耗时未定时都不占位。
 *
 * @param program - 该行的 PTC 执行视图。
 * @param locale - 界面语言。
 * @returns 供折叠条尾部显示的统计串。
 */
export function programStatsText(program: PtcProgram, locale: UiLocale): string {
  const { stats } = program;
  const parts = [t("conversation.ptc.calls", locale, { count: stats.calls })];
  if (stats.parallel >= 2) parts.push(t("conversation.ptc.parallel", locale, { count: stats.parallel }));
  if (stats.failures > 0) parts.push(t("conversation.ptc.failures", locale, { count: stats.failures }));
  if (stats.spanMs !== undefined) parts.push(durationLabel(stats.spanMs, locale));
  return parts.join(" · ");
}

/**
 * 程序执行中：折叠条尾显示正在派发的那次调用与进度。
 *
 * @param program - 该行的 PTC 执行视图。
 * @param locale - 界面语言。
 * @returns 形如「bash · ls · 3/5」的运行中摘要。
 */
export function programTickerText(program: PtcProgram, locale: UiLocale): string {
  const active = program.active;
  const done = program.stats.calls - program.stats.running;
  const progress = t("conversation.ptc.ticker", locale, { done, total: program.stats.calls });
  if (!active) return progress;
  return [displayToolName(active.name), active.summary, progress].filter(Boolean).join(" · ");
}

/**
 * 工具行渲染:
 *   - 默认展示「可视化卡片」:`ToolArgsView` 解析参数,`ToolResultView` 解析结果
 *   - 每个 part 顶部都有「查看原文」按钮,可独立切换回原始 JSON/文本
 *   - 保持原 tool-entry / tool-parts / DiffResult 视觉骨架,只在内部替换
 *     原本的 `<pre>` 内容;DiffResult 始终保留(属于「已有可视化」,按要求
 *     保留并继续渲染)。
 *
 * 直接导出给组件测试渲染：测试渲染器只展开顶层组件,把工具行交给它才看得见
 * 参数卡片与结果卡片的实际输出。
 */
export function ToolEntryView({
  item,
  diff,
  hasToolResult,
  toolStatus,
  locale,
  onOpenUrl,
  onOpenPath,
  onPreviewImage,
  onLoadImageAttachment,
}: {
  item: TranscriptItem;
  diff: DiffSummary | undefined;
  hasToolResult: boolean;
  toolStatus: "error" | "returned" | "running";
  locale: UiLocale;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPath: (path: string, location?: { line?: number }) => void | Promise<void>;
  onPreviewImage: (image: PreviewImage, images: TranscriptImage[], index: number) => void;
  onLoadImageAttachment?: (attachmentId: string) => Promise<string>;
}) {
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [showRawResult, setShowRawResult] = useState(false);
  // 工具报错时自动展开（原来由 `<details open>` 承担），其余情况默认收起。
  const [open, setOpen] = useState(Boolean(item.toolResultError));
  const errorRef = useRef(Boolean(item.toolResultError));
  const args = useMemo(() => parseToolArgs(item.text), [item.text]);
  const description = toolCallSummary(item.toolName, args);
  const argsLayout = toolArgsLayout(item.toolName, args ?? {});
  // PTC 行：程序内部每次子调用都在 item.program 里，参数区改成「程序 / 执行」双栏，
  // 结果区继续渲染程序自己打印与返回的内容。
  const program = item.program;
  const hasVisibleArgs = Boolean(program) || hasVisibleToolArguments(item.toolName, args) || (args === undefined && Boolean(item.text.trim()));
  const editDiff = args ? toolCallEditDiff(item.toolName, args) : undefined;
  const displayName = displayToolName(item.toolName);
  const resultImageNote = item.images?.length ? imageResultEnvelope(item.toolResultText ?? "") : undefined;

  useEffect(() => {
    const failed = Boolean(item.toolResultError);
    if (errorRef.current === failed) return;
    errorRef.current = failed;
    if (failed) setOpen(true);
  }, [item.toolResultError]);

  return (
    <DisclosureEntry
      base="tool-entry"
      className={`tool-status-${toolStatus} tool-layout-${argsLayout}${program ? " tool-layout-program" : ""} ${hasToolResult && hasVisibleArgs ? "tool-paired" : ""} ${!hasVisibleArgs ? "tool-result-only" : ""} ${item.toolResultError ? "tool-error" : ""}`}
      data-tool-status={toolStatus}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      summary={<>
        <span className="tool-summary-main"><span className="tool-state" aria-hidden="true" /><span className="tool-name">{displayName}</span></span>
        {description && <span className="tool-description">{description}</span>}
        {diff && <span className="tool-diff-badge" key={`${item.key}-diff-${diff.added}-${diff.removed}`} aria-label={t("conversation.tool.diffAria", locale, { added: diff.added, removed: diff.removed })}><b>+{diff.added}</b><b>-{diff.removed}</b></span>}
        <span className={`tool-status ${toolStatus}`}><span className="tool-status-dot" aria-hidden="true" />{item.toolResultError ? t("conversation.tool.error", locale) : hasToolResult ? t("conversation.tool.returned", locale) : t("conversation.tool.running", locale)}{program && <span className={`ptc-stats${program.active ? " live" : ""}`}>{program.active && <span className="ptc-ticker-dot" aria-hidden="true" />}{program.active ? programTickerText(program, locale) : programStatsText(program, locale)}</span>}</span>
        <span className="tool-toggle" aria-hidden="true" />
      </>}
    >
      <div className="tool-parts">
        {item.domainCard && !isResultDomainCard(item.domainCard) && <section className="tool-part tool-domain-part"><div className="tool-part-label"><span>{t("conversation.tool.domainView", locale)}</span></div><ToolDomainCardView card={item.domainCard} locale={locale} onOpenUrl={onOpenUrl} /></section>}
        {hasVisibleArgs && <section className={`tool-part tool-call-part${program ? " tool-program-part" : ""}`}>
          {/* 程序行的分栏自带头部（程序 / 执行 + 各自的计数与调用时间），这里再放一层
              「程序」标签只会把同一个词说两遍。 */}
          {!program && <div className="tool-part-label">
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
          </div>}
          {program
            ? <PtcProgramView program={program} locale={locale} open={open} timeLabel={formatClock(item.time)} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />
            : showRawArgs
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
            {/* 结果自带的图片（read_image）在结果区按附件渲染：源文件可能已经被删掉，
                这些字节来自会话附件，加载后留在 ImageAttachmentCache 里。模型信封对
                读者只剩路径与尺寸，解析得出就换成一行说明，「查看原文」仍给出完整信封。 */}
            {item.images && item.images.length > 0 && <div className="tool-result-images">
              <MessageImages images={item.images} locale={locale} onLoadAttachment={onLoadImageAttachment} onOpen={onPreviewImage} />
            </div>}
            {item.toolResultText !== undefined && (
              showRawResult
                ? <pre>{item.toolResultText}</pre>
                : resultImageNote
                  ? <div className="tool-result-image-note">
                    <code className="tool-result-image-path">{resultImageNote.path}</code>
                    <p>{resultImageNote.detail}</p>
                  </div>
                  : <ToolResultView text={item.toolResultText} locale={locale} />
            )}
          </section>
        )}
      </div>
    </DisclosureEntry>
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

function sameFileAttachments(left: TranscriptFile[] | undefined, right: TranscriptFile[] | undefined) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (a.attachmentId !== b.attachmentId || a.name !== b.name || a.bytes !== b.bytes) return false;
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

function sameDeliverableFiles(left: string[] | undefined, right: string[] | undefined) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((path, index) => path === right[index]);
}

function sameFileDiffs(left: Record<string, DeliverableFileDiff> | undefined, right: Record<string, DeliverableFileDiff> | undefined) {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const a = left[key];
    const b = right[key];
    return a === b || (b !== undefined && a.added === b.added && a.removed === b.removed);
  });
}

function sameDomainCard(left: ToolDomainCard | undefined, right: ToolDomainCard | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * PTC 执行视图的值比较。
 *
 * 每次 transcript 重建都会为同一批事件生成新的视图对象，逐字段比较让未变化的行继续
 * 命中 memo：折叠条读 stats/active，正文读每个调用的状态、耗时与结果。
 */
function sameProgram(left: PtcProgram | undefined, right: PtcProgram | undefined) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.lines.length !== right.lines.length
    || left.unplaced.length !== right.unplaced.length
    || left.caughtFailures !== right.caughtFailures
    || left.active?.callId !== right.active?.callId
    || left.stats.calls !== right.stats.calls
    || left.stats.failures !== right.stats.failures
    || left.stats.running !== right.stats.running
    || left.stats.spanMs !== right.stats.spanMs
    || left.stats.maxDurationMs !== right.stats.maxDurationMs
    || left.stats.parallel !== right.stats.parallel
    || left.calls.length !== right.calls.length) return false;
  for (let index = 0; index < left.calls.length; index += 1) {
    const a = left.calls[index];
    const b = right.calls[index];
    if (a.callId !== b.callId
      || a.name !== b.name
      || a.state !== b.state
      || a.durationMs !== b.durationMs
      || a.line !== b.line
      || a.concurrent !== b.concurrent
      || a.resultText !== b.resultText) return false;
  }
  return true;
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
    && sameFileAttachments(left.fileAttachments, right.fileAttachments)
    && sameStats(left.stats, right.stats)
    && sameProgram(left.program, right.program)
    // 生成文件卡片是增量长出来的：present 与后续写入会往同一条目追文件。
    // 不比较这两个字段就会让最新一次更新被 memo 吃掉，卡片停在旧内容上。
    && sameDeliverableFiles(left.files, right.files)
    && sameFileDiffs(left.fileDiffs, right.fileDiffs)
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

/** 动效可用性：系统要求减少动效时，流式文字直接坐实，不做任何渐显。 */
function streamMotionEnabled() {
  return typeof window !== "undefined" && typeof document !== "undefined"
    && !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Keeps one text node per body and appends the streamed suffix into it, so a
// long reasoning block never re-parses or re-creates its DOM while it grows.
// 开着动效时，新写下的后缀先挂成正在淡入的 span，淡完再并回那个文本节点
// （见 stream-ink.ts 的 appendInkRun），于是正文仍然只有一个文本节点。
function useIncrementalText(text: string) {
  const textNodeRef = useRef<Text | null>(null);
  const renderedRef = useRef("");
  const pendingRef = useRef<InkSpan[]>([]);
  const setBodyRef = useCallback((pre: HTMLPreElement | null) => {
    if (!pre) {
      textNodeRef.current = null;
      renderedRef.current = "";
      pendingRef.current = [];
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
    renderedRef.current = currentText;
    pendingRef.current = [];
  }, []);

  useEffect(() => {
    const textNode = textNodeRef.current;
    if (!textNode) return;
    const rendered = renderedRef.current;
    const overlap = Math.min(32, rendered.length, text.length);
    const diverged = overlap > 0 && (
      text.slice(0, overlap) !== rendered.slice(0, overlap)
      || text.slice(rendered.length - overlap, rendered.length) !== rendered.slice(rendered.length - overlap, rendered.length)
    );
    if (text.length < rendered.length || diverged) {
      // 整段被改写：正在淡入的片段已经对不上号，丢掉它们重画。
      clearInkRuns(pendingRef.current);
      textNode.data = text;
    } else if (text.length > rendered.length) {
      const suffix = text.slice(rendered.length);
      if (streamMotionEnabled()) {
        const now = performance.now();
        const runs = streamInkRuns(suffix, 0, { now, chunks: [{ from: 0, to: suffix.length, at: now }] });
        if (runs !== null) for (const run of runs) appendInkRun(textNode, run, pendingRef.current, now);
      } else {
        textNode.appendData(suffix);
      }
    }
    renderedRef.current = text;
  }, [text]);
  return setBodyRef;
}

const STREAMING_TEXT_FRAME_MS = 30;
/** A multi-line burst paints whole lines per frame, so it can run faster. */
const STREAMING_TEXT_MULTILINE_FRAME_MS = 16;
const STREAMING_TEXT_MAX_TRAIL = 48;
/** Lines left to the smooth per-character reveal inside a multi-line burst. */
const STREAMING_TEXT_TAIL_LINES = 2;

function newlineCount(text: string) {
  let count = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) count += 1;
  return count;
}

/** Offset just past the `lines`-th line break at or after `from`, or -1 when fewer remain. */
function lineEndOffset(text: string, from: number, lines: number) {
  if (lines <= 0) return -1;
  let offset = from;
  for (let index = 0; index < lines; index += 1) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) return -1;
    offset = newline + 1;
  }
  return offset;
}

export function nextStreamingTextFrame(visibleText: string, targetText: string) {
  if (visibleText === targetText || !targetText.startsWith(visibleText)) return targetText;
  // A pending line break means the burst spans lines: paint whole lines and
  // leave only a short tail to the smooth reveal, so a fast multi-line stream
  // grows a line at a time instead of re-flowing a half-typed paragraph.
  const pendingLines = newlineCount(targetText.slice(visibleText.length));
  if (pendingLines > STREAMING_TEXT_TAIL_LINES) {
    const lineEnd = lineEndOffset(targetText, visibleText.length, pendingLines - STREAMING_TEXT_TAIL_LINES);
    if (lineEnd > visibleText.length) return targetText.slice(0, lineEnd);
  }
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

/** Pending characters that already span lines are revealed whole-line, faster. */
export function streamingTextFrameDelay(visibleText: string, targetText: string) {
  return newlineCount(targetText.slice(visibleText.length)) > STREAMING_TEXT_TAIL_LINES
    ? STREAMING_TEXT_MULTILINE_FRAME_MS
    : STREAMING_TEXT_FRAME_MS;
}

function useSmoothStreamingText(text: string) {
  const [visibleText, setVisibleText] = useState(text);
  const targetTextRef = useRef(text);
  targetTextRef.current = text;
  const visibleTextRef = useRef(visibleText);
  visibleTextRef.current = visibleText;
  const chunksRef = useRef<StreamInkChunk[]>([]);
  const canAnimate = streamMotionEnabled();
  const isPrefix = text.startsWith(visibleText);
  const needsFrame = canAnimate && isPrefix && visibleText !== text;
  const visible = canAnimate && isPrefix ? visibleText : text;

  useEffect(() => {
    if (!canAnimate || !isPrefix) {
      // 正文被改写时旧区间不再对应任何文字，直接丢掉。
      chunksRef.current = [];
      setVisibleText(targetTextRef.current);
      return;
    }
    if (!needsFrame) return;
    const timer = window.setTimeout(() => {
      const current = visibleTextRef.current;
      const next = nextStreamingTextFrame(current, targetTextRef.current);
      if (next.length > current.length) {
        const at = performance.now();
        const chunks = chunksRef.current;
        chunks.push({ from: current.length, to: next.length, at });
        // 淡完的段落留在语法树里只会白白撑大每帧的解析开销。
        while (chunks.length > 0 && at - chunks[0].at > STREAM_INK_MAX_AGE) chunks.shift();
      }
      setVisibleText(next);
    }, streamingTextFrameDelay(visibleText, text));
    return () => window.clearTimeout(timer);
    // Target-only updates intentionally keep the pending frame; the ref lets it
    // consume the latest burst instead of restarting the delay for every token.
  }, [canAnimate, isPrefix, needsFrame, visibleText]);

  // 这一帧新写下的那段文字带着自己的时刻进语法树，由 CSS 按年龄渐显。
  const ink: StreamInk | null = canAnimate && chunksRef.current.length > 0
    ? { now: performance.now(), chunks: chunksRef.current }
    : null;

  return { visible, ink };
}

// Pace bursty token batches into short, adaptive frames while continuing to
// parse the visible prefix as Markdown. Large backlogs fast-forward so the UI
// stays close to the model instead of replaying a long typewriter animation.
export const StreamingAssistantText = memo(function StreamingAssistantText({ text, locale, onOpenPath, onCheckPath, onOpenUrl }: { text: string; locale: UiLocale } & MarkdownEntityActions) {
  const { visible, ink } = useSmoothStreamingText(text);
  return <MarkdownContent text={visible} className="message-text streaming-assistant-text" streamInk={ink} locale={locale} onOpenPath={onOpenPath} onCheckPath={onCheckPath} onOpenUrl={onOpenUrl} />;
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

// The reasoning body stays mounted and is appended incrementally, so it survives
// folding and can animate. A live step unfolds itself into a taller body that
// follows the newest line, then folds back to the one-line chip as soon as the
// step stops thinking, unless the reader unfolded it themselves.
export const ReasoningEntry = memo(function ReasoningEntry({ text, streaming, locale }: { text: string; streaming: boolean; locale: UiLocale }) {
  const [open, setOpen] = useState(streaming);
  const bodyRef = useIncrementalText(text);
  const followRef = useRef<HTMLPreElement | null>(null);
  const streamingRef = useRef(streaming);
  const attachBodyRef = useCallback((pre: HTMLPreElement | null) => {
    followRef.current = pre;
    bodyRef(pre);
  }, [bodyRef]);
  const summary = useMemo(
    () => reasoningSummary(text, streaming) || t("conversation.reasoning.fallback", locale),
    [text, streaming, locale],
  );

  // Thinking is a phase, not a per-token state: the unfold happens once when
  // thinking starts and the fold once when it stops.
  useEffect(() => {
    if (streamingRef.current === streaming) return;
    streamingRef.current = streaming;
    setOpen(streaming);
  }, [streaming]);

  useEffect(() => {
    if (!streaming) return;
    const body = followRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [streaming, text]);

  return (
    <div className="reasoning-entry" data-state={streaming ? "running" : "ok"} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="reasoning-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="reasoning-marker">{streaming ? t("conversation.reasoning.running", locale) : "Think"}</span>
        <em>{summary}</em>
      </button>
      {/* 折叠动画的 grid 行只能被没有内边距的项压到 0 高，正文连内边距一起放在
          裁剪层内部，折叠/展开时才不会漏出十几像素的正文。 */}
      <div className="reasoning-collapse">
        <div className="reasoning-clip">
          <div className="reasoning-body"><pre aria-live="off" ref={attachBodyRef} /></div>
        </div>
      </div>
    </div>
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

/**
 * 用户消息携带的持久化文件附件。
 *
 * DSH 只给模型一条指向只读副本的路径句柄，用户侧同样不提供内容预览：
 * 只显示文件名与大小，避免暗示这些字节已经进入上下文。
 */
const MessageFiles = memo(function MessageFiles({ files, locale }: { files: TranscriptFile[]; locale: UiLocale }) {
  return <div className="message-files" role="group" aria-label={t("conversation.files.aria", locale)}>
    {files.map((file, index) => <span className="message-file" key={`${file.attachmentId}-${index}`} title={file.attachmentId}>
      <FileText aria-hidden="true" />
      <span className="message-file-name">{file.name}</span>
      {file.bytes > 0 && <span className="message-file-size">{formatAttachmentBytes(file.bytes)}</span>}
    </span>)}
  </div>;
});

/** Attachment gallery: current image with lazy load, prev/next, keyboard, zoom and pan. */
export function MessageLightbox({
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
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const alt = current?.name || t("conversation.image.alt", locale, { index: index + 1 });
  // 长图/宽图在画廊里必须能缩放和拖拽：手势与停靠标签预览共用同一套实现。
  const {
    stageRef,
    view,
    display,
    pannable,
    panning,
    zoomPercent,
    zoomStep,
    resetView,
    stageHandlers,
  } = useImagePanZoom(natural, `${index}#${attempt}`);

  useEffect(() => {
    let active = true;
    setNatural(null);
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
      <div className="message-lightbox-zoom" role="group" aria-label={t("dockImage.zoomGroup", locale)}>
        <button
          type="button"
          disabled={view.zoom <= IMAGE_ZOOM_MIN}
          onClick={() => zoomStep(1 / IMAGE_ZOOM_BUTTON_FACTOR, null)}
          aria-label={t("dockImage.zoomOut", locale)}
          title={t("dockImage.zoomOut", locale)}
        ><ZoomOut aria-hidden="true" /></button>
        <button
          type="button"
          className="message-lightbox-zoom-value"
          onClick={resetView}
          aria-label={t("dockImage.zoomResetTo", locale, { percent: zoomPercent })}
          title={t("dockImage.zoomResetTo", locale, { percent: zoomPercent })}
        >{zoomPercent}%</button>
        <button
          type="button"
          disabled={view.zoom >= IMAGE_ZOOM_MAX}
          onClick={() => zoomStep(IMAGE_ZOOM_BUTTON_FACTOR, null)}
          aria-label={t("dockImage.zoomIn", locale)}
          title={t("dockImage.zoomIn", locale)}
        ><ZoomIn aria-hidden="true" /></button>
      </div>
      <button type="button" onClick={onClose} aria-label={t("conversation.image.closeGallery", locale)} title={t("conversation.image.closeEsc", locale)}><X aria-hidden="true" /></button>
    </div>
    <div
      className={`message-lightbox-stage${pannable ? " is-pannable" : ""}${panning ? " is-panning" : ""}`}
      ref={stageRef}
      {...stageHandlers}
      // 图片本身已经用于拖拽，不能再兼任关闭；点舞台空白处仍然关得掉。
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {state === "loading" && <span className="message-image-placeholder" role="status">{t("conversation.image.loading", locale)}…</span>}
      {state === "error" && <button className="message-image-placeholder error" type="button" onClick={() => setAttempt((value) => value + 1)} title={t("conversation.image.reload", locale)}>{t("conversation.image.loadError", locale)}</button>}
      {state === "ready" && src !== null && <img
        className={`message-lightbox-image${display ? " is-sized" : ""}`}
        src={src}
        alt={alt}
        draggable={false}
        style={display ? {
          width: `${display.width}px`,
          height: `${display.height}px`,
          transform: `translate(${view.pan.x}px, ${view.pan.y}px)`,
        } : undefined}
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />}
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

/** One-line breakdown of a turn's intermediate steps (思考 1 · 工具 3). */
function stepKindSummary(group: TranscriptTurnGroup, locale: UiLocale) {
  const counts = stepKindCounts(group.steps);
  return [
    counts.reasoning > 0 ? t("conversation.steps.kind.reasoning", locale, { count: counts.reasoning }) : "",
    counts.tool > 0 ? t("conversation.steps.kind.tool", locale, { count: counts.tool }) : "",
    counts.system > 0 ? t("conversation.steps.kind.system", locale, { count: counts.system }) : "",
    counts.workflow > 0 ? t("conversation.steps.kind.workflow", locale, { count: counts.workflow }) : "",
  ].filter(Boolean).join(" · ");
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
  // 注入行与工作流行默认收起；工作流运行中展开，结束后自动收起一次（原 `<details open>` 的意图）。
  const [injectedOpen, setInjectedOpen] = useState(false);
  const workflowRunning = item.workflow?.status === "running";
  const [workflowOpen, setWorkflowOpen] = useState(workflowRunning);
  const workflowRef = useRef(workflowRunning);
  useEffect(() => {
    if (workflowRef.current === workflowRunning) return;
    workflowRef.current = workflowRunning;
    setWorkflowOpen(workflowRunning);
  }, [workflowRunning]);
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
        {item.images && item.images.length > 0 && item.kind !== "tool" && <MessageImages images={item.images} locale={locale} onLoadAttachment={onLoadImageAttachment} onOpen={onPreviewImage} />}
        {item.fileAttachments && item.fileAttachments.length > 0 && item.kind !== "tool" && <MessageFiles files={item.fileAttachments} locale={locale} />}
        {item.kind === "tool" ? (
          <ToolEntryView
            item={item}
            diff={diff}
            hasToolResult={hasToolResult}
            toolStatus={toolStatus}
            locale={locale}
            onOpenUrl={onOpenUrl}
            onOpenPath={onOpenPath}
            onPreviewImage={onPreviewImage}
            onLoadImageAttachment={onLoadImageAttachment}
          />
        ) : item.kind === "reasoning" ? (
          <ReasoningEntry text={item.text} streaming={Boolean(item.streaming)} locale={locale} />
        ) : item.kind === "workflow" ? (
          <DisclosureEntry
            base="workflow-entry"
            className={`workflow-status-${item.workflow?.status ?? "running"}`}
            data-workflow-status={item.workflow?.status ?? "running"}
            open={workflowOpen}
            onToggle={() => setWorkflowOpen((value) => !value)}
            summary={<><span className={`workflow-status ${item.workflow?.status ?? "running"}`} />{item.workflow?.name || item.text}<em>{item.workflow ? t(workflowStatusKey(item.workflow.status), locale) : "Workflow"}</em></>}
          >
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
          </DisclosureEntry>
        ) : item.injected ? (
          <DisclosureEntry
            base="injected-entry"
            open={injectedOpen}
            onToggle={() => setInjectedOpen((value) => !value)}
            summary={<>
              <span className="injected-state" aria-hidden="true" />
              <strong>{item.label}</strong>
              {item.source && <><span className="injected-separator" aria-hidden="true" /><span className="injected-source">{item.source}</span></>}
              {item.contextSummary && <><span className="injected-separator" aria-hidden="true" /><span className="injected-summary">{item.contextSummary}</span></>}
            </>}
          >
            <div className="injected-body" data-context-form={item.contextForm ?? undefined}>
              <pre className="message-text">{item.text}</pre>
            </div>
          </DisclosureEntry>
        ) : streamingAssistant ? (
          <StreamingAssistantText text={item.text} locale={locale} onOpenPath={onOpenPath} onCheckPath={onCheckPath} onOpenUrl={onOpenUrl} />
        ) : item.kind === "user" ? (
          // 用户自己发送的内容原样呈现，不当 Markdown 解析。
          <div className="message-text plain-text">{item.text}</div>
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
  loopLive = activeRunning,
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

  // 轮次分组：提示 → 中间步骤 → 答复。步骤区默认跟随整轮状态（Agent loop 还在
  // 跑就展开、整轮结束后收起），`stepOverrides` 只记住读者手动切换过的那几轮。
  // 一轮里有几十个 step，任何一次模型返回结束都不算「整轮结束」。
  const turnGroups = useMemo(
    () => groupTranscriptTurns(transcript.filter((item) => item.kind !== "deliverables"), loopLive),
    [loopLive, transcript],
  );
  const [stepOverrides, setStepOverrides] = useState<Record<string, boolean>>({});

  // 分组键来自事件 seq，跨会话会重名，切会话时必须丢弃上一会话的展开状态。
  useEffect(() => {
    setStepOverrides({});
  }, [activeSessionId]);

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

  const renderTranscriptItem = (item: TranscriptItem) => (
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
  );

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
          {turnGroups.map((group) => {
            const stepsOpen = stepOverrides[group.key] ?? group.live;
            const stepSummary = group.steps.length > 0 ? stepKindSummary(group, locale) : "";
            const stepCount = t("conversation.steps.count", locale, { count: group.steps.length });
            return (
              <section className="turn-group" data-turn-state={group.live ? "live" : "settled"} key={group.key}>
                {group.head.map(renderTranscriptItem)}
                {group.steps.length > 0 && (
                  <div className="turn-steps" data-open={stepsOpen ? "true" : "false"}>
                    <button
                      type="button"
                      className="turn-steps-summary"
                      aria-expanded={stepsOpen}
                      aria-label={`${t("conversation.steps.label", locale)} ${stepCount}`}
                      onClick={() => setStepOverrides((current) => applyStepToggle(current, group.key, !stepsOpen, group.live))}
                    >
                      <span className="turn-steps-state" aria-hidden="true" />
                      <span className="turn-steps-count">{stepCount}</span>
                      {stepSummary && <span className="turn-steps-breakdown">{stepSummary}</span>}
                    </button>
                    <div className="turn-steps-collapse">
                      <div className="turn-steps-clip">
                        <div className="turn-steps-body">{group.steps.map(renderTranscriptItem)}</div>
                      </div>
                    </div>
                  </div>
                )}
                {group.tail.map(renderTranscriptItem)}
              </section>
            );
          })}
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
