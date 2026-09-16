import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCK_RAIL_EDGE_GAP,
  DOCK_RAIL_MAX_WIDTH,
  DOCK_RAIL_MIN_WIDTH,
  DOCK_RAIL_STRIP_WIDTH,
  activateDockTab,
  clampDockRailWidth,
  closeDockPane,
  closeDockTab,
  collectDockPanes,
  dockAxisForZone,
  DOCK_PANEL_TAB_KINDS,
  dockTabBodyState,
  isDockPanelTabKind,
  dockTabKey,
  dockTabWorkspace,
  dockWorkspacesMatch,
  dockZoneAt,
  emptyDockLayout,
  findDockPane,
  findDockPaneOfTab,
  findDockTabByKey,
  isValidDockLayoutId,
  moveDockTab,
  normalizeDockLayout,
  openDockTab,
  reorderDockTab,
  resizeDockSplit,
  retargetFileTab,
} from "./dock-layout.ts";

/** 收集 src/components 下的 tsx（扫描 DockFrame 面板 id 用）。 */
function collectComponentFiles() {
  const root = fileURLToPath(new URL("../components", import.meta.url));
  return readdirSync(root)
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => join(root, entry));
}
function tab(kind, extra = {}) {
  return { id: `tab-${kind}-${extra.path ?? ""}`, kind, title: kind, ...extra };
}

function open(layout, next, options = {}) {
  return openDockTab(layout, next, {
    paneId: options.paneId ?? `pane-${Object.keys(layout.tabs).length + 1}`,
    splitId: options.splitId ?? `split-${Object.keys(layout.tabs).length + 1}`,
    ...options,
  });
}

test("derives the split axis and leading side from the drop zone", () => {
  assert.equal(dockAxisForZone("left"), "row");
  assert.equal(dockAxisForZone("right"), "row");
  assert.equal(dockAxisForZone("top"), "column");
  assert.equal(dockAxisForZone("bottom"), "column");
});

test("validates layout ids with the same rules as the Rust bridge", () => {
  assert.equal(isValidDockLayoutId("pane-1"), true);
  assert.equal(isValidDockLayoutId("pane-lx1a2-3"), true);
  assert.equal(isValidDockLayoutId("a".repeat(100)), true);
  assert.equal(isValidDockLayoutId(""), false);
  assert.equal(isValidDockLayoutId("bad id"), false);
  assert.equal(isValidDockLayoutId("tab.1"), false);
  assert.equal(isValidDockLayoutId("x".repeat(101)), false);
  assert.equal(isValidDockLayoutId(42), false);
});

test("opens the first tab as the root pane and activates it", () => {
  const layout = open(emptyDockLayout(), tab("terminal"));
  assert.equal(layout.root.kind, "pane");
  assert.deepEqual(layout.root.tabIds, ["tab-terminal-"]);
  assert.equal(layout.root.activeTabId, "tab-terminal-");
});

test("merges a second tab into the target pane for the center zone", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const second = open(first, tab("git"), { zone: "center", targetPaneId: first.root.id });
  assert.equal(second.root.kind, "pane");
  assert.deepEqual(second.root.tabIds, ["tab-terminal-", "tab-git-"]);
  assert.equal(second.root.activeTabId, "tab-git-");
});

test("splits the target pane towards the requested side", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const right = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id });
  assert.equal(right.root.kind, "split");
  assert.equal(right.root.axis, "row");
  assert.deepEqual(right.root.children.map((child) => child.tabIds[0]), ["tab-terminal-", "tab-git-"]);
  assert.deepEqual(right.root.sizes, [0.5, 0.5]);

  const bottom = open(first, tab("git"), { zone: "bottom", targetPaneId: first.root.id });
  assert.equal(bottom.root.axis, "column");
  assert.deepEqual(bottom.root.children.map((child) => child.tabIds[0]), ["tab-terminal-", "tab-git-"]);

  const left = open(first, tab("git"), { zone: "left", targetPaneId: first.root.id });
  assert.deepEqual(left.root.children.map((child) => child.tabIds[0]), ["tab-git-", "tab-terminal-"]);
});

test("adds a sibling to an existing same-axis split instead of nesting", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const right = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id });
  const third = open(right, tab("files"), { zone: "right", targetPaneId: first.root.id, paneId: "pane-3", splitId: "split-3" });
  assert.equal(third.root.kind, "split");
  assert.equal(third.root.children.length, 3);
  assert.deepEqual(third.root.children.map((child) => child.tabIds[0]), ["tab-terminal-", "tab-files-", "tab-git-"]);
  assert.equal(third.root.children.every((child) => child.kind === "pane"), true);
  assert.deepEqual(third.root.sizes.map((size) => Number(size.toFixed(4))), [0.3333, 0.3333, 0.3333]);
});

test("reuses an existing tab for the same kind instead of opening a second one", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const again = open(first, { id: "another-terminal", kind: "terminal", title: "terminal" });
  assert.equal(collectDockPanes(again.root).length, 1);
  assert.deepEqual(again.root.tabIds, ["tab-terminal-"]);
});

test("dedupes file tabs by normalized path and reveals the requested line", () => {
  assert.equal(dockTabKey("file", "src\\App.tsx"), dockTabKey("file", "SRC/App.tsx"));
  assert.equal(dockTabKey("terminal"), "terminal");
  const first = open(emptyDockLayout(), tab("file", { path: "src\\App.tsx", line: 10, id: "file-1" }));
  const again = open(first, { id: "file-2", kind: "file", title: "App.tsx", path: "SRC/App.tsx", line: 42 });
  const panes = collectDockPanes(again.root);
  assert.equal(panes.length, 1);
  assert.deepEqual(panes[0].tabIds, ["file-1"]);
  assert.equal(again.tabs["file-1"].line, 42);
  assert.equal(Object.keys(again.tabs).length, 1);
});

// 图片预览在标签内翻到兄弟图片：标签身份必须跟着正在显示的文件走，
// 否则标签会顶着一个文件的名字显示另一个文件，原路径再打开时还会多出一个标签。
test("retargets a file tab in place and moves its identity with the path", () => {
  const first = open(emptyDockLayout(), { id: "file-1", kind: "file", title: "a.png", path: "/w/a.png", detail: "/w", line: 7 });
  const layout = open(first, { id: "file-2", kind: "file", title: "b.png", path: "/w/b.png", detail: "/w" });
  const next = retargetFileTab(layout, "file-1", { path: "/w/c.png", title: "c.png", detail: "/w" });

  // 同一个标签、同一个面板位置，只是改指到新文件。
  assert.deepEqual(next.root.tabIds, ["file-1", "file-2"]);
  assert.equal(next.root.activeTabId, "file-1");
  assert.deepEqual(next.tabs["file-1"], { id: "file-1", kind: "file", title: "c.png", path: "/w/c.png", detail: "/w" });
  // 旧路径不再是任何标签的身份；新路径才是。
  assert.equal(findDockTabByKey(next, dockTabKey("file", "/w/a.png")), null);
  assert.equal(findDockTabByKey(next, dockTabKey("file", "/w/c.png")).id, "file-1");
  // 定位行属于被替换掉的那个文件，未显式给出时一并清掉。
  assert.equal(next.tabs["file-1"].line, undefined);
});

test("keeps an explicit target line and drops a stale detail", () => {
  const layout = open(emptyDockLayout(), { id: "file-1", kind: "file", title: "a.png", path: "/w/a.png", detail: "/w" });
  const next = retargetFileTab(layout, "file-1", { path: "/w/b.png", title: "b.png", line: 12 });
  assert.equal(next.tabs["file-1"].line, 12);
  assert.equal(next.tabs["file-1"].detail, undefined);
});

test("activates the existing tab instead of duplicating a retargeted path", () => {
  const first = open(emptyDockLayout(), { id: "file-1", kind: "file", title: "a.png", path: "/w/a.png" });
  const layout = open(first, { id: "file-2", kind: "file", title: "b.png", path: "/w/b.png" });
  const next = retargetFileTab(layout, "file-2", { path: "/w/a.png", title: "a.png" });

  assert.deepEqual(next.root.tabIds, ["file-1"]);
  assert.equal(next.root.activeTabId, "file-1");
  assert.deepEqual(Object.keys(next.tabs), ["file-1"]);
});

test("leaves non-file and unknown tabs untouched", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const layout = open(first, { id: "file-1", kind: "file", title: "a.png", path: "/w/a.png" });
  assert.equal(retargetFileTab(layout, "tab-terminal-", { path: "/w/a.png", title: "a.png" }), layout);
  assert.equal(retargetFileTab(layout, "missing", { path: "/w/a.png", title: "a.png" }), layout);
});

test("moves an existing tab into another pane on request", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const split = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id });
  const targetPane = findDockPane(split.root, first.root.id);
  const moved = openDockTab(split, { id: "tab-git-", kind: "git", title: "git" }, {
    zone: "center",
    targetPaneId: targetPane.id,
    paneId: "pane-x",
    splitId: "split-x",
  });
  assert.equal(moved.root.kind, "pane");
  assert.deepEqual(moved.root.tabIds, ["tab-terminal-", "tab-git-"]);
  assert.equal(findDockPaneOfTab(moved.root, "tab-git-").id, targetPane.id);
});

test("closing the last tab of a pane collapses an empty split", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const split = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id });
  const closed = closeDockTab(split, "tab-git-");
  assert.equal(closed.root.kind, "pane");
  assert.deepEqual(closed.root.tabIds, ["tab-terminal-"]);
  assert.equal(closed.tabs["tab-git-"], undefined);

  const emptied = closeDockTab(closed, "tab-terminal-");
  assert.equal(emptied.root, null);
  assert.deepEqual(emptied.tabs, {});
});

test("keeps the neighbouring tab active when the active tab closes", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const merged = open(first, tab("git"), { zone: "center", targetPaneId: first.root.id });
  const closed = closeDockTab(merged, "tab-git-");
  assert.equal(closed.root.activeTabId, "tab-terminal-");
});

test("closes every tab of a pane and reorders within a tab group", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const merged = open(first, tab("git"), { zone: "center", targetPaneId: first.root.id });
  const reordered = reorderDockTab(merged, "tab-terminal-", 1);
  assert.deepEqual(reordered.root.tabIds, ["tab-git-", "tab-terminal-"]);

  const paneId = merged.root.id;
  const closed = closeDockPane(merged, paneId);
  assert.equal(closed.root, null);
  assert.deepEqual(closed.tabs, {});
});

test("resizes a split while respecting the minimum fraction", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const split = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id, splitId: "split-a" });
  const grown = resizeDockSplit(split, "split-a", 0, 0.75);
  assert.deepEqual(grown.root.sizes, [0.75, 0.25]);
  const clamped = resizeDockSplit(split, "split-a", 0, 0.99);
  assert.equal(clamped.root.sizes[0] <= 0.93, true);
  assert.equal(clamped.root.sizes[0] + clamped.root.sizes[1], 1);
  assert.deepEqual(resizeDockSplit(split, "split-a", 5, 0.4).root.sizes, [0.5, 0.5]);
  assert.deepEqual(resizeDockSplit(split, "missing", 0, 0.4).root.sizes, [0.5, 0.5]);
});

test("activates a tab without touching the tree", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const merged = open(first, tab("git"), { zone: "center", targetPaneId: first.root.id });
  const activated = activateDockTab(merged, "tab-terminal-");
  assert.equal(activated.root.activeTabId, "tab-terminal-");
  assert.equal(activateDockTab(activated, "tab-terminal-"), activated);
  assert.equal(activateDockTab(merged, "nope"), merged);
});

test("moves a tab between panes and falls back when the target disappears", () => {
  const first = open(emptyDockLayout(), tab("terminal"));
  const split = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id });
  const moved = moveDockTab(split, "tab-git-", { zone: "center", targetPaneId: first.root.id, paneId: "pane-m", splitId: "split-m" });
  assert.equal(moved.root.kind, "pane");
  assert.deepEqual(moved.root.tabIds, ["tab-terminal-", "tab-git-"]);

  const back = moveDockTab(moved, "tab-git-", { zone: "bottom", targetPaneId: moved.root.id, paneId: "pane-b", splitId: "split-b" });
  assert.equal(back.root.kind, "split");
  assert.equal(back.root.axis, "column");

  // 目标面板已随源标签一起消失时退回并入第一个面板，不丢标签。
  const lone = open(emptyDockLayout(), tab("git"));
  const orphaned = moveDockTab(lone, "tab-git-", { zone: "right", targetPaneId: "gone", paneId: "pane-o", splitId: "split-o" });
  assert.deepEqual(collectDockPanes(orphaned.root).flatMap((pane) => pane.tabIds), ["tab-git-"]);
});

test("resolves drop zones from the pointer position", () => {
  const rect = { left: 0, top: 0, right: 400, bottom: 400 };
  assert.equal(dockZoneAt(rect, 4, 200), "left");
  assert.equal(dockZoneAt(rect, 396, 200), "right");
  assert.equal(dockZoneAt(rect, 200, 4), "top");
  assert.equal(dockZoneAt(rect, 200, 396), "bottom");
  assert.equal(dockZoneAt(rect, 200, 200), "center");
  assert.equal(dockZoneAt(rect, -20, 200), "center");
  assert.equal(dockZoneAt({ left: 0, top: 0, right: 0, bottom: 0 }, 0, 0), "center");
});

test("clamps the rail width into the allowed range", () => {
  assert.equal(clampDockRailWidth(420), 420);
  assert.equal(clampDockRailWidth(10), DOCK_RAIL_MIN_WIDTH);
  assert.equal(clampDockRailWidth(99_999), DOCK_RAIL_MAX_WIDTH);
  assert.equal(clampDockRailWidth("420"), null);
  assert.equal(clampDockRailWidth(Number.NaN), null);
});

test("keeps the resident icon strip inside the narrowest rail", () => {
  // 图标条常驻右栏左缘：右栏卡片宽度 = 列宽 − 右缘间距，收到最小列宽时也必须
  // 容得下图标条，否则入口会被裁掉。
  assert.ok(DOCK_RAIL_EDGE_GAP > 0);
  assert.ok(DOCK_RAIL_STRIP_WIDTH > 0);
  assert.ok(DOCK_RAIL_STRIP_WIDTH + DOCK_RAIL_EDGE_GAP <= DOCK_RAIL_MIN_WIDTH);
});

test("normalizes persisted layouts by dropping unknown structure", () => {
  assert.deepEqual(normalizeDockLayout(null), emptyDockLayout());
  assert.deepEqual(normalizeDockLayout("nope"), emptyDockLayout());

  const first = open(emptyDockLayout(), tab("terminal"));
  const split = open(first, tab("git"), { zone: "right", targetPaneId: first.root.id, splitId: "split-a" });
  const roundTripped = normalizeDockLayout(JSON.parse(JSON.stringify(split)));
  assert.deepEqual(roundTripped, split);

  // 树里引用了没有记录的标签、以及 id 非法的记录，都按无效丢弃；
  // 面板因为还剩一个有效标签而保留，激活项回退到该标签。
  const dirty = normalizeDockLayout({
    tabs: {
      "tab-terminal-": { id: "tab-terminal-", kind: "terminal", title: "terminal" },
      "tab-orphan": { id: "tab-orphan", kind: "git", title: "orphan" },
      bad: { id: "bad id", kind: "git", title: "boom" },
    },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-terminal-", "missing", "tab-orphan"], activeTabId: "tab-orphan" },
  });
  assert.deepEqual(Object.keys(dirty.tabs).sort(), ["tab-orphan", "tab-terminal-"]);
  assert.equal(dirty.root.activeTabId, "tab-orphan");

  const unreachable = normalizeDockLayout({
    tabs: {
      "tab-terminal-": { id: "tab-terminal-", kind: "terminal", title: "terminal" },
      ghost: { id: "ghost", kind: "git", title: "ghost" },
    },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-terminal-"], activeTabId: "ghost" },
  });
  assert.deepEqual(Object.keys(unreachable.tabs), ["tab-terminal-"]);
  assert.equal(unreachable.root.activeTabId, "tab-terminal-");

  const empty = normalizeDockLayout({ tabs: {}, root: { kind: "pane", id: "pane-1", tabIds: [], activeTabId: null } });
  assert.deepEqual(empty, emptyDockLayout());

  const singleChild = normalizeDockLayout({
    tabs: { "tab-terminal-": { id: "tab-terminal-", kind: "terminal", title: "terminal" } },
    root: { kind: "split", id: "split-1", axis: "row", children: [{ kind: "pane", id: "pane-1", tabIds: ["tab-terminal-"], activeTabId: "tab-terminal-" }], sizes: [1] },
  });
  assert.equal(singleChild.root.kind, "pane");
});

test("keeps unknown tab kinds so a newer layout is not wiped on downgrade", () => {
  const layout = normalizeDockLayout({
    tabs: { "tab-mystery": { id: "tab-mystery", kind: "mystery", title: "Mystery" } },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-mystery"], activeTabId: "tab-mystery" },
  });
  assert.equal(layout.tabs["tab-mystery"].kind, "mystery");

  const unknownKind = open(emptyDockLayout(), { id: "tab-x", kind: "mystery", title: "Mystery" });
  assert.equal(findDockTabByKey(unknownKind, "mystery").id, "tab-x");
});

test("normalizes tab payloads item by item instead of dropping the tab", () => {
  const layout = normalizeDockLayout({
    tabs: {
      "tab-git": {
        id: "tab-git",
        kind: "git-commit",
        title: "Commit",
        payload: {
          hash: "abc123",
          cwd: "D:/repo",
          droppedNumber: 42,
          droppedNull: null,
          "": "empty key",
          ["k".repeat(33)]: "key too long",
          long: "x".repeat(600),
        },
      },
    },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-git"], activeTabId: "tab-git" },
  });
  const payload = layout.tabs["tab-git"].payload;
  assert.deepEqual(Object.keys(payload).sort(), ["cwd", "hash", "long"]);
  assert.equal(payload.hash, "abc123");
  assert.equal(payload.long.length, 512);

  // 非对象、空对象、全非法值都视为没有附加数据
  const plain = normalizeDockLayout({
    tabs: { "tab-file": { id: "tab-file", kind: "file", title: "a.ts", path: "a.ts", payload: [1, 2] } },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-file"], activeTabId: "tab-file" },
  });
  assert.equal(plain.tabs["tab-file"].payload, undefined);
  const emptyPayload = normalizeDockLayout({
    tabs: { "tab-file": { id: "tab-file", kind: "file", title: "a.ts", path: "a.ts", payload: {} } },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-file"], activeTabId: "tab-file" },
  });
  assert.equal(emptyPayload.tabs["tab-file"].payload, undefined);

  // 键数上限：超出预算的键被丢弃，标签本身保留
  const many = {};
  for (let index = 0; index < 20; index += 1) many[`key${index}`] = "value";
  const bounded = normalizeDockLayout({
    tabs: { "tab-file": { id: "tab-file", kind: "file", title: "a.ts", path: "a.ts", payload: many } },
    root: { kind: "pane", id: "pane-1", tabIds: ["tab-file"], activeTabId: "tab-file" },
  });
  assert.equal(Object.keys(bounded.tabs["tab-file"].payload).length, 12);
});

test("decides whether a tab body is ready, foreign or unknown", () => {
  const known = (kind) => kind === "file" || kind === "git-commit";
  const gitTab = tab("git-commit", { payload: { cwd: "D:/Repo", hash: "abc" } });

  assert.equal(dockTabWorkspace(gitTab), "D:/Repo");
  assert.equal(dockTabWorkspace(tab("file", { path: "a.ts" })), null);
  // 分隔符、大小写、结尾斜杠归一后视为同一工作区
  assert.equal(dockTabBodyState(gitTab, "d:\\repo\\", known), "ready");
  assert.equal(dockTabBodyState(gitTab, "D:/other", known), "foreign");
  // 不携带归属信息的标签不受工作区限制
  assert.equal(dockTabBodyState(tab("file", { path: "a.ts" }), "D:/other", known), "ready");
  // 归属判定优先于类型判定：属于别的工作区时不去渲染
  assert.equal(dockTabBodyState(tab("mystery", { payload: { cwd: "D:/other" } }), "D:/repo", known), "foreign");
  assert.equal(dockTabBodyState(tab("mystery"), "D:/repo", known), "unknown");

  assert.equal(dockWorkspacesMatch(null, "D:/repo"), true);
  assert.equal(dockWorkspacesMatch("D:/repo", null), true);
  assert.equal(dockWorkspacesMatch("D:/repo", "D:/repo/"), true);
  assert.equal(dockWorkspacesMatch("D:/repo", "D:/other"), false);
});

test("panel tabs are left to DockFrame and never render a content notice", () => {
  const known = (kind) => kind === "file";
  // 面板类标签：正文由 DockFrame 自己搬进宿主，分发点必须什么都不渲染
  for (const kind of DOCK_PANEL_TAB_KINDS) {
    assert.equal(dockTabBodyState(tab(kind), "D:/repo", known), "panel");
    assert.equal(isDockPanelTabKind(kind), true);
  }
  // 内容标签不受影响
  assert.equal(dockTabBodyState(tab("file", { path: "a.ts" }), "D:/repo", known), "ready");
  assert.equal(dockTabBodyState(tab("mystery"), "D:/repo", known), "unknown");
  assert.equal(isDockPanelTabKind("mystery"), false);
});

test("every DockFrame panel in the components is registered as a panel tab kind", () => {
  const files = collectComponentFiles();
  const found = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/id="([a-z0-9-]+-dock)"/gu)) found.add(match[1]);
  }
  assert.ok(found.size > 0, "没有扫描到任何 DockFrame 面板 id");
  const unregistered = [...found].filter((kind) => !DOCK_PANEL_TAB_KINDS.includes(kind));
  assert.deepEqual(unregistered, [], `以下面板未登记进 DOCK_PANEL_TAB_KINDS，会在右栏多出一块说明：${unregistered.join(", ")}`);
  assert.equal(new Set(DOCK_PANEL_TAB_KINDS).size, DOCK_PANEL_TAB_KINDS.length, "面板类型列表存在重复项");
});
test("dedupes instance tabs by content key and keeps singleton kinds single", () => {
  // 文件类仍然按路径去重
  assert.equal(dockTabKey("file", "D:/repo/a.ts"), "file:d:/repo/a.ts");
  assert.equal(dockTabKey("file", "D:/repo/A.ts\\"), "file:d:/repo/a.ts");
  // 非文件类：有 contentKey 时按内容键区分实例
  assert.equal(dockTabKey("git-commit", undefined, "abc123"), "git-commit:abc123");
  assert.equal(dockTabKey("git-commit", undefined, "def456"), "git-commit:def456");
  // 没有 contentKey 的类型保持单例
  assert.equal(dockTabKey("terminal-dock"), "terminal-dock");

  let layout = open(emptyDockLayout(), { id: "tab-c1", kind: "git-commit", title: "one", contentKey: "abc123" });
  layout = open(layout, { id: "tab-c2", kind: "git-commit", title: "two", contentKey: "def456" });
  assert.equal(collectDockPanes(layout.root)[0].tabIds.length, 2);

  // 重复打开同一个提交是复用（并更新标题），不会开出第二个标签
  const reopened = open(layout, { id: "tab-dup", kind: "git-commit", title: "one renamed", contentKey: "abc123" });
  assert.equal(collectDockPanes(reopened.root)[0].tabIds.length, 2);
  assert.equal(findDockTabByKey(reopened, "git-commit:abc123").title, "one renamed");

  // 重启后 contentKey 仍在，去重语义不会丢
  const restored = normalizeDockLayout({ tabs: reopened.tabs, root: reopened.root });
  assert.equal(findDockTabByKey(restored, "git-commit:def456").contentKey, "def456");
});
