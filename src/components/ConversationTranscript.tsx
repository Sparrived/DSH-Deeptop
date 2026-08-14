import type { RefObject, UIEvent } from "react";
import type { DshHistoryEntry, DshPreset, DshSessionSummary } from "../lib/desktop";
import { MarkdownContent } from "../lib/markdown";
import { TrajectoryView } from "./TrajectoryView";
import {
  formatClock,
  imageSource,
  pathBasename,
  presetDescription,
  presetDisplayName,
  workflowStatusLabel,
  type DiffSummary,
  type TranscriptItem,
} from "../app/model";

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
  nextPreset: string | null;
  presetMenuOpen: boolean;
  onLoadOlder: () => void | Promise<void>;
  onFollowingChange: (following: boolean) => void;
  onJumpToLatest: () => void;
  onTogglePresetMenu: () => void;
  onStagePreset: (id: string) => void;
  onCopyMessage: (text: string) => void | Promise<void>;
  onForkSession: (sessionId: string, seq?: number) => void | Promise<void>;
  onOpenSessionPath: (path: string) => void | Promise<void>;
};

function diffTextLines(text: string) {
  if (!text) return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n") : [];
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
  nextPreset,
  presetMenuOpen,
  onLoadOlder,
  onFollowingChange,
  onJumpToLatest,
  onTogglePresetMenu,
  onStagePreset,
  onCopyMessage,
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
            return (
            <article className={`message-row ${item.kind}${item.injected ? " context-row" : ""}${item.kind === "tool" ? " tool-row" : ""}`} key={item.key}>
              {item.kind !== "tool" && <div className="message-gutter"><span>{item.label}</span><time>{formatClock(item.time)}</time></div>}
              <div className="message-content">
                {item.images && item.images.length > 0 && <div className="message-images">
                  {item.images.map((image, index) => <a className="message-image-link" href={imageSource(image)} target="_blank" rel="noreferrer" key={`${item.key}-image-${index}`} title={image.name || "打开图片"}><img src={imageSource(image)} alt={image.name || `消息图片 ${index + 1}`} loading="lazy" /></a>)}
                </div>}
                {item.kind === "tool" ? (
                  <details className={`tool-entry ${item.toolResultText !== undefined ? "tool-paired" : ""} ${item.toolResultError ? "tool-error" : ""}`}>
                    <summary><span className="tool-state" />{item.toolName}{(item.toolResultText !== undefined || item.toolState === "result") && <em>{item.toolResultError ? "异常" : "已返回"}</em>}{diff && <span className="tool-diff-badge"><b>+{diff.added}</b><b>-{diff.removed}</b></span>}</summary>
                    <div className="tool-parts">
                      <div className="tool-part tool-call-part"><pre>{item.text}</pre>{item.toolDiff && <DiffResult diff={item.toolDiff} />}</div>
                      {(item.toolResultText !== undefined || item.toolResultDiff !== undefined) && <div className={`tool-part tool-result-part ${item.toolResultError ? "tool-result-error" : ""}`}><span className="tool-part-label">结果 <time>{formatClock(item.toolResultTime)}</time></span>{item.toolResultDiff && <DiffResult key={`${item.key}-diff-${item.toolResultTime ?? "result"}`} diff={item.toolResultDiff} />}{item.toolResultText !== undefined && <pre>{item.toolResultText}</pre>}</div>}
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
                    <div className="deliverables-heading"><strong>生成文件</strong><span>{item.files?.length ?? 0} 个</span></div>
                    <div className="deliverables-files">{(item.files ?? []).map((path) => <button type="button" key={`${item.key}-${path}`} onClick={() => void onOpenSessionPath(path)} title={path}>{pathBasename(path)}</button>)}</div>
                    {activeSession?.cwd && <button type="button" className="deliverables-folder" onClick={() => void onOpenSessionPath(".")}>在文件夹中显示</button>}
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
                ) : <MarkdownContent text={item.text} />}
                {(item.kind === "user" || item.kind === "assistant") && (
                  <div className="message-actions">
                    <button type="button" onClick={() => void onCopyMessage(item.text)} title="复制消息">复制</button>
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
