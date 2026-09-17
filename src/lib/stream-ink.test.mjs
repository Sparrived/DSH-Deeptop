// 流式渐显的切分：只有「刚写下的源码区间」被换成带负延迟动画的 span，而且延迟
// 要按每段文字的年龄算——这正是「上一个字还没淡完，下一个字就落笔」的来源。

import assert from "node:assert/strict";
import test from "node:test";
import { appendInkRun, applyStreamInk, clearInkRuns, codeLineDelays, streamInkAge, streamInkHead, streamInkPieces, streamInkRuns } from "./stream-ink.ts";

const ink = (chunks, now = 0) => ({ now, chunks });

function text(value, offset) {
  return { type: "text", value, position: { start: { offset } } };
}

function spanTexts(pieces) {
  return pieces.filter((piece) => piece.type === "element").map((piece) => piece.children[0].value);
}

function spanDelays(pieces) {
  return pieces.filter((piece) => piece.type === "element").map((piece) => piece.properties.style);
}

test("只切开落在渐显区间里的文本，其余原样保留", () => {
  // 区间完全在文本之外时不该动它。
  assert.equal(streamInkPieces("hello world", 0, ink([{ from: 40, to: 44, at: 100 }], 100)), null);

  // 源码 "hello world"：只有后 5 个字是刚写下的。
  const pieces = streamInkPieces("hello world", 0, ink([{ from: 6, to: 11, at: 100 }], 100));
  assert.deepEqual(pieces[0], { type: "text", value: "hello " });
  assert.deepEqual(spanTexts(pieces), ["world"]);
  // 落笔那一刻：延迟 0，动画从头开始。
  assert.deepEqual(spanDelays(pieces), ["animation-delay:-0ms"]);
});

test("每段文字的延迟按自己的年龄算，越老的越接近淡完", () => {
  const chunks = [{ from: 0, to: 3, at: 0 }, { from: 3, to: 6, at: 250 }];
  const pieces = streamInkPieces("abcdef", 0, ink(chunks, 250));
  assert.deepEqual(spanTexts(pieces), ["abc", "def"]);
  // 先写下的那段已经存在 250ms，后写下的那段才刚落笔——两段同时在淡入。
  assert.deepEqual(spanDelays(pieces), ["animation-delay:-250ms", "animation-delay:-0ms"]);
});

test("一次爆发写下的长段落按分组递延，像被扫过一样写出来", () => {
  const pieces = streamInkPieces("x".repeat(20), 0, ink([{ from: 0, to: 20, at: 0 }], 0));
  // 每 6 个字一组：6 + 6 + 6 + 2。
  assert.deepEqual(spanTexts(pieces), ["x".repeat(6), "x".repeat(6), "x".repeat(6), "x".repeat(2)]);
  assert.deepEqual(spanDelays(pieces), [
    "animation-delay:-0ms",
    "animation-delay:-14ms",
    "animation-delay:-28ms",
    "animation-delay:-42ms",
  ]);
});

test("区间只覆盖一部分时按交叉部分切，不重复也不漏字", () => {
  const pieces = streamInkPieces("hello", 10, ink([{ from: 12, to: 14, at: 0 }], 0));
  assert.deepEqual(pieces.map((piece) => piece.type), ["text", "element", "text"]);
  assert.equal(pieces[0].value, "he");
  assert.equal(pieces[1].children[0].value, "ll");
  assert.equal(pieces[2].value, "o");
  // 全文都被覆盖时不留空文本节点。
  assert.deepEqual(streamInkPieces("hi", 0, ink([{ from: 0, to: 2, at: 0 }], 0)).length, 1);
});

test("语法树里只有带源码位置的文本会被切，公式保持原样", () => {
  const inkValue = ink([{ from: 0, to: 4, at: 0 }], 0);
  const tree = {
    children: [
      { type: "element", tagName: "p", children: [text("abcd", 0)] },
      // remark-breaks 造出来的换行没有 position，不能碰。
      { type: "text", value: "\n" },
      { type: "element", tagName: "span", properties: { className: ["math", "math-inline"] }, children: [text("abcd", 0)] },
    ],
  };

  applyStreamInk(tree, inkValue);

  const paragraph = tree.children[0].children;
  assert.deepEqual(paragraph.map((piece) => piece.type), ["element"]);
  assert.equal(paragraph[0].properties.className[0], "stream-ink");
  assert.equal(tree.children[1].value, "\n");
  assert.equal(tree.children[2].children[0].value, "abcd");
});

test("没有可渐显的区间时不动语法树", () => {
  const tree = { children: [{ type: "element", tagName: "p", children: [text("abcd", 0)] }] };
  applyStreamInk(tree, ink([]));
  assert.deepEqual(tree.children[0].children.map((piece) => piece.type), ["text"]);
});

test("行内代码也逐字渐显，围栏代码块的文本照样能还原", () => {
  const inkValue = ink([{ from: 0, to: 8, at: 0 }], 0);
  const tree = {
    children: [
      { type: "element", tagName: "p", children: [{ type: "element", tagName: "code", children: [text("abcdefgh", 0)] }] },
      {
        type: "element",
        tagName: "pre",
        children: [{ type: "element", tagName: "code", children: [text("abcdefgh", 0)] }],
      },
    ],
  };

  applyStreamInk(tree, inkValue);

  assert.equal(tree.children[0].children[0].children[0].type, "element");
  assert.equal(tree.children[0].children[0].children[0].properties.className[0], "stream-ink");
  assert.equal(tree.children[1].children[0].children[0].type, "element");
});

test("只有压在书写前沿上的位置才算正在落笔", () => {
  const chunks = [{ from: 0, to: 40, at: 0 }];
  assert.equal(streamInkHead(ink(chunks, 0), 40), true);
  assert.equal(streamInkHead(ink(chunks, 0), 38), true);
  // 更早写完的块不该被后来的文字带着重新淡一遍。
  assert.equal(streamInkHead(ink(chunks, 0), 20), false);
  // 还没写到的地方不算。
  assert.equal(streamInkHead(ink(chunks, 0), 41), false);
  assert.equal(streamInkHead(ink([], 0), 0), false);
});

test("代码行按倒推的源码偏移取年龄", () => {
  // 源码：第 0 行 [0,6)，换行 6，第 1 行 [7,13)，代码块结束在 13。
  const chunks = [{ from: 0, to: 6, at: 0 }, { from: 7, to: 13, at: 400 }];
  const delays = codeLineDelays(["abcdef", "ghijkl"], 13, ink(chunks, 500));
  assert.deepEqual(delays, [500, 100]);

  // 区间已经淡完（被裁掉）时该行不渐显。
  assert.deepEqual(codeLineDelays(["abcdef", "ghijkl"], 13, ink([{ from: 0, to: 6, at: 0 }], 500)), [500, null]);
  assert.equal(streamInkAge([{ from: 0, to: 6, at: 0 }], 9, 500), null);
  assert.equal(streamInkAge([{ from: 0, to: 6, at: 0 }, { from: 7, to: 13, at: 400 }], 9, 500), 100);
  // 落在两段之间的语法字符没有年龄。
  assert.equal(streamInkAge([{ from: 0, to: 6, at: 0 }, { from: 7, to: 13, at: 400 }], 6, 500), null);
});

test("一次推进切出的片段直接可以喂给纯文本正文", () => {
  const runs = streamInkRuns("x".repeat(8), 0, ink([{ from: 0, to: 8, at: 0 }], 0));
  assert.deepEqual(runs, [
    { text: "x".repeat(6), delay: 0 },
    { text: "xx", delay: 14 },
  ]);
  // 区间之外的部分是实心的。
  assert.deepEqual(streamInkRuns("abc", 0, ink([{ from: 1, to: 2, at: 0 }], 0)), [
    { text: "a", delay: null },
    { text: "b", delay: 0 },
    { text: "c", delay: null },
  ]);
  assert.equal(streamInkRuns("abc", 0, ink([])), null);
});

// Think 正文是纯文本 <pre>：新写下的片段挂成 span，淡完按写入顺序并回文本节点。
// 这里用一个最小的假 DOM 盯住「顺序」——并错顺序会直接把正文写乱。
function fakeBody() {
  const nodes = [];
  const pre = {
    get firstChild() { return nodes[0] ?? null; },
    get childNodes() { return nodes; },
    get textContent() { return nodes.map((node) => (node.nodeType === 3 ? node.data : node.textContent)).join(""); },
    appendChild(node) { nodes.push(node); node.parentNode = pre; return node; },
    replaceChildren(...children) { nodes.splice(0, nodes.length, ...children); for (const child of children) child.parentNode = pre; },
  };
  const textNode = {
    nodeType: 3,
    data: "",
    parentNode: pre,
    ownerDocument: {
      createElement() {
        return {
          nodeType: 1,
          className: "",
          textContent: "",
          style: {},
          parentNode: null,
          remove() { const at = nodes.indexOf(this); if (at >= 0) nodes.splice(at, 1); },
        };
      },
    },
    appendData(value) { this.data += value; },
  };
  nodes.push(textNode);
  return { pre, textNode };
}

test("Think 正文的渐显片段按写入顺序并回文本节点", () => {
  const { pre, textNode } = fakeBody();
  const pending = [];
  const inkOf = (value, at) => streamInkRuns(value, 0, ink([{ from: 0, to: value.length, at }], at)) ?? [];

  for (const run of inkOf("abc", 0)) appendInkRun(textNode, run, pending, 0);
  for (const run of inkOf("def", 100)) appendInkRun(textNode, run, pending, 100);
  for (const run of inkOf("ghi", 200)) appendInkRun(textNode, run, pending, 200);

  // 还没到收笔时间：三段都挂在正文后面淡入，正文那个文本节点还是空的。
  assert.equal(textNode.data, "");
  assert.equal(pre.childNodes.length, 4);
  assert.equal(pre.textContent, "abcdefghi");
  assert.equal(pending.length, 3);
  assert.equal(pre.childNodes[1].style.animationDelay, "-0ms");
  assert.equal(pre.childNodes[3].style.animationDelay, "-0ms");

  // 到了收笔时间：先写下的两段并回正文，最后一段继续淡。
  for (const run of inkOf("jkl", 1700)) appendInkRun(textNode, run, pending, 1700);
  assert.equal(textNode.data, "abcdef");
  assert.equal(pre.textContent, "abcdefghijkl");
  assert.equal(pending.length, 2);
});

test("整段改写时丢掉正在淡入的片段，正文只留一份文字", () => {
  const { pre, textNode } = fakeBody();
  const pending = [];
  for (const run of streamInkRuns("abc", 0, ink([{ from: 0, to: 3, at: 0 }], 0)) ?? []) appendInkRun(textNode, run, pending, 0);

  clearInkRuns(pending);
  textNode.data = "reset";

  assert.equal(pending.length, 0);
  assert.equal(pre.childNodes.length, 1);
  assert.equal(pre.textContent, "reset");
});
