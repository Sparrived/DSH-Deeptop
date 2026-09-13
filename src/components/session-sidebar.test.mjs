// 侧栏收起守卫：收起只隐藏列表区块，通用动作按钮必须留在原位且保持可访问名称。
// 面板宽度、淡入淡出等呈现由 15-final-overrides.css 负责，这里只锁定 DOM 契约。

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

/** react 必须保持 external：与测试里的 react-dom 共用同一个实例，否则 hooks 直接抛错。 */
async function renderSidebar(overrides = {}) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./SessionSidebar.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react"],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, module, module.exports);
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  // useFloatingMenuPosition 用 useLayoutEffect，SSR 下 React 会打一条无害警告。
  const warn = console.error;
  console.error = () => {};
  try {
    return renderToStaticMarkup(createElement(module.exports.SessionSidebar, {
      locale: "zh",
      collapsed: false,
      onToggleCollapsed() {},
      search: "",
      onSearchChange() {},
      onSearch() {},
      onClearSearch() {},
      onNewSession() {},
      settingsOpen: false,
      onOpenSettings() {},
      onAddWorkspace() {},
      visibleSessions: [],
      archivedSessions: [],
      activeSessionView: { pinned: [], working: [] },
      onRestoreSession() {},
      onArchiveSessions() {},
      onDeleteArchivedSessions() {},
      selectedWorkspaceGroup: { workspace: null, workspaceId: "", sessions: [] },
      pinnedWorkspaceIds: [],
      onTogglePinWorkspace() {},
      onRenameWorkspace() {},
      onDeleteWorkspace() {},
      unpinnedSectionOpen: false,
      onUnpinnedSectionChange() {},
      sessionContextMenu: null,
      onRequestSessionAction() {},
      uiRuntime: {},
      uiLocale: "zh",
      uiHost: {},
      workspace: "D:\\Code\\DSH-Desktop",
      workspaces: [],
      workspaceMenuOpen: false,
      onToggleWorkspaceMenu() {},
      onChooseWorkspace() {},
      workspacePickerMenuRef: { current: null },
      activeSessionId: null,
      sessionIndicators: {},
      pendingSessionIds: new Set(),
      searchResultById: new Map(),
      workspaceBySessionId: new Map(),
      dragOverSessionId: null,
      draggedSessionRef: { current: null },
      onOpenSession() {},
      onToggleSessionPin() {},
      onMoveSessionBefore() {},
      onDragOverSessionChange() {},
      onSessionDragEnd() {},
      onSessionContextMenu() {},
      onDismissSessionContextMenu() {},
      ...overrides,
    }));
  } finally {
    console.error = warn;
  }
}

test("keeps every shared action available while expanded", async () => {
  const html = await renderSidebar();
  assert.match(html, /^<aside id="session-sidebar" class="session-sidebar">/);
  assert.match(html, /class="new-session-button"/);
  assert.match(html, /class="new-session-button-label">新建会话</);
  assert.match(html, /aria-label="打开设置"/);
  assert.match(html, /aria-label="添加工作目录"/);
  assert.match(html, /class="sidebar-collapse-button"/);
  assert.match(html, /aria-label="收起侧栏"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /class="search-box"/);
});

test("keeps only the shared action glyphs while collapsed", async () => {
  const html = await renderSidebar({ collapsed: true });
  assert.match(html, /^<aside id="session-sidebar" class="session-sidebar collapsed">/);
  // 新建会话沿用原有 + 字形，只是交给 CSS 隐藏文字标签。
  assert.match(html, /class="new-session-button-glyph"/);
  assert.match(html, /class="new-session-button-label">新建会话</);
  // 标题行退化成轨道上的「展开」图标；标题与视图按钮仍在 DOM 里，由 CSS 隐藏。
  assert.match(html, /class="sidebar-heading"/);
  assert.match(html, /class="sidebar-collapse-button"/);
  assert.match(html, /aria-label="展开侧栏"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="session-sidebar"/);
});
