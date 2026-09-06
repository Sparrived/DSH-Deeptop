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
  objective: "Move the Goal into the conversation title row",
  maxGoalRounds: 5,
  phase: "active",
};

test("hides without a Goal and keeps the collapsed title-row control operable", async () => {
  const { CurrentGoalBar } = await loadCurrentGoalBar();
  assert.equal(CurrentGoalBar({ activeGoal: null, roundsStarted: 0, collapsed: true, onOpen() {}, onToggleCollapsed() {} }), null);

  let opened = 0;
  let toggled = 0;
  const bar = CurrentGoalBar({
    activeGoal,
    roundsStarted: 2,
    collapsed: true,
    onOpen() { opened++; },
    onToggleCollapsed() { toggled++; },
  });
  const [main, , toggle] = bar.props.children;

  assert.equal(bar.props.className, "current-goal-bar active collapsed");
  assert.equal(toggle.props["aria-expanded"], false);
  assert.equal(main.props.disabled, true);
  main.props.onClick();
  toggle.props.onClick();
  assert.equal(opened, 1);
  assert.equal(toggled, 1);
});
