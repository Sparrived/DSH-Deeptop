import type {
  DshSessionSummary,
  TraySessionMenuItem,
  TraySessionMenuSnapshot,
  TraySessionStatus,
} from "../lib/desktop";
import type { SessionIndicator } from "./session-runtime-state";
import { displayTitle, projectName } from "./ui-model.ts";

export const TRAY_UNREAD_LIMIT = 3;
export const TRAY_RECENT_LIMIT = 4;
export const TRAY_MORE_LIMIT = 12;

interface TrayMenuOptions {
  archivedSessionIds: ReadonlySet<string>;
  indicators: Readonly<Record<string, SessionIndicator>>;
  pendingSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  workspaceTitles: ReadonlyMap<string, string>;
}

function isEligibleSession(session: DshSessionSummary, archivedSessionIds: ReadonlySet<string>) {
  return !archivedSessionIds.has(session.sessionId)
    && !session.blank
    && session.origin !== "subagent"
    && !session.parentSessionId;
}

function traySessionItem(
  session: DshSessionSummary,
  status: TraySessionStatus,
  workspaceTitles: ReadonlyMap<string, string>,
): TraySessionMenuItem {
  const context = workspaceTitles.get(session.sessionId)?.trim() || projectName(session.cwd);
  return {
    sessionId: session.sessionId,
    title: displayTitle(session),
    context: context || undefined,
    status,
  };
}

/** Project live session state into the bounded native tray menu. */
export function buildTraySessionMenu(
  sessions: readonly DshSessionSummary[],
  options: TrayMenuOptions,
): TraySessionMenuSnapshot {
  const eligible = sessions
    .filter((session) => isEligibleSession(session, options.archivedSessionIds))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const unreadIds = new Set(eligible
    .filter((session) => session.sessionId !== options.activeSessionId)
    .filter((session) => {
      const indicator = options.indicators[session.sessionId];
      return options.pendingSessionIds.has(session.sessionId)
        || indicator === "completed"
        || indicator === "error";
    })
    .map((session) => session.sessionId));
  const statusFor = (session: DshSessionSummary): TraySessionStatus => {
    const indicator = options.indicators[session.sessionId];
    if (indicator === "error") return "error";
    if (unreadIds.has(session.sessionId)) return "unread";
    if (session.running || indicator === "running") return "running";
    return "idle";
  };
  const unreadSessions = eligible.filter((session) => unreadIds.has(session.sessionId));
  const recentSessions = eligible.filter((session) => !unreadIds.has(session.sessionId));
  const unread = unreadSessions
    .slice(0, TRAY_UNREAD_LIMIT)
    .map((session) => traySessionItem(session, statusFor(session), options.workspaceTitles));
  const recent = recentSessions
    .slice(0, TRAY_RECENT_LIMIT)
    .map((session) => traySessionItem(session, statusFor(session), options.workspaceTitles));
  const visibleIds = new Set([...unread, ...recent].map((item) => item.sessionId));
  const more = eligible
    .filter((session) => !visibleIds.has(session.sessionId))
    .slice(0, TRAY_MORE_LIMIT)
    .map((session) => traySessionItem(session, statusFor(session), options.workspaceTitles));
  return { unread, recent, more };
}
