import assert from "node:assert/strict";
import test from "node:test";
import { buildTrajectoryRecords } from "./trajectory.ts";

function event(seq, type, data = {}, extra = {}) {
  return { event: { seq, time: 1_700_000_000_000 + seq * 1000, type, data }, ...extra };
}

function history() {
  const longText = "字".repeat(5000);
  return [
    event(1, "turn/start", { turn: 1 }),
    event(2, "user/message", { turn: 1, content: "你好，请检查这个文件。", source: { kind: "user" } }),
    event(3, "step/start", { turn: 1, step: 1 }),
    // A stream of many small text deltas — the hot path that used to
    // re-pretty-print the whole accumulated text on every chunk.
    ...Array.from({ length: 400 }, (_, index) =>
      event(4 + index, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "片段" } })),
    event(404, "assistant/message", {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [{ type: "text", text: longText }] },
      usage: { inputTokens: 100, outputTokens: 500 },
    }),
    event(405, "step/end", { turn: 1, step: 1 }),
    event(406, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
}

test("running assistant record stays lightweight while streaming", () => {
  const entries = [
    event(1, "turn/start", { turn: 1 }),
    event(2, "step/start", { turn: 1, step: 1 }),
    ...Array.from({ length: 50 }, (_, index) =>
      event(3 + index, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "片段" } })),
  ];
  const records = buildTrajectoryRecords(entries);
  const running = records.find((record) => record.kind === "assistant");
  assert.ok(running, "a running assistant record is projected from chunks");
  assert.equal(running.status, "running");
  // The running record must not embed the full accumulated text in its detail
  // string (that was the O(total^2) re-pretty hot path).
  assert.match(running.detail, /流式生成中/);
  assert.ok(running.summary.length <= 300, `running summary should be a short tail, got ${running.summary.length}`);
});

test("finalized assistant record keeps full detail and usage", () => {
  const records = buildTrajectoryRecords(history());
  const assistant = records.find((record) => record.kind === "assistant");
  assert.ok(assistant);
  assert.equal(assistant.status, "complete");
  assert.ok(assistant.detail.includes("字".repeat(100)), "final detail retains the full assistant text");
  assert.ok(assistant.summary.includes("输出 500"), "final summary includes usage");
});

test("records are ordered by event seq and turn grouping is stable", () => {
  const records = buildTrajectoryRecords(history());
  const seqs = records.map((record) => record.seq);
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right));
  assert.equal(records.filter((record) => record.kind === "assistant").length, 1);
  assert.equal(records.filter((record) => record.kind === "user").length, 1);
  assert.ok(records.some((record) => record.kind === "turn"));
});

test("tool result patches the original tool call record", () => {
  const entries = [
    event(1, "turn/start", { turn: 1 }),
    event(2, "tool/call", { turn: 1, callId: "call-1", name: "read", arguments: { path: "a.txt" } }),
    event(3, "tool/result", {
      turn: 1,
      callId: "call-1",
      name: "read",
      content: [{ type: "tool-result", toolCallId: "call-1", content: "文件内容" }],
    }, { view: { kind: "file", path: "a.txt", content: "x".repeat(2000) } }),
    event(4, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  const records = buildTrajectoryRecords(entries);
  const tools = records.filter((record) => record.kind === "tool");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].status, "complete");
  assert.equal(tools[0].resultText, "文件内容");
  assert.ok(tools[0].detail.includes("呈现视图"), "tool detail keeps the view snapshot");
});
