import assert from "node:assert/strict";
import test from "node:test";
import { defaultWorkingIndicator, normalizeWorkingIndicator, workingIndicatorEffectClass, workingIndicatorTextAt } from "./working-indicator.ts";

test("normalizes custom texts, color, effect, and interval", () => {
  assert.deepEqual(normalizeWorkingIndicator({
    texts: ["  读取上下文… ", "执行工具", ""],
    color: "#12AbEF",
    gradientColor: "#FF00AA",
    effect: "glow",
    shimmerStyle: "rainbow",
    rotationInterval: 3500,
  }), {
    texts: ["读取上下文…", "执行工具"],
    color: "#12AbEF",
    gradientColor: "#FF00AA",
    effect: "glow",
    shimmerStyle: "rainbow",
    rotationInterval: 3500,
  });
});

test("falls back from invalid persisted values", () => {
  assert.deepEqual(normalizeWorkingIndicator({ texts: [""], color: "red", gradientColor: "blue", effect: "unknown", shimmerStyle: "plasma", rotationInterval: 20 }), { ...defaultWorkingIndicator, rotationInterval: 1200 });
  assert.deepEqual(normalizeWorkingIndicator(null), defaultWorkingIndicator);
});

test("accepts the hidden effect and derives the effect class", () => {
  assert.equal(normalizeWorkingIndicator({ effect: "hidden" }).effect, "hidden");
  assert.equal(workingIndicatorEffectClass({ ...defaultWorkingIndicator, effect: "hidden" }), "effect-hidden");
  assert.equal(workingIndicatorEffectClass({ ...defaultWorkingIndicator, shimmerStyle: "rainbow" }), "effect-shimmer shimmer-rainbow");
  assert.equal(workingIndicatorEffectClass({ ...defaultWorkingIndicator, shimmerStyle: "gradient" }), "effect-shimmer shimmer-gradient");
  assert.equal(workingIndicatorEffectClass({ ...defaultWorkingIndicator, effect: "pulse" }), "effect-pulse");
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
