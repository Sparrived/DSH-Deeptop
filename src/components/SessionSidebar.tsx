import { useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SessionRow, sessionStatusLabels } from "./SessionRow";
import { WorkspaceGroup as WorkspaceGroupSection } from "./WorkspaceGroup";
import { WorkspacePicker } from "./WorkspacePicker";
import {
  displayTitle,
  formatDate,
  projectName,
  type SessionAction,
  type SessionContextMenu,
} from "../app/model";
import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

type WorkspaceGroup = {
  workspace: DshWorkspace | null;
  workspaceId: string;
  sessions: DshSessionSummary[];
};

type DragPreview = {
  order: string[];
};

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((sessionId, index) => sessionId === right[index]);
}

type SessionSidebarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onNewSession: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onAddWorkspace: () => void | Promise<void>;
  visibleSessions: DshSessionSummary[];
  archivedSessions: DshSessionSummary[];
  onRestoreSession: (session: DshSessionSummary) => void | Promise<unknown>;
  onDeleteArchivedSession: (session: DshSessionSummary) => void;
  workspaceGroup: WorkspaceGroup;
  collapsedWorkspaces: Record<string, boolean>;
  onToggleWorkspace: (workspaceId: string) => void;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  sessionContextMenu: SessionContextMenu | null;
  onRequestSessionAction: (action: SessionAction, session: DshSessionSummary) => void;
  workspace: string;
  workspaces: DshWorkspace[];
  workspaceMenuOpen: boolean;
  onToggleWorkspaceMenu: () => void;
  onChooseWorkspace: (path: string) => void;
  activeSessionId: string | null;
  sessionIndicators: Record<string, "idle" | "running" | "completed" | "error">;
  pendingSessionIds: ReadonlySet<string>;
  searchResultById: Map<string, string>;
  workspaceBySessionId: Map<string, DshWorkspace>;
  dragOverSessionId: string | null;
  draggedSessionRef: RefObject<string | null>;
  onOpenSession: (session: DshSessionSummary) => void | Promise<unknown>;
  onMoveSessionBefore: (sessionId: string, beforeSessionId: string) => void | Promise<unknown>;
  onDragOverSessionChange: (sessionId: string | null) => void;
  onSessionDragEnd: () => void;
  onSessionContextMenu: (session: DshSessionSummary, x: number, y: number) => void;
};

export function SessionSidebar({
  search,
  onSearchChange,
  onSearch,
  onClearSearch,
  onNewSession,
  settingsOpen,
  onOpenSettings,
  onAddWorkspace,
  visibleSessions,
  archivedSessions,
  onRestoreSession,
  onDeleteArchivedSession,
  workspaceGroup,
  collapsedWorkspaces,
  onToggleWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  sessionContextMenu,
  onRequestSessionAction,
  workspace,
  workspaces,
  workspaceMenuOpen,
  onToggleWorkspaceMenu,
  onChooseWorkspace,
  activeSessionId,
  sessionIndicators,
  pendingSessionIds,
  searchResultById,
  workspaceBySessionId,
  dragOverSessionId,
  draggedSessionRef,
  onOpenSession,
  onMoveSessionBefore,
  onDragOverSessionChange,
  onSessionDragEnd,
  onSessionContextMenu,
}: SessionSidebarProps) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [dragCommitPending, setDragCommitPending] = useState(false);
  const baseSessionOrder = useMemo(() => visibleSessions.map((session) => session.sessionId), [visibleSessions]);
  const dragPreviewRank = useMemo(
    () => dragPreview ? new Map(dragPreview.order.map((sessionId, index) => [sessionId, index])) : null,
    [dragPreview],
  );

  function orderSessions(items: DshSessionSummary[]) {
    if (!dragPreviewRank) return items;
    return [...items].sort((left, right) => (
      (dragPreviewRank.get(left.sessionId) ?? Number.MAX_SAFE_INTEGER)
      - (dragPreviewRank.get(right.sessionId) ?? Number.MAX_SAFE_INTEGER)
    ));
  }

  function handleDragOverSessionChange(targetSessionId: string | null) {
    const sourceSessionId = draggedSessionRef.current;
    if (sourceSessionId && targetSessionId && sourceSessionId !== targetSessionId) {
      setDragPreview((currentPreview) => {
        const order = currentPreview?.order ?? baseSessionOrder;
        const sourceIndex = order.indexOf(sourceSessionId);
        if (sourceIndex < 0) return currentPreview;
        const nextOrder = [...order];
        nextOrder.splice(sourceIndex, 1);
        const targetIndex = nextOrder.indexOf(targetSessionId);
        if (targetIndex < 0) return currentPreview;
        nextOrder.splice(targetIndex, 0, sourceSessionId);
        if (sameOrder(order, nextOrder)) return currentPreview;
        return { order: nextOrder };
      });
    }
    onDragOverSessionChange(targetSessionId);
  }

  async function handleMoveSessionBefore(sessionId: string, beforeSessionId: string) {
    setDragCommitPending(true);
    await onMoveSessionBefore(sessionId, beforeSessionId);
  }

  function handleSessionDragEnd() {
    // The parent applies the committed workspace order before refreshing its
    // runtime projections. Keep the preview through that async mutation so a
    // release never renders the old order for one frame.
    setDragPreview(null);
    setDragCommitPending(false);
    onDragOverSessionChange(null);
    onSessionDragEnd();
  }

  const renderSessionRow = (session: DshSessionSummary) => <SessionRow
    key={session.sessionId}
    session={session}
    active={session.sessionId === activeSessionId}
    indicator={sessionIndicators[session.sessionId] ?? "idle"}
    pending={pendingSessionIds.has(session.sessionId)}
    snippet={searchResultById.get(session.sessionId)}
    canDrag={Boolean(workspaceBySessionId.get(session.sessionId))}
    dragDisabled={Boolean(search.trim()) || dragCommitPending}
    dragOver={dragOverSessionId === session.sessionId}
    draggedSessionRef={draggedSessionRef}
    onOpen={onOpenSession}
    onMoveBefore={handleMoveSessionBefore}
    onDragOverChange={handleDragOverSessionChange}
    onSessionDragEnd={handleSessionDragEnd}
    onContextMenu={onSessionContextMenu}
  />;
  const renderArchivedSession = (session: DshSessionSummary) => (
    <div
      className={`archived-session-row session-status-${session.running ? "running" : "archived"}`}
      key={session.sessionId}
      aria-label={`会话状态：${sessionStatusLabels[session.running ? "running" : "archived"]}`}
    >
      <button className="archived-session-main" type="button" onClick={() => void onOpenSession(session)}>
        <span className="archived-session-copy"><strong>{displayTitle(session)}</strong><small>{formatDate(session.updatedAt)}{session.cwd ? " · " + projectName(session.cwd) : ""}</small></span>
      </button>
      <div className="archived-session-actions">
        <button type="button" onClick={() => void onRestoreSession(session)}>恢复</button>
        <button className="danger" type="button" onClick={() => onDeleteArchivedSession(session)}>删除</button>
      </div>
    </div>
  );
  return (
    <aside className="session-sidebar">
      <div className="sidebar-actions">
        <button className="new-session-button" onClick={onNewSession}>
          <span aria-hidden="true">+</span> 新会话
        </button>
        <button className={`settings-button sidebar-settings-button ${settingsOpen ? "selected" : ""}`} onClick={onOpenSettings} title="打开设置" aria-label="打开设置"><span className="settings-button-glyph" aria-hidden="true">⚙</span><span className="settings-button-label">设置</span></button>
        <button className="small-icon-button" onClick={() => void onAddWorkspace()} title="添加工作目录" aria-label="添加工作目录">⌂</button>
      </div>
      {!archiveOpen && <div className="search-box">
        <span aria-hidden="true">/</span>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void onSearch(); }}
          placeholder="搜索会话"
          aria-label="搜索会话"
        />
        {search && <button onClick={onClearSearch} title="清除搜索">×</button>}
      </div>}

      <div className="sidebar-heading">
        {archiveOpen ? (
          <div className="sidebar-heading-title"><button className="sidebar-back-button" type="button" onClick={() => setArchiveOpen(false)} title="返回会话列表" aria-label="返回会话列表">←</button><span>归档</span></div>
        ) : <span>会话</span>}
        <div className="sidebar-heading-actions">
          <span>{archiveOpen ? archivedSessions.length : (visibleSessions.length > 0 ? visibleSessions.length : "")}</span>
          {!archiveOpen && <>
            <button type="button" onClick={() => setArchiveOpen(true)} title="打开归档页">归档</button>
          </>}
        </div>
      </div>
      <div className="session-list" aria-label={archiveOpen ? "归档会话列表" : "会话列表"}>
        {archiveOpen ? (
          archivedSessions.length === 0 ? <div className="sidebar-empty">没有归档会话</div> : archivedSessions.map(renderArchivedSession)
        ) : <>
          <WorkspaceGroupSection
            workspace={workspaceGroup.workspace}
            workspaceId={workspaceGroup.workspaceId}
            sessions={orderSessions(workspaceGroup.sessions)}
            collapsed={Boolean(collapsedWorkspaces[workspaceGroup.workspaceId])}
            onToggle={onToggleWorkspace}
            onRenameWorkspace={onRenameWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            renderSession={renderSessionRow}
          />
          {visibleSessions.length === 0 && <div className="sidebar-empty">当前工作区没有已开始的会话</div>}
        </>}
      </div>

      {!archiveOpen && sessionContextMenu && createPortal(
        <div className="session-context-menu" style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
          <button role="menuitem" onClick={() => onRequestSessionAction("rename", sessionContextMenu.session)}>重命名</button>
          <button role="menuitem" onClick={() => onRequestSessionAction("fork", sessionContextMenu.session)}>分叉会话</button>
          <button role="menuitem" onClick={() => onRequestSessionAction("export", sessionContextMenu.session)}>导出 JSON</button>
          <button role="menuitem" onClick={() => onRequestSessionAction("exportZip", sessionContextMenu.session)}>导出 ZIP</button>
          <button className="danger" role="menuitem" onClick={() => onRequestSessionAction("archive", sessionContextMenu.session)}>归档会话</button>
        </div>,
        document.body,
      )}

      <div className="sidebar-bottom">
        <WorkspacePicker
          workspace={workspace}
          workspaces={workspaces}
          open={workspaceMenuOpen}
          onToggle={onToggleWorkspaceMenu}
          onChoose={onChooseWorkspace}
          onAdd={onAddWorkspace}
        />
      </div>
    </aside>
  );
}
