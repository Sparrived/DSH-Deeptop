import type { DshHistoryEntry, DshSessionEvent } from "../lib/desktop";

export type TrajectoryKind = "system" | "user" | "context" | "assistant" | "tool" | "turn";
export type TrajectoryStatus = "complete" | "running" | "error" | "info";

export type TrajectoryRecord = {
  key: string;
  seq: number;
  time: number;
  kind: TrajectoryKind;
  status: TrajectoryStatus;
  title: string;
  summary: string;
  detail: string;
  turn?: number;
  step?: number;
  startedAt?: number;
  durationMs?: number | null;
  callId?: string;
  argumentsText?: string;
  resultText?: string;
  resultError?: boolean;
};

type AssistantState = {
  key: string;
  turn?: number;
  step?: number;
  recordSeq: number;
  recordTime: number;
  startedAt?: number;
  completedAt?: number;
  blocks: Record<string, unknown>;
  usage?: unknown;
  final: boolean;
  error?: string;
};

type CompactionState = {
  key: string;
  turn?: number;
  seq: number;
  time: number;
  start?: DshSessionEvent;
  summary?: DshSessionEvent;
  end?: DshSessionEvent;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function preview(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    const block = recordValue(item);
    if (!block) return "";
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") return block.text;
    if (block.type === "image") return "[图片]";
    if (block.type === "tool-call") return `调用 ${String(block.name ?? "工具")}`;
    if (block.type === "tool-result") return contentText(block.content);
    if (typeof block.text === "string") return block.text;
    return "";
  }).filter(Boolean).join("\n");
}

function blockList(blocks: Record<string, unknown>): unknown[] {
  return Object.keys(blocks)
    .sort((left, right) => Number(left) - Number(right))
    .map((index) => blocks[index]);
}

function blockSummary(blocks: unknown[]): string {
  const text = contentText(blocks);
  if (text.trim()) return preview(text);
  const calls = blocks.map(recordValue).filter(Boolean).map((block) => block?.name).filter((name): name is string => typeof name === "string");
  return calls.length > 0 ? `工具调用：${[...new Set(calls)].join("、")}` : "（无可见输出）";
}

function durationMs(startedAt?: number, completedAt?: number): number | null {
  if (startedAt === undefined || completedAt === undefined || completedAt < startedAt) return null;
  return completedAt - startedAt;
}

export function durationLabel(value?: number | null): string {
  if (value === undefined || value === null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`;
}

function usageLabel(value: unknown): string {
  const usage = recordValue(value);
  if (!usage) return "";
  const input = numberValue(usage.inputTokens ?? usage.input);
  const output = numberValue(usage.outputTokens ?? usage.output);
  const reasoning = numberValue(usage.reasoningTokens ?? usage.reasoning);
  return [
    input === undefined ? "" : `输入 ${input}`,
    output === undefined ? "" : `输出 ${output}`,
    reasoning === undefined ? "" : `思考 ${reasoning}`,
  ].filter(Boolean).join(" · ");
}

function eventMessage(event: DshSessionEvent): Record<string, unknown> | undefined {
  return recordValue(event.data?.message);
}

function eventCallId(event: DshSessionEvent): string | undefined {
  const data = event.data ?? {};
  if (event.type === "tool/call") return stringValue(data.callId);
  const message = eventMessage(event);
  const source = recordValue(message?.source);
  const content = Array.isArray(message?.content) ? recordValue(message.content[0]) : undefined;
  return stringValue(source?.callId ?? content?.toolCallId ?? data.callId);
}

function eventResult(event: DshSessionEvent): { text: string; error: boolean; raw: unknown } {
  const data = event.data ?? {};
  const message = eventMessage(event);
  const content = message?.content ?? data.content;
  const first = Array.isArray(content) ? recordValue(content[0]) : undefined;
  const resultContent = first?.type === "tool-result" ? first.content : content;
  return {
    text: contentText(resultContent) || (data.error ? String(data.error) : "（无返回内容）"),
    error: first?.isError === true || data.error !== undefined || data.isError === true,
    raw: resultContent,
  };
}

function eventSource(event: DshSessionEvent): Record<string, unknown> | undefined {
  return recordValue(event.data?.source) ?? recordValue(eventMessage(event)?.source);
}

function sourceLabel(source: Record<string, unknown> | undefined): string {
  if (!source) return "上下文";
  const kind = String(source.kind ?? "context");
  if (kind === "user") return "用户";
  if (kind === "model") return "模型";
  if (kind === "tool") return "工具";
  if (kind === "plugin") return `上下文 · ${String(source.plugin ?? source.form ?? kind)}`;
  return `上下文 · ${kind}`;
}

function isHumanMessage(event: DshSessionEvent): boolean {
  const source = eventSource(event);
  return source === undefined || source.kind === "user";
}

function stepKey(turn: number | undefined, step: number | undefined, seq: number): string {
  return `${turn ?? "?"}:${step ?? "?"}:${turn === undefined && step === undefined ? seq : ""}`;
}

function applyAssistantChunk(state: AssistantState, chunk: Record<string, unknown>) {
  const type = String(chunk.type ?? "");
  const index = numberValue(chunk.index);
  if (index === undefined) return;
  const key = String(index);
  if (type === "block-start") {
    state.blocks[key] = { type: chunk.blockType, text: "" };
  } else if (type === "text-delta" || type === "reasoning-delta") {
    const previous = recordValue(state.blocks[key]);
    state.blocks[key] = {
      type: type === "text-delta" ? "text" : "reasoning",
      text: `${typeof previous?.text === "string" ? previous.text : ""}${String(chunk.text ?? "")}`,
    };
  } else if (type === "tool-call-delta") {
    const previous = recordValue(state.blocks[key]);
    state.blocks[key] = {
      type: "tool-call",
      id: String(previous?.id ?? chunk.id ?? ""),
      name: String(previous?.name ?? chunk.name ?? "工具"),
      arguments: `${typeof previous?.arguments === "string" ? previous.arguments : ""}${String(chunk.argumentsDelta ?? "")}`,
    };
  } else if (type === "block-end") {
    state.blocks[key] = chunk.block;
  }
  if (type === "usage") state.usage = chunk.usage;
}

function buildAssistantRecord(state: AssistantState, status: TrajectoryStatus): TrajectoryRecord {
  const blocks = blockList(state.blocks);
  const usage = usageLabel(state.usage);
  const statusText = state.error ? ` · ${state.error}` : usage ? ` · ${usage}` : "";
  return {
    key: `assistant-${state.key}`,
    seq: state.recordSeq,
    time: state.recordTime,
    kind: "assistant",
    status,
    title: "助手",
    summary: `${blockSummary(blocks)}${statusText}`,
    detail: pretty({ blocks, usage: state.usage, error: state.error }),
    turn: state.turn,
    step: state.step,
    startedAt: state.startedAt,
    durationMs: durationMs(state.startedAt, state.completedAt),
  };
}

function buildCompactionRecord(state: CompactionState): TrajectoryRecord {
  const startData = state.start?.data ?? {};
  const summaryData = state.summary?.data ?? {};
  const endData = state.end?.data ?? {};
  const summary = stringValue(summaryData.summary) ?? (state.end ? "压缩已结束" : "正在压缩上下文");
  const error = endData.error !== undefined ? String(endData.error) : undefined;
  const completedAt = state.end?.time;
  return {
    key: `compaction-${state.key}`,
    seq: state.seq,
    time: state.time,
    kind: "system",
    status: error ? "error" : state.end ? "complete" : "running",
    title: "上下文压缩",
    summary: error ? `压缩失败：${error}` : preview(summary),
    detail: pretty({ start: startData, summary: summaryData, end: endData }),
    turn: state.turn,
    startedAt: state.start?.time,
    durationMs: durationMs(state.start?.time, completedAt),
  };
}

export function buildTrajectoryRecords(entries: DshHistoryEntry[]): TrajectoryRecord[] {
  const records = new Map<string, TrajectoryRecord>();
  const order: string[] = [];
  const assistants = new Map<string, AssistantState>();
  const tools = new Map<string, string>();
  const compactions = new Map<string, CompactionState>();
  const turnStarts = new Map<number, number>();
  const stepStarts = new Map<string, number>();
  let currentTurn: number | undefined;
  let currentStep: number | undefined;

  const put = (record: TrajectoryRecord) => {
    if (!records.has(record.key)) order.push(record.key);
    records.set(record.key, { ...records.get(record.key), ...record });
  };

  const patch = (key: string, value: Partial<TrajectoryRecord>) => {
    const current = records.get(key);
    if (current) records.set(key, { ...current, ...value });
  };

  const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  for (const entry of sorted) {
    const event = entry.event;
    const data = event.data ?? {};
    const turn = numberValue(data.turn) ?? currentTurn;
    const step = numberValue(data.step) ?? currentStep;
    if (numberValue(data.turn) !== undefined) currentTurn = numberValue(data.turn);
    if (numberValue(data.step) !== undefined) currentStep = numberValue(data.step);

    if (event.type === "turn/start") {
      if (turn !== undefined) turnStarts.set(turn, event.time);
      currentTurn = turn;
      currentStep = undefined;
      continue;
    }

    if (event.type === "step/start") {
      const key = stepKey(turn, step, event.seq);
      stepStarts.set(key, event.time);
      const existing = assistants.get(key);
      assistants.set(key, existing ?? {
        key,
        turn,
        step,
        recordSeq: event.seq,
        recordTime: event.time,
        startedAt: event.time,
        blocks: {},
        final: false,
      });
      currentStep = step;
      continue;
    }

    if (event.type === "request/header") {
      const header = recordValue(data.header) ?? {};
      const config = recordValue(header.config) ?? {};
      const toolsCount = Array.isArray(header.tools) ? header.tools.length : 0;
      const provider = stringValue(config.provider);
      const model = stringValue(config.model);
      const summary = [provider && model ? `${provider} / ${model}` : "模型请求", toolsCount ? `${toolsCount} 个工具` : "无工具"]
        .join(" · ");
      put({
        key: `request-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: "请求配置",
        summary,
        detail: pretty(header),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "request/context") {
      put({
        key: `request-context-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: "路由上下文",
        summary: [stringValue(data.provider), stringValue(data.model)].filter(Boolean).join(" / ") || "模型路由上下文",
        detail: pretty(data),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "user/message") {
      const content = contentText(data.content) || "（无文本内容）";
      const human = isHumanMessage(event);
      put({
        key: `event-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: human ? "user" : "context",
        status: "complete",
        title: human ? "用户" : sourceLabel(eventSource(event)),
        summary: preview(content),
        detail: pretty({ content: data.content, source: data.source }),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "assistant/chunk") {
      const key = stepKey(turn, step, event.seq);
      const state = assistants.get(key) ?? {
        key,
        turn,
        step,
        recordSeq: event.seq,
        recordTime: event.time,
        startedAt: stepStarts.get(key),
        blocks: {},
        final: false,
      };
      if (state.startedAt === undefined) state.startedAt = stepStarts.get(key);
      applyAssistantChunk(state, recordValue(data.chunk) ?? {});
      assistants.set(key, state);
      put(buildAssistantRecord(state, "running"));
      continue;
    }

    if (event.type === "assistant/message") {
      const key = stepKey(turn, step, event.seq);
      const message = eventMessage(event) ?? {};
      const state = assistants.get(key) ?? {
        key,
        turn,
        step,
        recordSeq: event.seq,
        recordTime: event.time,
        startedAt: stepStarts.get(key),
        blocks: {},
        final: false,
      };
      state.blocks = {};
      const content = Array.isArray(message.content) ? message.content : [];
      content.forEach((block, index) => { state.blocks[String(index)] = block; });
      state.usage = data.usage;
      state.completedAt = event.time;
      state.final = true;
      assistants.set(key, state);
      put(buildAssistantRecord(state, "complete"));
      continue;
    }

    if (event.type === "tool/call") {
      const callId = eventCallId(event) ?? `seq-${event.seq}`;
      const key = `tool-${callId}`;
      const name = stringValue(data.name) ?? "工具";
      const argumentsText = pretty(data.arguments ?? {});
      tools.set(callId, key);
      put({
        key,
        seq: event.seq,
        time: event.time,
        kind: "tool",
        status: "running",
        title: name,
        summary: "等待工具结果",
        detail: pretty({ name, callId, arguments: data.arguments, view: entry.view }),
        turn,
        step,
        callId,
        argumentsText,
        startedAt: event.time,
        durationMs: null,
      });
      continue;
    }

    if (event.type === "tool/result") {
      const callId = eventCallId(event) ?? `seq-${event.seq}`;
      const key = tools.get(callId) ?? `tool-result-${event.seq}`;
      const result = eventResult(event);
      const current = records.get(key);
      const name = current?.title ?? "工具";
      const startedAt = current?.startedAt;
      const viewText = entry.view ? pretty(entry.view) : undefined;
      if (!current) {
        put({
          key,
          seq: event.seq,
          time: event.time,
          kind: "tool",
          status: result.error ? "error" : "complete",
          title: name,
          summary: result.error ? "工具返回错误" : preview(result.text),
          detail: pretty({ callId, result: result.raw, view: entry.view }),
          turn,
          step,
          callId,
          resultText: result.text,
          resultError: result.error,
          durationMs: null,
        });
      } else {
        patch(key, {
          seq: current.seq,
          time: current.time,
          status: result.error ? "error" : "complete",
          summary: result.error ? "工具返回错误" : preview(result.text),
          detail: pretty({ name, callId, arguments: current.argumentsText, result: result.raw, view: entry.view }),
          resultText: result.text,
          resultError: result.error,
          durationMs: durationMs(startedAt, event.time),
        });
      }
      if (viewText) patch(key, { detail: `${records.get(key)?.detail ?? ""}\n\n呈现视图\n${viewText}` });
      continue;
    }

    if (event.type === "step/end") {
      const key = stepKey(turn, step, event.seq);
      const state = assistants.get(key);
      if (state && !state.final) {
        state.completedAt = event.time;
        state.error = "步骤未产生最终助手消息";
        assistants.set(key, state);
        put(buildAssistantRecord(state, "error"));
      }
      continue;
    }

    if (event.type === "turn/end") {
      const reason = recordValue(data.reason);
      const reasonKind = String(reason?.kind ?? "completed");
      const isError = !["completed", "stop", "success"].includes(reasonKind);
      put({
        key: `turn-end-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "turn",
        status: isError ? "error" : "complete",
        title: `第 ${turn ?? "?"} 轮结束`,
        summary: isError ? `结束原因：${reasonKind}` : "已完成",
        detail: pretty({ reason: data.reason }),
        turn,
        startedAt: turn === undefined ? undefined : turnStarts.get(turn),
        durationMs: durationMs(turn === undefined ? undefined : turnStarts.get(turn), event.time),
      });
      currentStep = undefined;
      continue;
    }

    if (event.type === "compaction/start" || event.type === "compaction/summary" || event.type === "compaction/end") {
      const compactionId = stringValue(data.compactionId) ?? `seq-${event.seq}`;
      const current = compactions.get(compactionId) ?? {
        key: compactionId,
        turn,
        seq: event.seq,
        time: event.time,
      };
      if (event.type === "compaction/start") current.start = event;
      if (event.type === "compaction/summary") current.summary = event;
      if (event.type === "compaction/end") current.end = event;
      compactions.set(compactionId, current);
      put(buildCompactionRecord(current));
      continue;
    }

    if (event.type !== "session/end-seed" && event.type !== "todo/write") {
      put({
        key: `event-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: event.type,
        summary: preview(pretty(data)),
        detail: pretty(data),
        turn,
        step,
      });
    }
  }

  return order.map((key) => records.get(key)).filter((record): record is TrajectoryRecord => record !== undefined);
}
