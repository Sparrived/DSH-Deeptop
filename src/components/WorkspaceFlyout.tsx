import type { RefObject } from "react";
import { projectName } from "../app/model";
import type { DshWorkspace } from "../lib/desktop";

type WorkspaceFlyoutProps = {
  workspace: string;
  workspaces: DshWorkspace[];
  pinnedWorkspaceIds: string[];
  flyoutRef: RefObject<HTMLDivElement | null>;
  onChoose: (path: string) => void;
  onAdd: () => void | Promise<void>;
  onTogglePin: (workspace: DshWorkspace) => void;
};

export function WorkspaceFlyout({ workspace, workspaces, pinnedWorkspaceIds, flyoutRef, onChoose, onAdd, onTogglePin }: WorkspaceFlyoutProps) {
  return (
    <div className="workspace-flyout" ref={flyoutRef} role="dialog" aria-label="工作区列表">
      <div className="workspace-flyout-heading">工作区</div>
      <div className="workspace-flyout-list">
        <button className={`workspace-flyout-main${!workspace ? " selected" : ""}`} onClick={() => onChoose("")} title="新会话使用 DSH 运行目录">
          <strong>未分组</strong><small>未注册工作区的会话</small>
        </button>
        {workspaces.map((item) => {
          const label = item.title || projectName(item.path);
          const pinned = pinnedWorkspaceIds.includes(item.workspaceId);
          return (
            <div key={item.workspaceId} className="workspace-flyout-item">
              <button className={`workspace-flyout-main${workspace === item.path ? " selected" : ""}`} onClick={() => onChoose(item.path)} title={item.path}>
                <strong>{label}</strong><small>{item.path}</small>
              </button>
              <span className="workspace-flyout-count">{item.sessionIds.length}</span>
              <button
                className={`workspace-flyout-pin${pinned ? " active" : ""}`}
                onClick={(event) => { event.stopPropagation(); onTogglePin(item); }}
                title={pinned ? "取消置顶" : "置顶工作区"}
                aria-label={pinned ? `取消置顶“${label}”` : `置顶工作区“${label}”`}
                aria-pressed={pinned}
              >📌</button>
            </div>
          );
        })}
      </div>
      <div className="workspace-flyout-footer">
        <button className="workspace-flyout-add" onClick={() => void onAdd()}>＋ 添加工作目录</button>
      </div>
    </div>
  );
}