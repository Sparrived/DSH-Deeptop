import assert from "node:assert/strict";
import test from "node:test";
import {
  retainSessionSelection,
  selectAllSessions,
  selectedSessions,
  toggleSessionSelection,
} from "./session-bulk-selection.ts";

const sessions = [
  { sessionId: "s-2", updatedAt: 2, running: false, blank: false },
  { sessionId: "s-1", updatedAt: 1, running: false, blank: false },
];

test("keeps selected sessions in their displayed order and removes stale ids", () => {
  const selected = new Set(["missing", "s-1", "s-2"]);
  assert.deepEqual([...retainSessionSelection(selected, sessions)], ["s-1", "s-2"]);
  assert.deepEqual(selectedSessions(sessions, selected).map((session) => session.sessionId), ["s-2", "s-1"]);
});

test("toggles individual selections and selects the displayed list", () => {
  const selected = toggleSessionSelection(new Set(["s-1"]), "s-2");
  assert.deepEqual([...selected], ["s-1", "s-2"]);
  assert.deepEqual([...toggleSessionSelection(selected, "s-1")], ["s-2"]);
  assert.deepEqual([...selectAllSessions(sessions)], ["s-2", "s-1"]);
});
