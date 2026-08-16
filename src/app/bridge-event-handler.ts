import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  sendSystemNotification,
  type DshBridgeEvent,
  type DshGoalProjection,
  type DshHistoryEntry,
  type DshJob,
  type DshPermissionSelect,
  type DshPlanProjection,
  type DshQuestion,
  type DshQueueItem,
  type DshSessionStatsProjection,
  type DshSessionEvent,
  type DshSessionSummary,
  type DshSubagentCatalog,
} from "../lib/desktop";
import { applyTodoSnapshot, isInjectedMessage, numberValue, readSessionStats, recordValue } from "./model";
import {
  markSessionError,
  removeSessionRecordEntry,
  updateSessionIndicator,
  updateSessionRunning,
  type SessionIndicator,
} from "./session-runtime-state";
import type {
  PendingApproval,
  PendingQuestion,
  SessionStats,
  SubagentSession,
  TodoItem,
} from "./model-types";

function eventHasUsage(event: DshSessionEvent) {
  const message = recordValue(event.data.message);
  const chunk = recordValue(event.data.chunk);
  return Boolean(
    recordValue(event.data.usage)
    ?? recordValue(event.data.tokenUsage)
    ?? recordValue(chunk?.usage)
    ?? recordValue(message?.usage),
  );
}

type BridgeEventHandlerContext = {
  activeSessionRef: MutableRefObject<string | null>;
  contextProjectionRef: MutableRefObject<boolean>;
  selectedSubagentRef: MutableRefObject<string | null>;
  subagentRequestRef: MutableRefObject<number>;
  setTodos: Dispatch<SetStateAction<TodoItem[] | null>>;
  setHistory: Dispatch<SetStateAction<DshHistoryEntry[]>>;
  setSessionStats: Dispatch<SetStateAction<SessionStats>>;
  setSessions: Dispatch<SetStateAction<DshSessionSummary[]>>;
  setSubagentSession: Dispatch<SetStateAction<SubagentSession | null>>;
  setQueue: Dispatch<SetStateAction<DshQueueItem[]>>;
  setSessionJobs: Dispatch<SetStateAction<Record<string, DshJob[]>>>;
  setPermissionSelect: Dispatch<SetStateAction<DshPermissionSelect | null>>;
  setPlan: Dispatch<SetStateAction<DshPlanProjection | null>>;
  setPendingApprovals: Dispatch<SetStateAction<Record<string, PendingApproval>>>;
  setPendingQuestions: Dispatch<SetStateAction<Record<string, PendingQuestion>>>;
  setQuestionAnswersBySession: Dispatch<SetStateAction<Record<string, Record<string, string[]>>>>;
  setQuestionCustomAnswersBySession: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  setSessionIndicators: Dispatch<SetStateAction<Record<string, SessionIndicator>>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setSubagents: Dispatch<SetStateAction<DshSubagentCatalog | null>>;
  setArchivedSessionIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedSubagentId: Dispatch<SetStateAction<string | null>>;
  setSubagentLoadingId: Dispatch<SetStateAction<string | null>>;
  setSubagentPanelOpen: Dispatch<SetStateAction<boolean>>;
  setGoal: Dispatch<SetStateAction<DshGoalProjection | null | undefined>>;
  setNotice: (message: string) => void;
  loadSubagents: () => void | Promise<void>;
  refreshSessionStats: (sessionId?: string) => void | Promise<void>;
  startNewSession: () => void;
  promoteSessionOnMessage: (sessionId: string) => void | Promise<void>;
};

// Token chunks (`assistant/chunk`) can arrive several times per animation frame
// while a thinking/text stream runs. Every event used to trigger a full
// `setHistory` -> `transcriptFromHistory` -> transcript re-render synchronously,
// which starves the window when content refreshes quickly (notably the "Think"
// reasoning block). Coalesce session events into a single history update per
// ~frame so the transcript recomputes at most once per screen refresh.
const HISTORY_FLUSH_WINDOW_MS = 16;

type QueuedSessionEvent = {
  sessionId: string;
  event: DshSessionEvent;
  view: unknown;
};

let queuedSessionEvents: QueuedSessionEvent[] | null = null;
let queuedSessionFlushTimer: ReturnType<typeof setTimeout> | undefined;

function flushQueuedSessionEvents(context: BridgeEventHandlerContext) {
  queuedSessionFlushTimer = undefined;
  const batch = queuedSessionEvents;
  queuedSessionEvents = null;
  if (!batch || batch.length === 0) return;
  const activeSessionId = context.activeSessionRef.current;
  context.setHistory((current) => {
    const known = new Set<number>();
    for (const entry of current) known.add(entry.event.seq);
    const additions: DshHistoryEntry[] = [];
    for (const item of batch) {
      // Only append events that still belong to the active session (a session
      // switch may have happened while the batch was queued) and that are not
      // already present (a reload may have included them).
      if (item.sessionId !== activeSessionId || known.has(item.event.seq)) continue;
      known.add(item.event.seq);
      additions.push({ event: item.event, view: item.view });
    }
    if (additions.length === 0) return current;
    const next = [...current, ...additions];
    const nextStats = readSessionStats(next);
    context.setSessionStats((currentStats) => {
      const hasUsageInBatch = batch.some((item) => eventHasUsage(item.event));
      return {
        ...currentStats,
        ...nextStats,
        inputTokens: nextStats.inputTokens > 0 ? nextStats.inputTokens : currentStats.inputTokens,
        outputTokens: nextStats.outputTokens > 0 ? nextStats.outputTokens : currentStats.outputTokens,
        totalTokens: nextStats.totalTokens > 0 ? nextStats.totalTokens : currentStats.totalTokens,
        // Keep the latest projected context value while the stream advances;
        // the history scan is only a fallback for runtimes that do not publish
        // contextPressure frames.
        contextTokens: (!context.contextProjectionRef.current || hasUsageInBatch) && nextStats.contextTokens > 0
          ? nextStats.contextTokens
          : currentStats.contextTokens,
        contextLimit: nextStats.contextLimit > 0 ? nextStats.contextLimit : currentStats.contextLimit,
        messages: nextStats.messages > 0 ? nextStats.messages : currentStats.messages,
      };
    });
    return next;
  });
}

function queueSessionEvent(event: DshSessionEvent, view: unknown, sessionId: string, context: BridgeEventHandlerContext) {
  (queuedSessionEvents ??= []).push({ sessionId, event, view });
  if (queuedSessionFlushTimer === undefined) {
    queuedSessionFlushTimer = setTimeout(() => flushQueuedSessionEvents(context), HISTORY_FLUSH_WINDOW_MS);
  }
}

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
    contextProjectionRef,
    selectedSubagentRef,
    setTodos,
    setSessionStats,
    setSessions,
    setSubagentSession,
    setQueue,
    setSessionJobs,
    setPermissionSelect,
    setPlan,
    setPendingApprovals,
    setPendingQuestions,
    setQuestionAnswersBySession,
    setQuestionCustomAnswersBySession,
    setGoal,
    promoteSessionOnMessage,
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
        setTodos((current) => applyTodoSnapshot(current, nextEvent.data.todos, nextEvent.time) ?? current);
      }
      queueSessionEvent(nextEvent, payload.view, sessionId, context);
    }
    if (nextEvent.type === "user/message") {
      setSessions((current) => current.map((session) => session.sessionId === sessionId
        ? { ...session, blank: false, updatedAt: nextEvent.time }
        : session));
      if (!isInjectedMessage(nextEvent)) void promoteSessionOnMessage(sessionId);
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
    const projectionKey = key.replace(/[\s_-]+/g, "").toLocaleLowerCase();
    if (sessionId === activeSessionRef.current && (projectionKey === "contextpressure" || projectionKey === "tokenusage" || projectionKey === "usage" || projectionKey === "tokens")) {
      const projection = recordValue(payload.value);
      if (projectionKey === "contextpressure" && projection) {
        contextProjectionRef.current = true;
        setSessionStats((current) => ({
          ...current,
          contextTokens: numberValue(projection.projectedTokens ?? projection.pressureTokens) ?? current.contextTokens,
          contextLimit: numberValue(projection.contextWindow) ?? current.contextLimit,
        }));
      }
      if (["tokenusage", "usage", "tokens"].includes(projectionKey) && projection) {
        const uncachedInput = numberValue(projection.uncachedInputTokens ?? projection.uncached_input_tokens);
        const cacheRead = numberValue(projection.cacheReadTokens ?? projection.cacheRead ?? projection.cache_read ?? projection.cachedInputTokens ?? projection.cached_input_tokens);
        const cacheWrite = numberValue(projection.cacheWriteTokens ?? projection.cacheWrite ?? projection.cache_write ?? projection.cachedInputTokensCreation ?? projection.cached_input_tokens_creation);
        const projectedInput = numberValue(projection.inputTokens ?? projection.input_tokens);
        const inputTokens = projectedInput ?? (uncachedInput === undefined ? undefined : uncachedInput + (cacheRead ?? 0) + (cacheWrite ?? 0));
        const outputTokens = numberValue(projection.outputTokens ?? projection.output_tokens);
        const projectedContext = numberValue(projection.projectedTokens ?? projection.contextTokens ?? projection.context_tokens);
        setSessionStats((current) => ({
          ...current,
          inputTokens: inputTokens ?? current.inputTokens,
          outputTokens: outputTokens ?? current.outputTokens,
          cacheHitRate: cacheRead !== undefined || cacheWrite !== undefined
            ? Math.min(100, ((cacheRead ?? 0) / ((uncachedInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0))) * 100)
            : current.cacheHitRate,
          totalTokens: (inputTokens ?? current.inputTokens) + (outputTokens ?? current.outputTokens),
          contextTokens: projectedContext ?? current.contextTokens,
        }));
      }
      return;
    }
    if (projectionKey === "sessionstats" && sessionId === activeSessionRef.current) {
      const projection = recordValue(payload.value) as unknown as DshSessionStatsProjection | null;
      if (projection) {
        setSessionStats((current) => ({
          ...current,
          turns: numberValue(projection.turns),
          steps: numberValue(projection.steps),
          llmMs: numberValue(projection.llmMs),
          toolMs: numberValue(projection.toolMs),
          ttftMs: numberValue(projection.ttftMs),
          decodeMs: numberValue(projection.decodeMs),
        }));
      }
      return;
    }
    if (key === "permissions" && sessionId === activeSessionRef.current) {
      setPermissionSelect((payload.value as DshPermissionSelect | null | undefined) ?? null);
      return;
    }
    if (key === "plan" && sessionId === activeSessionRef.current) {
      setPlan((payload.value as DshPlanProjection | null | undefined) ?? null);
      return;
    }
    if (key === "todos" && sessionId === activeSessionRef.current) {
      const nextTodos = payload.value === null ? null : applyTodoSnapshot(undefined, payload.value);
      if (nextTodos !== undefined || nextTodos === null) {
        setTodos((current) => nextTodos === null ? null : applyTodoSnapshot(current, nextTodos) ?? current);
      }
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
    void sendSystemNotification("需要审批", `会话 ${sessionId.slice(-8)} 请求允许执行 ${toolName}`, sessionId);
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
    void sendSystemNotification("需要回答问题", `会话 ${sessionId.slice(-8)} 有 ${questions.length} 个问题待处理`, sessionId);
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
    setLoading,
    setSubagents,
    setArchivedSessionIds,
    setSelectedSubagentId,
    setSubagentLoadingId,
    setSubagentSession,
    setSubagentPanelOpen,
    setPendingApprovals,
    setPendingQuestions,
    setQuestionAnswersBySession,
    setQuestionCustomAnswersBySession,
    setNotice,
    loadSubagents,
    refreshSessionStats,
    startNewSession,
  } = context;
  const payload = event.frame.payload;
  const type = payload.type;

  if (type === "host/session-status") {
    const sessionId = String(payload.sessionId ?? "");
    const running = Boolean(payload.running);
    setSessions((current) => updateSessionRunning(current, sessionId, running));
    setSessionIndicators((current) => updateSessionIndicator(current, sessionId, running));
    if (!running && sessionId === activeSessionRef.current) void refreshSessionStats(sessionId);
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
    if (!sessionId) return;
    setSessions((current) => updateSessionRunning(current, sessionId, false));
    setSessionIndicators((current) => markSessionError(current, sessionId));
    setPendingApprovals((current) => removeSessionRecordEntry(current, sessionId));
    setPendingQuestions((current) => removeSessionRecordEntry(current, sessionId));
    setQuestionAnswersBySession((current) => removeSessionRecordEntry(current, sessionId));
    setQuestionCustomAnswersBySession((current) => removeSessionRecordEntry(current, sessionId));
    setSubagents((current) => current ? {
      ...current,
      entries: current.entries.map((entry) => entry.kind === "child" && entry.id === sessionId
        ? { ...entry, activity: "inactive" }
        : entry),
    } : current);
    if (sessionId === activeSessionRef.current) {
      setLoading(false);
      setNotice(typeof payload.message === "string" && payload.message.trim() ? payload.message : "模型调用失败，已重置会话状态");
      void refreshSessionStats(sessionId);
    }
    return;
  }
}
