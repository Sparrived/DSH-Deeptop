import assert from "node:assert/strict";
import test from "node:test";
import {
  presentedFileManagerKey,
  presentedMenuDisabled,
  presentedPending,
  presentedPhaseKey,
  presentedStatusIsError,
  presentedStatusKey,
} from "./presented-file.ts";

test("keys phases by session and path so sessions cannot share a state", () => {
  assert.equal(presentedPhaseKey("s1", "src/a.ts"), "s1::src/a.ts");
  assert.notEqual(presentedPhaseKey("s1", "src/a.ts"), presentedPhaseKey("s2", "src/a.ts"));
  assert.equal(presentedPhaseKey(null, "src/a.ts"), "::src/a.ts");
});

test("treats only in-flight phases as pending", () => {
  assert.equal(presentedPending("opening"), true);
  assert.equal(presentedPending("revealing"), true);
  assert.equal(presentedPending("opened"), false);
  assert.equal(presentedPending("error"), false);
  assert.equal(presentedPending(undefined), false);
});

test("disables the menu without a native host or while an action runs", () => {
  assert.equal(presentedMenuDisabled(undefined, null), true);
  assert.equal(presentedMenuDisabled("opening", { fileManager: "explorer" }), true);
  assert.equal(presentedMenuDisabled("opened", { fileManager: "explorer" }), false);
  assert.equal(presentedMenuDisabled("error", { fileManager: "finder" }), false);
});

test("names the file manager per phase and never guesses from the browser", () => {
  assert.equal(presentedStatusKey(undefined, "explorer"), null);
  assert.deepEqual(presentedStatusKey("opening", "explorer"), { key: "deliverables.phase.opening" });
  assert.deepEqual(presentedStatusKey("revealed", "explorer"), { key: "deliverables.phase.revealedNamed", manager: true });
  assert.deepEqual(presentedStatusKey("revealed", "finder"), { key: "deliverables.phase.revealedNamed", manager: true });
  // 只知道能打开所在文件夹时不假装有具名文件管理器。
  assert.deepEqual(presentedStatusKey("revealed", "directory"), { key: "deliverables.phase.revealed" });
  assert.deepEqual(presentedStatusKey("revealing", "directory"), { key: "deliverables.phase.revealing" });
  assert.equal(presentedFileManagerKey("explorer"), "deliverables.fileManager.explorer");
  assert.equal(presentedFileManagerKey("finder"), "deliverables.fileManager.finder");
  assert.equal(presentedFileManagerKey("directory"), "deliverables.fileManager.directory");
});

test("marks only the failure phases as errors", () => {
  assert.equal(presentedStatusIsError("error"), true);
  assert.equal(presentedStatusIsError("revealError"), true);
  assert.equal(presentedStatusIsError("opened"), false);
  assert.equal(presentedStatusIsError(undefined), false);
});
