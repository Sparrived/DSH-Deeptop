import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { displayTitle, formatDate, projectName } from "../app/model";
import type { DshSessionSummary } from "../lib/desktop";

export type SessionIndicator = "idle" | "running" | "completed" | "error";
export type SessionStatus = SessionIndicator | "pending" | "archived";

export const sessionStatusLabels: Record<SessionStatus, string> = {
  idle: "就绪",
  running: "运行中",
  completed: "已完成",
  error: "出错",
  pending: "待处理",
  archived: "已归档",
};

export function sessionStatusFor(
  session: DshSessionSummary,
  indicator: SessionIndicator | "",
  pending: boolean,
): SessionStatus {
  if (pending) return "pending";
  if (session.running) return "running";
  if (indicator && indicator !== "idle") return indicator;
  return "idle";
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <span className="session-row-status" title={`状态：${sessionStatusLabels[status]}`}>{sessionStatusLabels[status]}</span>;
}

type PointerDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  targetSessionId: string | null;
};

interface SessionRowProps {
  session: DshSessionSummary;
  active: boolean;
  indicator: SessionIndicator | "";
  pending: boolean;
  snippet?: string;
  canDrag: boolean;
  dragOver: boolean;
  draggedSessionRef: RefObject<string | null>;
  onOpen: (session: DshSessionSummary) => void | Promise<unknown>;
  onMoveBefore: (sessionId: string, beforeSessionId: string) => void | Promise<unknown>;
  onDragOverChange: (sessionId: string | null) => void;
  onSessionDragEnd: () => void;
  onContextMenu: (session: DshSessionSummary, x: number, y: number) => void;
}

export function SessionRow({
  session,
  active,
  indicator,
  pending,
  snippet,
  canDrag,
  dragOver,
  draggedSessionRef,
  onOpen,
  onMoveBefore,
  onDragOverChange,
  onSessionDragEnd,
  onContextMenu,
}: SessionRowProps) {
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const status = sessionStatusFor(session, indicator, pending);
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);

  function sessionIdAtPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>(".session-row.is-draggable[data-session-id]");
    const sessionId = row?.dataset.sessionId;
    return sessionId && sessionId !== session.sessionId ? sessionId : null;
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLElement> | null, commit: boolean) {
    const drag = pointerDragRef.current;
    if (!drag) return;
    pointerDragRef.current = null;
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.started && commit && drag.targetSessionId) {
      void onMoveBefore(session.sessionId, drag.targetSessionId);
    }
    draggedSessionRef.current = null;
    onDragOverChange(null);
    onSessionDragEnd();
    setPressed(false);
    setDragging(false);
  }

  function startPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canDrag || event.button !== 0) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      targetSessionId: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(true);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 4) return;
      drag.started = true;
      draggedSessionRef.current = session.sessionId;
      setDragging(true);
    }
    event.preventDefault();
    const targetSessionId = sessionIdAtPoint(event.clientX, event.clientY);
    if (drag.targetSessionId === targetSessionId) return;
    drag.targetSessionId = targetSessionId;
    onDragOverChange(targetSessionId);
  }

  return <div
    className={`session-row session-status-${status}${active ? " active" : ""}${dragOver ? " drag-over" : ""}${canDrag ? " is-draggable" : ""}${pressed ? " pressed" : ""}${dragging ? " dragging" : ""}`}
    data-session-id={session.sessionId}
    data-session-status={status}
    onContextMenu={(event) => {
      event.preventDefault();
      onContextMenu(session, event.clientX, event.clientY);
    }}
  >
    {canDrag && <button
      type="button"
      className="session-row-grip"
      title="拖拽调整会话顺序"
      aria-label="拖拽调整会话顺序"
      onPointerDown={startPointerDrag}
      onPointerMove={movePointerDrag}
      onPointerUp={(event) => finishPointerDrag(event, true)}
      onPointerCancel={(event) => finishPointerDrag(event, false)}
      onLostPointerCapture={(event) => finishPointerDrag(event, false)}
    >⋮⋮</button>}
    <button
      type="button"
      className="session-row-main"
      onClick={() => {
        void onOpen(session);
      }}
    >
      <span className="session-row-copy"><strong>{displayTitle(session)}</strong><small className={snippet ? "session-search-snippet" : undefined}>{snippet || (formatDate(session.updatedAt) + (session.cwd ? " · " + projectName(session.cwd) : ""))}</small></span>
      <SessionStatusBadge status={status} />
    </button>
  </div>;
}
