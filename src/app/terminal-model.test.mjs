import assert from "node:assert/strict";
import test from "node:test";
import { activeTabAfterClose, pruneUnavailableTabs, resetTabsForWorkspaceChange } from "./terminal-model.ts";

const tabs = [
  { id: "one", terminalId: "pwsh", sessionId: "s1", exited: false },
  { id: "two", terminalId: "cmd", sessionId: "s2", exited: false },
  { id: "three", terminalId: "bash", sessionId: null, exited: true },
];

test("selects the previous tab after closing the active tab", () => {
  assert.equal(activeTabAfterClose(tabs, "two", "two"), "one");
  assert.equal(activeTabAfterClose(tabs, "one", "one"), "two");
  assert.equal(activeTabAfterClose(tabs, "two", "one"), "one");
});

test("prunes unavailable shells and keeps active tab valid", () => {
  const result = pruneUnavailableTabs(tabs, ["pwsh", "bash"], "two");
  assert.deepEqual(result.tabs.map((tab) => tab.id), ["one", "three"]);
  assert.equal(result.activeId, "one");
});

test("detects workspace changes as a PTY reset boundary", () => {
  assert.equal(resetTabsForWorkspaceChange("D:\\Code\\A", "D:\\Code\\B"), true);
  assert.equal(resetTabsForWorkspaceChange("D:\\Code\\A", "D:\\Code\\A"), false);
});
