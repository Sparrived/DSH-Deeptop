import assert from "node:assert/strict";
import test from "node:test";
import { sessionCost } from "./session-cost.ts";

function entry(seq, type, data, time = 1_700_000_000_000 + seq * 1000) {
  return { event: { seq, time, type, data } };
}

/** A `tool/result` envelope shaped like the durable one the bridge delivers. */
function toolResult(seq, callId, text, { isError = false, time } = {}) {
  return entry(seq, "tool/result", {
    message: {
      source: { kind: "tool", callId },
      role: "user",
      content: [{ type: "tool-result", toolCallId: callId, isError, content: [{ type: "text", text }] }],
    },
  }, time);
}

test("aggregates per-tool calls, failures and error rate", () => {
  const entries = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, callId: "a", name: "read", arguments: "{}" }),
    toolResult(3, "a", "file body"),
    entry(4, "tool/call", { turn: 1, step: 2, callId: "b", name: "edit", arguments: "{}" }),
    toolResult(5, "b", "Error: old_string was not found", { isError: true }),
    entry(6, "tool/call", { turn: 1, step: 3, callId: "c", name: "edit", arguments: "{}" }),
    toolResult(7, "c", "ok"),
    entry(8, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  const cost = sessionCost(entries);
  assert.equal(cost.toolCalls, 3);
  assert.equal(cost.toolFailures, 1);
  assert.equal(Math.round(cost.toolErrorRate), 33);

  const edit = cost.tools.find((tool) => tool.name === "edit");
  assert.equal(edit.calls, 2);
  assert.equal(edit.errors, 1);
  assert.equal(edit.errorRate, 50);
  const read = cost.tools.find((tool) => tool.name === "read");
  assert.equal(read.calls, 1);
  assert.equal(read.errors, 0);
});

test("counts payload volume from tool result text", () => {
  const body = "x".repeat(500);
  const cost = sessionCost([
    entry(1, "tool/call", { turn: 1, step: 1, callId: "a", name: "read", arguments: "{}" }),
    toolResult(2, "a", body),
  ]);
  assert.equal(cost.resultChars, 500);
  assert.equal(cost.tools[0].resultChars, 500);
});

test("pairs a call with its result to measure per-tool duration", () => {
  const cost = sessionCost([
    entry(1, "tool/call", { turn: 1, step: 1, callId: "a", name: "pwsh", arguments: "{}" }, 1000),
    toolResult(2, "a", "done", { time: 2500 }),
  ]);
  assert.equal(cost.tools[0].durationMs, 1500);
});

test("accumulates duration per tool and prefers a recorded duration over pairing", () => {
  const cost = sessionCost([
    entry(1, "tool/call", { turn: 1, step: 1, callId: "a", name: "read", arguments: "{}" }, 0),
    toolResult(2, "a", "one", { time: 400 }),
    entry(3, "tool/call", { turn: 1, step: 2, callId: "b", name: "read", arguments: "{}" }, 1000),
    toolResult(4, "b", "two", { time: 1600 }),
    // Host-recorded duration wins over the call/result timestamp delta (3100 - 2000 = 1100).
    entry(5, "tool/call", { turn: 1, step: 3, callId: "c", name: "pwsh", arguments: "{}" }, 2000),
    entry(6, "tool/result", {
      message: {
        source: { kind: "tool", callId: "c" },
        role: "user",
        content: [{ type: "tool-result", toolCallId: "c", isError: false, content: [{ type: "text", text: "three" }] }],
      },
      meta: { durationMs: 250 },
    }, 3100),
  ]);
  const read = cost.tools.find((tool) => tool.name === "read");
  assert.equal(read.durationMs, 1000);
  const pwsh = cost.tools.find((tool) => tool.name === "pwsh");
  assert.equal(pwsh.durationMs, 250);
});

test("treats error turns as wasted work and sums their steps and calls", () => {
  const entries = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "step/start", { turn: 1, step: 1 }),
    entry(3, "step/end", { turn: 1, step: 1 }),
    entry(4, "tool/call", { turn: 1, step: 1, callId: "a", name: "read", arguments: "{}" }),
    toolResult(5, "a", "ok"),
    entry(6, "turn/end", { turn: 1, reason: { kind: "error", error: { message: "Concurrency limit exceeded" } } }),
    entry(7, "turn/start", { turn: 2 }),
    entry(8, "step/start", { turn: 2, step: 1 }),
    entry(9, "step/end", { turn: 2, step: 1 }),
    entry(10, "turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
  const cost = sessionCost(entries);
  assert.equal(cost.turns.length, 2);
  assert.equal(cost.wastedTurns, 1);
  assert.equal(cost.wastedSteps, 1);
  assert.equal(cost.wastedToolCalls, 1);
  assert.deepEqual(cost.turns.map((turn) => turn.outcome), ["error", "completed"]);
});

test("maps every durable turn reason kind onto a cost outcome", () => {
  const kinds = [
    ["completed", "completed"],
    ["aborted", "cancelled"],
    ["error", "error"],
    ["interrupted", "interrupted"],
    ["max-tokens", "max-tokens"],
    ["blocked", "blocked"],
    ["something-new", "completed"],
  ];
  for (const [kind, expected] of kinds) {
    const cost = sessionCost([
      entry(1, "turn/start", { turn: 1 }),
      entry(2, "turn/end", { turn: 1, reason: { kind } }),
    ]);
    assert.equal(cost.turns[0].outcome, expected, `reason kind ${kind}`);
  }
});

test("counts retries and distinct retried steps", () => {
  const entries = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "llm/retry-started", { turn: 1, step: 1, retryId: "r1" }),
    entry(3, "llm/retry", { turn: 1, step: 1, retry: 1, delayMs: 500, failure: { code: "RATE_LIMIT" } }),
    entry(4, "llm/retry", { turn: 1, step: 1, retry: 2, delayMs: 900, failure: { code: "RATE_LIMIT" } }),
    entry(5, "llm/retry", { turn: 1, step: 2, retry: 1, delayMs: 100, failure: { code: "SERVER" } }),
  ];
  const cost = sessionCost(entries);
  assert.equal(cost.retries, 4);
  // Two retries on 1/1 count once; the retry on 1/2 adds a second step.
  assert.equal(cost.retriedSteps, 2);
  assert.equal(cost.turns[0].retries, 4);
});

test("detects repeated shell commands but ignores non-shell tools", () => {
  const args = (command) => JSON.stringify({ command });
  const entries = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, callId: "a", name: "pwsh", arguments: args("npm run build") }),
    entry(3, "tool/call", { turn: 1, step: 2, callId: "b", name: "pwsh", arguments: args("npm   run build") }),
    entry(4, "tool/call", { turn: 1, step: 3, callId: "c", name: "pwsh", arguments: args("npm test") }),
    entry(5, "tool/call", { turn: 1, step: 4, callId: "d", name: "read", arguments: JSON.stringify({ file_path: "a.ts" }) }),
    entry(6, "tool/call", { turn: 1, step: 5, callId: "e", name: "read", arguments: JSON.stringify({ file_path: "a.ts" }) }),
  ];
  const cost = sessionCost(entries);
  // Whitespace-normalized duplicates collapse; distinct commands both stay.
  assert.equal(cost.distinctCommands, 2);
  assert.equal(cost.repeatedCommandCalls, 2);
  const build = cost.repeatedCommands.find((row) => row.command === "npm run build");
  assert.equal(build.calls, 2);
  assert.equal(cost.repeatedCommands.length, 1);
  assert.equal(Math.round(cost.repeatedCommandRate), 50);
});

test("reads shell commands from shellCommand and terminal_ tools too", () => {
  const cost = sessionCost([
    entry(1, "tool/call", { turn: 1, step: 1, callId: "a", name: "bash", arguments: JSON.stringify({ shellCommand: "ls" }) }),
    entry(2, "tool/call", { turn: 1, step: 2, callId: "b", name: "terminal_run", arguments: JSON.stringify({ command: "ls" }) }),
  ]);
  assert.equal(cost.distinctCommands, 1);
  assert.equal(cost.repeatedCommands[0].calls, 2);
});

test("returns zeroed rates for an empty or tool-free session", () => {
  const empty = sessionCost([]);
  assert.equal(empty.toolCalls, 0);
  assert.equal(empty.toolErrorRate, 0);
  assert.equal(empty.repeatedCommandRate, 0);
  assert.deepEqual(empty.tools, []);
  assert.deepEqual(empty.turns, []);

  const noTools = sessionCost([
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "step/start", { turn: 1, step: 1 }),
    entry(3, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ]);
  assert.equal(noTools.toolErrorRate, 0);
  assert.equal(noTools.turns[0].steps, 1);
});

test("orders entries by seq so cost is independent of delivery order", () => {
  const ordered = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, callId: "a", name: "read", arguments: "{}" }, 1000),
    toolResult(3, "a", "ok", { time: 2000 }),
  ];
  const shuffled = [ordered[2], ordered[0], ordered[1]];
  assert.deepEqual(sessionCost(shuffled), sessionCost(ordered));
});

test("ignores injected context messages when counting turns", () => {
  const cost = sessionCost([
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "user/message", { content: [{ type: "text", text: "上下文" }], source: { kind: "instructions" } }),
    entry(3, "step/start", { turn: 1, step: 1 }),
    entry(4, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ]);
  assert.equal(cost.turns.length, 1);
  assert.equal(cost.turns[0].steps, 1);
});

test("derives per-turn duration from turn/start to turn/end", () => {
  const cost = sessionCost([
    entry(1, "turn/start", { turn: 1 }, 1000),
    entry(2, "turn/end", { turn: 1, reason: { kind: "completed" } }, 6000),
  ]);
  assert.equal(cost.turns[0].durationMs, 5000);
});

test("leaves a turn open when no turn/end arrived yet", () => {
  const cost = sessionCost([
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "step/start", { turn: 1, step: 1 }),
  ]);
  assert.equal(cost.turns[0].outcome, "open");
  assert.equal(cost.wastedTurns, 0);
});
