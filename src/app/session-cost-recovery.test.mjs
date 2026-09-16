import assert from "node:assert/strict";
import test from "node:test";
import { sessionCost } from "./session-cost.ts";
import { sessionDashboard } from "./session-dashboard.ts";

/**
 * 真实历史回归：跨模块验证 session-cost 与既有的看板投影口径一致。
 * 用固定的多轮会话样本（含并发失败、重试、重复命令），确保汇总数字彼此自洽，
 * 而不是只信任单个模块的内部断言。
 */

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

function entry(seq, type, data, time = 1_700_000_000_000 + seq * 1000) {
  return { event: { seq, time, type, data } };
}

function toolResult(seq, callId, text, { isError = false } = {}) {
  return entry(seq, "tool/result", {
    message: {
      source: { kind: "tool", callId },
      role: "user",
      content: [{ type: "tool-result", toolCallId: callId, isError, content: [{ type: "text", text }] }],
    },
  });
}

/** 一个真实的失败形态：并发限制掐断轮次，随后重试并重复跑同一条命令。 */
function sample() {
  const build = JSON.stringify({ command: "npm run build" });
  return [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "step/start", { turn: 1, step: 1 }),
    entry(3, "assistant/message", { turn: 1, step: 1, usage: { input_tokens: 1000, output_tokens: 200 } }),
    entry(4, "step/end", { turn: 1, step: 1 }),
    entry(5, "tool/call", { turn: 1, step: 1, callId: "b1", name: "pwsh", arguments: build }),
    toolResult(6, "b1", "build output ".repeat(20)),
    entry(7, "turn/end", { turn: 1, reason: { kind: "error", error: { message: "Concurrency limit exceeded for user" } } }),
    entry(8, "turn/start", { turn: 2 }),
    entry(9, "step/start", { turn: 2, step: 1 }),
    entry(10, "llm/retry", { turn: 2, step: 1, retry: 1, delayMs: 900, failure: { code: "RATE_LIMIT" } }),
    entry(11, "llm/retry-started", { turn: 2, step: 1, retry: 1 }),
    entry(12, "assistant/message", { turn: 2, step: 1, usage: { input_tokens: 1200, output_tokens: 150 } }),
    entry(13, "step/end", { turn: 2, step: 1 }),
    entry(14, "tool/call", { turn: 2, step: 1, callId: "b2", name: "pwsh", arguments: build }),
    toolResult(15, "b2", "build output ".repeat(20)),
    entry(16, "tool/call", { turn: 2, step: 1, callId: "e1", name: "edit", arguments: "{}" }),
    toolResult(17, "e1", "old_string was not found", { isError: true }),
    entry(18, "turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
}

test("cost totals stay internally consistent across turns and tools", () => {
  const entries = sample();
  const cost = sessionCost(entries);
  const totalSteps = cost.turns.reduce((n, turn) => n + turn.steps, 0);

  // 每个工具的调用/失败数之和等于会话汇总。
  assert.equal(cost.tools.reduce((n, tool) => n + tool.calls, 0), cost.toolCalls);
  assert.equal(cost.tools.reduce((n, tool) => n + tool.errors, 0), cost.toolFailures);
  assert.equal(cost.turns.reduce((n, turn) => n + turn.toolCalls, 0), cost.toolCalls);
  assert.equal(cost.turns.reduce((n, turn) => n + turn.toolFailures, 0), cost.toolFailures);
  // 失败轮次的浪费量不超过总量。
  assert.ok(cost.wastedSteps <= totalSteps);
  assert.ok(cost.wastedToolCalls <= cost.toolCalls);
  assert.ok(cost.wastedTurns <= cost.turns.length);
});

test("cost error rate agrees with the dashboard's tool-failure projection", () => {
  const entries = sample();
  const cost = sessionCost(entries);
  const dashboard = sessionDashboard(entries, stats(), "zh", {});
  // 两个模块必须对「工具失败」用同一判据（tool-result 的 isError），否则看板自相矛盾。
  assert.equal(cost.toolCalls, dashboard.summary.toolCalls);
  assert.equal(cost.toolFailures, dashboard.summary.toolFailures);
  assert.equal(cost.toolFailures, 1);
});

test("cost steps count started work, so they cover the dashboard's finished steps", () => {
  const entries = sample();
  const cost = sessionCost(entries);
  const dashboard = sessionDashboard(entries, stats(), "zh", {});
  const costSteps = cost.turns.reduce((n, turn) => n + turn.steps, 0);
  // 概览只数 step/end；成本视图数 step/start，因此必然不小于它。
  assert.ok(costSteps >= dashboard.summary.steps, `${costSteps} >= ${dashboard.summary.steps}`);
});

test("a concurrency-killed turn is reported as wasted with its real work", () => {
  const cost = sessionCost(sample());
  assert.equal(cost.wastedTurns, 1);
  const first = cost.turns.find((turn) => turn.turn === 1);
  assert.equal(first.outcome, "error");
  assert.equal(first.steps, 1);
  assert.equal(first.toolCalls, 1);
  assert.equal(cost.wastedSteps, 1);
  assert.equal(cost.wastedToolCalls, 1);
});

test("repeated build command is surfaced as rework, not as two distinct commands", () => {
  const cost = sessionCost(sample());
  assert.equal(cost.distinctCommands, 1);
  assert.equal(cost.repeatedCommands.length, 1);
  assert.equal(cost.repeatedCommands[0].command, "npm run build");
  assert.equal(cost.repeatedCommands[0].calls, 2);
});

test("retry is attributed to the turn that paid for it", () => {
  const cost = sessionCost(sample());
  assert.equal(cost.retries, 2);
  assert.equal(cost.retriedSteps, 1);
  const second = cost.turns.find((turn) => turn.turn === 2);
  assert.equal(second.retries, 2);
  const first = cost.turns.find((turn) => turn.turn === 1);
  assert.equal(first.retries, 0);
});
