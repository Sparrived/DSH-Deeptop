import { useMemo, useState, type CSSProperties } from "react";
import { buildTrajectoryRecords, durationLabel, type TrajectoryKind, type TrajectoryRecord, type TrajectoryStatus } from "../app/trajectory";
import type { DshHistoryEntry } from "../lib/desktop";

function kindLabel(kind: TrajectoryKind): string {
  if (kind === "assistant") return "助手";
  if (kind === "context") return "上下文";
  if (kind === "system") return "系统";
  if (kind === "tool") return "工具";
  if (kind === "turn") return "轮次";
  return "用户";
}

function statusLabel(status: TrajectoryStatus): string {
  if (status === "running") return "进行中";
  if (status === "error") return "异常";
  if (status === "info") return "记录";
  return "完成";
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
  if (kind === "tool") return "tools";
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

export function TrajectoryView({ entries, active }: { entries: DshHistoryEntry[]; active: boolean }) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const records = useMemo(() => buildTrajectoryRecords(entries), [entries]);
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
          <strong>轨迹</strong>
          <span>{records.length} 条记录 · {assistantCount} 次模型请求 · {toolCount} 个工具操作</span>
        </div>
        <div className="trajectory-toolbar-actions">
          <span className={active ? "trajectory-live" : ""}>{active ? "实时" : "已停止"}</span>
          <label className="trajectory-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索轨迹" aria-label="搜索轨迹" />
          </label>
        </div>
      </div>

      {records.length > 0 && (
        <div className="trajectory-overview" aria-label="轨迹时间概览">
          <div className="trajectory-overview-label"><span>时间概览</span><small>{formatTime(firstTime)} 至 {formatTime(lastTime)}</small></div>
          <div className="trajectory-overview-plot">
            <div className="trajectory-overview-lane-labels" aria-hidden="true">
              {TRAJECTORY_LANES.map((lane) => <span key={lane.key}>{lane.label}</span>)}
            </div>
            <div className="trajectory-overview-track" aria-label="轨迹三条时间轨道">
              {TRAJECTORY_LANES.map((lane) => (
                <div className={`trajectory-overview-lane ${lane.key}`} key={lane.key}>
                  {lanes[lane.key].map((record) => {
                    const index = recordIndex.get(record.key) ?? 0;
                    const left = ((record.time - firstTime) / timeRange) * 100;
                    const width = Math.max(0.7, ((record.durationMs ?? 0) / timeRange) * 100);
                    const style: CSSProperties = { left: `${Math.min(99.3, Math.max(0, left))}%`, width: `${Math.min(100, width)}%` };
                    return <button className={`trajectory-overview-mark ${record.kind} ${record.status}`} key={record.key} style={style} onClick={() => setSelectedKey(record.key)} title={`#${index + 1} ${record.title}`} aria-label={`选择第 ${index + 1} 条轨迹记录`} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="trajectory-body">
        <div className="trajectory-ledger" role="list" aria-label="轨迹记录">
          {groups.length === 0 ? (
            <div className="trajectory-empty">
              <strong>{records.length === 0 ? "当前会话还没有轨迹记录" : "没有匹配的轨迹记录"}</strong>
              <span>{records.length === 0 && active ? "等待 DSH 产生事件。" : "调整搜索条件后重试。"}</span>
            </div>
          ) : groups.map((group) => (
            <section className="trajectory-turn" key={group.turn ?? "between"}>
              <div className="trajectory-turn-header">
                <strong>{group.turn === undefined ? "轮次外" : `第 ${group.turn} 轮`}</strong>
                <span>{group.records.length} 条记录</span>
              </div>
              <div className="trajectory-records">
                {group.records.map((record) => {
                  const index = (recordIndex.get(record.key) ?? 0) + 1;
                  const selectedRow = selectedKey === record.key;
                  return (
                    <button className={`trajectory-record ${record.kind} ${record.status} ${selectedRow ? "selected" : ""}`} key={record.key} onClick={() => setSelectedKey(record.key)} role="listitem" aria-pressed={selectedRow}>
                      <span className="trajectory-record-index">#{index}</span>
                      <span className="trajectory-record-kind">{kindLabel(record.kind)}</span>
                      <span className="trajectory-record-main"><strong>{record.title}{record.step === undefined ? "" : ` · Step ${record.step}`}</strong><span>{record.summary}</span></span>
                      <span className="trajectory-record-meta"><em>{statusLabel(record.status)}</em><time>{durationLabel(record.durationMs)}</time></span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {selected && (
          <aside className="trajectory-inspector" aria-label="轨迹记录详情">
            <div className="trajectory-inspector-header">
              <div><span>#{(recordIndex.get(selected.key) ?? 0) + 1} · {kindLabel(selected.kind)}</span><strong>{selected.title}</strong></div>
              <button onClick={() => setSelectedKey(null)} title="关闭详情" aria-label="关闭详情">×</button>
            </div>
            <dl className="trajectory-meta-list">
              <div><dt>事件</dt><dd>{selected.seq} · {selected.time ? formatTime(selected.time) : "未提供"}</dd></div>
              {selected.turn !== undefined && <div><dt>位置</dt><dd>Turn {selected.turn}{selected.step === undefined ? "" : ` / Step ${selected.step}`}</dd></div>}
              <div><dt>耗时</dt><dd>{durationLabel(selected.durationMs)}</dd></div>
              {selected.callId && <div><dt>调用 ID</dt><dd>{selected.callId}</dd></div>}
            </dl>
            <div className="trajectory-inspector-block"><span>摘要</span><p>{selected.summary}</p></div>
            {selected.argumentsText && <div className="trajectory-inspector-block"><span>参数</span><pre>{selected.argumentsText}</pre></div>}
            {selected.resultText !== undefined && <div className={`trajectory-inspector-block ${selected.resultError ? "error" : ""}`}><span>结果</span><pre>{selected.resultText}</pre></div>}
            <div className="trajectory-inspector-block"><span>原始详情</span><pre>{selected.detail}</pre></div>
          </aside>
        )}
      </div>
    </div>
  );
}
