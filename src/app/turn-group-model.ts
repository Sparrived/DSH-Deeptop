/**
 * 轮次分组视图模型：把 transcript 行切成「提示 → 中间步骤 → 答复」。
 *
 * 一轮由一条用户提示开启，直到下一条用户提示为止；中间的思考、工具调用、
 * 系统提示都是「中间步骤」。轮次结束后这些步骤默认收起，只留下输入和最后
 * 一条答复；运行中的轮次保持展开，读到的是完整过程。
 *
 * 纯模块：不依赖 React/Tauri/Bridge，可在 Node 中直接测试。
 */

import type { TranscriptItem } from "./model-types";

/** 提示与答复之外的工作都算中间步骤。 */
const STEP_KINDS: ReadonlySet<TranscriptItem["kind"]> = new Set<TranscriptItem["kind"]>(["reasoning", "tool", "system", "workflow"]);

const EMPTY_ROWS: readonly TranscriptItem[] = Object.freeze([]);

export type TranscriptTurnGroup = {
  /** 分组键＝组内首行 key；同时用作 React key 和展开状态记忆键。 */
  readonly key: string;
  /** 步骤区之前始终可见的行（提示，以及提示之前的上下文注入）。 */
  readonly head: readonly TranscriptItem[];
  /** 轮次结束后收起的中间步骤。 */
  readonly steps: readonly TranscriptItem[];
  /** 答复及其之后的行，始终可见。 */
  readonly tail: readonly TranscriptItem[];
  /** 轮次是否仍可能收到事件；运行中的步骤保持展开。 */
  readonly live: boolean;
};

export type StepKindCounts = {
  reasoning: number;
  tool: number;
  system: number;
  workflow: number;
};

/** 中间步骤的类型计数，用于一行摘要（思考 1 · 工具 3）。 */
export function stepKindCounts(steps: readonly TranscriptItem[]): StepKindCounts {
  const counts: StepKindCounts = { reasoning: 0, tool: 0, system: 0, workflow: 0 };
  for (const step of steps) {
    if (step.kind === "reasoning") counts.reasoning += 1;
    else if (step.kind === "tool") counts.tool += 1;
    else if (step.kind === "system") counts.system += 1;
    else if (step.kind === "workflow") counts.workflow += 1;
  }
  return counts;
}

/** 第一条用户提示之后即为步骤区；提示之前的注入行留在 head。 */
function promptEnd(items: readonly TranscriptItem[]): number {
  const index = items.findIndex((item) => item.kind === "user");
  return index < 0 ? 0 : index + 1;
}

/**
 * 切分一组行：步骤区从提示之后的第一条步骤行开始，到该轮最后一条答复行为止；
 * 答复行及其之后的行（轮次耗时等）保持可见，因此渲染顺序与原始顺序一致。
 * 没有步骤行时整组都是 head，不做任何收起。
 */
function buildGroup(items: readonly TranscriptItem[]): TranscriptTurnGroup {
  const live = items.some((item) => item.streaming === true);
  const prompt = promptEnd(items);
  let firstStep = -1;
  let lastAnswer = -1;
  for (let index = 0; index < items.length; index += 1) {
    if (firstStep < 0 && index >= prompt && STEP_KINDS.has(items[index].kind)) firstStep = index;
    if (items[index].kind === "assistant") lastAnswer = index;
  }
  if (firstStep < 0) return { key: items[0].key, head: items, steps: EMPTY_ROWS, tail: EMPTY_ROWS, live };
  const tailStart = lastAnswer > firstStep ? lastAnswer : items.length;
  return {
    key: items[0].key,
    head: items.slice(0, firstStep),
    steps: items.slice(firstStep, tailStart),
    tail: items.slice(tailStart),
    live,
  };
}

/**
 * 按用户提示把 transcript 切成一轮一组。只有最后一组可能仍在运行：整轮
 * （Agent loop）尚未结束时它保持展开，其余已结束的轮次默认收起中间步骤。
 *
 * `loopLive` 必须描述「这一轮是否还会继续产出」，而不是「某一次模型返回是否
 * 还在流式输出」：一轮里可能有几十个 step，任何一个 step 结束都不该收起步骤区。
 */
export function groupTranscriptTurns(items: readonly TranscriptItem[], loopLive: boolean): readonly TranscriptTurnGroup[] {
  const groups: TranscriptTurnGroup[] = [];
  let current: TranscriptItem[] = [];
  let hasPrompt = false;
  const flush = () => {
    if (current.length > 0) groups.push(buildGroup(current));
    current = [];
    hasPrompt = false;
  };
  for (const item of items) {
    // 提示开启一轮；提示之前的注入行属于它开启的那一轮，因此并入同一组。
    if (item.kind === "user" && hasPrompt) flush();
    if (item.kind === "user") hasPrompt = true;
    current.push(item);
  }
  flush();
  const lastIndex = groups.length - 1;
  if (lastIndex < 0 || !loopLive || groups[lastIndex].live) return groups;
  return groups.map((group, index) => (index === lastIndex ? { ...group, live: true } : group));
}

/**
 * 记录一次步骤区手动折叠：只有与自动状态不同时才记住，切回自动状态就丢弃覆盖。
 * 浏览器在自动展开/收起时也会派发原生 toggle，这条规则保证它们不会写坏默认行为。
 */
export function applyStepToggle(
  current: Readonly<Record<string, boolean>>,
  key: string,
  open: boolean,
  autoOpen: boolean,
): Record<string, boolean> {
  if (open !== autoOpen) return current[key] === open ? (current as Record<string, boolean>) : { ...current, [key]: open };
  if (!(key in current)) return current as Record<string, boolean>;
  const next: Record<string, boolean> = { ...current };
  delete next[key];
  return next;
}
