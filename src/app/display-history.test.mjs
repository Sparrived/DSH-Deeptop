import assert from "node:assert/strict";
import test from "node:test";
import {
  compactHistoryEntries,
  compactLiveEventFrames,
  displayHistoryEventCount,
  displayHistoryStartSequence,
  mergeHistoryEntries,
} from "../../cordis/desktop-bridge/display-history.mjs";
import {
  compactDisplayHistory,
  displayEventCount,
  displayHistoryStartSeq,
  isRoundInput,
  latestRoundInputIndex,
  loadCompleteDisplayHistory,
  mergeDisplayHistory,
  needsNewestRoundFill,
} from "./display-history.ts";
import { transcriptFromHistory } from "./conversation-model.ts";
import { assistantMessageStats } from "./message-model.ts";
import { buildTrajectoryRecords } from "./trajectory.ts";

function entry(seq, type, data = {}, extra = {}) {
  return { event: { seq, time: 1_000 + seq * 10, type, data, ...extra } };
}

function chunk(seq, text, type = "text-delta", index = 0) {
  return entry(seq, "assistant/chunk", {
    turn: 1,
    step: 1,
    chunk: { type, index, text },
  });
}

function finalMessage(seq, text) {
  return entry(seq, "assistant/message", {
    turn: 1,
    step: 1,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { inputTokens: 10, outputTokens: 20 },
    },
  });
}

test("shares one display-history implementation between Bridge and React", () => {
  assert.equal(compactDisplayHistory, compactHistoryEntries);
  assert.equal(mergeDisplayHistory, mergeHistoryEntries);
  assert.equal(displayEventCount, displayHistoryEventCount);
  assert.equal(displayHistoryStartSeq, displayHistoryStartSequence);
});

test("recognizes the row that carries a round input", () => {
  assert.equal(isRoundInput(entry(1, "turn/start", { turn: 1 })), true);
  assert.equal(isRoundInput(entry(2, "user/message", { content: [{ type: "text", text: "hi" }] })), true);
  assert.equal(isRoundInput(entry(3, "user/message", { content: [{ type: "text", text: "hi" }], source: { kind: "user" } })), true);

  // Injected context is not a round input, even though it is a user/message.
  assert.equal(isRoundInput(entry(4, "user/message", { content: [{ type: "text", text: "ctx" }], source: { kind: "plugin" } })), false);
  assert.equal(isRoundInput(entry(5, "assistant/message", { message: { content: [{ type: "text", text: "ok" }] } })), false);
  assert.equal(isRoundInput(entry(6, "tool/call", { turn: 1, step: 1, name: "read" })), false);
  assert.equal(isRoundInput(undefined), false);
});

test("finds the newest round input in a paged window", () => {
  // A window that starts mid-round: the previous round's input is in the middle.
  const window = [
    entry(10, "assistant/message", { message: { content: [{ type: "text", text: "older answer" }] } }),
    entry(20, "user/message", { content: [{ type: "text", text: "previous prompt" }] }),
    entry(21, "user/message", { content: [{ type: "text", text: "injected" }], source: { kind: "agent-instructions" } }),
    entry(30, "tool/call", { turn: 2, step: 1, name: "read" }),
  ];
  assert.equal(latestRoundInputIndex(window), 1);
  assert.equal(latestRoundInputIndex([entry(40, "tool/result", { turn: 2, step: 1 })]), -1);
  assert.equal(latestRoundInputIndex([]), -1);
});

test("loads complete display history from paged tail responses", async () => {
  const requested = [];
  const pages = [
    { events: [entry(4, "user/message"), entry(5, "assistant/message")], hasMore: true },
    { events: [entry(1, "turn/start"), entry(2, "user/message"), entry(3, "turn/end")], hasMore: false },
  ];
  const history = await loadCompleteDisplayHistory(async (beforeSeq) => {
    requested.push(beforeSeq);
    return pages.shift();
  });

  assert.deepEqual(requested, [undefined, 4]);
  assert.deepEqual(history.map((item) => item.event.seq), [1, 2, 3, 4, 5]);
});

test("rejects a stalled complete-history cursor", async () => {
  await assert.rejects(
    loadCompleteDisplayHistory(async () => ({ events: [], hasMore: true })),
    /pagination stalled/,
  );
});

test("opening a session keeps paging while the newest round has no input row", () => {
  // The latest page starts mid-round: nothing shows who asked for what.
  const midRound = [
    entry(300, "assistant/message", { message: { content: [{ type: "tool-call" }] } }),
    entry(301, "tool/result", { turn: 3, step: 9 }),
  ];
  assert.equal(needsNewestRoundFill(midRound, true), true);
  // Injected context is not a round input either.
  assert.equal(needsNewestRoundFill([entry(302, "user/message", { content: [{ type: "text", text: "ctx" }], source: { kind: "plugin" } })], true), true);
  // Once the prompt (or the turn start) is inside the window the round is whole.
  assert.equal(needsNewestRoundFill([entry(10, "user/message", { content: [{ type: "text", text: "hi" }] }), ...midRound], true), false);
  assert.equal(needsNewestRoundFill([entry(9, "turn/start", { turn: 3 }), ...midRound], true), false);
  // Nothing older left to fetch: the window is short, not truncated.
  assert.equal(needsNewestRoundFill(midRound, false), false);
});

test("batches round-fill pages into one window equal to sequential merges", () => {
  // openSession 切换会话时把补齐的旧页攒齐后只提交一次，避免每页重排一次视口。
  // 前提：一次并入多页与逐页并入结果一致，且重复并入已在窗口里的缓存页是空操作。
  const newest = [entry(300, "user/message", { content: [{ type: "text", text: "prompt" }] }), entry(301, "tool/result", { turn: 3, step: 9 })];
  const older = [entry(200, "turn/start", { turn: 3 }), entry(201, "tool/call", { turn: 3, step: 1, name: "read" })];
  const oldest = [entry(100, "user/message", { content: [{ type: "text", text: "first" }] })];

  const sequential = mergeHistoryEntries(mergeHistoryEntries(newest, older), oldest);
  const batched = mergeHistoryEntries(newest, [...older, ...oldest]);
  // 逐页合并会给中间结果打上分页起点标记，一次并入不会留下这些中间标记；
  // 标记只参与「最早顺序号」的取最小，所以真正要守住的是派生结果一致。
  assert.deepEqual(batched.map((item) => item.event.seq), sequential.map((item) => item.event.seq));
  assert.equal(displayHistoryStartSequence(batched), displayHistoryStartSequence(sequential));
  assert.equal(displayHistoryEventCount(batched), displayHistoryEventCount(sequential));

  // 缓存命中时窗口已由同一批缓存数组拼成，重新并入必须原样返回同一引用。
  assert.equal(mergeHistoryEntries(batched, [...older, ...oldest]), batched);
  assert.equal(mergeHistoryEntries(batched, batched), batched);
});

test("folds a large active stream into one lossless display delta", () => {
  const chunks = Array.from({ length: 25_000 }, (_, index) => chunk(index + 2, String(index % 10)));
  const compacted = compactHistoryEntries([
    entry(1, "step/start", { turn: 1, step: 1 }),
    ...chunks,
  ]);
  const deltas = compacted.filter(item => item.event.type === "assistant/chunk");

  assert.equal(compacted.length, 2);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].event.data.chunk.text, chunks.map(item => item.event.data.chunk.text).join(""));
  assert.deepEqual(deltas[0].compactedEventSeqRanges, [[2, 25_001]]);
  assert.equal(displayHistoryEventCount(compacted), 25_001);
  assert.equal(displayHistoryStartSequence(compacted), 1);
});

test("incrementally folds transport batches without copying full length metadata", () => {
  let history = [];
  const total = 25_000;
  for (let start = 1; start <= total; start += 16) {
    const frames = Array.from({ length: Math.min(16, total - start + 1) }, (_, offset) => ({
      rpcId: String(start + offset),
      payload: { type: "session/event", sessionId: "session-1", ...chunk(start + offset, "x") },
    }));
    const compacted = compactLiveEventFrames(frames);
    history = mergeHistoryEntries(history, compacted.map((frame) => ({ event: frame.payload.event })));
  }

  assert.equal(history.length, 1);
  assert.equal(history[0].event.data.chunk.text, "x".repeat(total));
  assert.deepEqual(history[0].compactedEventSeqRanges, [[1, total]]);
  assert.equal(history[0].displayDeltaLengthTree.count, total);
  assert.equal(history[0].compactedDeltaLengths, undefined);
  assert.equal(displayHistoryEventCount(history), total);
});

test("coalesces only adjacent live deltas and preserves frame order", () => {
  const frame = (item) => ({ rpcId: `rpc-${item.event.seq}`, payload: { type: "session/event", sessionId: "session-1", ...item } });
  const frames = compactLiveEventFrames([
    frame(chunk(1, "A")),
    frame(chunk(2, "B")),
    frame(entry(3, "session/status", { state: "working" })),
    frame(chunk(4, "C")),
    frame(chunk(5, "D")),
  ]);

  assert.equal(frames.length, 3);
  assert.equal(frames[0].payload.event.data.chunk.text, "AB");
  assert.deepEqual(frames[0].payload.event.compactedEventSeqRanges, [[1, 2]]);
  assert.equal(frames[1].payload.event.seq, 3);
  assert.equal(frames[2].payload.event.data.chunk.text, "CD");
});

test("keeps only the latest projection snapshot per key in one live batch", () => {
  const frames = [
    { rpcId: "1", payload: { type: "session/projection", sessionId: "session-1", key: "sessionStats", value: { steps: 1 } } },
    { rpcId: "2", payload: { type: "session/event", sessionId: "session-1", ...chunk(2, "A") } },
    { rpcId: "3", payload: { type: "session/projection", sessionId: "session-1", key: "sessionStats", value: { steps: 2 } } },
  ];
  const compacted = compactLiveEventFrames(frames);

  assert.deepEqual(compacted.map((frame) => frame.rpcId), ["2", "3"]);
  assert.equal(compacted[1].payload.value.steps, 2);
});

test("final messages replace chunk payloads while preserving usage, TTFT, and page cursor", () => {
  const history = [
    entry(100, "step/start", { turn: 1, step: 1 }),
    chunk(101, "thinking", "reasoning-delta"),
    chunk(102, "answer"),
    entry(103, "assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 20 } },
    }),
    finalMessage(104, "answer"),
    entry(105, "step/end", { turn: 1, step: 1 }),
  ];
  history.at(-2).event.sourceEventSeqs = [80, 101, 102, 103];
  const compacted = compactHistoryEntries(history);
  const message = compacted.find(item => item.event.type === "assistant/message");
  const chunks = compacted.filter(item => item.event.type === "assistant/chunk");

  assert.deepEqual(chunks.map(item => item.event.data.chunk.type), ["usage"]);
  assert.equal(message.event.sourceEventSeqs, undefined);
  assert.equal(message.displayFirstChunkSeq, 101);
  assert.equal(message.displayFirstChunkTime, history[1].event.time);
  assert.equal(message.displayFirstTokenTime, history[1].event.time);
  assert.equal(displayHistoryStartSequence(compacted), 100);
  assert.equal(displayHistoryEventCount(compacted), history.length);
  assert.deepEqual(transcriptFromHistory(compacted).filter(item => item.kind === "assistant").map(item => item.text), ["answer"]);
  assert.equal(transcriptFromHistory(compacted).some(item => item.kind === "reasoning"), false);
  assert.equal(assistantMessageStats(compacted).get(104).ttftMs, 10);
  assert.deepEqual(buildTrajectoryRecords(compacted), buildTrajectoryRecords(history));
  assert.deepEqual(compactHistoryEntries(compacted), compacted);
});

test("keeps finalized reasoning at its first chunk position around tool events", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    chunk(2, "thinking", "reasoning-delta"),
    entry(3, "tool/call", { turn: 1, step: 1, name: "read", callId: "call-1", arguments: { file_path: "README.md" } }),
    chunk(4, "answer"),
    entry(5, "assistant/message", {
      turn: 1,
      step: 1,
      message: {
        role: "assistant",
        content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "answer" }],
        usage: { inputTokens: 10, outputTokens: 20 },
      },
    }),
  ];
  const compacted = compactHistoryEntries(history);

  // 折叠不得改变可见渲染；seqFrom 是折叠行补上的 DOM 定位元数据
  // （覆盖被折叠 chunk 的起始 seq），原始行没有折叠因此不需要它。
  const withoutSeqFrom = (items) => items.map(({ seqFrom: _omit, ...item }) => item);
  assert.deepEqual(withoutSeqFrom(transcriptFromHistory(compacted)), withoutSeqFrom(transcriptFromHistory(history)));
  assert.deepEqual(transcriptFromHistory(compacted).map(item => item.seq), [2, 3, 5]);
  assert.equal(transcriptFromHistory(compacted).find(item => item.kind === "reasoning")?.seqFrom, 2);
});

test("renders transient live stream frames after the durable transcript", () => {
  const durable = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "user/message", { turn: 1, step: 1, content: [{ type: "text", text: "hello" }] }),
    entry(3, "step/start", { turn: 1, step: 1 }),
    finalMessage(4, "first answer"),
  ];
  // The mux synthesizes in-progress output in a negative, non-durable seq band.
  const live = [
    entry(Number.MIN_SAFE_INTEGER, "assistant/chunk", { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 0, text: "thinking" } }),
    entry(Number.MIN_SAFE_INTEGER + 1, "assistant/chunk", { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 0, text: " harder" } }),
    entry(Number.MIN_SAFE_INTEGER + 2, "assistant/chunk", { turn: 1, step: 2, chunk: { type: "text-delta", index: 1, text: "second answer" } }),
  ];
  const history = mergeHistoryEntries(compactHistoryEntries(durable), live);
  const items = transcriptFromHistory(history);

  // Live rows belong to the conversation end, never above loaded history.
  assert.deepEqual(items.map(item => item.kind), ["user", "assistant", "reasoning", "assistant"]);
  assert.equal(items.at(-2).text, "thinking harder");
  // The step already streamed answer text, so thinking is over: the Think entry
  // must fold while the answer is still arriving.
  assert.equal(items.at(-2).streaming, false);
  assert.equal(items.at(-1).text, "second answer");
  assert.equal(items.at(-1).streaming, true);
  // Paging and counts describe durable log events only.
  assert.equal(displayHistoryStartSequence(history), 1);
  assert.equal(displayHistoryEventCount(history), durable.length);
});

test("live thinking stays streaming until the step moves on", () => {
  const durable = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "user/message", { turn: 1, step: 1, content: [{ type: "text", text: "hello" }] }),
  ];
  const live = [
    entry(Number.MIN_SAFE_INTEGER, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "thinking" } }),
  ];
  const thinking = transcriptFromHistory(mergeHistoryEntries(compactHistoryEntries(durable), live));
  assert.equal(thinking.at(-1).kind, "reasoning");
  assert.equal(thinking.at(-1).streaming, true);

  // Tool arguments end the thinking phase of the same step.
  const withToolDelta = transcriptFromHistory(mergeHistoryEntries(compactHistoryEntries(durable), [
    ...live,
    entry(Number.MIN_SAFE_INTEGER + 1, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "tool-call-delta", index: 1, argumentsDelta: "{\"path\":" } }),
  ]));
  assert.equal(withToolDelta.at(-1).kind, "reasoning");
  assert.equal(withToolDelta.at(-1).streaming, false);

  // A step that ends closes the Think entry as before.
  const settled = transcriptFromHistory(mergeHistoryEntries(compactHistoryEntries([...durable, entry(9, "step/end", { turn: 1, step: 1 })]), live));
  assert.equal(settled.at(-1).streaming, false);
});

test("a durable step anchors its Think row at its own durable seq", () => {
  // A step that absorbed live frames keeps the transient seq as its
  // `displayFirstChunkSeq`; anchoring the Think row there would push every
  // finished Think row into the live band under the newest message.
  const history = [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "user/message", { turn: 1, step: 1, content: [{ type: "text", text: "hello" }] }),
    {
      ...entry(20, "assistant/message", {
        turn: 1,
        step: 1,
        message: {
          role: "assistant",
          content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "answer" }],
        },
      }),
      displayFirstChunkSeq: -30,
      compactedEventSeqRanges: [[-30, -25], [20, 20]],
    },
  ];
  const items = transcriptFromHistory(history);
  const reasoning = items.find((item) => item.kind === "reasoning");

  assert.equal(reasoning.text, "thinking");
  assert.equal(reasoning.seq, 20);
  assert.equal(reasoning.seqFrom, 20);
  assert.deepEqual(items.map((item) => item.kind), ["user", "reasoning", "assistant"]);
});

test("preserves non-overlapping compacted pages that lack per-token lengths", () => {
  const older = compactHistoryEntries(Array.from({ length: 1_000 }, (_, index) => chunk(index + 1, "a")));
  const newer = compactHistoryEntries(Array.from({ length: 1_000 }, (_, index) => chunk(index + 1_001, "b")));
  const merged = mergeHistoryEntries(newer, older);

  assert.equal(displayHistoryEventCount(mergeHistoryEntries([], older)), 1_000);
  assert.equal(displayHistoryEventCount(merged), 2_000);
  assert.equal(merged.map((item) => item.event.data.chunk?.text ?? "").join(""), `${"a".repeat(1_000)}${"b".repeat(1_000)}`);
});

test("keeps non-adjacent content blocks in their original order", () => {
  const raw = [chunk(1, "A", "text-delta", 0), chunk(2, "X", "text-delta", 1), chunk(3, "B", "text-delta", 0)];
  const compacted = compactHistoryEntries(raw);

  assert.equal(compacted.length, 3);
  assert.deepEqual(compacted.map((item) => item.event.data.chunk.text), ["A", "X", "B"]);
});

test("does not move pagination cursor to replacement provenance outside the page", () => {
  const replacement = finalMessage(3, "replacement");
  replacement.event.surfaceOp = "replace";
  replacement.event.sourceEventSeqs = [1, 2];
  const compacted = compactHistoryEntries([replacement, entry(4, "turn/end", { turn: 1 })]);

  assert.equal(displayHistoryStartSequence(compacted), 3);
});

test("deduplicates replayed live events within and across flush batches", () => {
  const start = entry(1, "step/start", { turn: 1, step: 1 });
  const first = chunk(2, "A");
  const second = chunk(3, "B");
  const current = mergeHistoryEntries([], [start, first, first, second, second]);
  const replayed = mergeHistoryEntries(current, [first, second, chunk(4, "C"), chunk(4, "C")]);
  const deltas = replayed.filter((item) => item.event.type === "assistant/chunk");

  assert.equal(deltas.map((item) => item.event.data.chunk.text).join(""), "ABC");
  assert.deepEqual(deltas.flatMap((item) => item.compactedEventSeqRanges ?? [[item.event.seq, item.event.seq]]), [[2, 3], [4, 4]]);
  assert.equal(displayHistoryEventCount(replayed), 4);
});

test("trims the known prefix when a live frame overlaps a history cut", () => {
  const current = compactHistoryEntries([chunk(1, "A"), chunk(2, "B"), chunk(3, "C")]);
  const frames = compactLiveEventFrames([
    { rpcId: "3", payload: { type: "session/event", sessionId: "session-1", ...chunk(3, "C") } },
    { rpcId: "4", payload: { type: "session/event", sessionId: "session-1", ...chunk(4, "D") } },
  ]);
  const overlap = { event: frames[0].payload.event };
  const merged = mergeHistoryEntries(current, [overlap]);

  assert.equal(merged.map((item) => item.event.data.chunk.text).join(""), "ABCD");
  assert.equal(displayHistoryEventCount(merged), 4);
});

test("retains a live suffix beyond an overlapping cold history cut", () => {
  const loaded = compactHistoryEntries(Array.from({ length: 1_001 }, (_, index) => chunk(index + 1, "x")));
  let live = [];
  for (let start = 1; start <= 1_002; start += 16) {
    const frames = Array.from({ length: Math.min(16, 1_003 - start) }, (_, offset) => ({
      rpcId: String(start + offset),
      payload: { type: "session/event", sessionId: "session-1", ...chunk(start + offset, "x") },
    }));
    live = mergeHistoryEntries(live, compactLiveEventFrames(frames).map((frame) => ({ event: frame.payload.event })));
  }
  const merged = mergeHistoryEntries(loaded, live);

  assert.equal(displayHistoryEventCount(merged), 1_002);
  assert.equal(merged.map((item) => item.event.data.chunk.text).join("").length, 1_002);
});

test("rejects an ambiguous compacted overlap instead of duplicating text", () => {
  const current = compactHistoryEntries([chunk(1, "A"), chunk(2, "B"), chunk(3, "C")]);
  const overlap = { ...chunk(3, "CD"), compactedEventSeqRanges: [[3, 4]] };
  const merged = mergeHistoryEntries(current, [overlap]);

  assert.equal(merged, current);
  assert.equal(merged[0].event.data.chunk.text, "ABC");
});

test("keeps retry TTFT identical between cold replay and incremental folding", () => {
  const events = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    chunk(2, "failed"),
    entry(3, "llm/retry-started", { turn: 1, step: 1 }),
    chunk(4, "success"),
    finalMessage(5, "success"),
  ];
  events.forEach((item, index) => { item.event.time = index * 100; });
  const cold = compactHistoryEntries(events);
  let incremental = [];
  for (const item of events) incremental = mergeHistoryEntries(incremental, [item]);

  assert.deepEqual(incremental, cold);
  assert.equal(assistantMessageStats(cold).get(5).ttftMs, 100);
  assert.equal(assistantMessageStats(incremental).get(5).ttftMs, 100);
});

test("drops a failed retry attempt and settles an unfinished terminal stream", () => {
  const compacted = compactHistoryEntries([
    entry(1, "step/start", { turn: 1, step: 1 }),
    chunk(2, "failed"),
    entry(3, "llm/retry", { turn: 1, step: 1, retry: 1 }),
    entry(4, "llm/retry-started", { turn: 1, step: 1, retry: 1 }),
    chunk(5, "## recovered"),
    entry(6, "step/end", { turn: 1, step: 1 }),
    entry(7, "turn/end", { turn: 1, reason: { kind: "error", error: "stopped" } }),
  ]);
  const assistant = transcriptFromHistory(compacted).find(item => item.kind === "assistant");

  assert.equal(assistant.text, "## recovered");
  assert.equal(assistant.streaming, false);
  assert.equal(compacted.filter(item => item.event.type === "assistant/chunk").length, 1);
});

test("lists files the present tool delivered through its durable event", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "assistant/message", { turn: 1, step: 1, message: { role: "assistant", content: [] } }),
    entry(3, "deliverables/presented", {
      turn: 1,
      callId: "call-1",
      files: [{ path: "build/report.html", description: "report" }, { path: "build/plot.png" }],
    }),
  ];

  const deliverable = transcriptFromHistory(history).find(item => item.kind === "deliverables");

  assert.deepEqual(deliverable.files, ["build/report.html", "build/plot.png"]);
});

test("lists a newly created file from the write call arguments", () => {
  // Web 的产出词表读调用参数：新建文件没有旧内容，结果元数据里的 diffs 是空的。
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "write", callId: "call-1", arguments: JSON.stringify({ file_path: "notes.txt", content: "hello world" }) }),
    entry(3, "tool/result", {
      turn: 1,
      step: 1,
      meta: { diffs: [] },
      message: { source: { callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "Created file" }], isError: false }] },
    }),
  ];

  const deliverable = transcriptFromHistory(history).find(item => item.kind === "deliverables");

  assert.deepEqual(deliverable.files, ["notes.txt"]);
  // 新建文件没有可统计的旧内容，因此不写 diff 统计。
  assert.deepEqual(deliverable.fileDiffs, {});
});

test("lists an edited file and keeps its applied diff statistics", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "edit", callId: "call-2", arguments: JSON.stringify({ file_path: "config.txt", old_string: "DEBUG", new_string: "RELEASE" }) }),
    entry(3, "tool/result", {
      turn: 1,
      step: 1,
      meta: { diffs: [{ path: "config.txt", oldText: "mode=DEBUG", newText: "mode=RELEASE" }] },
      message: { source: { callId: "call-2" }, content: [{ type: "tool-result", toolCallId: "call-2", content: [{ type: "text", text: "Edited" }], isError: false }] },
    }),
  ];

  const deliverable = transcriptFromHistory(history).find(item => item.kind === "deliverables");

  assert.deepEqual(deliverable.files, ["config.txt"]);
  assert.deepEqual(deliverable.fileDiffs, { "config.txt": { added: 1, removed: 1 } });
});

test("ignores mutation calls that never settled or settled with an error", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "write", callId: "call-pending", arguments: JSON.stringify({ file_path: "never.txt", content: "x" }) }),
    entry(3, "tool/call", { turn: 1, step: 1, name: "write", callId: "call-failed", arguments: JSON.stringify({ file_path: "denied.txt", content: "x" }) }),
    entry(4, "tool/result", {
      turn: 1,
      step: 1,
      message: { source: { callId: "call-failed" }, content: [{ type: "tool-result", toolCallId: "call-failed", content: [{ type: "text", text: "denied" }], isError: true }] },
    }),
  ];

  assert.equal(transcriptFromHistory(history).find(item => item.kind === "deliverables"), undefined);
});

test("ignores malformed mutation arguments and read-only editor commands", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    // write 缺 content / edit 新旧内容相同 / editor 是只读 view：都不算产出。
    entry(2, "tool/call", { turn: 1, step: 1, name: "write", callId: "call-a", arguments: "{\"file_path\": \"a.txt\"}" }),
    entry(3, "tool/result", { turn: 1, step: 1, message: { source: { callId: "call-a" }, content: [{ type: "tool-result", toolCallId: "call-a", content: [{ type: "text", text: "ok" }] }] } }),
    entry(4, "tool/call", { turn: 1, step: 1, name: "edit", callId: "call-b", arguments: JSON.stringify({ file_path: "b.txt", old_string: "same", new_string: "same" }) }),
    entry(5, "tool/result", { turn: 1, step: 1, message: { source: { callId: "call-b" }, content: [{ type: "tool-result", toolCallId: "call-b", content: [{ type: "text", text: "noop" }] }] } }),
    entry(6, "tool/call", { turn: 1, step: 1, name: "str_replace_editor", callId: "call-c", arguments: JSON.stringify({ command: "view", path: "c.txt" }) }),
    entry(7, "tool/result", { turn: 1, step: 1, message: { source: { callId: "call-c" }, content: [{ type: "tool-result", toolCallId: "call-c", content: [{ type: "text", text: "contents" }] }] } }),
    entry(8, "tool/call", { turn: 1, step: 1, name: "write", callId: "call-d", arguments: "not json" }),
    entry(9, "tool/result", { turn: 1, step: 1, message: { source: { callId: "call-d" }, content: [{ type: "tool-result", toolCallId: "call-d", content: [{ type: "text", text: "ok" }] }] } }),
  ];

  assert.equal(transcriptFromHistory(history).find(item => item.kind === "deliverables"), undefined);
});

test("lists a file the editor created with str_replace_editor", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "str_replace_editor", callId: "call-e", arguments: JSON.stringify({ command: "create", path: "draft.md", file_text: "# Draft" }) }),
    entry(3, "tool/result", { turn: 1, step: 1, message: { source: { callId: "call-e" }, content: [{ type: "tool-result", toolCallId: "call-e", content: [{ type: "text", text: "Created" }] }] } }),
  ];

  const deliverable = transcriptFromHistory(history).find(item => item.kind === "deliverables");

  assert.deepEqual(deliverable.files, ["draft.md"]);
});

test("does not list files written by PTC sub-dispatches on their own", () => {
  // Web 的产出 Definition 只认根级 tool/call：Code Dispatch 子调用不独立进入。
  // PTC 的交付由程序显式调用 present 完成（deliverables/presented）。
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "run_code", callId: "call-1", arguments: JSON.stringify({ code: "await tools.write({ file_path: 'out.md', content: 'hi' })", description: "写文件" }) }),
    entry(3, "tool/ptc-dispatch-start", {
      rootCallId: "call-1", parentCallId: "call-1", subCallId: "call-1:ptc:1",
      name: "write", arguments: { file_path: "out.md", content: "hi" },
    }),
    entry(4, "tool/ptc-dispatch", {
      rootCallId: "call-1", parentCallId: "call-1", subCallId: "call-1:ptc:1",
      name: "write", arguments: { file_path: "out.md", content: "hi" }, isError: false, content: [{ type: "text", text: "Created" }],
    }),
    entry(5, "tool/result", {
      turn: 1,
      step: 1,
      message: { source: { callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "done" }] }] },
    }),
  ];

  assert.equal(transcriptFromHistory(history).find(item => item.kind === "deliverables"), undefined);
});

test("shows the v3 system prompt node in the trajectory but not in the transcript", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "system/message", {
      turn: 1,
      step: 1,
      message: {
        id: "system-1",
        role: "system",
        source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" },
        content: [{ type: "text", text: "be brief" }],
      },
      surfaceOp: "append",
    }),
    entry(3, "request/header", { turn: 1, step: 1, header: { config: { provider: "mock", model: "mock" }, tools: [] } }),
  ];

  const system = buildTrajectoryRecords(history).find(record => record.key === "system-2");
  assert.equal(system.kind, "system");
  assert.equal(system.summary, "be brief");

  // Upstream never renders the prompt node as a chat bubble.
  assert.equal(transcriptFromHistory(history).some(item => item.text === "be brief"), false);
});

test("folds PTC sub-dispatches into the run_code row instead of their own rows", () => {
  const code = "const out = await tools.bash({ command: 'ls' })";
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "run_code", callId: "call-1", arguments: JSON.stringify({ code, description: "列目录" }) }),
    entry(3, "tool/ptc-dispatch-start", {
      rootCallId: "call-1", parentCallId: "call-1", subCallId: "call-1:ptc:1",
      name: "bash", arguments: { command: "ls" },
    }),
    entry(4, "tool/ptc-dispatch", {
      rootCallId: "call-1", parentCallId: "call-1", subCallId: "call-1:ptc:1",
      name: "bash", arguments: { command: "ls" }, isError: false, content: [{ type: "text", text: "demo.txt" }],
    }),
    entry(5, "tool/result", {
      turn: 1,
      step: 1,
      message: { source: { callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "done" }] }] },
    }),
  ];

  const toolRows = transcriptFromHistory(history).filter(item => item.kind === "tool");

  // 内部派发不单独成行：它们只出现在所属 run_code 行的执行视图里。
  assert.equal(toolRows.length, 1);
  const row = toolRows[0];
  assert.equal(row.toolResultText, "done");
  assert.equal(row.program.calls.length, 1);
  assert.equal(row.program.calls[0].name, "bash");
  assert.equal(row.program.calls[0].line, 1);
  assert.equal(row.program.calls[0].resultText, "demo.txt");
  assert.equal(row.program.lines[0].calls.length, 1);
  assert.equal(row.program.unplaced.length, 0);
});

test("leaves a native tool row without a PTC execution view", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "read", callId: "call-9", arguments: { file_path: "README.md" } }),
  ];

  const row = transcriptFromHistory(history).find(item => item.kind === "tool");

  assert.equal(row.program, undefined);
});
