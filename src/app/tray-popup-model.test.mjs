import assert from "node:assert/strict";
import test from "node:test";
import {
  nextTrayMenuIndex,
  readTrayThemePreferences,
  resolveTrayTheme,
  trayPopupSnapshotsEqual,
} from "./tray-popup-model.ts";

function storage(values) {
  return { getItem: (key) => values[key] ?? null };
}

test("reads the tray theme subset from the shared appearance settings", () => {
  const preferences = readTrayThemePreferences(storage({
    "deeptop.theme": "dark",
    "deeptop.appearance": JSON.stringify({
      fontFamily: "Inter, sans-serif",
      themeCssPath: " C:/themes/deeptop.css ",
      customCssEnabled: true,
      customCss: ":root { --accent: pink; }",
    }),
  }));

  assert.deepEqual(preferences, {
    mode: "dark",
    fontFamily: "Inter, sans-serif",
    themeCssPath: "C:/themes/deeptop.css",
    customCss: ":root { --accent: pink; }",
  });
});

test("falls back safely for invalid tray theme storage", () => {
  const preferences = readTrayThemePreferences(storage({
    "deeptop.theme": "sepia",
    "deeptop.appearance": "not-json",
  }));

  assert.equal(preferences.mode, "system");
  assert.equal(preferences.themeCssPath, "");
  assert.equal(preferences.customCss, "");
  assert.match(preferences.fontFamily, /Segoe UI/);
  assert.equal(resolveTrayTheme("system", true), "dark");
  assert.equal(resolveTrayTheme("system", false), "light");
});

test("wraps keyboard focus through the tray menu", () => {
  assert.equal(nextTrayMenuIndex("ArrowDown", 2, 3), 0);
  assert.equal(nextTrayMenuIndex("ArrowUp", 0, 3), 2);
  assert.equal(nextTrayMenuIndex("Home", 2, 3), 0);
  assert.equal(nextTrayMenuIndex("End", 0, 3), 2);
  assert.equal(nextTrayMenuIndex("Enter", 0, 3), null);
});

test("detects whether a tray snapshot would change rendered rows", () => {
  const snapshot = {
    unread: [{ sessionId: "one", title: "会话", context: "DSH", status: "unread" }],
    recent: [],
    more: [],
  };

  assert.equal(trayPopupSnapshotsEqual(snapshot, structuredClone(snapshot)), true);
  assert.equal(trayPopupSnapshotsEqual(snapshot, {
    ...structuredClone(snapshot),
    unread: [{ ...snapshot.unread[0], status: "idle" }],
  }), false);
});
