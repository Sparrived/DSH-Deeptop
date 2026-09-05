import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RAIL_ITEMS,
  loadedTurnFacts,
  mergeTurnRailItems,
  outlineEntry,
  railPreview,
} from "./turn-rail-model.ts";

function userEntry(seq, turn, content) {
  return {
    event: { seq, time: 1000 + seq, type: "user/message", data: { turn, step: 1, content: [{ type: "text", text: content }] } },
  };
}

function assistantEntry(seq, turn, content) {
  return {
    event: { seq, time: 1000 + seq, type: "assistant/message", data: { turn, step: 2, message: { content: [{ type: "text", text: content }] } } },
  };
}

function injectedUserEntry(seq, turn, content) {
  return {
    event: {
      seq,
      time: 1000 + seq,
      type: "user/message",
      data: { turn, step: 1, content: [{ type: "text", text: content }], source: { kind: "file" } },
    },
  };
}

test("railPreview collapses whitespace and caps with an ellipsis", () => {
  assert.equal(railPreview("", 50), "");
  assert.equal(railPreview("  hello   world \n", 50), "hello world");
  const long = "x".repeat(200);
  const capped = railPreview(long, 50);
  assert.equal(capped.length, 50);
  assert.ok(capped.endsWith("…"));
  assert.equal(capped.replace(/…$/, ""), "x".repeat(49));
});

test("outlineEntry narrows wire entries and drops malformed ones", () => {
  assert.deepEqual(
    outlineEntry({ turn: 1, seq: 4, prompt: "hi", response: "yo" }),
    { turn: 1, seq: 4, prompt: "hi", response: "yo" },
  );
  assert.equal(outlineEntry({ turn: 1.5, seq: 4 }), undefined);
  assert.equal(outlineEntry({ turn: -1, seq: 4 }), undefined);
  assert.equal(outlineEntry({ turn: 1, seq: -0 }), undefined);
  assert.equal(outlineEntry(null), undefined);
  // Malformed previews degrade, the turn stays navigable by number.
  assert.deepEqual(outlineEntry({ turn: 2, seq: 9, prompt: 42 }), { turn: 2, seq: 9, prompt: "", response: "" });
});

test("loadedTurnFacts derives one ascending fact per turn from a paged window", () => {
  // Newest-first wire page order must still yield turn-ascending facts.
  const entries = [
    assistantEntry(20, 2, "second reply"),
    userEntry(10, 1, "first question"),
    assistantEntry(11, 1, "first reply"),
    userEntry(30, 3, "third question"),
  ];
  assert.deepEqual(loadedTurnFacts(entries), [
    { turn: 1, prompt: "first question", response: "first reply", seq: 10 },
    { turn: 2, prompt: "", response: "second reply", seq: 20 },
    { turn: 3, prompt: "third question", response: "", seq: 30 },
  ]);
});

test("loadedTurnFacts ignores injected context messages and keeps the earliest anchor seq", () => {
  const entries = [
    injectedUserEntry(5, 1, "file content excerpt"),
    userEntry(6, 1, "the real question"),
    assistantEntry(12, 1, "a reply"),
    userEntry(7, 1, "a later clarification in the same turn"),
  ];
  const facts = loadedTurnFacts(entries);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], { turn: 1, prompt: "the real question", response: "a reply", seq: 5 });
});

test("mergeTurnRailItems merges loaded window with outline into an ascending ladder", () => {
  const loaded = [
    { turn: 1, prompt: "first question", response: "first reply", seq: 10 },
    { turn: 3, prompt: "third question", response: "", seq: 30 },
  ];
  const outline = [
    { turn: 1, seq: 3, prompt: "stale", response: "stale" },
    { turn: 2, seq: 21, prompt: "second", response: "second reply" },
    { turn: 5, seq: 60, prompt: "fifth", response: "" },
    { turn: 3.5, seq: 40 }, // malformed, dropped
  ];
  const merged = mergeTurnRailItems(loaded, outline);
  assert.deepEqual(merged, [
    { turn: 1, prompt: "first question", response: "first reply", anchor: { kind: "loaded", seq: 10 } },
    { turn: 2, prompt: "second", response: "second reply", anchor: { kind: "unloaded", seq: 21 } },
    { turn: 3, prompt: "third question", response: "", anchor: { kind: "loaded", seq: 30 } },
    { turn: 5, prompt: "fifth", response: "", anchor: { kind: "unloaded", seq: 60 } },
  ]);
});

test("mergeTurnRailItems fills empty window previews from the outline", () => {
  const loaded = [{ turn: 2, prompt: "", response: "", seq: 22 }];
  const merged = mergeTurnRailItems(loaded, [{ turn: 2, seq: 1, prompt: "from outline", response: "" }]);
  assert.deepEqual(merged, [
    { turn: 2, prompt: "from outline", response: "", anchor: { kind: "loaded", seq: 22 } },
  ]);
});

test("mergeTurnRailItems degrades to a stable empty ladder for absent outline", () => {
  assert.equal(mergeTurnRailItems([], null), EMPTY_RAIL_ITEMS);
  assert.equal(mergeTurnRailItems([], { not: "an array" }).length, 0);
  assert.equal(mergeTurnRailItems([], [{ turn: 0, seq: 0, prompt: "", response: "" }])[0].turn, 0);
});
