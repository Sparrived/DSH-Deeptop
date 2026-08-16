import { projectName } from "../app/model";
import type { DshWorkspace } from "../lib/desktop";

type WorkspacePickerProps = {
  workspace: string;
  workspaces: DshWorkspace[];
  open: boolean;
  onToggle: () => void;
  onChoose: (path: string) => void;
  onAdd: () => void | Promise<void>;
  onDelete: (workspace: DshWorkspace) => void | Promise<void>;
};

export function WorkspacePicker({ workspace, workspaces, open, onToggle, onChoose, onAdd, onDelete }: WorkspacePickerProps) {
  const selectedWorkspace = workspaces.find((item) => item.path === workspace);
  const selectedTitle = selectedWorkspace?.title || (workspace ? projectName(workspace) : "未分组");
  const selectedPath = selectedWorkspace?.path || (workspace || "未注册工作区的会话");
  return (
    <div className="workspace-picker">
      <button className="workspace-line" onClick={onToggle} title={workspace || "未分组会话；新会话使用 DSH 运行目录"} aria-expanded={open}>
        <span className="line-icon">⌂</span>
        <span><strong>{selectedTitle}</strong><small>{selectedPath}</small></span>
        <span className="line-arrow">⌄</span>
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <button className={!workspace ? "selected" : ""} onClick={() => onChoose("")} role="menuitem" title="新会话使用 DSH 运行目录">
            <strong>未分组</strong><small>未注册工作区的会话</small>
          </button>
          {workspaces.map((item) => {
            const label = item.title || projectName(item.path);
            return (
              <div key={item.workspaceId} className="workspace-menu-item" role="presentation">
                <button className={workspace === item.path ? "selected" : ""} onClick={() => onChoose(item.path)} role="menuitem" title={item.path}>
                  <strong>{label}</strong><small>{item.path}</small>
                </button>
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
