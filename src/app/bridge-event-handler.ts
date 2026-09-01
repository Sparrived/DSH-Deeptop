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
  type DshSessionModels,
  type DshSessionSummary,
  type DshSubagentCatalog,
} from "../lib/desktop.ts";
import { isInjectedMessage, numberValue, readSessionStats, recordValue } from "./message-model.ts";
import { applyTodoSnapshot } from "./workflow-model.ts";
import { imageLimitsFromProjection } from "./ui-model.ts";
import { markSessionError,
  removeSessionRecordEntry,
  updateSessionIndicator,
  updateSessionIndicatorForTurnEnd,
  updateSessionRunning,
  type SessionIndicator,
} from "./session-runtime-state.ts";
import { t, type UiLocale } from "./i18n.ts";
import { sessionProjectionCache } from "./projection-cache.ts";
import { historyPageCache } from "./history-page-cache.ts";
import { mergeDisplayHistory } from "./display-history.ts";
import type {
  PendingApproval,
  PendingQuestion,
  SessionStats,
  SubagentSession,
  TodoItem,
} from "./model-types.ts";
import type { PetCompletionSignal } from "./pet-attention-model.ts";

type BridgeEventHandlerContext = {
  activeSessionRef: MutableRefObject<string | null>;
  historyRef: MutableRefObject<DshHistoryEntry[]>;
  contextProjectionRef: MutableRefObject<boolean>;
  selectedSubagentRef: MutableRefObject<string | null>;
  subagentRequestRef: MutableRefObject<number>;
  setTodos: Dispatch<SetStateAction<TodoItem[] | null>>;
  setHistory: Dispatch<SetStateAction<DshHistoryEntry[]>>;
  setSessionStats: Dispatch<SetStateAction<SessionStats>>;
  setModels: Dispatch<SetStateAction<DshSessionModels | null>>;
  setSessions: Dispatch<SetStateAction<DshSessionSummary[]>>;
  setSubagentSession: Dispatch<SetStateAction<SubagentSession | null>>;
  setQueue: Dispatch<SetStateAction<DshQueueItem[]>>;
  setSessionJobs: Dispatch<SetStateAction<Record<string, DshJob[]>>>;
  setPermissionSelect: Dispatch<SetStateAction<DshPermissionSelect | null>>;
  setPlan: Dispatch<SetStateAction<DshPlanProjection | null>>;
  setPendingApprovals: Dispatch<SetStateAction<Record<string, PendingApproval>>>;
  setPendingQuestions: Dispatch<SetStateAction<Record<string, PendingQuestion>>>;
  setPetCompletions: Dispatch<SetStateAction<Record<string, PetCompletionSignal>>>;
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
  locale: UiLocale;
  loadSubagents: () => void | Promise<void>;
  refreshSessionStats: (sessionId?: string) => void | Promise<void>;
  startNewSession: () => void;
  onSessionRemoved: (sessionId: string) => void;
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
  const additions = batch
    .filter((item) => item.sessionId === activeSessionId)
    .map((item): DshHistoryEntry => ({ event: item.event, view: item.view }));
  if (!activeSessionId || additions.length === 0) return;
  // Keep the owner-aware ref authoritative while an initial history request is
  // in flight, and keep React state updaters pure under StrictMode replay.
  const next = mergeDisplayHistory(context.historyRef.current, additions);
  if (next === context.historyRef.current || context.activeSessionRef.current !== activeSessionId) return;
  context.historyRef.current = next;
  context.setHistory(next);
  const statsDirty = additions.some(({ event }) => {
    const chunk = recordValue(event.data.chunk);
    return event.type === "assistant/message"
      || event.type === "user/message"
      || event.type === "request/context"
      || recordValue(event.data.usage) !== undefined
      || recordValue(event.data.tokenUsage) !== undefined
      || recordValue(chunk?.usage) !== undefined;
  });
  if (!statsDirty) return;
  const projectedValues = Object.fromEntries(
    sessionProjectionCache.snapshot(activeSessionId).map((entry) => [entry.key, entry.value]),
  );
  const nextStats = readSessionStats(next, { values: projectedValues });
  context.setSessionStats((currentStats) => {
    if (context.activeSessionRef.current !== activeSessionId) return currentStats;
    const hasContextValue = nextStats.contextTokensAvailable === true;
    return {
      ...currentStats,
      ...nextStats,
      // History events do not carry contextPressure. A live projection must
      // never be replaced by cumulative history usage.
      contextTokens: context.contextProjectionRef.current
        ? currentStats.contextTokens
        : hasContextValue ? nextStats.contextTokens : currentStats.contextTokens,
      contextTokensAvailable: context.contextProjectionRef.current
        ? currentStats.contextTokensAvailable
        : hasContextValue || currentStats.contextTokensAvailable === true,
      contextLimit: nextStats.contextLimit > 0 ? nextStats.contextLimit : currentStats.contextLimit,
      messages: nextStats.messages > 0 ? nextStats.messages : currentStats.messages,
    };
  });
}

function queueSessionEvent(event: DshSessionEvent, view: unknown, sessionId: string, context: BridgeEventHandlerContext) {
  (queuedSessionEvents ??= []).push({ sessionId, event, view });
  if (queuedSessionFlushTimer === undefined) {
    queuedSessionFlushTimer = setTimeout(() => flushQueuedSessionEvents(context), HISTORY_FLUSH_WINDOW_MS);
  }
}

/** Drop pending stream events when the owning App instance is unmounted. */
export function clearQueuedSessionEvents(): void {
  if (queuedSessionFlushTimer !== undefined) {
    clearTimeout(queuedSessionFlushTimer);
    queuedSessionFlushTimer = undefined;
  }
  queuedSessionEvents = null;
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
    setModels,
    setSessions,
    setSessionIndicators,
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
    locale,
  } = context;
  const payload = event.frame.payload;
  const type = payload.type;

  if (type === "session/event") {
    const sessionId = String(payload.sessionId ?? "");
    const nextEvent = payload.event as DshSessionEvent | undefined;
    if (!nextEvent) return;
    if (nextEvent.type === "turn/start") {
      setSessionIndicators((current) => updateSessionIndicator(current, sessionId, true));
    }
    if (nextEvent.type === "turn/end") {
      setSessionIndicators((current) => updateSessionIndicatorForTurnEnd(current, sessionId, nextEvent.data.reason));
    }
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
        if (!current || current.address.childSessionId !== sessionId) return current;
        const history = mergeDisplayHistory(current.history, [{ event: nextEvent, view: payload.view }]);
        return history === current.history ? current : { ...current, history };
      });
    }
    return;
  }

  if (type === "session/projection") {
    const sessionId = String(payload.sessionId ?? "");
    const key = String(payload.key ?? "");
    const projectionKey = key.replace(/[\s_-]+/g, "").toLocaleLowerCase();
    // 通用投影缓存：所有会话（不只当前活动会话）的最新投影都登记，
    // 切换会话时由 App 端按 seq 水位叠加，避免“切换前到达但历史尚未折叠”
    // 的投影丢失，也保证其它会话的投影不会污染当前 UI。
    let accepted = true;
    if (sessionId && key) {
      const seq = typeof payload.seq === "number" && Number.isFinite(payload.seq)
        ? payload.seq
        : typeof payload.seq === "string" && Number.isFinite(Number(payload.seq))
          ? Number(payload.seq)
          : 0;
      accepted = sessionProjectionCache.put(sessionId, key, payload.value, seq);
    }
    if (!accepted) return;
    if (sessionId === activeSessionRef.current && (projectionKey === "contextpressure" || projectionKey === "tokenusage" || projectionKey === "usage" || projectionKey === "tokens")) {
      if (projectionKey === "contextpressure" && recordValue(payload.value)) contextProjectionRef.current = true;
      const projectedValues = Object.fromEntries(
        sessionProjectionCache.snapshot(sessionId).map((entry) => [entry.key, entry.value]),
      );
      const nextStats = readSessionStats(context.historyRef.current, { values: projectedValues });
      setSessionStats((current) => activeSessionRef.current === sessionId
        ? { ...current, ...nextStats, contextLimit: nextStats.contextLimit > 0 ? nextStats.contextLimit : current.contextLimit }
        : current);
      return;
    }
    if (projectionKey === "imagelimits" && sessionId === activeSessionRef.current) {
      const imageLimits = imageLimitsFromProjection(payload.value);
      if (imageLimits) setModels((current) => current ? { ...current, imageLimits } : current);
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
          ttftSteps: numberValue(projection.ttftSteps),
          decodeMs: numberValue(projection.decodeMs),
          decodeTokens: numberValue(projection.decodeTokens),
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
    void sendSystemNotification(t("notice.approvalRequired", locale), t("notice.approvalRequestedBody", locale, { session: sessionId.slice(-8), tool: toolName }), sessionId);
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
    void sendSystemNotification(t("notice.questionRequired", locale), t("notice.questionRequestedBody", locale, { session: sessionId.slice(-8), count: questions.length }), sessionId);
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
    setSessionJobs,
    setLoading,
    setSubagents,
    setArchivedSessionIds,
    setSelectedSubagentId,
    setSubagentLoadingId,
    setSubagentSession,
    setSubagentPanelOpen,
    setPendingApprovals,
    setPendingQuestions,
    setPetCompletions,
    setQuestionAnswersBySession,
    setQuestionCustomAnswersBySession,
    setNotice,
    locale,
    loadSubagents,
    refreshSessionStats,
    startNewSession,
    onSessionRemoved,
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
    sessionProjectionCache.removeSession(sessionId);
    historyPageCache.removeSession(sessionId);
    onSessionRemoved(sessionId);
    setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
    setSessionIndicators((current) => removeSessionRecordEntry(current, sessionId));
    setSessionJobs((current) => removeSessionRecordEntry(current, sessionId));
    setPendingApprovals((current) => removeSessionRecordEntry(current, sessionId));
    setPendingQuestions((current) => removeSessionRecordEntry(current, sessionId));
    setQuestionAnswersBySession((current) => removeSessionRecordEntry(current, sessionId));
    setQuestionCustomAnswersBySession((current) => removeSessionRecordEntry(current, sessionId));
    setPetCompletions((current) => removeSessionRecordEntry(current, sessionId));
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
      setNotice(typeof payload.message === "string" && payload.message.trim() ? payload.message : t("notice.modelCallFailedReset", locale));
      void refreshSessionStats(sessionId);
    }
    return;
  }
}
