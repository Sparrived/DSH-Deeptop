import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WINDOW_BEHAVIOR, nextCloseBehavior, normalizeWindowBehavior } from "./window-behavior.ts";

test("defaults to asking before the first close", () => {
  assert.deepEqual(normalizeWindowBehavior(null), DEFAULT_WINDOW_BEHAVIOR);
});

test("normalizes malformed native settings without enabling unsafe behavior", () => {
  assert.deepEqual(normalizeWindowBehavior({ minimizeToTray: "yes", closeBehavior: "unknown" }), DEFAULT_WINDOW_BEHAVIOR);
  assert.deepEqual(normalizeWindowBehavior({ minimizeToTray: true, closeBehavior: "hide-to-tray" }), {
    minimizeToTray: true,
    closeBehavior: "hide-to-tray",
  });
});

test("records only an explicit first-close choice", () => {
  const current = { minimizeToTray: false, closeBehavior: "ask" };
  assert.deepEqual(nextCloseBehavior(current, null), current);
  assert.deepEqual(nextCloseBehavior(current, "exit"), { minimizeToTray: false, closeBehavior: "exit" });
});
