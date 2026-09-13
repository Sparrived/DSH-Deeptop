import assert from "node:assert/strict";
import test from "node:test";
import { displayToolName, hasVisibleToolArguments, isPrimaryToolArgument, orderedToolArguments, parseToolArgs, toolArgsLayout, toolCallDescription, toolCallEditDiff, toolCallOpenLine, toolCallSummary, toolQuestionItems, toolTodoItems, visibleToolArguments } from "./tool-call-display.ts";

test("formats MCP tool names without the internal prefix", () => {
  assert.equal(displayToolName("mcp__vendor__read"), "vendor · read");
  assert.equal(displayToolName("mcp__server__tool__with__underscores"), "server · tool__with__underscores");
  assert.equal(displayToolName(" read "), "read");
  assert.equal(displayToolName(undefined), "");
});

test("extracts a durable tool-call description and omits it from parameter rows", () => {
  const args = parseToolArgs(JSON.stringify({ command: "git status", description: "检查工作区状态", workdir: "D:\\Code" }));
  assert.equal(toolCallDescription(args), "检查工作区状态");
  assert.deepEqual(visibleToolArguments("pwsh", args), [
    ["command", "git status"],
    ["workdir", "D:\\Code"],
  ]);
});

test("recognizes calls that have no parameter surface", () => {
  assert.equal(hasVisibleToolArguments("job_list", {}), false);
  assert.equal(hasVisibleToolArguments("job_list", { description: "列出后台任务" }), false);
  assert.equal(hasVisibleToolArguments("job_list", { description: 1 }), true);
  assert.equal(hasVisibleToolArguments("job_list", undefined), false);
  assert.equal(hasVisibleToolArguments("job_output", { job_id: "pwsh-19" }), true);
  assert.equal(hasVisibleToolArguments("edit", {
    file_path: "src/app/tool-call-display.ts",
    old_string: "before",
    new_string: "after",
  }), true);
});

test("narrows todo_write arguments into visible task rows", () => {
  assert.deepEqual(toolTodoItems([
    { content: "运行验证", status: "in_progress" },
    { content: "提交改动", status: "pending" },
    { content: "  完成设计  ", status: "completed" },
  ]), [
    { content: "运行验证", status: "in_progress" },
    { content: "提交改动", status: "pending" },
    { content: "完成设计", status: "completed" },
  ]);
  assert.equal(toolTodoItems({ content: "not-a-list", status: "pending" }), undefined);
  assert.equal(toolTodoItems([{ content: "缺少状态" }]), undefined);
  assert.equal(toolTodoItems([{ content: "未知状态", status: "blocked" }]), undefined);
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

test("narrows ask_user_question arguments into the asked questions", () => {
  assert.deepEqual(toolQuestionItems([
    {
      id: "release",
      header: "发布渠道",
      question: "选择发布渠道",
      options: [{ label: "GitHub", description: "公开可见" }, { label: "内测" }],
      multi_select: true,
    },
    { id: "confirm", question: "确认继续？" },
  ]), [
    {
      id: "release",
      header: "发布渠道",
      question: "选择发布渠道",
      options: [{ label: "GitHub", description: "公开可见" }, { label: "内测" }],
      multiSelect: true,
    },
    { id: "confirm", question: "确认继续？" },
  ]);
  // 空选项列表等同于没有选项；不补一个空清单。
  assert.deepEqual(toolQuestionItems([{ id: "a", question: "问一句", options: [] }]), [{ id: "a", question: "问一句" }]);
});

test("declines malformed ask_user_question arguments instead of dropping one question", () => {
  assert.equal(toolQuestionItems(undefined), undefined);
  assert.equal(toolQuestionItems([]), undefined);
  // 缺少问题原文：整批放弃，避免只显示一部分被问到的问题。
  assert.equal(toolQuestionItems([{ id: "a", question: "有效" }, { id: "b", question: "  " }]), undefined);
  assert.equal(toolQuestionItems([{ question: "缺少 id" }]), undefined);
  // 选项形状不对时同样整批放弃，而不是把选项悄悄丢掉。
  assert.equal(toolQuestionItems([{ id: "a", question: "问一句", options: [{ description: "没有 label" }] }]), undefined);
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
  assert.equal(toolCallSummary("write_todo", { todos: [{ content: "运行验证", status: "in_progress" }] }), "运行验证");
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

test("derives the 1-based open line from a read call's offset", () => {
  assert.equal(toolCallOpenLine("read", { file_path: "src/App.tsx", offset: 42 }), 42);
  assert.equal(toolCallOpenLine(" read ", { offset: 7.9 }), 7);
  assert.equal(toolCallOpenLine("read_file", { offset: 3 }), 3);
  // 只有读取类工具的 offset 表示起始行；写入/编辑/终端的 offset 不参与定位。
  assert.equal(toolCallOpenLine("write", { offset: 42 }), undefined);
  assert.equal(toolCallOpenLine("pwsh", { offset: 42 }), undefined);
  assert.equal(toolCallOpenLine("read", {}), undefined);
  assert.equal(toolCallOpenLine("read", undefined), undefined);
  assert.equal(toolCallOpenLine(undefined, { offset: 1 }), undefined);
  // 非法 offset 不产生定位行，打开文件时按文件开头显示。
  assert.equal(toolCallOpenLine("read", { offset: 0 }), undefined);
  assert.equal(toolCallOpenLine("read", { offset: -5 }), undefined);
  assert.equal(toolCallOpenLine("read", { offset: "42" }), undefined);
  assert.equal(toolCallOpenLine("read", { offset: Number.NaN }), undefined);
});
