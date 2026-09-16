// Schema 表单的控件选择：`meta.role` 决定控件，而不是节点类型之外的隐式规则。
// 这里用真实渲染锁定「多行文本用 textarea」「secret 用只写密码框」两条用户可见契约。

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

/** react 必须保持 external，与测试里的 react-dom 共用同一个实例，否则 hooks 直接抛错。 */
async function renderForm(namespace) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./SchemaFormPanel.tsx", import.meta.url))],
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
  return renderToStaticMarkup(createElement(module.exports.SchemaFormPanel, {
    namespace,
    onSave() {},
    onCancel() {},
    saving: false,
    locale: "zh",
  }));
}

/** A namespace whose single `text` field carries the given schema node. */
function namespaceWith(node, value) {
  return {
    ns: "deeptop-test",
    schema: { uid: 0, refs: { 0: { type: "object", meta: {}, dict: { text: 1 } }, 1: node } },
    value,
    user: value,
    applies: "live",
    secrets: [],
    revision: 1,
  };
}

test("renders a role('textarea') string field as a multi-line editor", async () => {
  const html = await renderForm(namespaceWith(
    { type: "string", meta: { role: "textarea", description: "注入到每个 Session" } },
    { text: "第一行\n第二行" },
  ));
  assert.match(html, /<textarea/);
  assert.match(html, /第一行/);
  assert.match(html, /注入到每个 Session/);
  // A textarea must not also emit the single-line input for the same field.
  assert.doesNotMatch(html, /<input[^>]*type="text"/);
});

test("keeps a plain string field single-line with no role", async () => {
  const html = await renderForm(namespaceWith({ type: "string", meta: {} }, { text: "值" }));
  assert.match(html, /<input[^>]*type="text"/);
  assert.doesNotMatch(html, /<textarea/);
});

test("renders a secret field write-only so the stored value never reaches the DOM", async () => {
  const html = await renderForm(namespaceWith(
    { type: "string", meta: { role: "secret" } },
    { text: "sk-should-not-appear" },
  ));
  assert.match(html, /<input[^>]*type="password"/);
  assert.doesNotMatch(html, /sk-should-not-appear/);
  // A secret is never a textarea, whatever else the node declares.
  assert.doesNotMatch(html, /<textarea/);
});
