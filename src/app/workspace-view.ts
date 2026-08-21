// 侧栏工作区视图偏好：置顶顺序与各工作区的收起状态。
// 属于 UI 显示偏好，遵循桌面端 localStorage 偏好先例（如 deeptop.sidebar-width），
// 不写入 DSH 工作区模型。

export const WORKSPACE_VIEW_STORAGE_KEY = "deeptop.workspace-view";

export type WorkspaceViewPreferences = {
  /** 置顶工作区 id，按置顶顺序排列；侧栏始终显示这些工作区分组。 */
  pinnedWorkspaceIds: string[];
  /** 各工作区是否收起；未记录的项使用默认收起。 */
  collapsedWorkspaces: Record<string, boolean>;
};

export const DEFAULT_WORKSPACE_VIEW_PREFERENCES: WorkspaceViewPreferences = {
  pinnedWorkspaceIds: [],
  collapsedWorkspaces: {},
};

export function parseWorkspaceViewPreferences(raw: string | null): WorkspaceViewPreferences {
  if (!raw) return DEFAULT_WORKSPACE_VIEW_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_WORKSPACE_VIEW_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    const pinned = record.pinnedWorkspaceIds;
    const collapsed = record.collapsedWorkspaces;
    const pinnedWorkspaceIds = Array.isArray(pinned)
      ? pinned.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const collapsedWorkspaces: Record<string, boolean> = {};
    if (collapsed && typeof collapsed === "object" && !Array.isArray(collapsed)) {
      for (const [workspaceId, value] of Object.entries(collapsed)) {
        if (typeof value === "boolean") collapsedWorkspaces[workspaceId] = value;
      }
    }
    return { pinnedWorkspaceIds, collapsedWorkspaces };
  } catch {
    return DEFAULT_WORKSPACE_VIEW_PREFERENCES;
  }
}

export function readWorkspaceViewPreferences(): WorkspaceViewPreferences {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_VIEW_PREFERENCES;
  try {
    return parseWorkspaceViewPreferences(window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_WORKSPACE_VIEW_PREFERENCES;
  }
}

export function writeWorkspaceViewPreferences(preferences: WorkspaceViewPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 受限 WebView 可能禁用存储；偏好仅影响显示，可静默忽略。
  }
}