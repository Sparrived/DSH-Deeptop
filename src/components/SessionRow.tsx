import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
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

type PointerDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  targetSessionId: string | null;
  sourceElement: HTMLElement;
  captureElement: HTMLElement;
  ghostOffsetY: number;
  ghostTop: number;
};

type PointerLikeEvent = {
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

type DragGhost = {
  left: number;
  top: number;
  width: number;
};

interface SessionRowProps {
  session: DshSessionSummary;
  active: boolean;
  indicator: SessionIndicator | "";
  pending: boolean;
  snippet?: string;
  canDrag: boolean;
  dragDisabled: boolean;
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
  dragDisabled,
  dragOver,
  draggedSessionRef,
  onOpen,
  onMoveBefore,
  onDragOverChange,
  onSessionDragEnd,
  onContextMenu,
}: SessionRowProps) {
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const removePointerListenersRef = useRef<(() => void) | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const status = sessionStatusFor(session, indicator, pending);
  const detail = snippet || (formatDate(session.updatedAt) + (session.cwd ? " · " + projectName(session.cwd) : ""));
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);

  function sessionIdAtPoint(clientX: number, clientY: number, sourceElement: HTMLElement) {
    const group = sourceElement.closest<HTMLElement>(".workspace-group");
    if (!group) return null;
    const groupRect = group.getBoundingClientRect();
    if (clientX < groupRect.left || clientX > groupRect.right || clientY < groupRect.top || clientY > groupRect.bottom) {
      return null;
    }

    const rows = [...group.querySelectorAll<HTMLElement>(".session-row.is-draggable[data-session-id]")]
      .filter((row) => row !== sourceElement && row.dataset.sessionId !== session.sessionId);
    if (rows.length === 0) return null;

    const target = rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    }) ?? rows[rows.length - 1];
    return target.dataset.sessionId ?? null;
  }

  function updateDragGhost(drag: PointerDragState, clientY: number) {
    drag.ghostTop = clientY - drag.ghostOffsetY;
    if (dragGhostRef.current) dragGhostRef.current.style.top = `${drag.ghostTop}px`;
  }

  function updatePointerDrag(event: PointerLikeEvent) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 4) return;
      const rect = drag.sourceElement.getBoundingClientRect();
      drag.started = true;
      drag.ghostOffsetY = event.clientY - rect.top;
      drag.ghostTop = rect.top;
      draggedSessionRef.current = session.sessionId;
      setDragGhost({ left: rect.left, top: rect.top, width: rect.width });
      setDragging(true);
    }
    event.preventDefault();
    updateDragGhost(drag, event.clientY);

    const targetSessionId = sessionIdAtPoint(event.clientX, event.clientY, drag.sourceElement);
    if (!targetSessionId || drag.targetSessionId === targetSessionId) return;
    drag.targetSessionId = targetSessionId;
    onDragOverChange(targetSessionId);
  }

  function finishPointerDrag(commit: boolean) {
    const drag = pointerDragRef.current;
    if (!drag) return;
    const finalTargetSessionId = drag.targetSessionId;
    try {
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // The webview can revoke capture while the pointer leaves the window.
    }
    pointerDragRef.current = null;
    removePointerListenersRef.current?.();
    removePointerListenersRef.current = null;
    draggedSessionRef.current = null;
    setPressed(false);
    setDragging(false);
    setDragGhost(null);

    if (drag.started && commit && finalTargetSessionId) {
      // Keep the list preview until the workspace mutation and authoritative
      // refresh finish; only the pointer-following ghost disappears now.
      void Promise.resolve()
        .then(() => onMoveBefore(session.sessionId, finalTargetSessionId))
        .finally(() => onSessionDragEnd());
      return;
    }
    onSessionDragEnd();
  }

  function startPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canDrag || dragDisabled || event.button !== 0 || pointerDragRef.current) return;
    const sourceElement = event.currentTarget.closest<HTMLElement>(".session-row");
    if (!sourceElement) return;
    event.preventDefault();
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      targetSessionId: null,
      sourceElement,
      captureElement: event.currentTarget,
      ghostOffsetY: 0,
      ghostTop: sourceElement.getBoundingClientRect().top,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window listeners below continue the gesture if capture is unavailable.
    }
    const handlePointerMove = (nativeEvent: globalThis.PointerEvent) => updatePointerDrag(nativeEvent);
    const handlePointerUp = (nativeEvent: globalThis.PointerEvent) => {
      if (nativeEvent.pointerId === pointerDragRef.current?.pointerId) finishPointerDrag(true);
    };
    const handlePointerCancel = (nativeEvent: globalThis.PointerEvent) => {
      if (nativeEvent.pointerId === pointerDragRef.current?.pointerId) finishPointerDrag(false);
    };
    const handleWindowBlur = () => finishPointerDrag(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") handleWindowBlur();
    };
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    removePointerListenersRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    setPressed(true);
  }

  useEffect(() => () => {
    const drag = pointerDragRef.current;
    removePointerListenersRef.current?.();
    removePointerListenersRef.current = null;
    pointerDragRef.current = null;
    if (drag) {
      draggedSessionRef.current = null;
      onDragOverChange(null);
      onSessionDragEnd();
    }
  }, []);

  return <>
    <div
      className={`session-row session-status-${status}${active ? " active" : ""}${dragOver ? " drag-over" : ""}${canDrag ? " is-draggable" : ""}${dragDisabled ? " drag-disabled" : ""}${pressed ? " pressed" : ""}${dragging ? " dragging" : ""}`}
      data-session-id={session.sessionId}
      data-session-status={status}
      aria-label={`会话状态：${sessionStatusLabels[status]}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(session, event.clientX, event.clientY);
      }}
    >
      {canDrag && <button
        type="button"
        className="session-row-grip"
        title={dragDisabled ? "当前状态下不能调整顺序" : "拖拽调整会话顺序"}
        aria-label="拖拽调整会话顺序"
        disabled={dragDisabled}
        onPointerDown={startPointerDrag}
      >⋮⋮</button>}
      <button
        type="button"
        className="session-row-main"
        onClick={() => {
          void onOpen(session);
        }}
      >
        <span className="session-row-copy"><strong>{displayTitle(session)}</strong><small className={snippet ? "session-search-snippet" : undefined}>{detail}</small></span>
      </button>
    </div>
    {dragGhost && createPortal(
      <div
        ref={(node) => {
          dragGhostRef.current = node;
          const drag = pointerDragRef.current;
          if (node && drag) node.style.top = `${drag.ghostTop}px`;
        }}
        className={`session-row session-drag-ghost is-draggable session-status-${status}`}
        style={{ left: dragGhost.left, top: dragGhost.top, width: dragGhost.width }}
        aria-hidden="true"
      >
        <span className="session-row-grip">⋮⋮</span>
        <span className="session-row-main">
          <span className="session-row-copy"><strong>{displayTitle(session)}</strong><small className={snippet ? "session-search-snippet" : undefined}>{detail}</small></span>
        </span>
      </div>,
      document.body,
    )}
  </>;
}
