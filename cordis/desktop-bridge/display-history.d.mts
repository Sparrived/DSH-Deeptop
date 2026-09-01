import type { DshHistoryEntry } from "../../src/lib/desktop.ts";

export function compactHistoryEntries(entries: readonly DshHistoryEntry[]): DshHistoryEntry[];
export function mergeHistoryEntries(
  current: readonly DshHistoryEntry[],
  additions: readonly DshHistoryEntry[],
): DshHistoryEntry[];
export function displayHistoryStartSequence(entries: readonly DshHistoryEntry[]): number | undefined;
export function displayHistoryEventCount(entries: readonly DshHistoryEntry[]): number;
export function displayEntrySequenceRanges(entry: DshHistoryEntry): Array<[start: number, end: number]>;
export function mergeDisplaySequenceRanges(
  ...groups: Array<ReadonlyArray<readonly [start: number, end: number]>>
): Array<[start: number, end: number]>;
export function compactLiveEventFrames<T>(frames: readonly T[]): T[];
export function compactHistoryResponse<T>(response: T): T;
