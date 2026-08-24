import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECTION_CACHE_MAX_SESSIONS,
  SessionProjectionCache,
  overlayProjections,
} from "./projection-cache.ts";

test("isolates projections per session (session switch never leaks)", () => {
  const cache = new SessionProjectionCache();
  cache.put("session-a", "plan", { active: true }, 10);
  cache.put("session-b", "plan", { active: false }, 3);

  assert.equal(cache.get("session-a", "plan").value.active, true);
  assert.equal(cache.get("session-b", "plan").value.active, false);
  assert.deepEqual(cache.snapshot("session-a").map((entry) => entry.key), ["plan"]);
  assert.equal(cache.get("missing", "plan"), undefined);
});

test("keeps only the latest seq per key and allows same-seq last-write", () => {
  const cache = new SessionProjectionCache();
  cache.put("session-a", "contextPressure", { pressureTokens: 100 }, 5);
  cache.put("session-a", "contextPressure", { pressureTokens: 200 }, 6);
  cache.put("session-a", "contextPressure", { pressureTokens: 150 }, 6);
  assert.equal(cache.get("session-a", "contextPressure").value.pressureTokens, 150);
  cache.put("session-a", "contextPressure", { pressureTokens: 300 }, 4);
  // 旧 seq 不得覆盖新值。
  assert.equal(cache.get("session-a", "contextPressure").value.pressureTokens, 150);
});

test("removes a session without touching others", () => {
  const cache = new SessionProjectionCache();
  cache.put("session-a", "plan", { active: true }, 1);
  cache.put("session-b", "plan", { active: true }, 1);
  cache.removeSession("session-a");
  assert.equal(cache.snapshot("session-a").length, 0);
  assert.equal(cache.snapshot("session-b").length, 1);
  cache.removeSession("session-a");
  assert.equal(cache.size, 1);
});

test("evicts the least recently touched session at the bound", () => {
  const cache = new SessionProjectionCache();
  for (let index = 0; index < PROJECTION_CACHE_MAX_SESSIONS + 2; index += 1) {
    cache.put(`session-${index}`, "plan", { active: true }, 1);
  }
  assert.equal(cache.size, PROJECTION_CACHE_MAX_SESSIONS);
  assert.equal(cache.get(`session-0`, "plan"), undefined);
  assert.equal(cache.get(`session-${PROJECTION_CACHE_MAX_SESSIONS + 1}`, "plan") !== undefined, true);
  assert.equal(cache.evictedSessions, 2);
});

test("overlay applies only cache entries newer than the history watermark", () => {
  const history = { plan: { active: true }, goal: null };
  const merged = overlayProjections(history, 100, [
    { key: "plan", value: { active: false }, seq: 90, receivedAt: 0 },
    { key: "goal", value: { goal: {} }, seq: 101, receivedAt: 0 },
    { key: "contextPressure", value: { pressureTokens: 10 }, seq: 102, receivedAt: 0 },
  ]);
  assert.deepEqual(merged.overlaid, ["goal", "contextPressure"]);
  assert.deepEqual(merged.values, {
    plan: { active: true },
    goal: { goal: {} },
    contextPressure: { pressureTokens: 10 },
  });
});

test("overlay without a watermark fills known-seq entries and never stomps history with unknown-seq", () => {
  const history = { plan: { active: true } };
  const merged = overlayProjections(history, undefined, [
    { key: "plan", value: { active: false }, seq: 0, receivedAt: 0 },
    { key: "goal", value: { goal: {} }, seq: 4, receivedAt: 0 },
  ]);
  assert.deepEqual(merged.values, {
    plan: { active: true },
    goal: { goal: {} },
  });
  assert.deepEqual(merged.overlaid, ["goal"]);
});
