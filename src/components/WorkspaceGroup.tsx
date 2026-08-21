import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { projectName } from "../app/model";
import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

type WorkspaceGroupProps = {
  workspace: DshWorkspace | null;
  workspaceId: string;
  sessions: DshSessionSummary[];
  pinned: boolean;
  current: boolean;
  menuOpen: boolean;
  onToggleMenu: (workspaceId: string) => void;
  onCloseMenu: () => void;
  onChooseWorkspace: (path: string) => void;
  onTogglePinWorkspace: (workspace: DshWorkspace) => void;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  renderSession: (session: DshSessionSummary) => ReactNode;
};

export function WorkspaceGroup({
  workspace,
  workspaceId,
  sessions,
  pinned,
  current,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onChooseWorkspace,
  onTogglePinWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  renderSession,
}: WorkspaceGroupProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const title = workspace ? workspace.title || projectName(workspace.path) : "未分组";
  const path = workspace?.path ?? "未注册工作区的会话";

  // 二级菜单跟随工作区行定位（显示在行的右侧）。
  useEffect(() => {
    if (!menuOpen) return;
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, Math.max(240, window.innerWidth - rect.right - 12));
    setSubmenuAnchor({
      x: Math.max(8, rect.right + 6),
      y: Math.max(8, Math.min(rect.top, window.innerHeight - 48)),
      width,
    });
  }, [menuOpen, workspaceId]);

  // 点击外部或按 Esc 自动收起二级菜单与右键菜单。
  useEffect(() => {
    if (!menuOpen && !contextMenu) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".workspace-submenu") || event.target.closest(".workspace-context-menu") || event.target.closest(".workspace-row-toggle")) return;
      setContextMenu(null);
      if (menuOpen && !event.target.closest(".workspace-group-row")) onCloseMenu();
    };
    const handleContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setContextMenu(null);
      onCloseMenu();
    };
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu, menuOpen, onCloseMenu]);

  return (
    <section className={`workspace-group${workspace ? "" : " workspace-group-unfiled"}${current ? " current" : ""}`}>
      <div
        className="workspace-group-row"
        ref={rowRef}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!workspace) return;
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <button className={`workspace-row-toggle${menuOpen ? " open" : ""}`} type="button" onClick={() => onToggleMenu(workspaceId)} title="工作区会话（二级菜单）" aria-expanded={menuOpen}>
          <span aria-hidden="true">{menuOpen ? "v" : ">"}</span>
        </button>
        <button className="workspace-row-main" type="button" onClick={() => onChooseWorkspace(workspace?.path ?? "")} title={path}>
          <span className="workspace-group-copy"><strong>{title}</strong><small>{path}</small></span>
          <span className="workspace-group-count">{sessions.length}</span>
        </button>
        {workspace && (
          <button
            className={`workspace-row-pin${pinned ? " active" : ""}`}
            type="button"
            onClick={(event) => { event.stopPropagation(); onTogglePinWorkspace(workspace); }}
            title={pinned ? "取消置顶" : "置顶工作区"}
            aria-label={pinned ? `取消置顶“${title}”` : `置顶工作区“${title}”`}
            aria-pressed={pinned}
          >📌</button>
        )}
      </div>

      {workspace && contextMenu && createPortal(
        <div
          className="session-context-menu workspace-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onClick={() => { setContextMenu(null); onTogglePinWorkspace(workspace); }}>{pinned ? "取消置顶" : "置顶工作区"}</button>
          <button role="menuitem" onClick={() => { setContextMenu(null); void onRenameWorkspace(workspace); }}>重命名工作区</button>
          <button className="danger" role="menuitem" onClick={() => { setContextMenu(null); void onDeleteWorkspace(workspace); }}>删除工作区</button>
        </div>,
        document.body,
      )}

      {menuOpen && submenuAnchor && createPortal(
        <div className="workspace-submenu" style={{ left: submenuAnchor.x, top: submenuAnchor.y, width: submenuAnchor.width }} role="menu" aria-label={`${title} 的会话`}>
          <div className="workspace-submenu-heading">
            <strong>{title}</strong>
            <small>{path}</small>
          </div>
          <div className="workspace-submenu-sessions">
            {sessions.length === 0 ? <div className="workspace-submenu-empty">没有已开始的会话</div> : sessions.map(renderSession)}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
