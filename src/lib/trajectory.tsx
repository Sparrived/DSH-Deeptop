import { useMemo, useState, type CSSProperties } from "react";
import type { DshHistoryEntry, DshSessionEvent } from "./desktop";

type TrajectoryKind = "system" | "user" | "context" | "assistant" | "tool" | "turn";
type TrajectoryStatus = "complete" | "running" | "error" | "info";

type TrajectoryRecord = {
  key: string;
  seq: number;
  time: number;
  kind: TrajectoryKind;
  status: TrajectoryStatus;
  title: string;
  summary: string;
  detail: string;
  turn?: number;
  step?: number;
  startedAt?: number;
  durationMs?: number | null;
  callId?: string;
  argumentsText?: string;
  resultText?: string;
  resultError?: boolean;
};

type AssistantState = {
  key: string;
  turn?: number;
  step?: number;
  recordSeq: number;
  recordTime: number;
  startedAt?: number;
  completedAt?: number;
  blocks: Record<string, unknown>;
  usage?: unknown;
  final: boolean;
  error?: string;
};

type CompactionState = {
  key: string;
  turn?: number;
  seq: number;
  time: number;
  start?: DshSessionEvent;
  summary?: DshSessionEvent;
  end?: DshSessionEvent;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function preview(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    const block = recordValue(item);
    if (!block) return "";
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") return block.text;
    if (block.type === "image") return "[图片]";
    if (block.type === "tool-call") return `调用 ${String(block.name ?? "工具")}`;
    if (block.type === "tool-result") return contentText(block.content);
    if (typeof block.text === "string") return block.text;
    return "";
  }).filter(Boolean).join("\n");
}

function blockList(blocks: Record<string, unknown>): unknown[] {
  return Object.keys(blocks)
    .sort((left, right) => Number(left) - Number(right))
    .map((index) => blocks[index]);
}

function blockSummary(blocks: unknown[]): string {
  const text = contentText(blocks);
  if (text.trim()) return preview(text);
  const calls = blocks.map(recordValue).filter(Boolean).map((block) => block?.name).filter((name): name is string => typeof name === "string");
  return calls.length > 0 ? `工具调用：${[...new Set(calls)].join("、")}` : "（无可见输出）";
}

function durationMs(startedAt?: number, completedAt?: number): number | null {
  if (startedAt === undefined || completedAt === undefined || completedAt < startedAt) return null;
  return completedAt - startedAt;
}

function durationLabel(value?: number | null): string {
  if (value === undefined || value === null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`;
}

function usageLabel(value: unknown): string {
  const usage = recordValue(value);
  if (!usage) return "";
  const input = numberValue(usage.inputTokens ?? usage.input);
  const output = numberValue(usage.outputTokens ?? usage.output);
  const reasoning = numberValue(usage.reasoningTokens ?? usage.reasoning);
  return [
    input === undefined ? "" : `输入 ${input}`,
    output === undefined ? "" : `输出 ${output}`,
    reasoning === undefined ? "" : `思考 ${reasoning}`,
  ].filter(Boolean).join(" · ");
}

function eventMessage(event: DshSessionEvent): Record<string, unknown> | undefined {
  return recordValue(event.data?.message);
}

function eventCallId(event: DshSessionEvent): string | undefined {
  const data = event.data ?? {};
  if (event.type === "tool/call") return stringValue(data.callId);
  const message = eventMessage(event);
  const source = recordValue(message?.source);
  const content = Array.isArray(message?.content) ? recordValue(message.content[0]) : undefined;
  return stringValue(source?.callId ?? content?.toolCallId ?? data.callId);
}

function eventResult(event: DshSessionEvent): { text: string; error: boolean; raw: unknown } {
  const data = event.data ?? {};
  const message = eventMessage(event);
  const content = message?.content ?? data.content;
  const first = Array.isArray(content) ? recordValue(content[0]) : undefined;
  const resultContent = first?.type === "tool-result" ? first.content : content;
  return {
    text: contentText(resultContent) || (data.error ? String(data.error) : "（无返回内容）"),
    error: first?.isError === true || data.error !== undefined || data.isError === true,
    raw: resultContent,
  };
}

function eventSource(event: DshSessionEvent): Record<string, unknown> | undefined {
  return recordValue(event.data?.source) ?? recordValue(eventMessage(event)?.source);
}

function sourceLabel(source: Record<string, unknown> | undefined): string {
  if (!source) return "上下文";
  const kind = String(source.kind ?? "context");
  if (kind === "user") return "用户";
  if (kind === "model") return "模型";
  if (kind === "tool") return "工具";
  if (kind === "plugin") return `上下文 · ${String(source.plugin ?? source.form ?? kind)}`;
  return `上下文 · ${kind}`;
}

function isHumanMessage(event: DshSessionEvent): boolean {
  const source = eventSource(event);
  return source === undefined || source.kind === "user";
}

function stepKey(turn: number | undefined, step: number | undefined, seq: number): string {
  return `${turn ?? "?"}:${step ?? "?"}:${turn === undefined && step === undefined ? seq : ""}`;
}

function applyAssistantChunk(state: AssistantState, chunk: Record<string, unknown>) {
  const type = String(chunk.type ?? "");
  const index = numberValue(chunk.index);
  if (index === undefined) return;
  const key = String(index);
  if (type === "block-start") {
    state.blocks[key] = { type: chunk.blockType, text: "" };
  } else if (type === "text-delta" || type === "reasoning-delta") {
    const previous = recordValue(state.blocks[key]);
    state.blocks[key] = {
      type: type === "text-delta" ? "text" : "reasoning",
      text: `${typeof previous?.text === "string" ? previous.text : ""}${String(chunk.text ?? "")}`,
    };
  } else if (type === "tool-call-delta") {
    const previous = recordValue(state.blocks[key]);
    state.blocks[key] = {
      type: "tool-call",
      id: String(previous?.id ?? chunk.id ?? ""),
      name: String(previous?.name ?? chunk.name ?? "工具"),
      arguments: `${typeof previous?.arguments === "string" ? previous.arguments : ""}${String(chunk.argumentsDelta ?? "")}`,
    };
  } else if (type === "block-end") {
    state.blocks[key] = chunk.block;
  }
  if (type === "usage") state.usage = chunk.usage;
}

function buildAssistantRecord(state: AssistantState, status: TrajectoryStatus): TrajectoryRecord {
  const blocks = blockList(state.blocks);
  const usage = usageLabel(state.usage);
  const statusText = state.error ? ` · ${state.error}` : usage ? ` · ${usage}` : "";
  return {
    key: `assistant-${state.key}`,
    seq: state.recordSeq,
    time: state.recordTime,
    kind: "assistant",
    status,
    title: "助手",
    summary: `${blockSummary(blocks)}${statusText}`,
    detail: pretty({ blocks, usage: state.usage, error: state.error }),
    turn: state.turn,
    step: state.step,
    startedAt: state.startedAt,
    durationMs: durationMs(state.startedAt, state.completedAt),
  };
}

function buildCompactionRecord(state: CompactionState): TrajectoryRecord {
  const startData = state.start?.data ?? {};
  const summaryData = state.summary?.data ?? {};
  const endData = state.end?.data ?? {};
  const summary = stringValue(summaryData.summary) ?? (state.end ? "压缩已结束" : "正在压缩上下文");
  const error = endData.error !== undefined ? String(endData.error) : undefined;
  const completedAt = state.end?.time;
  return {
    key: `compaction-${state.key}`,
    seq: state.seq,
    time: state.time,
    kind: "system",
    status: error ? "error" : state.end ? "complete" : "running",
    title: "上下文压缩",
    summary: error ? `压缩失败：${error}` : preview(summary),
    detail: pretty({ start: startData, summary: summaryData, end: endData }),
    turn: state.turn,
    startedAt: state.start?.time,
    durationMs: durationMs(state.start?.time, completedAt),
  };
}

export function buildTrajectoryRecords(entries: DshHistoryEntry[]): TrajectoryRecord[] {
  const records = new Map<string, TrajectoryRecord>();
  const order: string[] = [];
  const assistants = new Map<string, AssistantState>();
  const tools = new Map<string, string>();
  const compactions = new Map<string, CompactionState>();
  const turnStarts = new Map<number, number>();
  const stepStarts = new Map<string, number>();
  let currentTurn: number | undefined;
  let currentStep: number | undefined;

  const put = (record: TrajectoryRecord) => {
    if (!records.has(record.key)) order.push(record.key);
    records.set(record.key, { ...records.get(record.key), ...record });
  };

  const patch = (key: string, value: Partial<TrajectoryRecord>) => {
    const current = records.get(key);
    if (current) records.set(key, { ...current, ...value });
  };

  const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  for (const entry of sorted) {
    const event = entry.event;
    const data = event.data ?? {};
    const turn = numberValue(data.turn) ?? currentTurn;
    const step = numberValue(data.step) ?? currentStep;
    if (numberValue(data.turn) !== undefined) currentTurn = numberValue(data.turn);
    if (numberValue(data.step) !== undefined) currentStep = numberValue(data.step);

    if (event.type === "turn/start") {
      if (turn !== undefined) turnStarts.set(turn, event.time);
      currentTurn = turn;
      currentStep = undefined;
      continue;
    }

    if (event.type === "step/start") {
      const key = stepKey(turn, step, event.seq);
      stepStarts.set(key, event.time);
      const existing = assistants.get(key);
      assistants.set(key, existing ?? {
        key,
        turn,
        step,
        recordSeq: event.seq,
        recordTime: event.time,
        startedAt: event.time,
        blocks: {},
        final: false,
      });
      currentStep = step;
      continue;
    }

    if (event.type === "request/header") {
      const header = recordValue(data.header) ?? {};
      const config = recordValue(header.config) ?? {};
      const toolsCount = Array.isArray(header.tools) ? header.tools.length : 0;
      const provider = stringValue(config.provider);
      const model = stringValue(config.model);
      const summary = [provider && model ? `${provider} / ${model}` : "模型请求", toolsCount ? `${toolsCount} 个工具` : "无工具"]
        .join(" · ");
      put({
        key: `request-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: "请求配置",
        summary,
        detail: pretty(header),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "request/context") {
      put({
        key: `request-context-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: "路由上下文",
        summary: [stringValue(data.provider), stringValue(data.model)].filter(Boolean).join(" / ") || "模型路由上下文",
        detail: pretty(data),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "user/message") {
      const content = contentText(data.content) || "（无文本内容）";
      const human = isHumanMessage(event);
      put({
        key: `event-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: human ? "user" : "context",
        status: "complete",
        title: human ? "用户" : sourceLabel(eventSource(event)),
        summary: preview(content),
        detail: pretty({ content: data.content, source: data.source }),
        turn,
        step,
      });
      continue;
    }

    if (event.type === "assistant/chunk") {
      const key = stepKey(turn, step, event.seq);
      const state = assistants.get(key) ?? {
        key,
        turn,
        step,
        recordSeq: event.seq,
        recordTime: event.time,
        startedAt: stepStarts.get(key),
        blocks: {},
        final: false,
      };
      if (state.startedAt === undefined) state.startedAt = stepStarts.get(key);
      applyAssistantChunk(state, recordValue(data.chunk) ?? {});
      assistants.set(key, state);
      put(buildAssistantRecord(state, "running"));
      continue;
    }

    if (event.type === "assistant/message") {
      const key = stepKey(turn, step, event.seq);
      const message = eventMessage(event) ?? {};
      const state = assistants.get(key) ?? {
        key,
        turn,
        step,
        recordSeq: event.seq,
        recordTime: event.time,
        startedAt: stepStarts.get(key),
        blocks: {},
        final: false,
      };
      state.blocks = {};
      const content = Array.isArray(message.content) ? message.content : [];
      content.forEach((block, index) => { state.blocks[String(index)] = block; });
      state.usage = data.usage;
      state.completedAt = event.time;
      state.final = true;
      assistants.set(key, state);
      put(buildAssistantRecord(state, "complete"));
      continue;
    }

    if (event.type === "tool/call") {
      const callId = eventCallId(event) ?? `seq-${event.seq}`;
      const key = `tool-${callId}`;
      const name = stringValue(data.name) ?? "工具";
      const argumentsText = pretty(data.arguments ?? {});
      tools.set(callId, key);
      put({
        key,
        seq: event.seq,
        time: event.time,
        kind: "tool",
        status: "running",
        title: name,
        summary: "等待工具结果",
        detail: pretty({ name, callId, arguments: data.arguments, view: entry.view }),
        turn,
        step,
        callId,
        argumentsText,
        startedAt: event.time,
        durationMs: null,
      });
      continue;
    }

    if (event.type === "tool/result") {
      const callId = eventCallId(event) ?? `seq-${event.seq}`;
      const key = tools.get(callId) ?? `tool-result-${event.seq}`;
      const result = eventResult(event);
      const current = records.get(key);
      const name = current?.title ?? "工具";
      const startedAt = current?.startedAt;
      const viewText = entry.view ? pretty(entry.view) : undefined;
      if (!current) {
        put({
          key,
          seq: event.seq,
          time: event.time,
          kind: "tool",
          status: result.error ? "error" : "complete",
          title: name,
          summary: result.error ? "工具返回错误" : preview(result.text),
          detail: pretty({ callId, result: result.raw, view: entry.view }),
          turn,
          step,
          callId,
          resultText: result.text,
          resultError: result.error,
          durationMs: null,
        });
      } else {
        patch(key, {
          seq: current.seq,
          time: current.time,
          status: result.error ? "error" : "complete",
          summary: result.error ? "工具返回错误" : preview(result.text),
          detail: pretty({ name, callId, arguments: current.argumentsText, result: result.raw, view: entry.view }),
          resultText: result.text,
          resultError: result.error,
          durationMs: durationMs(startedAt, event.time),
        });
      }
      if (viewText) patch(key, { detail: `${records.get(key)?.detail ?? ""}\n\n呈现视图\n${viewText}` });
      continue;
    }

    if (event.type === "step/end") {
      const key = stepKey(turn, step, event.seq);
      const state = assistants.get(key);
      if (state && !state.final) {
        state.completedAt = event.time;
        state.error = "步骤未产生最终助手消息";
        assistants.set(key, state);
        put(buildAssistantRecord(state, "error"));
      }
      continue;
    }

    if (event.type === "turn/end") {
      const reason = recordValue(data.reason);
      const reasonKind = String(reason?.kind ?? "completed");
      const isError = !["completed", "stop", "success"].includes(reasonKind);
      put({
        key: `turn-end-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "turn",
        status: isError ? "error" : "complete",
        title: `第 ${turn ?? "?"} 轮结束`,
        summary: isError ? `结束原因：${reasonKind}` : "已完成",
        detail: pretty({ reason: data.reason }),
        turn,
        startedAt: turn === undefined ? undefined : turnStarts.get(turn),
        durationMs: durationMs(turn === undefined ? undefined : turnStarts.get(turn), event.time),
      });
      currentStep = undefined;
      continue;
    }

    if (event.type === "compaction/start" || event.type === "compaction/summary" || event.type === "compaction/end") {
      const compactionId = stringValue(data.compactionId) ?? `seq-${event.seq}`;
      const current = compactions.get(compactionId) ?? {
        key: compactionId,
        turn,
        seq: event.seq,
        time: event.time,
      };
      if (event.type === "compaction/start") current.start = event;
      if (event.type === "compaction/summary") current.summary = event;
      if (event.type === "compaction/end") current.end = event;
      compactions.set(compactionId, current);
      put(buildCompactionRecord(current));
      continue;
    }

    if (event.type !== "session/end-seed" && event.type !== "todo/write") {
      put({
        key: `event-${event.seq}`,
        seq: event.seq,
        time: event.time,
        kind: "system",
        status: "info",
        title: event.type,
        summary: preview(pretty(data)),
        detail: pretty(data),
        turn,
        step,
      });
    }
  }

  return order.map((key) => records.get(key)).filter((record): record is TrajectoryRecord => record !== undefined);
}

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
  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) => `${record.title} ${record.summary} ${record.detail}`.toLocaleLowerCase().includes(needle));
  }, [query, records]);
  const selected = records.find((record) => record.key === selectedKey) ?? null;
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
          <div className="trajectory-overview-label"><span>时间概览</span><small>{formatTime(firstTime)} — {formatTime(lastTime)}</small></div>
          <div className="trajectory-overview-track">
            {records.map((record, index) => {
              const left = ((record.time - firstTime) / timeRange) * 100;
              const width = Math.max(0.7, ((record.durationMs ?? 0) / timeRange) * 100);
              const style: CSSProperties = { left: `${Math.min(99.3, Math.max(0, left))}%`, width: `${Math.min(100, width)}%` };
              return <button className={`trajectory-overview-mark ${record.kind} ${record.status}`} key={record.key} style={style} onClick={() => setSelectedKey(record.key)} title={`#${index + 1} ${record.title}`} aria-label={`选择第 ${index + 1} 条轨迹记录`} />;
            })}
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
                  const index = records.indexOf(record) + 1;
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
              <div><span>#{records.indexOf(selected) + 1} · {kindLabel(selected.kind)}</span><strong>{selected.title}</strong></div>
              <button onClick={() => setSelectedKey(null)} title="关闭详情" aria-label="关闭详情">×</button>
            </div>
            <dl className="trajectory-meta-list">
              <div><dt>事件</dt><dd>{selected.seq} · {selected.time ? formatTime(selected.time) : "—"}</dd></div>
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
