import type { RefObject } from "react";
import { SessionRow } from "./SessionRow";
import { WorkspaceGroup as WorkspaceGroupSection } from "./WorkspaceGroup";
import { WorkspacePicker } from "./WorkspacePicker";
import {
  runtimeLabel,
  type SessionAction,
  type SessionContextMenu,
  type WorkspaceViewMode,
} from "../app/model";
import type { DshSessionSummary, DshStatus, DshWorkspace } from "../lib/desktop";

type WorkspaceGroup = {
  workspace: DshWorkspace;
  sessions: DshSessionSummary[];
};

type SessionGroups = {
  groups: WorkspaceGroup[];
  ungrouped: DshSessionSummary[];
};

type SessionSidebarProps = {
  status: DshStatus;
  search: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onNewSession: () => void;
  onAddWorkspace: () => void | Promise<void>;
  visibleSessions: DshSessionSummary[];
  workspaceViewMode: WorkspaceViewMode;
  onWorkspaceViewModeChange: (mode: WorkspaceViewMode) => void;
  workspaceGroups: SessionGroups;
  collapsedWorkspaces: Record<string, boolean>;
  onToggleWorkspace: (workspaceId: string) => void;
  onMoveWorkspace: (workspace: DshWorkspace, direction: "up" | "down") => void | Promise<void>;
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
  searchResultById: Map<string, string>;
  workspaceBySessionId: Map<string, DshWorkspace>;
  dragOverSessionId: string | null;
  draggedSessionRef: RefObject<string | null>;
  onOpenSession: (session: DshSessionSummary) => void | Promise<unknown>;
  onMoveSessionBefore: (sessionId: string, beforeSessionId: string) => void | Promise<unknown>;
  onDragOverSessionChange: (sessionId: string | null) => void;
  onSessionContextMenu: (session: DshSessionSummary, x: number, y: number) => void;
};

export function SessionSidebar({
  status,
  search,
  onSearchChange,
  onSearch,
  onClearSearch,
  onNewSession,
  onAddWorkspace,
  visibleSessions,
  workspaceViewMode,
  onWorkspaceViewModeChange,
  workspaceGroups,
  collapsedWorkspaces,
  onToggleWorkspace,
  onMoveWorkspace,
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
  searchResultById,
  workspaceBySessionId,
  dragOverSessionId,
  draggedSessionRef,
  onOpenSession,
  onMoveSessionBefore,
  onDragOverSessionChange,
  onSessionContextMenu,
}: SessionSidebarProps) {
  const renderSessionRow = (session: DshSessionSummary) => <SessionRow
    session={session}
    active={session.sessionId === activeSessionId}
    indicator={sessionIndicators[session.sessionId] ?? "idle"}
    snippet={searchResultById.get(session.sessionId)}
    canDrag={Boolean(workspaceBySessionId.get(session.sessionId))}
    dragOver={dragOverSessionId === session.sessionId}
    draggedSessionRef={draggedSessionRef}
    onOpen={onOpenSession}
    onMoveBefore={onMoveSessionBefore}
    onDragOverChange={onDragOverSessionChange}
    onContextMenu={onSessionContextMenu}
  />;
  return (
    <aside className="session-sidebar">
      <div className="sidebar-actions">
        <button className="new-session-button" onClick={onNewSession}>
          <span aria-hidden="true">+</span> 新会话
        </button>
        <button className="small-icon-button" onClick={() => void onAddWorkspace()} title="添加工作目录" aria-label="添加工作目录">⌂</button>
      </div>
      <div className="search-box">
        <span aria-hidden="true">/</span>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void onSearch(); }}
          placeholder="搜索会话"
          aria-label="搜索会话"
        />
        {search && <button onClick={onClearSearch} title="清除搜索">×</button>}
      </div>

      <div className="sidebar-heading">
        <span>会话</span>
        <div className="sidebar-heading-actions">
          <button className={workspaceViewMode === "grouped" ? "selected" : ""} type="button" onClick={() => onWorkspaceViewModeChange("grouped")} title="按工作区分组">组</button>
          <button className={workspaceViewMode === "flat" ? "selected" : ""} type="button" onClick={() => onWorkspaceViewModeChange("flat")} title="平铺会话">平</button>
          <span>{visibleSessions.length || ""}</span>
        </div>
      </div>
      <div className="session-list" aria-label="会话列表">
        {visibleSessions.length === 0 ? (
          <div className="sidebar-empty">没有已开始的会话</div>
        ) : workspaceViewMode === "flat" ? visibleSessions.map(renderSessionRow) : (
          <>
            {workspaceGroups.groups.map(({ workspace: item, sessions: groupSessions }) => (
              <WorkspaceGroupSection
                key={item.workspaceId}
                workspace={item}
                workspaceId={item.workspaceId}
                sessions={groupSessions}
                collapsed={Boolean(collapsedWorkspaces[item.workspaceId])}
                onToggle={onToggleWorkspace}
                onMoveWorkspace={onMoveWorkspace}
                onRenameWorkspace={onRenameWorkspace}
                onDeleteWorkspace={onDeleteWorkspace}
                renderSession={renderSessionRow}
              />
            ))}
            {workspaceGroups.ungrouped.length > 0 && (
              <WorkspaceGroupSection
                workspace={null}
                workspaceId="__ungrouped__"
                sessions={workspaceGroups.ungrouped}
                collapsed={Boolean(collapsedWorkspaces.__ungrouped__)}
                onToggle={onToggleWorkspace}
                onMoveWorkspace={onMoveWorkspace}
                onRenameWorkspace={onRenameWorkspace}
                onDeleteWorkspace={onDeleteWorkspace}
                renderSession={renderSessionRow}
              />
            )}
          </>
        )}
      </div>

      {sessionContextMenu && <div className="session-context-menu" style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
        <button role="menuitem" onClick={() => onRequestSessionAction("rename", sessionContextMenu.session)}>重命名</button>
        <button role="menuitem" onClick={() => onRequestSessionAction("fork", sessionContextMenu.session)}>分叉会话</button>
        <button className="danger" role="menuitem" onClick={() => onRequestSessionAction("archive", sessionContextMenu.session)}>归档会话</button>
      </div>}

      <div className="sidebar-bottom">
        <WorkspacePicker
          workspace={workspace}
          workspaces={workspaces}
          open={workspaceMenuOpen}
          onToggle={onToggleWorkspaceMenu}
          onChoose={onChooseWorkspace}
          onAdd={onAddWorkspace}
        />
        <div className="sidebar-footnote"><span className={status.runtimeAvailable ? "online" : ""} />DSH {runtimeLabel(status)}</div>
      </div>
    </aside>
  );
}
