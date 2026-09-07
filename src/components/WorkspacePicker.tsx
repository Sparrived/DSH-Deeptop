import type { RefObject } from "react";
import { ChevronDown, ChevronRight, Folder, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { projectName } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import type { DshWorkspace } from "../lib/desktop";

type WorkspacePickerProps = {
  workspace: string;
  workspaces: DshWorkspace[];
  open: boolean;
  pinnedWorkspaceIds: string[];
  unpinnedSectionOpen: boolean;
  locale?: UiLocale;
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
  locale = "zh",
  onUnpinnedSectionChange,
  menuRef,
  onToggle,
  onChoose,
  onTogglePin,
  onAdd,
  onDelete,
}: WorkspacePickerProps) {
  const selectedWorkspace = workspaces.find((item) => item.path === workspace);
  const selectedTitle = selectedWorkspace?.title || (workspace ? projectName(workspace, locale) : t("workspace.unfiled", locale));
  const selectedPath = selectedWorkspace?.path || (workspace || t("workspace.unregistered", locale));
  const selectedPinned = Boolean(selectedWorkspace && pinnedWorkspaceIds.includes(selectedWorkspace.workspaceId));
  // 一级菜单只常驻未分组与置顶工作区；其余未置顶工作区收进二级列表，避免工作区过多。
  const pinnedWorkspaces = workspaces.filter((item) => pinnedWorkspaceIds.includes(item.workspaceId));
  const unpinnedWorkspaces = workspaces.filter((item) => !pinnedWorkspaceIds.includes(item.workspaceId));
  const renderWorkspaceItem = (item: DshWorkspace) => {
    const label = item.title || projectName(item.path, locale);
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
          title={pinned ? t("workspace.unpin", locale) : t("workspace.pin", locale)}
          aria-label={pinned ? t("workspace.unpinAria", locale, { name: label }) : t("workspace.pinAria", locale, { name: label })}
          aria-pressed={pinned}
        >{pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}</button>
        <button
          className="workspace-menu-delete"
          onClick={(event) => { event.stopPropagation(); void onDelete(item); }}
          role="menuitem"
          title={t("workspace.deleteAria", locale, { name: label })}
          aria-label={t("workspace.deleteAria", locale, { name: label })}
        ><Trash2 aria-hidden="true" /></button>
      </div>
    );
  };
  return (
    <div className="workspace-picker" ref={menuRef}>
      <button className="workspace-line" onClick={onToggle} title={workspace || t("workspace.unfiledHint", locale)} aria-expanded={open}>
        <span className="line-icon" aria-hidden="true"><Folder /></span>
        <span><strong>{selectedTitle}</strong><small>{selectedPath}</small></span>
        <span className="line-arrow" aria-hidden="true">{selectedPinned ? <Pin /> : <ChevronDown />}</span>
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <button className={!workspace ? "selected" : ""} onClick={() => onChoose("")} role="menuitem" title={t("workspace.newSessionHint", locale)}>
            <strong>{t("workspace.unfiled", locale)}</strong><small>{t("workspace.unregistered", locale)}</small>
          </button>
          {pinnedWorkspaces.map(renderWorkspaceItem)}
          {unpinnedWorkspaces.length > 0 && (
            <button
              type="button"
              className={`workspace-menu-toggle${unpinnedSectionOpen ? " open" : ""}`}
              onClick={() => onUnpinnedSectionChange(!unpinnedSectionOpen)}
              role="menuitem"
              aria-expanded={unpinnedSectionOpen}
              title={unpinnedSectionOpen ? t("workspace.collapseUnpinned", locale) : t("workspace.expandUnpinned", locale)}
            >
              <span className="workspace-menu-chevron" aria-hidden="true"><ChevronRight className={unpinnedSectionOpen ? "open" : undefined} /></span>
              <span>{t("workspace.unpinnedSection", locale, { count: unpinnedWorkspaces.length })}</span>
            </button>
          )}
          {unpinnedSectionOpen && unpinnedWorkspaces.length > 0 && (
            <div className="workspace-menu-nested" role="group" aria-label={t("workspace.unpinnedListAria", locale)}>
              {unpinnedWorkspaces.map(renderWorkspaceItem)}
            </div>
          )}
          <button className="workspace-add" onClick={() => void onAdd()} role="menuitem"><Plus aria-hidden="true" /> {t("workspace.add", locale)}</button>
        </div>
      )}
    </div>
  );
}
