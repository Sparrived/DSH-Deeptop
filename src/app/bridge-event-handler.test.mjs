import assert from "node:assert/strict";
import test from "node:test";
import { clearQueuedSessionEvents, routeBridgeEvent } from "./bridge-event-handler.ts";
import { sessionProjectionCache } from "./projection-cache.ts";

function emptyStats() {
  return {
    tokenUsageSource: "none",
    tokenUsageAvailable: false,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextTokens: 0,
    contextLimit: 0,
    cacheHitRate: 0,
    messages: 0,
  };
}

function fixture() {
  let stats = emptyStats();
  let history = [];
  let sessionQueues = {};
  const historyRef = { current: history };
  const apply = (current, update) => typeof update === "function" ? update(current) : update;
  const context = {
    activeSessionRef: { current: "session-1" },
    historyRef,
    contextProjectionRef: { current: false },
    selectedSubagentRef: { current: null },
    subagentRequestRef: { current: 0 },
    setHistory(update) { history = apply(history, update); historyRef.current = history; },
    setSessionStats(update) { stats = apply(stats, update); },
    setTodos() {},
    setModels() {},
    setSessions() {},
    setSubagentSession() {},
    setSessionQueues(update) { sessionQueues = apply(sessionQueues, update); },
    setSessionJobs() {},
    setPermissionSelect() {},
    setPlan() {},
    setPendingApprovals() {},
    setPendingQuestions() {},
    setPetCompletions() {},
    setQuestionAnswersBySession() {},
    setQuestionCustomAnswersBySession() {},
    setSessionIndicators() {},
    setLoading() {},
    setSubagents() {},
    setArchivedSessionIds() {},
    setSelectedSubagentId() {},
    setSubagentLoadingId() {},
    setSubagentPanelOpen() {},
    setGoal() {},
    setNotice() {},
    locale: "zh",
    loadSubagents() {},
    refreshSessionStats() {},
    startNewSession() {},
    onSessionRemoved() {},
    promoteSessionOnMessage() {},
  };
  return { context, stats: () => stats, history: () => history, sessionQueues: () => sessionQueues };
}

function projection(seq, value) {
  return {
    channel: "mux",
    frame: { payload: { type: "session/projection", sessionId: "session-1", key: "tokenUsage", seq, value } },
  };
}

function usageEvent(seq, reasoningTokens) {
  return {
    channel: "mux",
    frame: {
      payload: {
        type: "session/event",
        sessionId: "session-1",
        event: {
          seq,
          time: 1_000 + seq,
          type: "assistant/message",
          data: {
            turn: 1,
            step: 1,
            message: { role: "assistant", content: [{ type: "text", text: "done" }] },
            usage: { inputTokens: 5, outputTokens: 2, reasoningTokens },
          },
        },
      },
    },
  };
}

test("keeps projection totals while filling omitted reasoning from live history", async () => {
  sessionProjectionCache.clear();
  clearQueuedSessionEvents();
  const state = fixture();
  routeBridgeEvent(projection(20, { inputTokens: 100, outputTokens: 20 }), state.context);
  routeBridgeEvent(usageEvent(21, 7), state.context);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(state.stats().tokenUsageSource, "projection");
  assert.equal(state.stats().inputTokens, 100);
  assert.equal(state.stats().outputTokens, 20);
  assert.equal(state.stats().reasoningTokens, 7);
  assert.equal(state.history().length, 1);
  clearQueuedSessionEvents();
  sessionProjectionCache.clear();
});

test("rejects stale projections and preserves an explicit reasoning zero", async () => {
  sessionProjectionCache.clear();
  clearQueuedSessionEvents();
  const state = fixture();
  routeBridgeEvent(projection(20, { inputTokens: 100, outputTokens: 20, reasoningTokens: 0 }), state.context);
  routeBridgeEvent(projection(10, { inputTokens: 1, outputTokens: 1, reasoningTokens: 9 }), state.context);
  routeBridgeEvent(usageEvent(21, 7), state.context);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(state.stats().inputTokens, 100);
  assert.equal(state.stats().outputTokens, 20);
  assert.equal(state.stats().reasoningTokens, 0);
  clearQueuedSessionEvents();
  sessionProjectionCache.clear();
});

function queueFrame(sessionId, items) {
  return { channel: "mux", frame: { payload: { type: "session/queue", sessionId, items } } };
}

test("retains a queue frame for a session that is not active so switching back still shows it", () => {
  sessionProjectionCache.clear();
  clearQueuedSessionEvents();
  const state = fixture();
  const items = [{ id: "m2", placement: "queued", message: { content: [{ type: "text", text: "pending" }] } }];

  routeBridgeEvent(queueFrame("session-2", items), state.context);

  assert.deepEqual(state.sessionQueues()["session-2"], items);
  clearQueuedSessionEvents();
  sessionProjectionCache.clear();
});

test("keeps each session's queue independently and clears one when it drains", () => {
  sessionProjectionCache.clear();
  clearQueuedSessionEvents();
  const state = fixture();
  const active = [{ id: "m1", placement: "queued", message: { content: [{ type: "text", text: "a" }] } }];
  const inactive = [{ id: "m2", placement: "steering", message: { content: [{ type: "text", text: "b" }] } }];

  routeBridgeEvent(queueFrame("session-1", active), state.context);
  routeBridgeEvent(queueFrame("session-2", inactive), state.context);
  routeBridgeEvent(queueFrame("session-1", []), state.context);

  assert.deepEqual(state.sessionQueues(), { "session-1": [], "session-2": inactive });
  clearQueuedSessionEvents();
  sessionProjectionCache.clear();
});
