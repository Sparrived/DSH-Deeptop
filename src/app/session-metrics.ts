/**
 * 会话指标的显示口径。
 *
 * 输入区胶囊弹窗与会话看板共用这里的格式化与行推导，避免两处各写一套
 * 时长/速度格式化（第 4 条把 composer 下方那行密集文本换成两个图标胶囊）。
 * 行只描述「键 + 已格式化数值 + 文案键」，语言由组件用 `t()` 补齐。
 */

import { contextPercent, formatTokens } from "./message-model.ts";
import { formatSessionElapsed } from "./session-events.ts";
import type { SessionStats } from "./model-types";

/** 弹窗里的一行指标。 */
export type SessionMetricRow = {
  key: string;
  labelKey: string;
  value: string;
  /** 明细文案键与插值；与 `detail` 二选一。 */
  detailKey?: string;
  detailParams?: Record<string, unknown>;
  /** 已经拼好的明细（只有数字与分隔符，不含语言片段）。 */
  detail?: string;
  /** 占用百分比；只有上下文行带它，弹窗据此画进度条。 */
  percent?: number;
};

/** 毫秒时长：没有记录时为 `—`，不足 1 秒按整数毫秒显示。 */
export function formatMetricDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return formatSessionElapsed(ms);
}

/** 参与速度换算的 token 数：没有记录时为 `—`。 */
export function formatMetricTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  return formatTokens(value);
}

/** 解码速度：10 tok/s 以下保留一位小数。 */
export function formatTokensPerSecond(value: number): string {
  const speed = Math.max(0, value);
  return speed >= 10 ? String(Math.round(speed)) : (Math.round(speed * 10) / 10).toFixed(1);
}

/** 仪表盘胶囊：会话运行时间与速度。 */
export function timingMetricRows(stats: SessionStats, runningMs: number): SessionMetricRow[] {
  const decodeSpeed = stats.decodeMs && stats.decodeTokens
    ? formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000))
    : "—";
  return [
    { key: "run", labelKey: "composer.stats.runTitle", value: formatSessionElapsed(runningMs) },
    { key: "llm", labelKey: "token.timing.llm", value: formatMetricDuration(stats.llmMs), detailKey: "token.timing.llmDetail" },
    { key: "tool", labelKey: "token.timing.tool", value: formatMetricDuration(stats.toolMs), detailKey: "token.timing.toolDetail" },
    { key: "ttft", labelKey: "token.timing.ttft", value: formatMetricDuration(stats.ttftMs), detailKey: "token.timing.ttftDetail", detailParams: { count: formatTokens(stats.ttftSteps ?? 0) } },
    { key: "decode", labelKey: "token.timing.decode", value: formatMetricDuration(stats.decodeMs), detailKey: "token.timing.decodeDetail", detailParams: { tokens: formatMetricTokens(stats.decodeTokens), speed: decodeSpeed } },
  ];
}

/** 数据库胶囊：上下文占用与 token 用量。 */
export function usageMetricRows(stats: SessionStats): SessionMetricRow[] {
  const percent = contextPercent(stats);
  const context: SessionMetricRow = stats.contextTokensAvailable
    ? stats.contextLimit
      ? { key: "context", labelKey: "token.metric.context", value: `${Math.round(percent)}%`, detail: `${formatTokens(stats.contextTokens)} / ${formatTokens(stats.contextLimit)}`, percent }
      : { key: "context", labelKey: "token.metric.context", value: formatTokens(stats.contextTokens), detailKey: "token.metric.noLimit", percent }
    : { key: "context", labelKey: "token.metric.context", value: "—", detailKey: "token.metric.noContext" };
  return [
    context,
    { key: "input", labelKey: "composer.stats.inputTitle", value: formatTokens(stats.inputTokens) },
    { key: "output", labelKey: "composer.stats.outputTitle", value: formatTokens(stats.outputTokens) },
    { key: "cache", labelKey: "composer.stats.cacheTitle", value: stats.cacheHitRate ? `${stats.cacheHitRate.toFixed(0)}%` : "—" },
    { key: "turns", labelKey: "sessionDashboard.units.turns", value: formatTokens(stats.turns ?? 0), detailKey: "sessionDashboard.overview.stepsDetail", detailParams: { count: formatTokens(stats.steps ?? 0) } },
  ];
}
