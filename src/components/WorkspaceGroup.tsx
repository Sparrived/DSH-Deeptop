import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { projectName } from "../app/model";
import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

type WorkspaceGroupProps = {
  workspace: DshWorkspace | null;
  workspaceId: string;
  sessions: DshSessionSummary[];
  collapsed: boolean;
  pinned: boolean;
  onToggle: (workspaceId: string) => void;
  onTogglePinWorkspace: (workspace: DshWorkspace) => void;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  renderSession: (session: DshSessionSummary) => ReactNode;
};

export function WorkspaceGroup({
  workspace,
  workspaceId,
  sessions,
  collapsed,
  pinned,
  onToggle,
  onTogglePinWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  renderSession,
}: WorkspaceGroupProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const title = workspace ? workspace.title || projectName(workspace.path) : "未分组";
  const path = workspace?.path ?? "未注册工作区的会话";

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".workspace-context-menu")) {
        setContextMenu(null);
      }
    };
    const handleContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  return (
    <section className={`workspace-group${workspace ? "" : " workspace-group-unfiled"}`}>
      <div
        className="workspace-group-header"
        onContextMenu={(event) => {
          event.preventDefault();
          if (!workspace) return;
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <button className="workspace-group-toggle" type="button" onClick={() => onToggle(workspaceId)} aria-expanded={!collapsed}>
          <span className="workspace-group-chevron" aria-hidden="true">{collapsed ? ">" : "v"}</span>
          <span className="workspace-group-copy"><strong>{title}</strong><small>{path}</small></span>
          <span className="workspace-group-count">{sessions.length}</span>
        </button>
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
      {!collapsed && sessions.map(renderSession)}
    </section>
  );
}
