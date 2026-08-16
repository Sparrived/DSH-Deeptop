import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SEND_SHORTCUT, isSendShortcut, shortcutMatches } from "./keyboard-shortcut.ts";

const event = (overrides = {}) => ({
  key: "Enter",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  isComposing: false,
  ...overrides,
});

test("defaults to plain Enter and accepts only the two send options", () => {
  assert.equal(DEFAULT_SEND_SHORTCUT, "Enter");
  assert.equal(isSendShortcut("Enter"), true);
  assert.equal(isSendShortcut("Ctrl+Enter"), true);
  assert.equal(isSendShortcut("Alt+Enter"), false);
});

test("matches the selected Enter variant exactly", () => {
  assert.equal(shortcutMatches(event(), "Enter"), true);
  assert.equal(shortcutMatches(event({ ctrlKey: true }), "Enter"), false);
  assert.equal(shortcutMatches(event(), "Ctrl+Enter"), false);
  assert.equal(shortcutMatches(event({ ctrlKey: true }), "Ctrl+Enter"), true);
  assert.equal(shortcutMatches(event({ ctrlKey: true, shiftKey: true }), "Ctrl+Enter"), false);
  assert.equal(shortcutMatches(event({ isComposing: true }), "Enter"), false);
});
