import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  sendSystemNotification,
  type DshBridgeEvent,
  type DshGoalProjection,
  type DshHistoryEntry,
  type DshJob,
  type DshQuestion,
  type DshQueueItem,
  type DshSessionEvent,
  type DshSessionSummary,
  type DshSubagentCatalog,
} from "../lib/desktop";
import { numberValue, readSessionStats, recordValue, todoItems, todoProjection } from "./model";
import type {
  PendingApproval,
  PendingQuestion,
  SessionStats,
  SubagentSession,
  TodoItem,
} from "./model-types";

type SessionIndicator = "idle" | "running" | "completed" | "error";

type BridgeEventHandlerContext = {
  activeSessionRef: MutableRefObject<string | null>;
  selectedSubagentRef: MutableRefObject<string | null>;
  subagentRequestRef: MutableRefObject<number>;
  setTodos: Dispatch<SetStateAction<TodoItem[] | null>>;
  setHistory: Dispatch<SetStateAction<DshHistoryEntry[]>>;
  setSessionStats: Dispatch<SetStateAction<SessionStats>>;
  setSessions: Dispatch<SetStateAction<DshSessionSummary[]>>;
  setSubagentSession: Dispatch<SetStateAction<SubagentSession | null>>;
  setQueue: Dispatch<SetStateAction<DshQueueItem[]>>;
  setSessionJobs: Dispatch<SetStateAction<Record<string, DshJob[]>>>;
  setPendingApprovals: Dispatch<SetStateAction<Record<string, PendingApproval>>>;
  setPendingQuestions: Dispatch<SetStateAction<Record<string, PendingQuestion>>>;
  setQuestionAnswersBySession: Dispatch<SetStateAction<Record<string, Record<string, string[]>>>>;
  setQuestionCustomAnswersBySession: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  setSessionIndicators: Dispatch<SetStateAction<Record<string, SessionIndicator>>>;
  setSubagents: Dispatch<SetStateAction<DshSubagentCatalog | null>>;
  setArchivedSessionIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedSubagentId: Dispatch<SetStateAction<string | null>>;
  setSubagentLoadingId: Dispatch<SetStateAction<string | null>>;
  setSubagentPanelOpen: Dispatch<SetStateAction<boolean>>;
  setGoal: Dispatch<SetStateAction<DshGoalProjection | null | undefined>>;
  setNotice: (message: string) => void;
  loadSubagents: () => void | Promise<void>;
  startNewSession: () => void;
};

export function routeBridgeEvent(event: DshBridgeEvent, context: BridgeEventHandlerContext) {
  const payload = event.frame.payload;
  const type = payload.type;
  if (event.channel === "mux") {
    routeMuxEvent(event, context);
    return;
  }
  routeHostEvent(event, context);
}

function routeMuxEvent(event: DshBridgeEvent, context: BridgeEventHandlerContext) {
  const {
    activeSessionRef,
    selectedSubagentRef,
    setTodos,
    setHistory,
    setSessionStats,
    setSessions,
    setSubagentSession,
    setQueue,
    setSessionJobs,
    setPendingApprovals,
    setPendingQuestions,
    setQuestionAnswersBySession,
    setQuestionCustomAnswersBySession,
    setGoal,
  } = context;
  const payload = event.frame.payload;
  const type = payload.type;

  if (type === "session/event") {
    const sessionId = String(payload.sessionId ?? "");
    const nextEvent = payload.event as DshSessionEvent | undefined;
    if (!nextEvent) return;
    if (sessionId === activeSessionRef.current) {
      if (nextEvent.type === "turn/start") setTodos(null);
      if (nextEvent.type === "todo/write") {
        const nextTodos = todoItems(nextEvent.data.todos);
        if (nextTodos !== undefined) setTodos(nextTodos);
      }
      setHistory((current) => {
        const next = current.some((entry) => entry.event.seq === nextEvent.seq)
          ? current
          : [...current, { event: nextEvent, view: payload.view }];
        if (next.length !== current.length) {
          setSessionStats((currentStats) => {
            const nextStats = readSessionStats(next);
            return nextStats.contextLimit > 0 ? nextStats : { ...nextStats, contextLimit: currentStats.contextLimit };
          });
        }
        return next;
      });
      if (nextEvent.type === "user/message") {
        setSessions((current) => current.map((session) => session.sessionId === sessionId
          ? { ...session, blank: false, updatedAt: nextEvent.time }
          : session));
      }
    }
    if (sessionId === selectedSubagentRef.current) {
      setSubagentSession((current) => {
        if (!current || current.address.childSessionId !== sessionId || current.history.some((entry) => entry.event.seq === nextEvent.seq)) return current;
        return { ...current, history: [...current.history, { event: nextEvent, view: payload.view }] };
      });
    }
    return;
  }

  if (type === "session/projection") {
    const sessionId = String(payload.sessionId ?? "");
    const key = String(payload.key ?? "");
    if (sessionId === activeSessionRef.current && (key === "contextPressure" || key === "tokenUsage")) {
      const projection = recordValue(payload.value);
      if (key === "contextPressure" && projection) {
        setSessionStats((current) => ({
          ...current,
          contextTokens: numberValue(projection.projectedTokens ?? projection.pressureTokens) ?? current.contextTokens,
          contextLimit: numberValue(projection.contextWindow) ?? current.contextLimit,
        }));
      }
      if (key === "tokenUsage" && projection) {
        const uncachedInput = numberValue(projection.uncachedInputTokens) ?? 0;
        const cacheRead = numberValue(projection.cacheReadTokens) ?? 0;
        const cacheWrite = numberValue(projection.cacheWriteTokens) ?? 0;
        setSessionStats((current) => ({
          ...current,
          inputTokens: uncachedInput + cacheRead + cacheWrite,
          outputTokens: numberValue(projection.outputTokens) ?? current.outputTokens,
          cacheHitRate: cacheRead + cacheWrite > 0 ? Math.min(100, (cacheRead / (uncachedInput + cacheRead + cacheWrite)) * 100) : current.cacheHitRate,
          totalTokens: uncachedInput + cacheRead + cacheWrite + (numberValue(projection.outputTokens) ?? current.outputTokens),
        }));
      }
      return;
    }
    if (key === "todos" && sessionId === activeSessionRef.current) {
      const nextTodos = todoProjection(payload.value);
      if (nextTodos !== undefined) setTodos(nextTodos);
      return;
    }
    if (key === "goal" && sessionId === activeSessionRef.current) {
      setGoal((payload.value as DshGoalProjection | null | undefined) ?? null);
      return;
    }
    if (key !== "title") return;
    setSessions((current) => current.map((session) => session.sessionId === sessionId
      ? {
        ...session,
        projections: {
          asOfSeq: Number(payload.seq ?? session.projections?.asOfSeq ?? 0),
          values: { ...session.projections?.values, title: payload.value },
        },
      }
      : session));
    return;
  }

  if (type === "session/queue") {
    if (String(payload.sessionId) === activeSessionRef.current) setQueue((payload.items as DshQueueItem[]) ?? []);
    return;
  }
  if (type === "session/jobs") {
    const sessionId = String(payload.sessionId ?? "");
    if (sessionId) setSessionJobs((current) => ({ ...current, [sessionId]: (payload.jobs as DshJob[]) ?? [] }));
    return;
  }
  if (type === "approval/requested") {
    const sessionId = String(payload.sessionId ?? "");
    if (!sessionId || !event.frame.rpcId) return;
    const toolName = String(payload.toolName ?? "tool");
    setPendingApprovals((current) => ({
      ...current,
      [sessionId]: {
        rpcId: event.frame.rpcId!,
        sessionId,
        approvalId: String(payload.approvalId ?? ""),
        toolName,
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
      },
    }));
    void sendSystemNotification("需要审批", `会话 ${sessionId.slice(-8)} 请求允许执行 ${toolName}`);
    return;
  }
  if (type === "approval/resolved") {
    const sessionId = String(payload.sessionId ?? "");
    setPendingApprovals((current) => {
      if (!sessionId || !(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    return;
  }
  if (type === "question/requested") {
    const sessionId = String(payload.sessionId ?? "");
    if (!sessionId || !event.frame.rpcId) return;
    const questions = Array.isArray(payload.questions) ? payload.questions as DshQuestion[] : [];
    setPendingQuestions((current) => ({
      ...current,
      [sessionId]: {
        rpcId: event.frame.rpcId!,
        sessionId,
        questions,
      },
    }));
    setQuestionAnswersBySession((current) => ({ ...current, [sessionId]: {} }));
    setQuestionCustomAnswersBySession((current) => ({ ...current, [sessionId]: {} }));
    void sendSystemNotification("需要回答问题", `会话 ${sessionId.slice(-8)} 有 ${questions.length} 个问题待处理`);
    return;
  }
  if (type === "question/resolved") {
    const sessionId = String(payload.sessionId ?? "");
    setPendingQuestions((current) => {
      if (!sessionId || !(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setQuestionAnswersBySession((current) => {
      if (!sessionId || !(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setQuestionCustomAnswersBySession((current) => {
      if (!sessionId || !(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }
}

function routeHostEvent(event: DshBridgeEvent, context: BridgeEventHandlerContext) {
  const {
    activeSessionRef,
    selectedSubagentRef,
    subagentRequestRef,
    setSessions,
    setSessionIndicators,
    setSubagents,
    setArchivedSessionIds,
    setSelectedSubagentId,
    setSubagentLoadingId,
    setSubagentSession,
    setSubagentPanelOpen,
    setNotice,
    loadSubagents,
    startNewSession,
  } = context;
  const payload = event.frame.payload;
  const type = payload.type;

  if (type === "host/session-status") {
    const sessionId = String(payload.sessionId ?? "");
    const running = Boolean(payload.running);
    setSessions((current) => current.map((session) => session.sessionId === sessionId ? { ...session, running } : session));
    setSessionIndicators((current) => ({ ...current, [sessionId]: running ? "running" : "completed" }));
    setSubagents((current) => current ? {
      ...current,
      entries: current.entries.map((entry) => entry.kind === "child" && entry.id === sessionId
        ? { ...entry, activity: running ? "running" : "inactive" }
        : entry),
    } : current);
    return;
  }
  if (type === "host/session-added") {
    const sessionId = String(payload.sessionId ?? "");
    setSessions((current) => current.some((session) => session.sessionId === sessionId)
      ? current
      : [...current, {
        sessionId,
        updatedAt: Date.now(),
        running: false,
        blank: Boolean(payload.blank),
        parentSessionId: typeof payload.parentSessionId === "string" ? payload.parentSessionId : undefined,
        origin: payload.origin === "subagent" ? "subagent" : undefined,
        cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
        agentPreset: typeof payload.agentPreset === "string" ? payload.agentPreset : undefined,
      }]);
    if (String(payload.parentSessionId ?? "") === activeSessionRef.current || payload.origin === "subagent") void loadSubagents();
    return;
  }
  if (type === "host/archived-sessions-changed") {
    const nextArchivedIds = new Set((Array.isArray(payload.archivedSessionIds) ? payload.archivedSessionIds : []).map(String));
    setArchivedSessionIds(nextArchivedIds);
    if (activeSessionRef.current && nextArchivedIds.has(activeSessionRef.current)) startNewSession();
    return;
  }
  if (type === "host/session-removed") {
    const sessionId = String(payload.sessionId ?? "");
    setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
    setSubagents((current) => current ? { ...current, entries: current.entries.filter((entry) => entry.id !== sessionId) } : current);
    if (sessionId === selectedSubagentRef.current) {
      subagentRequestRef.current += 1;
      setSelectedSubagentId(null);
      setSubagentLoadingId(null);
      setSubagentSession(null);
      setSubagentPanelOpen(false);
    }
    if (sessionId === activeSessionRef.current) startNewSession();
    return;
  }
  if (type === "host/agent-error") {
    const sessionId = String(payload.sessionId ?? "");
    setSessionIndicators((current) => ({ ...current, [sessionId]: "error" }));
    if (sessionId === activeSessionRef.current) setNotice(String(payload.message ?? "Agent 运行失败"));
  }
}
