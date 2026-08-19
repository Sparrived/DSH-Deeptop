import assert from "node:assert/strict";
import test from "node:test";
import { defaultWorkingIndicator, normalizeWorkingIndicator, workingIndicatorTextAt } from "./working-indicator.ts";

test("normalizes custom texts, color, effect, and interval", () => {
  assert.deepEqual(normalizeWorkingIndicator({
    texts: ["  读取上下文… ", "执行工具", ""],
    color: "#12AbEF",
    effect: "glow",
    rotationInterval: 3500,
  }), {
    texts: ["读取上下文…", "执行工具"],
    color: "#12AbEF",
    effect: "glow",
    rotationInterval: 3500,
  });
});

test("falls back from invalid persisted values", () => {
  assert.deepEqual(normalizeWorkingIndicator({ texts: [""], color: "red", effect: "unknown", rotationInterval: 20 }), { ...defaultWorkingIndicator, rotationInterval: 1200 });
  assert.deepEqual(normalizeWorkingIndicator(null), defaultWorkingIndicator);
});

test("accepts newline text input and bounds the list", () => {
  const value = normalizeWorkingIndicator({ texts: "第一条\n 第二条 \n\n第三条", rotationInterval: 99_999 });
  assert.deepEqual(value.texts, ["第一条", "第二条", "第三条"]);
  assert.equal(value.rotationInterval, 10_000);
});

test("rotates text safely in both directions", () => {
  const settings = { ...defaultWorkingIndicator, texts: ["一", "二", "三"] };
  assert.equal(workingIndicatorTextAt(settings, 0), "一");
  assert.equal(workingIndicatorTextAt(settings, 4), "二");
  assert.equal(workingIndicatorTextAt(settings, -1), "三");
});
