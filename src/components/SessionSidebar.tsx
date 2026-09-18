import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, FolderPlus, Plus, Search, Settings, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { retainSessionSelection, selectAllSessions, selectedSessions, toggleSessionSelection } from "../app/session-bulk-selection";
import type { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import type { UiHostActions } from "../lib/desktop-ui-runtime/types";
import { SlotOutlet } from "./SlotOutlet";
import { SessionRow, sessionStatusLabels } from "./SessionRow";
import { SidebarToggleHandle } from "./SidebarToggleHandle";
import { WorkspaceGroup as WorkspaceGroupSection } from "./WorkspaceGroup";
import { WorkspacePicker } from "./WorkspacePicker";
import {
  displayTitle,
  formatDate,
  projectName,
  type SessionAction,
  type SessionContextMenu,
} from "../app/model";
import { toSessionUiContext } from "../app/ui-plugin-model";
import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";
import type { ActiveSessionSnapshot, ActiveSessionView, ActiveSessionWorkspaceGroup } from "../app/active-session-view";
import { freezeActiveSessionView, snapshotActiveSessionView } from "../app/active-session-view";
import type { SessionIndicator } from "../app/session-runtime-state";
import { t, type UiLocale } from "../app/i18n";

export type WorkspaceGroup = {
  workspace: DshWorkspace | null;
  workspaceId: string;
  sessions: DshSessionSummary[];
};

type SidebarView = "sessions" | "active" | "archive";

function SidebarViewButton({
  view,
  target,
  onChange,
  children,
}: {
  view: SidebarView;
  target: SidebarView;
  onChange: (next: SidebarView) => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`sidebar-view-button${view === target ? " selected" : ""}`}
      type="button"
      aria-pressed={view === target}
      onClick={() => onChange(target)}
    >{children}</button>
  );
}

type DragPreview = {
  order: string[];
};

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((sessionId, index) => sessionId === right[index]);
}

type SessionSidebarProps = {
  /** 界面语言：会话列表与菜单文案按语言渲染。 */
  locale?: UiLocale;
  /** 收起后仅保留通用动作按钮（新建会话 / 设置 / 添加目录），其余区块隐藏。 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
  activeSessionView: ActiveSessionView;
  /** 已登记的会话 id：活跃列表只在快照之后补入新建会话。 */
  knownSessionIds: ReadonlySet<string>;
  onRestoreSession: (session: DshSessionSummary) => void | Promise<unknown>;
  onArchiveSessions: (sessions: DshSessionSummary[]) => void;
  onDeleteArchivedSessions: (sessions: DshSessionSummary[]) => void;
  /** 归档会话的永久删除是否可用（存储后端必须支持销毁）。 */
  sessionDeleteAvailable: boolean;
  selectedWorkspaceGroup: WorkspaceGroup;
  pinnedWorkspaceIds: string[];
  onTogglePinWorkspace: (workspace: DshWorkspace) => void;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  unpinnedSectionOpen: boolean;
  onUnpinnedSectionChange: (open: boolean) => void;
  sessionContextMenu: SessionContextMenu | null;
  onRequestSessionAction: (action: SessionAction, session: DshSessionSummary) => void;
  uiRuntime: DesktopUiRuntime;
  uiLocale: UiLocale;
  uiHost: UiHostActions;
  workspace: string;
  workspaces: DshWorkspace[];
  workspaceMenuOpen: boolean;
  onToggleWorkspaceMenu: () => void;
  onChooseWorkspace: (path: string) => void;
  workspacePickerMenuRef: RefObject<HTMLDivElement | null>;
  activeSessionId: string | null;
  sessionIndicators: Record<string, SessionIndicator>;
  pendingSessionIds: ReadonlySet<string>;
  searchResultById: Map<string, string>;
  workspaceBySessionId: Map<string, DshWorkspace>;
  dragOverSessionId: string | null;
  draggedSessionRef: RefObject<string | null>;
  onOpenSession: (session: DshSessionSummary) => void | Promise<unknown>;
  onToggleSessionPin: (session: DshSessionSummary) => void | Promise<unknown>;
  onMoveSessionBefore: (sessionId: string, beforeSessionId: string) => void | Promise<unknown>;
  onDragOverSessionChange: (sessionId: string | null) => void;
  onSessionDragEnd: () => void;
  onSessionContextMenu: (session: DshSessionSummary, x: number, y: number) => void;
  onDismissSessionContextMenu: () => void;
};

export function SessionSidebar({
  locale = "zh",
  collapsed,
  onToggleCollapsed,
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
  activeSessionView,
  knownSessionIds,
  onRestoreSession,
  onArchiveSessions,
  onDeleteArchivedSessions,
  sessionDeleteAvailable,
  selectedWorkspaceGroup,
  pinnedWorkspaceIds,
  onTogglePinWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  unpinnedSectionOpen,
  onUnpinnedSectionChange,
  sessionContextMenu,
  onRequestSessionAction,
  uiRuntime,
  uiLocale,
  uiHost,
  workspace,
  workspaces,
  workspaceMenuOpen,
  onToggleWorkspaceMenu,
  onChooseWorkspace,
  workspacePickerMenuRef,
  activeSessionId,
  sessionIndicators,
  pendingSessionIds,
  searchResultById,
  workspaceBySessionId,
  dragOverSessionId,
  draggedSessionRef,
  onOpenSession,
  onToggleSessionPin,
  onMoveSessionBefore,
  onDragOverSessionChange,
  onSessionDragEnd,
  onSessionContextMenu,
  onDismissSessionContextMenu,
}: SessionSidebarProps) {
  const [view, setView] = useState<SidebarView>("sessions");
  const [activeSnapshot, setActiveSnapshot] = useState<ActiveSessionSnapshot | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const archiveOpen = view === "archive";
  const activeOpen = view === "active";
  // 活跃列表在切入时冻结：成员不再随运行状态变化增删，只有快照之后新建的会话会补入。
  const activeView = useMemo(
    () => activeSnapshot ? freezeActiveSessionView(activeSnapshot, activeSessionView) : activeSessionView,
    [activeSessionView, activeSnapshot],
  );
  const selectionCandidates = useMemo(() => {
    if (archiveOpen) return archivedSessions;
    if (activeOpen) return [];
    return search.trim() ? visibleSessions : selectedWorkspaceGroup.sessions;
  }, [activeOpen, archiveOpen, archivedSessions, search, selectedWorkspaceGroup.sessions, visibleSessions]);
  const selectedSessionItems = useMemo(() => selectedSessions(selectionCandidates, selectedSessionIds), [selectedSessionIds, selectionCandidates]);
  const allSessionsSelected = selectionCandidates.length > 0 && selectedSessionItems.length === selectionCandidates.length;
  useEffect(() => {
    setSelectedSessionIds((current) => retainSessionSelection(current, selectionCandidates));
    if (selectionCandidates.length === 0) setSelectionMode(false);
  }, [selectionCandidates]);
  const finishSelection = useCallback(() => {
    onDismissSessionContextMenu();
    setSelectionMode(false);
    setSelectedSessionIds(new Set());
  }, [onDismissSessionContextMenu]);
  const handleViewChange = useCallback((next: SidebarView) => {
    // 已在当前视图时不重新冻结：重复点击活跃按钮不应该刷新列表。
    if (next === view) return;
    finishSelection();
    setView(next);
    // 每次进入活跃视图都重新冻结成员；离开时清空，避免下次切入前渲染陈旧列表。
    setActiveSnapshot(next === "active" ? snapshotActiveSessionView(activeSessionView, knownSessionIds) : null);
  }, [activeSessionView, finishSelection, knownSessionIds, view]);
  const toggleSelectedSession = useCallback((session: DshSessionSummary) => {
    setSelectedSessionIds((current) => toggleSessionSelection(current, session.sessionId));
  }, []);
  const toggleAllSessions = useCallback(() => {
    setSelectedSessionIds(allSessionsSelected ? new Set() : selectAllSessions(selectionCandidates));
  }, [allSessionsSelected, selectionCandidates]);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [dragCommitPending, setDragCommitPending] = useState(false);
  const { menuRef: sessionMenuRef, menuAt: sessionMenuAt } = useFloatingMenuPosition(sessionContextMenu);
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

  function handleChooseWorkspace(path: string) {
    finishSelection();
    setView("sessions");
    setActiveSnapshot(null);
    onChooseWorkspace(path);
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

  const renderSessionRow = (session: DshSessionSummary, crossWorkspace = false) => <SessionRow
    key={session.sessionId}
    locale={locale}
    session={session}
    active={session.sessionId === activeSessionId}
    indicator={sessionIndicators[session.sessionId] ?? "idle"}
    pending={pendingSessionIds.has(session.sessionId)}
    snippet={crossWorkspace ? undefined : searchResultById.get(session.sessionId)}
    pinned={Boolean(workspaceBySessionId.get(session.sessionId)?.pinnedSessionIds?.includes(session.sessionId))}
    canPin={!selectionMode && Boolean(workspaceBySessionId.get(session.sessionId)) && (crossWorkspace || !search.trim())}
    canDrag={!selectionMode && !crossWorkspace && Boolean(workspaceBySessionId.get(session.sessionId))}
    dragDisabled={selectionMode || Boolean(search.trim()) || dragCommitPending}
    dragOver={!selectionMode && !crossWorkspace && dragOverSessionId === session.sessionId}
    selectable={selectionMode && !crossWorkspace}
    selected={selectedSessionIds.has(session.sessionId)}
    onToggleSelected={toggleSelectedSession}
    draggedSessionRef={draggedSessionRef}
    onOpen={onOpenSession}
    onTogglePin={onToggleSessionPin}
    onMoveBefore={handleMoveSessionBefore}
    onDragOverChange={handleDragOverSessionChange}
    onSessionDragEnd={handleSessionDragEnd}
    onContextMenu={onSessionContextMenu}
  />;
  const renderActiveWorkspaceGroup = (group: ActiveSessionWorkspaceGroup) => <WorkspaceGroupSection
    key={group.workspaceId}
    locale={locale}
    workspace={group.workspace}
    sessions={group.sessions}
    onRenameWorkspace={onRenameWorkspace}
    onDeleteWorkspace={onDeleteWorkspace}
    renderSession={(session) => renderSessionRow(session, true)}
  />;
  const renderActiveSection = (key: "pinned" | "working", groups: ActiveSessionWorkspaceGroup[]) => {
    if (groups.length === 0) return null;
    const count = groups.reduce((total, group) => total + group.sessions.length, 0);
    return <section className="active-session-section" aria-label={t(`sidebar.active.${key}`, locale)}>
      <div className="active-session-section-heading"><strong>{t(`sidebar.active.${key}`, locale)}</strong><span>{count}</span></div>
      {groups.map(renderActiveWorkspaceGroup)}
    </section>;
  };
  const liveActiveCount = activeOpen ? activeView.total : 0;
  const renderArchivedSession = (session: DshSessionSummary) => (
    <div
      className={`archived-session-row session-status-${session.running ? "running" : "archived"}${selectionMode && selectedSessionIds.has(session.sessionId) ? " is-selected" : ""}`}
      key={session.sessionId}
      aria-label={t("session.statusAria", locale, { status: t(sessionStatusLabels[session.running ? "running" : "archived"], locale) })}
    >
      <button className="archived-session-main" type="button" onClick={() => selectionMode ? toggleSelectedSession(session) : void onOpenSession(session)}>
        <span className="archived-session-copy"><strong>{displayTitle(session, locale)}</strong><small>{formatDate(session.updatedAt)}{session.cwd ? " · " + projectName(session.cwd, locale) : ""}</small></span>
      </button>
      <div className="archived-session-actions">
        {selectionMode ? <label className="archived-session-select"><input type="checkbox" checked={selectedSessionIds.has(session.sessionId)} onChange={() => toggleSelectedSession(session)} aria-label={t("session.selectAria", locale, { session: displayTitle(session, locale) })} /><span>{t("sidebar.select", locale)}</span></label> : <>
          <button type="button" onClick={() => void onRestoreSession(session)}>{t("session.restore", locale)}</button>
          <button className="danger" type="button" disabled={!sessionDeleteAvailable} title={sessionDeleteAvailable ? undefined : t("sidebar.deleteUnavailable", locale)} onClick={() => onDeleteArchivedSessions([session])}>{t("common.delete", locale)}</button>
        </>}
      </div>
    </div>
  );
  return (
    <aside id="session-sidebar" className={`session-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-actions">
        <button className="new-session-button" type="button" onClick={onNewSession} title={t("sidebar.newSession", locale)} aria-label={t("sidebar.newSession", locale)}>
          <span className="new-session-button-glyph" aria-hidden="true"><Plus /></span>
          <span className="new-session-button-label">{t("sidebar.newSession", locale)}</span>
        </button>
        <button className={`settings-button sidebar-settings-button ${settingsOpen ? "selected" : ""}`} onClick={onOpenSettings} title={t("sidebar.openSettings", locale)} aria-label={t("sidebar.openSettings", locale)}><span className="settings-button-glyph" aria-hidden="true"><Settings /></span><span className="settings-button-label">{t("settings.title", locale)}</span></button>
        <button className="small-icon-button" onClick={() => void onAddWorkspace()} title={t("sidebar.addWorkspace", locale)} aria-label={t("sidebar.addWorkspace", locale)}><FolderPlus aria-hidden="true" /></button>
      </div>
      {view === "sessions" && <div className="search-box">
        <span aria-hidden="true"><Search /></span>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void onSearch(); }}
          placeholder={t("sidebar.search", locale)}
          aria-label={t("sidebar.search", locale)}
        />
        {search && <button onClick={onClearSearch} title={t("sidebar.clearSearch", locale)} aria-label={t("sidebar.clearSearch", locale)}><X aria-hidden="true" /></button>}
      </div>}

      <div className="sidebar-heading">
        {archiveOpen ? (
          <div className="sidebar-heading-title"><button className="sidebar-back-button" type="button" onClick={() => handleViewChange("sessions")} title={t("sidebar.backToSessions", locale)} aria-label={t("sidebar.backToSessions", locale)}><ChevronLeft aria-hidden="true" /></button><span>{t("sidebar.archive", locale)}</span></div>
        ) : <span className="sidebar-heading-label">{t(activeOpen ? "sidebar.active" : "sidebar.sessions", locale)}{pendingSessionIds.size > 0 && <span
          className="sidebar-pending-flag"
          title={t("sidebar.pendingCount", locale, { count: pendingSessionIds.size })}
          aria-label={t("sidebar.pendingCount", locale, { count: pendingSessionIds.size })}
        >{pendingSessionIds.size}</span>}</span>}
        <div className="sidebar-heading-actions">
          <span>{archiveOpen ? archivedSessions.length : activeOpen ? liveActiveCount : (search.trim() ? visibleSessions.length : (selectedWorkspaceGroup.sessions.length > 0 ? selectedWorkspaceGroup.sessions.length : ""))}</span>
          {!activeOpen && selectionCandidates.length > 0 && <button className={`sidebar-selection-mode${selectionMode ? " selected" : ""}`} type="button" onClick={() => selectionMode ? finishSelection() : (onDismissSessionContextMenu(), setSelectionMode(true))} aria-pressed={selectionMode}>{t(selectionMode ? "sidebar.selectionDone" : "sidebar.select", locale)}</button>}
          {!archiveOpen && <>
            <SidebarViewButton
              view={view}
              target="active"
              onChange={handleViewChange}
            >{t("sidebar.active", locale)}</SidebarViewButton>
            <SidebarViewButton
              view={view}
              target="archive"
              onChange={handleViewChange}
            >{t("sidebar.archive", locale)}</SidebarViewButton>
          </>}
        </div>
      </div>
      <div className="session-list" aria-label={t(archiveOpen ? "sidebar.archiveList" : activeOpen ? "sidebar.activeList" : "sidebar.sessionList", locale)}>
        {selectionMode && <div className="sidebar-bulk-actions" role="toolbar" aria-label={t("sidebar.bulkActions", locale)}>
          <span>{t("sidebar.selectedCount", locale, { count: selectedSessionItems.length })}</span>
          <button type="button" onClick={toggleAllSessions}>{t(allSessionsSelected ? "sidebar.clearSelection" : "sidebar.selectAll", locale)}</button>
          <button className="danger" type="button" disabled={selectedSessionItems.length === 0 || (archiveOpen && !sessionDeleteAvailable)} title={archiveOpen && !sessionDeleteAvailable ? t("sidebar.deleteUnavailable", locale) : undefined} onClick={() => {
            if (archiveOpen) onDeleteArchivedSessions(selectedSessionItems);
            else onArchiveSessions(selectedSessionItems);
          }}>{t(archiveOpen ? "sidebar.deleteSelected" : "sidebar.archiveSelected", locale)}</button>
        </div>}
        {archiveOpen ? (
          archivedSessions.length === 0 ? <div className="sidebar-empty">{t("sidebar.archiveEmpty", locale)}</div> : archivedSessions.map(renderArchivedSession)
        ) : activeOpen ? (
          activeView.total === 0 ? <div className="sidebar-empty">{t("sidebar.activeEmpty", locale)}</div> : <>
            {renderActiveSection("pinned", activeView.pinned)}
            {renderActiveSection("working", activeView.working)}
          </>
        ) : search.trim() ? (
          visibleSessions.length === 0 ? <div className="sidebar-empty">{t("sidebar.searchEmpty", locale)}</div> : visibleSessions.map((session) => renderSessionRow(session))
        ) : <>
          {/* 会话区：当前选中工作区的会话 */}
          <WorkspaceGroupSection
            locale={locale}
            workspace={selectedWorkspaceGroup.workspace}
            sessions={orderSessions(selectedWorkspaceGroup.sessions)}
            onRenameWorkspace={onRenameWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            renderSession={(session) => renderSessionRow(session)}
          />
          {selectedWorkspaceGroup.sessions.length === 0 && <div className="sidebar-empty">{t("sidebar.workspaceEmpty", locale)}</div>}
        </>}
      </div>

      {!archiveOpen && sessionContextMenu && createPortal(
        <div ref={sessionMenuRef} className="session-context-menu" style={{ left: sessionMenuAt?.left ?? sessionContextMenu.x, top: sessionMenuAt?.top ?? sessionContextMenu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
          <SlotOutlet
            runtime={uiRuntime}
            slot="session.context-menu"
            variant="menu-item"
            context={{ session: toSessionUiContext(sessionContextMenu.session, displayTitle(sessionContextMenu.session)), activeSessionId, sessionGeneration: uiRuntime.sessionGeneration, locale: uiLocale, host: uiHost }}
          />
          {workspaceBySessionId.has(sessionContextMenu.session.sessionId) && (activeOpen || !search.trim()) && <button role="menuitem" onClick={() => onRequestSessionAction("pin", sessionContextMenu.session)}>{workspaceBySessionId.get(sessionContextMenu.session.sessionId)?.pinnedSessionIds?.includes(sessionContextMenu.session.sessionId) ? t("session.unpin", locale) : t("session.pinInWorkspace", locale)}</button>}
          <button role="menuitem" onClick={() => onRequestSessionAction("rename", sessionContextMenu.session)}>{t("session.rename", locale)}</button>
          <button role="menuitem" onClick={() => onRequestSessionAction("fork", sessionContextMenu.session)}>{t("session.fork", locale)}</button>
          <button role="menuitem" onClick={() => onRequestSessionAction("export", sessionContextMenu.session)}>{t("session.exportJson", locale)}</button>
          <button role="menuitem" onClick={() => onRequestSessionAction("exportZip", sessionContextMenu.session)}>{t("session.exportZip", locale)}</button>
          <button className="danger" role="menuitem" onClick={() => onRequestSessionAction("archive", sessionContextMenu.session)}>{t("session.archive", locale)}</button>
        </div>,
        document.body,
      )}

      <div className="sidebar-bottom">
        <WorkspacePicker
          workspace={workspace}
          workspaces={workspaces}
          open={workspaceMenuOpen}
          pinnedWorkspaceIds={pinnedWorkspaceIds}
          unpinnedSectionOpen={unpinnedSectionOpen}
          onUnpinnedSectionChange={onUnpinnedSectionChange}
          menuRef={workspacePickerMenuRef}
          onToggle={onToggleWorkspaceMenu}
          onChoose={handleChooseWorkspace}
          onTogglePin={onTogglePinWorkspace}
          onAdd={onAddWorkspace}
          onDelete={onDeleteWorkspace}
        />
      </div>

      <SidebarToggleHandle locale={locale} collapsed={collapsed} onToggle={onToggleCollapsed} />
    </aside>
  );
}
