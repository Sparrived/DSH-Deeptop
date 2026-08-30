export type TerminalTabRecord = {
  id: string;
  terminalId: string;
  sessionId: string | null;
  exited: boolean;
};

/** Choose the next active tab, preferring the tab immediately before a closed tab. */
export function activeTabAfterClose(tabs: TerminalTabRecord[], closedId: string, activeId: string): string {
  if (activeId !== closedId) return activeId;
  const index = tabs.findIndex((tab) => tab.id === closedId);
  if (index < 0) return activeId;
  const remaining = tabs.filter((tab) => tab.id !== closedId);
  return remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id ?? "";
}

/** Remove tabs whose shell disappeared during a refresh and keep the active id valid. */
export function pruneUnavailableTabs(
  tabs: TerminalTabRecord[],
  availableTerminalIds: string[],
  activeId: string,
): { tabs: TerminalTabRecord[]; activeId: string } {
  const available = new Set(availableTerminalIds);
  const nextTabs = tabs.filter((tab) => available.has(tab.terminalId));
  return {
    tabs: nextTabs,
    activeId: nextTabs.some((tab) => tab.id === activeId) ? activeId : nextTabs[0]?.id ?? "",
  };
}

/** Workspace changes cannot reuse a PTY: all tabs must be recreated in the new cwd. */
export function resetTabsForWorkspaceChange(previousWorkspace: string, nextWorkspace: string): boolean {
  return previousWorkspace !== nextWorkspace;
}
