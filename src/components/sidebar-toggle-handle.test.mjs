// 侧栏收起把手的契约：位置与外观由 15-final-overrides.css 负责（绝对定位在
// 侧栏内部、贴住右内边距并垂直居中），因此这里只锁定按钮自身的可访问名称、
// 展开状态与图标。

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

/** react 必须保持 external：与测试里的 react-dom 共用同一个实例。 */
async function renderHandle(collapsed) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./SidebarToggleHandle.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react"],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, module, module.exports);
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  return renderToStaticMarkup(createElement(module.exports.SidebarToggleHandle, {
    locale: "zh",
    collapsed,
    onToggle() {},
  }));
}

test("offers to collapse while the sidebar is expanded", async () => {
  const html = await renderHandle(false);
  assert.match(html, /^<button class="sidebar-toggle-handle" type="button"/);
  assert.match(html, /aria-label="收起侧栏"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls="session-sidebar"/);
  assert.match(html, /lucide-panel-left-close/);
});

test("offers to expand while the sidebar is collapsed", async () => {
  const html = await renderHandle(true);
  assert.match(html, /aria-label="展开侧栏"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /lucide-panel-left-open/);
});
