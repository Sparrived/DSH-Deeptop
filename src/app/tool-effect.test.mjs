import assert from "node:assert/strict";
import test from "node:test";
import { defaultToolEffect, normalizeToolEffect, toolEffectClass, toolEffectInk, TOOL_EFFECTS } from "./tool-effect.ts";

test("defaults to no effect so tool rows keep their current look", () => {
  assert.deepEqual(defaultToolEffect, { effect: "none", color: "#d6a15b", opacity: 0.6 });
  assert.deepEqual(normalizeToolEffect(undefined), defaultToolEffect);
  assert.deepEqual(normalizeToolEffect("glow"), defaultToolEffect);
  assert.deepEqual(normalizeToolEffect([]), defaultToolEffect);
});

test("normalizes custom effect, color, and opacity", () => {
  assert.deepEqual(normalizeToolEffect({ effect: "marquee", color: "#12AbEF", opacity: 0.35 }), {
    effect: "marquee",
    color: "#12AbEF",
    opacity: 0.35,
  });
});

test("falls back from invalid persisted values and bounds opacity", () => {
  assert.deepEqual(normalizeToolEffect({ effect: "unknown", color: "red", opacity: 4 }), { ...defaultToolEffect, opacity: 1 });
  assert.deepEqual(normalizeToolEffect({ effect: "ants", opacity: -3 }), { ...defaultToolEffect, effect: "ants", opacity: 0 });
});

test("derives the container class from the normalized effect", () => {
  assert.equal(toolEffectClass(defaultToolEffect), "tool-effect-none");
  assert.equal(toolEffectClass({ ...defaultToolEffect, effect: "sheen" }), "tool-effect-sheen");
  assert.equal(toolEffectClass({ effect: "nope" }), "tool-effect-none");
});

test("mixes color and opacity into one rgba ink", () => {
  assert.equal(toolEffectInk({ effect: "glow", color: "#FFFFFF", opacity: 1 }), "rgba(255, 255, 255, 1)");
  assert.equal(toolEffectInk({ effect: "glow", color: "#000000", opacity: 0.5 }), "rgba(0, 0, 0, 0.5)");
  assert.equal(toolEffectInk({ color: "#nothex" }), "rgba(214, 161, 91, 0.6)");
});

test("keeps a stable order for the settings dropdown", () => {
  assert.deepEqual(TOOL_EFFECTS, ["none", "glow", "marquee", "ants", "sheen"]);
});
