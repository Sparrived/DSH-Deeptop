import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPetSettings,
  formatPetCareCooldown,
  normalizePetSettings,
  petCareCooldownRemainingMs,
  petAnimationDurationMs,
  petFrameColumn,
  petInteractionRules,
  petLibraryEntries,
  petLookCell,
  petLookDirection,
  petSettingsAfterRemoval,
  petSpritesheetAssetSource,
  petStableAnimationForActivity,
  petTransientAnimationForActivity,
} from "./pet-model.ts";

const imported = {
  id: "maker.cloud-cat",
  version: "9.9.9",
  name: "覆盖项",
  author: "bad",
  license: "MIT",
  canvas: { width: 192, height: 208 },
  spriteVersionNumber: 2,
  builtIn: false,
};

const custom = {
  id: "maker.cloud-cat",
  version: "1.0.0",
  name: "云猫",
  author: "Maker",
  license: "MIT",
  canvas: { width: 192, height: 208 },
  spriteVersionNumber: 2,
  builtIn: false,
};

const bundle = {
  manifest: {
    kind: "deeptop-pet",
    schemaVersion: 2,
    runtimeProfile: "deeptop",
    id: custom.id,
    version: custom.version,
    name: custom.name,
    author: custom.author,
    license: custom.license,
    canvas: custom.canvas,
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
    interactions: [{ on: "tap", play: "waving", then: "idle", cooldownMs: 500 }],
  },
  assets: {
    "spritesheet.webp": { mediaType: "image/webp", data: "d2VicA==", width: 1536, height: 2288 },
  },
};

test("defaults to a disabled Deeptop Pet library", () => {
  assert.equal(defaultPetSettings.enabled, false);
  assert.equal(defaultPetSettings.interactionsEnabled, true);
  assert.equal(defaultPetSettings.motionEnabled, true);
  assert.equal(defaultPetSettings.careEnabled, true);
  assert.equal(defaultPetSettings.selectedPetId, "");
});

test("normalizes persisted settings and falls back when a pet disappeared", () => {
  assert.deepEqual(normalizePetSettings({
    enabled: true,
    selectedPetId: "maker.cloud-cat",
    anchor: "bottom-left",
    size: 999,
    motionEnabled: false,
    interactionsEnabled: false,
    careEnabled: false,
  }, new Set(["maker.cloud-cat"])), {
    enabled: true,
    selectedPetId: "maker.cloud-cat",
    anchor: "bottom-left",
    size: 160,
    motionEnabled: false,
    interactionsEnabled: false,
    careEnabled: false,
  });
  assert.equal(normalizePetSettings({ selectedPetId: "missing.pet" }, new Set(["maker.cloud-cat"])).selectedPetId, "maker.cloud-cat");
  assert.deepEqual(normalizePetSettings({ enabled: true, selectedPetId: "missing.pet" }, new Set()), {
    ...defaultPetSettings,
    enabled: false,
  });
});

test("counts down persisted care cooldowns without showing expired waits", () => {
  const state = {
    actionReadyAtMs: { meal: 61_000, treat: 59_001, pet: 10_000, play: 0 },
  };
  assert.equal(petCareCooldownRemainingMs(state, "meal", 1_000), 60_000);
  assert.equal(petCareCooldownRemainingMs(state, "play", 1_000), 0);
  assert.equal(formatPetCareCooldown(60_000), "1分");
  assert.equal(formatPetCareCooldown(58_001), "59秒");
  assert.equal(formatPetCareCooldown(0), "");
});

test("deduplicates installed pets by id", () => {
  const entries = petLibraryEntries([imported, custom]);
  assert.deepEqual(entries.map((entry) => entry.id), ["maker.cloud-cat"]);
  assert.equal(entries[0].name, "覆盖项");
});

test("selects a remaining pet after deletion and disables the feature when none remain", () => {
  const enabled = { ...defaultPetSettings, enabled: true, selectedPetId: custom.id };
  assert.deepEqual(petSettingsAfterRemoval(enabled, [custom]), enabled);
  assert.deepEqual(petSettingsAfterRemoval(enabled, []), {
    ...defaultPetSettings,
    enabled: false,
    selectedPetId: "",
  });
});

test("uses Deeptop Pet frame timing and clamps one-shot animations", () => {
  assert.equal(petAnimationDurationMs("idle"), 1_100);
  assert.equal(petFrameColumn("idle", 0), 0);
  assert.equal(petFrameColumn("idle", 279), 0);
  assert.equal(petFrameColumn("idle", 280), 1);
  assert.equal(petFrameColumn("idle", 1_100), 0);
  assert.equal(petFrameColumn("waving", 0), 0);
  assert.equal(petFrameColumn("waving", 140), 1);
  assert.equal(petFrameColumn("waving", 99_000), 3);
});

test("maps all 16 clockwise look directions into the final two rows", () => {
  assert.deepEqual(petLookCell(0), { row: 9, column: 0 });
  assert.deepEqual(petLookCell(7), { row: 9, column: 7 });
  assert.deepEqual(petLookCell(8), { row: 10, column: 0 });
  assert.deepEqual(petLookCell(15), { row: 10, column: 7 });
  assert.deepEqual(petLookCell(16), { row: 9, column: 0 });
});

test("quantizes global pointer vectors from up and clockwise with a distance gate", () => {
  assert.equal(petLookDirection(0, -100, 100, 20, 300), 0);
  assert.equal(petLookDirection(100, 0, 100, 20, 300), 4);
  assert.equal(petLookDirection(0, 100, 100, 20, 300), 8);
  assert.equal(petLookDirection(-100, 0, 100, 20, 300), 12);
  assert.equal(petLookDirection(10, 0, 10, 20, 300), null);
  assert.equal(petLookDirection(500, 0, 500, 20, 300), null);
});

test("keeps task loops stable and completion or failure reactions transient", () => {
  assert.equal(petStableAnimationForActivity("running"), "running");
  assert.equal(petStableAnimationForActivity("waiting"), "waiting");
  assert.equal(petStableAnimationForActivity("failed"), "idle");
  assert.equal(petTransientAnimationForActivity("failed"), "failed");
  assert.equal(petTransientAnimationForActivity("review"), "review");
  assert.equal(petTransientAnimationForActivity("idle"), null);
});

test("uses safe interaction defaults and a validated WebP asset", () => {
  assert.equal(petInteractionRules(bundle, "tap")[0].play, "waving");
  assert.equal(petInteractionRules(null, "doubleTap")[0].play, "jumping");
  assert.equal(petInteractionRules(null, "idleTimeout").length, 2);
  assert.equal(petSpritesheetAssetSource(bundle), "data:image/webp;base64,d2VicA==");
});
