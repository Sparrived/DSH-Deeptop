import type { RefObject } from "react";
import { displayTitle, formatDate, projectName } from "../app/model";
import type { DshSessionSummary } from "../lib/desktop";

interface SessionRowProps {
  session: DshSessionSummary;
  active: boolean;
  indicator: "idle" | "running" | "completed" | "error" | "";
  pending: boolean;
  snippet?: string;
  canDrag: boolean;
  dragOver: boolean;
  draggedSessionRef: RefObject<string | null>;
  onOpen: (session: DshSessionSummary) => void | Promise<unknown>;
  onMoveBefore: (sessionId: string, beforeSessionId: string) => void | Promise<unknown>;
  onDragOverChange: (sessionId: string | null) => void;
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
  onContextMenu,
}: SessionRowProps) {
  return <div
    className={"session-row" + (active ? " active" : "") + (dragOver ? " drag-over" : "")}
    key={session.sessionId}
    draggable={canDrag}
    onDragStart={(event) => {
      if (!canDrag) return;
      draggedSessionRef.current = session.sessionId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", session.sessionId);
    }}
    onDragOver={(event) => {
      const draggedId = draggedSessionRef.current ?? event.dataTransfer.getData("text/plain");
      if (!canDrag || !draggedId || draggedId === session.sessionId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      onDragOverChange(session.sessionId);
    }}
    onDragLeave={() => onDragOverChange(null)}
    onDrop={(event) => {
      event.preventDefault();
      const draggedId = draggedSessionRef.current ?? event.dataTransfer.getData("text/plain");
      draggedSessionRef.current = null;
      onDragOverChange(null);
      if (draggedId) void onMoveBefore(draggedId, session.sessionId);
    }}
    onDragEnd={() => {
      draggedSessionRef.current = null;
      onDragOverChange(null);
    }}
    onContextMenu={(event) => {
      event.preventDefault();
      onContextMenu(session, event.clientX, event.clientY);
    }}
  >
    <button className="session-row-main" onClick={() => void onOpen(session)}>
      <span className={"session-indicator " + (pending ? "pending" : (indicator || (session.running ? "running" : "")))} />
      <span className="session-row-copy"><strong>{displayTitle(session)}</strong><small className={snippet ? "session-search-snippet" : undefined}>{snippet || (formatDate(session.updatedAt) + (session.cwd ? " · " + projectName(session.cwd) : ""))}</small></span>
    </button>
    <button className="session-row-trigger" onClick={(event) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenu(session, rect.right - 160, rect.bottom + 4);
    }} aria-label="会话操作" title="会话操作">▸</button>
  </div>;
}
