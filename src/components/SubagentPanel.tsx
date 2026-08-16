import { MarkdownContent } from "../lib/markdown";
import {
  formatClock,
  shortSubagentId,
  subagentActivityLabel,
  subagentDisplayName,
  subagentModeLabel,
  type ChildSubagentEntry,
  type SubagentSession,
  type TranscriptItem,
} from "../app/model";
import type { DshSubagentAddress } from "../lib/desktop";

type SubagentPanelProps = {
  entries: ChildSubagentEntry[];
  /** Whether the left-hand bookmark dock is expanded (default collapsed). */
  dockOpen: boolean;
  /** Whether the subagent execution drawer is open. */
  panelOpen: boolean;
  selectedId: string | null;
  selectedIndex: number;
  selectedEntry?: ChildSubagentEntry;
  loadingId: string | null;
  loadError: string | null;
  session: SubagentSession | null;
  transcript: TranscriptItem[];
  composer: string;
  onToggleDock: () => void;
  onToggle: (entry: ChildSubagentEntry, index: number) => void;
  onClose: () => void;
  onComposerChange: (value: string) => void;
  onPrompt: () => void | Promise<void>;
  onInterrupt: (address: DshSubagentAddress) => void | Promise<void>;
};

export function SubagentPanel({
  entries,
  dockOpen,
  panelOpen,
  selectedId,
  selectedIndex,
  selectedEntry,
  loadingId,
  loadError,
  session,
  transcript,
  composer,
  onToggleDock,
  onToggle,
  onClose,
  onComposerChange,
  onPrompt,
  onInterrupt,
}: SubagentPanelProps) {
  if (entries.length === 0) return null;
  const runningCount = entries.filter((entry) => entry.activity === "running").length;

  return (
    <div className={`subagent-layer ${panelOpen ? "open" : ""}`}>
      {panelOpen && <button className="subagent-panel-backdrop" type="button" onClick={onClose} aria-label="关闭 Subagent 执行面板" />}

      {/* Left-hand dock: a collapsed rail by default, expanding into a bookmark card like Todo/Task. */}
      <aside className={`subagent-dock ${dockOpen ? "expanded" : "collapsed"}`} aria-label="子 Agent 书签">
        <button
          className="subagent-dock-rail"
          type="button"
          onClick={onToggleDock}
          aria-controls="subagent-dock-content"
          aria-expanded={dockOpen}
          aria-label={dockOpen ? "收起子 Agent" : "展开子 Agent"}
          title={dockOpen ? "收起子 Agent" : "展开子 Agent"}
        >
          <span className="subagent-dock-mark" aria-hidden="true">◈</span>
          <span className="subagent-dock-count">{entries.length}</span>
        </button>

        {dockOpen && (
          <div id="subagent-dock-content" className="subagent-dock-card">
            <header className="subagent-dock-header">
              <div className="subagent-dock-heading">
                <span className="subagent-dock-mark" aria-hidden="true">◈</span>
                <div>
                  <span className="subagent-dock-kicker">当前会话</span>
                  <h2>子 Agent</h2>
                </div>
              </div>
              <div className="subagent-dock-header-actions">
                <span className="subagent-dock-total">{runningCount}/{entries.length}</span>
                <button className="subagent-dock-toggle" type="button" onClick={onToggleDock} aria-controls="subagent-dock-content" aria-expanded={true} aria-label="收起子 Agent" title="收起子 Agent"><span aria-hidden="true">‹</span></button>
              </div>
            </header>
            <div className="subagent-dock-body">
              <nav className="subagent-bookmark-list" aria-label="子 Agent 书签">
                {entries.map((entry, index) => {
                  const label = subagentDisplayName(entry, index);
                  const selected = selectedId === entry.id;
                  return (
                    <button
                      className={`subagent-bookmark ${selected ? "selected" : ""}`}
                      data-tone={`tone-${index % 4}`}
                      type="button"
                      key={entry.id}
                      onClick={() => onToggle(entry, index)}
                      title={`打开 ${label} 的执行情况`}
                      aria-pressed={selected}
                    >
                      <span className={`subagent-bookmark-status ${entry.activity}`} aria-hidden="true"><i /></span>
                      <span className="subagent-bookmark-copy"><strong>{label}</strong><small>{subagentActivityLabel(entry.activity)} · {subagentModeLabel(entry.mode)}</small></span>
                      <span className="subagent-bookmark-number">{String(index + 1).padStart(2, "0")}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        )}
      </aside>

      {panelOpen && (
        <aside className="subagent-drawer" aria-label="Subagent 执行情况" aria-live="polite">
          <header className="subagent-drawer-header">
            <div className="subagent-drawer-heading">
              <span className={`subagent-drawer-status ${selectedEntry?.activity ?? "inactive"}`} aria-hidden="true" />
              <div>
                <span className="subagent-drawer-kicker">执行记录 / {selectedIndex >= 0 ? String(selectedIndex + 1).padStart(2, "0") : "--"}</span>
                <h2>{selectedEntry ? subagentDisplayName(selectedEntry, selectedIndex) : "子 Agent"}</h2>
                <p>{selectedEntry ? `${subagentActivityLabel(selectedEntry.activity)} · ${subagentModeLabel(selectedEntry.mode)}` : "选择一个子 Agent"}</p>
              </div>
            </div>
            <button className="subagent-drawer-close" type="button" onClick={onClose} aria-label="关闭 Subagent 执行面板" title="关闭">×</button>
          </header>

          {selectedEntry && <div className="subagent-drawer-meta"><span><i className={selectedEntry.activity} />{subagentActivityLabel(selectedEntry.activity)}</span><span>{subagentModeLabel(selectedEntry.mode)}</span><code title={selectedEntry.id}>{shortSubagentId(selectedEntry.id)}</code></div>}

          <div className="subagent-drawer-body">
            {loadingId === selectedId ? (
              <div className="subagent-drawer-loading"><span className="subagent-loading-pulse" />正在读取执行记录</div>
            ) : loadError ? (
              <div className="subagent-drawer-empty error"><strong>读取失败</strong><p>{loadError}</p></div>
            ) : session ? (
              <div className="subagent-history">
                {transcript.map((item) => item.kind === "tool" ? (
                  <details className={`subagent-tool-entry ${item.toolResultError ? "error" : ""}`} key={item.key} open={item.toolResultText !== undefined}>
                    <summary><span className="subagent-tool-state" /><strong>{item.toolName}</strong><em>{item.toolResultError ? "异常" : item.toolResultText !== undefined ? "已返回" : "执行中"}</em></summary>
                    <div className="subagent-tool-content"><pre>{item.text}</pre>{item.toolResultText !== undefined && <div className="subagent-tool-result"><span>结果</span><pre>{item.toolResultText}</pre></div>}</div>
                  </details>
                ) : (
                  <article className={`subagent-message ${item.kind}`} key={item.key}>
                    <div className="subagent-message-meta"><strong>{item.label}</strong><time>{formatClock(item.time)}</time></div>
                    {item.injected ? <pre>{item.text}</pre> : <MarkdownContent text={item.text} reveal={item.kind === "assistant" && item.key.startsWith("stream-")} />}
                  </article>
                ))}
                {transcript.length === 0 && <div className="subagent-drawer-empty"><strong>暂无执行记录</strong><p>这个子 Agent 还没有可展示的消息。</p></div>}
              </div>
            ) : (
              <div className="subagent-drawer-empty"><strong>选择一个书签</strong><p>打开子 Agent 后，这里会显示它的消息、工具调用和返回结果。</p></div>
            )}
          </div>

          {session?.address.mode === "continuable" && <div className="subagent-compose"><input value={composer} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onPrompt(); }} placeholder="追问子 Agent" aria-label="追问子 Agent" /><button type="button" onClick={() => void onInterrupt(session.address)} title="中断子 Agent">中断</button><button type="button" onClick={() => void onPrompt()}>发送</button></div>}
        </aside>
      )}
    </div>
  );
}
