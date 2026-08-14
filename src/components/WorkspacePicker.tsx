import { projectName } from "../app/model";
import type { DshWorkspace } from "../lib/desktop";

type WorkspacePickerProps = {
  workspace: string;
  workspaces: DshWorkspace[];
  open: boolean;
  onToggle: () => void;
  onChoose: (path: string) => void;
  onAdd: () => void | Promise<void>;
};

export function WorkspacePicker({ workspace, workspaces, open, onToggle, onChoose, onAdd }: WorkspacePickerProps) {
  return (
    <div className="workspace-picker">
      <button className="workspace-line" onClick={onToggle} title={workspace || "选择工作目录"} aria-expanded={open}>
        <span className="line-icon">⌂</span>
        <span><strong>{workspace ? projectName(workspace) : "工作目录"}</strong><small>{workspace || "新会话使用运行目录"}</small></span>
        <span className="line-arrow">⌄</span>
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <button className={!workspace ? "selected" : ""} onClick={() => onChoose("")} role="menuitem">DSH 运行目录</button>
          {workspaces.map((item) => (
            <button key={item.workspaceId} className={workspace === item.path ? "selected" : ""} onClick={() => onChoose(item.path)} role="menuitem" title={item.path}>
              <strong>{item.title || projectName(item.path)}</strong><small>{item.path}</small>
            </button>
          ))}
          <button className="workspace-add" onClick={() => void onAdd()} role="menuitem">＋ 添加工作目录</button>
        </div>
      )}
    </div>
  );
}
