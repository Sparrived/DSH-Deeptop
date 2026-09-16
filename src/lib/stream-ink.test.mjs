// 流式渐显的语法树切分：只有「刚写下的源码区间」被换成带负延迟动画的 span，
// 而且延迟要按每段文字的年龄算——这正是「上一个字还没淡完，下一个字就落笔」的来源。

import assert from "node:assert/strict";
import test from "node:test";
import { applyStreamInk, codeLineDelays, streamInkAge, streamInkHead, streamInkPieces } from "./stream-ink.ts";

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
