import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionElapsed, sessionElapsedMs, turnTimingItems } from "./session-events.ts";

function event(seq, type, data = {}) {
  return { event: { seq, time: 1_700_000_000_000 + seq * 1000, type, data } };
}

test("sessionElapsedMs spans the first to the last event", () => {
  const entries = [
    event(1, "turn/start", { turn: 1 }),
    event(2, "user/message", { turn: 1, content: "hi" }),
    event(3, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  // event times: +1000 / +2000 / +3000
  assert.equal(sessionElapsedMs(entries), 2000);
});

test("sessionElapsedMs extends to now while the session is still running", () => {
  const entries = [event(1, "turn/start", { turn: 1 })];
  const now = 1_700_000_000_000 + 1000 + 12_000;
  assert.equal(sessionElapsedMs(entries, now), 12_000);
});

test("sessionElapsedMs falls back to the last event when now is stale or missing", () => {
  const entries = [
    event(1, "turn/start", { turn: 1 }),
    event(2, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  assert.equal(sessionElapsedMs(entries, 0), 1000);
  assert.equal(sessionElapsedMs(entries), 1000);
});

test("sessionElapsedMs returns 0 for empty or invalid histories", () => {
  assert.equal(sessionElapsedMs([], Date.now()), 0);
  assert.equal(sessionElapsedMs([{ event: { seq: 1, time: NaN, type: "x", data: {} } }]), 0);
});

test("formatSessionElapsed renders compact durations", () => {
  assert.equal(formatSessionElapsed(0), "0s");
  assert.equal(formatSessionElapsed(5_000), "5s");
  assert.equal(formatSessionElapsed(123_000), "2m 03s");
  assert.equal(formatSessionElapsed(3_900_000), "1h 05m");
});

test("turnTimingItems emits a round-timing row after each closed round", () => {
  const entries = [
    event(1, "turn/start", { turn: 1 }),
    event(2, "user/message", { turn: 1, content: "hi" }),
    event(3, "turn/end", { turn: 1, reason: { kind: "completed" } }),
    event(4, "turn/start", { turn: 2 }),
    event(5, "turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
  const items = turnTimingItems(entries);
  assert.equal(items.length, 2, "one timing row per completed round");
  // turn 1: start at +1000, end at +3000 => 2s; turn 2: +4000 -> +5000 => 1s
  assert.match(items[0].text, /第 1 轮 用时 2s/);
  assert.match(items[1].text, /第 2 轮 用时 1s/);
  assert.equal(items[0].kind, "system");
  assert.equal(items[0].label, "回合耗时");
  // keyed to sort right after its own turn/end seq
  assert.ok((items[0].seq ?? 0) > 3 && (items[0].seq ?? 0) < 4);
});

test("turnTimingItems keeps timing even when the round ends with an error", () => {
  const entries = [
    event(1, "turn/start", { turn: 2 }),
    event(2, "turn/end", { turn: 2, reason: { kind: "error", error: { message: "模型调用失败" } } }),
  ];
  const items = turnTimingItems(entries);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /第 2 轮 用时 1s/);
});

test("turnTimingItems skips rounds without a recorded turn/start", () => {
  const entries = [
    event(1, "user/message", { turn: 1, content: "hi" }),
    event(2, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  assert.deepEqual(turnTimingItems(entries), []);
});
