import type { DshHistoryEntry } from "../lib/desktop";
import {
  compactHistoryEntries as compactDisplayHistory,
  displayHistoryEventCount as displayEventCount,
  displayHistoryStartSequence as displayHistoryStartSeq,
  mergeHistoryEntries as mergeDisplayHistory,
} from "../../cordis/desktop-bridge/display-history.mjs";

export {
  compactDisplayHistory,
  displayEventCount,
  displayHistoryStartSeq,
  mergeDisplayHistory,
};

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
