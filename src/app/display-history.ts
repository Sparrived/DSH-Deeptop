import type { DshHistoryEntry } from "../lib/desktop";
import {
  compactHistoryEntries as compactDisplayHistory,
  displayHistoryEventCount as displayEventCount,
  displayHistoryStartSequence as displayHistoryStartSeq,
  isTransientStreamSeq,
  mergeHistoryEntries as mergeDisplayHistory,
} from "../../cordis/desktop-bridge/display-history.mjs";
import { isInjectedMessage } from "./message-model.ts";

export {
  compactDisplayHistory,
  displayEventCount,
  displayHistoryStartSeq,
  isTransientStreamSeq,
  mergeDisplayHistory,
};

/**
 * 一轮的输入处：`turn/start`，或一条真实用户提示（注入的上下文不算）。
 *
 * 「读取更早消息」按轮补齐：窗口开头落在输入处说明已经读到上一轮的输入，
 * 可以停下；否则窗口是从某一轮中间截断的，要继续往前翻。
 */
export function isRoundInput(entry: DshHistoryEntry | undefined): boolean {
  const event = entry?.event;
  if (event === undefined) return false;
  if (event.type === "turn/start") return true;
  return event.type === "user/message" && !isInjectedMessage(event);
}

/** 窗口内最新的一轮输入下标（窗口按 seq 升序）；没有则返回 -1。 */
export function latestRoundInputIndex(entries: readonly DshHistoryEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isRoundInput(entries[index])) return index;
  }
  return -1;
}

/**
 * 打开会话后是否还要继续向前翻页：窗口里还没有任何一轮输入行，说明最新一页是从某
 * 一轮中间截断的，默认视图看不到用户输入。窗口是「连续的尾部窗口」，只要含有一轮
 * 输入，最近一轮的输入就在其中，所以这也是「默认至少一个完整轮次」的充分判据。
 */
export function needsNewestRoundFill(entries: readonly DshHistoryEntry[], hasMore: boolean): boolean {
  return hasMore && latestRoundInputIndex(entries) < 0;
}

export type DisplayHistoryPage = {
  events: DshHistoryEntry[];
  hasMore: boolean;
};

/** Load and merge every display-history page, preserving the Host's page cursor. */
export async function loadCompleteDisplayHistory(
  loadPage: (beforeSeq?: number) => Promise<DisplayHistoryPage>,
  isCurrent: () => boolean = () => true,
): Promise<DshHistoryEntry[] | undefined> {
  let entries: DshHistoryEntry[] = [];
  let beforeSeq: number | undefined;
  while (isCurrent()) {
    const result = await loadPage(beforeSeq);
    if (!isCurrent()) return undefined;
    const page = compactDisplayHistory(result.events);
    entries = mergeDisplayHistory(entries, page);
    if (!result.hasMore) return entries;
    const nextBeforeSeq = displayHistoryStartSeq(page);
    if (nextBeforeSeq === undefined || nextBeforeSeq === beforeSeq) {
      throw new Error("Session history pagination stalled.");
    }
    beforeSeq = nextBeforeSeq;
  }
  return undefined;
}
