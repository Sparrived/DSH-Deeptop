import type { DshHistoryEntry, DshSessionEvent } from "../lib/desktop";
import { toolApprovalLabel, type ToolApprovalOutcome } from "./permission-audit.ts";
import { t, type UiLocale } from "./i18n.ts";

export type TrajectoryKind = "system" | "user" | "context" | "assistant" | "tool" | "turn" | "approval";
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
  liveText?: string;
  usage?: unknown;
  final: boolean;
  error?: string;
};

// While a stream runs, `assistant/chunk` fires once or more per frame and the
// history is rebuilt on every flush. Re-pretty-printing the whole accumulated
// text on each chunk turns a long reasoning/text stream into O(total^2) work
// (a 78k-entry session took ~3s to open). The running record therefore keeps a
// cheap capped tail as its live summary and only materializes the full detail
// string once the step is finalized.
const TRAJECTORY_LIVE_PREVIEW = 240;

type CompactionState = {
  key: string;
  turn?: number;
  seq: number;
  time: number;
  start?: DshSessionEvent;
  summary?: DshSessionEvent;
  end?: DshSessionEvent;
};

type ApprovalState = {
  key: string;
  turn?: number;
  seq: number;
  time: number;
  toolName: string;
  reason?: string;
  callId?: string;
  outcome?: ToolApprovalOutcome;
};

function approvalKeyOf(id: string): string {
  return `approval-${id}`;
}

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

function contentText(content: unknown, locale: UiLocale = "zh"): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    const block = recordValue(item);
    if (!block) return "";
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") return block.text;
    if (block.type === "image") return t("trajectory.content.image", locale);
    if (block.type === "tool-call") return t("trajectory.content.toolCall", locale, { name: String(block.name ?? t("trajectory.title.defaultTool", locale)) });
    if (block.type === "tool-result") return contentText(block.content, locale);
    if (typeof block.text === "string") return block.text;
    return "";
  }).filter(Boolean).join("\n");
}

function blockList(blocks: Record<string, unknown>): unknown[] {
  return Object.keys(blocks)
    .sort((left, right) => Number(left) - Number(right))
    .map((index) => blocks[index]);
}

function blockSummary(blocks: unknown[], locale: UiLocale = "zh"): string {
  const text = contentText(blocks, locale);
  if (text.trim()) return preview(text);
  const calls = blocks.map(recordValue).filter(Boolean).map((block) => block?.name).filter((name): name is string => typeof name === "string");
  return calls.length > 0 ? t("trajectory.blockSummary.toolCalls", locale, { names: [...new Set(calls)].join("、") }) : t("trajectory.blockSummary.noOutput", locale);
}

function durationMs(startedAt?: number, completedAt?: number): number | null {
  if (startedAt === undefined || completedAt === undefined || completedAt < startedAt) return null;
  return completedAt - startedAt;
}

export function durationLabel(value?: number | null, locale: UiLocale = "zh"): string {
  if (value === undefined || value === null) return t("trajectory.unavailable", locale);
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`;
}

function usageLabel(value: unknown, locale: UiLocale = "zh"): string {
  const usage = recordValue(value);
  if (!usage) return "";
  const input = numberValue(usage.inputTokens ?? usage.input);
  const output = numberValue(usage.outputTokens ?? usage.output);
  const reasoning = numberValue(usage.reasoningTokens ?? usage.reasoning);
  return [
    input === undefined ? "" : t("trajectory.usage.input", locale, { n: input }),
    output === undefined ? "" : t("trajectory.usage.output", locale, { n: output }),
    reasoning === undefined ? "" : t("trajectory.usage.reasoning", locale, { n: reasoning }),
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

function eventResult(event: DshSessionEvent, locale: UiLocale = "zh"): { text: string; error: boolean; raw: unknown } {
  const data = event.data ?? {};
  const message = eventMessage(event);
  const content = message?.content ?? data.content;
  const first = Array.isArray(content) ? recordValue(content[0]) : undefined;
  const resultContent = first?.type === "tool-result" ? first.content : content;
  return {
    text: contentText(resultContent, locale) || (data.error ? String(data.error) : t("trajectory.result.noContent", locale)),
    error: first?.isError === true || data.error !== undefined || data.isError === true,
    raw: resultContent,
  };
}

function eventSource(event: DshSessionEvent): Record<string, unknown> | undefined {
  return recordValue(event.data?.source) ?? recordValue(eventMessage(event)?.source);
}

function sourceLabel(source: Record<string, unknown> | undefined, locale: UiLocale = "zh"): string {
  if (!source) return t("trajectory.source.context", locale);
  const kind = String(source.kind ?? "context");
  if (kind === "user") return t("trajectory.source.user", locale);
  if (kind === "model") return t("trajectory.source.model", locale);
  if (kind === "tool") return t("trajectory.source.tool", locale);
  if (kind === "plugin") return t("trajectory.source.contextWith", locale, { name: String(source.plugin ?? source.form ?? kind) });
  return t("trajectory.source.contextWith", locale, { name: kind });
}

function isHumanMessage(event: DshSessionEvent): boolean {
  const source = eventSource(event);
  return source === undefined || source.kind === "user";
}

function stepKey(turn: number | undefined, step: number | undefined, seq: number): string {
  return `${turn ?? "?"}:${step ?? "?"}:${turn === undefined && step === undefined ? seq : ""}`;
}

function applyAssistantChunk(state: AssistantState, chunk: Record<string, unknown>, locale: UiLocale = "zh") {
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
    const delta = String(chunk.text ?? "");
    if (delta) {
      state.liveText = `${state.liveText ?? ""}${delta}`.slice(-TRAJECTORY_LIVE_PREVIEW);
    }
  } else if (type === "tool-call-delta") {
    const previous = recordValue(state.blocks[key]);
    state.blocks[key] = {
      type: "tool-call",
      id: String(previous?.id ?? chunk.id ?? ""),
      name: String(previous?.name ?? chunk.name ?? t("trajectory.title.defaultTool", locale)),
      arguments: `${typeof previous?.arguments === "string" ? previous.arguments : ""}${String(chunk.argumentsDelta ?? "")}`,
    };
  } else if (type === "block-end") {
    state.blocks[key] = chunk.block;
  }
  if (type === "usage") state.usage = chunk.usage;
}

function buildAssistantRecord(state: AssistantState, status: TrajectoryStatus, locale: UiLocale = "zh"): TrajectoryRecord {
  // A running record only needs a cheap live summary; the full blocks text and
  // its pretty-printed detail are O(accumulated length) to derive, so they are
  // computed once the step actually finishes (assistant/message or step/end).
  const final = state.final || status !== "running";
  const blocks = final ? blockList(state.blocks) : [];
  const usage = usageLabel(state.usage, locale);
  const statusText = state.error ? ` · ${state.error}` : usage ? ` · ${usage}` : "";
  const live = (state.liveText ?? "").trim();
  const summary = final ? `${blockSummary(blocks, locale)}${statusText}` : `${live ? preview(live) : t("trajectory.streaming.generating", locale)}${statusText}`;
  const detail = final
    ? pretty({ blocks, usage: state.usage, error: state.error })
    : live
      ? `${t("trajectory.streaming.waitingDetail", locale)}\n\n${preview(live, 2000)}`
      : t("trajectory.streaming.waitingDetail", locale);
  return {
    key: `assistant-${state.key}`,
    seq: state.recordSeq,
    time: state.recordTime,
    kind: "assistant",
    status,
    title: t("trajectory.title.assistant", locale),
    summary,
    detail,
    turn: state.turn,
    step: state.step,
    startedAt: state.startedAt,
    durationMs: durationMs(state.startedAt, state.completedAt),
  };
}

function buildCompactionRecord(state: CompactionState, locale: UiLocale = "zh"): TrajectoryRecord {
  const startData = state.start?.data ?? {};
  const summaryData = state.summary?.data ?? {};
  const endData = state.end?.data ?? {};
  const summary = stringValue(summaryData.summary) ?? (state.end ? t("trajectory.compaction.done", locale) : t("trajectory.compaction.running", locale));
  const error = endData.error !== undefined ? String(endData.error) : undefined;
  const completedAt = state.end?.time;
  return {
    key: `compaction-${state.key}`,
    seq: state.seq,
    time: state.time,
    kind: "system",
    status: error ? "error" : state.end ? "complete" : "running",
    title: t("trajectory.compaction.title", locale),
    summary: error ? t("trajectory.compaction.error", locale, { error }) : preview(summary),
    detail: pretty({ start: startData, summary: summaryData, end: endData }),
    turn: state.turn,
    startedAt: state.start?.time,
    durationMs: durationMs(state.start?.time, completedAt),
  };
}

const APPROVAL_OUTCOMES: Record<ToolApprovalOutcome, TrajectoryStatus> = {
  "allowed-once": "complete",
  rejected: "error",
  cancelled: "info",
  unavailable: "error",
};

function buildApprovalRecord(state: ApprovalState, locale: UiLocale = "zh"): TrajectoryRecord {
  const outcome = state.outcome;
  const label = outcome ? toolApprovalLabel(outcome, locale) : t("trajectory.approval.pending", locale);
  return {
    key: state.key,
    seq: state.seq,
    time: state.time,
    kind: "approval",
    status: outcome ? APPROVAL_OUTCOMES[outcome] : "running",
    title: state.toolName,
    summary: `${label}${state.reason ? ` · ${preview(state.reason)}` : ""}`,
    detail: pretty({ toolName: state.toolName, callId: state.callId, reason: state.reason, outcome }),
    turn: state.turn,
    callId: state.callId,
  };
}

export function buildTrajectoryRecords(entries: DshHistoryEntry[], locale: UiLocale = "zh"): TrajectoryRecord[] {
  const records = new Map<string, TrajectoryRecord>();
  const order: string[] = [];
  const assistants = new Map<string, AssistantState>();
  const tools = new Map<string, string>();
  const compactions = new Map<string, CompactionState>();
  const approvals = new Map<string, ApprovalState>();
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
      const summary = [provider && model ? `${provider} / ${model}` : t("trajectory.title.request", locale), toolsCount ? t("trajectory.tool.count", locale, { count: toolsCount }) : t("trajectory.tool.none", locale)]
        .join(" · ");
      put({
        key: `request-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: t("trajectory.title.requestConfig", locale),
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
        title: t("trajectory.title.routeContext", locale),
        summary: [stringValue(data.provider), stringValue(data.model)].filter(Boolean).join(" / ") || t("trajectory.title.modelRouteContext", locale),
        detail: pretty(data),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "user/message") {
      const content = contentText(data.content, locale) || t("trajectory.text.noContent", locale);
      const human = isHumanMessage(event);
      put({
        key: `event-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: human ? "user" : "context",
        status: "complete",
        title: human ? t("trajectory.source.user", locale) : sourceLabel(eventSource(event), locale),
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
      applyAssistantChunk(state, recordValue(data.chunk) ?? {}, locale);
      assistants.set(key, state);
      put(buildAssistantRecord(state, "running", locale));
      continue;
    }

    if (event.type === "assistant/message") {
      const key = stepKey(turn, step, event.seq);
      const message = eventMessage(event) ?? {};
      const state = assistants.get(key) ?? {
        key,
        turn,
        step,
        recordSeq: entry.displayFirstChunkSeq ?? event.seq,
        recordTime: entry.displayFirstChunkTime ?? event.time,
        startedAt: stepStarts.get(key),
        blocks: {},
        final: false,
      };
      if (entry.displayFirstChunkSeq !== undefined && entry.displayFirstChunkSeq < state.recordSeq) {
        state.recordSeq = entry.displayFirstChunkSeq;
        state.recordTime = entry.displayFirstChunkTime ?? state.recordTime;
      }
      state.blocks = {};
      const content = Array.isArray(message.content) ? message.content : [];
      content.forEach((block, index) => { state.blocks[String(index)] = block; });
      state.usage = data.usage;
      state.completedAt = event.time;
      state.final = true;
      assistants.set(key, state);
      put(buildAssistantRecord(state, "complete", locale));
      continue;
    }

    if (event.type === "tool/call") {
      const callId = eventCallId(event) ?? `seq-${event.seq}`;
      const key = `tool-${callId}`;
      const name = stringValue(data.name) ?? t("trajectory.title.defaultTool", locale);
      const argumentsText = pretty(data.arguments ?? {});
      tools.set(callId, key);
      put({
        key,
        seq: event.seq,
        time: event.time,
        kind: "tool",
        status: "running",
        title: name,
        summary: t("trajectory.tool.waitingResult", locale),
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
      const result = eventResult(event, locale);
      const current = records.get(key);
      const name = current?.title ?? t("trajectory.title.defaultTool", locale);
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
          summary: result.error ? t("trajectory.tool.error", locale) : preview(result.text),
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
          summary: result.error ? t("trajectory.tool.error", locale) : preview(result.text),
          detail: pretty({ name, callId, arguments: current.argumentsText, result: result.raw, view: entry.view }),
          resultText: result.text,
          resultError: result.error,
          durationMs: durationMs(startedAt, event.time),
        });
      }
      if (viewText) patch(key, { detail: `${records.get(key)?.detail ?? ""}\n\n${t("trajectory.view.presented", locale)}\n${viewText}` });
      continue;
    }

    if (event.type === "step/end") {
      const key = stepKey(turn, step, event.seq);
      const state = assistants.get(key);
      if (state && !state.final) {
        state.completedAt = event.time;
        state.error = t("trajectory.step.noFinalMessage", locale);
        assistants.set(key, state);
        put(buildAssistantRecord(state, "error", locale));
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
        title: t("trajectory.turn.end", locale, { turn: turn ?? "?" }),
        summary: isError ? t("trajectory.turn.reason", locale, { reason: reasonKind }) : t("trajectory.turn.complete", locale),
        detail: pretty({ reason: data.reason }),
        turn,
        startedAt: turn === undefined ? undefined : turnStarts.get(turn),
        durationMs: durationMs(turn === undefined ? undefined : turnStarts.get(turn), event.time),
      });
      currentStep = undefined;
      continue;
    }

    if (event.type === "approval/asked" || event.type === "approval/decided") {
      const id = stringValue(data.id);
      if (!id) continue;
      const key = approvalKeyOf(id);
      const current = approvals.get(key) ?? {
        key,
        turn,
        seq: event.seq,
        time: event.time,
        toolName: stringValue(data.toolName) ?? "tool",
      };
      if (event.type === "approval/asked") {
        current.toolName = stringValue(data.toolName) ?? current.toolName;
        current.reason = stringValue(data.reason) ?? current.reason;
        current.callId = stringValue(data.callId) ?? current.callId;
        current.seq = event.seq;
        current.time = event.time;
      } else if (current.outcome === undefined) {
        const outcome = stringValue(data.outcome);
        if (outcome !== undefined && outcome in APPROVAL_OUTCOMES) {
          current.outcome = outcome as ToolApprovalOutcome;
          current.seq = event.seq;
          current.time = event.time;
        }
      }
      approvals.set(key, current);
      put(buildApprovalRecord(current, locale));
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
      put(buildCompactionRecord(current, locale));
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

  return order
    .map((key) => records.get(key))
    .filter((record): record is TrajectoryRecord => record !== undefined)
    .sort((left, right) => left.seq - right.seq);
}
