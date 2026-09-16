// 设置分区标识：插件面板用带前缀的复合 id 寻址，因此永远无法与内置分区重名。
import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedSettingsSectionId,
  contributionSectionId,
  isPluginSectionId,
  parsePluginSectionId,
  pluginSectionId,
} from "./settings-section-model.ts";

test("encodes and round-trips a plugin section id", () => {
  const id = pluginSectionId("deeptop.prompt-injection", "settings");
  assert.equal(id, "plugin:deeptop.prompt-injection:settings");
  assert.deepEqual(parsePluginSectionId(id), {
    pluginId: "deeptop.prompt-injection",
    contributionId: "settings",
  });
  assert.equal(isPluginSectionId(id), true);
});

test("keeps the plugin id separable when the contribution id holds a colon", () => {
  // Only the first separator delimits; a contribution id may contain colons.
  assert.deepEqual(parsePluginSectionId("plugin:vendor.plugin:a:b"), {
    pluginId: "vendor.plugin",
    contributionId: "a:b",
  });
});

test("rejects malformed and built-in ids", () => {
  for (const id of ["general", "appearance", "plugin:", "plugin:nocolon", "plugin::contrib", "plugin:plugin:"]) {
    assert.equal(isPluginSectionId(id), false, `${id} must not parse as a plugin section`);
  }
});

test("derives the section id from a registered contribution", () => {
  assert.equal(
    contributionSectionId({ pluginId: "vendor.plugin", contributionId: "panel" }),
    "plugin:vendor.plugin:panel",
  );
});

test("accepts only known built-in sections or well-formed plugin ids", () => {
  assert.equal(acceptedSettingsSectionId("general"), "general");
  assert.equal(acceptedSettingsSectionId("about"), "about");
  assert.equal(acceptedSettingsSectionId("plugin:vendor.plugin:panel"), "plugin:vendor.plugin:panel");
  // An unknown name would leave the content column empty, so it is refused.
  assert.equal(acceptedSettingsSectionId("nope"), undefined);
  assert.equal(acceptedSettingsSectionId("plugin:broken"), undefined);
});
