import type { DshJob, DshPreset, DshSessionSummary } from "../lib/desktop";
import { displayTitle, presetDisplayName } from "../app/model";

type ConversationHeaderProps = {
  activeSession: DshSessionSummary | null | undefined;
  presets: DshPreset[];
  runtimeDirectory: string;
  queueCount: number;
  activeJobs: DshJob[];
  jobsOpen: boolean;
  trajectoryOpen: boolean;
  onToggleJobs: () => void;
  onToggleTrajectory: () => void;
  onExport: () => void | Promise<void>;
  onExportZip: () => void | Promise<void>;
  onFork: () => void | Promise<void>;
};

export function ConversationHeader({
  activeSession,
  presets,
  runtimeDirectory,
  queueCount,
  activeJobs,
  jobsOpen,
  trajectoryOpen,
  onToggleJobs,
  onToggleTrajectory,
  onExport,
  onExportZip,
  onFork,
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="conversation-heading">
        <span className="conversation-title" title={activeSession ? displayTitle(activeSession) : "输入消息后创建会话"}>
          {activeSession ? displayTitle(activeSession) : "新会话"}
        </span>
        <span className="conversation-subtitle">{presetDisplayName(activeSession?.agentPreset, presets)} · {activeSession?.cwd || runtimeDirectory || "等待运行目录"}</span>
      </div>
      <div className="conversation-actions">
        {queueCount > 0 && <span className="queue-count">排队 {queueCount}</span>}
        {activeJobs.length > 0 && <button className={`header-action jobs-button${jobsOpen ? " selected" : ""}`} onClick={onToggleJobs} aria-expanded={jobsOpen} aria-controls="task-panel-content" title={jobsOpen ? "收起右侧任务" : "展开右侧任务"}>任务 <span>{activeJobs.filter((job) => job.status === "running" || job.status === "stopping").length || activeJobs.length}</span></button>}
        {activeSession && <button className={`header-action trajectory-toggle${trajectoryOpen ? " selected" : ""}`} onClick={onToggleTrajectory} title="查看当前会话轨迹" aria-pressed={trajectoryOpen}>轨迹</button>}
        {activeSession && <button className="header-action" onClick={() => void onExport()} title="导出当前会话 JSON">导出</button>}
        {activeSession && <button className="header-action" onClick={() => void onExportZip()} title="导出当前会话 ZIP">ZIP</button>}
        {activeSession && <button className="header-action" onClick={() => void onFork()} title="从当前会话分叉">分叉</button>}
      </div>
    </header>
  );
}
