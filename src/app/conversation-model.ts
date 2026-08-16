import type { DshHistoryEntry } from "../lib/desktop";
import {
  assistantContent,
  assistantMessageStats,
  contentSegments,
  contextForm,
  contextProvenance,
  contextSummary,
  diffSummaryFromHistoryEntry,
  eventToolCallId,
  eventToolName,
  eventToolResultError,
  eventToolText,
  isInjectedMessage,
  messageSource,
  recordValue,
  streamKey,
} from "./message-model.ts";
import { deliverablesFromHistory, workflowViewsFromHistory } from "./workflow-model.ts";
import { turnTimingItems } from "./session-events.ts";
import type { TranscriptItem } from "./model-types";

function turnEndText(reason: unknown, kind: string) {
  if (kind !== "error") return kind;
  const detail = recordValue(reason);
  const error = detail?.error;
  const failure = recordValue(error);
  if (typeof failure?.message === "string" && failure.message.trim()) return failure.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof detail?.message === "string" && detail.message.trim()) return detail.message;
  return "回合执行失败";
}

export function transcriptFromHistory(entries: DshHistoryEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const streams = new Map<string, { text: string; reasoning: string; seq: number; time: number }>();
  const orderedEntries = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  const messageStats = assistantMessageStats(orderedEntries);
  for (const entry of orderedEntries) {
    const event = entry.event;
    if ((event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result")
      && event.surfaceOp !== undefined && event.surfaceOp !== "append") continue;
    if (event.type === "assistant/chunk") {
      const chunk = recordValue(event.data.chunk);
      const type = typeof chunk?.type === "string" ? chunk.type : "";
      if ((type === "text-delta" || type === "reasoning-delta") && typeof chunk?.text === "string") {
        const key = streamKey(event);
        const current = streams.get(key) ?? { text: "", reasoning: "", seq: event.seq, time: event.time };
        if (type === "text-delta") current.text += chunk.text;
        else current.reasoning += chunk.text;
        current.time = event.time;
        streams.set(key, current);
      }
      continue;
    }
    if (event.type === "user/message") {
      const segments = contentSegments(event.data.content);
      const text = segments.text;
      const messageId = typeof event.data.id === "string" ? event.data.id : undefined;
      if (text || segments.images.length > 0) {
        const injected = isInjectedMessage(event);
        const source = injected ? messageSource(event) : undefined;
        const provenance = injected ? contextProvenance(source) : undefined;
        const form = injected ? contextForm(source) : undefined;
        items.push({
          key: `event-${event.seq}`,
          kind: injected ? "system" : "user",
          label: injected ? (provenance?.role === "recall" ? "跨会话召回" : "上下文注入") : "你",
          text,
          images: segments.images,
          content: event.data.content,
          seq: event.seq,
          messageId,
          time: event.time,
          source: provenance?.label,
          contextRole: provenance?.role,
          contextForm: form,
          contextSummary: contextSummary(source, form),
          injected,
        });
      }
      continue;
    }
    if (event.type === "assistant/message") {
      const stream = streams.get(streamKey(event));
      const message = recordValue(event.data.message);
      const messageId = typeof message?.id === "string" ? message.id : undefined;
      const segments = contentSegments(assistantContent(event));
      const reasoning = segments.reasoning || stream?.reasoning || "";
      const text = segments.text || stream?.text || "";
      if (reasoning) items.push({ key: `reasoning-${event.seq}`, kind: "reasoning", label: "Think", text: reasoning, seq: stream?.seq ?? event.seq, time: event.time });
      if (text || segments.images.length > 0) items.push({ key: `event-${event.seq}`, kind: "assistant", label: "DSH", text, images: segments.images, seq: event.seq, messageId, time: event.time, stats: messageStats.get(event.seq) });
      streams.delete(streamKey(event));
      continue;
    }
    if (event.type === "tool/call" || event.type === "tool/result") {
      const diff = diffSummaryFromHistoryEntry(entry);
      items.push({
        key: `event-${event.seq}`,
        kind: "tool",
        label: eventToolName(event),
        text: eventToolText(event),
        seq: event.seq,
        time: event.time,
        toolName: eventToolName(event),
        toolCallId: eventToolCallId(event),
        toolState: event.type === "tool/call" ? "call" : "result",
        toolResultError: eventToolResultError(event),
        ...(event.type === "tool/call" ? { toolDiff: diff } : { toolResultDiff: diff }),
      });
      continue;
    }
    if (event.type === "turn/end") {
      const reason = event.data?.reason;
      const reasonKind = reason && typeof reason === "object"
        ? (reason as Record<string, unknown>).kind
        : undefined;
      if (reasonKind && reasonKind !== "completed") {
        items.push({ key: `event-${event.seq}`, kind: "system", label: "回合结束", text: turnEndText(reason, String(reasonKind)), seq: event.seq, time: event.time });
      }
      continue;
    }
    if (event.type === "compaction/summary") {
      items.push({ key: `event-${event.seq}`, kind: "system", label: "上下文", text: "已整理对话上下文", seq: event.seq, time: event.time });
    }
  }
  for (const [key, stream] of streams) {
    if (stream.reasoning) items.push({ key: `reasoning-${key}`, kind: "reasoning", label: "Think", text: stream.reasoning, seq: stream.seq, time: stream.time, streaming: true });
    if (stream.text) items.push({ key: `stream-${key}`, kind: "assistant", label: "DSH", text: stream.text, seq: stream.seq, time: stream.time });
  }
  for (const workflow of workflowViewsFromHistory(orderedEntries)) {
    items.push({ key: `workflow-${workflow.seq}`, kind: "workflow", label: "Workflow", text: workflow.view.name, seq: workflow.seq, time: workflow.time, workflow: workflow.view });
  }
  for (const deliverable of deliverablesFromHistory(orderedEntries)) {
    items.push({ key: `deliverables-${deliverable.seq}`, kind: "deliverables", label: "生成文件", text: deliverable.paths.join("\n"), seq: deliverable.seq + 0.1, time: deliverable.time, files: deliverable.paths, fileDiffs: deliverable.fileDiffs });
  }
  // 轮次时间在轮次结束后直接展示在会话里；final sort 会按 seq 放到本轮内容之后。
  for (const timing of turnTimingItems(orderedEntries)) items.push(timing);
  items.sort((left, right) => (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER));
  // Pair by the runtime call id; completion order is not guaranteed for parallel tools.
  const paired: TranscriptItem[] = [];
  const pendingCalls = new Map<string, number>();
  const pendingCallsWithoutId: number[] = [];
  const pendingResults = new Map<string, TranscriptItem>();
  const pendingResultsWithoutId: TranscriptItem[] = [];
  for (const item of items) {
    if (item.kind !== "tool") {
      paired.push(item);
      continue;
    }
    if (item.toolState === "call") {
      const result = item.toolCallId
        ? pendingResults.get(item.toolCallId)
        : pendingResultsWithoutId.shift();
      if (result) {
        if (item.toolCallId) pendingResults.delete(item.toolCallId);
        paired.push({ ...item, toolResultText: result.text, toolResultTime: result.time, toolResultError: result.toolResultError, toolResultDiff: result.toolResultDiff });
      } else {
        if (item.toolCallId) pendingCalls.set(item.toolCallId, paired.length);
        else pendingCallsWithoutId.push(paired.length);
        paired.push(item);
      }
      continue;
    }
    const callIndex = item.toolCallId
      ? pendingCalls.get(item.toolCallId)
      : pendingCallsWithoutId.shift();
    if (callIndex !== undefined) {
      if (item.toolCallId) pendingCalls.delete(item.toolCallId);
      const call = paired[callIndex];
      paired[callIndex] = { ...call, toolResultText: item.text, toolResultTime: item.time, toolResultError: item.toolResultError, toolResultDiff: item.toolResultDiff };
    } else if (item.toolCallId) {
      pendingResults.set(item.toolCallId, item);
    } else {
      pendingResultsWithoutId.push(item);
    }
  }
  return paired;
}
