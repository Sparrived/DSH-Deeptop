import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

async function loadUtilityDockShelf() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./UtilityDockShelf.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}

test("keeps the four utility entries visible in their canonical order", async () => {
  const { UtilityDockShelf, UtilityPanelEmptyState } = await loadUtilityDockShelf();
  const shelf = UtilityDockShelf({
    active: "todo",
    onSelect() {},
    tasks: "tasks",
    todo: "todo",
    deliverables: "deliverables",
    subagent: "subagent",
  });
  const [content, tabs] = shelf.props.children;
  assert.equal(content.props.children, "todo");
  assert.deepEqual(tabs.props.children.map((item) => item.key), ["tasks", "todo", "deliverables", "subagent"]);
  assert.deepEqual(tabs.props.children.map((item) => item.props["aria-selected"]), [false, true, false, false]);
  let selected = null;
  const interactiveShelf = UtilityDockShelf({
    active: null,
    onSelect(id) { selected = id; },
    tasks: "tasks",
    todo: "todo",
    deliverables: "deliverables",
    subagent: "subagent",
  });
  interactiveShelf.props.children[1].props.children[3].props.onClick();
  assert.equal(selected, "subagent");

  const empty = UtilityPanelEmptyState({ icon: "◈", title: "Waiting", description: "Create a subagent." });
  assert.equal(empty.props.className, "utility-panel-empty");
  assert.equal(empty.props.children[1].type, "strong");
});
