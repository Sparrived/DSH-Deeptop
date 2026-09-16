import type { DshHistoryEntry } from "../lib/desktop";
import type { SessionCostData, SessionCostToolRow, SessionCostTurnRow, SessionTurnOutcome } from "./model-types";
import { eventToolCallId, eventToolName, eventToolResultError, isInjectedMessage, numberValue, recordValue } from "./message-model.ts";
import { sessionIndicatorForTurnEnd } from "./session-runtime-state.ts";
import { parseToolArgs } from "./tool-call-display.ts";

/**
 * 会话成本计量：从显示历史里推导「这一步为什么贵」。
 *
 * 输入区胶囊与会话看板已有的指标回答「用了多少」，这里回答「花在哪、浪费在哪」：
 * 工具错误集中在哪个工具、LLM 重试损失了多少步、同一命令被重复执行了几次、
 * 哪些轮次最终以 error 结束（其中的工作全部作废）。
 *
 * 纯函数模块：不调用 React、Tauri 或 Bridge，且不引入运行时依赖，因此可以直接
 * 在 `node --test` 的类型剥离下测试（与 session-dashboard.ts / trajectory.ts 一致）。
 */

/** 每个工具累计的成本画像。 */
type ToolAccumulator = {
  name: string;
  calls: number;
  errors: number;
  /** 该工具结果的 UTF-16 文本长度总和，用于估算注入上下文的体积。 */
  resultChars: number;
  /** 与该工具调用配对的执行耗时总和；结果缺少配对时不计。 */
  durationMs: number;
};

type TurnAccumulator = {
  key: string;
  turn?: number;
  startedAt?: number;
  endedAt?: number;
  steps: number;
  toolCalls: number;
  toolFailures: number;
  retries: number;
  outcome: SessionTurnOutcome;
};

/** 单条 shell 命令的执行记录，用于识别重复调用。 */
type CommandRecord = {
  command: string;
  calls: number;
};

const EMPTY_OUTCOME: SessionTurnOutcome = "open";

/**
 * 工具结果文本：优先取 `tool-result` 块的扁平文本，回退到消息内容。
 *
 * 只用于体积估算，不做语义判断，所以对形状异常的结果回退到空串而不是抛错。
 */
function toolResultText(entry: DshHistoryEntry) {
  const data = recordValue(entry.event.data) ?? {};
  const message = recordValue(data.message);
  const blocks = Array.isArray(message?.content) ? message.content : [];
  let text = "";
  for (const block of blocks) {
    const record = recordValue(block);
    if (!record) continue;
    const nested = Array.isArray(record.content) ? record.content : [];
    for (const inner of nested) {
      const value = recordValue(inner);
      if (value?.type === "text" && typeof value.text === "string") text += value.text;
    }
    if (typeof record.text === "string") text += record.text;
  }
  if (text) return text;
  const direct = data.content;
  if (typeof direct === "string") return direct;
  return "";
}

/**
 * 把 `turn/end` 的 reason 归一化为成本视图的结局。
 *
 * 复用 sidebar 的官方结局映射，再收敛到本模块的取值集合：`sessionIndicatorForTurnEnd`
 * 还会为缺少 reason 的历史返回 `idle`/`running`，那两种情况不是轮次结局，
 * 统一按 `completed` 处理。
 */
function turnOutcome(reason: Record<string, unknown> | undefined): SessionTurnOutcome {
  if (reason === undefined) return "completed";
  switch (sessionIndicatorForTurnEnd(reason)) {
    case "error": return "error";
    case "cancelled": return "cancelled";
    case "max-tokens": return "max-tokens";
    case "blocked": return "blocked";
    case "interrupted": return "interrupted";
    default: return "completed";
  }
}

/** 该结果事件自带的耗时（若 Host 记录），否则 undefined 由调用方配对估算。 */
function recordedDuration(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  return numberValue(value.durationMs)
    ?? numberValue(value.elapsedMs)
    ?? numberValue(value.ms);
}

/**
 * 归一化 shell 命令用于重复检测：折叠空白并保留 argv 全貌。
 *
 * 不去掉参数，因为 `npm test` 与 `npm test -- foo` 是不同工作；只折叠空白，
 * 让跨平台换行与多余空格不产生假重复。
 */
function normalizeCommand(value: unknown) {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed || undefined;
}

/** 一次工具调用携带的可选 shell 命令文本。 */
function commandOfToolCall(toolName: string, args: ReturnType<typeof parseToolArgs>) {
  if (!args) return undefined;
  const normalized = toolName.trim().toLowerCase();
  const isShell = normalized === "pwsh"
    || normalized === "bash"
    || normalized === "shell"
    || normalized === "exec"
    || normalized.startsWith("terminal_");
  if (!isShell) return undefined;
  return normalizeCommand(args.command) ?? normalizeCommand(args.shellCommand);
}

function turnKeyOf(event: DshHistoryEntry["event"], fallback: number) {
  const data = recordValue(event.data) ?? {};
  const message = recordValue(data.message);
  const turn = numberValue(data.turn) ?? numberValue(message?.turn);
  return turn === undefined ? `fallback:${fallback}` : `turn:${turn}`;
}

/**
 * 统计会话成本画像。
 *
 * 所有比率在分母为 0 时返回 0（而不是 NaN），让 UI 直接用数字格式化，
 * 与 session-metrics.ts 的「没有记录显示 —」约定一致：这里返回 0 表示
 * 「没有数据」，组件据 `calls === 0` 决定是否显示占位。
 *
 * @param entries - 该会话的显示历史（可含分页补齐的全部条目）。
 * @returns 工具、轮次、重试、重复命令四组成本投影。
 */
export function sessionCost(entries: readonly DshHistoryEntry[]): SessionCostData {
  const ordered = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  const tools = new Map<string, ToolAccumulator>();
  const turns = new Map<string, TurnAccumulator>();
  const commands = new Map<string, CommandRecord>();
  /** callId -> 该调用的工具名与开始时间，用于与结果配对。 */
  const pending = new Map<string, { name: string; startedAt?: number }>();

  let retries = 0;
  let retriedSteps = 0;
  let resultChars = 0;
  let toolCalls = 0;
  let toolFailures = 0;
  let fallbackTurn = 0;
  let currentTurnKey: string | undefined;
  /** 已记录过重试的 `turn/step` 坐标，避免同一步多次重试重复计数。 */
  const retriedStepKeys = new Set<string>();

  const ensureTool = (name: string) => {
    const existing = tools.get(name);
    if (existing) return existing;
    const created: ToolAccumulator = { name, calls: 0, errors: 0, resultChars: 0, durationMs: 0 };
    tools.set(name, created);
    return created;
  };

  const ensureTurn = (key: string, turn: number | undefined, startedAt: number | undefined) => {
    const existing = turns.get(key);
    if (existing) {
      if (startedAt !== undefined && (existing.startedAt === undefined || startedAt < existing.startedAt)) {
        existing.startedAt = startedAt;
      }
      return existing;
    }
    const created: TurnAccumulator = {
      key,
      ...(turn === undefined ? {} : { turn }),
      ...(startedAt === undefined ? {} : { startedAt }),
      steps: 0,
      toolCalls: 0,
      toolFailures: 0,
      retries: 0,
      outcome: EMPTY_OUTCOME,
    };
    turns.set(key, created);
    return created;
  };

  for (const entry of ordered) {
    const { event } = entry;
    // 真实日志的首行是 `session` 头记录，没有 `data`；与 message-model 的既有
    // 辅助函数保持一致，用空对象兜底而不是假设 payload 存在。
    const data = recordValue(event.data) ?? {};
    const time = numberValue(event.time);
    const message = recordValue(data.message);
    const stepTurn = numberValue(data.turn) ?? numberValue(message?.turn);
    const stepIndex = numberValue(data.step) ?? numberValue(message?.step);
    // `fallbackTurn` 只用于没有显式 turn 号的历史，避免 key 冲突。
    const key = currentTurnKey ?? turnKeyOf(event, fallbackTurn);

    if (event.type === "turn/start") {
      currentTurnKey = turnKeyOf(event, ++fallbackTurn);
      ensureTurn(currentTurnKey, stepTurn, time);
      continue;
    }

    if (event.type === "user/message" && !isInjectedMessage(event)) {
      continue;
    }

    if (event.type === "tool/call") {
      toolCalls += 1;
      const name = eventToolName(event);
      const tool = ensureTool(name);
      tool.calls += 1;
      const callId = eventToolCallId(event);
      const rawArgs = data.arguments;
      const args = typeof rawArgs === "string" ? parseToolArgs(rawArgs) : recordValue(rawArgs);
      const command = commandOfToolCall(name, args);
      if (command) commands.set(command, { command, calls: (commands.get(command)?.calls ?? 0) + 1 });
      if (callId) pending.set(callId, { name, ...(time === undefined ? {} : { startedAt: time }) });
      currentTurnKey = key;
      const turn = ensureTurn(key, stepTurn, time);
      turn.toolCalls += 1;
      continue;
    }

    if (event.type === "step/start") {
      currentTurnKey = key;
      // 以 step/start 计步（而非 step/end）：被并发错误或中断掐断的步同样消耗了
      // 一次 LLM 调用，正是本面板要暴露的浪费。因此这里的步数会略大于概览面板
      // 的 step/end 计数，后者只统计已完成的步。
      ensureTurn(key, stepTurn, time).steps += 1;
      continue;
    }

    if (event.type === "step/end") {
      currentTurnKey = key;
      ensureTurn(key, stepTurn, time);
      continue;
    }

    if (event.type === "tool/result") {
      const callId = eventToolCallId(event);
      const paired = callId ? pending.get(callId) : undefined;
      const name = paired?.name ?? eventToolName(event);
      const tool = ensureTool(name);
      const text = toolResultText(entry);
      tool.resultChars += text.length;
      resultChars += text.length;
      const recorded = recordedDuration(recordValue(data.meta) ?? recordValue(data.result));
      const pairedDuration = recorded ?? (paired?.startedAt !== undefined && time !== undefined
        ? Math.max(0, time - paired.startedAt)
        : undefined);
      if (pairedDuration !== undefined) tool.durationMs += pairedDuration;
      if (callId) pending.delete(callId);

      const failed = eventToolResultError(event);
      if (failed) {
        tool.errors += 1;
        toolFailures += 1;
        ensureTurn(key, stepTurn, time).toolFailures += 1;
      }
      continue;
    }

    if (event.type === "llm/retry-started" || event.type === "llm/retry") {
      retries += 1;
      currentTurnKey = key;
      ensureTurn(key, stepTurn, time).retries += 1;
      if (stepTurn !== undefined && stepIndex !== undefined) {
        const coordinate = `${stepTurn}/${stepIndex}`;
        if (!retriedStepKeys.has(coordinate)) {
          retriedStepKeys.add(coordinate);
          retriedSteps += 1;
        }
      }
      continue;
    }

    if (event.type === "turn/end") {
      const reason = recordValue(data.reason);
      const outcome = turnOutcome(reason);
      const turn = ensureTurn(key, stepTurn, time);
      turn.outcome = outcome;
      if (time !== undefined) turn.endedAt = time;
      currentTurnKey = undefined;
      continue;
    }
  }

  const toolRows: SessionCostToolRow[] = [...tools.values()]
    .map((tool) => ({
      name: tool.name,
      calls: tool.calls,
      errors: tool.errors,
      errorRate: tool.calls > 0 ? (tool.errors / tool.calls) * 100 : 0,
      resultChars: tool.resultChars,
      durationMs: tool.durationMs,
    }))
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name));

  const turnRows: SessionCostTurnRow[] = [...turns.values()]
    .map((turn) => ({
      key: turn.key,
      ...(turn.turn === undefined ? {} : { turn: turn.turn }),
      steps: turn.steps,
      toolCalls: turn.toolCalls,
      toolFailures: turn.toolFailures,
      retries: turn.retries,
      outcome: turn.outcome,
      ...(turn.startedAt !== undefined && turn.endedAt !== undefined && turn.endedAt >= turn.startedAt
        ? { durationMs: turn.endedAt - turn.startedAt }
        : {}),
    }))
    .sort((left, right) => (left.turn ?? Number.MAX_SAFE_INTEGER) - (right.turn ?? Number.MAX_SAFE_INTEGER));

  const repeatedCommands = [...commands.values()]
    .filter((command) => command.calls > 1)
    .sort((left, right) => right.calls - left.calls || left.command.localeCompare(right.command));
  const repeatedCommandCalls = repeatedCommands.reduce((total, command) => total + command.calls, 0);
  const failedTurns = turnRows.filter((turn) => turn.outcome === "error");

  return {
    tools: toolRows,
    turns: turnRows,
    toolCalls,
    toolFailures,
    toolErrorRate: toolCalls > 0 ? (toolFailures / toolCalls) * 100 : 0,
    retries,
    retriedSteps,
    resultChars,
    wastedTurns: failedTurns.length,
    wastedSteps: failedTurns.reduce((total, turn) => total + turn.steps, 0),
    wastedToolCalls: failedTurns.reduce((total, turn) => total + turn.toolCalls, 0),
    distinctCommands: commands.size,
    repeatedCommands,
    repeatedCommandCalls,
    repeatedCommandRate: repeatedCommandCalls > 0
      ? ((repeatedCommandCalls - repeatedCommands.length) / repeatedCommandCalls) * 100
      : 0,
  };
}
