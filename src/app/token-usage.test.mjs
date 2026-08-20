import assert from "node:assert/strict";
import test from "node:test";
import { readSessionStats } from "./message-model.ts";
import { tokenUsageDashboard } from "./token-usage.ts";

function entry(seq, type, data, time = 1_700_000_000_000 + seq * 1000) {
  return { event: { seq, time, type, data } };
}

function stats() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextTokens: 0,
    contextLimit: 0,
    cacheHitRate: 0,
    firstTokenMs: 0,
    messages: 0,
  };
}

test("reads detailed token buckets from projection and history usage", () => {
  const entries = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "text-delta", text: "hi" }, usage: { uncached_input_tokens: 120, cache_read: 80, cache_write: 10, output_tokens: 20, reasoning_tokens: 4 } }),
    entry(3, "assistant/message", { turn: 1, step: 1, message: { usage: { uncached_input_tokens: 120, cache_read: 80, cache_write: 10, output_tokens: 20, reasoning_tokens: 4 } } }),
  ];
  const result = readSessionStats(entries, { values: {} });
  assert.equal(result.inputTokens, 210);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.reasoningTokens, 4);
  assert.equal(result.uncachedInputTokens, 120);
  assert.equal(result.cacheReadTokens, 80);
  assert.equal(result.cacheWriteTokens, 10);
  assert.equal(Math.round(result.cacheHitRate), 38);
});

test("prefers session projection totals while keeping per-response chart points", () => {
  const entries = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "assistant/message", { turn: 1, step: 1, usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } }),
    entry(3, "step/start", { turn: 1, step: 2 }),
    entry(4, "assistant/message", { turn: 1, step: 2, usage: { input_tokens: 160, output_tokens: 60, total_tokens: 220 } }),
  ];
  const result = tokenUsageDashboard(entries, { ...stats(), tokenUsageAvailable: true, inputTokens: 260, outputTokens: 100, totalTokens: 360 });
  assert.equal(result.points.length, 2);
  assert.deepEqual(result.points.map((point) => point.label), ["T1 · S1", "T1 · S2"]);
  assert.equal(result.totals.inputTokens, 260);
  assert.equal(result.totals.outputTokens, 100);
  assert.equal(result.totals.totalTokens, 360);
});

test("maps generic cached input to reads without inflating writes", () => {
  const result = readSessionStats([], { values: { usage: { uncachedInputTokens: 12, cachedInputTokens: 8, outputTokens: 4 } } });
  assert.equal(result.cacheReadTokens, 8);
  assert.equal(result.cacheWriteTokens, 0);
  assert.equal(result.inputTokens, 20);
});

test("keeps usage points when responses have no turn-step coordinates", () => {
  const entries = [
    entry(1, "assistant/message", { usage: { input_tokens: 8, output_tokens: 3 } }),
    entry(2, "assistant/message", { usage: { input_tokens: 10, output_tokens: 5 } }),
  ];
  const result = tokenUsageDashboard(entries, { ...stats(), tokenUsageAvailable: true, inputTokens: 18, outputTokens: 8, totalTokens: 26 });
  assert.equal(result.points.length, 2);
  assert.deepEqual(result.points.map((point) => point.label), ["回应 1", "回应 2"]);
});

test("projection zeros replace older history totals", () => {
  const entries = [entry(1, "assistant/message", { usage: { input_tokens: 8, output_tokens: 3 } })];
  const result = readSessionStats(entries, { values: { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  assert.equal(result.tokenUsageSource, "projection");
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.cacheReadTokens, 0);
});

test("keeps reasoning as an output breakdown without inflating totals", () => {
  const entries = [entry(1, "assistant/message", { usage: { input_tokens: 5, output_tokens: 7, reasoning_tokens: 4 } })];
  const result = tokenUsageDashboard(entries, readSessionStats(entries, { values: {} }));
  assert.equal(result.points[0].reasoningTokens, 4);
  assert.equal(result.points[0].totalTokens, 12);
  assert.equal(result.totals.totalTokens, 12);
});

test("does not produce NaN cache rate when buckets are all zero", () => {
  const result = readSessionStats([], { values: { usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  assert.equal(result.cacheHitRate, 0);
  assert.ok(Number.isFinite(result.cacheHitRate));
});
