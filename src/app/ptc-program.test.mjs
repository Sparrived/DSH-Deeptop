import assert from "node:assert/strict";
import test from "node:test";
import { buildPtcProgramView, readPtcDispatch, scanCallSites } from "./ptc-program.ts";

/** 一次子调用开始事件。 */
const startEvent = (time, subCallId, name, args, root = "call-1") => ({
  type: "tool/ptc-dispatch-start",
  seq: time,
  time,
  data: { rootCallId: root, parentCallId: root, subCallId, name, arguments: args },
});

/** 一次子调用结算事件。 */
const settleEvent = (time, subCallId, name, args, { error = false, text = "ok" } = {}, root = "call-1") => ({
  type: "tool/ptc-dispatch",
  seq: time,
  time,
  data: {
    rootCallId: root,
    parentCallId: root,
    subCallId,
    name,
    arguments: args,
    isError: error,
    content: [{ type: "text", text }],
  },
});

const runCodeArgs = (code) => JSON.stringify({ code, description: "批量读取" });

/** 从事件列表构造视图（与 conversation-model 的折叠路径一致）。 */
const viewOf = (code, events, programFailed = false) => buildPtcProgramView(
  runCodeArgs(code),
  events.map((event) => readPtcDispatch(event)).filter(Boolean),
  "zh",
  programFailed,
);

test("reads a dispatch start without inventing a result", () => {
  const dispatch = readPtcDispatch(startEvent(1_000, "call-1:ptc:1", "bash", { command: "ls" }));
  assert.equal(dispatch.settled, false);
  assert.equal(dispatch.startedAt, 1_000);
  assert.equal(dispatch.settledAt, undefined);
  assert.equal(dispatch.resultText, "");
  assert.equal(dispatch.error, false);
  assert.equal(dispatch.argsText, '{\n  "command": "ls"\n}');
});

test("reads a dispatch settle with its outcome and no fabricated start", () => {
  const dispatch = readPtcDispatch(settleEvent(1_400, "call-1:ptc:1", "read", { file_path: "a" }, { error: true, text: "Error: missing" }));
  assert.equal(dispatch.settled, true);
  assert.equal(dispatch.startedAt, undefined);
  assert.equal(dispatch.settledAt, 1_400);
  assert.equal(dispatch.error, true);
  assert.equal(dispatch.resultText, "Error: missing");
});

test("ignores events outside the dispatch lifecycle and malformed payloads", () => {
  assert.equal(readPtcDispatch({ type: "tool/call", seq: 1, time: 1, data: {} }), undefined);
  assert.equal(readPtcDispatch({ type: "tool/ptc-dispatch", seq: 2, time: 2, data: { rootCallId: "call-1" } }), undefined);
});

test("scans dot and bracket call sites with their source lines", () => {
  const sites = scanCallSites([
    "const files = await tools.glob({ pattern: '*' })",
    "const listing = await tools['bash']({ command: 'ls' })",
    "// tools.read is only mentioned here, not called",
    "const first = await tools.read({ file_path: 'a' })",
    "const second = await tools.read({ file_path: 'b' })",
  ].join("\n"));
  assert.deepEqual(sites.get("glob"), [1]);
  assert.deepEqual(sites.get("bash"), [2]);
  assert.deepEqual(sites.get("read"), [4, 5]);
});

test("returns no view when the program dispatched nothing", () => {
  assert.equal(buildPtcProgramView(runCodeArgs("return 1"), [], "zh"), undefined);
});

test("merges the start/settle pair into one call with its wall time", () => {
  const view = viewOf("const out = await tools.bash({ command: 'echo hi' })", [
    startEvent(1_000, "call-1:ptc:1", "bash", { command: "echo hi" }),
    settleEvent(1_400, "call-1:ptc:1", "bash", { command: "echo hi" }, { text: "hi" }),
  ]);
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].state, "ok");
  assert.equal(view.calls[0].durationMs, 400);
  assert.equal(view.calls[0].resultText, "hi");
  assert.equal(view.calls[0].line, 1);
  assert.equal(view.stats.spanMs, 400);
});

test("anchors calls to call sites in submission order and reuses a loop site", () => {
  const code = [
    "const files = await tools.glob({ pattern: 'src/**' })",
    "let total = 0",
    "for (const f of files) {",
    "  total += await tools.read({ file_path: f })",
    "}",
  ].join("\n");
  const view = viewOf(code, [
    startEvent(1_000, "call-1:ptc:1", "glob", { pattern: "src/**" }),
    settleEvent(1_050, "call-1:ptc:1", "glob", { pattern: "src/**" }, { text: "a.ts" }),
    startEvent(1_100, "call-1:ptc:2", "read", { file_path: "a.ts" }),
    settleEvent(1_300, "call-1:ptc:2", "read", { file_path: "a.ts" }, { text: "A" }),
    startEvent(1_310, "call-1:ptc:3", "read", { file_path: "b.ts" }),
    settleEvent(1_500, "call-1:ptc:3", "read", { file_path: "b.ts" }, { text: "B" }),
  ]);
  assert.deepEqual(view.calls.map((call) => call.line), [1, 4, 4]);
  assert.equal(view.lines[3].calls.length, 2);
  assert.deepEqual(view.lines[3].calls.map((call) => call.index), [2, 3]);
  assert.equal(view.unplaced.length, 0);
  assert.equal(view.stats.maxDurationMs, 200);
});

test("leaves a dynamically dispatched call unplaced instead of guessing a line", () => {
  const code = "const name = 'read'\nconst out = await tools[name]({ file_path: 'a' })";
  const view = viewOf(code, [
    startEvent(1_000, "call-1:ptc:1", "read", { file_path: "a" }),
    settleEvent(1_100, "call-1:ptc:1", "read", { file_path: "a" }, { text: "A" }),
  ]);
  assert.equal(view.calls[0].line, undefined);
  assert.deepEqual(view.unplaced.map((call) => call.index), [1]);
  assert.equal(view.lines.every((line) => line.calls.length === 0), true);
});

test("keeps the trace when the program source is unavailable", () => {
  const view = buildPtcProgramView("{ not json", [
    readPtcDispatch(startEvent(1_000, "call-1:ptc:1", "bash", { command: "ls" })),
  ], "zh");
  assert.equal(view.code, "");
  assert.deepEqual(view.lines, []);
  assert.equal(view.calls.length, 1);
  assert.equal(view.unplaced.length, 1);
});

test("marks overlapping windows as parallel and sequential ones as not", () => {
  const overlapping = viewOf("await tools.bash({ command: 'a' })\nawait tools.read({ file_path: 'b' })", [
    startEvent(1_000, "call-1:ptc:1", "bash", { command: "a" }),
    startEvent(1_100, "call-1:ptc:2", "read", { file_path: "b" }),
    settleEvent(1_500, "call-1:ptc:1", "bash", { command: "a" }),
    settleEvent(1_600, "call-1:ptc:2", "read", { file_path: "b" }),
  ]);
  assert.deepEqual(overlapping.calls.map((call) => call.concurrent), [2, 2]);
  assert.equal(overlapping.stats.parallel, 2);

  const sequential = viewOf("await tools.bash({ command: 'a' })\nawait tools.read({ file_path: 'b' })", [
    startEvent(1_000, "call-1:ptc:1", "bash", { command: "a" }),
    settleEvent(1_100, "call-1:ptc:1", "bash", { command: "a" }),
    startEvent(1_200, "call-1:ptc:2", "read", { file_path: "b" }),
    settleEvent(1_300, "call-1:ptc:2", "read", { file_path: "b" }),
  ]);
  assert.deepEqual(sequential.calls.map((call) => call.concurrent), [1, 1]);
  assert.equal(sequential.stats.parallel, 1);
});

test("reports the running call for the collapsed ticker and withholds a frozen span", () => {
  const view = viewOf("await tools.bash({ command: 'slow' })", [
    startEvent(1_000, "call-1:ptc:1", "bash", { command: "slow" }),
  ]);
  assert.equal(view.stats.running, 1);
  assert.equal(view.active.index, 1);
  assert.equal(view.stats.spanMs, undefined);
  assert.equal(view.calls[0].state, "running");
});

test("separates failures the program caught from a failed program", () => {
  const events = [
    startEvent(1_000, "call-1:ptc:1", "bash", { command: "echo ok" }),
    settleEvent(1_100, "call-1:ptc:1", "bash", { command: "echo ok" }, { text: "ok" }),
    startEvent(1_200, "call-1:ptc:2", "read", { file_path: "missing.txt" }),
    settleEvent(1_300, "call-1:ptc:2", "read", { file_path: "missing.txt" }, { error: true, text: "Error: not found" }),
  ];
  const caught = viewOf("await tools.bash({ command: 'echo ok' })\nawait tools.read({ file_path: 'missing.txt' })", events, false);
  assert.equal(caught.stats.failures, 1);
  assert.equal(caught.caughtFailures, 1);

  const failed = viewOf("await tools.bash({ command: 'echo ok' })\nawait tools.read({ file_path: 'missing.txt' })", events, true);
  assert.equal(failed.caughtFailures, 0);
});
