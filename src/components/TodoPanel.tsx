import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckSquare, ChevronDown, ListTodo, LoaderCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { errorText, formatDurationMs, jobDuration, todoDuration, type TodoItem } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { shouldFollowTaskOutput, taskOutputView, type TaskOutputView } from "../app/task-output-model";
import { writeClipboard, type DshJob, type DshJobOutput } from "../lib/desktop";
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
  embedded?: boolean;
};

type TaskPanelProps = {
  jobs: DshJob[];
  collapsed: boolean;
  now: number;
  locale?: UiLocale;
  /** Host 是否提供非消费式任务输出（`tasks` 能力）；缺失时任务行不可展开。 */
  outputEnabled?: boolean;
  /**
   * 读取一个任务的输出投影。调用方（App）负责带上当前会话，桥接侧以
   * `ctx.jobs.peek` 投影，不会取走模型 `job_output` 仍在读的输出。
   */
  onLoadOutput?: (jobId: string) => Promise<DshJobOutput>;
  onToggle: () => void;
  embedded?: boolean;
};

type TaskContextMenu = {
  x: number;
  y: number;
  job: DshJob;
};

/** 展开行的输出读取状态：读取中、已就绪（含空/不可用形态）或失败。 */
type TaskOutputState =
  | { status: "loading"; jobId: string }
  | { status: "ready"; jobId: string; view: TaskOutputView }
  | { status: "error"; jobId: string; message: string };

export function TaskPanel({ jobs, collapsed, now, locale = "zh", outputEnabled = false, onLoadOutput, onToggle, embedded = false }: TaskPanelProps) {
  const liveCount = jobs.filter((job) => job.status === "running" || job.status === "stopping").length;
  const [contextMenu, setContextMenu] = useState<TaskContextMenu | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [output, setOutput] = useState<TaskOutputState | null>(null);
  const [outputCopyState, setOutputCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const outputRequestRef = useRef(0);
  const { menuRef, menuAt } = useFloatingMenuPosition(contextMenu);
  const orderedJobs = [...jobs].sort((left, right) => {
    const leftLive = left.status === "running" || left.status === "stopping";
    const rightLive = right.status === "running" || right.status === "stopping";
    return Number(rightLive) - Number(leftLive) || (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt);
  });
  const expandedJob = expandedId === null ? undefined : jobs.find((job) => job.id === expandedId);
  // 已结束的任务输出不再增长，展开时读一次即可；仍在运行的任务跟随运行态心跳
  // 刷新（peek 不消费模型游标，轮询是安全的）。
  const followTick = shouldFollowTaskOutput(expandedJob) ? now : 0;
  const expandedMissing = expandedId !== null && expandedJob === undefined;

  const loadOutput = useCallback(async (jobId: string) => {
    if (!onLoadOutput) return;
    const requestId = ++outputRequestRef.current;
    // 跟随刷新时保留上一帧输出，避免每秒闪回“读取中”；换到别的任务才重置。
    setOutput((current) => current !== null && current.jobId === jobId && current.status === "ready"
      ? current
      : { status: "loading", jobId });
    try {
      const value = await onLoadOutput(jobId);
      if (requestId !== outputRequestRef.current) return;
      setOutput({ status: "ready", jobId, view: taskOutputView(value) });
    } catch (error) {
      if (requestId !== outputRequestRef.current) return;
      setOutput({ status: "error", jobId, message: errorText(error, locale) });
    }
  }, [locale, onLoadOutput]);

  useEffect(() => {
    if (collapsed) setContextMenu(null);
  }, [collapsed]);

  useEffect(() => {
    if (collapsed) setExpandedId(null);
  }, [collapsed]);

  useEffect(() => {
    if (expandedId === null) {
      setOutput(null);
      return;
    }
    // 切换会话或任务结束时展开行已不在当前列表里，收起而不是继续读取。
    if (expandedMissing) {
      setExpandedId(null);
      setOutput(null);
      return;
    }
    void loadOutput(expandedId);
  }, [expandedId, expandedMissing, followTick, loadOutput]);

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

  const toggleOutput = (jobId: string) => {
    setOutputCopyState("idle");
    setExpandedId((current) => (current === jobId ? null : jobId));
  };

  const handleCopyOutput = (text: string) => {
    void writeClipboard(text)
      .then(() => setOutputCopyState("copied"))
      .catch((error) => {
        setOutputCopyState("failed");
        console.error(`复制任务输出失败：${errorText(error)}`);
      });
  };

  const outputCopyLabel = outputCopyState === "copied"
    ? t("todo.copied", locale)
    : outputCopyState === "failed" ? t("todo.copyFailed", locale) : t("todo.copyOutput", locale);

  const menu = contextMenu;

  return (
    <DockFrame
      id="tasks-dock"
      className="task-panel"
      collapsed={collapsed}
      label={t("todo.label", locale)}
      title={t("todo.title", locale)}
      kicker={t("common.currentSession", locale)}
      icon={<ListTodo />}
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
      embedded={embedded}
    >
      <div className="task-panel-summary"><span className="live">{t("todo.inProgressCount", locale, { count: liveCount })}</span><span>{t("todo.tasksCount", locale, { count: jobs.length })}</span>{copyState === "copied" && <span className="task-copy-status">{t("todo.copied", locale)}</span>}{copyState === "failed" && <span className="task-copy-status failed">{t("todo.copyFailed", locale)}</span>}</div>
      <ol className="task-list">{orderedJobs.map((job) => {
        const expanded = expandedId === job.id;
        const outputId = `task-output-${job.id}`;
        // 复制按钮的回调在闭包里执行，判别式收窄不会跨闭包保留，先取出文本。
        const copyableOutput = output !== null && output.jobId === job.id && output.status === "ready" && output.view.kind === "text"
          ? output.view.text
          : undefined;
        const row = <>
          <span className="task-item-status" aria-label={taskStatusLabel(job.status, locale)} />
          <span className="task-item-copy"><strong>{job.label || job.kind}</strong><small>{taskStatusLabel(job.status, locale)} · {jobDuration(job, now)}</small>{job.detail && <span className="task-item-detail">{job.detail}</span>}</span>
          {outputEnabled && <ChevronDown className={expanded ? "task-item-chevron open" : "task-item-chevron"} aria-hidden="true" />}
        </>;
        return <li
          className={`task-item ${job.status}`}
          key={job.id}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenu({ x: event.clientX, y: event.clientY, job });
          }}
        >
          {outputEnabled
            ? <button
              type="button"
              className="task-item-main"
              aria-expanded={expanded}
              aria-controls={expanded ? outputId : undefined}
              title={t("todo.outputLabel", locale)}
              onClick={() => toggleOutput(job.id)}
            >{row}</button>
            : <div className="task-item-main">{row}</div>}
          {outputEnabled && expanded && <div className="task-output" id={outputId}>
            <div className="task-output-header">
              <span className="task-output-label">{t("todo.outputLabel", locale)}</span>
              {copyableOutput !== undefined && <button type="button" className="task-output-copy" onClick={() => handleCopyOutput(copyableOutput)}>{outputCopyLabel}</button>}
            </div>
            {output === null || output.jobId !== job.id || output.status === "loading"
              ? <p className="task-output-note">{t("todo.outputLoading", locale)}</p>
              : output.status === "error"
                ? <p className="task-output-note failed">{t("todo.outputFailed", locale)}：{output.message}</p>
                : output.view.kind === "text"
                  ? <pre className="task-output-text">{output.view.text}</pre>
                  : <p className="task-output-note">{t(output.view.kind === "unsupported" ? "todo.outputUnsupported" : "todo.outputEmpty", locale)}</p>}
          </div>}
        </li>;
      })}</ol>
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

export function TodoPanel({ todos, collapsed, counts, now, turnStartedAt, turnFinishedAt, locale = "zh", onToggle, embedded = false }: TodoPanelProps) {
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
      icon={<CheckSquare />}
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
      embedded={embedded}
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
              <span className={`todo-item-status ${item.status}`} aria-label={todoStatusLabel(item.status, locale)}>{item.status === "completed" ? <Check aria-hidden="true" /> : item.status === "in_progress" ? <LoaderCircle aria-hidden="true" /> : null}</span>
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
