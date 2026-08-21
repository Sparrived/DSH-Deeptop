import { useMemo, useState, type CSSProperties } from "react";
import type { SessionStats, TokenUsageDashboardData, TokenUsagePoint } from "../app/model-types";
import { formatTokens } from "../app/model";
import { tokenUsageDashboard, tokenUsagePercent, tokenUsageTotals } from "../app/token-usage";
import { estimateTokenCost, formatUsd, modelPricing, modelPricingSnapshot } from "../app/model-pricing";
import type { DshHistoryEntry } from "../lib/desktop";

type TokenUsageDashboardProps = {
  entries: DshHistoryEntry[];
  sessionStats: SessionStats;
  active: boolean;
  provider?: string;
  model?: string;
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

function Donut({ data }: { data: TokenUsageDashboardData }) {
  // Reasoning is a provider-reported breakdown of output, so keep it out of
  // the additive ring to avoid counting the same tokens twice.
  const total = Math.max(1, data.totals.inputTokens + data.totals.outputTokens);
  const input = tokenUsagePercent(data.totals.inputTokens, total);
  const output = 100 - input;
  const label = "输入 " + formatTokens(data.totals.inputTokens) + "，输出 " + formatTokens(data.totals.outputTokens) + "；思考为输出子集 " + formatTokens(data.totals.reasoningTokens);
  return <div className="token-donut-wrap" role="img" aria-label={label}>
    <div className="token-donut" style={{ background: "conic-gradient(" + COLORS.input + " 0 " + input + "%, " + COLORS.output + " " + input + "% " + (input + output) + "%)" }}>
      <div><strong>{formatTokens(data.totals.totalTokens)}</strong><span>总 tokens</span></div>
    </div>
    <div className="token-legend">
      <span><i style={{ background: COLORS.input }} />输入 {formatTokens(data.totals.inputTokens)}</span>
      <span><i style={{ background: COLORS.output }} />输出 {formatTokens(data.totals.outputTokens)}</span>
      <span><i style={{ background: COLORS.reasoning }} />思考（输出子集） {formatTokens(data.totals.reasoningTokens)}</span>
    </div>
  </div>;
}

function UsageBars({ point, max }: { point: TokenUsagePoint; max: number }) {
  const total = Math.max(1, point.inputTokens + point.outputTokens);
  const inputPercent = tokenUsagePercent(point.inputTokens, total);
  const outputPercent = tokenUsagePercent(point.outputTokens, total);
  const totalWidth = tokenUsagePercent(point.totalTokens, max);
  const label = point.label + "，总计 " + point.totalTokens.toLocaleString() + " tokens；输入 " + point.inputTokens.toLocaleString() + "，输出 " + point.outputTokens.toLocaleString() + "，思考为输出子集 " + point.reasoningTokens.toLocaleString();
  return <div className="token-usage-row" aria-label={label}>
    <div className="token-point-label"><b>{point.label}</b><span>{point.runMs ? Math.round(point.runMs / 1000) + "s" : ""}</span></div>
    <div className="token-bars">
      <div className="token-composition-track" role="img" aria-label={label} style={{ width: totalWidth + "%" }}><i className="token-composition-input" style={{ width: inputPercent + "%", background: COLORS.input }} /><i className="token-composition-output" style={{ width: outputPercent + "%", background: COLORS.output }} /></div>
      <div className="token-bar-values"><span><i style={{ background: COLORS.input }} />输入 {formatTokens(point.inputTokens)}</span><span><i style={{ background: COLORS.output }} />输出 {formatTokens(point.outputTokens)}</span><span><i style={{ background: COLORS.reasoning }} />思考（输出子集） {formatTokens(point.reasoningTokens)}</span></div>
    </div>
    <strong>{formatTokens(point.totalTokens)}</strong>
  </div>;
}

function EmptyChart() {
  return <div className="token-empty-chart"><span className="token-empty-grid" /><strong>等待模型返回 usage 数据</strong><p>完成一轮对话后，这里会显示每次回应的输入、输出与思考 token。</p></div>;
}

export function TokenUsageDashboard({ entries, sessionStats, active, provider, model, onOpenPricingSource }: TokenUsageDashboardProps) {
  const [range, setRange] = useState<"all" | "recent">("all");
  const data = useMemo(() => tokenUsageDashboard(entries, sessionStats), [entries, sessionStats]);
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
  return <section className="token-dashboard" aria-label="Token 用量统计">
    <div className="token-dashboard-head">
      <div><span className="token-kicker">SESSION TELEMETRY</span><h2>Token 用量</h2><p>当前会话的完整消耗画像</p></div>
      <div className="token-head-actions"><span className="token-live-dot">{data.hasHistoryUsage || sessionStats.tokenUsageAvailable ? "实时同步" : "等待数据"}</span><button type="button" className={range === "all" ? "selected" : ""} onClick={() => setRange("all")}>全部</button><button type="button" className={range === "recent" ? "selected" : ""} onClick={() => setRange("recent")}>最近 8 次</button></div>
    </div>

    <div className="token-metric-grid">
      <Metric label="总消耗" value={formatTokens(totals.totalTokens)} tone="var(--accent)" detail={(sessionStats.tokenUsageAvailable ? "已记录 · " : "估算 · ") + sessionStats.messages + " 条消息"} />
      <Metric label="上下文占用" value={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? Math.round(contextPercent) + "%" : formatTokens(sessionStats.contextTokens)) : "—"} tone="#4aa98f" detail={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? formatTokens(sessionStats.contextTokens) + " / " + formatTokens(sessionStats.contextLimit) : "未提供上限") : "模型未提供上下文使用量"} />
      <Metric label="缓存命中" value={Math.round(totals.cacheHitRate) + "%"} tone={COLORS.cacheRead} detail={formatTokens(totals.cacheReadTokens) + " read · " + formatTokens(totals.cacheWriteTokens) + " write"} />
    </div>

    <div className="token-panel token-pricing-panel">
      <div className="token-pricing-copy"><span className="token-section-label">ESTIMATED SPEND</span><strong>{formatUsd(estimatedCost)}</strong><p>{pricing ? "按当前会话已记录的 token 用量估算，不会调用模型或产生额外请求。" : "当前模型没有匹配到 models.dev 价格，仍会继续显示 token 统计。"}</p></div>
      <div className="token-pricing-route"><span>当前路由</span><b>{provider && model ? `${provider} / ${model}` : "未选择模型"}</b><small>{pricing ? `${modelPricingSnapshot} · USD / 1M tokens` : "自定义模型可暂时显示为未定价"}</small>{onOpenPricingSource && <button type="button" onClick={() => void onOpenPricingSource()}>查看 models.dev ↗</button>}</div>
      {pricing && <div className="token-pricing-rates"><span>输入 <b>{pricing.input === undefined ? "—" : `$${pricing.input}`}</b></span><span>输出 <b>{pricing.output === undefined ? "—" : `$${pricing.output}`}</b></span><span>缓存读 <b>{pricing.cacheRead === undefined ? "—" : `$${pricing.cacheRead}`}</b></span><span>缓存写 <b>{pricing.cacheWrite === undefined ? "—" : `$${pricing.cacheWrite}`}</b></span></div>}
    </div>

    <div className="token-dashboard-main">
      <div className="token-panel token-composition-panel"><div className="token-panel-heading"><div><span>COMPOSITION</span><h3>输入 / 输出构成</h3></div><b>{formatTokens(totals.totalTokens)} tokens</b></div><Donut data={visibleData} /><div className="token-composition-note"><span><i style={{ background: COLORS.uncached }} />未缓存输入 {formatTokens(totals.uncachedInputTokens)}</span><span><i style={{ background: COLORS.cacheRead }} />缓存读取 {formatTokens(totals.cacheReadTokens)}</span><span><i style={{ background: COLORS.cacheWrite }} />缓存写入 {formatTokens(totals.cacheWriteTokens)}</span></div></div>
      <div className="token-panel token-context-panel"><div className="token-panel-heading"><div><span>CONTEXT WINDOW</span><h3>上下文压力</h3></div><b>{sessionStats.contextTokensAvailable && sessionStats.contextLimit ? Math.round(contextPercent) + "%" : "—"}</b></div><div className="token-context-visual"><div className="token-context-ring" style={{ "--token-context-progress": contextPercent + "%" } as CSSProperties}><div><strong>{sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : "—"}</strong><span>当前上下文</span></div></div><div className="token-context-details"><span>已用 <b>{sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : "未提供"}</b></span><span>上限 <b>{sessionStats.contextLimit ? formatTokens(sessionStats.contextLimit) : "未提供"}</b></span><span>消息 <b>{sessionStats.messages}</b></span></div></div><div className="token-progress"><i style={{ width: contextPercent + "%" }} /></div></div>
    </div>

    <div className="token-panel token-history-panel"><div className="token-panel-heading"><div><span>RESPONSE HISTORY</span><h3>每次回应的 token 走势</h3></div><div className="token-chart-legend"><span><i style={{ background: COLORS.input }} />输入</span><span><i style={{ background: COLORS.output }} />输出</span><span><i style={{ background: COLORS.reasoning }} />思考（输出子集）</span></div></div>{points.length > 0 ? <div className="token-history-chart">{points.map((point) => <UsageBars key={point.key} point={point} max={max} />)}</div> : <EmptyChart />}</div>

    <div className="token-detail-grid"><div className="token-detail-section"><span className="token-section-label">INPUT LEDGER</span><div><b>{formatTokens(totals.inputTokens)}</b><small>输入 tokens</small></div><div><b>{formatTokens(totals.uncachedInputTokens)}</b><small>未缓存</small></div><div><b>{formatTokens(totals.cacheReadTokens)}</b><small>缓存读取</small></div><div><b>{formatTokens(totals.cacheWriteTokens)}</b><small>缓存写入</small></div></div><div className="token-detail-section"><span className="token-section-label">OUTPUT LEDGER</span><div><b>{formatTokens(totals.outputTokens)}</b><small>输出 tokens</small></div><div><b>{formatTokens(totals.reasoningTokens)}</b><small>思考 tokens</small></div><div><b>{sessionStats.turns ?? "—"}</b><small>turns</small></div><div><b>{sessionStats.steps ?? "—"}</b><small>steps</small></div></div></div>
  </section>;
}
