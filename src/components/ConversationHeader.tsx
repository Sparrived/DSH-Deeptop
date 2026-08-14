import type { DshJob, DshPreset, DshSessionSummary } from "../lib/desktop";
import { displayTitle, jobDuration, jobStatusLabel, presetDisplayName } from "../app/model";

type ConversationHeaderProps = {
  activeSession: DshSessionSummary | null | undefined;
  presets: DshPreset[];
  runtimeDirectory: string;
  queueCount: number;
  activeJobs: DshJob[];
  jobsOpen: boolean;
  jobNow: number;
  trajectoryOpen: boolean;
  renaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void | Promise<void>;
  onStartRename: () => void;
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
  jobNow,
  trajectoryOpen,
  renaming,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onStartRename,
  onToggleJobs,
  onToggleTrajectory,
  onExport,
  onExportZip,
  onFork,
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="conversation-heading">
        {renaming ? (
          <form onSubmit={(event) => { event.preventDefault(); void onRenameSubmit(); }}>
            <input value={renameValue} onChange={(event) => onRenameValueChange(event.target.value)} autoFocus aria-label="会话名称" />
          </form>
        ) : (
          <button className="conversation-title" onDoubleClick={onStartRename} title={activeSession ? "双击重命名会话" : "输入消息后创建会话"}>
            {activeSession ? displayTitle(activeSession) : "新会话"}
          </button>
        )}
        <span className="conversation-subtitle">{presetDisplayName(activeSession?.agentPreset, presets)} · {activeSession?.cwd || runtimeDirectory || "等待运行目录"}</span>
      </div>
      <div className="conversation-actions">
        {queueCount > 0 && <span className="queue-count">排队 {queueCount}</span>}
        {activeJobs.length > 0 && <div className="jobs-control">
          <button className={`header-action jobs-button${jobsOpen ? " selected" : ""}`} onClick={onToggleJobs} aria-expanded={jobsOpen} aria-haspopup="dialog" title="查看当前会话任务">任务 <span>{activeJobs.filter((job) => job.status === "running" || job.status === "stopping").length || activeJobs.length}</span></button>
          {jobsOpen && <div className="jobs-popover" role="dialog" aria-label="当前会话任务">
            <div className="jobs-popover-heading"><strong>任务</strong><span>{activeJobs.length} 项</span></div>
            {[...activeJobs].sort((left, right) => {
              const leftLive = left.status === "running" || left.status === "stopping";
              const rightLive = right.status === "running" || right.status === "stopping";
              return Number(rightLive) - Number(leftLive) || (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt);
            }).map((job) => <div className={`job-row ${job.status}`} key={job.id}>
              <span className="job-status-dot" />
              <div><strong>{job.label || job.kind}</strong><small>{jobStatusLabel(job.status)} · {jobDuration(job, jobNow)}</small>{job.detail && <p>{job.detail}</p>}</div>
            </div>)}
          </div>}
        </div>}
        {activeSession && <button className={`header-action trajectory-toggle${trajectoryOpen ? " selected" : ""}`} onClick={onToggleTrajectory} title="查看当前会话轨迹" aria-pressed={trajectoryOpen}>轨迹</button>}
        {activeSession && <button className="header-action" onClick={() => void onExport()} title="导出当前会话 JSON">导出</button>}
        {activeSession && <button className="header-action" onClick={() => void onExportZip()} title="导出当前会话 ZIP">ZIP</button>}
        {activeSession && <button className="header-action" onClick={() => void onFork()} title="从当前会话分叉">分叉</button>}
      </div>
    </header>
  );
}
