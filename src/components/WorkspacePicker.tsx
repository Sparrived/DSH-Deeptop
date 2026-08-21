import type { RefObject } from "react";
import { projectName } from "../app/model";
import type { DshWorkspace } from "../lib/desktop";

type WorkspacePickerProps = {
  workspace: string;
  workspaces: DshWorkspace[];
  open: boolean;
  pinnedWorkspaceIds: string[];
  unpinnedSectionOpen: boolean;
  onUnpinnedSectionChange: (open: boolean) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onChoose: (path: string) => void;
  onTogglePin: (workspace: DshWorkspace) => void;
  onAdd: () => void | Promise<void>;
  onDelete: (workspace: DshWorkspace) => void | Promise<void>;
};

export function WorkspacePicker({
  workspace,
  workspaces,
  open,
  pinnedWorkspaceIds,
  unpinnedSectionOpen,
  onUnpinnedSectionChange,
  menuRef,
  onToggle,
  onChoose,
  onTogglePin,
  onAdd,
  onDelete,
}: WorkspacePickerProps) {
  const selectedWorkspace = workspaces.find((item) => item.path === workspace);
  const selectedTitle = selectedWorkspace?.title || (workspace ? projectName(workspace) : "未分组");
  const selectedPath = selectedWorkspace?.path || (workspace || "未注册工作区的会话");
  const selectedPinned = Boolean(selectedWorkspace && pinnedWorkspaceIds.includes(selectedWorkspace.workspaceId));
  // 一级菜单只常驻未分组与置顶工作区；其余未置顶工作区收进二级列表，避免工作区过多。
  const pinnedWorkspaces = workspaces.filter((item) => pinnedWorkspaceIds.includes(item.workspaceId));
  const unpinnedWorkspaces = workspaces.filter((item) => !pinnedWorkspaceIds.includes(item.workspaceId));
  const renderWorkspaceItem = (item: DshWorkspace) => {
    const label = item.title || projectName(item.path);
    const pinned = pinnedWorkspaceIds.includes(item.workspaceId);
    return (
      <div key={item.workspaceId} className="workspace-menu-item" role="presentation">
        <button className={workspace === item.path ? "selected" : ""} onClick={() => onChoose(item.path)} role="menuitem" title={item.path}>
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
  };
  return (
    <div className="workspace-picker" ref={menuRef}>
      <button className="workspace-line" onClick={onToggle} title={workspace || "未分组会话；新会话使用 DSH 运行目录"} aria-expanded={open}>
        <span className="line-icon">⌂</span>
        <span><strong>{selectedTitle}</strong><small>{selectedPath}</small></span>
        <span className="line-arrow">{selectedPinned ? "📌" : "⌄"}</span>
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <button className={!workspace ? "selected" : ""} onClick={() => onChoose("")} role="menuitem" title="新会话使用 DSH 运行目录">
            <strong>未分组</strong><small>未注册工作区的会话</small>
          </button>
          {pinnedWorkspaces.map(renderWorkspaceItem)}
          {unpinnedWorkspaces.length > 0 && (
            <button
              type="button"
              className={`workspace-menu-toggle${unpinnedSectionOpen ? " open" : ""}`}
              onClick={() => onUnpinnedSectionChange(!unpinnedSectionOpen)}
              role="menuitem"
              aria-expanded={unpinnedSectionOpen}
              title={unpinnedSectionOpen ? "收起未置顶工作区" : "展开未置顶工作区"}
            >
              <span className="workspace-menu-chevron" aria-hidden="true">{unpinnedSectionOpen ? "▾" : "▸"}</span>
              <span>未置顶工作区（{unpinnedWorkspaces.length}）</span>
            </button>
          )}
          {unpinnedSectionOpen && unpinnedWorkspaces.length > 0 && (
            <div className="workspace-menu-nested" role="group" aria-label="未置顶工作区列表">
              {unpinnedWorkspaces.map(renderWorkspaceItem)}
            </div>
          )}
          <button className="workspace-add" onClick={() => void onAdd()} role="menuitem">＋ 添加工作目录</button>
        </div>
      )}
    </div>
  );
}
