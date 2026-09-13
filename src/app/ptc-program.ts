/**
 * PTC 程序执行模型。
 *
 * PTC 会话里模型写的是一个 TypeScript 程序，程序内部再调用工具；DSH 把每次内部派发
 * 记成 `tool/ptc-dispatch-start` / `tool/ptc-dispatch` 事件对（按 `subCallId` 配对，
 * 新调用用 `<parent>:ptc:<n>` 编号，n 就是提交顺序）。本模块把这对事件折成一条有序
 * 调用列表，并把每个调用锚回程序源码里的调用位点，供对话栏的「程序 / 执行」双栏渲染。
 *
 * 锚定是尽力而为的展示：源码里 `tools.<name>(` 的第 n 次出现对应第 n 次同名派发；出现
 * 次数用尽后，同名调用复用上一个位点（循环体里一行发起多次调用是常态）。定位不到的调用
 * 不会拿到一个编造的行号，而是留在执行栏并如实计数。
 */
import type { DshSessionEvent } from "../lib/desktop";
import { parseToolArgs, toolCallSummary, type ToolArgsObject } from "./tool-call-display.ts";
import { textFromContent } from "./message-model.ts";
import type { UiLocale } from "./i18n.ts";

/** 一次子调派发的开始事件名（工具体流水线真正进入时追加）。 */
export const PTC_DISPATCH_START_EVENT = "tool/ptc-dispatch-start";

/** 一次子调派发的结算事件名（与开始事件按 `subCallId` 配对）。 */
export const PTC_DISPATCH_EVENT = "tool/ptc-dispatch";

/** 并发扫描的调用数上限：超出的程序只显示调用明细，不再计算重叠窗口。 */
const MAX_CONCURRENCY_SCAN = 256;

/** 源码里的调用位点写法：点访问与字符串下标访问。 */
const CALL_SITE_PATTERNS = [
  /\btools\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/gu,
  /\btools\s*\[\s*['"]([^'"\\]+)['"]\s*\]\s*\(/gu,
];

/** 一次子调用的开始或结算记录（同一次调用的两个事件在此层合并）。 */
export type PtcDispatch = {
  rootCallId: string;
  parentCallId: string;
  subCallId: string;
  name: string;
  /** JSON 参数文本，供参数渲染直接使用。 */
  argsText: string;
  startedAt?: number;
  settledAt?: number;
  /** 结果文本（日志副本；超大结果可能是截断预览 + 定位符）。 */
  resultText: string;
  error: boolean;
  settled: boolean;
};

export type PtcCallState = "running" | "ok" | "error";

/** 执行栏里的一行：一次真实发生的内部调用。 */
export type PtcCall = {
  /** 1-based 全局序号，与程序 gutter 上的标记一致。 */
  index: number;
  callId: string;
  name: string;
  argsText: string;
  argsObject: ToolArgsObject | undefined;
  summary: string | undefined;
  state: PtcCallState;
  startedAt?: number;
  settledAt?: number;
  durationMs?: number;
  resultText: string;
  error: boolean;
  /** 1-based 源码行；仅在位点匹配成功时存在。 */
  line?: number;
  /** 本次调用期间同时进行的调用数（含自己），无法计算时为 1。 */
  concurrent: number;
};

export type PtcProgramLine = {
  /** 1-based 行号。 */
  no: number;
  text: string;
  /** 锚定在这一行的调用，按提交顺序。 */
  calls: readonly PtcCall[];
};

export type PtcProgramStats = {
  calls: number;
  failures: number;
  running: number;
  /** 程序自身的墙钟跨度（最早开始 → 最晚结束），尚未开始时不存在。 */
  spanMs?: number;
  /** 单次调用最长耗时，用于执行栏相对耗时条的归一化。 */
  maxDurationMs: number;
  /** 并发窗口的峰值，>=2 才有并行标记。 */
  parallel: number;
};

export type PtcProgram = {
  /** 程序源码；参数异常时为空串，此时只有执行栏可渲染。 */
  code: string;
  lines: readonly PtcProgramLine[];
  calls: readonly PtcCall[];
  /** 定位不到源码位点的调用，仍然按提交顺序列出。 */
  unplaced: readonly PtcCall[];
  stats: PtcProgramStats;
  /** 仍在进行中的最后一次派发，供折叠态 ticker 使用。 */
  active: PtcCall | undefined;
  /** 程序成功结束但内部有失败：说明失败被程序自己捕获了。 */
  caughtFailures: number;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * 读出一条 PTC 派发事件；非派发事件返回 undefined。
 *
 * 开始事件与结算事件都会经过这里：调用方按 `subCallId` 合并两者，即可同时拿到
 * 计时（两个事件的 `time`）与结果（只有结算事件有 `content`）。
 *
 * @param event - 会话事件。
 * @param locale - 结果内容里图片占位文案的语言。
 * @returns 归一化后的派发记录，或 undefined。
 */
export function readPtcDispatch(event: DshSessionEvent, locale: UiLocale = "zh"): PtcDispatch | undefined {
  const start = event.type === PTC_DISPATCH_START_EVENT;
  const settle = event.type === PTC_DISPATCH_EVENT;
  if (!start && !settle) return undefined;
  const data = event.data ?? {};
  const rootCallId = stringValue(data.rootCallId);
  const parentCallId = stringValue(data.parentCallId) ?? rootCallId;
  const subCallId = stringValue(data.subCallId);
  const name = stringValue(data.name);
  if (!rootCallId || !parentCallId || !subCallId || !name) return undefined;
  const args = data.arguments;
  return {
    rootCallId,
    parentCallId,
    subCallId,
    name,
    argsText: typeof args === "string" ? args : args === undefined ? "" : JSON.stringify(args, null, 2),
    // 开始事件记起点，结算事件记终点；只有结算事件（历史窗口截断）没有起点，不编造耗时。
    ...(start ? { startedAt: event.time } : {}),
    ...(settle ? { settledAt: event.time, settled: true } : { settled: false }),
    resultText: settle ? textFromContent(data.content, locale) : "",
    error: settle && data.isError === true,
  };
}

function mergeDispatch(previous: PtcDispatch, next: PtcDispatch): PtcDispatch {
  return {
    ...previous,
    ...next,
    // 开始事件带上了参数与计时起点，结算事件只补结果，两者都不覆盖对方的独有字段。
    argsText: next.argsText || previous.argsText,
    ...(previous.startedAt === undefined ? {} : { startedAt: previous.startedAt }),
    settled: previous.settled || next.settled,
    error: next.settled ? next.error : previous.error,
    resultText: next.settled ? next.resultText : previous.resultText,
    ...(next.settledAt === undefined ? {} : { settledAt: next.settledAt }),
  };
}

/**
 * 扫描程序源码里的调用位点，按工具名给出出现行号（源码顺序）。
 *
 * @param code - 程序源码。
 * @returns 工具名 → 该名字在源码中出现的 1-based 行号序列。
 */
export function scanCallSites(code: string): Map<string, number[]> {
  const sites = new Map<string, number[]>();
  if (!code) return sites;
  for (const pattern of CALL_SITE_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
      const name = match[1];
      if (name === undefined) continue;
      const line = newlineCountBefore(code, match.index) + 1;
      const lines = sites.get(name);
      if (lines === undefined) sites.set(name, [line]);
      else if (lines[lines.length - 1] !== line) lines.push(line);
    }
  }
  return sites;
}

function newlineCountBefore(code: string, offset: number): number {
  let count = 0;
  for (let at = code.indexOf("\n"); at >= 0 && at < offset; at = code.indexOf("\n", at + 1)) count += 1;
  return count;
}

/**
 * 把调用按提交顺序锚回源码行。
 *
 * @param code - 程序源码。
 * @param calls - 按提交顺序排列的调用。
 * @returns 被锚定的调用数，以及未锚定调用的下标集合。
 */
function anchorCalls(code: string, calls: readonly PtcCall[]): Set<number> {
  const unplaced = new Set<number>();
  if (!code) {
    calls.forEach((_call, index) => unplaced.add(index));
    return unplaced;
  }
  const remaining = new Map<string, number[]>();
  for (const [name, lines] of scanCallSites(code)) remaining.set(name, [...lines]);
  const lastUsed = new Map<string, number>();
  calls.forEach((call, index) => {
    const sites = remaining.get(call.name);
    const next = sites?.shift();
    const line = next ?? lastUsed.get(call.name);
    if (line === undefined) {
      unplaced.add(index);
      return;
    }
    call.line = line;
    lastUsed.set(call.name, line);
  });
  return unplaced;
}

/** 统计每个调用期间的重叠窗口，返回并发峰值。 */
function markConcurrency(calls: readonly PtcCall[]): number {
  if (calls.length > MAX_CONCURRENCY_SCAN) return 1;
  let peak = 1;
  for (const call of calls) {
    if (call.startedAt === undefined) continue;
    const end = call.settledAt ?? Number.POSITIVE_INFINITY;
    let concurrent = 1;
    for (const other of calls) {
      if (other === call || other.startedAt === undefined) continue;
      const otherEnd = other.settledAt ?? Number.POSITIVE_INFINITY;
      if (other.startedAt < end && call.startedAt < otherEnd) concurrent += 1;
    }
    call.concurrent = concurrent;
    if (concurrent > peak) peak = concurrent;
  }
  return peak;
}

function toCall(dispatch: PtcDispatch, index: number, locale: UiLocale): PtcCall {
  const argsObject = parseToolArgs(dispatch.argsText);
  const durationMs = dispatch.startedAt === undefined || dispatch.settledAt === undefined
    ? undefined
    : Math.max(0, dispatch.settledAt - dispatch.startedAt);
  return {
    index,
    callId: dispatch.subCallId,
    name: dispatch.name,
    argsText: dispatch.argsText,
    argsObject,
    summary: toolCallSummary(dispatch.name, argsObject),
    state: dispatch.settled ? (dispatch.error ? "error" : "ok") : "running",
    ...(dispatch.startedAt === undefined ? {} : { startedAt: dispatch.startedAt }),
    ...(dispatch.settledAt === undefined ? {} : { settledAt: dispatch.settledAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
    resultText: dispatch.resultText,
    error: dispatch.error,
    concurrent: 1,
  };
}

function programLines(code: string, calls: readonly PtcCall[]): PtcProgramLine[] {
  if (!code) return [];
  const byLine = new Map<number, PtcCall[]>();
  for (const call of calls) {
    if (call.line === undefined) continue;
    const bucket = byLine.get(call.line);
    if (bucket === undefined) byLine.set(call.line, [call]);
    else bucket.push(call);
  }
  return code.split("\n").map((text, index) => ({
    no: index + 1,
    text,
    calls: byLine.get(index + 1) ?? [],
  }));
}

/**
 * 折叠一次 `run_code` 的所有子派发，得到「程序 + 执行」视图。
 *
 * @param argsText - `run_code` 调用的参数 JSON 文本（`code` / `description`）。
 * @param dispatches - 该 `run_code` 的子派发记录，按日志顺序。
 * @param locale - 结果内容里图片占位文案的语言。
 * @param programFailed - 外层 `run_code` 自身是否以失败结算；用于区分「程序捕获了失败」。
 * @returns 程序执行视图；没有任何派发时返回 undefined（非 PTC 行不受影响）。
 */
export function buildPtcProgramView(
  argsText: string,
  dispatches: readonly PtcDispatch[],
  locale: UiLocale = "zh",
  programFailed = false,
): PtcProgram | undefined {
  if (dispatches.length === 0) return undefined;
  const parsed = parseToolArgs(argsText);
  const code = typeof parsed?.code === "string" ? parsed.code : "";
  // 同一次调用有一个开始事件与一个结算事件；按首次出现的位置保持提交顺序。
  const order: string[] = [];
  const merged = new Map<string, PtcDispatch>();
  for (const dispatch of dispatches) {
    if (!merged.has(dispatch.subCallId)) order.push(dispatch.subCallId);
    const previous = merged.get(dispatch.subCallId);
    merged.set(dispatch.subCallId, previous === undefined ? dispatch : mergeDispatch(previous, dispatch));
  }
  const calls = order.map((id, index) => toCall(merged.get(id)!, index + 1, locale));
  const unplacedIndexes = anchorCalls(code, calls);
  const parallel = markConcurrency(calls);
  const settledDurations = calls
    .map((call) => call.durationMs)
    .filter((value): value is number => value !== undefined);
  const starts = calls.map((call) => call.startedAt).filter((value): value is number => value !== undefined);
  const ends = calls.map((call) => call.settledAt).filter((value): value is number => value !== undefined);
  const running = calls.filter((call) => call.state === "running");
  const failures = calls.filter((call) => call.state === "error").length;
  const active = running[running.length - 1];
  // 只有每次调用都记全了起点与终点，程序自身的墙钟跨度才成立；运行中不显示一个
  // 不会自己走动的总耗时。
  const timed = starts.length === calls.length && ends.length === calls.length;
  return {
    code,
    lines: programLines(code, calls),
    calls,
    unplaced: calls.filter((_call, index) => unplacedIndexes.has(index)),
    stats: {
      calls: calls.length,
      failures,
      running: running.length,
      ...(timed ? { spanMs: Math.max(...ends) - Math.min(...starts) } : {}),
      maxDurationMs: settledDurations.length === 0 ? 0 : Math.max(...settledDurations),
      parallel,
    },
    active,
    // 外层程序成功结束、内部却有失败，说明失败是程序自己捕获后继续跑的——这是 PTC
    // 与原生工具调用最不同的一点，值得单独说明。
    caughtFailures: failures > 0 && running.length === 0 && !programFailed ? failures : 0,
  };
}
