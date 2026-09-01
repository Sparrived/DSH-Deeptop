import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryPageCache, historyPageKey, ownsHistoryView } from "./history-page-cache.ts";

function entry(seq) {
  return { event: { seq, time: 1000 + seq, type: "user/message", data: {} } };
}

test("rejects stale history owners across session switches and ABA cycles", () => {
  const owner = { sessionId: "A", generation: 1 };
  assert.equal(ownsHistoryView(owner, "A", 1), true);
  assert.equal(ownsHistoryView(owner, "B", 2), false);
  assert.equal(ownsHistoryView(owner, "A", 3), false);
});

test("caches pages per session and returns them by beforeSeq", () => {
  const cache = createHistoryPageCache();
  cache.put("s1", 100, [entry(90), entry(95)], true);
  cache.put("s1", 50, [entry(40), entry(45)], false);
  cache.put("s2", 100, [entry(91)], true);
  assert.equal(cache.get("s1", 100).entries.length, 2);
  assert.equal(cache.get("s1", 100).hasMore, true);
  assert.equal(cache.get("s1", 50).entries[0].event.seq, 40);
  assert.equal(cache.get("s1", 50).hasMore, false);
  // Sessions are isolated.
  assert.equal(cache.get("s2", 100).entries[0].event.seq, 91);
  assert.equal(cache.get("s1", 999), undefined);
});

test("marks in-flight loads to avoid duplicate requests", () => {
  const cache = createHistoryPageCache();
  assert.equal(cache.markLoading("s1", 100), true);
  assert.equal(cache.markLoading("s1", 100), false);
  assert.equal(cache.isLoading("s1", 100), true);
  cache.unmarkLoading("s1", 100);
  assert.equal(cache.isLoading("s1", 100), false);
  assert.equal(cache.markLoading("s1", 100), true);
});

test("removes a session's pages and loading marks", () => {
  const cache = createHistoryPageCache();
  cache.put("s1", 100, [entry(90)], true);
  cache.put("s2", 100, [entry(91)], true);
  cache.markLoading("s1", 50);
  cache.removeSession("s1");
  assert.equal(cache.get("s1", 100), undefined);
  assert.equal(cache.isLoading("s1", 50), false);
  assert.equal(cache.get("s2", 100).entries.length, 1);
});

test("evicts the oldest page per session beyond the cap", () => {
  const cache = createHistoryPageCache({ maxPagesPerSession: 2 });
  const keys = [100, 50, 10];
  for (const beforeSeq of keys) cache.put("s1", beforeSeq, [entry(beforeSeq - 1)], true);
  assert.equal(cache.get("s1", 100), undefined, "oldest page should be evicted");
  assert.equal(cache.get("s1", 50).entries.length, 1);
  assert.equal(cache.get("s1", 10).entries.length, 1);
  assert.equal(cache.stats().pages, 2);
});

test("evicts the oldest page across sessions at the global bound", () => {
  const cache = createHistoryPageCache({ maxPagesPerSession: 10, maxTotalPages: 2 });
  cache.put("s1", 100, [entry(90)], true);
  cache.put("s2", 100, [entry(91)], true);
  cache.put("s1", 50, [entry(40)], true);
  assert.equal(cache.get("s1", 100), undefined, "oldest global page should be evicted");
  assert.equal(cache.get("s2", 100).entries[0].event.seq, 91);
  assert.equal(cache.get("s1", 50).entries[0].event.seq, 40);
  assert.deepEqual(cache.stats(), { sessions: 2, pages: 2 });
});

test("key format round-trips", () => {
  assert.equal(historyPageKey("s1", 42), "s1\u000042");
});