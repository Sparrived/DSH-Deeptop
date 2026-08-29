import assert from "node:assert/strict";
import test from "node:test";
import { isPrimaryToolArgument, orderedToolArguments, parseToolArgs, toolArgsLayout, toolCallDescription, visibleToolArguments } from "./tool-call-display.ts";

test("extracts a durable tool-call description and omits it from parameter rows", () => {
  const args = parseToolArgs(JSON.stringify({ command: "git status", description: "检查工作区状态", workdir: "D:\\Code" }));
  assert.equal(toolCallDescription(args), "检查工作区状态");
  assert.deepEqual(visibleToolArguments(args), [
    ["command", "git status"],
    ["workdir", "D:\\Code"],
  ]);
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
