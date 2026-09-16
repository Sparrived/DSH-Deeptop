// 插件设置分区的宿主渲染：导航项与内容面板都由 settings.sections 的贡献驱动，
// 主程序不出现任何插件名字。这里用真实渲染锁定「有贡献才出导航」「只挂载选中面板」两条契约。

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

/**
 * Bundle the components together with the real SlotRegistry so the tests drive
 * the same entries the runtime produces at activation time. react stays
 * external because the hooks must share one instance with react-dom/server.
 */
async function loadComponents() {
  const components = fileURLToPath(new URL("./SettingsPluginSections.tsx", import.meta.url));
  const registry = fileURLToPath(new URL("../lib/desktop-ui-runtime/slot-registry.ts", import.meta.url));
  const compiled = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(components)};\nexport { SlotRegistry } from ${JSON.stringify(registry)};\n`,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react"],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

/**
 * A real SlotRegistry driven through its public `register`, so the tests
 * exercise the same entries the runtime produces at activation time.
 */
function registryWith(SlotRegistry, contributions) {
  const slots = new SlotRegistry();
  for (const item of contributions) {
    slots.register(item.pluginId, ["settings.sections"], "settings.sections", {
      kind: item.kind,
      id: item.contributionId,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.render !== undefined ? { render: item.render } : {}),
    });
  }
  return slots;
}

const baseContext = {
  session: null,
  activeSessionId: null,
  sessionGeneration: 0,
  locale: "zh",
  host: { prompt: async () => "", notify: () => undefined },
};

function panelContribution(pluginId, contributionId, label, render) {
  return { pluginId, contributionId, kind: "panel", label, render };
}

test("names the nav entry from the contribution and marks the selected section", async () => {
  const { SettingsPluginSectionNav, SlotRegistry } = await loadComponents();
  const { renderToStaticMarkup } = require("react-dom/server");
  const runtime = { slots: registryWith(SlotRegistry, [panelContribution("vendor.prompt-injection", "settings", "提示词注入", () => null)]) };
  const html = renderToStaticMarkup(createElement(SettingsPluginSectionNav, {
    runtime,
    activeSectionId: "plugin:vendor.prompt-injection:settings",
    locale: "zh",
    onSelectSection() {},
  }));
  assert.match(html, /提示词注入/);
  // The section id is the nav's own data attribute, so selection is observable.
  assert.match(html, /data-plugin-section="plugin:vendor\.prompt-injection:settings"/);
  assert.match(html, /class="selected"/);
});

test("resolves a function label against the live locale instead of the activation locale", async () => {
  const { SettingsPluginSectionNav, SlotRegistry } = await loadComponents();
  const { renderToStaticMarkup } = require("react-dom/server");
  // A translated label is a function because activate() runs only once; the nav
  // must therefore re-read the locale on every render or the section name
  // freezes in whichever language was active when the plugin loaded.
  const runtime = { slots: registryWith(SlotRegistry, [
    panelContribution("vendor.a", "settings", (locale) => locale === "en" ? "Injection" : "提示词注入", () => null),
  ]) };
  const render = (locale) => renderToStaticMarkup(createElement(SettingsPluginSectionNav, {
    runtime,
    activeSectionId: "general",
    locale,
    onSelectSection() {},
  }));
  assert.match(render("zh"), /提示词注入/);
  assert.match(render("en"), /Injection/);
});

test("renders no nav at all while no plugin contributes a settings panel", async () => {
  const { SettingsPluginSectionNav, SlotRegistry } = await loadComponents();
  const { renderToStaticMarkup } = require("react-dom/server");
  // A non-panel contribution in the same slot must not create a nav entry.
  const runtime = { slots: registryWith(SlotRegistry, [{
    pluginId: "vendor.x",
    contributionId: "b",
    kind: "badge",
    label: "badge",
    render: () => createElement("span", null, "not-a-panel"),
  }]) };
  const html = renderToStaticMarkup(createElement(SettingsPluginSectionNav, {
    runtime,
    activeSectionId: "general",
    locale: "zh",
    onSelectSection() {},
  }));
  assert.equal(html, "");
});

test("mounts only the selected plugin panel, not its siblings", async () => {
  const { SettingsPluginSectionPanel, SlotRegistry } = await loadComponents();
  const { renderToStaticMarkup } = require("react-dom/server");
  const runtime = { slots: registryWith(SlotRegistry, [
    panelContribution("vendor.a", "settings", "A", () => createElement("span", null, "panel-a")),
    panelContribution("vendor.b", "settings", "B", () => createElement("span", null, "panel-b")),
  ]) };
  const html = renderToStaticMarkup(createElement(SettingsPluginSectionPanel, {
    runtime,
    context: baseContext,
    activeSectionId: "plugin:vendor.b:settings",
  }));
  assert.match(html, /panel-b/);
  assert.doesNotMatch(html, /panel-a/);
});
