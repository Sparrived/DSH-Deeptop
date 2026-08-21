import assert from "node:assert/strict";
import test from "node:test";
import { composerReferenceText, detectComposerTrigger, droppedImageMediaType, imageBatchLimitError, imageDimensionLimitError, imageLimitsFromProjection, insertComposerCandidate, modelPickerGroups, modelSupportsImages, promptContentParts, referenceComposerCandidates, relativeWorkspacePath, insertComposerText, formatRuntimeLog, formatRuntimeLogs, runtimeLogMatches, questionAnswerItems, sessionPath } from "./ui-model.ts";
test("keeps an RC8 current model when the advisory groups omit it", () => {
  const groups = modelPickerGroups({ groups: [{ id: "provider", name: "Provider", models: [{ id: "listed", name: "Listed" }] }], current: { provider: "provider", model: "custom-model" } });
  assert.equal(groups[0].models.at(-1)?.name, "custom-model（当前未列出）");
});

test("reads official imageLimits projection and checks local limits", () => {
  const limits = { maxImageBytes: 100, maxImagesPerMessage: 2, maxMessageImageBytes: 150, maxImagePixels: 1000, maxImageDimension: 40, mediaTypes: ["image/png"] };
  assert.deepEqual(imageLimitsFromProjection(limits), limits);
  assert.equal(imageDimensionLimitError(41, 10, limits), "图片边长不能超过 40px");
  assert.equal(imageDimensionLimitError(32, 32, limits), "图片像素数不能超过 1000");
  assert.equal(imageBatchLimitError([], [{ id: "1", name: "a", mediaType: "image/png", data: "1234" }, { id: "2", name: "b", mediaType: "image/png", data: "1234" }, { id: "3", name: "c", mediaType: "image/png", data: "1234" }], limits), "图片数量不能超过 2 张");
});

test("encodes official DSH custom answers for optioned and optionless questions", () => {
  const questions = [
    { id: "choice", question: "选择", options: [{ label: "A" }] },
    { id: "multi", question: "多选", multiSelect: true, options: [{ label: "A" }] },
    { id: "free", question: "补充" },
  ];
  assert.deepEqual(questionAnswerItems(questions, { choice: ["A"], multi: ["A"] }, {
    choice: "其他",
    multi: "补充",
    free: "自由文本",
  }), [
    { id: "choice", selected: [], custom: "其他" },
    { id: "multi", selected: ["A"], custom: "补充" },
    { id: "free", selected: [], custom: "自由文本" },
  ]);
});

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

test("detects @ references and preserves path queries", () => {
  assert.deepEqual(detectComposerTrigger("请看 @src/ui"), { kind: "reference", query: "src/ui", start: 3 });
  assert.deepEqual(detectComposerTrigger("请看 @\"src/my file"), { kind: "reference", query: "src/my file", start: 3, quoted: true });
  assert.deepEqual(detectComposerTrigger("/sk"), { kind: "skill", query: "sk", start: 0 });
});

test("formats canonical session mentions and keeps directory completion open", () => {
  const candidates = referenceComposerCandidates(
    [{ path: "src/ui", kind: "directory" }, { path: "src/main.ts", kind: "file" }],
    [{ sessionId: "s-1", label: "旧会话", createdAt: 1, mention: "@[旧会话](dsh-session:InMtMSI)" }],
  );
  assert.equal(candidates[0].insertText, "@src/ui/");
  assert.equal(candidates[1].insertText, "@src/main.ts");
  assert.equal(candidates[2].insertText, "@[旧会话](dsh-session:InMtMSI)");
  const trigger = detectComposerTrigger("@src/ui");
  assert.ok(trigger);
  assert.equal(insertComposerCandidate("@src/ui", trigger, candidates[0]), "@src/ui/");
});

test("quotes file mentions and excludes sessions from quoted completion", () => {
  const candidates = referenceComposerCandidates(
    [{ path: "src/my file.ts", kind: "file" }],
    [{ sessionId: "s-1", label: "旧会话", createdAt: 1, mention: "@[旧会话](dsh-session:abc)" }],
    true,
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].insertText, "@\"src/my file.ts\"");
});

test("rejects unsafe file paths and malformed session references", () => {
  const candidates = referenceComposerCandidates([
    { path: "../secret.txt", kind: "file" },
    { path: "/absolute.txt", kind: "file" },
    { path: "C:\\absolute.txt", kind: "file" },
    { path: "safe/file.txt", kind: "file" },
  ], [
    { sessionId: "s-1", label: "旧会话", createdAt: 1, mention: "@[旧会话](dsh-session:InMtMSI)" },
    { sessionId: "s-2", label: "伪造", createdAt: 1, mention: "@[伪造](dsh-session:abc)" },
    { sessionId: "s-2", label: "错 id", createdAt: 1, mention: "@[错 id](dsh-session:InMtMSI)" },
    { sessionId: "s-3", label: "方括号]", createdAt: 1, mention: "@[方括号\\]](dsh-session:InMtMtMSI)" },
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["safe/file.txt", "s-1"]);
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

test("classifies dropped paths as image attachments only for known extensions", () => {
  assert.equal(droppedImageMediaType("D:\\pics\\画面.PNG"), "image/png");
  assert.equal(droppedImageMediaType("/tmp/photo.jpeg"), "image/jpeg");
  assert.equal(droppedImageMediaType("/tmp/photo.jpg"), "image/jpeg");
  assert.equal(droppedImageMediaType("/tmp/anim.GIF"), "image/gif");
  assert.equal(droppedImageMediaType("/tmp/tex.webp"), "image/webp");
  assert.equal(droppedImageMediaType("/tmp/report.pdf"), null);
  assert.equal(droppedImageMediaType("/tmp/no-extension"), null);
  assert.equal(droppedImageMediaType("/tmp/folder.d/"), null);
  assert.equal(droppedImageMediaType(""), null);
});

test("resolves dropped absolute paths against the workspace case-insensitively", () => {
  assert.equal(relativeWorkspacePath("D:\\repo\\src\\App.tsx", "D:/repo"), "src/App.tsx");
  assert.equal(relativeWorkspacePath("d:/REPO/src/App.tsx", "D:\\repo\\"), "src/App.tsx");
  assert.equal(relativeWorkspacePath("D:\\repo\\src\\App.tsx", ""), null);
  assert.equal(relativeWorkspacePath("E:\\elsewhere\\a.txt", "D:\\repo"), null);
  assert.equal(relativeWorkspacePath("D:\\repository\\a.txt", "D:\\repo"), null);
  assert.equal(relativeWorkspacePath("D:\\repo", "D:\\repo"), null);
});

test("builds composer mention text for dropped files inside and outside the workspace", () => {
  assert.equal(composerReferenceText("D:\\repo\\src\\App.tsx", "D:\\repo"), "@src/App.tsx");
  assert.equal(composerReferenceText("D:\\repo\\my notes\\草稿 v2.md", "D:\\repo"), "@\"my notes/草稿 v2.md\"");
  assert.equal(composerReferenceText("C:\\Users\\sparr\\Downloads\\图 纸.png", "D:\\repo"), "@\"C:/Users/sparr/Downloads/图 纸.png\"");
  assert.equal(composerReferenceText("D:\\repo\\plain.txt", ""), "@D:/repo/plain.txt");
});
