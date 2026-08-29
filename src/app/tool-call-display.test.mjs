import assert from "node:assert/strict";
import test from "node:test";
import { isPrimaryToolArgument, orderedToolArguments, parseToolArgs, toolArgsLayout, toolCallDescription, toolCallEditDiff, toolCallSummary, visibleToolArguments } from "./tool-call-display.ts";

test("extracts a durable tool-call description and omits it from parameter rows", () => {
  const args = parseToolArgs(JSON.stringify({ command: "git status", description: "检查工作区状态", workdir: "D:\\Code" }));
  assert.equal(toolCallDescription(args), "检查工作区状态");
  assert.deepEqual(visibleToolArguments("pwsh", args), [
    ["command", "git status"],
    ["workdir", "D:\\Code"],
  ]);
});

test("uses the edit diff instead of repeating old and new text in parameter rows", () => {
  const args = {
    file_path: "src/app/tool-call-display.ts",
    old_string: "before",
    new_string: "after",
    replace_all: false,
  };
  assert.deepEqual(toolCallEditDiff("edit", args), {
    path: "src/app/tool-call-display.ts",
    oldText: "before",
    newText: "after",
  });
  assert.deepEqual(orderedToolArguments("edit", args), [
    ["file_path", "src/app/tool-call-display.ts"],
    ["replace_all", false],
  ]);
  const incomplete = { file_path: "a.ts", old_string: "x" };
  assert.equal(toolCallEditDiff("edit", incomplete), undefined);
  assert.deepEqual(orderedToolArguments("edit", incomplete), [
    ["file_path", "a.ts"],
    ["old_string", "x"],
  ]);
  assert.equal(toolCallEditDiff("write", args), undefined);
});

test("prefers descriptions over tool-specific call-bar fields", () => {
  assert.equal(toolCallSummary("edit", {
    description: "修正摘要逻辑",
    file_path: "src/app/tool-call-display.ts",
  }), "修正摘要逻辑");
});

test("uses the edited file as the call-bar summary without a description", () => {
  assert.equal(toolCallSummary("edit", {
    file_path: "src/app/tool-call-display.ts",
    old_string: "before",
    new_string: "after",
  }), "src/app/tool-call-display.ts");
});

test("summarises stable and unknown tools only from meaningful fields", () => {
  assert.equal(toolCallSummary("pwsh", { command: "git status --short --branch", timeoutMs: 120_000 }), "git status --short --branch");
  assert.equal(toolCallSummary("web_search", { queries: ["DSH Desktop", "Tauri"] }), "DSH Desktop · Tauri");
  assert.equal(toolCallSummary("mcp__vendor__unknown", { file_path: "README.md", token: "do-not-display" }), "README.md");
  assert.equal(toolCallSummary("mcp__vendor__unknown", { token: "do-not-display" }), undefined);
});

test("summarises common built-in calls without model descriptions", () => {
  assert.equal(toolCallSummary("skill", { name: "frontend-design" }), "frontend-design");
  assert.equal(toolCallSummary("job_output", { job_id: "pwsh-19", timeout_ms: 120_000 }), "pwsh-19");
  assert.equal(toolCallSummary("create_goal", { objective: "发布开发构建", max_goal_rounds: 3 }), "发布开发构建");
  assert.equal(toolCallSummary("todo_write", { todos: [{ content: "运行验证", status: "in_progress" }] }), "运行验证");
  assert.equal(toolCallSummary("ask_user_question", { questions: [{ question: "选择发布渠道", options: [{ label: "GitHub" }] }] }), "选择发布渠道");
});

test("parses the JSON-string argument wrapper used by durable histories", () => {
  const args = parseToolArgs(JSON.stringify(JSON.stringify({ queries: ["DSH"], description: "检索文档" })));
  assert.deepEqual(args, { queries: ["DSH"], description: "检索文档" });
});

test("uses semantic layouts only for stable tool families", () => {
  assert.equal(toolArgsLayout("pwsh", { command: "git status" }), "terminal");
  assert.equal(toolArgsLayout("read", { file_path: "README.md" }), "file");
  assert.equal(toolArgsLayout("web_fetch", { url: "https://example.com" }), "web");
  assert.equal(toolArgsLayout("subagent", { prompt: "review" }), "delegation");
  assert.equal(toolArgsLayout("mcp__vendor__unknown", { value: 1 }), "generic");
});

test("orders stable tool fields before unrecognised extension fields", () => {
  assert.deepEqual(orderedToolArguments("pwsh", {
    run_in_background: true,
    custom: "extension",
    command: "git status",
    workdir: "D:\\Code",
  }), [
    ["command", "git status"],
    ["workdir", "D:\\Code"],
    ["run_in_background", true],
    ["custom", "extension"],
  ]);
});

test("promotes only declared primary arguments for stable tool profiles", () => {
  assert.equal(isPrimaryToolArgument("read", "file_path"), true);
  assert.equal(isPrimaryToolArgument("read", "limit"), false);
  assert.equal(isPrimaryToolArgument("pwsh", "command"), true);
  assert.equal(isPrimaryToolArgument("mcp__vendor__unknown", "value"), false);
});

test("falls back safely when description is missing or blank", () => {
  assert.equal(toolCallDescription(undefined), undefined);
  assert.equal(toolCallDescription({ description: "   " }), undefined);
  assert.equal(toolCallDescription({ description: 1 }), undefined);
});
