/**
 * 流式正文的逐段渐显。
 *
 * 渲染层每推进一帧就记下一段「刚写下的源码区间」和它的时刻；这里把 Markdown
 * 语法树里落在这些区间上的文本切成 `span.stream-ink`，并写入
 * `animation-delay: -<年龄>`。于是同一帧写下的字一起淡入，下一帧的字在上一帧
 * 还没淡完时就开始淡入——整段文字是连续渐显，而不是整块弹出。
 *
 * 用负延迟而不是正延迟，是为了让动画的进度由「这段文字多老」决定，而不是由
 * span 什么时候被创建决定：语法树每帧重解析、span 可能被重新创建，负延迟会让
 * 它接在正确的进度上，不会跳帧。动画只做 `from` 到 `to` 的淡入，结束后自然回到
 * 实心文本（不用 fill 模式兜底），所以淡完的字不会一直挂着动画层。
 */

export type StreamInkChunk = {
  /** 源码区间 `[from, to)`。 */
  from: number;
  to: number;
  /** 这段文字被揭示的时刻，取自 `performance.now()`。 */
  at: number;
};

export type StreamInk = {
  /** 本次渲染的时刻；每段文字的年龄 = now - at。 */
  now: number;
  chunks: readonly StreamInkChunk[];
};

/** 连续多少个字共用一个延迟：一次爆发写出上千个 span 没有意义。 */
const STREAM_INK_GROUP = 6;
/** 同一段内相邻分组递增的延迟，整段像被扫过一样写出来。 */
const STREAM_INK_STAGGER_MS = 14;
/** 一段内递延的上限：长爆发也不能扫得太久。 */
const STREAM_INK_STAGGER_MAX_MS = 360;

/** 不参与渐显的标签：样式和脚本不该被切碎。 */
const STREAM_INK_SKIP_TAGS = new Set(["style", "script"]);
const STREAM_INK_SKIP_CLASSES = new Set(["katex", "math-inline", "math-display"]);

/** 源码位置离书写前沿多近才算「正在这里落笔」。 */
const STREAM_INK_HEAD_SLACK = 2;

type InkTextNode = { type: "text"; value: string; position?: { start?: { offset?: number } } };
type InkElementNode = { type: "element"; tagName: string; properties?: Record<string, unknown>; children?: unknown[] };
type InkChild = InkTextNode | InkElementNode | { type: string };

function elementClassName(element: InkElementNode): string[] {
  const value = element.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/\s+/u);
  return [];
}

function inkSpan(value: string, delay: number): InkElementNode {
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["stream-ink"], style: `animation-delay:-${Math.round(delay)}ms` },
    children: [{ type: "text", value }],
  };
}

/**
 * 按渐显区间切开一个文本节点；没有任何一段落在里面时返回 `null`（调用方保持原样）。
 * `start` 是这段文本在源码里的起始偏移（hast 的 `position.start.offset`）。
 */
export function streamInkPieces(value: string, start: number, ink: StreamInk): InkChild[] | null {
  const end = start + value.length;
  const pieces: InkChild[] = [];
  let cursor = 0;
  let painted = false;
  for (const chunk of ink.chunks) {
    // 取区间与这段文本的交集，同时保证与已发出的部分不重叠。
    const to = Math.min(chunk.to, end) - start;
    const from = Math.max(chunk.from, start + cursor) - start;
    if (to <= from) continue;
    if (from > cursor) pieces.push({ type: "text", value: value.slice(cursor, from) });
    const age = Math.max(0, ink.now - chunk.at);
    for (let index = from; index < to; index += STREAM_INK_GROUP) {
      const spread = Math.min(((index - from) / STREAM_INK_GROUP) * STREAM_INK_STAGGER_MS, STREAM_INK_STAGGER_MAX_MS);
      pieces.push(inkSpan(value.slice(index, Math.min(index + STREAM_INK_GROUP, to)), age + spread));
    }
    cursor = to;
    painted = true;
  }
  if (!painted) return null;
  if (cursor < value.length) pieces.push({ type: "text", value: value.slice(cursor) });
  return pieces;
}

function splitStreamInk(children: InkChild[], ink: StreamInk) {
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === "element") {
      const element = child as InkElementNode;
      const skip = STREAM_INK_SKIP_TAGS.has(element.tagName)
        || elementClassName(element).some((name) => STREAM_INK_SKIP_CLASSES.has(name));
      if (!skip) splitStreamInk((element.children ?? []) as InkChild[], ink);
      continue;
    }
    if (child.type !== "text") continue;
    const text = child as InkTextNode;
    const start = text.position?.start?.offset;
    if (typeof start !== "number") continue;
    const pieces = streamInkPieces(text.value, start, ink);
    if (pieces === null) continue;
    children.splice(index, 1, ...pieces);
    index += pieces.length - 1;
  }
}

/** 源码位置是否就压在书写前沿上——正文刚好写到这里。 */
export function streamInkHead(ink: StreamInk, sourceEnd: number): boolean {
  const newest = ink.chunks[ink.chunks.length - 1];
  if (newest === undefined) return false;
  const delta = newest.to - sourceEnd;
  return delta >= 0 && delta <= STREAM_INK_HEAD_SLACK;
}

/** 某个源码偏移处文字的动画延迟（年龄）；不在任何还留着的区间里时返回 `null`。 */
export function streamInkAge(chunks: readonly StreamInkChunk[], offset: number, now: number): number | null {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    // 从这个偏移往新处已经没有别的人了：它落在两段之间（Markdown 语法字符）。
    if (offset >= chunk.to) return null;
    if (offset >= chunk.from) return Math.max(0, now - chunk.at);
  }
  return null;
}

/**
 * 代码块逐行的渐显延迟。
 *
 * 围栏代码块的 `<pre>`/`<code>` 位置就是正文位置，所以只要它压在书写前沿上，
 * 就能按「这一行后面还有多少字符」从结尾倒推出每行的源码偏移，用和正文同一套
 * 年龄规则。缩进式代码块的源码里每行还带着行首缩进，倒推出来的偏移会略偏小，
 * 只影响渐显起点，不影响这一行到底渐不渐显。
 */
export function codeLineDelays(lines: readonly string[], contentEnd: number, ink: StreamInk): Array<number | null> {
  const delays: Array<number | null> = [];
  let after = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    delays[index] = streamInkAge(ink.chunks, contentEnd - 1 - after, ink.now);
    after += lines[index].length + 1;
  }
  return delays;
}

/** 把语法树里刚写下的那些字换成带动画延迟的 span；没有内容可渐显时原样返回。 */
export function applyStreamInk(tree: { children?: unknown[] }, ink: StreamInk) {
  if (ink.chunks.length === 0) return tree;
  splitStreamInk((tree.children ?? []) as InkChild[], ink);
  return tree;
}

/** rehype 插件：交给 react-markdown 在 remark-rehype 之后、公式渲染之前执行。
 *  用法是 `[rehypeStreamInk, ink]`——unified 会把插件本身当成 attacher 调用。 */
export function rehypeStreamInk(ink?: StreamInk | null) {
  return (tree: { children?: unknown[] }) => {
    if (ink) applyStreamInk(tree, ink);
  };
}
