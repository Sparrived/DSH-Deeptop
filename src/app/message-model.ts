import type { DshHistoryEntry, DshJob, DshSessionEvent } from "../lib/desktop";
import type { DiffHunk, DiffSummary, SessionStats, TranscriptImage, TranscriptItem } from "./model-types";

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
    else if (value.type === "image" && typeof value.data === "string") {
      images.push({
        mediaType: typeof value.mediaType === "string" ? value.mediaType : "image/png",
        data: value.data,
        name: typeof value.name === "string" ? value.name : undefined,
      });
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
  return image.data.startsWith("data:") ? image.data : `data:${image.mediaType};base64,${image.data}`;
}

export function streamKey(event: DshSessionEvent) {
  const turn = numberValue(event.data?.turn);
  const step = numberValue(event.data?.step);
  return `${turn ?? "?"}/${step ?? "?"}`;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readSessionStats(entries: DshHistoryEntry[], projections?: { values: Record<string, unknown> }): SessionStats {
  const values = projections?.values ?? {};
  const official = recordValue(values.sessionStats);
  const usage = recordValue(values.usage ?? values.tokenUsage ?? values.tokens);
  const pressure = recordValue(values.contextPressure);
  const uncachedInput = numberValue(usage?.uncachedInputTokens);
  const cacheRead = numberValue(usage?.cacheReadTokens ?? usage?.cacheRead ?? usage?.cache_read ?? usage?.cachedInputTokens) ?? 0;
  const cacheWrite = numberValue(usage?.cacheWriteTokens ?? usage?.cacheWrite ?? usage?.cache_write) ?? 0;
  const projectedInput = numberValue(usage?.inputTokens ?? usage?.input_tokens);
  const billedInput = projectedInput ?? (uncachedInput === undefined ? undefined : uncachedInput + cacheRead + cacheWrite);
  let inputTokens = billedInput ?? numberValue(values.inputTokens ?? values.input_tokens) ?? 0;
  let outputTokens = numberValue(usage?.outputTokens ?? usage?.output_tokens ?? values.outputTokens ?? values.output_tokens) ?? 0;
  const totalTokens = numberValue(usage?.totalTokens ?? usage?.total_tokens ?? values.totalTokens ?? values.total_tokens) ?? inputTokens + outputTokens;
  let contextTokens = numberValue(pressure?.projectedTokens ?? pressure?.pressureTokens) ?? numberValue(values.contextTokens ?? values.context_tokens) ?? totalTokens;
  let contextLimit = numberValue(pressure?.contextWindow) ?? numberValue(values.contextLimit ?? values.context_limit) ?? 0;
  let firstTokenMs = numberValue(usage?.firstTokenMs ?? usage?.first_token_ms ?? usage?.ttft ?? values.firstTokenMs ?? values.first_token_ms ?? values.ttft) ?? 0;
  for (const { event } of entries) {
    if (event.type === "request/context") {
      const eventContextWindow = numberValue(event.data.contextWindow);
      if (eventContextWindow !== undefined) contextLimit = eventContextWindow;
    }
    const chunk = recordValue(event.data.chunk);
    const eventUsage = recordValue(event.data.usage ?? event.data.tokenUsage ?? chunk?.usage);
    if (eventUsage) {
      const eventUncachedInput = numberValue(eventUsage.uncachedInputTokens);
      const eventCacheRead = numberValue(eventUsage.cacheReadTokens ?? eventUsage.cacheRead ?? eventUsage.cache_read) ?? 0;
      const eventCacheWrite = numberValue(eventUsage.cacheWriteTokens ?? eventUsage.cacheWrite ?? eventUsage.cache_write) ?? 0;
      const eventInput = numberValue(eventUsage.inputTokens ?? eventUsage.input_tokens) ?? (eventUncachedInput === undefined ? undefined : eventUncachedInput + eventCacheRead + eventCacheWrite);
      const eventOutput = numberValue(eventUsage.outputTokens ?? eventUsage.output_tokens);
      const eventFirstToken = numberValue(eventUsage.firstTokenMs ?? eventUsage.first_token_ms ?? eventUsage.ttft);
      if (eventFirstToken !== undefined) firstTokenMs = eventFirstToken;
      if (eventInput !== undefined) inputTokens = Math.max(inputTokens, eventInput);
      if (eventOutput !== undefined) outputTokens = Math.max(outputTokens, eventOutput);
    }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
    contextTokens,
    contextLimit,
    cacheHitRate: cacheRead + cacheWrite > 0 ? Math.min(100, (cacheRead / (cacheRead + cacheWrite + (uncachedInput ?? 0))) * 100) : 0,
    firstTokenMs,
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
