import { useMemo, useState, type CSSProperties } from "react";
import type { SessionStats, TokenUsageDashboardData, TokenUsagePoint } from "../app/model-types";
import { formatTokens } from "../app/model";
import { tokenUsageDashboard, tokenUsagePercent, tokenUsageTotals } from "../app/token-usage";
import { estimateTokenCost, formatUsd, modelPricing, modelPricingSnapshot } from "../app/model-pricing";
import type { DshHistoryEntry } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

type TokenUsageDashboardProps = {
  entries: DshHistoryEntry[];
  sessionStats: SessionStats;
  active: boolean;
  provider?: string;
  model?: string;
  locale?: UiLocale;
  onOpenPricingSource?: () => void | Promise<void>;
};

const COLORS = {
  input: "#5c6bc0",
  output: "#ef8354",
  reasoning: "#c084fc",
  uncached: "#8090a8",
  cacheRead: "#4aa98f",
  cacheWrite: "#e0a458",
};

function Metric({ label, value, tone, detail }: { label: string; value: string; tone?: string; detail?: string }) {
  return <div className="token-metric-card">
    <span className="token-metric-label"><i style={{ background: tone }} />{label}</span>
    <strong>{value}</strong>
    {detail && <small>{detail}</small>}
  </div>;
}

function Donut({ data, locale }: { data: TokenUsageDashboardData; locale: UiLocale }) {
  // Reasoning is a provider-reported breakdown of output, so keep it out of
  // the additive ring to avoid counting the same tokens twice.
  const total = Math.max(1, data.totals.inputTokens + data.totals.outputTokens);
  const input = tokenUsagePercent(data.totals.inputTokens, total);
  const output = 100 - input;
  const label = t("token.donutAria", locale, {
    input: formatTokens(data.totals.inputTokens),
    output: formatTokens(data.totals.outputTokens),
    reasoning: formatTokens(data.totals.reasoningTokens),
  });
  return <div className="token-donut-wrap" role="img" aria-label={label}>
    <div className="token-donut" style={{ background: "conic-gradient(" + COLORS.input + " 0 " + input + "%, " + COLORS.output + " " + input + "% " + (input + output) + "%)" }}>
      <div><strong>{formatTokens(data.totals.totalTokens)}</strong><span>{t("token.totalTokens", locale)}</span></div>
    </div>
    <div className="token-legend">
      <span><i style={{ background: COLORS.input }} />{t("token.inputTokens", locale, { tokens: formatTokens(data.totals.inputTokens) })}</span>
      <span><i style={{ background: COLORS.output }} />{t("token.outputTokens", locale, { tokens: formatTokens(data.totals.outputTokens) })}</span>
      <span><i style={{ background: COLORS.reasoning }} />{t("token.reasoningTokens", locale, { tokens: formatTokens(data.totals.reasoningTokens) })}</span>
    </div>
  </div>;
}

function UsageBars({ point, max, locale }: { point: TokenUsagePoint; max: number; locale: UiLocale }) {
  const total = Math.max(1, point.inputTokens + point.outputTokens);
  const inputPercent = tokenUsagePercent(point.inputTokens, total);
  const outputPercent = tokenUsagePercent(point.outputTokens, total);
  const totalWidth = tokenUsagePercent(point.totalTokens, max);
  const label = t("token.barsAria", locale, {
    label: point.label,
    total: point.totalTokens.toLocaleString(),
    input: point.inputTokens.toLocaleString(),
    output: point.outputTokens.toLocaleString(),
    reasoning: point.reasoningTokens.toLocaleString(),
  });
  return <div className="token-usage-row" aria-label={label}>
    <div className="token-point-label"><b>{point.label}</b><span>{point.runMs ? Math.round(point.runMs / 1000) + "s" : ""}</span></div>
    <div className="token-bars">
      <div className="token-composition-track" role="img" aria-label={label} style={{ width: totalWidth + "%" }}><i className="token-composition-input" style={{ width: inputPercent + "%", background: COLORS.input }} /><i className="token-composition-output" style={{ width: outputPercent + "%", background: COLORS.output }} /></div>
      <div className="token-bar-values"><span><i style={{ background: COLORS.input }} />{t("token.inputTokens", locale, { tokens: formatTokens(point.inputTokens) })}</span><span><i style={{ background: COLORS.output }} />{t("token.outputTokens", locale, { tokens: formatTokens(point.outputTokens) })}</span><span><i style={{ background: COLORS.reasoning }} />{t("token.reasoningTokens", locale, { tokens: formatTokens(point.reasoningTokens) })}</span></div>
    </div>
    <strong>{formatTokens(point.totalTokens)}</strong>
  </div>;
}

function EmptyChart({ locale }: { locale: UiLocale }) {
  return <div className="token-empty-chart"><span className="token-empty-grid" /><strong>{t("token.emptyTitle", locale)}</strong><p>{t("token.emptyHint", locale)}</p></div>;
}

/** 官方 sessionStats 墙钟字段的展示助手：缺失或 0 显示 —。 */
function durationValue(ms: number | undefined) {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${seconds >= 60 ? Math.round(seconds / 60) + "m " + String(Math.round(seconds % 60)).padStart(2, "0") + "s" : seconds < 10 ? (Math.round(seconds * 10) / 10).toFixed(1) + "s" : Math.round(seconds) + "s"}`;
}

function formatDecodeTokens(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  return formatTokens(value);
}

function formatTokensPerSecond(value: number) {
  const speed = Math.max(0, value);
  return speed >= 10 ? String(Math.round(speed)) : (Math.round(speed * 10) / 10).toFixed(1);
}

function TimingPanel({ sessionStats, locale }: { sessionStats: SessionStats; locale: UiLocale }) {
  const totals = [
    { label: t("token.timing.llm", locale), value: durationValue(sessionStats.llmMs), detail: t("token.timing.llmDetail", locale) },
    { label: t("token.timing.tool", locale), value: durationValue(sessionStats.toolMs), detail: t("token.timing.toolDetail", locale) },
    { label: t("token.timing.ttft", locale), value: durationValue(sessionStats.ttftMs), detail: t("token.timing.ttftDetail", locale, { count: formatTokens(sessionStats.ttftSteps ?? 0) }) },
    { label: t("token.timing.decode", locale), value: durationValue(sessionStats.decodeMs), detail: t("token.timing.decodeDetail", locale, { tokens: formatDecodeTokens(sessionStats.decodeTokens), speed: sessionStats.decodeMs && sessionStats.decodeTokens ? formatTokensPerSecond(sessionStats.decodeTokens / (sessionStats.decodeMs / 1000)) : "—" }) },
  ];
  const hasAny = [sessionStats.llmMs, sessionStats.toolMs, sessionStats.ttftMs, sessionStats.decodeMs].some((value) => value !== undefined);
  if (!hasAny) return null;
  return <div className="token-panel token-timing-panel">
    <div className="token-panel-heading"><div><span>OFFICIAL TIMING</span><h3>{t("token.timing.title", locale)}</h3></div><b>{t("token.timing.turnsSteps", locale, { turns: formatTokens(sessionStats.turns ?? 0), steps: formatTokens(sessionStats.steps ?? 0) })}</b></div>
    <div className="token-timing-grid">{totals.map((item) => <div className="token-timing-cell" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>)}</div>
  </div>;
}

export function TokenUsageDashboard({ entries, sessionStats, active, provider, model, locale = "zh", onOpenPricingSource }: TokenUsageDashboardProps) {
  const [range, setRange] = useState<"all" | "recent">("all");
  const data = useMemo(() => tokenUsageDashboard(entries, sessionStats, locale), [entries, sessionStats, locale]);
  const visibleData = useMemo(() => {
    if (range !== "recent") return data;
    const recentPoints = data.points.slice(-8);
    return { ...data, points: recentPoints, totals: tokenUsageTotals(recentPoints) };
  }, [data, range]);
  const points = visibleData.points;
  const max = Math.max(1, ...points.map((point) => point.totalTokens));
  const totals = visibleData.totals;
  const pricing = useMemo(() => modelPricing(provider, model), [model, provider]);
  const estimatedCost = useMemo(() => estimateTokenCost(totals, pricing), [pricing, totals]);
  const contextPercent = sessionStats.contextLimit > 0 ? Math.min(100, (sessionStats.contextTokens / sessionStats.contextLimit) * 100) : 0;
  if (!active) return null;
  return <section className="token-dashboard" aria-label={t("token.dashboardAria", locale)}>
    <div className="token-dashboard-head">
      <div><span className="token-kicker">SESSION TELEMETRY</span><h2>{t("token.title", locale)}</h2><p>{t("token.subtitle", locale)}</p></div>
      <div className="token-head-actions"><span className="token-live-dot">{data.hasHistoryUsage || sessionStats.tokenUsageAvailable ? t("token.live", locale) : t("token.waiting", locale)}</span><button type="button" className={range === "all" ? "selected" : ""} onClick={() => setRange("all")}>{t("token.rangeAll", locale)}</button><button type="button" className={range === "recent" ? "selected" : ""} onClick={() => setRange("recent")}>{t("token.rangeRecent", locale)}</button></div>
    </div>

    <div className="token-metric-grid">
      <Metric label={t("token.metric.total", locale)} value={formatTokens(totals.totalTokens)} tone="var(--accent)" detail={(sessionStats.tokenUsageAvailable ? t("token.metric.totalDetailRecords", locale, { count: sessionStats.messages }) : t("token.metric.totalDetailEstimated", locale, { count: sessionStats.messages }))} />
      <Metric label={t("token.metric.context", locale)} value={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? Math.round(contextPercent) + "%" : formatTokens(sessionStats.contextTokens)) : "—"} tone="#4aa98f" detail={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? formatTokens(sessionStats.contextTokens) + " / " + formatTokens(sessionStats.contextLimit) : t("token.metric.noLimit", locale)) : t("token.metric.noContext", locale)} />
      <Metric label={t("token.metric.cache", locale)} value={Math.round(totals.cacheHitRate) + "%"} tone={COLORS.cacheRead} detail={formatTokens(totals.cacheReadTokens) + " read · " + formatTokens(totals.cacheWriteTokens) + " write"} />
    </div>

    <TimingPanel sessionStats={sessionStats} locale={locale} />

    <div className="token-panel token-pricing-panel">
      <div className="token-pricing-copy"><span className="token-section-label">ESTIMATED SPEND</span><strong>{formatUsd(estimatedCost)}</strong><p>{pricing ? t("token.pricing.estimateHint", locale) : t("token.pricing.noPrice", locale)}</p></div>
      <div className="token-pricing-route"><span>{t("token.pricing.route", locale)}</span><b>{provider && model ? `${provider} / ${model}` : t("token.pricing.noModel", locale)}</b><small>{pricing ? `${modelPricingSnapshot} · USD / 1M tokens` : t("token.pricing.unpriced", locale)}</small>{onOpenPricingSource && <button type="button" onClick={() => void onOpenPricingSource()}>{t("token.pricing.viewModels", locale)}</button>}</div>
      {pricing && <div className="token-pricing-rates"><span>{t("token.rate.input", locale)} <b>{pricing.input === undefined ? "—" : `$${pricing.input}`}</b></span><span>{t("token.rate.output", locale)} <b>{pricing.output === undefined ? "—" : `$${pricing.output}`}</b></span><span>{t("token.rate.cacheRead", locale)} <b>{pricing.cacheRead === undefined ? "—" : `$${pricing.cacheRead}`}</b></span><span>{t("token.rate.cacheWrite", locale)} <b>{pricing.cacheWrite === undefined ? "—" : `$${pricing.cacheWrite}`}</b></span></div>}
    </div>

    <div className="token-dashboard-main">
      <div className="token-panel token-composition-panel"><div className="token-panel-heading"><div><span>COMPOSITION</span><h3>{t("token.composition.title", locale)}</h3></div><b>{formatTokens(totals.totalTokens)} tokens</b></div><Donut data={visibleData} locale={locale} /><div className="token-composition-note"><span><i style={{ background: COLORS.uncached }} />{t("token.composition.uncached", locale, { tokens: formatTokens(totals.uncachedInputTokens) })}</span><span><i style={{ background: COLORS.cacheRead }} />{t("token.composition.cacheRead", locale, { tokens: formatTokens(totals.cacheReadTokens) })}</span><span><i style={{ background: COLORS.cacheWrite }} />{t("token.composition.cacheWrite", locale, { tokens: formatTokens(totals.cacheWriteTokens) })}</span></div></div>
      <div className="token-panel token-context-panel"><div className="token-panel-heading"><div><span>CONTEXT WINDOW</span><h3>{t("token.context.title", locale)}</h3></div><b>{sessionStats.contextTokensAvailable && sessionStats.contextLimit ? Math.round(contextPercent) + "%" : "—"}</b></div><div className="token-context-visual"><div className="token-context-ring" style={{ "--token-context-progress": contextPercent + "%" } as CSSProperties}><div><strong>{sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : "—"}</strong><span>{t("token.context.current", locale)}</span></div></div><div className="token-context-details"><span>{t("token.context.used", locale)} <b>{sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : t("token.context.unavailable", locale)}</b></span><span>{t("token.context.limit", locale)} <b>{sessionStats.contextLimit ? formatTokens(sessionStats.contextLimit) : t("token.context.unavailable", locale)}</b></span><span>{t("token.context.messages", locale)} <b>{sessionStats.messages}</b></span></div></div><div className="token-progress"><i style={{ width: contextPercent + "%" }} /></div></div>
    </div>

    <div className="token-panel token-history-panel"><div className="token-panel-heading"><div><span>RESPONSE HISTORY</span><h3>{t("token.history.title", locale)}</h3></div><div className="token-chart-legend"><span><i style={{ background: COLORS.input }} />{t("token.legend.input", locale)}</span><span><i style={{ background: COLORS.output }} />{t("token.legend.output", locale)}</span><span><i style={{ background: COLORS.reasoning }} />{t("token.legend.reasoning", locale)}</span></div></div>{points.length > 0 ? <div className="token-history-chart">{points.map((point) => <UsageBars key={point.key} point={point} max={max} locale={locale} />)}</div> : <EmptyChart locale={locale} />}</div>

    <div className="token-detail-grid"><div className="token-detail-section"><span className="token-section-label">INPUT LEDGER</span><div><b>{formatTokens(totals.inputTokens)}</b><small>{t("token.ledger.input", locale)}</small></div><div><b>{formatTokens(totals.uncachedInputTokens)}</b><small>{t("token.ledger.uncached", locale)}</small></div><div><b>{formatTokens(totals.cacheReadTokens)}</b><small>{t("token.ledger.cacheRead", locale)}</small></div><div><b>{formatTokens(totals.cacheWriteTokens)}</b><small>{t("token.ledger.cacheWrite", locale)}</small></div></div><div className="token-detail-section"><span className="token-section-label">OUTPUT LEDGER</span><div><b>{formatTokens(totals.outputTokens)}</b><small>{t("token.ledger.output", locale)}</small></div><div><b>{formatTokens(totals.reasoningTokens)}</b><small>{t("token.ledger.reasoning", locale)}</small></div><div><b>{sessionStats.turns ?? "—"}</b><small>turns</small></div><div><b>{sessionStats.steps ?? "—"}</b><small>steps</small></div></div></div>
  </section>;
}
