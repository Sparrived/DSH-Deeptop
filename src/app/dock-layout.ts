/**
 * 可停靠右栏的纯布局模型：一棵通用布局树 + 一份标签登记表。
 *
 * 与上游 ui-dockkit 的建模一致：
 *
 * - 叶子是 `DockPaneNode`（标签列表 + 至多一个激活项），内部节点是
 *   `DockSplitNode`（沿 row/column 轴、按分数比例分配尺寸）。
 * - 一次停靠带五个落点 `DockZone`：`center` 并入目标面板的标签组，
 *   其余在对应侧开出分栏。
 * - 整份布局是一个不可变 `DockLayout`，每次改动都返回新对象；因此同一
 *   初始状态重放同一串操作会得到完全相同的布局，撤销/重做与持久化都
 *   建立在这条性质上。
 *
 * 本模块保持纯函数：不调用 React、Tauri 或桥接，可在 Node 测试中直接
 * 导入。新 id 一律由调用方传入，模型内部不生成随机值。
 */

export type DockZone = "center" | "top" | "right" | "bottom" | "left";
export type DockAxis = "row" | "column";

export type DockPaneNode = {
  kind: "pane";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
};

export type DockSplitNode = {
  kind: "split";
  id: string;
  axis: DockAxis;
  children: DockNode[];
  /** 与 children 等长、和为 1 的分数尺寸。 */
  sizes: number[];
};

export type DockNode = DockPaneNode | DockSplitNode;

/**
 * 停靠标签。`kind` 决定渲染哪一类内容，`path`/`line` 让文件类标签能把
 * 内容定位到行。`kind` 不设白名单：新增内容类型只需在渲染层登记，模型
 * 与持久化不需要跟着改。
 */
export type DockTab = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  /** 文件类标签的路径（原始形式，可能相对会话 cwd）。 */
  path?: string;
  /** 文件类标签的 1-based 定位行。 */
  line?: number;
  /**
   * 同一 `kind` 下区分实例的内容键（例如 `commit:<hash>`）。
   * 缺省时同一种 `kind` 只保留一个标签（终端、图谱这类单例面板）。
   */
  contentKey?: string;
  /**
   * 内容类型自己的附加数据（例如 git 标签的提交哈希与归属仓库）。
   * 键值都是字符串且有长度上限，归一化时逐项丢弃非法值而不是整条标签。
   */
  payload?: Record<string, string>;
};

export type DockLayout = {
  root: DockNode | null;
  tabs: Record<string, DockTab>;
};

/** 单侧分栏的最小/最大宽度（px）；与 Rust 端 dock_settings 的夹取范围一致。 */
export const DOCK_RAIL_MIN_WIDTH = 260;
export const DOCK_RAIL_MAX_WIDTH = 960;
export const DOCK_RAIL_DEFAULT_WIDTH = 420;
/** 空栏宽度：没有面板停靠时留给落点提示的宽度，与常驻图标条相加得到右栏宽度。 */
export const DOCK_RAIL_EMPTY_WIDTH = 132;
/**
 * 图标条宽度：面板入口常驻在右栏最左侧一条竖栏里，左侧 8px 让给宽度拖拽手柄，
 * 没有面板停靠时右栏就只占这一条，因此它是右栏的宽度下限而不是 0。
 */
export const DOCK_RAIL_STRIP_WIDTH = 64;

/**
 * "面板类"标签：正文由 `DockFrame` 自己搬进标签宿主，不属于内容注册表。
 * 渲染层必须对它们返回 null——否则面板上方会多出一块"类型未登记"的说明。
 * 新增 `DockFrame` 面板时把它的 id 加进来（有测试扫描组件源码防止漏登记）。
 */
export const DOCK_PANEL_TAB_KINDS: readonly string[] = [
  "deliverables-dock",
  "git-dock",
  "tasks-dock",
  "terminal-dock",
  "todo-dock",
  "workspace-files-dock",
];

/** 该标签是否由面板自己渲染正文（内容分发点应跳过）。 */
export function isDockPanelTabKind(kind: string): boolean {
  return DOCK_PANEL_TAB_KINDS.includes(kind);
}

/** 单个分栏内允许的最小分数占比，避免拖拽把某一侧压成 0。 */
const MIN_SPLIT_FRACTION = 0.08;
/** 布局树允许的最大节点数与 nesting 深度，用于持久化输入的归一化。 */
const MAX_LAYOUT_NODES = 64;
const MAX_LAYOUT_DEPTH = 8;
/** 标签附加数据的体积上限：键数 / 键长 / 值长，逐项丢弃超限项。 */
const MAX_PAYLOAD_KEYS = 12;
const MAX_PAYLOAD_KEY_LENGTH = 32;
const MAX_PAYLOAD_VALUE_LENGTH = 512;

export function emptyDockLayout(): DockLayout {
  return { root: null, tabs: {} };
}

/** 与 Rust 端 id 校验规则保持一致：非空、≤100 字符、字母数字或 -_。 */
export function isValidDockLayoutId(id: unknown): id is string {
  return typeof id === "string"
    && id.length > 0
    && id.length <= 100
    && /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * 标签的身份键：文件类按归一化路径去重；其余类型按 `contentKey` 去重，
 * 没有 `contentKey` 时同一种 `kind` 只保留一个实例（终端、图谱这类单例面板）。
 * 重复打开同一个键是「复用并定位」，而不是再开一个标签。
 */
export function dockTabKey(kind: string, path?: string, contentKey?: string): string {
  if (kind === "file") return `file:${normalizeDockPath(path ?? "")}`;
  if (contentKey) return `${kind}:${contentKey}`;
  return kind;
}

/** 一条已存在标签的身份键。 */
export function dockTabIdentityKey(tab: DockTab): string {
  return dockTabKey(tab.kind, tab.path, tab.contentKey);
}

/** 统一路径分隔符并去掉首尾空白，让同一文件的两种写法落到同一个键。 */
function normalizeDockPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findDockTabByKey(layout: DockLayout, key: string): DockTab | null {
  for (const tab of Object.values(layout.tabs)) {
    if (dockTabIdentityKey(tab) === key) return tab;
  }
  return null;
}

export function collectDockPanes(node: DockNode | null): DockPaneNode[] {
  if (!node) return [];
  if (node.kind === "pane") return [node];
  return node.children.flatMap((child) => collectDockPanes(child));
}

export function findDockPane(node: DockNode | null, paneId: string): DockPaneNode | null {
  if (!node) return null;
  if (node.kind === "pane") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findDockPane(child, paneId);
    if (found) return found;
  }
  return null;
}

export function findDockPaneOfTab(node: DockNode | null, tabId: string): DockPaneNode | null {
  if (!node) return null;
  if (node.kind === "pane") return node.tabIds.includes(tabId) ? node : null;
  for (const child of node.children) {
    const found = findDockPaneOfTab(child, tabId);
    if (found) return found;
  }
  return null;
}

function containsPane(node: DockNode, paneId: string): boolean {
  return findDockPane(node, paneId) !== null;
}

/** 边落点沿哪条轴开分栏：左右为 row，上下为 column。 */
export function dockAxisForZone(zone: DockZone): DockAxis {
  return zone === "left" || zone === "right" ? "row" : "column";
}

/** 新面板是否排在目标面板之前（左/上）。 */
function dockZoneLeads(zone: DockZone): boolean {
  return zone === "left" || zone === "top";
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function makePane(id: string, tabIds: string[], activeTabId: string | null): DockPaneNode {
  return { kind: "pane", id, tabIds, activeTabId };
}

type InsertIds = {
  /** 需要新建面板时使用的 id。 */
  paneId: string;
  /** 需要新建分栏时使用的 id。 */
  splitId: string;
};

/**
 * 把新面板插入到目标面板旁。目标所在分栏已是同轴时直接成为它的兄弟，
 * 否则把目标面板包成新的同轴分栏——与上游 `SplitNode` 的做法一致。
 */
function insertPaneBeside(node: DockNode, targetPaneId: string, newPane: DockPaneNode, zone: DockZone, splitId: string): DockNode {
  const axis = dockAxisForZone(zone);
  if (node.kind === "pane") {
    const children = dockZoneLeads(zone) ? [newPane, node] : [node, newPane];
    return { kind: "split", id: splitId, axis, children, sizes: equalSizes(2) };
  }
  const index = node.children.findIndex((child) => containsPane(child, targetPaneId));
  if (index < 0) return node;
  const child = node.children[index];
  if (child.kind === "pane" && child.id === targetPaneId && node.axis === axis) {
    const at = dockZoneLeads(zone) ? index : index + 1;
    const children = [...node.children.slice(0, at), newPane, ...node.children.slice(at)];
    return { ...node, children, sizes: equalSizes(children.length) };
  }
  const next = insertPaneBeside(child, targetPaneId, newPane, zone, splitId);
  if (next === child) return node;
  return { ...node, children: node.children.map((item, at) => (at === index ? next : item)) };
}

function removeTabFromNode(node: DockNode | null, tabId: string): DockNode | null {
  if (!node) return null;
  if (node.kind === "pane") {
    if (!node.tabIds.includes(tabId)) return node;
    const tabIds = node.tabIds.filter((id) => id !== tabId);
    if (tabIds.length === 0) return null;
    let activeTabId = node.activeTabId;
    if (activeTabId === tabId || !activeTabId || !tabIds.includes(activeTabId)) {
      const removedAt = node.tabIds.indexOf(tabId);
      activeTabId = tabIds[Math.min(Math.max(removedAt, 0), tabIds.length - 1)] ?? null;
    }
    return { ...node, tabIds, activeTabId };
  }
  const kept: Array<{ child: DockNode; size: number }> = [];
  node.children.forEach((child, index) => {
    const next = removeTabFromNode(child, tabId);
    if (next) kept.push({ child: next, size: node.sizes[index] ?? 1 / node.children.length });
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].child;
  const total = kept.reduce((sum, item) => sum + item.size, 0) || 1;
  return {
    ...node,
    children: kept.map((item) => item.child),
    sizes: kept.map((item) => item.size / total),
  };
}

/**
 * 把标签记录插进布局树并激活。
 *
 * 未指定目标面板时：树为空就开第一个面板，否则并入最左侧面板的标签组
 * ——launcher 点击与「拖到右栏空白处」都走这条路径。
 */
function insertTab(layout: DockLayout, tab: DockTab, zone: DockZone, targetPaneId: string | null, ids: InsertIds): DockLayout {
  const firstPane = collectDockPanes(layout.root)[0] ?? null;
  const targetPane = targetPaneId ? findDockPane(layout.root, targetPaneId) : null;
  if (!layout.root && !targetPane) {
    const pane = makePane(ids.paneId, [tab.id], tab.id);
    return { root: pane, tabs: { ...layout.tabs, [tab.id]: tab } };
  }
  const anchor = targetPane ?? firstPane;
  if (!anchor) {
    const pane = makePane(ids.paneId, [tab.id], tab.id);
    return { root: pane, tabs: { ...layout.tabs, [tab.id]: tab } };
  }
  if (zone === "center") {
    const next: DockPaneNode = { ...anchor, tabIds: [...anchor.tabIds, tab.id], activeTabId: tab.id };
    const root = replacePane(layout.root, anchor.id, next);
    return { root, tabs: { ...layout.tabs, [tab.id]: tab } };
  }
  const newPane = makePane(ids.paneId, [tab.id], tab.id);
  const root = layout.root ? insertPaneBeside(layout.root, anchor.id, newPane, zone, ids.splitId) : newPane;
  return { root, tabs: { ...layout.tabs, [tab.id]: tab } };
}

/** 用同一个 id 的新面板替换树中的旧面板。 */
function replacePane(node: DockNode | null, paneId: string, next: DockPaneNode): DockNode | null {
  if (!node) return null;
  if (node.kind === "pane") return node.id === paneId ? next : node;
  return { ...node, children: node.children.map((child) => replacePane(child, paneId, next) as DockNode) };
}

/**
 * 打开（或聚焦）一个停靠标签。
 *
 * 与上游一致：按 `(kind, contentId)` 去重的标签已存在时只复用并 reveal，
 * 不会开出第二个；重复点击会更新定位行并把它带到请求的面板。
 */
export function openDockTab(
  layout: DockLayout,
  tab: DockTab,
  options: { zone?: DockZone; targetPaneId?: string | null; paneId: string; splitId: string },
): DockLayout {
  const zone = options.zone ?? "center";
  const targetPaneId = options.targetPaneId ?? null;
  const existing = findDockTabByKey(layout, dockTabKey(tab.kind, tab.path, tab.contentKey));
  if (existing) {
    const updated: DockTab = { ...existing, ...tab, id: existing.id, line: tab.line ?? existing.line };
    const withTab: DockLayout = { ...layout, tabs: { ...layout.tabs, [existing.id]: updated } };
    const pane = findDockPaneOfTab(withTab.root, existing.id);
    if (!targetPaneId || !pane || pane.id === targetPaneId) {
      return { ...withTab, root: pane ? replacePane(withTab.root, pane.id, { ...pane, activeTabId: existing.id }) : withTab.root };
    }
    const detached = removeTabFromNode(withTab.root, existing.id);
    const pruned: DockLayout = {
      root: detached,
      tabs: withTab.tabs,
    };
    return insertTab(pruned, updated, zone, targetPaneId, options);
  }
  return insertTab(layout, tab, zone, targetPaneId, options);
}

/** 把一个已存在的标签移动到新的落点。 */
export function moveDockTab(
  layout: DockLayout,
  tabId: string,
  options: { zone: DockZone; targetPaneId?: string | null; paneId: string; splitId: string },
): DockLayout {
  const tab = layout.tabs[tabId];
  const pane = findDockPaneOfTab(layout.root, tabId);
  if (!tab || !pane) return layout;
  const targetPaneId = options.targetPaneId ?? null;
  if (options.zone === "center" && (!targetPaneId || targetPaneId === pane.id)) {
    return { ...layout, root: replacePane(layout.root, pane.id, { ...pane, activeTabId: tabId }) };
  }
  const root = removeTabFromNode(layout.root, tabId);
  // 目标面板若只剩这一个标签，移除后可能已被折叠掉；此时退回并入第一个面板。
  const pruned: DockLayout = { root, tabs: layout.tabs };
  const stillThere = targetPaneId ? findDockPane(root, targetPaneId) : null;
  return insertTab(pruned, tab, options.zone, stillThere?.id ?? null, options);
}

export function activateDockTab(layout: DockLayout, tabId: string): DockLayout {
  const pane = findDockPaneOfTab(layout.root, tabId);
  if (!pane || pane.activeTabId === tabId) return layout;
  return { ...layout, root: replacePane(layout.root, pane.id, { ...pane, activeTabId: tabId }) };
}

/**
 * 把文件标签改指到另一个文件（图片预览在标签内翻到兄弟图片时用它）。
 *
 * 标签的身份是路径（`dockTabKey` 的 `file:<路径>`），所以「标签里换了文件」
 * 必须同时改 `path`：否则标签会顶着一个文件的名字显示另一个文件，之后按
 * 原路径再打开时还会另开一个重复标签。定位行属于被替换的那个文件，未显式
 * 给出时一并清掉。
 *
 * 目标文件已经有一个标签时不再造出重复路径：改为激活那个标签并关掉当前
 * 标签，与 `openDockTab`「重复打开同一个键是复用并定位」的语义保持一致。
 */
export function retargetFileTab(
  layout: DockLayout,
  tabId: string,
  target: { path: string; title: string; detail?: string; line?: number },
): DockLayout {
  const current = layout.tabs[tabId];
  if (!current || current.kind !== "file") return layout;
  const existing = findDockTabByKey(layout, dockTabKey("file", target.path));
  if (existing && existing.id !== tabId) {
    return activateDockTab(closeDockTab(layout, tabId), existing.id);
  }
  const updated: DockTab = { ...current, path: target.path, title: target.title };
  if (target.detail === undefined) delete updated.detail;
  else updated.detail = target.detail;
  if (target.line === undefined) delete updated.line;
  else updated.line = target.line;
  return activateDockTab({ ...layout, tabs: { ...layout.tabs, [tabId]: updated } }, tabId);
}

/** 关闭标签；空面板被移除，只剩一个孩子的分栏被折叠成该孩子。 */
export function closeDockTab(layout: DockLayout, tabId: string): DockLayout {
  if (!layout.tabs[tabId]) return layout;
  const tabs = { ...layout.tabs };
  delete tabs[tabId];
  return { root: removeTabFromNode(layout.root, tabId), tabs };
}

/** 关闭某个面板的全部标签，用于「关闭标签组」。 */
export function closeDockPane(layout: DockLayout, paneId: string): DockLayout {
  const pane = findDockPane(layout.root, paneId);
  if (!pane) return layout;
  return pane.tabIds.reduce((next, tabId) => closeDockTab(next, tabId), layout);
}

/** 把某个标签移到同轴相邻位（标签组内的键盘/按钮重排）。 */
export function reorderDockTab(layout: DockLayout, tabId: string, offset: number): DockLayout {
  const pane = findDockPaneOfTab(layout.root, tabId);
  if (!pane) return layout;
  const from = pane.tabIds.indexOf(tabId);
  const to = Math.min(Math.max(from + offset, 0), pane.tabIds.length - 1);
  if (from === to) return layout;
  const tabIds = [...pane.tabIds];
  tabIds.splice(from, 1);
  tabIds.splice(to, 0, tabId);
  return { ...layout, root: replacePane(layout.root, pane.id, { ...pane, tabIds }) };
}

/**
 * 拖动分栏分隔条：把 `index` 与 `index + 1` 两个孩子的合计分数在两者间
 * 重新分配，各自不低于 `MIN_SPLIT_FRACTION`。
 */
export function resizeDockSplit(layout: DockLayout, splitId: string, index: number, fraction: number): DockLayout {
  const update = (node: DockNode): DockNode => {
    if (node.kind === "pane") return node;
    if (node.id === splitId) return resizeSplitChildren(node, index, fraction);
    return { ...node, children: node.children.map(update) };
  };
  if (!layout.root) return layout;
  return { ...layout, root: update(layout.root) };
}

function resizeSplitChildren(node: DockSplitNode, index: number, fraction: number): DockSplitNode {
  if (index < 0 || index + 1 >= node.sizes.length) return node;
  const first = node.sizes[index];
  const second = node.sizes[index + 1];
  const total = first + second;
  const next = Math.min(Math.max(fraction * total, MIN_SPLIT_FRACTION), total - MIN_SPLIT_FRACTION);
  if (!Number.isFinite(next) || next === first) return node;
  const sizes = [...node.sizes];
  sizes[index] = next;
  sizes[index + 1] = total - next;
  return { ...node, sizes };
}

/**
 * 命中测试：用指针在面板矩形内的位置决定落点。贴近某条边（边带宽度为
 * 面板短边的 1/4）就是该侧落点，否则并入标签组。
 */
export function dockZoneAt(
  rect: { left: number; top: number; right: number; bottom: number },
  x: number,
  y: number,
): DockZone {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return "center";
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return "center";
  const band = Math.min(width, height) * 0.25;
  const distances: Array<{ zone: DockZone; distance: number }> = [
    { zone: "left", distance: x - rect.left },
    { zone: "right", distance: rect.right - x },
    { zone: "top", distance: y - rect.top },
    { zone: "bottom", distance: rect.bottom - y },
  ];
  let best = distances[0];
  for (const candidate of distances) {
    if (candidate.distance < best.distance) best = candidate;
  }
  return best.distance <= band ? best.zone : "center";
}

export function clampDockRailWidth(px: unknown): number | null {
  if (typeof px !== "number" || !Number.isFinite(px)) return null;
  const width = Math.round(px);
  if (width < DOCK_RAIL_MIN_WIDTH) return DOCK_RAIL_MIN_WIDTH;
  if (width > DOCK_RAIL_MAX_WIDTH) return DOCK_RAIL_MAX_WIDTH;
  return width;
}

function normalizeSizes(raw: unknown, count: number): number[] {
  const values = Array.isArray(raw) ? raw : [];
  const sizes = values.slice(0, count).map((value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0));
  if (sizes.length !== count) return equalSizes(count);
  const total = sizes.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return equalSizes(count);
  return sizes.map((value) => (value > 0 ? value / total : 0));
}

function normalizeNode(raw: unknown, depth: number, budget: { nodes: number }): DockNode | null {
  if (!raw || typeof raw !== "object" || depth > MAX_LAYOUT_DEPTH || budget.nodes <= 0) return null;
  const source = raw as Record<string, unknown>;
  if (source.kind === "pane") {
    if (!isValidDockLayoutId(source.id)) return null;
    const tabIds = (Array.isArray(source.tabIds) ? source.tabIds : []).filter(isValidDockLayoutId);
    if (tabIds.length === 0) return null;
    budget.nodes -= 1;
    const active = typeof source.activeTabId === "string" && tabIds.includes(source.activeTabId)
      ? source.activeTabId
      : tabIds[0];
    return makePane(source.id, tabIds, active);
  }
  if (source.kind === "split") {
    if (!isValidDockLayoutId(source.id)) return null;
    const children = (Array.isArray(source.children) ? source.children : [])
      .map((child) => normalizeNode(child, depth + 1, budget))
      .filter((child): child is DockNode => child !== null);
    if (children.length < 2) return children[0] ?? null;
    budget.nodes -= 1;
    return {
      kind: "split",
      id: source.id,
      axis: source.axis === "column" ? "column" : "row",
      children,
      sizes: normalizeSizes(source.sizes, children.length),
    };
  }
  return null;
}

function normalizeTab(raw: unknown): DockTab | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (!isValidDockLayoutId(source.id)) return null;
  if (typeof source.kind !== "string" || !isValidDockLayoutId(source.kind)) return null;
  if (typeof source.title !== "string" || source.title.length === 0) return null;
  const tab: DockTab = { id: source.id, kind: source.kind, title: source.title.slice(0, 200) };
  if (typeof source.detail === "string") tab.detail = source.detail.slice(0, 200);
  if (typeof source.contentKey === "string" && source.contentKey.trim().length > 0) {
    tab.contentKey = source.contentKey.trim().slice(0, 200);
  }
  if (typeof source.path === "string" && source.path.length > 0) tab.path = source.path.slice(0, 4096);
  if (typeof source.line === "number" && Number.isInteger(source.line) && source.line > 0) tab.line = source.line;
  const payload = normalizeTabPayload(source.payload);
  if (payload) tab.payload = payload;
  return tab;
}

/**
 * 归一化标签附加数据：只保留字符串键值，超长值截断，超出键数预算的键丢弃。
 * 返回 undefined 表示这条标签没有可用的附加数据。
 */
function normalizeTabPayload(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const payload: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_PAYLOAD_KEYS) break;
    if (key.length === 0 || key.length > MAX_PAYLOAD_KEY_LENGTH) continue;
    if (typeof value !== "string") continue;
    payload[key] = value.slice(0, MAX_PAYLOAD_VALUE_LENGTH);
    count += 1;
  }
  return count > 0 ? payload : undefined;
}

/** 标签归属的工作区根目录；不携带归属信息的标签返回 null（表示不限工作区）。 */
export function dockTabWorkspace(tab: DockTab): string | null {
  const cwd = tab.payload?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
}

/** 两个工作区路径是否指同一处：大小写、分隔符与结尾斜杠归一后比较；
 * 任一侧缺失都视为“不限工作区”。 */
export function dockWorkspacesMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return true;
  return normalizeDockPath(left) === normalizeDockPath(right);
}

export type DockTabBodyState = "ready" | "foreign" | "unknown" | "panel";

/**
 * 判定某个标签在给定工作区下该渲染什么：
 * - `foreign`：标签属于另一个工作区（例如切了工作区但 git 标签还留在布局里）；
 * - `unknown`：内容类型没有在渲染层登记；
 * - `ready`：交给登记过的渲染器。
 */
export function dockTabBodyState(
  tab: DockTab,
  workspace: string | null,
  isKnownKind: (kind: string) => boolean,
): DockTabBodyState {
  // 面板类标签的正文由面板自己挂进宿主，内容分发点什么都不该渲染
  if (isDockPanelTabKind(tab.kind)) return "panel";
  if (!dockWorkspacesMatch(dockTabWorkspace(tab), workspace)) return "foreign";
  return isKnownKind(tab.kind) ? "ready" : "unknown";
}

/**
 * 归一化持久化输入：丢弃结构非法的节点与标签，只保留树里真实存在的标签
 * 记录，并把尺寸重新配平成和为 1 的分数。
 */
export function normalizeDockLayout(raw: unknown): DockLayout {
  if (!raw || typeof raw !== "object") return emptyDockLayout();
  const source = raw as Record<string, unknown>;
  const tabs: Record<string, DockTab> = {};
  const rawTabs = source.tabs && typeof source.tabs === "object" ? (source.tabs as Record<string, unknown>) : {};
  for (const value of Object.values(rawTabs)) {
    const tab = normalizeTab(value);
    if (tab) tabs[tab.id] = tab;
  }
  const root = normalizeNode(source.root, 0, { nodes: MAX_LAYOUT_NODES });
  if (!root) return emptyDockLayout();
  const reachable = new Set<string>();
  for (const pane of collectDockPanes(root)) {
    for (const tabId of pane.tabIds) {
      if (tabs[tabId]) reachable.add(tabId);
    }
  }
  if (reachable.size === 0) return emptyDockLayout();
  const keptTabs: Record<string, DockTab> = {};
  for (const tabId of reachable) keptTabs[tabId] = tabs[tabId];
  const prune = (node: DockNode): DockNode | null => {
    if (node.kind === "pane") {
      const tabIds = node.tabIds.filter((id) => reachable.has(id));
      if (tabIds.length === 0) return null;
      return makePane(node.id, tabIds, node.activeTabId && tabIds.includes(node.activeTabId) ? node.activeTabId : tabIds[0]);
    }
    const kept: Array<{ child: DockNode; size: number }> = [];
    node.children.forEach((child, index) => {
      const next = prune(child);
      if (next) kept.push({ child: next, size: node.sizes[index] ?? 1 / node.children.length });
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0].child;
    const total = kept.reduce((sum, item) => sum + item.size, 0) || 1;
    return {
      ...node,
      children: kept.map((item) => item.child),
      sizes: kept.map((item) => item.size / total),
    };
  };
  const pruned = prune(root);
  if (!pruned) return emptyDockLayout();
  return { root: pruned, tabs: keptTabs };
}
