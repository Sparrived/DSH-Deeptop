import type { DshHistoryEntry, DshJob, DshSessionEvent } from "../lib/desktop";
import type { DiffHunk, DiffSummary, MessageStats, SessionStats, TranscriptImage, TranscriptItem } from "./model-types";

export type ContentSegments = { text: string; reasoning: string; images: TranscriptImage[] };

export function contentSegments(content: unknown): ContentSegments {
  if (typeof content === "string") return { text: content, reasoning: "", images: [] };
  if (!Array.isArray(content)) return { text: "", reasoning: "", images: [] };
  const text: string[] = [];
  const reasoning: string[] = [];
  const images: TranscriptImage[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const value = block as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") text.push(value.text);
    else if (value.type === "reasoning" && typeof value.text === "string") reasoning.push(value.text);
    else if (value.type === "image") {
      const attachment = recordValue(value.attachment);
      const data = typeof value.data === "string" ? value.data : undefined;
      const attachmentId = typeof value.attachmentId === "string"
        ? value.attachmentId
        : typeof attachment?.attachmentId === "string" ? attachment.attachmentId : undefined;
      if (data || attachmentId) {
        images.push({
          mediaType: typeof value.mediaType === "string"
            ? value.mediaType
            : typeof attachment?.mediaType === "string" ? attachment.mediaType : "image/png",
          ...(data ? { data } : {}),
          ...(attachmentId ? { attachmentId } : {}),
          name: typeof value.name === "string"
            ? value.name
            : typeof attachment?.name === "string" ? attachment.name : undefined,
        });
      }
    }
    else if (value.type === "tool-result") {
      const nested = contentSegments(value.content);
      if (nested.text) text.push(nested.text);
      if (nested.reasoning) reasoning.push(nested.reasoning);
      images.push(...nested.images);
    }
  }
  return { text: text.filter(Boolean).join("\n"), reasoning: reasoning.filter(Boolean).join("\n"), images };
}

export function jobStatusLabel(status: DshJob["status"]) {
  if (status === "running") return "运行中";
  if (status === "stopping") return "停止中";
  if (status === "completed") return "已完成";
  if (status === "killed") return "已终止";
  return "失败";
}

export function jobDuration(job: DshJob, now: number) {
  const elapsed = Math.max(0, (job.finishedAt ?? now) - job.startedAt);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function textFromContent(content: unknown): string {
  const segments = contentSegments(content);
  return segments.text || (segments.images.length > 0 ? "[图片]" : "");
}

export function assistantContent(event: DshSessionEvent): unknown {
  const message = event.data?.message;
  if (message && typeof message === "object") return (message as Record<string, unknown>).content;
  return event.data?.content;
}

export function eventContent(event: DshSessionEvent) {
  const data = event.data ?? {};
  if (event.type === "user/message") return textFromContent(data.content);
  if (event.type === "assistant/message" || event.type === "tool/result") {
    return textFromContent(assistantContent(event));
  }
  return "";
}

export function imageSource(image: TranscriptImage) {
  if (!image.data) return "";
  return image.data.startsWith("data:") ? image.data : `data:${image.mediaType};base64,${image.data}`;
}

export function streamKey(event: DshSessionEvent) {
  const coordinates = eventCoordinates(event);
  const turn = coordinates?.turn;
  const step = coordinates?.step;
  return `${turn ?? "?"}/${step ?? "?"}`;
}

function eventCoordinates(event: DshSessionEvent) {
  const message = recordValue(event.data?.message);
  const turn = numberValue(event.data?.turn) ?? numberValue(message?.turn);
  const step = numberValue(event.data?.step) ?? numberValue(message?.step);
  return turn === undefined || step === undefined ? undefined : { turn, step };
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function mergeRecords(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) {
  return left || right ? { ...left, ...right } : undefined;
}

function eventUsage(event: DshSessionEvent) {
  const message = recordValue(event.data?.message);
  const chunk = recordValue(event.data?.chunk);
  return recordValue(event.data?.usage)
    ?? recordValue(event.data?.tokenUsage)
    ?? recordValue(chunk?.usage)
    ?? recordValue(message?.usage);
}

function hasTokenDelta(event: DshSessionEvent) {
  if (event.type !== "assistant/chunk") return false;
  const chunk = recordValue(event.data?.chunk);
  if (!chunk) return false;
  if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") return typeof chunk.text === "string" && chunk.text !== "";
  return chunk.type === "tool-call-delta"
    && ((typeof chunk.argumentsDelta === "string" && chunk.argumentsDelta !== "") || chunk.name !== undefined);
}

export type UsageTokenBuckets = {
  uncachedInput?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
};

export function usageTokenBuckets(usage: Record<string, unknown> | undefined): UsageTokenBuckets {
  if (!usage) return {};
  return {
    uncachedInput: numberValue(usage.uncachedInputTokens ?? usage.uncached_input_tokens),
    // A generic cached-input field is a read bucket. Providers that expose
    // cache creation/write usage use the explicit *Creation alias below.
    cacheRead: numberValue(usage.cacheReadTokens ?? usage.cacheRead ?? usage.cache_read ?? usage.cachedInputTokens ?? usage.cached_input_tokens),
    cacheWrite: numberValue(usage.cacheWriteTokens ?? usage.cacheWrite ?? usage.cache_write ?? usage.cachedInputTokensCreation ?? usage.cached_input_tokens_creation),
    reasoning: numberValue(usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.reasoning),
  };
}

function usageStats(usage: Record<string, unknown> | undefined): MessageStats {
  if (!usage) return {};
  const buckets = usageTokenBuckets(usage);
  const uncachedInput = buckets.uncachedInput;
  const cacheRead = buckets.cacheRead;
  const cacheWrite = buckets.cacheWrite;
  const rawInput = numberValue(usage.inputTokens ?? usage.input_tokens);
  const hasCacheBuckets = uncachedInput !== undefined || cacheRead !== undefined || cacheWrite !== undefined;
  // input_tokens is already the provider's input total when present; cache
  // buckets are only a breakdown. Derive a total from buckets only when it is absent.
  const input = rawInput ?? (uncachedInput === undefined ? undefined : uncachedInput + (cacheRead ?? 0) + (cacheWrite ?? 0));
  const output = numberValue(usage.outputTokens ?? usage.output_tokens);
  // The dashboard defines total usage as input + output. Reasoning is a
  // provider-reported subset of output, so it must not be added again.
  const total = input === undefined || output === undefined ? undefined : input + output;
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(total === undefined ? {} : { totalTokens: total }),
    ...(buckets.reasoning === undefined ? {} : { reasoningTokens: buckets.reasoning }),
    ...(uncachedInput !== undefined ? { uncachedInputTokens: uncachedInput } : {}),
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(hasCacheBuckets && input !== undefined && input > 0 ? { cacheHitRate: ((cacheRead ?? 0) / input) * 100 } : {}),
  };
}

export function assistantMessageStats(entries: DshHistoryEntry[]): Map<number, MessageStats> {
  const steps = new Map<string, { stepStartTime?: number; firstTokenTime?: number; usage?: Record<string, unknown> }>();
  const result = new Map<number, MessageStats>();
  let fallbackIndex = 0;
  let fallbackKey = `fallback/${fallbackIndex}`;
  for (const { event } of [...entries].sort((left, right) => left.event.seq - right.event.seq)) {
    const key = eventCoordinates(event);
    if (!key && event.type === "step/start") {
      fallbackIndex += 1;
      fallbackKey = `fallback/${fallbackIndex}`;
    }
    const keyText = key ? `${key.turn}/${key.step}` : fallbackKey;
    const state = steps.get(keyText) ?? {};
    if (event.type === "step/start") state.stepStartTime = event.time;
    if (hasTokenDelta(event) && state.firstTokenTime === undefined) state.firstTokenTime = event.time;
    const usage = eventUsage(event);
    if (usage) state.usage = mergeRecords(state.usage, usage);
    steps.set(keyText, state);
    if (event.type !== "assistant/message") continue;
    const stats = usageStats(state.usage);
    if (state.stepStartTime !== undefined) stats.runMs = Math.max(0, event.time - state.stepStartTime);
    if (state.stepStartTime !== undefined && state.firstTokenTime !== undefined) {
      stats.ttftMs = Math.max(0, state.firstTokenTime - state.stepStartTime);
    }
    if (state.firstTokenTime !== undefined && stats.outputTokens !== undefined) {
      const decodeMs = Math.max(0, event.time - state.firstTokenTime);
      if (decodeMs > 0) stats.tokensPerSecond = stats.outputTokens / (decodeMs / 1000);
    }
    if (Object.keys(stats).length > 0) result.set(event.seq, stats);
    if (!key) {
      steps.delete(keyText);
      fallbackIndex += 1;
      fallbackKey = `fallback/${fallbackIndex}`;
    }
  }
  return result;
}

function hasNumericTokenUsage(value: Record<string, unknown> | undefined) {
  if (!value) return false;
  return [
    "inputTokens", "input_tokens", "outputTokens", "output_tokens", "totalTokens", "total_tokens",
    "reasoningTokens", "reasoning_tokens", "uncachedInputTokens", "uncached_input_tokens",
    "cacheReadTokens", "cache_read_tokens", "cacheRead", "cache_read", "cachedInputTokens", "cached_input_tokens",
    "cacheWriteTokens", "cache_write_tokens", "cachedInputTokensCreation", "cached_input_tokens_creation",
  ].some((key) => numberValue(value[key]) !== undefined);
}

function historyTokenAggregate(entries: DshHistoryEntry[]) {
  const aggregate = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let available = false;
  for (const stats of assistantMessageStats(entries).values()) {
    const hasTokens = [
      stats.inputTokens, stats.outputTokens, stats.totalTokens, stats.reasoningTokens,
      stats.uncachedInputTokens, stats.cacheReadTokens, stats.cacheWriteTokens,
    ].some((value) => value !== undefined);
    if (!hasTokens) continue;
    available = true;
    const inputTokens = stats.inputTokens ?? 0;
    const outputTokens = stats.outputTokens ?? 0;
    aggregate.inputTokens += inputTokens;
    aggregate.outputTokens += outputTokens;
    aggregate.reasoningTokens += stats.reasoningTokens ?? 0;
    aggregate.totalTokens += stats.totalTokens ?? inputTokens + outputTokens;
    aggregate.uncachedInputTokens += stats.uncachedInputTokens ?? 0;
    aggregate.cacheReadTokens += stats.cacheReadTokens ?? 0;
    aggregate.cacheWriteTokens += stats.cacheWriteTokens ?? 0;
  }
  return { ...aggregate, available };
}

export function readSessionStats(entries: DshHistoryEntry[], projections?: { values: Record<string, unknown> }): SessionStats {
  const values = projections?.values ?? {};
  const official = recordValue(values.sessionStats);
  const usage = recordValue(values.usage ?? values.tokenUsage ?? values.tokens);
  const pressure = recordValue(values.contextPressure);
  const history = historyTokenAggregate(entries);
  const projectionValues = { ...official, ...values, ...(usage ?? {}) };
  const projectionHasTokens = hasNumericTokenUsage(projectionValues);
  const projectedBuckets = usageTokenBuckets(projectionValues);
  const projectionInput = firstNumber(
    usage?.inputTokens, usage?.input_tokens,
    values.inputTokens, values.input_tokens,
    official?.inputTokens, official?.input_tokens,
  );
  const projectionOutput = firstNumber(
    usage?.outputTokens, usage?.output_tokens,
    values.outputTokens, values.output_tokens,
    official?.outputTokens, official?.output_tokens,
  );
  const projectionReasoning = firstNumber(
    projectedBuckets.reasoning, values.reasoningTokens, values.reasoning_tokens,
    official?.reasoningTokens, official?.reasoning_tokens,
  ) ?? 0;
  const projectionUncachedInput = firstNumber(
    projectedBuckets.uncachedInput, values.uncachedInputTokens, values.uncached_input_tokens,
  ) ?? 0;
  const projectionCacheRead = firstNumber(
    projectedBuckets.cacheRead, values.cacheReadTokens, values.cache_read_tokens,
  ) ?? 0;
  const projectionCacheWrite = firstNumber(
    projectedBuckets.cacheWrite, values.cacheWriteTokens, values.cache_write_tokens,
  ) ?? 0;
  const projectionInputTotal = projectionInput ?? projectionUncachedInput + projectionCacheRead + projectionCacheWrite;
  const aggregate = projectionHasTokens
    ? {
        inputTokens: projectionInputTotal,
        outputTokens: projectionOutput ?? 0,
        reasoningTokens: projectionReasoning,
        totalTokens: projectionInputTotal + (projectionOutput ?? 0),
        uncachedInputTokens: projectionUncachedInput,
        cacheReadTokens: projectionCacheRead,
        cacheWriteTokens: projectionCacheWrite,
      }
    : history;
  const explicitContextTokens = numberValue(pressure?.projectedTokens ?? pressure?.pressureTokens)
    ?? numberValue(values.contextTokens ?? values.context_tokens);
  const contextTokens = explicitContextTokens ?? aggregate.totalTokens;
  let contextLimit = numberValue(pressure?.contextWindow)
    ?? numberValue(values.contextLimit ?? values.context_limit) ?? 0;
  let firstTokenMs = numberValue(
    usage?.firstTokenMs ?? usage?.first_token_ms ?? usage?.ttft
      ?? values.firstTokenMs ?? values.first_token_ms ?? values.ttft,
  ) ?? 0;
  for (const { event } of entries) {
    if (event.type === "request/context") {
      const eventContextWindow = numberValue(event.data.contextWindow);
      if (eventContextWindow !== undefined) contextLimit = eventContextWindow;
    }
    const usage = eventUsage(event);
    const eventFirstToken = numberValue(usage?.firstTokenMs ?? usage?.first_token_ms ?? usage?.ttft);
    if (eventFirstToken !== undefined) firstTokenMs = eventFirstToken;
  }
  const cacheDenominator = aggregate.uncachedInputTokens + aggregate.cacheReadTokens + aggregate.cacheWriteTokens;
  const tokenUsageSource = projectionHasTokens ? "projection" : history.available ? "history" : "none";
  return {
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    totalTokens: aggregate.totalTokens,
    reasoningTokens: aggregate.reasoningTokens,
    uncachedInputTokens: aggregate.uncachedInputTokens,
    cacheReadTokens: aggregate.cacheReadTokens,
    cacheWriteTokens: aggregate.cacheWriteTokens,
    contextTokens,
    contextLimit,
    cacheHitRate: cacheDenominator > 0 ? Math.min(100, (aggregate.cacheReadTokens / cacheDenominator) * 100) : 0,
    firstTokenMs,
    tokenUsageSource,
    tokenUsageAvailable: tokenUsageSource !== "none",
    messages: entries.filter(({ event }) => event.type === "user/message" || event.type === "assistant/message").length,
    ...(official ? {
      turns: numberValue(official.turns),
      steps: numberValue(official.steps),
      llmMs: numberValue(official.llmMs),
      toolMs: numberValue(official.toolMs),
      ttftMs: numberValue(official.ttftMs),
      decodeMs: numberValue(official.decodeMs),
    } : {}),
  };
}

export function formatTokens(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

export function contextPercent(stats: SessionStats) {
  if (!stats.contextLimit) return 0;
  return Math.min(100, Math.max(0, (stats.contextTokens / stats.contextLimit) * 100));
}

export function eventToolName(event: DshSessionEvent) {
  const name = event.data?.name;
  return typeof name === "string" ? name : "tool";
}

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function eventToolCallId(event: DshSessionEvent) {
  const data = event.data ?? {};
  const message = recordValue(data.message);
  const source = recordValue(message?.source);
  const content = Array.isArray(message?.content) ? recordValue(message.content[0]) : undefined;
  const callId = event.type === "tool/call"
    ? data.callId
    : source?.callId ?? content?.toolCallId;
  return typeof callId === "string" && callId ? callId : undefined;
}

export function sourceLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = recordValue(value);
  if (!record) return undefined;
  for (const key of ["name", "title", "label", "path", "uri", "file", "document"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim();
  }
  return undefined;
}

export function messageSource(event: DshSessionEvent): unknown {
  const data = event.data ?? {};
  if (data.source !== undefined) return data.source;
  return recordValue(data.message)?.source;
}

export function sourceListLabel(value: unknown, key: string, field: string): string | undefined {
  const record = recordValue(value);
  const values = record?.[key];
  if (!Array.isArray(values)) return undefined;
  const labels = values.map((item) => sourceLabel(recordValue(item)?.[field])).filter((item): item is string => Boolean(item));
  return labels.length > 0 ? [...new Set(labels)].join(", ") : undefined;
}

export function contextProvenance(source: unknown): { role: "inject" | "recall"; label?: string } {
  const record = recordValue(source);
  const kind = sourceLabel(record?.kind);
  if (!kind) return { role: "inject" };
  if (kind === "session-reference") return { role: "recall", label: sourceListLabel(source, "references", "label") ?? kind };
  if (kind === "agent-instructions") return { role: "inject", label: sourceListLabel(source, "changes", "path") ?? kind };
  if (kind === "plugin") return { role: "inject", label: sourceLabel(record?.plugin) ?? kind };
  if (kind === "skill-invocation") return { role: "inject", label: sourceLabel(record?.name) ?? kind };
  return { role: "inject", label: kind };
}

export function contextForm(source: unknown): TranscriptItem["contextForm"] {
  const form = sourceLabel(recordValue(source)?.form);
  return form && ["instructions", "catalog", "snapshot", "notice", "relay", "recall"].includes(form)
    ? form as NonNullable<TranscriptItem["contextForm"]>
    : null;
}

export function contextSummary(source: unknown, form: TranscriptItem["contextForm"]): string | undefined {
  if (form !== "notice") return undefined;
  return sourceLabel(recordValue(source)?.summary);
}

export function isInjectedMessage(event: DshSessionEvent) {
  const source = messageSource(event);
  const kind = sourceLabel(recordValue(source)?.kind);
  // Web UI treats the durable source as the authority: only kind=user is a
  // human-authored prompt; injected context and unknown producer kinds remain context rows.
  return source !== undefined && kind !== "user";
}

export function eventToolText(event: DshSessionEvent) {
  const data = event.data ?? {};
  if (event.type === "tool/call") {
    const args = data.arguments;
    if (typeof args === "string") return args;
    if (args !== undefined) return JSON.stringify(args, null, 2);
  }
  return eventContent(event) || (data.isError ? "工具返回错误" : "工具已完成");
}

export function eventToolResultError(event: DshSessionEvent) {
  if (event.type !== "tool/result") return false;
  const data = event.data ?? {};
  const nested = [recordValue(data.result), recordValue(data.output), recordValue(data.value)].filter((value): value is Record<string, unknown> => Boolean(value));
  const candidates = [data, ...nested];
  return candidates.some((value) => {
    const status = String(value.status ?? value.state ?? "").toLowerCase();
    return value.isError === true
      || value.ok === false
      || value.success === false
      || value.error !== undefined
      || value.exception !== undefined
      || ["error", "failed", "failure", "cancelled", "canceled", "rejected"].includes(status);
  });
}

function diffLineCount(text: string) {
  if (!text) return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n").length : 0;
}

function validDiffs(value: unknown): DiffHunk[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const diffs = value.map((item) => {
    const record = recordValue(item);
    if (!record || typeof record.path !== "string" || typeof record.newText !== "string") return undefined;
    if (record.oldText !== null && typeof record.oldText !== "string") return undefined;
    return { path: record.path, oldText: record.oldText as string | null, newText: record.newText };
  });
  return diffs.length > 0 && diffs.every((diff): diff is DiffHunk => diff !== undefined) ? diffs : undefined;
}

function diffsFromValue(value: unknown): DiffSummary | undefined {
  const diffs = validDiffs(value);
  if (!diffs) return undefined;
  return {
    diffs,
    added: diffs.reduce((total, diff) => total + diffLineCount(diff.newText), 0),
    removed: diffs.reduce((total, diff) => total + (diff.oldText === null ? 0 : diffLineCount(diff.oldText)), 0),
    files: new Set(diffs.map((diff) => diff.path)).size,
  };
}

export function diffSummaryFromHistoryEntry(entry: DshHistoryEntry): DiffSummary | undefined {
  const data = entry.event.data ?? {};
  const view = recordValue(entry.view);
  const result = recordValue(data.result) ?? recordValue(data.output) ?? recordValue(data.value);
  const candidates = [
    view?.diffs,
    view?.changes,
    view?.locations,
    recordValue(view?.view)?.diffs,
    data.diffs,
    data.changes,
    result?.diffs,
    result?.changes,
  ];
  for (const candidate of candidates) {
    const summary = diffsFromValue(candidate);
    if (summary) return summary;
  }
  return undefined;
}
