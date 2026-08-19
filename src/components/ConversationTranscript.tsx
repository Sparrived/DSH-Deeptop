import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type UIEvent } from "react";
import type { DshHistoryEntry, DshMessageAnnotationItem, DshPreset, DshSessionSummary } from "../lib/desktop";
import { MarkdownContent } from "../lib/markdown";
import { PopupDialog } from "./PopupDialog";
import { TrajectoryView } from "./TrajectoryView";
import {
  formatClock,
  formatTokens,
  imageSource,
  presetDescription,
  presetDisplayName,
  workflowStatusLabel,
  type DiffSummary,
  type TranscriptItem,
} from "../app/model";
import type { MessageStats, TranscriptImage, WorkingIndicatorSettings } from "../app/model";
import { workingIndicatorTextAt } from "../app/working-indicator";

type ConversationTranscriptProps = {
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
  annotations: Record<string, DshMessageAnnotationItem>;
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
  onEditAnnotation: (messageId: string) => void | Promise<void>;
  onRetryMessage?: (seq: number) => void | Promise<void>;
  onForkSession: (sessionId: string, seq?: number) => void | Promise<void>;
  onOpenSessionPath: (path: string) => void | Promise<void>;
  onOpenUrl: (url: string) => void | Promise<void>;
};

function diffTextLines(text: string) {
  if (!text) return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n") : [];
}

function WorkingIndicator({ settings }: { settings: WorkingIndicatorSettings }) {
  const [index, setIndex] = useState(0);
  const texts = settings.texts.map((text) => text.trim()).filter(Boolean);
  const safeSettings = texts.length > 0 ? { ...settings, texts } : { ...settings, texts: ["Deep diving..."] };

  useEffect(() => {
    setIndex(0);
  }, [settings.texts.join("\u0000")]);

  useEffect(() => {
    if (texts.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => current + 1), settings.rotationInterval);
    return () => window.clearInterval(timer);
  }, [settings.rotationInterval, texts.length]);

  return (
    <div className={`agent-working effect-${settings.effect}`} role="status" aria-live="polite" style={{ "--working-indicator-color": settings.color } as CSSProperties}>
      <span>{workingIndicatorTextAt(safeSettings, index)}</span>
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

function sameItemFields(left: TranscriptItem, right: TranscriptItem) {
  if (left === right) return true;
  return left.kind === right.kind
    && left.key === right.key
    && left.label === right.label
    && left.text === right.text
    && left.seq === right.seq
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
    && sameStats(left.stats, right.stats);
}

function DiffResult({ diff }: { diff: DiffSummary }) {
  let lineIndex = 0;
  return (
    <div className="diff-result" aria-label="文件修改 Diff">
      <div className="diff-result-header">
        <strong>Diff</strong>
        <span className="diff-result-stats"><b className="diff-added">+{diff.added}</b><b className="diff-removed">-{diff.removed}</b><span>{diff.files} 个文件</span></span>
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

function MessageStatsLine({ stats }: { stats?: MessageStats }) {
  if (!stats) return null;
  const values = [
    stats.inputTokens === undefined ? null : <span key="input">输入 {formatTokens(stats.inputTokens)} tok</span>,
    stats.outputTokens === undefined ? null : <span key="output">输出 {formatTokens(stats.outputTokens)} tok</span>,
    stats.cacheHitRate === undefined ? null : <span key="cache">缓存 {Math.round(stats.cacheHitRate)}%</span>,
    stats.runMs === undefined ? null : <span key="run">输出耗时 {formatDuration(stats.runMs)}</span>,
    stats.ttftMs === undefined ? null : <span key="ttft">首 T {formatDuration(stats.ttftMs)}</span>,
    stats.tokensPerSecond === undefined ? null : <span key="speed">{formatTokensPerSecond(stats.tokensPerSecond)} tok/s</span>,
  ].filter((value) => value !== null);
  return values.length > 0 ? <div className="message-stats" aria-label="消息统计">{values}</div> : null;
}

// The reasoning body can grow to thousands of tokens while the model "thinks".
// The body is only mounted once the user opens the entry, and when it is open
// during a live stream we append only the new slice to the <pre> (never
// rewriting the whole accumulated text), so a long reasoning block streams
// without janking the window. The entry is memoized so an unrelated transcript
// rebuild (e.g. a tool event) does not re-scan the whole text.
const ReasoningEntry = memo(function ReasoningEntry({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  const renderedLengthRef = useRef(0);
  const summary = useMemo(() => {
    const lines = text.split("\n").filter(Boolean);
    const line = streaming ? lines.at(-1) : lines[0];
    return line || "思考过程";
  }, [text, streaming]);

  useEffect(() => {
    if (!open) return;
    const pre = bodyRef.current;
    if (!pre) return;
    // Defensive: if the text ever resets to something shorter (stream replaced),
    // redraw the whole body instead of appending garbage.
    if (text.length < renderedLengthRef.current) {
      renderedLengthRef.current = 0;
      pre.textContent = "";
    }
    const delta = text.slice(renderedLengthRef.current);
    if (delta.length === 0) return;
    pre.append(delta);
    renderedLengthRef.current = text.length;
  }, [text, open]);

  return (
    <details
      className="reasoning-entry"
      data-state={streaming ? "running" : "ok"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary><span className="reasoning-marker">Think</span><em>{summary}</em></summary>
      {open && <div className="reasoning-body"><pre ref={bodyRef} /></div>}
    </details>
  );
}, (prev, next) => prev.text === next.text && prev.streaming === next.streaming);

type PreviewImage = { src: string; alt: string };

function MessageImage({
  image,
  index,
  onLoadAttachment,
  onOpen,
}: {
  image: TranscriptImage;
  index: number;
  onLoadAttachment?: (attachmentId: string) => Promise<string>;
  onOpen: (image: PreviewImage) => void;
}) {
  const [src, setSrc] = useState(() => imageSource(image));
  const [state, setState] = useState<"loading" | "ready" | "error">(() => src ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const alt = image.name || `消息图片 ${index + 1}`;

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

  if (state === "loading") return <span className="message-image-placeholder" role="status">正在读取图片</span>;
  if (state === "error" || !src) {
    return <button className="message-image-placeholder error" type="button" onClick={() => setAttempt((value) => value + 1)} title="重新读取图片">图片读取失败，点击重试</button>;
  }
  return <button
    className="message-image-link"
    type="button"
    onClick={() => onOpen({ src, alt })}
    title="点击放大图片"
    aria-label={`放大 ${alt}`}
  >
    <img src={src} alt={alt} loading="lazy" onError={() => setState("error")} />
  </button>;
}

// Memoized by image value: the transcript rebuilds create fresh image objects
// every frame, but unchanged attachments should neither re-render nor re-trigger
// the attachment-loading effect inside MessageImage.
const MessageImages = memo(function MessageImages({
  images,
  onLoadAttachment,
  onOpen,
}: {
  images: TranscriptImage[];
  onLoadAttachment?: (attachmentId: string) => Promise<string>;
  onOpen: (image: PreviewImage) => void;
}) {
  return <div className="message-images">
    {images.map((image, index) => <MessageImage
      image={image}
      index={index}
      onLoadAttachment={onLoadAttachment}
      onOpen={onOpen}
      key={`${image.attachmentId ?? image.name ?? "inline"}-${index}`}
    />)}
  </div>;
}, (prev, next) => sameImages(prev.images, next.images));

type TranscriptArticleProps = {
  item: TranscriptItem;
  note: string | undefined;
  retryingMessageSeq: number | null;
  activeRunning: boolean;
  loading: boolean;
  activeSessionId: string | null;
  onPreviewImage: (image: PreviewImage) => void;
  onLoadImageAttachment?: (attachmentId: string) => Promise<string>;
  onCopyMessage: (text: string) => void | Promise<void>;
  onEditAnnotation: (messageId: string) => void | Promise<void>;
  onRetryMessage?: (seq: number) => void | Promise<void>;
  onForkSession: (sessionId: string, seq?: number) => void | Promise<void>;
  onOpenPath: (path: string) => void | Promise<void>;
  onOpenUrl: (url: string) => void | Promise<void>;
};

function TranscriptArticleView({
  item,
  note,
  retryingMessageSeq,
  activeRunning,
  loading,
  activeSessionId,
  onPreviewImage,
  onLoadImageAttachment,
  onCopyMessage,
  onEditAnnotation,
  onRetryMessage,
  onForkSession,
  onOpenPath,
  onOpenUrl,
}: TranscriptArticleProps) {
  const diff = activeDiff(item);
  const hasToolResult = item.toolResultText !== undefined || item.toolResultDiff !== undefined || item.toolState === "result";
  const toolStatus = item.toolResultError ? "error" : hasToolResult ? "returned" : "running";
  const streamingAssistant = item.kind === "assistant" && item.key.startsWith("stream-");
  const annotation = note;
  return (
    <article className={`message-row ${item.kind}${item.injected ? " context-row" : ""}${item.kind === "tool" ? " tool-row" : ""}${annotation ? " has-annotation" : ""}`}>
      {item.kind !== "tool" && item.kind !== "reasoning" && <div className="message-gutter"><span>{item.label}</span><time>{formatClock(item.time)}</time>{annotation && <aside className="message-annotation" title="消息注记"><i aria-hidden="true" />{annotation}</aside>}</div>}
      <div className="message-content">
        {item.images && item.images.length > 0 && <MessageImages images={item.images} onLoadAttachment={onLoadImageAttachment} onOpen={onPreviewImage} />}
        {item.kind === "tool" ? (
          <details className={`tool-entry ${hasToolResult ? "tool-paired" : ""} ${item.toolResultError ? "tool-error" : ""}`} open={item.toolResultError || undefined}>
            <summary>
              <span className="tool-summary-main"><span className="tool-state" aria-hidden="true" /><span className="tool-name">{item.toolName}</span></span>
              <span className={`tool-status ${toolStatus}`}><span className="tool-status-dot" aria-hidden="true" />{item.toolResultError ? "异常" : hasToolResult ? "已返回" : "执行中"}</span>
              {diff && <span className="tool-diff-badge" key={`${item.key}-diff-${diff.added}-${diff.removed}`} aria-label={`新增 ${diff.added} 行，删除 ${diff.removed} 行`}><b>+{diff.added}</b><b>-{diff.removed}</b></span>}
              <span className="tool-toggle" aria-hidden="true" />
            </summary>
            <div className="tool-parts">
              <section className="tool-part tool-call-part"><div className="tool-part-label"><span>调用参数</span><time>{formatClock(item.time)}</time></div><pre className="tool-call-arguments">{formatToolCall(item.text)}</pre>{item.toolDiff && <DiffResult diff={item.toolDiff} />}</section>
              {hasToolResult && <section className={`tool-part tool-result-part ${item.toolResultError ? "tool-result-error" : ""}`}><div className="tool-part-label"><span>执行结果</span><time>{formatClock(item.toolResultTime)}</time></div>{item.toolResultDiff && <DiffResult key={`${item.key}-diff-${item.toolResultTime ?? "result"}`} diff={item.toolResultDiff} />}{item.toolResultText !== undefined && <pre>{item.toolResultText}</pre>}</section>}
            </div>
          </details>
        ) : item.kind === "reasoning" ? (
          <ReasoningEntry text={item.text} streaming={Boolean(item.streaming)} />
        ) : item.kind === "workflow" ? (
          <details className="workflow-entry" open={item.workflow?.status === "running"}>
            <summary><span className={`workflow-status ${item.workflow?.status ?? "running"}`} />{item.workflow?.name || item.text}<em>{item.workflow ? workflowStatusLabel(item.workflow.status) : "Workflow"}</em></summary>
            <div className="workflow-body">{item.workflow?.phases.length ? item.workflow.phases.map((phase, phaseIndex) => <div className="workflow-phase" key={`${item.key}-phase-${phaseIndex}`}><strong>{phase.phase || "未命名阶段"}</strong><div>{phase.members.map((member) => <span className={`workflow-member ${member.status}`} key={`${member.childId}-${member.label}`}><i />{member.label}</span>)}</div></div>) : <span className="workflow-empty">暂无成员状态</span>}</div>
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
        ) : <MarkdownContent text={item.text} reveal={streamingAssistant} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />}
        {item.kind === "assistant" && <MessageStatsLine stats={item.stats} />}
        {(item.kind === "user" || item.kind === "assistant") && (
          <div className="message-actions">
             {item.kind === "user" && item.seq !== undefined && onRetryMessage && (
               <button
                 type="button"
                 className="retry-message-button"
                 disabled={activeRunning || loading || retryingMessageSeq !== null}
                 onClick={() => void onRetryMessage(item.seq!)}
                 title="清除此消息之后的内容，并从这里重新请求"
               >
                 {retryingMessageSeq === item.seq ? "重试中" : "重试"}
               </button>
             )}
            <button type="button" onClick={() => void onCopyMessage(item.text)} title="复制消息">复制</button>
            {item.messageId && <button type="button" onClick={() => void onEditAnnotation(item.messageId!)} title={annotation ? "编辑消息注记" : "添加消息注记"}>{annotation ? "改注记" : "加注记"}</button>}
             {item.kind === "assistant" && item.seq !== undefined && activeSessionId && (
              <button type="button" onClick={() => void onForkSession(activeSessionId, item.seq)} title="从此消息分叉">分叉</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// Callbacks are intentionally not compared: they are either stable
// (onPreviewImage / onLoadImageAttachment) or safe to hold as stale closures
// because every value they read is either a ref or is covered by the compared
// props (note / activeRunning / loading), so the article
// re-renders (and receives a fresh handler) whenever that value changes.
const TranscriptArticle = memo(TranscriptArticleView, (prev, next) => {
  if (!sameItemFields(prev.item, next.item)) return false;
  return prev.note === next.note
    && prev.retryingMessageSeq === next.retryingMessageSeq
    && prev.activeRunning === next.activeRunning
    && prev.loading === next.loading
    && prev.activeSessionId === next.activeSessionId;
});

export function ConversationTranscript({
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
  annotations,
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
  onEditAnnotation,
  onRetryMessage,
  onForkSession,
  onOpenSessionPath,
  onOpenUrl,
}: ConversationTranscriptProps) {
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    onFollowingChange(target.scrollHeight - target.scrollTop - target.clientHeight < 64);
  }

  const selectablePresets = presets.filter((preset) => !preset.broken);
  const selectedPresetId = nextPreset || selectablePresets.find((preset) => preset.isDefault)?.id || selectablePresets[0]?.id || "";

  return (
    <>
    <div className="transcript" ref={scrollRef} aria-live={trajectoryOpen ? undefined : "polite"} onScroll={handleScroll}>
      {!trajectoryOpen && historyHasMore && (
        <button className="history-load-more" type="button" disabled={historyLoadingOlder} onClick={() => void onLoadOlder()}>
          {historyLoadingOlder ? "正在读取更早消息" : "读取更早消息"}
        </button>
      )}
      {!trajectoryOpen && !transcriptFollowing && history.length > 0 && (
        <button className="transcript-jump" type="button" onClick={onJumpToLatest} title="回到最新消息">回到最新消息</button>
      )}
      {trajectoryOpen ? (
        <TrajectoryView entries={history} active={activeRunning || loading} />
      ) : transcript.length === 0 && !loading ? (
        <div className="empty-conversation">
          <div className="empty-mark" role="img" aria-label="Deeptop">
            <span className="empty-mark-text" aria-hidden="true">Deeptop</span>
          </div>
          <h1>{activeSession ? "继续这个会话" : "开始一个会话"}</h1>
          <p>{activeSession ? "历史消息会在这里继续，输入下一条指令即可。" : "消息会在发送时创建 DSH 会话。"}</p>
          <div className="empty-meta"><span>{workspace || runtimeDirectory || "运行目录"}</span><span>{modelName}</span></div>
          {!activeSession && selectablePresets.length > 0 && (
            <div className="preset-seat">
              <button className="preset-seat-trigger" type="button" aria-haspopup="menu" aria-expanded={presetMenuOpen} onClick={onTogglePresetMenu}>
                <span className="preset-seat-kicker">Agent Preset</span>
                <strong>{presetDisplayName(selectedPresetId, presets)}</strong>
                <span className="preset-seat-chevron" aria-hidden="true">⌄</span>
              </button>
              {presetMenuOpen && <div className="preset-seat-menu" role="menu" aria-label="选择 Agent Preset">
                {selectablePresets.map((preset) => <button className={preset.id === selectedPresetId ? "selected" : ""} type="button" role="menuitem" key={preset.id} onClick={() => onStagePreset(preset.id)}>
                  <span><strong>{presetDisplayName(preset.id, presets)}</strong><small>{presetDescription(preset)}</small></span>
                  {preset.id === selectedPresetId && <b aria-hidden="true">✓</b>}
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
              note={item.messageId ? annotations[item.messageId]?.note : undefined}
              retryingMessageSeq={retryingMessageSeq}
              activeRunning={activeRunning}
              loading={loading}
              activeSessionId={activeSessionId}
              onPreviewImage={setPreviewImage}
              onLoadImageAttachment={onLoadImageAttachment}
              onCopyMessage={onCopyMessage}
              onEditAnnotation={onEditAnnotation}
              onRetryMessage={onRetryMessage}
              onForkSession={onForkSession}
               onOpenPath={onOpenSessionPath}
               onOpenUrl={onOpenUrl}
            />
          ))}
          {(loading || activeRunning) && <WorkingIndicator settings={workingIndicator} />}
           <div ref={endRef} />
        </div>
      )}
    </div>
    {previewImage && <PopupDialog
      title="图片预览"
      eyebrow="MESSAGE / IMAGE"
      description={previewImage.alt}
      className="image-preview-dialog"
      onClose={() => setPreviewImage(null)}
    >
      <img className="image-preview" src={previewImage.src} alt={previewImage.alt} />
    </PopupDialog>}
    </>
  );
}
