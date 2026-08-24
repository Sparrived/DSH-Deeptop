import assert from "node:assert/strict";
import test from "node:test";
import {
  isUiThemeDocumentUpdated,
  isUiThemePreference,
  uiThemePreferenceFromSettings,
  uiThemePreferenceOps,
} from "./theme-sync.ts";

test("recognizes the official ui-theme preference values", () => {
  assert.equal(isUiThemePreference("light"), true);
  assert.equal(isUiThemePreference("dark"), true);
  assert.equal(isUiThemePreference("system"), true);
  assert.equal(isUiThemePreference("sepia"), false);
  assert.equal(isUiThemePreference(undefined), false);
});

test("reads the preference from settings.describe", () => {
  const settings = {
    writable: true,
    hasDocument: true,
    namespaces: [{ ns: "ui-theme", value: { preference: "dark" } }],
  };
  assert.equal(uiThemePreferenceFromSettings(settings), "dark");
  assert.equal(uiThemePreferenceFromSettings({ writable: true, hasDocument: true, namespaces: [] }), undefined);
  assert.equal(uiThemePreferenceFromSettings(null), undefined);
  assert.equal(uiThemePreferenceFromSettings({ writable: true, hasDocument: true, namespaces: [{ ns: "ui-theme", value: { preference: "unknown" } }] }), undefined);
});

test("builds the mutate ops for a preference", () => {
  assert.deepEqual(uiThemePreferenceOps("light"), [{ op: "set", path: ["preference"], value: "light" }]);
});

test("recognizes document-updated events targeting ui-theme", () => {
  assert.equal(isUiThemeDocumentUpdated(["ui-theme", 3]), true);
  assert.equal(isUiThemeDocumentUpdated(["llm-pi-ai", 7]), false);
  assert.equal(isUiThemeDocumentUpdated(undefined), false);
});