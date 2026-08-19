import assert from "node:assert/strict";
import test from "node:test";
import { modelSupportsImages, promptContentParts, insertComposerText, formatRuntimeLog, formatRuntimeLogs, runtimeLogMatches, sessionPath } from "./ui-model.ts";

test("allows image prompts when the provider omits modality metadata", () => {
  assert.equal(modelSupportsImages({ id: "model", name: "Model" }), true);
  assert.equal(modelSupportsImages(undefined), true);
});

test("respects an explicit text-only model declaration", () => {
  assert.equal(modelSupportsImages({ id: "model", name: "Model", inputModalities: ["text"] }), false);
  assert.equal(modelSupportsImages({ id: "model", name: "Model", inputModalities: ["text", "image"] }), true);
});

test("builds the DSH prompt shape for image-only and mixed messages", () => {
  const image = { id: "attachment-1", name: "画面.png", mediaType: "image/png", data: "QUJD" };
  assert.deepEqual(promptContentParts("", [image]), [
    { type: "image", mediaType: "image/png", data: "QUJD", name: "画面.png" },
  ]);
  assert.deepEqual(promptContentParts("描述这张图", [image]), [
    { type: "text", text: "描述这张图" },
    { type: "image", mediaType: "image/png", data: "QUJD", name: "画面.png" },
  ]);
});

test("inserts a file path at the caret with readable separators", () => {
  assert.deepEqual(insertComposerText("请查看", "D:\\repo\\main.ts", 2, 2), {
    value: "请查 D:\\repo\\main.ts 看",
    selectionStart: 18,
    selectionEnd: 18,
  });
  assert.deepEqual(insertComposerText("已有内容", "D:\\repo", 2, 2), {
    value: "已有 D:\\repo 内容",
    selectionStart: 10,
    selectionEnd: 10,
  });
});

test("resolves relative message paths with the session platform separator", () => {
  assert.equal(sessionPath("C:\\repo", "src/App.tsx"), "C:\\repo\\src\\App.tsx");
  assert.equal(sessionPath("/workspace/repo", "src\\App.tsx"), "/workspace/repo/src/App.tsx");
  assert.equal(sessionPath("/workspace/repo", "README.md"), "/workspace/repo/README.md");
});

test("formats runtime log lines with UTC timestamps", () => {
  const log = { time: 1700000000123, phase: "runtime", stream: "stderr", text: "boom" };
  assert.equal(
    formatRuntimeLog(log),
    "[2023-11-14 22:13:20.123] [runtime/stderr] boom",
  );
});

test("formats a batch of runtime logs as joined lines", () => {
  const logs = [
    { time: 0, phase: "start", stream: "command", text: "npm exec dsh" },
    { time: 1000, phase: "runtime", stream: "diagnostic", text: "ready" },
  ];
  assert.equal(
    formatRuntimeLogs(logs),
    "[1970-01-01 00:00:00.000] [start/command] npm exec dsh\n[1970-01-01 00:00:01.000] [runtime/diagnostic] ready",
  );
});

test("filters runtime logs by stream, phase or text", () => {
  const logs = [
    { time: 0, phase: "registry", stream: "diagnostic", text: "registry unavailable" },
    { time: 1, phase: "runtime", stream: "stderr", text: "TypeError: boom" },
  ];
  assert.equal(runtimeLogMatches(logs[0], ""), true);
  assert.equal(runtimeLogMatches(logs[0], "REGISTRY"), true);
  assert.equal(runtimeLogMatches(logs[1], "stderr"), true);
  assert.equal(runtimeLogMatches(logs[1], "typeerror"), true);
  assert.equal(runtimeLogMatches(logs[0], "nope"), false);
});
