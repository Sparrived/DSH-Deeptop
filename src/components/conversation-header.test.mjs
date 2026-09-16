import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

const overridesCss = readFileSync(
  fileURLToPath(new URL("../styles/15-final-overrides.css", import.meta.url)),
  "utf8",
);

const activeGoal = { id: "goal-1", revision: 1, objective: "完成登录模块并补充 e2e 测试", maxGoalRounds: 4, phase: "active" };
const activeSession = { sessionId: "session-1", cwd: "D:\\Code\\DSH-Desktop", projections: { values: {} } };

/** react 必须保持 external：与测试里的 react-dom 共用同一个实例，否则 hooks 直接抛错。 */
async function renderHeader(overrides = {}) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./ConversationHeader.tsx", import.meta.url))],
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
  return renderToStaticMarkup(createElement(module.exports.ConversationHeader, {
    locale: "zh",
    activeSession: null,
    presets: [],
    runtimeDirectory: "D:\\Code\\DSH-Desktop",
    notice: "",
    noticeIsError: false,
    queueCount: 0,
    activeGoal: null,
    goalRoundsStarted: 0,
    goalCollapsed: false,
    goalBusy: false,
    conversationPageActive: true,
    trajectoryOpen: false,
    sessionDashboardOpen: false,
    onOpenGoal() {},
    onToggleGoalCollapsed() {},
    onToggleGoalPhase() {},
    onToggleTrajectory() {},
    onToggleSessionDashboard() {},
    ...overrides,
  }));
}

test("offers the create entry while the session has no goal", async () => {
  const html = await renderHeader({ activeSession });
  assert.match(html, /class="current-goal-create"/);
  assert.match(html, /创建 Goal/);
  assert.doesNotMatch(html, /current-goal-bar/);
});

test("hides the create entry before a session exists", async () => {
  assert.doesNotMatch(await renderHeader(), /current-goal-create/);
});

test("replaces the create entry with the goal bar once a goal exists", async () => {
  const html = await renderHeader({ activeSession, activeGoal, goalRoundsStarted: 2, goalCollapsed: false });
  assert.match(html, /current-goal-bar active/);
  assert.doesNotMatch(html, /current-goal-create/);
});

test("keeps goal chrome off the trajectory and dashboard pages", async () => {
  const trajectory = await renderHeader({ activeSession, conversationPageActive: false, trajectoryOpen: true });
  const dashboard = await renderHeader({ activeSession, conversationPageActive: false, sessionDashboardOpen: true });
  assert.doesNotMatch(trajectory, /current-goal-(create|bar)/);
  assert.doesNotMatch(dashboard, /current-goal-(create|bar)/);
});

test("never lets the expanded goal bar squeeze the header actions out of view", () => {
  // 回归：.conversation-actions 先前是可收缩的 flex 项，Goal 条展开把标题区撑宽后
  // 「轨迹 / 会话看板」被推出头部内边距裁掉；它必须保留自身宽度，只让标题区收缩。
  const actions = /\.conversation-actions\s*\{[^}]*\}/.exec(overridesCss)?.[0];
  assert.ok(actions, "the conversation actions rule is missing from the stylesheet");
  assert.match(actions, /flex:\s*0\s+0\s+auto/);
});
