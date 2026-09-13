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
 * 一轮是否仍在推进：决定步骤区保持展开还是收起。
 *
 * 一轮（用户看到的这一件事）往往由多个 DSH 轮次组成：模型返回一次、子代理回报、
 * 后台任务通知、目标循环的下一轮都会各开一个新轮次，而两次轮次之间 agent 的 running
 * 状态会短暂回落到 idle。只按 running 判断，就会在轮次途中把这一轮的历史收起再展开，
 * 所以只要还有任一信号在推进就保持展开，整轮真正停下来才收起。
 *
 * 信号全部来自当前会话的事件或投影，不含时间窗口判断。
 */
export type RoundActivity = {
  /** agent 驱动正在跑（DSH 的 running 状态）。 */
  agentRunning: boolean;
  /** 窗口里还有一个没有 turn/end 的轮次。 */
  turnOpen: boolean;
  /** 子代理仍在运行：父代理要等它回报才会继续。 */
  subagentRunning: boolean;
  /** 后台任务仍在运行。 */
  jobRunning: boolean;
  /** 目标处于 active：目标循环还会开新的轮次。 */
  goalActive: boolean;
  /** 还有排队的输入：下一轮马上开始。 */
  queuedTurn: boolean;
  /** 正在等待用户批准或回答：轮次停在这里，而不是结束。 */
  awaitingInput: boolean;
};

export function roundActivityLive(activity: RoundActivity): boolean {
  return activity.agentRunning
    || activity.turnOpen
    || activity.subagentRunning
    || activity.jobRunning
    || activity.goalActive
    || activity.queuedTurn
    || activity.awaitingInput;
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
