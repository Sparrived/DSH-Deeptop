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
      activeSessionView: { pinned: [], working: [], total: 0 },
      knownSessionIds: new Set(),
      onRestoreSession() {},
      onArchiveSessions() {},
      onDeleteArchivedSessions() {},
      sessionDeleteAvailable: true,
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
  assert.match(html, /class="search-box"/);
  // 收起开关嵌在侧栏内部，收起前后都在同一个位置、同在 `</aside>` 之前。
  assert.match(html, /<button class="sidebar-toggle-handle"[^>]*aria-label="收起侧栏"[^>]*>[\s\S]*<\/button><\/aside>$/);
});

test("keeps only the shared action glyphs while collapsed", async () => {
  const html = await renderSidebar({ collapsed: true });
  assert.match(html, /^<aside id="session-sidebar" class="session-sidebar collapsed">/);
  // 新建会话沿用原有 + 字形，只是交给 CSS 隐藏文字标签。
  assert.match(html, /class="new-session-button-glyph"/);
  assert.match(html, /class="new-session-button-label">新建会话</);
  assert.match(html, /aria-label="打开设置"/);
  assert.match(html, /aria-label="添加工作目录"/);
  // 列表与标题行仍在 DOM 里，收起态只由 CSS 隐藏与淡出。
  assert.match(html, /class="sidebar-heading"/);
  assert.match(html, /class="session-list"/);
  assert.match(html, /<button class="sidebar-toggle-handle"[^>]*aria-label="展开侧栏"[^>]*>[\s\S]*<\/button><\/aside>$/);
});

/** 待处理会话（审批或提问挂起）的行内标记与标题计数，见 08-workbench-layout.css。 */
const pendingSession = {
  sessionId: "session-pending",
  cwd: "D:\\Code\\DSH-Desktop",
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
  projections: { values: { title: "等待审批的会话" } },
};

test("marks a session awaiting approval or a question", async () => {
  const html = await renderSidebar({
    selectedWorkspaceGroup: {
      workspace: null,
      workspaceId: "",
      sessions: [pendingSession],
    },
    pendingSessionIds: new Set([pendingSession.sessionId]),
  });

  // 待处理独立成状态类，且行内多出一个静态文字标记（不依赖动画）。
  assert.match(html, /class="session-row session-status-pending[^"]*"/);
  assert.match(html, /data-session-status="pending"/);
  assert.match(html, /class="session-row-main has-flag"/);
  assert.match(html, /class="session-row-flag">待处理</);
  assert.match(html, /aria-label="会话状态：待处理"/);
  // 标题旁的计数在列表被滚动或折叠时仍然可见。
  assert.match(html, /class="sidebar-pending-flag"[^>]*>1</);
  assert.match(html, /aria-label="1 个会话待处理"/);
});

test("leaves a plain session unmarked", async () => {
  const html = await renderSidebar({
    selectedWorkspaceGroup: {
      workspace: null,
      workspaceId: "",
      sessions: [pendingSession],
    },
  });

  assert.match(html, /class="session-row session-status-idle"/);
  assert.doesNotMatch(html, /session-row-flag/);
  assert.doesNotMatch(html, /sidebar-pending-flag/);
});
