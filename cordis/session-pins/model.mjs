// Pure data rules shared by the session-pins Host service and root-level tests.

export const LEGACY_STORE_VERSION = 1

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeSessionPinIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(item => typeof item === 'string' && item.trim() !== ''))]
}

/** Parse the v1 JSON store without trusting unknown workspace or session ids. */
export function parseLegacySessionPinStore(value) {
  if (!isRecord(value) || value.version !== LEGACY_STORE_VERSION || !isRecord(value.workspaces)) return {}
  return Object.fromEntries(Object.entries(value.workspaces).map(([workspaceId, sessionIds]) => [
    workspaceId,
    normalizeSessionPinIds(sessionIds),
  ]).filter(([, sessionIds]) => sessionIds.length > 0))
}

/** Keep only pins that still belong to the workspace's authoritative membership. */
export function pinnedForWorkspace(workspace, sessionIds) {
  const accounted = new Set(Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : [])
  return normalizeSessionPinIds(sessionIds).filter(sessionId => accounted.has(sessionId))
}
