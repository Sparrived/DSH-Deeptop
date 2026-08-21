import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { projectName } from "../app/model";
import type { DshWorkspace } from "../lib/desktop";

type WorkspaceRowProps = {
  workspace: DshWorkspace | null;
  pinned: boolean;
  current: boolean;
  onChoose: (path: string) => void;
  onTogglePinWorkspace: (workspace: DshWorkspace) => void;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
};

export function WorkspaceRow({
  workspace,
  pinned,
  current,
  onChoose,
  onTogglePinWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
}: WorkspaceRowProps) {
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
    <div
      className={`workspace-row${current ? " current" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!workspace) return;
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button className="workspace-row-main" type="button" onClick={() => onChoose(workspace?.path ?? "")} title={path}>
        <span className="workspace-group-copy"><strong>{title}</strong><small>{path}</small></span>
        {workspace && <span className="workspace-group-count">{workspace.sessionIds.length}</span>}
      </button>
      {workspace && (
        <button
          className={`workspace-row-pin${pinned ? " active" : ""}`}
          type="button"
          onClick={(event) => { event.stopPropagation(); onTogglePinWorkspace(workspace); }}
          title={pinned ? "取消置顶" : "置顶工作区"}
          aria-label={pinned ? `取消置顶“${title}”` : `置顶工作区“${title}”`}
          aria-pressed={pinned}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >📌</button>
      )}
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
    </div>
  );
}
