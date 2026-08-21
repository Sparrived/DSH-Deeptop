import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKSPACE_VIEW_PREFERENCES, parseWorkspaceViewPreferences } from "./workspace-view.ts";

test("falls back to empty preferences for missing or invalid input", () => {
  assert.deepEqual(parseWorkspaceViewPreferences(null), DEFAULT_WORKSPACE_VIEW_PREFERENCES);
  assert.deepEqual(parseWorkspaceViewPreferences(""), DEFAULT_WORKSPACE_VIEW_PREFERENCES);
  assert.deepEqual(parseWorkspaceViewPreferences("not-json"), DEFAULT_WORKSPACE_VIEW_PREFERENCES);
  assert.deepEqual(parseWorkspaceViewPreferences("42"), DEFAULT_WORKSPACE_VIEW_PREFERENCES);
  assert.deepEqual(parseWorkspaceViewPreferences("[]"), DEFAULT_WORKSPACE_VIEW_PREFERENCES);
});

test("parses pinned ids and the unpinned section expansion flag", () => {
  const parsed = parseWorkspaceViewPreferences(JSON.stringify({
    pinnedWorkspaceIds: ["a", "b"],
    unpinnedSectionOpen: true,
  }));
  assert.deepEqual(parsed, { pinnedWorkspaceIds: ["a", "b"], unpinnedSectionOpen: true });
});

test("keeps the unpinned section collapsed by default and drops invalid entries", () => {
  const parsed = parseWorkspaceViewPreferences(JSON.stringify({
    pinnedWorkspaceIds: ["a", 42, "", "b"],
    unpinnedSectionOpen: "yes",
  }));
  assert.deepEqual(parsed, { pinnedWorkspaceIds: ["a", "b"], unpinnedSectionOpen: false });
  assert.equal(parseWorkspaceViewPreferences(JSON.stringify({ pinnedWorkspaceIds: [] })).unpinnedSectionOpen, false);
});
