import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { projectName } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

type WorkspaceGroupProps = {
  workspace: DshWorkspace | null;
  sessions: DshSessionSummary[];
  locale?: UiLocale;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  renderSession: (session: DshSessionSummary) => ReactNode;
};

export function WorkspaceGroup({
  workspace,
  sessions,
  locale = "zh",
  onRenameWorkspace,
  onDeleteWorkspace,
  renderSession,
}: WorkspaceGroupProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const { menuRef, menuAt } = useFloatingMenuPosition(contextMenu);
  const title = workspace ? workspace.title || projectName(workspace.path, locale) : t("workspace.unfiled", locale);
  const path = workspace?.path ?? t("workspace.unregistered", locale);

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
        <span className="workspace-group-copy"><strong>{title}</strong><small>{path}</small></span>
        <span className="workspace-group-count">{sessions.length}</span>
      </div>
      {workspace && contextMenu && createPortal(
        <div
          ref={menuRef}
          className="session-context-menu workspace-context-menu"
          style={{ left: menuAt?.left ?? contextMenu.x, top: menuAt?.top ?? contextMenu.y }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onClick={() => { setContextMenu(null); void onRenameWorkspace(workspace); }}>{t("workspace.rename", locale)}</button>
          <button className="danger" role="menuitem" onClick={() => { setContextMenu(null); void onDeleteWorkspace(workspace); }}>{t("workspace.delete", locale)}</button>
        </div>,
        document.body,
      )}
      {sessions.map(renderSession)}
    </section>
  );
}
