import type { DshHistoryEntry, DshSessionEvent } from "../lib/desktop";
import { t, type UiLocale } from "./i18n.ts";

/**
 * Per-tool permission ledger derived from the official approval audit events.
 *
 * The official `permissions` projection only carries preset options and the
 * current preset value — there is no per-tool permission projection. The only
 * authoritative, replayable source for "was this tool allowed / rejected" is
 * the session-log audit pair `approval/asked` → `approval/decided`. This module
 * folds those events into a stable per-tool view that survives history reloads.
 */

export type ToolApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

export type ToolApprovalState = {
  /** The tool whose call triggered the approval request. */
  toolName: string;
  /** The exact tool call, when the asker had one. */
  callId?: string;
  /** Human-readable asker explanation (e.g. a permission-decision reason). */
  reason?: string;
  /** Terminal approval decision. */
  outcome: ToolApprovalOutcome;
  /** Timestamp of the deciding event. */
  time: number;
  /** Sequence of the deciding event. */
  seq: number;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isApprovalOutcome(value: unknown): value is ToolApprovalOutcome {
  return value === "allowed-once" || value === "rejected" || value === "cancelled" || value === "unavailable";
}

/** Fold one session's approval audit pair into the ledger entry for the tool. */
export function approvalLedgerFromHistory(entries: DshHistoryEntry[]): ToolApprovalState[] {
  const open = new Map<string, { toolName: string; reason?: string; callId?: string; time: number; seq: number }>();
  const decided = new Map<string, ToolApprovalState>();
  const order: string[] = [];
  for (const { event } of [...entries].sort((left, right) => left.event.seq - right.event.seq)) {
    const data = recordValue(event.data) ?? {};
    const id = stringValue(data.id);
    if (event.type === "approval/asked" && id) {
      open.set(id, {
        toolName: stringValue(data.toolName) ?? "tool",
        ...(stringValue(data.reason) ? { reason: stringValue(data.reason) } : {}),
        ...(stringValue(data.callId) ? { callId: stringValue(data.callId) } : {}),
        time: event.time,
        seq: event.seq,
      });
      continue;
    }
    if (event.type === "approval/decided" && id && isApprovalOutcome(data.outcome)) {
      const asked = open.get(id);
      if (!asked) continue;
      const key = asked.callId ? `callId:${asked.callId}` : `tool:${asked.toolName}`;
      if (!decided.has(key)) order.push(key);
      decided.set(key, {
        toolName: asked.toolName,
        ...(asked.callId ? { callId: asked.callId } : {}),
        ...(asked.reason ? { reason: asked.reason } : {}),
        outcome: data.outcome,
        time: event.time,
        seq: event.seq,
      });
      open.delete(id);
      continue;
    }
  }
  // Keep decisions ordered by their deciding seq, mirroring ledger ordering.
  return order.map((key) => decided.get(key)).filter((state): state is ToolApprovalState => state !== undefined);
}

/** A stable fold key for one tool (used by callers to dedupe live + history). */
export function toolApprovalKey(state: Pick<ToolApprovalState, "toolName" | "callId">): string {
  return state.callId ? `callId:${state.callId}` : `tool:${state.toolName}`;
}

export function toolApprovalLabel(outcome: ToolApprovalOutcome, locale: UiLocale = "zh"): string {
  const labels: Record<ToolApprovalOutcome, string> = {
    "allowed-once": "permission.audit.allowed",
    rejected: "permission.audit.rejected",
    cancelled: "permission.audit.cancelled",
    unavailable: "permission.audit.unavailable",
  };
  return t(labels[outcome], locale);
}

/** Extract the approval audit intent from a raw session event (type guard). */
export function isApprovalAuditEvent(event: DshSessionEvent): boolean {
  return event.type === "approval/asked" || event.type === "approval/decided";
}