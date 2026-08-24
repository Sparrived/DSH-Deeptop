import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { errorText, formatDurationMs, jobDuration, todoDuration, type TodoItem } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { writeClipboard, type DshJob } from "../lib/desktop";
import { TASK_CONTEXT_MENU_SELECTOR } from "../app/context-menu";
import { DockFrame } from "./DockFrame";

function taskStatusLabel(status: DshJob["status"], locale: UiLocale) {
  if (status === "running") return t("todo.running", locale);
  if (status === "stopping") return t("todo.stopping", locale);
  if (status === "completed") return t("todo.completed", locale);
  if (status === "killed") return t("todo.killed", locale);
  return t("todo.failed", locale);
}

function todoStatusLabel(status: TodoItem["status"], locale: UiLocale) {
  if (status === "completed") return t("todo.completed", locale);
  if (status === "in_progress") return t("todo.inProgress", locale);
  return t("todo.pending", locale);
}

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
  locale?: UiLocale;
  onToggle: () => void;
};

type TaskPanelProps = {
  jobs: DshJob[];
  collapsed: boolean;
  now: number;
  locale?: UiLocale;
  onToggle: () => void;
};

type TaskContextMenu = {
  x: number;
  y: number;
  job: DshJob;
};

export function TaskPanel({ jobs, collapsed, now, locale = "zh", onToggle }: TaskPanelProps) {
  const liveCount = jobs.filter((job) => job.status === "running" || job.status === "stopping").length;
  const [contextMenu, setContextMenu] = useState<TaskContextMenu | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const { menuRef, menuAt } = useFloatingMenuPosition(contextMenu);
  const orderedJobs = [...jobs].sort((left, right) => {
    const leftLive = left.status === "running" || left.status === "stopping";
    const rightLive = right.status === "running" || right.status === "stopping";
    return Number(rightLive) - Number(leftLive) || (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt);
  });

  useEffect(() => {
    if (collapsed) setContextMenu(null);
  }, [collapsed]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(TASK_CONTEXT_MENU_SELECTOR)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleCopyCommand = () => {
    if (!contextMenu) return;
    const job = contextMenu.job;
    setContextMenu(null);
    void writeClipboard(job.label || job.kind)
      .then(() => setCopyState("copied"))
      .catch((error) => {
        setCopyState("failed");
        console.error(`复制任务指令失败：${errorText(error)}`);
      });
  };
  const menu = contextMenu;

  return (
    <DockFrame
      id="tasks-dock"
      className="task-panel"
      collapsed={collapsed}
      label={t("todo.label", locale)}
      title={t("todo.title", locale)}
      kicker={t("common.currentSession", locale)}
      icon="▦"
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
      <div className="task-panel-summary"><span className="live">{t("todo.inProgressCount", locale, { count: liveCount })}</span><span>{t("todo.tasksCount", locale, { count: jobs.length })}</span>{copyState === "copied" && <span className="task-copy-status">{t("todo.copied", locale)}</span>}{copyState === "failed" && <span className="task-copy-status failed">{t("todo.copyFailed", locale)}</span>}</div>
      <ol className="task-list">{orderedJobs.map((job) => <li
        className={`task-item ${job.status}`}
        key={job.id}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ x: event.clientX, y: event.clientY, job });
        }}
      ><span className="task-item-status" aria-label={taskStatusLabel(job.status, locale)} /><div className="task-item-copy"><strong>{job.label || job.kind}</strong><small>{taskStatusLabel(job.status, locale)} · {jobDuration(job, now)}</small>{job.detail && <p>{job.detail}</p>}</div></li>)}</ol>
      {menu && createPortal(
        <div
          className={TASK_CONTEXT_MENU_SELECTOR.slice(1)}
          ref={menuRef}
          style={{ left: menuAt?.left ?? menu.x, top: menuAt?.top ?? menu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={handleCopyCommand}>{t("todo.copyCommand", locale)}</button>
        </div>,
        document.body,
      )}
    </DockFrame>
  );
}

export function TodoPanel({ todos, collapsed, counts, now, turnStartedAt, turnFinishedAt, locale = "zh", onToggle }: TodoPanelProps) {
  const turnDuration = turnStartedAt === undefined
    ? undefined
    : formatDurationMs(Math.max(0, (turnFinishedAt ?? now) - turnStartedAt));
  return (
    <DockFrame
      id="todo-dock"
      className="todo-panel"
      collapsed={collapsed}
      label={t("todo.listLabel", locale)}
      title={t("todo.listTitle", locale)}
      kicker={t("common.currentSession", locale)}
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
        <div className="todo-progress-track" aria-label={t("todo.progressAria", locale, { completed: counts.completed, total: todos.length })}>
          <i style={{ width: `${todos.length ? (counts.completed / todos.length) * 100 : 0}%` }} />
        </div>
        <div className="todo-panel-counts">
          <span className="completed">{t("todo.completedCount", locale, { count: counts.completed })}</span>
          <span className="in-progress">{t("todo.inProgressCount", locale, { count: counts.inProgress })}</span>
          <span className="pending">{t("todo.pendingCount", locale, { count: counts.pending })}</span>
          {turnDuration !== undefined && <span className="turn-duration" title={t("todo.turnDurationTitle", locale)}>{t("todo.turnDuration", locale, { duration: turnDuration })}</span>}
        </div>
      </div>
      <ol className="todo-list">
        {todos.map((item, index) => {
          const duration = todoDuration(item, now, turnFinishedAt);
          return (
            <li className={`todo-item ${item.status}`} key={item.id ?? `${index}-${item.content}`}>
              <span className="todo-item-index">{String(index + 1).padStart(2, "0")}</span>
              <span className={`todo-item-status ${item.status}`} aria-label={todoStatusLabel(item.status, locale)}>{item.status === "completed" ? "✓" : item.status === "in_progress" ? "·" : ""}</span>
              <span className="todo-item-content">{item.content}</span>
              <span className={`todo-item-meta ${item.status}`}>
                <span className="todo-item-label">{todoStatusLabel(item.status, locale)}</span>
                {duration !== undefined && <span className="todo-item-duration" title={`${t(item.status === "completed" ? "todo.taskDuration" : "todo.elapsed", locale)} ${duration}`}>{duration}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </DockFrame>
  );
}
