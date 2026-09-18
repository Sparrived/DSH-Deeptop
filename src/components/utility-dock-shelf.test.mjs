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
  // 回归：窄框下四个页签此前只在 ≤460px 且已横排时才收起，桌面竖排工具栏始终占满
  // 136px 标签宽度，挤压输入框。收起必须让出横向空间、隐藏标签。
  // 判断依据是输入区自己的宽度而非窗口宽度：会话侧栏与右侧停靠栏都会挤压对话列，
  // 同样的窗口宽度下输入框可能只剩一半，窗口断点对这种情况是盲的。
  const desktopStart = utilityPanelCss.indexOf("@media (min-width: 761px)");
  assert.ok(desktopStart >= 0, "the desktop utility tab breakpoint is missing from the stylesheet");
  const mobileStart = utilityPanelCss.indexOf("@media (max-width: 760px)");
  assert.ok(mobileStart > desktopStart, "the ≤760px horizontal layout block is missing from the stylesheet");
  const desktopBlock = utilityPanelCss.slice(desktopStart, mobileStart);

  // 容器是输入区本身：.composer-area 的 inline-size 跟着对话面板走。
  assert.match(desktopBlock, /\.composer-area\s*\{[^}]*container-type:\s*inline-size/);
  const containerStart = desktopBlock.indexOf("@container (max-width: 720px)");
  assert.ok(containerStart >= 0, "the input-width container query is missing from the stylesheet");
  const narrowBlock = desktopBlock.slice(containerStart);

  // 工具栏列宽收成与仓库既有收起宽度一致的 44px。
  assert.match(narrowBlock, /\.composer-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--todo-collapsed-width/);
  assert.match(narrowBlock, /\.composer-workbench\s*>\s*\.utility-panel-shelf\s*\{[^}]*width:\s*var\(--todo-collapsed-width/);
  // 标签与计数隐藏后只剩图标，按钮居中；title 与 role="tab" 语义不变，可访问名称仍在。
  assert.match(narrowBlock, /\.utility-panel-tab-label,\s*\.utility-panel-tab-count\s*\{[^}]*display:\s*none/);
  assert.match(narrowBlock, /\.utility-panel-tab\s*\{[^}]*grid-template-columns:\s*auto/);
  assert.match(narrowBlock, /\.utility-panel-tab\s*\{[^}]*justify-content:\s*center/);

  // 760px 以下的横排布局仍要保留标签，收起只属于桌面竖排工具栏。
  assert.match(utilityPanelCss.slice(mobileStart), /\.utility-panel-tab-label\s*\{\s*display:\s*inline/);
});
