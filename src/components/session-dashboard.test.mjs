import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

/** react 必须保持 external：与测试里的 react-dom 共用同一个实例，否则 hooks 直接抛错。 */
async function renderDashboard(props) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./SessionDashboard.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react"],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, module, module.exports);
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  return renderToStaticMarkup(createElement(module.exports.SessionDashboard, props));
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

/** 一个含失败轮次、重试与重复命令的会话，覆盖成本面板的每个分区。 */
function sampleEntries() {
  const build = JSON.stringify({ command: "npm run build" });
  return [
    entry(1, "turn/start", { turn: 1 }),
    entry(2, "step/start", { turn: 1, step: 1 }),
    entry(3, "assistant/message", { turn: 1, step: 1, usage: { input_tokens: 900, output_tokens: 120 } }),
    entry(4, "step/end", { turn: 1, step: 1 }),
    entry(5, "tool/call", { turn: 1, step: 1, callId: "b1", name: "pwsh", arguments: build }),
    toolResult(6, "b1", "build output ".repeat(40)),
    entry(7, "llm/retry", { turn: 1, step: 1, retry: 1, failure: { code: "RATE_LIMIT" } }),
    entry(8, "turn/end", { turn: 1, reason: { kind: "error", error: { message: "Concurrency limit exceeded" } } }),
    entry(9, "turn/start", { turn: 2 }),
    entry(10, "step/start", { turn: 2, step: 1 }),
    entry(11, "assistant/message", { turn: 2, step: 1, usage: { input_tokens: 700, output_tokens: 90 } }),
    entry(12, "step/end", { turn: 2, step: 1 }),
    entry(13, "tool/call", { turn: 2, step: 1, callId: "b2", name: "pwsh", arguments: build }),
    toolResult(14, "b2", "ok"),
    entry(15, "tool/call", { turn: 2, step: 1, callId: "e1", name: "edit", arguments: "{}" }),
    toolResult(16, "e1", "old_string was not found", { isError: true }),
    entry(17, "turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
}

function baseProps(overrides = {}) {
  return {
    entries: sampleEntries(),
    sessionStats: stats(),
    session: { sessionId: "s1", cwd: "D:\\Code\\DSH-Desktop" },
    active: true,
    running: false,
    elapsedMs: 600_000,
    provider: "amkr-service",
    model: "unified-model",
    locale: "zh",
    ...overrides,
  };
}

test("renders the cost panel with attribution for the active session", async () => {
  const html = await renderDashboard(baseProps());
  assert.match(html, /会话成本计量/);
  assert.match(html, /成本归因/);
  // 失败率、重试、作废轮次、重复执行四个归因指标都要出现。
  assert.match(html, /工具失败率/);
  assert.match(html, /模型重试/);
  assert.match(html, /作废轮次/);
  assert.match(html, /重复执行/);
  // 工具表里必须列出真实工具名，而不是空占位。
  assert.match(html, /pwsh/);
  assert.match(html, /edit/);
  // 重复命令分区展示真实命令与次数。
  assert.match(html, /npm run build/);
  assert.match(html, /2×/);
});

test("renders the English cost panel under the en locale", async () => {
  const html = await renderDashboard(baseProps({ locale: "en" }));
  assert.match(html, /Session cost metering/);
  assert.match(html, /Tool failure rate/);
  assert.match(html, /Repeated commands/);
  assert.match(html, /npm run build/);
});

test("marks failed turns as discarded work in the outcome strip", async () => {
  const html = await renderDashboard(baseProps());
  assert.match(html, /轮次结局/);
  // 结局条按 class 上色，失败轮次必须以 error 类出现。
  assert.match(html, /class="error"/);
});

test("shows the empty-tool state instead of an empty table", async () => {
  const html = await renderDashboard(baseProps({
    entries: [
      entry(1, "turn/start", { turn: 1 }),
      entry(2, "step/start", { turn: 1, step: 1 }),
      entry(3, "turn/end", { turn: 1, reason: { kind: "completed" } }),
    ],
  }));
  assert.match(html, /暂无工具调用/);
  assert.match(html, /没有重复命令/);
});

test("does not render the panel while the dashboard is inactive", async () => {
  const html = await renderDashboard(baseProps({ active: false }));
  assert.equal(html, "");
});

test("keeps rendering the loading state without touching the cost model", async () => {
  const html = await renderDashboard(baseProps({ loading: true }));
  assert.match(html, /正在加载完整会话统计/);
  assert.doesNotMatch(html, /会话成本计量/);
});
