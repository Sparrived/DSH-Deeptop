import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

async function loadCurrentGoalBar() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./CurrentGoalBar.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}

const activeGoal = {
  id: "goal-1",
  revision: 1,
  objective: "Move the Goal under the conversation title",
  maxGoalRounds: 5,
  phase: "active",
};

test("hides without a Goal and keeps the collapsed pill operable", async () => {
  const { CurrentGoalBar } = await loadCurrentGoalBar();
  assert.equal(CurrentGoalBar({ activeGoal: null, roundsStarted: 0, collapsed: true, onOpen() {}, onToggleCollapsed() {}, onTogglePhase() {} }), null);

  let toggled = 0;
  const bar = CurrentGoalBar({
    activeGoal,
    roundsStarted: 2,
    collapsed: true,
    onOpen() {},
    onToggleCollapsed() { toggled++; },
    onTogglePhase() {},
  });
  const toggle = bar.props.children;

  assert.equal(bar.props.className, "current-goal-bar active collapsed");
  assert.equal(toggle.props["aria-expanded"], false);
  assert.equal(toggle.props.children[0].props.className, "current-goal-mark");
  assert.equal(toggle.props.children[1].type.displayName, "ChevronsLeft");
  toggle.props.onClick();
  assert.equal(toggled, 1);
});

test("keeps the objective, round ticks and inline phase control on the expanded bar", async () => {
  const { CurrentGoalBar } = await loadCurrentGoalBar();
  let paused = 0;
  const bar = CurrentGoalBar({
    activeGoal,
    roundsStarted: 2,
    collapsed: false,
    onOpen() {},
    onToggleCollapsed() {},
    onTogglePhase() { paused++; },
  });
  const [main, quick, manage, toggle] = bar.props.children;
  const [lead, meta] = main.props.children[1].props.children;
  const [status, objective] = lead.props.children;
  const [rounds, label] = meta.props.children;

  assert.equal(status.props.children[1], "进行中");
  assert.equal(objective.props.children, activeGoal.objective);
  assert.equal(rounds.props.className, "current-goal-rounds ticks");
  assert.deepEqual(rounds.props.children.map((tick) => tick.props.className), ["done", "done", "", "", ""]);
  assert.equal(label.props.children.find((child) => typeof child === "object").props.children.join(""), "2 / 5");
  assert.equal(quick.props.children.type.displayName, "Pause");
  assert.equal(manage.props.children, "管理");
  assert.equal(toggle.props.children.type.displayName, "ChevronsRight");
  quick.props.onClick();
  assert.equal(paused, 1);
});

test("shows the blocked reason and offers resume", async () => {
  const { CurrentGoalBar } = await loadCurrentGoalBar();
  let resumed = 0;
  const bar = CurrentGoalBar({
    activeGoal: { ...activeGoal, phase: "blocked", blockedReason: { message: "vendor/dsh 未同步" } },
    roundsStarted: 5,
    collapsed: false,
    onOpen() {},
    onToggleCollapsed() {},
    onTogglePhase() { resumed++; },
  });
  const [main, quick] = bar.props.children;
  const meta = main.props.children[1].props.children[1];
  const reason = meta.props.children[2];

  assert.equal(bar.props.className, "current-goal-bar blocked");
  assert.equal(reason.props.className, "current-goal-reason");
  assert.equal(reason.props.children, "vendor/dsh 未同步");
  assert.equal(quick.props.children.type.displayName, "Play");
  quick.props.onClick();
  assert.equal(resumed, 1);
});

test("falls back to a continuous track for large round budgets", async () => {
  const { CurrentGoalBar } = await loadCurrentGoalBar();
  const bar = CurrentGoalBar({
    activeGoal: { ...activeGoal, maxGoalRounds: 40 },
    roundsStarted: 10,
    collapsed: false,
    onOpen() {},
    onToggleCollapsed() {},
    onTogglePhase() {},
  });
  const rounds = bar.props.children[0].props.children[1].props.children[1].props.children[0];

  assert.equal(rounds.props.className, "current-goal-rounds track");
  assert.equal(rounds.props.children.props.style.width, "25%");
});
