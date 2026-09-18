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
  eventToolImages,
  eventToolName,
  eventToolResultError,
  eventToolText,
  isInjectedMessage,
  messageSource,
  numberValue,
  recordValue,
  streamKey,
} from "./message-model.ts";
import { deliverablesFromHistory, workflowViewsFromHistory } from "./workflow-model.ts";
import { buildPtcProgramView, readPtcDispatch, type PtcDispatch } from "./ptc-program.ts";
import { isTransientStreamSeq } from "./display-history.ts";
import { turnTimingItems } from "./session-events.ts";
import { toolDomainCard } from "./tool-domain.ts";
import type { TranscriptItem } from "./model-types";
import { t, type UiLocale } from "./i18n.ts";

function turnEndText(reason: unknown, kind: string, locale: UiLocale = "zh") {
  if (kind !== "error") return kind;
  const detail = recordValue(reason);
  const error = detail?.error;
  const failure = recordValue(error);
  if (typeof failure?.message === "string" && failure.message.trim()) return failure.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof detail?.message === "string" && detail.message.trim()) return detail.message;
  return t("conversation.turnFailed", locale);
}

/**
 * Earliest durable seq among candidates.
 *
 * In-progress output lives in the mux's negative stream band, and a step that
 * absorbed live chunks keeps that negative seq as its `displayFirstChunkSeq`.
 * Anchoring a durable row there would push it into the live band at the very end
 * of the conversation, piling finished Think rows under the newest message
 * instead of leaving each one at its own step.
 */
function durableSeq(...candidates: Array<number | undefined>): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && !isTransientStreamSeq(candidate)) return candidate;
  }
  return undefined;
}

/** Earliest durable seq one history entry renders as a transcript row. */
function entryStartOf(entry: DshHistoryEntry): number | undefined {
  const ranges = entry.compactedEventSeqRanges ?? entry.event?.compactedEventSeqRanges;
  if (Array.isArray(ranges)) {
    for (const range of ranges) {
      const start = durableSeq(Array.isArray(range) ? range[0] : undefined);
      if (start !== undefined) return start;
    }
  }
  return durableSeq(entry.displayFirstChunkSeq, entry.event?.seq);
}

/**
 * Durable rows keep their log seq order. In-progress stream rows carry the
 * bridge's transient (negative) seq band because they have no durable seq yet:
 * they are always newer than every durable row, so they render at the end of
 * the conversation instead of jumping above history.
 */
function transcriptOrder(left: TranscriptItem, right: TranscriptItem): number {
  const leftLive = isTransientStreamSeq(left.seq);
  const rightLive = isTransientStreamSeq(right.seq);
  if (leftLive !== rightLive) return leftLive ? 1 : -1;
  return (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER);
}

/**
 * 把 PTC 子调用挂到已配对的 `run_code` 行上。
 *
 * 必须在配对之后做：只有配对后的行才同时握着参数（程序源码）与结果状态，而
 * 「程序捕获了内部失败」正需要这两者。挂不上的行原样返回，非 PTC 会话不受影响。
 */
function attachPtcPrograms(
  items: TranscriptItem[],
  dispatches: Map<string, PtcDispatch[]>,
  locale: UiLocale,
): TranscriptItem[] {
  if (dispatches.size === 0) return items;
  return items.map((item) => {
    if (item.kind !== "tool" || !item.toolCallId) return item;
    const calls = dispatches.get(item.toolCallId);
    if (calls === undefined) return item;
    const program = buildPtcProgramView(item.text, calls, locale, Boolean(item.toolResultError));
    return program === undefined ? item : { ...item, program };
  });
}

export function transcriptFromHistory(entries: DshHistoryEntry[], locale: UiLocale = "zh"): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  // `thinking` tracks whether the newest delta of a live stream was reasoning:
  // thinking ends the moment the step moves on to answer text or tool arguments,
  // so the Think box folds there instead of waiting for the whole step to end.
  const streams = new Map<string, { text: string; reasoning: string; seq: number; time: number; streaming: boolean; thinking: boolean }>();
  // PTC 的内部派发不单独成行：它们折进所属 `run_code` 行的「程序 / 执行」视图。
  const ptcDispatches = new Map<string, PtcDispatch[]>();
  const orderedEntries = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  const messageStats = assistantMessageStats(orderedEntries);
  for (const entry of orderedEntries) {
    const event = entry.event;
    if ((event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result")
      && event.surfaceOp !== undefined && event.surfaceOp !== "append") continue;
    if (event.type === "assistant/chunk") {
      const chunk = recordValue(event.data.chunk);
      const type = typeof chunk?.type === "string" ? chunk.type : "";
      const key = streamKey(event);
      const current = streams.get(key);
      if ((type === "text-delta" || type === "reasoning-delta") && typeof chunk?.text === "string") {
        const stream = current ?? { text: "", reasoning: "", seq: event.seq, time: event.time, streaming: true, thinking: false };
        if (type === "text-delta") {
          stream.text += chunk.text;
          stream.thinking = false;
        } else {
          stream.reasoning += chunk.text;
          stream.thinking = true;
        }
        stream.time = event.time;
        streams.set(key, stream);
      } else if (current && type === "tool-call-delta") {
        // Tool arguments follow the thinking of the same step.
        current.thinking = false;
      }
      continue;
    }
    if (event.type === "llm/retry-started") {
      streams.delete(streamKey(event));
      continue;
    }
    if (event.type === "step/end") {
      const stream = streams.get(streamKey(event));
      if (stream) stream.streaming = false;
      continue;
    }
    if (event.type === "user/message") {
      const segments = contentSegments(event.data.content);
      const text = segments.text;
      const messageId = typeof event.data.id === "string" ? event.data.id : undefined;
      if (text || segments.images.length > 0 || segments.files.length > 0) {
        const injected = isInjectedMessage(event);
        const source = injected ? messageSource(event) : undefined;
        const provenance = injected ? contextProvenance(source, locale) : undefined;
        const form = injected ? contextForm(source) : undefined;
        let label: string;
        if (!injected) {
          label = t("conversation.you", locale);
        } else if (provenance?.role === "recall") {
          label = t("conversation.recall", locale);
        } else {
          label = t("conversation.inject", locale);
        }
        items.push({
          key: `event-${event.seq}`,
          kind: injected ? "system" : "user",
          label,
          text,
          images: segments.images,
          fileAttachments: segments.files,
          content: event.data.content,
          seq: event.seq,
          seqFrom: entryStartOf(entry),
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
      // Keep the Think row at its first durable chunk position (the live band is
      // not a position), falling back to the message's own durable seq.
      const reasoningSeq = durableSeq(stream?.seq, entry.displayFirstChunkSeq, event.seq) ?? event.seq;
      const reasoningFrom = entryStartOf(entry);
      if (reasoning) items.push({ key: `reasoning-${event.seq}`, kind: "reasoning", label: "Think", text: reasoning, seq: reasoningSeq, seqFrom: reasoningFrom === undefined ? undefined : Math.min(reasoningFrom, reasoningSeq), time: event.time });
      if (text || segments.images.length > 0) items.push({ key: `event-${event.seq}`, kind: "assistant", label: "DSH", text, images: segments.images, seq: event.seq, seqFrom: entryStartOf(entry), messageId, time: event.time, stats: messageStats.get(event.seq) });
      streams.delete(streamKey(event));
      continue;
    }
    if (event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch") {
      const dispatch = readPtcDispatch(event, locale);
      if (dispatch) {
        const bucket = ptcDispatches.get(dispatch.rootCallId);
        if (bucket === undefined) ptcDispatches.set(dispatch.rootCallId, [dispatch]);
        else bucket.push(dispatch);
      }
      continue;
    }
    if (event.type === "tool/call" || event.type === "tool/result") {
      const diff = diffSummaryFromHistoryEntry(entry);
      const domainCard = toolDomainCard(entry);
      // 结果里的图片块只存在于内容里（信封文本装不下它），所以在这里取出来交给
      // 结果区按附件渲染；临时源文件被删掉后仍能从会话附件存储里显示。
      const images = eventToolImages(event);
      items.push({
        key: `event-${event.seq}`,
        kind: "tool",
        label: eventToolName(event),
        text: eventToolText(event, locale),
        seq: event.seq,
        seqFrom: entryStartOf(entry),
        time: event.time,
        toolName: eventToolName(event),
        toolCallId: eventToolCallId(event),
        toolState: event.type === "tool/call" ? "call" : "result",
        toolResultError: eventToolResultError(event),
        ...(images.length > 0 ? { images } : {}),
        ...(domainCard ? { domainCard } : {}),
        ...(event.type === "tool/call" ? { toolDiff: diff } : { toolResultDiff: diff }),
      });
      continue;
    }
    if (event.type === "turn/end") {
      const turn = numberValue(event.data.turn);
      if (turn !== undefined) {
        for (const [key, stream] of streams) {
          if (key.startsWith(`${turn}/`)) stream.streaming = false;
        }
      }
      const reason = event.data?.reason;
      const reasonKind = reason && typeof reason === "object"
        ? (reason as Record<string, unknown>).kind
        : undefined;
      if (reasonKind && reasonKind !== "completed") {
        items.push({ key: `event-${event.seq}`, kind: "system", label: t("conversation.turnEnd", locale), text: turnEndText(reason, String(reasonKind), locale), seq: event.seq, time: event.time });
      }
      continue;
    }
    if (event.type === "compaction/summary") {
      items.push({ key: `event-${event.seq}`, kind: "system", label: t("conversation.context", locale), text: t("conversation.compactionSummary", locale), seq: event.seq, time: event.time });
    }
  }
  for (const [key, stream] of streams) {
    // A live Think row is streaming only while reasoning is what arrives last.
    if (stream.reasoning) items.push({ key: `reasoning-${key}-${stream.seq}`, kind: "reasoning", label: "Think", text: stream.reasoning, seq: stream.seq, time: stream.time, streaming: stream.streaming && stream.thinking });
    if (stream.text) items.push({ key: `stream-${key}-${stream.seq}`, kind: "assistant", label: "DSH", text: stream.text, seq: stream.seq, time: stream.time, streaming: stream.streaming });
  }
  for (const workflow of workflowViewsFromHistory(orderedEntries, locale)) {
    items.push({ key: `workflow-${workflow.seq}`, kind: "workflow", label: "Workflow", text: workflow.view.name, seq: workflow.seq, time: workflow.time, workflow: workflow.view });
  }
  for (const deliverable of deliverablesFromHistory(orderedEntries)) {
    items.push({ key: `deliverables-${deliverable.seq}`, kind: "deliverables", label: t("conversation.generatedFiles", locale), text: deliverable.paths.join("\n"), seq: deliverable.seq + 0.1, time: deliverable.time, files: deliverable.paths, fileDiffs: deliverable.fileDiffs });
  }
  // 轮次时间在轮次结束后直接展示在会话里；final sort 会按 seq 放到本轮内容之后。
  for (const timing of turnTimingItems(orderedEntries, locale)) items.push(timing);
  items.sort(transcriptOrder);
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
        paired.push({ ...item, toolResultText: result.text, toolResultTime: result.time, toolResultError: result.toolResultError, toolResultDiff: result.toolResultDiff, ...(result.images?.length ? { images: result.images } : {}), ...(result.domainCard ? { domainCard: result.domainCard } : {}) });
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
      paired[callIndex] = { ...call, toolResultText: item.text, toolResultTime: item.time, toolResultError: item.toolResultError, toolResultDiff: item.toolResultDiff, ...(item.images?.length ? { images: item.images } : {}), ...(item.domainCard ? { domainCard: item.domainCard } : {}) };
    } else if (item.toolCallId) {
      pendingResults.set(item.toolCallId, item);
    } else {
      pendingResultsWithoutId.push(item);
    }
  }
  return attachPtcPrograms(paired, ptcDispatches, locale);
}
