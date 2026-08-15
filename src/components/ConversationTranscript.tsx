import type { RefObject, UIEvent } from "react";
import type { DshHistoryEntry, DshMessageAnnotationItem, DshMessageFeedbackItem, DshPreset, DshSessionSummary } from "../lib/desktop";
import { MarkdownContent } from "../lib/markdown";
import { TrajectoryView } from "./TrajectoryView";
import {
  formatClock,
  formatTokens,
  imageSource,
  pathBasename,
  presetDescription,
  presetDisplayName,
  workflowStatusLabel,
  type DiffSummary,
  type TranscriptItem,
} from "../app/model";
import type { MessageStats } from "../app/model";

type ConversationTranscriptProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  history: DshHistoryEntry[];
  transcript: TranscriptItem[];
  activeSession: DshSessionSummary | null;
  activeSessionId: string | null;
  activeRunning: boolean;
  loading: boolean;
  historyHasMore: boolean;
  historyLoadingOlder: boolean;
  transcriptFollowing: boolean;
  trajectoryOpen: boolean;
  workspace: string;
  runtimeDirectory: string;
  modelName: string;
  presets: DshPreset[];
  feedback: Record<string, DshMessageFeedbackItem>;
  annotations: Record<string, DshMessageAnnotationItem>;
  nextPreset: string | null;
  presetMenuOpen: boolean;
  onLoadOlder: () => void | Promise<void>;
  onFollowingChange: (following: boolean) => void;
  onJumpToLatest: () => void;
  onTogglePresetMenu: () => void;
  onStagePreset: (id: string) => void;
  onCopyMessage: (text: string) => void | Promise<void>;
  onFeedback: (messageId: string, rating: "positive" | "negative") => void | Promise<void>;
  onEditFeedback: (messageId: string) => void | Promise<void>;
  onEditAnnotation: (messageId: string) => void | Promise<void>;
  onForkSession: (sessionId: string, seq?: number) => void | Promise<void>;
  onOpenSessionPath: (path: string) => void | Promise<void>;
};

function diffTextLines(text: string) {
  if (!text) return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n") : [];
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

function fileTypeLabel(path: string) {
  const name = pathBasename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "FILE";
  return name.slice(dot + 1).toUpperCase().slice(0, 6);
}

function fileDirectory(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0) return "工作目录";
  const directory = normalized.slice(0, separator);
  return directory || "工作目录";
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
    stats.runMs === undefined ? null : <span key="run">运行 {formatDuration(stats.runMs)}</span>,
    stats.ttftMs === undefined ? null : <span key="ttft">首 T {formatDuration(stats.ttftMs)}</span>,
    stats.tokensPerSecond === undefined ? null : <span key="speed">{formatTokensPerSecond(stats.tokensPerSecond)} tok/s</span>,
  ].filter((value) => value !== null);
  return values.length > 0 ? <div className="message-stats" aria-label="消息统计">{values}</div> : null;
}

export function ConversationTranscript({
  scrollRef,
  endRef,
  history,
  transcript,
  activeSession,
  activeSessionId,
  activeRunning,
  loading,
  historyHasMore,
  historyLoadingOlder,
  transcriptFollowing,
  trajectoryOpen,
  workspace,
  runtimeDirectory,
  modelName,
  presets,
  feedback,
  annotations,
  nextPreset,
  presetMenuOpen,
  onLoadOlder,
  onFollowingChange,
  onJumpToLatest,
  onTogglePresetMenu,
  onStagePreset,
  onCopyMessage,
  onFeedback,
  onEditFeedback,
  onEditAnnotation,
  onForkSession,
  onOpenSessionPath,
}: ConversationTranscriptProps) {
  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    onFollowingChange(target.scrollHeight - target.scrollTop - target.clientHeight < 64);
  }

  const selectablePresets = presets.filter((preset) => !preset.broken);
  const selectedPresetId = nextPreset || selectablePresets.find((preset) => preset.isDefault)?.id || selectablePresets[0]?.id || "";

  return (
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
          <div className="empty-mark">DSH</div>
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
          {transcript.map((item) => {
            const diff = activeDiff(item);
            const hasToolResult = item.toolResultText !== undefined || item.toolResultDiff !== undefined || item.toolState === "result";
            const toolStatus = item.toolResultError ? "error" : hasToolResult ? "returned" : "running";
            const streamingAssistant = item.kind === "assistant" && item.key.startsWith("stream-");
            const annotation = item.messageId ? annotations[item.messageId]?.note : undefined;
            return (
            <article className={`message-row ${item.kind}${item.injected ? " context-row" : ""}${item.kind === "tool" ? " tool-row" : ""}${annotation ? " has-annotation" : ""}`} key={item.key}>
              {item.kind !== "tool" && <div className="message-gutter"><span>{item.label}</span><time>{formatClock(item.time)}</time>{annotation && <aside className="message-annotation" title="消息注记"><i aria-hidden="true" />{annotation}</aside>}</div>}
              <div className="message-content">
                {item.images && item.images.length > 0 && <div className="message-images">
                  {item.images.map((image, index) => <a className="message-image-link" href={imageSource(image)} target="_blank" rel="noreferrer" key={`${item.key}-image-${index}`} title={image.name || "打开图片"}><img src={imageSource(image)} alt={image.name || `消息图片 ${index + 1}`} loading="lazy" /></a>)}
                </div>}
                {item.kind === "tool" ? (
                  <details className={`tool-entry ${hasToolResult ? "tool-paired" : ""} ${item.toolResultError ? "tool-error" : ""}`} open={item.toolResultError || undefined}>
                    <summary>
                      <span className="tool-summary-main"><span className="tool-state" aria-hidden="true" /><span className="tool-name">{item.toolName}</span></span>
                      <span className={`tool-status ${toolStatus}`}><span className="tool-status-dot" aria-hidden="true" />{item.toolResultError ? "异常" : hasToolResult ? "已返回" : "执行中"}</span>
                      {diff && <span className="tool-diff-badge" key={`${item.key}-diff-${diff.added}-${diff.removed}`} aria-label={`新增 ${diff.added} 行，删除 ${diff.removed} 行`}><b>+{diff.added}</b><b>-{diff.removed}</b></span>}
                      <span className="tool-toggle" aria-hidden="true" />
                    </summary>
                    <div className="tool-parts">
                      <section className="tool-part tool-call-part"><div className="tool-part-label"><span>调用参数</span><time>{formatClock(item.time)}</time></div><pre>{formatToolCall(item.text)}</pre>{item.toolDiff && <DiffResult diff={item.toolDiff} />}</section>
                      {hasToolResult && <section className={`tool-part tool-result-part ${item.toolResultError ? "tool-result-error" : ""}`}><div className="tool-part-label"><span>执行结果</span><time>{formatClock(item.toolResultTime)}</time></div>{item.toolResultDiff && <DiffResult key={`${item.key}-diff-${item.toolResultTime ?? "result"}`} diff={item.toolResultDiff} />}{item.toolResultText !== undefined && <pre>{item.toolResultText}</pre>}</section>}
                    </div>
                  </details>
                ) : item.kind === "reasoning" ? (
                  <details className="reasoning-entry">
                    <summary><span className="reasoning-marker" />Think <em>{item.text.split("\n").filter(Boolean).at(-1) || "思考过程"}</em></summary>
                    <div className="reasoning-body"><pre>{item.text}</pre></div>
                  </details>
                ) : item.kind === "workflow" ? (
                  <details className="workflow-entry" open={item.workflow?.status === "running"}>
                    <summary><span className={`workflow-status ${item.workflow?.status ?? "running"}`} />{item.workflow?.name || item.text}<em>{item.workflow ? workflowStatusLabel(item.workflow.status) : "Workflow"}</em></summary>
                    <div className="workflow-body">{item.workflow?.phases.length ? item.workflow.phases.map((phase, phaseIndex) => <div className="workflow-phase" key={`${item.key}-phase-${phaseIndex}`}><strong>{phase.phase || "未命名阶段"}</strong><div>{phase.members.map((member) => <span className={`workflow-member ${member.status}`} key={`${member.childId}-${member.label}`}><i />{member.label}</span>)}</div></div>) : <span className="workflow-empty">暂无成员状态</span>}</div>
                  </details>
                ) : item.kind === "deliverables" ? (
                  <div className="deliverables-entry">
                    <div className="deliverables-heading"><div className="deliverables-title"><span className="deliverables-mark" aria-hidden="true" /><div><strong>生成文件</strong><small>本回合写入工作区</small></div></div><span className="deliverables-count">{item.files?.length ?? 0} 个文件</span></div>
                    <div className="deliverables-files">{(item.files ?? []).map((path) => <button className="deliverable-file" type="button" key={`${item.key}-${path}`} onClick={() => void onOpenSessionPath(path)} title={path} aria-label={`打开 ${path}`}><span className="deliverable-file-type" aria-hidden="true">{fileTypeLabel(path)}</span><span className="deliverable-file-copy"><strong>{pathBasename(path)}</strong><small>{fileDirectory(path)}</small></span><span className="deliverable-file-open" aria-hidden="true" /></button>)}</div>
                    {activeSession?.cwd && <div className="deliverables-actions"><button type="button" className="deliverables-folder" onClick={() => void onOpenSessionPath(".")}><span className="folder-icon" aria-hidden="true" />在文件夹中显示</button></div>}
                  </div>
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
                ) : <MarkdownContent text={item.text} reveal={streamingAssistant} />}
                {item.kind === "assistant" && <MessageStatsLine stats={item.stats} />}
                {(item.kind === "user" || item.kind === "assistant") && (
                  <div className="message-actions">
                    <button type="button" onClick={() => void onCopyMessage(item.text)} title="复制消息">复制</button>
                    {item.messageId && <button type="button" onClick={() => void onEditAnnotation(item.messageId!)} title={annotation ? "编辑消息注记" : "添加消息注记"}>{annotation ? "改注记" : "加注记"}</button>}
                    {item.kind === "assistant" && item.messageId && <>
                      <button className={feedback[item.messageId]?.rating === "positive" ? "selected" : ""} type="button" onClick={() => void onFeedback(item.messageId!, "positive")} title="标记为有帮助">赞</button>
                      <button className={feedback[item.messageId]?.rating === "negative" ? "selected" : ""} type="button" onClick={() => void onFeedback(item.messageId!, "negative")} title="标记为需要改进">踩</button>
                      <button type="button" onClick={() => void onEditFeedback(item.messageId!)} title="编辑反馈备注">{feedback[item.messageId]?.note ? "备注" : "加备注"}</button>
                    </>}
                    {item.kind === "assistant" && item.seq !== undefined && activeSessionId && (
                      <button type="button" onClick={() => void onForkSession(activeSessionId, item.seq)} title="从此消息分叉">分叉</button>
                    )}
                  </div>
                )}
              </div>
            </article>
            );
          })}
          {(loading || activeRunning) && <div className="agent-working"><span className="pulse" /><span className="working-label">DSH 正在工作</span></div>}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
