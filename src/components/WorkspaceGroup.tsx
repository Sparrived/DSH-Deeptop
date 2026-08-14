import type { ReactNode } from "react";
import { projectName } from "../app/model";
import type { DshSessionSummary, DshWorkspace } from "../lib/desktop";

type WorkspaceGroupProps = {
  workspace: DshWorkspace | null;
  workspaceId: string;
  sessions: DshSessionSummary[];
  collapsed: boolean;
  onToggle: (workspaceId: string) => void;
  onMoveWorkspace: (workspace: DshWorkspace, direction: "up" | "down") => void | Promise<void>;
  onRenameWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  onDeleteWorkspace: (workspace: DshWorkspace) => void | Promise<void>;
  renderSession: (session: DshSessionSummary) => ReactNode;
};

export function WorkspaceGroup({
  workspace,
  workspaceId,
  sessions,
  collapsed,
  onToggle,
  onMoveWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  renderSession,
}: WorkspaceGroupProps) {
  const title = workspace ? workspace.title || projectName(workspace.path) : "未分组";
  const path = workspace?.path ?? "未注册工作区的会话";

  return (
    <section className={`workspace-group${workspace ? "" : " workspace-group-unfiled"}`}>
      <div className="workspace-group-header">
        <button className="workspace-group-toggle" type="button" onClick={() => onToggle(workspaceId)} aria-expanded={!collapsed}>
          <span className="workspace-group-chevron" aria-hidden="true">{collapsed ? ">" : "v"}</span>
          <span className="workspace-group-copy"><strong>{title}</strong><small>{path}</small></span>
          <span className="workspace-group-count">{sessions.length}</span>
        </button>
        {workspace && (
          <div className="workspace-group-actions">
            <button type="button" onClick={() => void onMoveWorkspace(workspace, "up")} title="工作区上移" aria-label="工作区上移">↑</button>
            <button type="button" onClick={() => void onMoveWorkspace(workspace, "down")} title="工作区下移" aria-label="工作区下移">↓</button>
            <button type="button" onClick={() => void onRenameWorkspace(workspace)} title="重命名工作区" aria-label="重命名工作区">改</button>
            <button className="danger" type="button" onClick={() => void onDeleteWorkspace(workspace)} title="移除工作区" aria-label="移除工作区">×</button>
          </div>
        )}
      </div>
      {!collapsed && sessions.map(renderSession)}
    </section>
  );
}
