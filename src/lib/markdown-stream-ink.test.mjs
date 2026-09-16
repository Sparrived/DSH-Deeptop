// 端到端确认渐显真的落到了 DOM 上：用真实 React 渲染 MarkdownContent，
// 检查刚写下的那几段文字是不是真的带上了 `span.stream-ink` 和负延迟。
// （别的测试用手写的 react 替身，这里必须用真的 react-dom/server，
//   否则验不到「hast 的 style 字符串 → React style」「源码位置 → 切分」这两跳。）

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const requireFromTest = createRequire(import.meta.url);

async function loadMarkdownContent() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./markdown.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    jsx: "automatic",
    external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(requireFromTest, module, module.exports);
  return module.exports;
}

async function render(text, streamInk) {
  const { MarkdownContent } = await loadMarkdownContent();
  const { createElement } = requireFromTest("react");
  const { renderToStaticMarkup } = requireFromTest("react-dom/server");
  return renderToStaticMarkup(createElement(MarkdownContent, { text, streamInk }));
}

test("刚写下的那段文字带着负延迟动画出现在 HTML 里", async () => {
  const html = await render("hello world", { now: 400, chunks: [{ from: 6, to: 11, at: 250 }] });

  // 两段都在：先写下的 "hello " 是普通文本，刚落笔的 "world" 才是渐显段。
  assert.match(html, /class="stream-ink"/u);
  assert.match(html, /animation-delay:-150ms/u);
  const spans = html.match(/class="stream-ink"/gu) ?? [];
  assert.equal(spans.length, 1);
  assert.match(html, /<span class="stream-ink"[^>]*>world<\/span>/u);
});

test("一次爆发写出的多行按分组带递延，整段而不是最后一行才有渐显", async () => {
  const text = "first line\n\nsecond line\n\nthird line";
  const html = await render(text, { now: 0, chunks: [{ from: 0, to: text.length, at: 0 }] });

  // 三个段落块都拿到渐显段，而不是只有最后一块。
  for (const head of ["first ", "second", "third "]) {
    assert.match(html, new RegExp(`<span class="stream-ink"[^>]*>${head}</span>`, "u"));
  }
  // 同一段里按 6 个字一组递延，整段像被扫过一样写出来。
  for (const delay of ["-0ms", "-14ms"]) {
    assert.match(html, new RegExp(`animation-delay:${delay}`, "u"));
  }
});

test("代码块与公式不进渐显，避免打散它们自己的排版", async () => {
  const html = await render("text\n\n```js\nconst a = 1;\n```\n\n$x+1$", { now: 0, chunks: [{ from: 0, to: 40, at: 0 }] });

  assert.match(html, /class="md-code-line"/u);
  assert.doesNotMatch(html, /<code[^>]*><span class="stream-ink"/u);
  assert.match(html, /class="katex"/u);
});

test("没有渐显区间时渲染结果与普通 Markdown 一致", async () => {
  const plain = await render("hello world");
  const empty = await render("hello world", { now: 0, chunks: [] });
  assert.equal(plain, empty);
  assert.doesNotMatch(plain, /stream-ink/u);
});
