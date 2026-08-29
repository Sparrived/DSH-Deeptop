import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

async function loadSubagentDock() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./SubagentDock.tsx", import.meta.url))],
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
  return module.exports.SubagentDock;
}

function rowsOf(treeRows) {
  return treeRows.props.children;
}

test("opens subagent tree entries with their direct parent session", async () => {
  const SubagentDock = await loadSubagentDock();
  const calls = [];
  const child = { kind: "child", id: "child", mode: "one-shot", activity: "inactive", hasChildren: true };
  const grandchild = { kind: "child", id: "grandchild", mode: "continuable", activity: "inactive", hasChildren: false };
  const childTreeKey = "root\u0000child";
  const dock = SubagentDock({
    rootSessionId: "root",
    entries: [child],
    dockOpen: true,
    selectedId: null,
    catalogs: { [childTreeKey]: { entries: [grandchild], parentAvailable: true } },
    expandedBranches: { [childTreeKey]: true },
    onToggleDock() {},
    onToggleBranch() {},
    onOpen(...args) { calls.push(args); },
  });

  const tree = dock.props.children;
  const navigation = tree.type(tree.props);
  const rootRows = navigation.props.children.type(navigation.props.children.props);
  const rootRow = rowsOf(rootRows)[0];
  rootRow.props.children[0].props.children[1].props.onClick();

  const nestedRowsElement = rootRow.props.children[1].props.children;
  const nestedRows = nestedRowsElement.type(nestedRowsElement.props);
  const nestedRow = rowsOf(nestedRows)[0];
  nestedRow.props.children[0].props.children[1].props.onClick();

  assert.deepEqual(calls, [
    [child, "root", "root\u0000child"],
    [grandchild, "child", "child\u0000grandchild"],
  ]);
});
