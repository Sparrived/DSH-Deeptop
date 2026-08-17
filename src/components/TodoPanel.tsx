import { formatDurationMs, jobDuration, jobStatusLabel, todoDuration, todoStatusLabel, type TodoItem } from "../app/model";
import type { DshJob } from "../lib/desktop";
import { DockFrame } from "./DockFrame";

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
    <DockFrame
      id="tasks-dock"
      className="task-panel"
      collapsed={collapsed}
      label="当前会话任务"
      title="任务"
      kicker="当前会话"
      icon="▦"
      total={liveCount || jobs.length}
      onToggle={onToggle}
      railClassName="task-panel-rail"
      markClassName="task-panel-mark"
      cardClassName="task-panel-card"
      headerClassName="task-panel-header"
      headingClassName="task-panel-heading"
      kickerClassName="task-panel-kicker"
      headerActionsClassName="task-panel-header-actions"
      totalClassName="task-panel-total"
      toggleClassName="task-panel-toggle"
      bodyClassName="task-panel-body"
    >
      <div className="task-panel-summary"><span className="live">{liveCount} 进行中</span><span>{jobs.length} 项任务</span></div>
      <ol className="task-list">{orderedJobs.map((job) => <li className={`task-item ${job.status}`} key={job.id}><span className="task-item-status" aria-label={jobStatusLabel(job.status)} /><div className="task-item-copy"><strong>{job.label || job.kind}</strong><small>{jobStatusLabel(job.status)} · {jobDuration(job, now)}</small>{job.detail && <p>{job.detail}</p>}</div></li>)}</ol>
    </DockFrame>
  );
}

export function TodoPanel({ todos, collapsed, counts, now, turnStartedAt, turnFinishedAt, onToggle }: TodoPanelProps) {
  const turnDuration = turnStartedAt === undefined
    ? undefined
    : formatDurationMs(Math.max(0, (turnFinishedAt ?? now) - turnStartedAt));
  return (
    <DockFrame
      id="todo-dock"
      className="todo-panel"
      collapsed={collapsed}
      label="当前会话任务清单"
      title="任务清单"
      kicker="当前会话"
      icon="✓"
      total={`${counts.completed}/${todos.length}`}
      onToggle={onToggle}
      railClassName="todo-panel-rail"
      markClassName="todo-panel-mark"
      cardClassName="todo-panel-card"
      headerClassName="todo-panel-header"
      headingClassName="todo-panel-heading"
      kickerClassName="todo-panel-kicker"
      headerActionsClassName="todo-panel-header-actions"
      totalClassName="todo-panel-total"
      toggleClassName="todo-panel-toggle"
      bodyClassName="todo-panel-body"
    >
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
    </DockFrame>
  );
}
