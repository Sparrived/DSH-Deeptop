import type { RefObject } from "react";
import { projectName } from "../app/model";
import type { DshWorkspace } from "../lib/desktop";

const UNGROUPED_WORKSPACE_ID = "__ungrouped__";

type WorkspacePickerProps = {
  workspace: string;
  workspaces: DshWorkspace[];
  open: boolean;
  pinnedWorkspaceIds: string[];
  collapsedWorkspaces: Record<string, boolean>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onChoose: (path: string) => void;
  onTogglePin: (workspace: DshWorkspace) => void;
  onToggleCollapse: (workspaceId: string) => void;
  onAdd: () => void | Promise<void>;
  onDelete: (workspace: DshWorkspace) => void | Promise<void>;
};

export function WorkspacePicker({
  workspace,
  workspaces,
  open,
  pinnedWorkspaceIds,
  collapsedWorkspaces,
  menuRef,
  onToggle,
  onChoose,
  onTogglePin,
  onToggleCollapse,
  onAdd,
  onDelete,
}: WorkspacePickerProps) {
  const selectedWorkspace = workspaces.find((item) => item.path === workspace);
  const selectedTitle = selectedWorkspace?.title || (workspace ? projectName(workspace) : "未分组");
  const selectedPath = selectedWorkspace?.path || (workspace || "未注册工作区的会话");
  const selectedPinned = Boolean(selectedWorkspace && pinnedWorkspaceIds.includes(selectedWorkspace.workspaceId));
  // 左下角列表用于工作区整理（置顶/收起），默认：未置顶的工作区收起、置顶的工作区展开。
  const renderCollapseToggle = (workspaceId: string, label: string, pinned: boolean) => {
    const collapsed = collapsedWorkspaces[workspaceId] ?? !pinned;
    return (
      <button
        className={`workspace-menu-toggle${collapsed ? " collapsed" : ""}`}
        onClick={(event) => { event.stopPropagation(); onToggleCollapse(workspaceId); }}
        role="menuitem"
        title={collapsed ? `展开“${label}”` : `收起“${label}”`}
        aria-label={collapsed ? `展开“${label}”` : `收起“${label}”`}
        aria-expanded={!collapsed}
      >{collapsed ? ">" : "v"}</button>
    );
  };
  return (
    <div className="workspace-picker" ref={menuRef}>
      <button className="workspace-line" onClick={onToggle} title={workspace || "未分组会话；新会话使用 DSH 运行目录"} aria-expanded={open}>
        <span className="line-icon">⌂</span>
        <span>
          <strong>{selectedTitle}</strong>
          <small>{selectedPath}</small>
        </span>
        <span className="line-arrow">{selectedPinned ? "📌" : "⌄"}</span>
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <div className="workspace-menu-item" role="presentation">
            {renderCollapseToggle(UNGROUPED_WORKSPACE_ID, "未分组", false)}
            <button className={`workspace-menu-main${!workspace ? " selected" : ""}`} onClick={() => onChoose("")} role="menuitem" title="新会话使用 DSH 运行目录">
              <strong>未分组</strong><small>未注册工作区的会话</small>
            </button>
          </div>
          {workspaces.map((item) => {
            const label = item.title || projectName(item.path);
            const pinned = pinnedWorkspaceIds.includes(item.workspaceId);
            return (
              <div key={item.workspaceId} className="workspace-menu-item" role="presentation">
                {renderCollapseToggle(item.workspaceId, label, pinned)}
                <button className={`workspace-menu-main${workspace === item.path ? " selected" : ""}`} onClick={() => onChoose(item.path)} role="menuitem" title={item.path}>
                  <strong>{label}</strong><small>{item.path}</small>
                </button>
                <button
                  className={`workspace-menu-pin${pinned ? " active" : ""}`}
                  onClick={(event) => { event.stopPropagation(); onTogglePin(item); }}
                  role="menuitem"
                  title={pinned ? "取消置顶" : "置顶工作区"}
                  aria-label={pinned ? `取消置顶“${label}”` : `置顶工作区“${label}”`}
                  aria-pressed={pinned}
                >📌</button>
                <button
                  className="workspace-menu-delete"
                  onClick={(event) => { event.stopPropagation(); void onDelete(item); }}
                  role="menuitem"
                  title={`删除工作区“${label}”`}
                  aria-label={`删除工作区“${label}”`}
                >🗑</button>
              </div>
            );
          })}
          <button className="workspace-add" onClick={() => void onAdd()} role="menuitem">＋ 添加工作目录</button>
        </div>
      )}
    </div>
  );
}
