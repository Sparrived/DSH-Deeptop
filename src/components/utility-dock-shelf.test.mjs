import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const utilityPanelCss = readFileSync(
  fileURLToPath(new URL("../styles/22-utility-panel.css", import.meta.url)),
  "utf8",
);

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

test("collapses the four utility tabs to an icon rail when the frame narrows", () => {
  // 回归：窄框下四个页签此前只在 ≤460px 且已横排时才收起，920–1360px 的桌面竖排
  // 工具栏始终占满 136px 标签宽度，挤压输入框。窄框断点必须让出横向空间、隐藏标签。
  const start = utilityPanelCss.indexOf("@media (max-width: 1120px) and (min-width: 761px)");
  assert.ok(start >= 0, "the narrow-frame utility tab breakpoint is missing from the stylesheet");
  const nextBreakpoint = utilityPanelCss.indexOf("@media", start + 1);
  const narrowBlock = utilityPanelCss.slice(start, nextBreakpoint === -1 ? undefined : nextBreakpoint);

  // 工具栏列宽收成与仓库既有收起宽度一致的 44px。
  assert.match(narrowBlock, /\.composer-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--todo-collapsed-width/);
  assert.match(narrowBlock, /\.composer-workbench\s*>\s*\.utility-panel-shelf\s*\{[^}]*width:\s*var\(--todo-collapsed-width/);
  // 标签与计数隐藏后只剩图标，按钮居中。
  assert.match(narrowBlock, /\.utility-panel-tab-label,\s*\.utility-panel-tab-count\s*\{[^}]*display:\s*none/);
  assert.match(narrowBlock, /\.utility-panel-tab\s*\{[^}]*grid-template-columns:\s*auto/);
  assert.match(narrowBlock, /\.utility-panel-tab\s*\{[^}]*justify-content:\s*center/);

  // 760px 以下的横排布局仍要保留标签，收起只属于桌面竖排工具栏。
  const narrowLayout = utilityPanelCss.slice(utilityPanelCss.indexOf("@media (max-width: 760px)"));
  assert.match(narrowLayout, /\.utility-panel-tab-label\s*\{\s*display:\s*inline/);
});
