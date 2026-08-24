import assert from "node:assert/strict";
import test from "node:test";
import {
  hasTranslation,
  isLocaleDocumentUpdated,
  isUiLocale,
  localePreferenceFromSettings,
  localePreferenceOps,
  t,
} from "./i18n.ts";

test("t() returns zh by default and en when available", () => {
  assert.equal(t("settings.title", "zh"), "设置");
  assert.equal(t("settings.title", "en"), "Settings");
});

test("t() falls back to the key when untranslated", () => {
  assert.equal(t("no.such.key", "zh"), "no.such.key");
  assert.equal(hasTranslation("settings.title"), true);
  assert.equal(hasTranslation("no.such.key"), false);
});

test("locale value guards", () => {
  assert.equal(isUiLocale("zh"), true);
  assert.equal(isUiLocale("en"), true);
  assert.equal(isUiLocale("fr"), false);
  assert.equal(isUiLocale(undefined), false);
});

test("reads the official locale preference from settings.describe", () => {
  const settings = {
    namespaces: [{ ns: "locale", value: { preference: "en" } }],
  };
  assert.equal(localePreferenceFromSettings(settings), "en");
  assert.equal(localePreferenceFromSettings(null), undefined);
  assert.equal(localePreferenceFromSettings({ namespaces: [] }), undefined);
  assert.equal(localePreferenceFromSettings({ namespaces: [{ ns: "locale", value: { preference: "fr" } }] }), undefined);
});

test("builds the mutate ops and recognizes document-updated events", () => {
  assert.deepEqual(localePreferenceOps("en"), [{ op: "set", path: ["preference"], value: "en" }]);
  assert.equal(isLocaleDocumentUpdated(["locale", 2]), true);
  assert.equal(isLocaleDocumentUpdated(["ui-theme", 2]), false);
  assert.equal(isLocaleDocumentUpdated(undefined), false);
});