import type { DshHistoryEntry } from "../lib/desktop";
import type {
  SessionActivitySignal,
  SessionDashboardData,
  SessionStats,
  SessionTurnPoint,
} from "./model-types";
import { eventToolResultError, isInjectedMessage, numberValue, recordValue } from "./message-model.ts";
import { sessionElapsedMs } from "./session-events.ts";
import { tokenUsageDashboard } from "./token-usage.ts";
import { t, type UiLocale } from "./i18n.ts";
import { displayEventCount } from "./display-history.ts";

type SessionDashboardOptions = {
  elapsedMs?: number;
  now?: number;
  running?: boolean;
};

type TurnBuilder = Omit<SessionTurnPoint, "durationMs" | "totalTokens"> & {
  startedAt?: number;
  endedAt?: number;
  lastEventAt: number;
  totalTokens: number;
};

function eventTurn(entry: DshHistoryEntry) {
  const message = recordValue(entry.event.data.message);
  return numberValue(entry.event.data.turn) ?? numberValue(message?.turn);
}

function validTime(value: number) {
  return Number.isFinite(value) ? value : undefined;
}

function emptyTurn(key: string, label: string, time: number, turn?: number): TurnBuilder {
  return {
    key,
    label,
    time,
    ...(turn === undefined ? {} : { turn }),
    userMessages: 0,
    assistantMessages: 0,
    steps: 0,
    toolCalls: 0,
    toolFailures: 0,
    totalTokens: 0,
    signals: [],
    lastEventAt: time,
  };
}

function pushSignal(turn: TurnBuilder, signal: SessionActivitySignal) {
  turn.signals.push(signal);
}

/** Aggregate session lifecycle, activity, and token projections for the dashboard. */
export function sessionDashboard(
  entries: DshHistoryEntry[],
  stats: SessionStats,
  locale: UiLocale = "zh",
  options: SessionDashboardOptions = {},
): SessionDashboardData {
  const ordered = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  const token = tokenUsageDashboard(ordered, stats, locale);
  const turns = new Map<string, TurnBuilder>();
  const turnKeyByAssistantSeq = new Map<string, string>();
  let currentTurnKey: string | undefined;
  let fallbackTurn = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let toolFailures = 0;
  let loadedSteps = 0;
  let firstEventTime: number | undefined;
  let lastEventTime: number | undefined;

  const ensureTurn = (entry: DshHistoryEntry, explicitTurn?: number) => {
    const time = validTime(entry.event.time) ?? 0;
    if (explicitTurn !== undefined) currentTurnKey = `turn:${explicitTurn}`;
    if (!currentTurnKey) {
      fallbackTurn += 1;
      currentTurnKey = `fallback:${fallbackTurn}`;
    }
    const existing = turns.get(currentTurnKey);
    if (existing) {
      existing.time = Math.min(existing.time, time);
      existing.lastEventAt = Math.max(existing.lastEventAt, time);
      return existing;
    }
    const index = explicitTurn ?? turns.size + 1;
    const created = emptyTurn(
      currentTurnKey,
      t("sessionDashboard.turn.label", locale, { turn: index }),
      time,
      explicitTurn,
    );
    turns.set(currentTurnKey, created);
    return created;
  };

  for (const entry of ordered) {
    const { event } = entry;
    const time = validTime(event.time);
    if (time !== undefined) {
      firstEventTime = firstEventTime === undefined ? time : Math.min(firstEventTime, time);
      lastEventTime = lastEventTime === undefined ? time : Math.max(lastEventTime, time);
    }
    const turnNumber = eventTurn(entry);
    if (event.type === "turn/start") {
      if (turnNumber === undefined) {
        fallbackTurn += 1;
        currentTurnKey = `fallback:${fallbackTurn}`;
      } else {
        currentTurnKey = `turn:${turnNumber}`;
      }
      const turn = ensureTurn(entry, turnNumber);
      turn.startedAt = time;
      continue;
    }

    const contributesToTurn = event.type === "user/message"
      || event.type === "assistant/message"
      || event.type === "step/end"
      || event.type === "tool/call"
      || event.type === "tool/result"
      || event.type === "turn/end";
    if (!contributesToTurn) continue;
    const turn = ensureTurn(entry, turnNumber);

    if (event.type === "user/message" && !isInjectedMessage(event)) {
      userMessages += 1;
      turn.userMessages += 1;
      pushSignal(turn, "user");
    } else if (event.type === "assistant/message") {
      assistantMessages += 1;
      turn.assistantMessages += 1;
      turnKeyByAssistantSeq.set(String(event.seq), turn.key);
      pushSignal(turn, "assistant");
    } else if (event.type === "step/end") {
      loadedSteps += 1;
      turn.steps += 1;
    } else if (event.type === "tool/call") {
      toolCalls += 1;
      turn.toolCalls += 1;
      pushSignal(turn, "tool");
    } else if (event.type === "tool/result") {
      toolResults += 1;
      if (eventToolResultError(event)) {
        toolFailures += 1;
        turn.toolFailures += 1;
        pushSignal(turn, "error");
      }
    } else if (event.type === "turn/end") {
      turn.endedAt = time;
      currentTurnKey = undefined;
    }
  }

  for (const point of token.points) {
    const turnKey = turnKeyByAssistantSeq.get(point.key);
    if (turnKey) turns.get(turnKey)!.totalTokens += point.totalTokens;
  }

  const now = options.running && options.now !== undefined && Number.isFinite(options.now)
    ? options.now
    : undefined;
  const turnPoints = [...turns.values()].map((turn): SessionTurnPoint => {
    const end = turn.endedAt ?? (turn.key === currentTurnKey ? now : undefined) ?? turn.lastEventAt;
    const durationMs = turn.startedAt !== undefined && end >= turn.startedAt
      ? end - turn.startedAt
      : undefined;
    const { startedAt: _startedAt, endedAt: _endedAt, lastEventAt: _lastEventAt, ...point } = turn;
    return { ...point, ...(durationMs === undefined ? {} : { durationMs }) };
  });

  return {
    summary: {
      eventCount: displayEventCount(ordered),
      userMessages,
      assistantMessages,
      messages: userMessages + assistantMessages,
      turns: Math.max(stats.turns ?? 0, turnPoints.length),
      steps: Math.max(stats.steps ?? 0, loadedSteps),
      toolCalls,
      toolResults,
      toolFailures,
      ...(firstEventTime === undefined ? {} : { firstEventTime }),
      ...(lastEventTime === undefined ? {} : { lastEventTime }),
      elapsedMs: options.elapsedMs ?? sessionElapsedMs(ordered, now),
    },
    turns: turnPoints,
    token,
  };
}
