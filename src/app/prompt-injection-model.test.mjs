import assert from "node:assert/strict";
import test from "node:test";
import { promptInjectionOps, readPromptInjection } from "./prompt-injection-model.ts";

function namespace(ns, value) {
  return { ns, schema: {}, value, applies: "live", secrets: [], revision: 1 };
}

test("reads the injection text from its namespace", () => {
  assert.equal(readPromptInjection(namespace("deeptop-prompt-injection", { text: "总是先跑测试" })), "总是先跑测试");
  assert.equal(readPromptInjection(namespace("deeptop-prompt-injection", { text: "" })), "");
});

test("tolerates a missing namespace or a malformed value", () => {
  assert.equal(readPromptInjection(undefined), "");
  assert.equal(readPromptInjection(namespace("ns", {})), "");
  assert.equal(readPromptInjection(namespace("ns", { text: 7 })), "");
  assert.equal(readPromptInjection(namespace("ns", undefined)), "");
});

test("preserves surrounding whitespace so the editor round-trips what was typed", () => {
  assert.equal(readPromptInjection(namespace("ns", { text: "  换行前的空格\n\n" })), "  换行前的空格\n\n");
});

test("emits an op only when the text actually changed", () => {
  assert.deepEqual(promptInjectionOps("旧", "旧"), []);
  assert.deepEqual(promptInjectionOps("", "新"), [{ op: "set", path: ["text"], value: "新" }]);
});

test("clearing the text writes an empty string rather than dropping the field", () => {
  assert.deepEqual(promptInjectionOps("旧", ""), [{ op: "set", path: ["text"], value: "" }]);
});
