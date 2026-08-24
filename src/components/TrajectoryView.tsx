import { useMemo, useState, type CSSProperties } from "react";
import { buildTrajectoryRecords, durationLabel, type TrajectoryKind, type TrajectoryRecord, type TrajectoryStatus } from "../app/trajectory";
import type { DshHistoryEntry } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

function kindLabel(kind: TrajectoryKind, locale: UiLocale): string {
  if (kind === "assistant") return t("trajectory.kind.assistant", locale);
  if (kind === "context") return t("trajectory.kind.context", locale);
  if (kind === "system") return t("trajectory.kind.system", locale);
  if (kind === "tool") return t("trajectory.kind.tool", locale);
  if (kind === "turn") return t("trajectory.kind.turn", locale);
  if (kind === "approval") return t("trajectory.kind.approval", locale);
  return t("trajectory.kind.user", locale);
}

function statusLabel(status: TrajectoryStatus, locale: UiLocale): string {
  if (status === "running") return t("trajectory.status.running", locale);
  if (status === "error") return t("trajectory.status.error", locale);
  if (status === "info") return t("trajectory.status.info", locale);
  return t("trajectory.status.done", locale);
}

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type TrajectoryLane = "input" | "model" | "tools";

const TRAJECTORY_LANES: Array<{ key: TrajectoryLane; label: string }> = [
  { key: "input", label: "Input" },
  { key: "model", label: "Model" },
  { key: "tools", label: "Tools" },
];

function trajectoryLane(kind: TrajectoryKind): TrajectoryLane {
  if (kind === "tool" || kind === "approval") return "tools";
  if (kind === "assistant") return "model";
  return "input";
}

function groupByTurn(records: TrajectoryRecord[]) {
  const groups = new Map<string, { turn?: number; records: TrajectoryRecord[] }>();
  for (const record of records) {
    const key = record.turn === undefined ? "between" : String(record.turn);
    const group = groups.get(key) ?? { turn: record.turn, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function TrajectoryView({ entries, active, locale = "zh" }: { entries: DshHistoryEntry[]; active: boolean; locale?: UiLocale }) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const records = useMemo(() => buildTrajectoryRecords(entries, locale), [entries, locale]);
  // History is rebuilt on every stream flush, so the whole view re-renders
  // frequently while a turn runs. `records.indexOf` is O(n^2) across the
  // ledger and overview for large sessions, so precompute a key -> position
  // map once per records change.
  const recordIndex = useMemo(() => {
    const index = new Map<string, number>();
    records.forEach((record, position) => index.set(record.key, position));
    return index;
  }, [records]);
  const lanes = useMemo(() => {
    const byLane: Record<TrajectoryLane, TrajectoryRecord[]> = { input: [], model: [], tools: [] };
    for (const record of records) byLane[trajectoryLane(record.kind)].push(record);
    return byLane;
  }, [records]);
  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) => `${record.title} ${record.summary} ${record.detail}`.toLocaleLowerCase().includes(needle));
  }, [query, records]);
  const selected = selectedKey === null ? null : (records[recordIndex.get(selectedKey) ?? -1] ?? null);
  const groups = useMemo(() => groupByTurn(filteredRecords), [filteredRecords]);
  const timed = records.filter((record) => Number.isFinite(record.time));
  const firstTime = timed[0]?.time ?? 0;
  const lastTime = timed.at(-1)?.time ?? firstTime;
  const timeRange = Math.max(1, lastTime - firstTime);
  const assistantCount = records.filter((record) => record.kind === "assistant").length;
  const toolCount = records.filter((record) => record.kind === "tool").length;

  return (
    <div className="trajectory-view">
      <div className="trajectory-toolbar">
        <div className="trajectory-heading">
          <span className="trajectory-overline">TRAJECTORY</span>
          <strong>{t("trajectory.title", locale)}</strong>
          <span>{t("trajectory.summary", locale, { records: records.length, assistant: assistantCount, tools: toolCount })}</span>
        </div>
        <div className="trajectory-toolbar-actions">
          <span className={active ? "trajectory-live" : ""}>{active ? t("trajectory.live", locale) : t("trajectory.stopped", locale)}</span>
          <label className="trajectory-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("trajectory.searchPlaceholder", locale)} aria-label={t("trajectory.searchPlaceholder", locale)} />
          </label>
        </div>
      </div>

      {records.length > 0 && (
        <div className="trajectory-overview" aria-label={t("trajectory.overviewAria", locale)}>
          <div className="trajectory-overview-label"><span>{t("trajectory.timeOverview", locale)}</span><small>{t("trajectory.timeRange", locale, { start: formatTime(firstTime), end: formatTime(lastTime) })}</small></div>
          <div className="trajectory-overview-plot">
            <div className="trajectory-overview-lane-labels" aria-hidden="true">
              {TRAJECTORY_LANES.map((lane) => <span key={lane.key}>{lane.label}</span>)}
            </div>
            <div className="trajectory-overview-track" aria-label={t("trajectory.lanesAria", locale)}>
              {TRAJECTORY_LANES.map((lane) => (
                <div className={`trajectory-overview-lane ${lane.key}`} key={lane.key}>
                  {lanes[lane.key].map((record) => {
                    const index = recordIndex.get(record.key) ?? 0;
                    const left = ((record.time - firstTime) / timeRange) * 100;
                    const width = Math.max(0.7, ((record.durationMs ?? 0) / timeRange) * 100);
                    const style: CSSProperties = { left: `${Math.min(99.3, Math.max(0, left))}%`, width: `${Math.min(100, width)}%` };
                    return <button className={`trajectory-overview-mark ${record.kind} ${record.status}`} key={record.key} style={style} onClick={() => setSelectedKey(record.key)} title={`#${index + 1} ${record.title}`} aria-label={t("trajectory.selectRecordAria", locale, { index: index + 1 })} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="trajectory-body">
        <div className="trajectory-ledger" role="list" aria-label={t("trajectory.ledgerAria", locale)}>
          {groups.length === 0 ? (
            <div className="trajectory-empty">
              <strong>{records.length === 0 ? t("trajectory.emptyNone", locale) : t("trajectory.emptyNoMatch", locale)}</strong>
              <span>{records.length === 0 && active ? t("trajectory.emptyWait", locale) : t("trajectory.emptyRetry", locale)}</span>
            </div>
          ) : groups.map((group) => (
            <section className="trajectory-turn" key={group.turn ?? "between"}>
              <div className="trajectory-turn-header">
                <strong>{group.turn === undefined ? t("trajectory.betweenTurns", locale) : t("trajectory.turnN", locale, { turn: group.turn })}</strong>
                <span>{t("trajectory.recordCount", locale, { count: group.records.length })}</span>
              </div>
              <div className="trajectory-records">
                {group.records.map((record) => {
                  const index = (recordIndex.get(record.key) ?? 0) + 1;
                  const selectedRow = selectedKey === record.key;
                  return (
                    <button className={`trajectory-record ${record.kind} ${record.status} ${selectedRow ? "selected" : ""}`} key={record.key} onClick={() => setSelectedKey(record.key)} role="listitem" aria-pressed={selectedRow}>
                      <span className="trajectory-record-index">#{index}</span>
                      <span className="trajectory-record-kind">{kindLabel(record.kind, locale)}</span>
                      <span className="trajectory-record-main"><strong>{record.title}{record.step === undefined ? "" : ` · Step ${record.step}`}</strong><span>{record.summary}</span></span>
                      <span className="trajectory-record-meta"><em>{statusLabel(record.status, locale)}</em><time>{durationLabel(record.durationMs, locale)}</time></span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {selected && (
          <aside className="trajectory-inspector" aria-label={t("trajectory.inspectorAria", locale)}>
            <div className="trajectory-inspector-header">
              <div><span>#{(recordIndex.get(selected.key) ?? 0) + 1} · {kindLabel(selected.kind, locale)}</span><strong>{selected.title}</strong></div>
              <button onClick={() => setSelectedKey(null)} title={t("trajectory.closeDetail", locale)} aria-label={t("trajectory.closeDetail", locale)}>×</button>
            </div>
            <dl className="trajectory-meta-list">
              <div><dt>{t("trajectory.meta.event", locale)}</dt><dd>{selected.seq} · {selected.time ? formatTime(selected.time) : t("trajectory.unavailable", locale)}</dd></div>
              {selected.turn !== undefined && <div><dt>{t("trajectory.meta.position", locale)}</dt><dd>Turn {selected.turn}{selected.step === undefined ? "" : ` / Step ${selected.step}`}</dd></div>}
              <div><dt>{t("trajectory.meta.duration", locale)}</dt><dd>{durationLabel(selected.durationMs, locale)}</dd></div>
              {selected.callId && <div><dt>{t("trajectory.meta.callId", locale)}</dt><dd>{selected.callId}</dd></div>}
            </dl>
            <div className="trajectory-inspector-block"><span>{t("trajectory.block.summary", locale)}</span><p>{selected.summary}</p></div>
            {selected.argumentsText && <div className="trajectory-inspector-block"><span>{t("trajectory.block.arguments", locale)}</span><pre>{selected.argumentsText}</pre></div>}
            {selected.resultText !== undefined && <div className={`trajectory-inspector-block ${selected.resultError ? "error" : ""}`}><span>{t("trajectory.block.result", locale)}</span><pre>{selected.resultText}</pre></div>}
            <div className="trajectory-inspector-block"><span>{t("trajectory.block.raw", locale)}</span><pre>{selected.detail}</pre></div>
          </aside>
        )}
      </div>
    </div>
  );
}
