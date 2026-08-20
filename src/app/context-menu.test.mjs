import assert from "node:assert/strict";
import test from "node:test";
import { isWithinSelector, OWNED_CONTEXT_MENU_SELECTOR } from "./context-menu.ts";

function targetMatching(selectorPart) {
  return {
    closest(selector) {
      return selector.includes(selectorPart) ? this : null;
    },
  };
}

test("recognizes file and task rows plus their portal menus as owned context targets", () => {
  assert.equal(isWithinSelector(targetMatching(".workspace-file-main"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-files-context-menu"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-item"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-context-menu"), OWNED_CONTEXT_MENU_SELECTOR), true);
});

test("does not exempt unrelated targets from the native context-menu suppression", () => {
  assert.equal(isWithinSelector(targetMatching(".conversation-panel"), OWNED_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(null, OWNED_CONTEXT_MENU_SELECTOR), false);
});
