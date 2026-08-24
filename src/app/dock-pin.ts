/**
 * Dock 钉住模式的纯模型：状态归一化与钉住分栏层宽度计算。
 *
 * 钉住的 Dock 卡片经 portal 渲染进 workspace-layout 的流内分栏层
 * （左/右各一列），对话列由网格布局天然让位。这里集中维护各 Dock
 * 的分栏宽度与逐侧求和逻辑，供 App 与 DockFrame 共用。
 */

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

export type PinLayerWidths = {
  left: number;
  right: number;
};

export type PinLayerWidthsInput = {
  pinned: Record<string, boolean>;
  /** 各可钉住 Dock 当前是否处于展开状态（未列出的视为收起）。 */
  expandedById: Record<string, boolean>;
};

/**
 * 计算左右两个钉住分栏层的总宽度：只累加"已钉住且展开"的 Dock 分栏宽。
 * 收起的钉住 Dock 不占位；同侧多个钉住 Dock 宽度求和，卡片在层内纵向堆叠。
 */
export function computePinLayerWidths({ pinned, expandedById }: PinLayerWidthsInput): PinLayerWidths {
  let left = 0;
  let right = 0;
  for (const dock of PINNABLE_DOCKS) {
    if (!isDockPinned(pinned, dock.id) || expandedById[dock.id] !== true) continue;
    if (dock.side === "left") left += dock.width;
    else right += dock.width;
  }
  return { left, right };
}

/** 钉住分栏层允许的宽度范围；与 Rust 端 dock_settings 的夹取范围保持一致。 */
export const PIN_LAYER_MIN_WIDTH = 220;
export const PIN_LAYER_MAX_WIDTH = 800;

export type PinLayerCustomWidths = {
  left?: number | null;
  right?: number | null;
};

/** 把任意输入夹取为合法的分栏宽度；无法解释时返回 null。 */
export function clampPinLayerWidth(px: unknown): number | null {
  if (typeof px !== "number" || !Number.isFinite(px)) return null;
  const width = Math.round(px);
  if (width < PIN_LAYER_MIN_WIDTH) return PIN_LAYER_MIN_WIDTH;
  if (width > PIN_LAYER_MAX_WIDTH) return PIN_LAYER_MAX_WIDTH;
  return width;
}

/**
 * 合成最终分栏宽度：仅当该侧存在激活的分栏时，才应用用户拖拽出的自定义
 * 宽度（夹取后）；否则回退到按 Dock 求和的默认值。
 */
export function resolvePinLayerWidths({
  computed,
  custom,
}: {
  computed: PinLayerWidths;
  custom?: PinLayerCustomWidths | null;
}): PinLayerWidths {
  const resolveSide = (side: DockPinSide): number => {
    if (computed[side] <= 0) return 0;
    return clampPinLayerWidth(custom?.[side]) ?? computed[side];
  };
  return { left: resolveSide("left"), right: resolveSide("right") };
}
