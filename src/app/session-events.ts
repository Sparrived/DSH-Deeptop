import type { DshHistoryEntry } from "../lib/desktop";
import type { TranscriptItem } from "./model-types";

/**
 * Session-level event timing projections. Pure module: no React, Tauri or
 * bridge calls, and no runtime imports, so it stays directly testable under
 * the node type-stripping test runner (like trajectory.ts and message-model.ts).
 */

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Session-level running time: the wall-clock elapsed between the session's
 * first and last events. While the session is still running, pass `now` so the
 * end keeps counting up instead of freezing at the last received event.
 */
export function sessionElapsedMs(entries: DshHistoryEntry[], now?: number): number {
  let first: number | undefined;
  let last: number | undefined;
  for (const { event } of entries) {
    const time = event.time;
    if (typeof time !== "number" || !Number.isFinite(time)) continue;
    if (first === undefined || time < first) first = time;
    if (last === undefined || time > last) last = time;
  }
  if (first === undefined || last === undefined) return 0;
  const end = now !== undefined && Number.isFinite(now) && now > last ? now : last;
  return Math.max(0, end - first);
}

/** Compact human duration for the session running-time chip (5s / 2m 03s / 1h 05m). */
export function formatSessionElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Per-round timing rows: after each `turn/end` the transcript shows the round's
 * duration (turn/start -> turn/end, i.e. the model running time for that round).
 * Returns one system item per closed round, keyed so it sorts right after the
 * round's own content.
 */
export function turnTimingItems(entries: DshHistoryEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const turnStarts = new Map<number, number>();
  let currentTurn: number | undefined;
  for (const { event } of [...entries].sort((left, right) => left.event.seq - right.event.seq)) {
    if (event.type === "turn/start") {
      const turn = numberValue(event.data.turn);
      if (turn !== undefined) {
        currentTurn = turn;
        turnStarts.set(turn, event.time);
      }
      continue;
    }
    if (event.type === "turn/end") {
      const turn = numberValue(event.data.turn) ?? currentTurn;
      const startedAt = turn !== undefined ? turnStarts.get(turn) : undefined;
      if (startedAt !== undefined && event.time >= startedAt) {
        items.push({
          key: `turn-time-${event.seq}`,
          kind: "system",
          label: "回合耗时",
          text: `第 ${turn} 轮 用时 ${formatSessionElapsed(event.time - startedAt)}`,
          seq: event.seq + 0.01,
          time: event.time,
        });
      }
      continue;
    }
  }
  return items;
}
