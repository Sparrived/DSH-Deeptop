import { useMemo, useState, type CSSProperties } from "react";
import type {
  SessionActivitySignal,
  SessionCostData,
  SessionCostTurnRow,
  SessionDashboardData,
  SessionStats,
  SessionTurnOutcome,
  SessionTurnPoint,
  TokenUsageDashboardData,
  TokenUsagePoint,
} from "../app/model-types";
import { displayTitle, formatTokens } from "../app/model";
import { sessionCost } from "../app/session-cost";
import { sessionDashboard } from "../app/session-dashboard";
import { formatSessionElapsed } from "../app/session-events";
import { formatMetricDuration, formatMetricTokens, formatMetricVolume, formatTokensPerSecond } from "../app/session-metrics";
import { tokenUsagePercent, tokenUsageTotals } from "../app/token-usage";
import { estimateTokenCost, formatUsd, modelPricing, modelPricingSnapshot } from "../app/model-pricing";
import type { DshHistoryEntry, DshSessionSummary } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

export type SessionDashboardProps = {
  entries: DshHistoryEntry[];
  sessionStats: SessionStats;
  session: DshSessionSummary | null;
  active: boolean;
  loading?: boolean;
  loadError?: string | null;
  running: boolean;
  elapsedMs: number;
  provider?: string;
  model?: string;
  locale?: UiLocale;
  onRetryLoad?: () => void;
  onOpenPricingSource?: () => void | Promise<void>;
};

const COLORS = {
  input: "#5c6bc0",
  output: "#ef8354",
  reasoning: "#a86fd1",
  uncached: "#8090a8",
  cacheRead: "#4a9d86",
  cacheWrite: "#d49749",
};

const SIGNAL_LABELS: Record<SessionActivitySignal, string> = {
  user: "sessionDashboard.signal.user",
  assistant: "sessionDashboard.signal.assistant",
  tool: "sessionDashboard.signal.tool",
  error: "sessionDashboard.signal.error",
};

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="session-metric">
    <span className="session-metric-label"><i style={{ background: tone }} />{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </div>;
}

function formatEventTime(value: number | undefined, locale: UiLocale) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function SessionOverview({ data, locale }: { data: SessionDashboardData; locale: UiLocale }) {
  const { summary, token } = data;
  const toolSuccess = summary.toolResults > 0
    ? Math.max(0, ((summary.toolResults - summary.toolFailures) / summary.toolResults) * 100)
    : undefined;
  return <div className="session-overview">
    <div className="session-duration-block">
      <span>{t("sessionDashboard.overview.duration", locale)}</span>
      <strong>{formatSessionElapsed(summary.elapsedMs)}</strong>
      <small>{t("sessionDashboard.overview.span", locale, {
        start: formatEventTime(summary.firstEventTime, locale),
        end: formatEventTime(summary.lastEventTime, locale),
      })}</small>
    </div>
    <div className="session-metric-grid">
      <Metric label={t("sessionDashboard.overview.turns", locale)} value={formatTokens(summary.turns)} detail={t("sessionDashboard.overview.stepsDetail", locale, { count: formatTokens(summary.steps) })} tone="var(--accent)" />
      <Metric label={t("sessionDashboard.overview.messages", locale)} value={formatTokens(summary.messages)} detail={t("sessionDashboard.overview.messagesDetail", locale, { user: summary.userMessages, assistant: summary.assistantMessages })} tone={COLORS.input} />
      <Metric label={t("sessionDashboard.overview.tools", locale)} value={formatTokens(summary.toolCalls)} detail={toolSuccess === undefined ? t("sessionDashboard.overview.noToolResults", locale) : t("sessionDashboard.overview.toolSuccess", locale, { rate: Math.round(toolSuccess) })} tone={summary.toolFailures > 0 ? COLORS.output : COLORS.cacheRead} />
      <Metric label={t("sessionDashboard.overview.tokens", locale)} value={formatTokens(token.totals.totalTokens)} detail={t("sessionDashboard.overview.tokensDetail", locale, { input: formatTokens(token.totals.inputTokens), output: formatTokens(token.totals.outputTokens) })} tone={COLORS.output} />
    </div>
  </div>;
}

function TurnActivity({ turns, locale }: { turns: SessionTurnPoint[]; locale: UiLocale }) {
  const recent = turns.slice(-8);
  const maxTokens = Math.max(1, ...recent.map((turn) => turn.totalTokens));
  if (recent.length === 0) {
    return <div className="session-empty-activity"><strong>{t("sessionDashboard.activity.emptyTitle", locale)}</strong><p>{t("sessionDashboard.activity.emptyHint", locale)}</p></div>;
  }
  return <div className="session-turn-list">
    {recent.map((turn) => {
      const visibleSignals = turn.signals.slice(-18);
      const label = t("sessionDashboard.activity.rowAria", locale, {
        label: turn.label,
        messages: turn.userMessages + turn.assistantMessages,
        tools: turn.toolCalls,
        failures: turn.toolFailures,
        tokens: turn.totalTokens,
      });
      return <div className="session-turn-row" key={turn.key} aria-label={label}>
        <div className="session-turn-label"><b>{turn.label}</b><span>{formatMetricDuration(turn.durationMs)}</span></div>
        <div className="session-turn-pulse" role="img" aria-label={label}>
          {visibleSignals.length > 0 ? visibleSignals.map((signal, index) => <i className={signal} key={`${turn.key}-${index}`} title={t(SIGNAL_LABELS[signal], locale)} />) : <span>{t("sessionDashboard.activity.noSignals", locale)}</span>}
        </div>
        <div className="session-turn-facts"><span>{t("sessionDashboard.activity.steps", locale, { count: turn.steps })}</span><span>{t("sessionDashboard.activity.tools", locale, { count: turn.toolCalls })}</span></div>
        <div className="session-turn-token"><i style={{ width: `${tokenUsagePercent(turn.totalTokens, maxTokens)}%` }} /></div>
        <strong>{formatTokens(turn.totalTokens)}</strong>
      </div>;
    })}
  </div>;
}

function TimingPanel({ data, sessionStats, locale }: { data: SessionDashboardData; sessionStats: SessionStats; locale: UiLocale }) {
  const llmMs = sessionStats.llmMs ?? 0;
  const toolMs = sessionStats.toolMs ?? 0;
  const remainderMs = Math.max(0, data.summary.elapsedMs - llmMs - toolMs);
  const denominator = Math.max(1, llmMs + toolMs + remainderMs);
  const llmPercent = tokenUsagePercent(llmMs, denominator);
  const toolPercent = tokenUsagePercent(toolMs, denominator);
  const remainderPercent = Math.max(0, 100 - llmPercent - toolPercent);
  const toolSuccess = data.summary.toolResults > 0
    ? Math.max(0, ((data.summary.toolResults - data.summary.toolFailures) / data.summary.toolResults) * 100)
    : undefined;
  const totals = [
    { label: t("token.timing.llm", locale), value: formatMetricDuration(sessionStats.llmMs), detail: t("token.timing.llmDetail", locale) },
    { label: t("token.timing.tool", locale), value: formatMetricDuration(sessionStats.toolMs), detail: t("token.timing.toolDetail", locale) },
    { label: t("token.timing.ttft", locale), value: formatMetricDuration(sessionStats.ttftMs), detail: t("token.timing.ttftDetail", locale, { count: formatTokens(sessionStats.ttftSteps ?? 0) }) },
    { label: t("token.timing.decode", locale), value: formatMetricDuration(sessionStats.decodeMs), detail: t("token.timing.decodeDetail", locale, { tokens: formatMetricTokens(sessionStats.decodeTokens), speed: sessionStats.decodeMs && sessionStats.decodeTokens ? formatTokensPerSecond(sessionStats.decodeTokens / (sessionStats.decodeMs / 1000)) : "—" }) },
  ];
  const timingAria = t("sessionDashboard.timing.aria", locale, {
    llm: formatMetricDuration(sessionStats.llmMs),
    tool: formatMetricDuration(sessionStats.toolMs),
    other: formatMetricDuration(remainderMs),
  });
  return <div className="session-panel session-timing-panel">
    <div className="session-panel-heading"><div><span>{t("sessionDashboard.timing.kicker", locale)}</span><h3>{t("sessionDashboard.timing.title", locale)}</h3></div><b>{t("token.timing.turnsSteps", locale, { turns: formatTokens(data.summary.turns), steps: formatTokens(data.summary.steps) })}</b></div>
    <div className="session-time-track" role="img" aria-label={timingAria}><i className="llm" style={{ width: `${llmPercent}%` }} /><i className="tool" style={{ width: `${toolPercent}%` }} /><i className="other" style={{ width: `${remainderPercent}%` }} /></div>
    <div className="session-time-legend"><span><i className="llm" />{t("sessionDashboard.timing.llm", locale)}</span><span><i className="tool" />{t("sessionDashboard.timing.tool", locale)}</span><span><i className="other" />{t("sessionDashboard.timing.other", locale)}</span></div>
    <div className="session-timing-grid">{totals.map((item) => <div className="session-timing-cell" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>)}</div>
    <div className="session-reliability"><div><span>{t("sessionDashboard.tools.results", locale)}</span><strong>{data.summary.toolResults}</strong></div><div><span>{t("sessionDashboard.tools.failures", locale)}</span><strong>{data.summary.toolFailures}</strong></div><div><span>{t("sessionDashboard.tools.successRate", locale)}</span><strong>{toolSuccess === undefined ? "—" : `${Math.round(toolSuccess)}%`}</strong></div></div>
  </div>;
}

function Donut({ data, locale }: { data: TokenUsageDashboardData; locale: UiLocale }) {
  const total = Math.max(1, data.totals.inputTokens + data.totals.outputTokens);
  const input = tokenUsagePercent(data.totals.inputTokens, total);
  const label = t("token.donutAria", locale, {
    input: formatTokens(data.totals.inputTokens),
    output: formatTokens(data.totals.outputTokens),
    reasoning: formatTokens(data.totals.reasoningTokens),
  });
  return <div className="token-donut-wrap" role="img" aria-label={label}>
    <div className="token-donut" style={{ background: `conic-gradient(${COLORS.input} 0 ${input}%, ${COLORS.output} ${input}% 100%)` }}>
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
    <div className="token-point-label"><b>{point.label}</b><span>{formatMetricDuration(point.runMs)}</span></div>
    <div className="token-bars">
      <div className="token-composition-track" role="img" aria-label={label} style={{ width: `${totalWidth}%` }}><i style={{ width: `${inputPercent}%`, background: COLORS.input }} /><i style={{ width: `${outputPercent}%`, background: COLORS.output }} /></div>
      <div className="token-bar-values"><span><i style={{ background: COLORS.input }} />{t("token.inputTokens", locale, { tokens: formatTokens(point.inputTokens) })}</span><span><i style={{ background: COLORS.output }} />{t("token.outputTokens", locale, { tokens: formatTokens(point.outputTokens) })}</span><span><i style={{ background: COLORS.reasoning }} />{t("token.reasoningTokens", locale, { tokens: formatTokens(point.reasoningTokens) })}</span></div>
    </div>
    <strong>{formatTokens(point.totalTokens)}</strong>
  </div>;
}

function EmptyTokenChart({ locale }: { locale: UiLocale }) {
  return <div className="token-empty-chart"><span className="token-empty-grid" /><strong>{t("token.emptyTitle", locale)}</strong><p>{t("token.emptyHint", locale)}</p></div>;
}

/** 轮次结局对应的文案键：与 sidebar 的 indicator 语义保持一致。 */
const OUTCOME_LABELS: Record<SessionTurnOutcome, string> = {
  completed: "sessionDashboard.cost.outcome.completed",
  error: "sessionDashboard.cost.outcome.error",
  cancelled: "sessionDashboard.cost.outcome.cancelled",
  "max-tokens": "sessionDashboard.cost.outcome.maxTokens",
  blocked: "sessionDashboard.cost.outcome.blocked",
  interrupted: "sessionDashboard.cost.outcome.interrupted",
  open: "sessionDashboard.cost.outcome.open",
};

/** 工具成本表最多显示的行数；其余折叠为一行合计，避免长会话撑爆面板。 */
const COST_TOOL_ROWS = 8;
/** 重复命令清单最多显示的行数。 */
const COST_COMMAND_ROWS = 6;

function ToolCostTable({ cost, locale }: { cost: SessionCostData; locale: UiLocale }) {
  const rows = cost.tools.slice(0, COST_TOOL_ROWS);
  const hidden = cost.tools.length - rows.length;
  if (cost.toolCalls === 0) {
    return <div className="session-empty-activity"><strong>{t("sessionDashboard.cost.toolsEmptyTitle", locale)}</strong><p>{t("sessionDashboard.cost.toolsEmptyHint", locale)}</p></div>;
  }
  const maxChars = Math.max(1, ...rows.map((row) => row.resultChars));
  return <>
    <div className="session-cost-table session-cost-tool-table" role="table" aria-label={t("sessionDashboard.cost.toolsAria", locale)}>
      <div className="session-cost-row session-cost-head" role="row">
        <span role="columnheader">{t("sessionDashboard.cost.column.tool", locale)}</span>
        <span role="columnheader">{t("sessionDashboard.cost.column.calls", locale)}</span>
        <span role="columnheader">{t("sessionDashboard.cost.column.time", locale)}</span>
        <span role="columnheader">{t("sessionDashboard.cost.column.errors", locale)}</span>
        <span role="columnheader">{t("sessionDashboard.cost.column.payload", locale)}</span>
      </div>
      {rows.map((row) => <div className="session-cost-row" role="row" key={row.name}>
        <span className="session-cost-name" role="cell" title={row.name}>{row.name}</span>
        <span role="cell">{formatTokens(row.calls)}</span>
        <span role="cell" className="session-cost-time">{formatMetricDuration(row.durationMs)}</span>
        <span role="cell" className={row.errors > 0 ? "session-cost-error" : undefined}>
          {row.errors > 0 ? `${formatTokens(row.errors)} · ${Math.round(row.errorRate)}%` : "0"}
        </span>
        <span className="session-cost-volume" role="cell">
          <i style={{ width: `${tokenUsagePercent(row.resultChars, maxChars)}%` }} />
          <b>{formatMetricVolume(row.resultChars)}</b>
        </span>
      </div>)}
    </div>
    {hidden > 0 && <small className="session-cost-more">{t("sessionDashboard.cost.moreTools", locale, { count: hidden, calls: formatTokens(cost.tools.slice(COST_TOOL_ROWS).reduce((n, row) => n + row.calls, 0)) })}</small>}
  </>;
}

function RepeatedCommands({ cost, locale }: { cost: SessionCostData; locale: UiLocale }) {
  if (cost.repeatedCommands.length === 0) {
    return <div className="session-cost-note"><strong>{t("sessionDashboard.cost.commandsEmptyTitle", locale)}</strong><p>{t("sessionDashboard.cost.commandsEmptyHint", locale, { count: formatTokens(cost.distinctCommands) })}</p></div>;
  }
  const rows = cost.repeatedCommands.slice(0, COST_COMMAND_ROWS);
  const hidden = cost.repeatedCommands.length - rows.length;
  return <>
    <ul className="session-cost-commands">
      {rows.map((row) => <li key={row.command} title={row.command}>
        <b>{row.calls}×</b>
        <code>{row.command}</code>
      </li>)}
    </ul>
    {hidden > 0 && <small className="session-cost-more">{t("sessionDashboard.cost.moreCommands", locale, { count: hidden })}</small>}
  </>;
}

/** 轮次结局条最多渲染的格数：超出时只保留最近的一段，避免长会话堆出上千个节点。 */
const OUTCOME_STRIP_CELLS = 80;

function TurnOutcomeStrip({ cost, locale }: { cost: SessionCostData; locale: UiLocale }) {
  const closed = cost.turns.filter((turn) => turn.outcome !== "open");
  if (closed.length === 0) return null;
  const cells = closed.length > OUTCOME_STRIP_CELLS ? closed.slice(-OUTCOME_STRIP_CELLS) : closed;
  return <div className="session-cost-outcomes" role="img" aria-label={t("sessionDashboard.cost.outcomeAria", locale, {
    wasted: cost.wastedTurns,
    total: closed.length,
  })}>
    {closed.length > cells.length && <i className="session-cost-outcomes-more" title={t("sessionDashboard.cost.outcomeTruncated", locale, { count: closed.length - cells.length })} />}
    {cells.map((turn: SessionCostTurnRow) => <i
      key={turn.key}
      className={turn.outcome}
      title={t("sessionDashboard.cost.turnTitle", locale, {
        turn: turn.turn ?? 0,
        outcome: t(OUTCOME_LABELS[turn.outcome], locale),
        steps: turn.steps,
        calls: turn.toolCalls,
      })}
    />)}
  </div>;
}

/**
 * 会话成本计量面板：回答「这次会话贵在哪、浪费在哪」。
 *
 * 概览面板给出总量，这里给出归因：工具失败集中在哪、重试拖慢了多少步、
 * 哪些命令被重复执行、哪些轮次以 error 结束（其中的工作全部作废）。
 */
function CostPanel({ cost, locale }: { cost: SessionCostData; locale: UiLocale }) {
  const toolSuccess = cost.toolCalls > 0 ? Math.max(0, 100 - cost.toolErrorRate) : undefined;
  // 只有已结束的轮次才有结局可言；全部仍在进行时没有可比较的分母。
  const closedTurns = cost.turns.filter((turn) => turn.outcome !== "open").length;
  const wastedShare = closedTurns > 0 ? (cost.wastedTurns / closedTurns) * 100 : 0;
  return <div className="session-panel session-cost-panel">
    <div className="session-panel-heading">
      <div><span>{t("sessionDashboard.cost.kicker", locale)}</span><h3>{t("sessionDashboard.cost.title", locale)}</h3></div>
      <b>{t("sessionDashboard.cost.headline", locale, { calls: formatTokens(cost.toolCalls), tools: cost.tools.length })}</b>
    </div>

    <div className="session-cost-metrics">
      <Metric label={t("sessionDashboard.cost.metric.toolErrors", locale)} value={cost.toolCalls > 0 ? `${Math.round(cost.toolErrorRate)}%` : "—"} detail={t("sessionDashboard.cost.metric.toolErrorsDetail", locale, { errors: formatTokens(cost.toolFailures), calls: formatTokens(cost.toolCalls), success: toolSuccess === undefined ? "—" : Math.round(toolSuccess) })} tone={cost.toolFailures > 0 ? COLORS.output : COLORS.cacheRead} />
      <Metric label={t("sessionDashboard.cost.metric.retries", locale)} value={formatTokens(cost.retries)} detail={t("sessionDashboard.cost.metric.retriesDetail", locale, { steps: formatTokens(cost.retriedSteps) })} tone={COLORS.reasoning} />
      <Metric label={t("sessionDashboard.cost.metric.wastedTurns", locale)} value={formatTokens(cost.wastedTurns)} detail={t("sessionDashboard.cost.metric.wastedTurnsDetail", locale, { steps: formatTokens(cost.wastedSteps), calls: formatTokens(cost.wastedToolCalls) })} tone={COLORS.output} />
      <Metric label={t("sessionDashboard.cost.metric.rework", locale)} value={cost.repeatedCommandCalls > 0 ? `${Math.round(cost.repeatedCommandRate)}%` : "—"} detail={t("sessionDashboard.cost.metric.reworkDetail", locale, { repeats: formatTokens(cost.repeatedCommandCalls), commands: formatTokens(cost.distinctCommands) })} tone={COLORS.cacheWrite} />
    </div>

    <div className="session-cost-outcome-block">
      <div className="session-cost-outcome-head">
        <span className="session-section-label">{t("sessionDashboard.cost.outcomeLabel", locale)}</span>
        <small>{t("sessionDashboard.cost.outcomeDetail", locale, { share: Math.round(wastedShare) })}</small>
      </div>
      <TurnOutcomeStrip cost={cost} locale={locale} />
      <div className="session-time-legend session-cost-outcome-legend">
        <span><i className="completed" />{t("sessionDashboard.cost.outcome.completed", locale)}</span>
        <span><i className="error" />{t("sessionDashboard.cost.outcome.error", locale)}</span>
        <span><i className="cancelled" />{t("sessionDashboard.cost.outcome.cancelled", locale)}</span>
        <span><i className="interrupted" />{t("sessionDashboard.cost.outcome.interrupted", locale)}</span>
      </div>
    </div>

    <div className="session-cost-columns">
      <div className="session-cost-column">
        <span className="session-section-label">{t("sessionDashboard.cost.toolsLabel", locale)}</span>
        <ToolCostTable cost={cost} locale={locale} />
      </div>
      <div className="session-cost-column">
        <span className="session-section-label">{t("sessionDashboard.cost.commandsLabel", locale)}</span>
        <RepeatedCommands cost={cost} locale={locale} />
      </div>
    </div>
  </div>;
}

export function SessionDashboard({
  entries,
  sessionStats,
  session,
  active,
  loading = false,
  loadError,
  running,
  elapsedMs,
  provider,
  model,
  locale = "zh",
  onRetryLoad,
  onOpenPricingSource,
}: SessionDashboardProps) {
  const [range, setRange] = useState<"all" | "recent">("all");
  const data = useMemo(
    () => sessionDashboard(entries, sessionStats, locale, { elapsedMs, running, now: running ? Date.now() : undefined }),
    [elapsedMs, entries, locale, running, sessionStats],
  );
  const visibleTokenData = useMemo(() => {
    if (range !== "recent") return data.token;
    const recentPoints = data.token.points.slice(-8);
    return { ...data.token, points: recentPoints, totals: tokenUsageTotals(recentPoints) };
  }, [data.token, range]);
  const cost = useMemo(() => sessionCost(entries), [entries]);
  const points = visibleTokenData.points;
  const max = Math.max(1, ...points.map((point) => point.totalTokens));
  const totals = visibleTokenData.totals;
  const pricing = useMemo(() => modelPricing(provider, model), [model, provider]);
  const estimatedCost = useMemo(() => estimateTokenCost(totals, pricing), [pricing, totals]);
  const contextPercent = sessionStats.contextLimit > 0 ? Math.min(100, (sessionStats.contextTokens / sessionStats.contextLimit) * 100) : 0;
  if (!active) return null;
  if (loading || loadError) return <section className="session-dashboard session-dashboard-loading" aria-label={t("sessionDashboard.dashboardAria", locale)} aria-busy={loading}>
    <div className="session-dashboard-head">
      <div className="session-dashboard-title"><span>{t("sessionDashboard.kicker", locale)}</span><h2>{t("sessionDashboard.title", locale)}</h2><p>{t("sessionDashboard.subtitle", locale)}</p></div>
      <div className="session-dashboard-state"><span className={running ? "running" : "idle"}>{running ? t("sessionDashboard.status.running", locale) : t("sessionDashboard.status.idle", locale)}</span><strong>{session ? displayTitle(session, locale) : t("header.newSession", locale)}</strong><small>{provider && model ? `${provider} / ${model}` : t("token.pricing.noModel", locale)}</small></div>
    </div>
    <div className="session-dashboard-load-state" role="status">
      <strong>{loadError ? t("sessionDashboard.load.errorTitle", locale) : t("sessionDashboard.load.title", locale)}</strong>
      <p>{loadError ?? t("sessionDashboard.load.hint", locale)}</p>
      {loadError && onRetryLoad && <button type="button" onClick={onRetryLoad}>{t("common.retry", locale)}</button>}
    </div>
  </section>;

  return <section className="session-dashboard" aria-label={t("sessionDashboard.dashboardAria", locale)}>
    <div className="session-dashboard-head">
      <div className="session-dashboard-title"><span>{t("sessionDashboard.kicker", locale)}</span><h2>{t("sessionDashboard.title", locale)}</h2><p>{t("sessionDashboard.subtitle", locale)}</p></div>
      <div className="session-dashboard-state"><span className={running ? "running" : "idle"}>{running ? t("sessionDashboard.status.running", locale) : t("sessionDashboard.status.idle", locale)}</span><strong>{session ? displayTitle(session, locale) : t("header.newSession", locale)}</strong><small>{provider && model ? `${provider} / ${model}` : t("token.pricing.noModel", locale)}</small></div>
    </div>

    <div className="session-route-line"><span><b>{t("sessionDashboard.meta.workspace", locale)}</b>{session?.cwd || t("sessionDashboard.meta.unavailable", locale)}</span><span><b>{t("sessionDashboard.meta.preset", locale)}</b>{session?.agentPreset || t("sessionDashboard.meta.defaultPreset", locale)}</span><span><b>{t("sessionDashboard.meta.events", locale)}</b>{t("sessionDashboard.meta.loadedEvents", locale, { count: data.summary.eventCount })}</span></div>

    <SessionOverview data={data} locale={locale} />

    <div className="session-dashboard-main">
      <div className="session-panel session-activity-panel"><div className="session-panel-heading"><div><span>{t("sessionDashboard.activity.kicker", locale)}</span><h3>{t("sessionDashboard.activity.title", locale)}</h3></div><b>{t("sessionDashboard.activity.recent", locale, { count: Math.min(8, data.turns.length) })}</b></div><div className="session-signal-legend"><span><i className="user" />{t("sessionDashboard.signal.user", locale)}</span><span><i className="assistant" />{t("sessionDashboard.signal.assistant", locale)}</span><span><i className="tool" />{t("sessionDashboard.signal.tool", locale)}</span><span><i className="error" />{t("sessionDashboard.signal.error", locale)}</span></div><TurnActivity turns={data.turns} locale={locale} /></div>
      <TimingPanel data={data} sessionStats={sessionStats} locale={locale} />
    </div>

    <div className="session-section-head">
      <div><span>{t("sessionDashboard.cost.sectionKicker", locale)}</span><h3>{t("sessionDashboard.cost.sectionTitle", locale)}</h3><p>{t("sessionDashboard.cost.sectionSubtitle", locale)}</p></div>
    </div>

    <CostPanel cost={cost} locale={locale} />

    <div className="session-section-head">
      <div><span>{t("sessionDashboard.tokens.kicker", locale)}</span><h3>{t("sessionDashboard.tokens.title", locale)}</h3><p>{t("sessionDashboard.tokens.subtitle", locale)}</p></div>
      <div className="token-head-actions" role="group" aria-label={t("sessionDashboard.tokens.rangeAria", locale)}><span className="token-live-dot">{data.token.hasHistoryUsage || sessionStats.tokenUsageAvailable ? t("token.live", locale) : t("token.waiting", locale)}</span><button type="button" className={range === "all" ? "selected" : ""} aria-pressed={range === "all"} onClick={() => setRange("all")}>{t("token.rangeAll", locale)}</button><button type="button" className={range === "recent" ? "selected" : ""} aria-pressed={range === "recent"} onClick={() => setRange("recent")}>{t("token.rangeRecent", locale)}</button></div>
    </div>

    <div className="token-metric-grid">
      <Metric label={t("token.metric.total", locale)} value={formatTokens(totals.totalTokens)} tone="var(--accent)" detail={range === "recent" ? t("sessionDashboard.tokens.recentDetail", locale, { count: points.length }) : sessionStats.tokenUsageAvailable ? t("token.metric.totalDetailRecords", locale, { count: sessionStats.messages }) : t("token.metric.totalDetailEstimated", locale, { count: sessionStats.messages })} />
      <Metric label={t("token.metric.context", locale)} value={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? `${Math.round(contextPercent)}%` : formatTokens(sessionStats.contextTokens)) : "—"} tone={COLORS.cacheRead} detail={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? `${formatTokens(sessionStats.contextTokens)} / ${formatTokens(sessionStats.contextLimit)}` : t("token.metric.noLimit", locale)) : t("token.metric.noContext", locale)} />
      <Metric label={t("token.metric.cache", locale)} value={`${Math.round(totals.cacheHitRate)}%`} tone={COLORS.cacheRead} detail={t("sessionDashboard.tokens.cacheDetail", locale, { read: formatTokens(totals.cacheReadTokens), write: formatTokens(totals.cacheWriteTokens) })} />
    </div>

    <div className="session-panel token-pricing-panel">
      <div className="token-pricing-copy"><span className="session-section-label">{t("sessionDashboard.pricing.kicker", locale)}</span><strong>{formatUsd(estimatedCost)}</strong><p>{pricing ? t("token.pricing.estimateHint", locale) : t("token.pricing.noPrice", locale)}</p></div>
      <div className="token-pricing-route"><span>{t("token.pricing.route", locale)}</span><b>{provider && model ? `${provider} / ${model}` : t("token.pricing.noModel", locale)}</b><small>{pricing ? t("token.pricing.snapshot", locale, { snapshot: modelPricingSnapshot }) : t("token.pricing.unpriced", locale)}</small>{onOpenPricingSource && <button type="button" onClick={() => void onOpenPricingSource()}>{t("token.pricing.viewModels", locale)}</button>}</div>
      {pricing && <div className="token-pricing-rates"><span>{t("token.rate.input", locale)} <b>{pricing.input === undefined ? "—" : `$${pricing.input}`}</b></span><span>{t("token.rate.output", locale)} <b>{pricing.output === undefined ? "—" : `$${pricing.output}`}</b></span><span>{t("token.rate.cacheRead", locale)} <b>{pricing.cacheRead === undefined ? "—" : `$${pricing.cacheRead}`}</b></span><span>{t("token.rate.cacheWrite", locale)} <b>{pricing.cacheWrite === undefined ? "—" : `$${pricing.cacheWrite}`}</b></span></div>}
    </div>

    <div className="token-dashboard-main">
      <div className="session-panel token-composition-panel"><div className="session-panel-heading"><div><span>{t("sessionDashboard.tokens.compositionKicker", locale)}</span><h3>{t("token.composition.title", locale)}</h3></div><b>{t("token.count", locale, { count: formatTokens(totals.totalTokens) })}</b></div><Donut data={visibleTokenData} locale={locale} /><div className="token-composition-note"><span><i style={{ background: COLORS.uncached }} />{t("token.composition.uncached", locale, { tokens: formatTokens(totals.uncachedInputTokens) })}</span><span><i style={{ background: COLORS.cacheRead }} />{t("token.composition.cacheRead", locale, { tokens: formatTokens(totals.cacheReadTokens) })}</span><span><i style={{ background: COLORS.cacheWrite }} />{t("token.composition.cacheWrite", locale, { tokens: formatTokens(totals.cacheWriteTokens) })}</span></div></div>
      <div className="session-panel token-context-panel"><div className="session-panel-heading"><div><span>{t("sessionDashboard.tokens.contextKicker", locale)}</span><h3>{t("token.context.title", locale)}</h3></div><b>{sessionStats.contextTokensAvailable && sessionStats.contextLimit ? `${Math.round(contextPercent)}%` : "—"}</b></div><div className="token-context-visual"><div className="token-context-ring" style={{ "--token-context-progress": `${contextPercent}%` } as CSSProperties}><div><strong>{sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : "—"}</strong><span>{t("token.context.current", locale)}</span></div></div><div className="token-context-details"><span>{t("token.context.used", locale)} <b>{sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : t("token.context.unavailable", locale)}</b></span><span>{t("token.context.limit", locale)} <b>{sessionStats.contextLimit ? formatTokens(sessionStats.contextLimit) : t("token.context.unavailable", locale)}</b></span><span>{t("token.context.messages", locale)} <b>{sessionStats.messages}</b></span></div></div><div className="token-progress"><i style={{ width: `${contextPercent}%` }} /></div></div>
    </div>

    <div className="session-panel token-history-panel"><div className="session-panel-heading"><div><span>{t("sessionDashboard.tokens.historyKicker", locale)}</span><h3>{t("token.history.title", locale)}</h3></div><div className="token-chart-legend"><span><i style={{ background: COLORS.input }} />{t("token.legend.input", locale)}</span><span><i style={{ background: COLORS.output }} />{t("token.legend.output", locale)}</span><span><i style={{ background: COLORS.reasoning }} />{t("token.legend.reasoning", locale)}</span></div></div>{points.length > 0 ? <div className="token-history-chart">{points.map((point) => <UsageBars key={point.key} point={point} max={max} locale={locale} />)}</div> : <EmptyTokenChart locale={locale} />}</div>

    <div className="token-detail-grid"><div className="token-detail-section"><span className="session-section-label">{t("sessionDashboard.tokens.inputLedger", locale)}</span><div><b>{formatTokens(totals.inputTokens)}</b><small>{t("token.ledger.input", locale)}</small></div><div><b>{formatTokens(totals.uncachedInputTokens)}</b><small>{t("token.ledger.uncached", locale)}</small></div><div><b>{formatTokens(totals.cacheReadTokens)}</b><small>{t("token.ledger.cacheRead", locale)}</small></div><div><b>{formatTokens(totals.cacheWriteTokens)}</b><small>{t("token.ledger.cacheWrite", locale)}</small></div></div><div className="token-detail-section"><span className="session-section-label">{t("sessionDashboard.tokens.outputLedger", locale)}</span><div><b>{formatTokens(totals.outputTokens)}</b><small>{t("token.ledger.output", locale)}</small></div><div><b>{formatTokens(totals.reasoningTokens)}</b><small>{t("token.ledger.reasoning", locale)}</small></div><div><b>{data.summary.turns}</b><small>{t("sessionDashboard.units.turns", locale)}</small></div><div><b>{data.summary.steps}</b><small>{t("sessionDashboard.units.steps", locale)}</small></div></div></div>
  </section>;
}
