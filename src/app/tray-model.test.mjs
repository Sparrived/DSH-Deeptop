import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTraySessionMenu,
  TRAY_MORE_LIMIT,
  TRAY_RECENT_LIMIT,
  TRAY_UNREAD_LIMIT,
} from "./tray-model.ts";

function session(index, patch = {}) {
  return {
    sessionId: `session-${index}`,
    updatedAt: index,
    running: false,
    blank: false,
    cwd: `C:\\work\\project-${index}`,
    projections: { asOfSeq: index, values: { title: `会话 ${index}` } },
    ...patch,
  };
}

function options(patch = {}) {
  return {
    archivedSessionIds: new Set(),
    indicators: {},
    pendingSessionIds: new Set(),
    activeSessionId: null,
    workspaceTitles: new Map(),
    ...patch,
  };
}

test("projects unread, recent and more sessions without duplicates", () => {
  const sessions = Array.from({ length: 24 }, (_, index) => session(index + 1));
  const indicators = Object.fromEntries(
    sessions.slice(-5).map((item) => [item.sessionId, "completed"]),
  );

  const result = buildTraySessionMenu(sessions, options({ indicators }));

  assert.equal(result.unread.length, TRAY_UNREAD_LIMIT);
  assert.equal(result.recent.length, TRAY_RECENT_LIMIT);
  assert.equal(result.more.length, TRAY_MORE_LIMIT);
  assert.deepEqual(result.unread.map((item) => item.sessionId), ["session-24", "session-23", "session-22"]);
  assert.deepEqual(result.recent.map((item) => item.sessionId), ["session-19", "session-18", "session-17", "session-16"]);
  const ids = [...result.unread, ...result.recent, ...result.more].map((item) => item.sessionId);
  assert.equal(new Set(ids).size, ids.length);
});

test("filters archived, blank and child sessions from the tray", () => {
  const sessions = [
    session(1),
    session(2, { blank: true }),
    session(3, { origin: "subagent" }),
    session(4, { parentSessionId: "session-1" }),
    session(5),
  ];

  const result = buildTraySessionMenu(sessions, options({
    archivedSessionIds: new Set(["session-5"]),
  }));

  assert.deepEqual(result, {
    unread: [],
    recent: [{ sessionId: "session-1", title: "会话 1", context: "project-1", status: "idle" }],
    more: [],
  });
});

test("keeps the active completed session read and uses workspace context", () => {
  const sessions = [session(1), session(2, { running: true }), session(3)];
  const result = buildTraySessionMenu(sessions, options({
    activeSessionId: "session-3",
    indicators: { "session-1": "error", "session-2": "running", "session-3": "completed" },
    pendingSessionIds: new Set(["session-1"]),
    workspaceTitles: new Map([["session-1", "Deeptop"]]),
  }));

  assert.deepEqual(result.unread, [
    { sessionId: "session-1", title: "会话 1", context: "Deeptop", status: "error" },
  ]);
  assert.deepEqual(result.recent, [
    { sessionId: "session-3", title: "会话 3", context: "project-3", status: "idle" },
    { sessionId: "session-2", title: "会话 2", context: "project-2", status: "running" },
  ]);
});
