import type { DshHistoryEntry } from "../lib/desktop";
import { diffSummaryFromHistoryEntry, eventToolCallId, eventToolResultError, recordValue } from "./message-model";
import type { DeliverableFileDiff, TodoItem, TodoStatus, WorkflowView } from "./model-types";

function diffLineCount(text: string) {
  if (!text) return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body ? body.split("\n").length : 0;
}

export function todoItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => {
    const record = recordValue(item);
    const content = record?.content;
    const status = record?.status;
    if (typeof content !== "string" || !content.trim() || !["pending", "in_progress", "completed"].includes(String(status))) return undefined;
    return { content, status: status as TodoStatus };
  });
  return items.every((item): item is TodoItem => item !== undefined) ? items : undefined;
}
export function todoProjection(value: unknown): TodoItem[] | null | undefined {
  return value === null ? null : todoItems(value);
}

export function todosFromHistory(entries: DshHistoryEntry[]): TodoItem[] | null | undefined {
  let current: TodoItem[] | null | undefined;
  for (const { event } of [...entries].sort((left, right) => left.event.seq - right.event.seq)) {
    if (event.type === "turn/start") current = null;
    if (event.type === "todo/write") {
      const next = todoItems(event.data.todos);
      if (next !== undefined) current = next;
    }
  }
  return current;
}

export function todoStatusLabel(status: TodoStatus) {
  if (status === "completed") return "已完成";
  if (status === "in_progress") return "进行中";
  return "待处理";
}

export function workflowStatusLabel(status: WorkflowView["status"]) {
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  if (status === "interrupted") return "已中断";
  return "失败";
}

export function workflowMemberStatus(value: unknown): WorkflowView["phases"][number]["members"][number]["status"] {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  if (value === "interrupted") return "interrupted";
  return "running";
}

export function workflowRunStatus(value: unknown): WorkflowView["status"] {
  if (value === "completed") return "completed";
  if (value === "cancelled") return "cancelled";
  if (value === "failed" || value === "error") return "failed";
  if (value === "interrupted") return "interrupted";
  return "running";
}

export function workflowViewsFromHistory(entries: DshHistoryEntry[]) {
  const runs = new Map<string, { seq: number; time: number; view: WorkflowView; members: Map<number, { label: string; childId: string; phase: string | null; status: WorkflowView["phases"][number]["members"][number]["status"] }> }>();
  for (const { event } of entries) {
    if (!event.type.startsWith("tool-workflow/")) continue;
    const data = event.data;
    const runId = typeof data.runId === "string" || typeof data.runId === "number" ? String(data.runId) : "";
    if (!runId) continue;
    if (event.type === "tool-workflow/run-start") {
      runs.set(runId, {
        seq: event.seq,
        time: event.time,
        view: { name: typeof data.name === "string" ? data.name : runId, status: "running", phases: [] },
        members: new Map(),
      });
      continue;
    }
    const run = runs.get(runId);
    if (!run) continue;
    if (event.type === "tool-workflow/agent-start") {
      const memberSeq = Number(data.seq ?? event.seq);
      run.members.set(memberSeq, {
        label: typeof data.label === "string" ? data.label : String(data.childId ?? "成员"),
        childId: String(data.childId ?? ""),
        phase: typeof data.phase === "string" ? data.phase : null,
        status: "running",
      });
    } else if (event.type === "tool-workflow/agent-end") {
      const member = run.members.get(Number(data.seq));
      if (member) member.status = workflowMemberStatus(data.outcome);
    } else if (event.type === "tool-workflow/run-end") {
      run.view.status = workflowRunStatus(data.stopReason);
    }
  }
  return [...runs.values()].map((run) => {
    const phases = new Map<string, { phase: string | null; members: WorkflowView["phases"][number]["members"] }>();
    for (const member of run.members.values()) {
      const key = member.phase ?? "__missing__";
      const phase = phases.get(key) ?? { phase: member.phase, members: [] };
      phase.members.push({ label: member.label, childId: member.childId, status: member.status });
      phases.set(key, phase);
    }
    return { seq: run.seq, time: run.time, view: { ...run.view, phases: [...phases.values()] } };
  });
}

export function producedPathsFromView(value: unknown) {
  const outer = recordValue(value);
  const view = outer?.for === "call" ? outer.view : value;
  const card = recordValue(view);
  if (!card || (card.card !== "diff" && !(card.card === "generic" && card.kind === "edit"))) return [];
  const locations = Array.isArray(card.locations) ? card.locations : [];
  return locations.map((location) => recordValue(location)?.path).filter((path): path is string => typeof path === "string" && path.trim().length > 0);
}

export function deliverablesFromHistory(entries: DshHistoryEntry[]) {
  const callViews = new Map<string, unknown>();
  const closingAssistantByTurn = new Map<string, { seq: number; time: number }>();
  const pathsByTurn = new Map<string, { seq: number; time: number; paths: string[]; fileDiffs: Record<string, DeliverableFileDiff> }>();
  for (const { event, view } of entries) {
    if ((event.type === "assistant/message" || event.type === "tool/result")
      && event.surfaceOp !== undefined && event.surfaceOp !== "append") continue;
    const message = recordValue(event.data.message);
    const turnValue = event.data.turn ?? message?.turn;
    const turn = turnValue === undefined || turnValue === null ? undefined : String(turnValue);
    if (event.type === "assistant/message" && turn !== undefined) {
      const current = closingAssistantByTurn.get(turn);
      if (!current || event.seq > current.seq) closingAssistantByTurn.set(turn, { seq: event.seq, time: event.time });
    }
    const callId = eventToolCallId(event);
    if (event.type === "tool/call" && callId) {
      callViews.set(callId, view);
      continue;
    }
    if (event.type !== "tool/result" || eventToolResultError(event) || !callId) continue;
    const diff = diffSummaryFromHistoryEntry({ event, view });
    const paths = diff?.diffs.map((item) => item.path) ?? producedPathsFromView(callViews.get(callId));
    if (paths.length === 0) continue;
    const turnKey = turn ?? String(event.seq);
    const current = pathsByTurn.get(turnKey) ?? { seq: event.seq, time: event.time, paths: [], fileDiffs: {} };
    current.seq = Math.max(current.seq, event.seq);
    current.time = event.time;
    for (const path of paths) if (!current.paths.includes(path)) current.paths.push(path);
    if (diff) {
      for (const hunk of diff.diffs) {
        const stats = current.fileDiffs[hunk.path] ?? { added: 0, removed: 0 };
        stats.added += diffLineCount(hunk.newText);
        stats.removed += hunk.oldText === null ? 0 : diffLineCount(hunk.oldText);
        current.fileDiffs[hunk.path] = stats;
      }
    }
    pathsByTurn.set(turnKey, current);
  }
  for (const [turn, current] of pathsByTurn) {
    const closingAssistant = closingAssistantByTurn.get(turn);
    if (closingAssistant && closingAssistant.seq > current.seq) {
      current.seq = closingAssistant.seq;
      current.time = closingAssistant.time;
    }
  }
  return [...pathsByTurn.values()];
}
