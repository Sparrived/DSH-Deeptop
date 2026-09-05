import assert from "node:assert/strict";
import test from "node:test";
import { readSessionStats } from "./message-model.ts";
import { sessionDashboard } from "./session-dashboard.ts";
import { mergeDisplayHistory } from "./display-history.ts";
import { tokenUsageDashboard, tokenUsageTotals } from "./token-usage.ts";

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
  assert.deepEqual(result.points.map((point) => point.label), ["第 1 轮 · 第 1 步", "第 1 轮 · 第 2 步"]);
  assert.equal(result.totals.inputTokens, 260);
  assert.equal(result.totals.outputTokens, 100);
  assert.equal(result.totals.totalTokens, 360);

  const english = tokenUsageDashboard(entries, { ...stats(), tokenUsageAvailable: true }, "en");
  assert.deepEqual(english.points.map((point) => point.label), ["T1 · S1", "T1 · S2"]);
});

test("maps generic cached input to reads without inflating writes", () => {
  const result = readSessionStats([], { values: { usage: { uncachedInputTokens: 12, cachedInputTokens: 8, outputTokens: 4 } } });
  assert.equal(result.cacheReadTokens, 8);
  assert.equal(result.cacheWriteTokens, 0);
  assert.equal(result.inputTokens, 20);
});

test("caps per-message cache rate at the disjoint input total", () => {
  const entries = [entry(1, "assistant/message", { usage: { inputTokens: 10, outputTokens: 8, cacheReadTokens: 90, cacheWriteTokens: 0 } })];
  const result = tokenUsageDashboard(entries, readSessionStats(entries, { values: {} }));
  assert.equal(result.points[0].inputTokens, 100);
  assert.equal(result.points[0].uncachedInputTokens, 10);
  assert.equal(result.points[0].cacheReadTokens, 90);
  assert.equal(result.points[0].cacheHitRate, 90);
  assert.equal(result.points[0].totalTokens, 108);
  assert.equal(result.totals.cacheHitRate, 90);
});

test("treats generic total input as the cache denominator without double counting", () => {
  const entries = [entry(1, "assistant/message", { usage: { input_tokens: 100, output_tokens: 8, cache_read: 40 } })];
  const result = tokenUsageDashboard(entries, readSessionStats(entries, { values: {} }));
  assert.equal(result.points[0].inputTokens, 100);
  assert.equal(result.points[0].cacheHitRate, 40);
  assert.equal(result.points[0].totalTokens, 108);
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

test("does not use cumulative usage as current context", () => {
  const entries = [
    entry(1, "assistant/message", { usage: { input_tokens: 100, output_tokens: 20 } }),
    entry(2, "assistant/message", { usage: { input_tokens: 200, output_tokens: 30 } }),
  ];
  const result = readSessionStats(entries, { values: {} });
  assert.equal(result.totalTokens, 350);
  assert.equal(result.contextTokens, 0);
  assert.equal(result.contextTokensAvailable, false);
});

test("uses context pressure independently from cumulative token usage", () => {
  const result = readSessionStats([], {
    values: {
      usage: { inputTokens: 900, outputTokens: 100 },
      contextPressure: { pressureTokens: 180, projectedTokens: 125, contextWindow: 128_000 },
    },
  });
  assert.equal(result.totalTokens, 1000);
  assert.equal(result.contextTokens, 125);
  assert.equal(result.contextTokensAvailable, true);
  assert.equal(result.contextLimit, 128_000);
});

test("falls back to pressure tokens without adding output", () => {
  const result = readSessionStats([], {
    values: {
      usage: { inputTokens: 900, outputTokens: 100 },
      contextPressure: { pressureTokens: 180 },
    },
  });
  assert.equal(result.contextTokens, 180);
  assert.notEqual(result.contextTokens, result.totalTokens);
  assert.equal(result.contextTokensAvailable, true);
});

test("keeps reasoning as an output breakdown without inflating totals", () => {
  const entries = [entry(1, "assistant/message", { usage: { input_tokens: 5, output_tokens: 7, reasoning_tokens: 4 } })];
  const result = tokenUsageDashboard(entries, readSessionStats(entries, { values: {} }));
  assert.equal(result.points[0].reasoningTokens, 4);
  assert.equal(result.points[0].totalTokens, 12);
  assert.equal(result.totals.totalTokens, 12);
});

test("keeps history reasoning when the tokenUsage projection omits it", () => {
  const entries = [entry(1, "assistant/message", { usage: { input_tokens: 8, output_tokens: 12, reasoning_tokens: 7 } })];
  const result = readSessionStats(entries, {
    values: { tokenUsage: { uncachedInputTokens: 8, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  });
  assert.equal(result.tokenUsageSource, "projection");
  assert.equal(result.reasoningTokens, 7);
  assert.equal(result.outputTokens, 12);
});

test("does not produce NaN cache rate when buckets are all zero", () => {
  const result = readSessionStats([], { values: { usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  assert.equal(result.cacheHitRate, 0);
  assert.ok(Number.isFinite(result.cacheHitRate));
});

test("recomputes totals for a recent sub-range of response points", () => {
  const entries = [
    entry(1, "assistant/message", { usage: { input_tokens: 100, output_tokens: 40 } }),
    entry(2, "assistant/message", { usage: { input_tokens: 160, output_tokens: 60 } }),
    entry(3, "assistant/message", { usage: { input_tokens: 50, output_tokens: 30 } }),
  ];
  const dashboard = tokenUsageDashboard(entries, stats());
  assert.equal(dashboard.points.length, 3);
  const recent = tokenUsageTotals(dashboard.points.slice(-2));
  assert.equal(recent.inputTokens, 210);
  assert.equal(recent.outputTokens, 90);
  assert.equal(recent.totalTokens, 300);
});

test("aggregates session lifecycle, activity, tools, and tokens by turn", () => {
  const entries = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "user/message", { turn: 1, content: "hello", source: { kind: "user" } }),
    entry(3, "step/start", { turn: 1, step: 1 }),
    entry(4, "tool/call", { turn: 1, step: 1, callId: "call-1", name: "read" }),
    entry(5, "tool/result", { turn: 1, step: 1, message: { source: { callId: "call-1" }, content: "done" } }),
    entry(6, "assistant/message", { turn: 1, step: 1, usage: { input_tokens: 80, output_tokens: 20 } }),
    entry(7, "step/end", { turn: 1, step: 1 }),
    entry(8, "turn/end", { turn: 1, reason: { kind: "completed" } }),
    entry(9, "turn/start", { turn: 2 }),
    entry(10, "user/message", { turn: 2, content: "retry", source: { kind: "user" } }),
    entry(11, "tool/call", { turn: 2, step: 1, callId: "call-2", name: "write" }),
    entry(12, "tool/result", { turn: 2, step: 1, result: { status: "failed", error: "denied" } }),
    entry(13, "assistant/message", { turn: 2, step: 1, usage: { input_tokens: 120, output_tokens: 30 } }),
    entry(14, "step/end", { turn: 2, step: 1 }),
    entry(15, "turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
  const dashboard = sessionDashboard(entries, {
    ...stats(),
    tokenUsageAvailable: true,
    inputTokens: 200,
    outputTokens: 50,
    totalTokens: 250,
    turns: 2,
    steps: 2,
  });

  assert.deepEqual(dashboard.summary, {
    eventCount: 15,
    userMessages: 2,
    assistantMessages: 2,
    messages: 4,
    turns: 2,
    steps: 2,
    toolCalls: 2,
    toolResults: 2,
    toolFailures: 1,
    firstEventTime: 1_700_000_001_000,
    lastEventTime: 1_700_000_015_000,
    elapsedMs: 14_000,
  });
  assert.equal(dashboard.token.totals.totalTokens, 250);
  assert.deepEqual(dashboard.turns.map((turn) => ({
    label: turn.label,
    durationMs: turn.durationMs,
    totalTokens: turn.totalTokens,
    signals: turn.signals,
  })), [
    { label: "第 1 轮", durationMs: 7_000, totalTokens: 100, signals: ["user", "tool", "assistant"] },
    { label: "第 2 轮", durationMs: 6_000, totalTokens: 150, signals: ["user", "tool", "error", "assistant"] },
  ]);
});

test("aggregates dashboard metrics across paged session history", () => {
  const pages = [
    [
      entry(11, "turn/start", { turn: 3 }),
      entry(12, "user/message", { turn: 3, content: "third", source: { kind: "user" } }),
      entry(13, "tool/call", { turn: 3, step: 1, name: "read" }),
      entry(14, "assistant/message", { turn: 3, step: 1, usage: { input_tokens: 30, output_tokens: 3 } }),
      entry(15, "turn/end", { turn: 3 }),
    ],
    [
      entry(6, "turn/start", { turn: 2 }),
      entry(7, "user/message", { turn: 2, content: "second", source: { kind: "user" } }),
      entry(8, "tool/call", { turn: 2, step: 1, name: "read" }),
      entry(9, "assistant/message", { turn: 2, step: 1, usage: { input_tokens: 20, output_tokens: 2 } }),
      entry(10, "turn/end", { turn: 2 }),
    ],
    [
      entry(1, "turn/start", { turn: 1 }),
      entry(2, "user/message", { turn: 1, content: "first", source: { kind: "user" } }),
      entry(3, "tool/call", { turn: 1, step: 1, name: "read" }),
      entry(4, "assistant/message", { turn: 1, step: 1, usage: { input_tokens: 10, output_tokens: 1 } }),
      entry(5, "turn/end", { turn: 1 }),
    ],
  ];
  const complete = pages.reduce((history, page) => mergeDisplayHistory(history, page), []);
  const dashboard = sessionDashboard(complete, stats());

  assert.equal(dashboard.summary.eventCount, 15);
  assert.equal(dashboard.summary.messages, 6);
  assert.equal(dashboard.summary.toolCalls, 3);
  assert.equal(dashboard.summary.turns, 3);
  assert.equal(dashboard.summary.elapsedMs, 14_000);
  assert.equal(dashboard.token.points.length, 3);
  assert.equal(dashboard.token.totals.totalTokens, 66);
  assert.deepEqual(dashboard.turns.map((turn) => turn.turn), [1, 2, 3]);
});

test("keeps injected context out of human message aggregates", () => {
  const entries = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "user/message", { turn: 1, content: "instructions", source: { kind: "plugin" } }),
    entry(3, "user/message", { turn: 1, content: "hello", source: { kind: "user" } }),
    entry(4, "assistant/message", { turn: 1, usage: { input_tokens: 5, output_tokens: 2 } }),
  ];
  const dashboard = sessionDashboard(entries, stats(), "en", { elapsedMs: 42_000 });
  assert.equal(dashboard.summary.userMessages, 1);
  assert.equal(dashboard.summary.messages, 2);
  assert.equal(dashboard.summary.elapsedMs, 42_000);
  assert.equal(dashboard.turns[0].label, "Turn 1");
  assert.deepEqual(dashboard.turns[0].signals, ["user", "assistant"]);
});

test("extends the current turn duration while the session is running", () => {
  const entries = [
    entry(1, "turn/start", { turn: 3 }),
    entry(2, "user/message", { turn: 3, content: "hello", source: { kind: "user" } }),
  ];
  const now = 1_700_000_001_000 + 9_000;
  const dashboard = sessionDashboard(entries, stats(), "zh", { running: true, now });
  assert.equal(dashboard.turns[0].durationMs, 9_000);
  assert.equal(dashboard.summary.elapsedMs, 9_000);
});
