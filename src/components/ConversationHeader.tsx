import { useState } from "react";
import type { DshPreset, DshSessionSummary } from "../lib/desktop";
import { displayTitle, presetDisplayName } from "../app/model";

type ConversationHeaderProps = {
  activeSession: DshSessionSummary | null | undefined;
  presets: DshPreset[];
  runtimeDirectory: string;
  notice: string;
  noticeIsError: boolean;
  queueCount: number;
  trajectoryOpen: boolean;
  onToggleTrajectory: () => void;
};

export function ConversationHeader({
  activeSession,
  presets,
  runtimeDirectory,
  notice,
  noticeIsError,
  queueCount,
  trajectoryOpen,
  onToggleTrajectory,
}: ConversationHeaderProps) {
  const [noticeCopied, setNoticeCopied] = useState(false);

  const copyNotice = async () => {
    if (!notice) return;
    try {
      await navigator.clipboard.writeText(notice);
      setNoticeCopied(true);
      window.setTimeout(() => setNoticeCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败，不影响主流程。
    }
  };

  return (
    <header className="conversation-header">
      <div className="conversation-heading">
        <span className="conversation-title" title={activeSession ? displayTitle(activeSession) : "输入消息后创建会话"}>
          {activeSession ? displayTitle(activeSession) : "新会话"}
        </span>
        <span className="conversation-subtitle">{presetDisplayName(activeSession?.agentPreset, presets)} · {activeSession?.cwd || runtimeDirectory || "等待运行目录"}</span>
      </div>
      <div className="conversation-actions">
        {noticeIsError && notice && (
          <button
            type="button"
            className={`header-notice${noticeCopied ? " copied" : ""}`}
            onClick={() => void copyNotice()}
            title={noticeCopied ? "已复制到剪贴板" : "点击复制错误信息"}
            aria-label="点击复制错误信息"
          >
            {noticeCopied ? "已复制" : notice}
          </button>
        )}
        {queueCount > 0 && <span className="queue-count">排队 {queueCount}</span>}
        {activeSession && <button className={`header-action trajectory-toggle${trajectoryOpen ? " selected" : ""}`} onClick={onToggleTrajectory} title="查看当前会话轨迹" aria-pressed={trajectoryOpen}>轨迹</button>}
      </div>
    </header>
  );
}
