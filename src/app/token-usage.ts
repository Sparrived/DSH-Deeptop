import type { DshHistoryEntry } from "../lib/desktop";
import type { MessageStats, SessionStats, TokenUsageBreakdown, TokenUsageDashboardData, TokenUsagePoint } from "./model-types";
import { assistantMessageStats, numberValue, recordValue } from "./message-model.ts";

const emptyBreakdown = (): TokenUsageBreakdown => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheHitRate: 0,
});

function coordinates(entry: DshHistoryEntry) {
  const data = entry.event.data;
  const message = recordValue(data.message);
  return {
    turn: numberValue(data.turn) ?? numberValue(message?.turn),
    step: numberValue(data.step) ?? numberValue(message?.step),
  };
}

function pointBreakdown(stats: MessageStats): TokenUsageBreakdown {
  return {
    inputTokens: stats.inputTokens ?? 0,
    outputTokens: stats.outputTokens ?? 0,
    reasoningTokens: stats.reasoningTokens ?? 0,
    totalTokens: (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0),
    uncachedInputTokens: stats.uncachedInputTokens ?? 0,
    cacheReadTokens: stats.cacheReadTokens ?? 0,
    cacheWriteTokens: stats.cacheWriteTokens ?? 0,
    cacheHitRate: stats.cacheHitRate ?? 0,
  };
}

function pointsBreakdown(points: TokenUsagePoint[]): TokenUsageBreakdown {
  const fromPoints = points.reduce((total, point) => ({
    inputTokens: total.inputTokens + point.inputTokens,
    outputTokens: total.outputTokens + point.outputTokens,
    reasoningTokens: total.reasoningTokens + point.reasoningTokens,
    totalTokens: total.totalTokens + point.totalTokens,
    uncachedInputTokens: total.uncachedInputTokens + point.uncachedInputTokens,
    cacheReadTokens: total.cacheReadTokens + point.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + point.cacheWriteTokens,
    cacheHitRate: 0,
  }), emptyBreakdown());
  const denominator = fromPoints.uncachedInputTokens + fromPoints.cacheReadTokens + fromPoints.cacheWriteTokens;
  return {
    ...fromPoints,
    totalTokens: fromPoints.inputTokens + fromPoints.outputTokens,
    cacheHitRate: denominator > 0 ? Math.min(100, (fromPoints.cacheReadTokens / denominator) * 100) : 0,
  };
}

function sessionBreakdown(stats: SessionStats, points: TokenUsagePoint[]): TokenUsageBreakdown {
  // A projection/history aggregate is authoritative as a whole. Mixing its
  // individual fields with point sums makes the ledger internally inconsistent.
  if (stats.tokenUsageAvailable || (stats.tokenUsageSource !== undefined && stats.tokenUsageSource !== "none")) {
    const denominator = stats.uncachedInputTokens + stats.cacheReadTokens + stats.cacheWriteTokens;
    return {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      reasoningTokens: stats.reasoningTokens,
      totalTokens: stats.inputTokens + stats.outputTokens,
      uncachedInputTokens: stats.uncachedInputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      cacheWriteTokens: stats.cacheWriteTokens,
      cacheHitRate: denominator > 0 ? Math.min(100, (stats.cacheReadTokens / denominator) * 100) : 0,
    };
  }
  return pointsBreakdown(points);
}

/** Aggregate a sub-range of response points into one session-style breakdown. */
export function tokenUsageTotals(points: TokenUsagePoint[]): TokenUsageBreakdown {
  return pointsBreakdown(points);
}

export function tokenUsageDashboard(entries: DshHistoryEntry[], stats: SessionStats): TokenUsageDashboardData {
  const ordered = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  const messageStats = assistantMessageStats(ordered);
  const points: TokenUsagePoint[] = [];
  let responseIndex = 0;
  for (const entry of ordered) {
    if (entry.event.type !== "assistant/message") continue;
    const perMessage = messageStats.get(entry.event.seq);
    const breakdown = pointBreakdown(perMessage ?? {});
    if (breakdown.totalTokens === 0 && breakdown.inputTokens === 0 && breakdown.outputTokens === 0 && breakdown.reasoningTokens === 0) continue;
    responseIndex += 1;
    const { turn, step } = coordinates(entry);
    points.push({
      ...breakdown,
      key: String(entry.event.seq),
      label: turn !== undefined && step !== undefined ? "T" + turn + " · S" + step : "回应 " + responseIndex,
      time: entry.event.time,
      turn,
      step,
      runMs: perMessage?.runMs,
      ttftMs: perMessage?.ttftMs,
    });
  }
  return {
    totals: sessionBreakdown(stats, points),
    points,
    hasHistoryUsage: points.length > 0,
  };
}

export function tokenUsagePercent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
}
