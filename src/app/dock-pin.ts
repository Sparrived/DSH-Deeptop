/**
 * Dock 钉住模式的纯模型：状态归一化与对话面板让位宽度计算。
 *
 * 钉住的 Dock 从"浮动卡片"切换为"固定分栏"：对话面板让出
 * `轨道宽 + 弹出间距 + 卡片宽` 的水平空间。这里集中维护各 Dock 的
 * 分栏宽度与让位求和逻辑，供 App 与 DockFrame 共用。
 */

export const DOCK_RAIL_WIDTH = 44;
export const DOCK_PIN_GAP = 12;
/** 货架相对对话舞台的内缩（--surface-scrollbar-gap），每侧只计一次。 */
export const DOCK_SHELF_INSET = 16;

export type DockPinSide = "left" | "right";

export type PinnableDock = {
  id: string;
  side: DockPinSide;
  /** 钉住分栏的桌面端宽度上限；与各 dock 样式中的面板宽度变量保持一致。 */
  width: number;
};

export const PINNABLE_DOCKS: readonly PinnableDock[] = [
  { id: "terminal-dock", side: "left", width: 560 },
  { id: "workspace-files-dock", side: "left", width: 480 },
  { id: "git-dock", side: "left", width: 600 },
  { id: "tasks-dock", side: "right", width: 286 },
  { id: "todo-dock", side: "right", width: 286 },
  { id: "subagent-dock", side: "right", width: 286 },
  { id: "deliverables-dock", side: "right", width: 286 },
];

const PINNABLE_BY_ID = new Map(PINNABLE_DOCKS.map((dock) => [dock.id, dock]));

/** 与 Rust 端 dock id 校验规则保持一致：非空、≤100 字符、字母数字或 -_。 */
export function isValidDockId(id: unknown): id is string {
  return typeof id === "string"
    && id.length > 0
    && id.length <= 100
    && /^[A-Za-z0-9_-]+$/.test(id);
}

/** 过滤非法键值，只保留已知可钉住 Dock 的布尔状态。 */
export function normalizePinnedDocks(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const normalized: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(source)) {
    if (isValidDockId(id) && PINNABLE_BY_ID.has(id) && typeof value === "boolean") {
      normalized[id] = value;
    }
  }
  return normalized;
}

export function isDockPinned(pinned: Record<string, boolean>, id: string): boolean {
  return pinned[id] === true;
}

/** 返回新的钉住映射；false 时移除键，避免配置文件积累无效条目。 */
export function withDockPinned(pinned: Record<string, boolean>, id: string, next: boolean): Record<string, boolean> {
  if (!isValidDockId(id) || !PINNABLE_BY_ID.has(id)) return pinned;
  const updated: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(pinned)) {
    if (value === true) updated[key] = true;
  }
  if (next) updated[id] = true;
  else delete updated[id];
  return updated;
}

function pinReserve(dock: PinnableDock): number {
  return DOCK_RAIL_WIDTH + DOCK_PIN_GAP + dock.width;
}

export type ConversationPaddingInput = {
  pinned: Record<string, boolean>;
  /** 各可钉住 Dock 当前是否处于展开状态（未列出的视为收起）。 */
  expandedById: Record<string, boolean>;
  /** 未钉住 Todo 沿用既有 CSS 让位规则时需要的会话可见性状态。 */
  todoVisible: boolean;
  todoCollapsed: boolean;
};

export type ConversationPadding = {
  left: number;
  right: number;
};

// 对应既有规则：`.workspace-layout.todo-visible(.todo-collapsed) > .conversation-panel`
// 的 `padding-right: calc(var(--todo-panel-width|--todo-collapsed-width) + 32px)`。
const TODO_LEGACY_EXPANDED_RESERVE = 286 + 32;
const TODO_LEGACY_COLLAPSED_RESERVE = 44 + 32;

/**
 * 计算对话面板在桌面上需要让位的左右内边距。
 *
 * - 左右各自对"已钉住且展开"的 Dock 求 `轨道 + 间距 + 分栏宽` 之和；
 * - Todo 未钉住时沿用旧 CSS 规则的让位值，避免钉住其他 Dock 后丢失既有行为；
 *   Todo 已钉住且展开时由分栏求和覆盖，不再叠加旧值；
 * - 返回值同时用于决定 workspace-layout 是否挂 `pin-padded` 类，
 *   该类在层叠中覆盖旧的 Todo 让位规则，统一由这里接管内边距。
 */
export function computeConversationPadding(input: ConversationPaddingInput): ConversationPadding {
  const { pinned, expandedById } = input;
  let left = 0;
  let right = 0;
  let leftPinned = false;
  let rightPinned = false;
  for (const dock of PINNABLE_DOCKS) {
    if (!isDockPinned(pinned, dock.id) || expandedById[dock.id] !== true) continue;
    if (dock.side === "left") { left += pinReserve(dock); leftPinned = true; }
    else { right += pinReserve(dock); rightPinned = true; }
  }
  // 货架本身相对舞台内缩一段，每侧有钉住分栏时补计一次。
  if (leftPinned) left += DOCK_SHELF_INSET;
  if (rightPinned) right += DOCK_SHELF_INSET;

  const todoPinnedExpanded = isDockPinned(pinned, "todo-dock") && expandedById["todo-dock"] === true;
  if (!todoPinnedExpanded) {
    if (input.todoVisible && !input.todoCollapsed) right += TODO_LEGACY_EXPANDED_RESERVE;
    else if (input.todoVisible && input.todoCollapsed) right += TODO_LEGACY_COLLAPSED_RESERVE;
  }

  return { left, right };
}

/** 是否有任意一侧产生让位；决定 workspace-layout 的 pin-padded 类。 */
export function hasConversationPadding(padding: ConversationPadding): boolean {
  return padding.left > 0 || padding.right > 0;
}
