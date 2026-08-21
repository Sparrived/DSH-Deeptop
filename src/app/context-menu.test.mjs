import assert from "node:assert/strict";
import test from "node:test";
import { isWithinSelector, OWNED_CONTEXT_MENU_SELECTOR, FLOATING_CONTEXT_MENU_SELECTOR } from "./context-menu.ts";

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
  assert.equal(isWithinSelector(targetMatching(".workspace-group-row"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-item"), OWNED_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-context-menu"), OWNED_CONTEXT_MENU_SELECTOR), true);
});

test("does not exempt unrelated targets from the native context-menu suppression", () => {
  assert.equal(isWithinSelector(targetMatching(".conversation-panel"), OWNED_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(null, OWNED_CONTEXT_MENU_SELECTOR), false);
});

test("recognizes every floating right-click menu the dock must not treat as outside", () => {
  assert.equal(isWithinSelector(targetMatching(".session-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".workspace-files-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
  assert.equal(isWithinSelector(targetMatching(".task-context-menu"), FLOATING_CONTEXT_MENU_SELECTOR), true);
});

test("floating context-menu selector does not exempt non-menu surfaces", () => {
  assert.equal(isWithinSelector(targetMatching(".conversation-panel"), FLOATING_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(targetMatching(".workspace-file-main"), FLOATING_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(targetMatching(".task-item"), FLOATING_CONTEXT_MENU_SELECTOR), false);
  assert.equal(isWithinSelector(null, FLOATING_CONTEXT_MENU_SELECTOR), false);
});
