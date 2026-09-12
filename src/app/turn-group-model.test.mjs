import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStepToggle,
  groupTranscriptTurns,
  stepKindCounts,
} from "./turn-group-model.ts";

let nextSeq = 0;

function row(kind, extra = {}) {
  nextSeq += 1;
  return { key: `${kind}-${nextSeq}`, kind, label: kind, text: kind, seq: nextSeq, ...extra };
}

function prompt(text = "fix it") {
  return row("user", { text });
}

function answer(text = "done") {
  return row("assistant", { text });
}

function kinds(group) {
  return {
    head: group.head.map((item) => item.kind),
    steps: group.steps.map((item) => item.kind),
    tail: group.tail.map((item) => item.kind),
  };
}

test("a settled turn keeps the prompt and the last answer visible", () => {
  const groups = groupTranscriptTurns([
    prompt(),
    row("reasoning"),
    row("assistant", { text: "let me look" }),
    row("tool"),
    row("tool"),
    answer(),
    row("system"),
  ], false);

  assert.equal(groups.length, 1);
  assert.deepEqual(kinds(groups[0]), {
    head: ["user"],
    steps: ["reasoning", "assistant", "tool", "tool"],
    tail: ["assistant", "system"],
  });
  assert.equal(groups[0].live, false);
  assert.equal(groups[0].key, groups[0].head[0].key);
});

test("two prompts split into two turns with independent steps", () => {
  const groups = groupTranscriptTurns([
    prompt("first"),
    row("reasoning"),
    answer("first answer"),
    prompt("second"),
    row("tool"),
    answer("second answer"),
  ], false);

  assert.equal(groups.length, 2);
  assert.deepEqual(kinds(groups[0]), { head: ["user"], steps: ["reasoning"], tail: ["assistant"] });
  assert.deepEqual(kinds(groups[1]), { head: ["user"], steps: ["tool"], tail: ["assistant"] });
});

test("a turn without intermediate work is not collapsible", () => {
  const groups = groupTranscriptTurns([prompt(), answer()], false);
  assert.deepEqual(kinds(groups[0]), { head: ["user", "assistant"], steps: [], tail: [] });
});

test("trailing work with no answer collapses into the step block", () => {
  const groups = groupTranscriptTurns([prompt(), row("tool"), row("tool")], false);
  assert.deepEqual(kinds(groups[0]), { head: ["user"], steps: ["tool", "tool"], tail: [] });
});

test("injected context before the prompt stays in the head", () => {
  const groups = groupTranscriptTurns([
    row("system", { injected: true }),
    prompt(),
    row("tool"),
    answer(),
  ], false);
  assert.deepEqual(kinds(groups[0]), { head: ["system", "user"], steps: ["tool"], tail: ["assistant"] });
});

test("a window starting mid-turn keeps earlier rows in head when there is no step", () => {
  const groups = groupTranscriptTurns([row("tool"), row("tool")], false);
  assert.deepEqual(kinds(groups[0]), { head: [], steps: ["tool", "tool"], tail: [] });
});

test("a streaming row keeps its own turn live", () => {
  const groups = groupTranscriptTurns([
    prompt("first"),
    row("reasoning"),
    answer("first answer"),
    prompt("second"),
    row("reasoning", { streaming: true }),
    row("assistant", { text: "partial", streaming: true }),
  ], true);

  assert.equal(groups[0].live, false);
  assert.equal(groups[1].live, true);
});

test("a running session keeps its newest turn live, and only that one", () => {
  const items = [prompt(), row("tool"), answer(), prompt(), row("tool"), answer()];
  const idle = groupTranscriptTurns(items, false);
  const running = groupTranscriptTurns(items, true);

  assert.deepEqual(idle.map((group) => group.live), [false, false]);
  assert.deepEqual(running.map((group) => group.live), [false, true]);
  // The newest turn already streamed to a standstill: it stays expanded while
  // the session is still running, then settles when the run ends.
  assert.equal(groupTranscriptTurns(items, true)[1].steps.length, 1);
});

test("stepKindCounts counts only intermediate kinds", () => {
  assert.deepEqual(stepKindCounts([row("reasoning"), row("tool"), row("tool"), row("system"), row("workflow")]), {
    reasoning: 1,
    tool: 2,
    system: 1,
    workflow: 1,
  });
  assert.deepEqual(stepKindCounts([]), { reasoning: 0, tool: 0, system: 0, workflow: 0 });
});

test("applyStepToggle only records a state that differs from the automatic one", () => {
  // A settled turn: the automatic state is closed, so opening records an override.
  const opened = applyStepToggle({}, "turn-1", true, false);
  assert.deepEqual(opened, { "turn-1": true });
  assert.equal(applyStepToggle(opened, "turn-1", true, false), opened);

  // Collapsing back to the automatic state drops the override again, so the
  // browser's own toggle events can never pin a turn closed.
  assert.deepEqual(applyStepToggle(opened, "turn-1", false, false), {});
  assert.deepEqual(applyStepToggle({}, "turn-1", false, false), {});

  // A live turn is open automatically: collapsing it is the override.
  assert.deepEqual(applyStepToggle({}, "turn-2", false, true), { "turn-2": false });
  assert.deepEqual(applyStepToggle({ "turn-2": false }, "turn-2", true, true), {});
});
