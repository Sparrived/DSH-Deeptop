import { formatDurationMs, jobDuration, jobStatusLabel, todoDuration, todoStatusLabel, type TodoItem } from "../app/model";
import type { DshJob } from "../lib/desktop";

type TodoCounts = {
  completed: number;
  inProgress: number;
  pending: number;
};

type TodoPanelProps = {
  todos: TodoItem[];
  collapsed: boolean;
  counts: TodoCounts;
  now: number;
  turnStartedAt?: number;
  turnFinishedAt?: number;
  onToggle: () => void;
};

type TaskPanelProps = {
  jobs: DshJob[];
  collapsed: boolean;
  now: number;
  onToggle: () => void;
};

export function TaskPanel({ jobs, collapsed, now, onToggle }: TaskPanelProps) {
  const liveCount = jobs.filter((job) => job.status === "running" || job.status === "stopping").length;
  const orderedJobs = [...jobs].sort((left, right) => {
    const leftLive = left.status === "running" || left.status === "stopping";
    const rightLive = right.status === "running" || right.status === "stopping";
    return Number(rightLive) - Number(leftLive) || (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt);
  });

  return (
    <aside className={`task-panel ${collapsed ? "collapsed" : "expanded"}`} aria-label="当前会话任务" aria-live="polite">
      <button
        className="task-panel-rail"
        type="button"
        onClick={onToggle}
        aria-controls="task-panel-content"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开任务" : "收起任务"}
        title={collapsed ? "展开任务" : "收起任务"}
      >
        <span className="task-panel-mark" aria-hidden="true">▦</span>
      </button>
      {!collapsed && (
        <div id="task-panel-content" className="task-panel-card">
          <header className="task-panel-header">
            <div className="task-panel-heading"><span className="task-panel-mark" aria-hidden="true">▦</span><div><span className="task-panel-kicker">当前会话</span><h2>任务</h2></div></div>
            <div className="task-panel-header-actions"><span className="task-panel-total">{liveCount || jobs.length}</span><button className="task-panel-toggle" type="button" onClick={onToggle} aria-controls="task-panel-content" aria-expanded={true} aria-label="收起任务" title="收起任务"><span aria-hidden="true">›</span></button></div>
          </header>
          <div className="task-panel-body">
            <div className="task-panel-summary"><span className="live">{liveCount} 进行中</span><span>{jobs.length} 项任务</span></div>
            <ol className="task-list">{orderedJobs.map((job) => <li className={`task-item ${job.status}`} key={job.id}><span className="task-item-status" aria-label={jobStatusLabel(job.status)} /><div className="task-item-copy"><strong>{job.label || job.kind}</strong><small>{jobStatusLabel(job.status)} · {jobDuration(job, now)}</small>{job.detail && <p>{job.detail}</p>}</div></li>)}</ol>
          </div>
        </div>
      )}
    </aside>
  );
}

export function TodoPanel({ todos, collapsed, counts, now, turnStartedAt, turnFinishedAt, onToggle }: TodoPanelProps) {
  const turnDuration = turnStartedAt === undefined
    ? undefined
    : formatDurationMs(Math.max(0, (turnFinishedAt ?? now) - turnStartedAt));
  return (
    <aside className={`todo-panel ${collapsed ? "collapsed" : "expanded"}`} aria-label="当前会话任务清单" aria-live="polite">
      <button
        className="todo-panel-rail"
        type="button"
        onClick={onToggle}
        aria-controls="todo-panel-content"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开任务清单" : "收起任务清单"}
        title={collapsed ? "展开任务清单" : "收起任务清单"}
      >
        <span className="todo-panel-mark" aria-hidden="true">✓</span>
      </button>
      {!collapsed && (
        <div id="todo-panel-content" className="todo-panel-card">
          <header className="todo-panel-header">
            <div className="todo-panel-heading">
              <span className="todo-panel-mark" aria-hidden="true">✓</span>
              <div>
                <span className="todo-panel-kicker">当前会话</span>
                <h2>任务清单</h2>
              </div>
            </div>
            <div className="todo-panel-header-actions">
              <span className="todo-panel-total">{counts.completed}/{todos.length}</span>
              <button className="todo-panel-toggle" type="button" onClick={onToggle} aria-controls="todo-panel-content" aria-expanded={true} aria-label="收起任务清单" title="收起任务清单"><span aria-hidden="true">›</span></button>
            </div>
          </header>
          <div className="todo-panel-body">
            <div className="todo-panel-summary">
              <div className="todo-progress-track" aria-label={`已完成 ${counts.completed} 项，共 ${todos.length} 项`}>
                <i style={{ width: `${todos.length ? (counts.completed / todos.length) * 100 : 0}%` }} />
              </div>
              <div className="todo-panel-counts">
                <span className="completed">{counts.completed} 已完成</span>
                <span className="in-progress">{counts.inProgress} 进行中</span>
                <span className="pending">{counts.pending} 待处理</span>
                {turnDuration !== undefined && <span className="turn-duration" title="本轮任务耗时">本轮 {turnDuration}</span>}
              </div>
            </div>
            <ol className="todo-list">
              {todos.map((item, index) => {
                const duration = todoDuration(item, now, turnFinishedAt);
                return (
                  <li className={`todo-item ${item.status}`} key={item.id ?? `${index}-${item.content}`}>
                    <span className="todo-item-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className={`todo-item-status ${item.status}`} aria-label={todoStatusLabel(item.status)}>{item.status === "completed" ? "✓" : item.status === "in_progress" ? "·" : ""}</span>
                    <span className="todo-item-content">{item.content}</span>
                    <span className={`todo-item-meta ${item.status}`}>
                      <span className="todo-item-label">{todoStatusLabel(item.status)}</span>
                      {duration !== undefined && <span className="todo-item-duration" title={`${item.status === "completed" ? "任务耗时" : "已用时"} ${duration}`}>{duration}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </aside>
  );
}
