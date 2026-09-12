import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getDockSettings, isTauri, setDockSettings, type DockSettings } from "../lib/desktop";
import {
  DOCK_RAIL_DEFAULT_WIDTH,
  activateDockTab,
  clampDockRailWidth,
  closeDockPane,
  closeDockTab,
  collectDockPanes,
  dockTabKey,
  dockZoneAt,
  emptyDockLayout,
  findDockTabByKey,
  moveDockTab,
  normalizeDockLayout,
  openDockTab,
  reorderDockTab,
  resizeDockSplit,
  type DockLayout,
  type DockPaneNode,
  type DockTab,
  type DockZone,
} from "./dock-layout";

/**
 * 可停靠右栏的共享状态：布局、右栏宽度、拖拽会话与面板挂载点。
 *
 * 布局本身是 `dock-layout` 的纯不可变模型，这里只负责三件事：
 *
 * 1. 把每次操作产生的**新**布局通过 Tauri 持久化（不使用浏览器存储）。
 * 2. 承载一次拖拽会话：拖拽源分别在浮动面板标题栏与右栏标签上，落点
 *    解析与高亮在这里统一，避免两处各写一套命中测试。
 * 3. 登记挂载点：右栏把每个标签的宿主元素登记进来，DockFrame 把自己的
 *    内容容器挂上去——容器是 DockFrame 自己创建的游离节点，因此内容组件
 *    在「浮动 ↔ 停靠」之间移动时不会被卸载重建。
 */

export type DockDragPayload =
  | { source: "tab"; tabId: string }
  | { source: "panel"; tab: DockTab };

export type DockDragTarget = { paneId: string; zone: DockZone };

export type DockDragState = {
  payload: DockDragPayload;
  x: number;
  y: number;
  target: DockDragTarget | null;
};

export type DockOpenOptions = {
  zone?: DockZone;
  targetPaneId?: string | null;
};

type DockSettingsContextValue = {
  settings: DockSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<DockSettings>) => Promise<void>;
  /** 当前布局树；不可变，每次改动产生新对象。 */
  layout: DockLayout;
  /** 按标签身份键查找已停靠的标签；未停靠返回 null。 */
  findTabByKey: (key: string) => DockTab | null;
  openTab: (tab: Omit<DockTab, "id"> & { id?: string }, options?: DockOpenOptions) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closePane: (paneId: string) => void;
  moveTab: (tabId: string, options: DockOpenOptions & { zone: DockZone }) => void;
  reorderTab: (tabId: string, offset: number) => void;
  resizeSplit: (splitId: string, index: number, fraction: number) => void;
  resetLayout: () => void;
  panes: DockPaneNode[];
  /** 一次拖拽会话；为 null 表示当前没有拖拽。 */
  drag: DockDragState | null;
  beginDockDrag: (payload: DockDragPayload, x: number, y: number) => void;
  updateDockDrag: (x: number, y: number) => void;
  /** 结束拖拽并返回会话；给出松手坐标时按该坐标重新解析落点。 */
  endDockDrag: (x?: number, y?: number) => DockDragState | null;
  cancelDockDrag: () => void;
  registerPaneElement: (paneId: string, element: HTMLElement | null) => void;
  registerTabElement: (tabId: string, element: HTMLElement | null) => void;
  /** 右栏根元素的登记；空栏时也允许把面板拖进来开出第一个面板。 */
  registerRailElement: (element: HTMLElement | null) => void;
  tabElements: Readonly<Record<string, HTMLElement>>;
  railWidth: number;
  setRailWidth: (width: number) => void;
  resetRailWidth: () => void;
};

const DockSettingsContext = createContext<DockSettingsContextValue | null>(null);

let dockIdCounter = 0;

/** 生成布局树内部 id；只需满足与 Rust 端一致的字符集约束。 */
function nextDockId(prefix: string): string {
  dockIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${dockIdCounter.toString(36)}`;
}

function normalizeSettings(settings: Partial<DockSettings> | null | undefined): DockSettings {
  return {
    autoCollapseOnOutsideClick: settings?.autoCollapseOnOutsideClick === true,
    layout: normalizeDockLayout(settings?.layout),
    railWidth: clampDockRailWidth(settings?.railWidth),
  };
}

export function DockSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DockSettings>(() => normalizeSettings(null));
  const [loaded, setLoaded] = useState(() => !isTauri());
  const layoutRef = useRef<DockLayout>(normalizeDockLayout(null));
  const [layout, setLayout] = useState<DockLayout>(() => layoutRef.current);
  const [drag, setDrag] = useState<DockDragState | null>(null);
  const [tabElements, setTabElements] = useState<Readonly<Record<string, HTMLElement>>>({});
  const paneElementsRef = useRef(new Map<string, HTMLElement>());
  const railElementRef = useRef<HTMLElement | null>(null);
  const settingsRef = useRef<DockSettings>(settings);
  const persistenceRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;
    if (!isTauri()) return () => { active = false; };
    void getDockSettings()
      .then((next) => {
        if (!active) return;
        const normalized = normalizeSettings(next);
        settingsRef.current = normalized;
        layoutRef.current = normalized.layout as DockLayout;
        setSettings(normalized);
        setLayout(normalized.layout as DockLayout);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback(async (next: DockSettings) => {
    settingsRef.current = next;
    setSettings(next);
    if (!isTauri()) return;
    // 桥接保存失败时保留本地状态并抛出，让调用方决定如何提示。
    const saved = await setDockSettings(next);
    const normalized = normalizeSettings(saved);
    settingsRef.current = normalized;
    setSettings(normalized);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<DockSettings>) => {
    await persist(normalizeSettings({ ...settingsRef.current, ...patch }));
  }, [persist]);

  /** 提交一次布局改动：本地状态立即生效，持久化按队列串行。 */
  const commitLayout = useCallback((next: DockLayout) => {
    if (next === layoutRef.current) return;
    layoutRef.current = next;
    setLayout(next);
    const target = normalizeSettings({ ...settingsRef.current, layout: next });
    settingsRef.current = { ...settingsRef.current, layout: next };
    persistenceRef.current = persistenceRef.current
      .catch(() => undefined)
      .then(() => persist(target))
      .catch((error) => {
        console.error("保存右栏布局失败", error);
      });
  }, [persist]);

  const findTabByKey = useCallback((key: string) => findDockTabByKey(layoutRef.current, key), []);

  const openTab = useCallback((tab: Omit<DockTab, "id"> & { id?: string }, options?: DockOpenOptions) => {
    const current = layoutRef.current;
    const key = dockTabKey(tab.kind, tab.path);
    const existing = findDockTabByKey(current, key);
    commitLayout(openDockTab(current, { ...tab, id: existing?.id ?? tab.id ?? nextDockId("tab") }, {
      zone: options?.zone ?? "center",
      targetPaneId: options?.targetPaneId ?? null,
      paneId: nextDockId("pane"),
      splitId: nextDockId("split"),
    }));
  }, [commitLayout]);

  const activateTab = useCallback((tabId: string) => {
    commitLayout(activateDockTab(layoutRef.current, tabId));
  }, [commitLayout]);

  const closeTab = useCallback((tabId: string) => {
    commitLayout(closeDockTab(layoutRef.current, tabId));
  }, [commitLayout]);

  const closePane = useCallback((paneId: string) => {
    commitLayout(closeDockPane(layoutRef.current, paneId));
  }, [commitLayout]);

  const moveTab = useCallback((tabId: string, options: DockOpenOptions & { zone: DockZone }) => {
    commitLayout(moveDockTab(layoutRef.current, tabId, {
      zone: options.zone,
      targetPaneId: options.targetPaneId ?? null,
      paneId: nextDockId("pane"),
      splitId: nextDockId("split"),
    }));
  }, [commitLayout]);

  const reorderTab = useCallback((tabId: string, offset: number) => {
    commitLayout(reorderDockTab(layoutRef.current, tabId, offset));
  }, [commitLayout]);

  const resizeSplit = useCallback((splitId: string, index: number, fraction: number) => {
    commitLayout(resizeDockSplit(layoutRef.current, splitId, index, fraction));
  }, [commitLayout]);

  const resetLayout = useCallback(() => {
    commitLayout(emptyDockLayout());
  }, [commitLayout]);

  const registerPaneElement = useCallback((paneId: string, element: HTMLElement | null) => {
    if (element) paneElementsRef.current.set(paneId, element);
    else paneElementsRef.current.delete(paneId);
  }, []);

  const registerTabElement = useCallback((tabId: string, element: HTMLElement | null) => {
    setTabElements((current) => {
      if (element) {
        if (current[tabId] === element) return current;
        return { ...current, [tabId]: element };
      }
      if (!(tabId in current)) return current;
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  }, []);

  /** 指针命中的面板与落点；不在任何面板上返回 null（拖出右栏即取消停靠）。 */
  const resolveDockTarget = useCallback((x: number, y: number): DockDragTarget | null => {
    for (const [paneId, element] of paneElementsRef.current) {
      if (!element.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      return {
        paneId,
        zone: dockZoneAt({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, x, y),
      };
    }
    // 空栏没有面板可命中：落在右栏内就开第一个面板，否则视为拖出。
    const rail = railElementRef.current;
    if (rail?.isConnected) {
      const rect = rail.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { paneId: "", zone: "center" };
      }
    }
    return null;
  }, []);

  const registerRailElement = useCallback((element: HTMLElement | null) => {
    railElementRef.current = element;
  }, []);

  // `endDockDrag` 需要在松手时读到最新的落点，但 pointerup 与最后一次
  // pointermove 可能落在同一个事件批次里，因此把最新状态镜像进 ref。
  const settleRef = useRef<DockDragState | null>(null);
  settleRef.current = drag;

  const beginDockDrag = useCallback((payload: DockDragPayload, x: number, y: number) => {
    setDrag({ payload, x, y, target: resolveDockTarget(x, y) });
  }, [resolveDockTarget]);

  const updateDockDrag = useCallback((x: number, y: number) => {
    setDrag((current) => (current ? { ...current, x, y, target: resolveDockTarget(x, y) } : current));
  }, [resolveDockTarget]);

  const endDockDrag = useCallback((x?: number, y?: number): DockDragState | null => {
    const settled = settleRef.current;
    settleRef.current = null;
    setDrag(null);
    if (!settled) return null;
    // 松手时用真实坐标重算落点：最后一次 pointermove 的 setState 可能还没渲染，
    // 直接读 ref 会拿到落后一帧的落点。
    if (typeof x === "number" && typeof y === "number") {
      return { ...settled, x, y, target: resolveDockTarget(x, y) };
    }
    return settled;
  }, [resolveDockTarget]);

  const cancelDockDrag = useCallback(() => {
    settleRef.current = null;
    setDrag(null);
  }, []);

  const setRailWidth = useCallback((width: number) => {
    const clamped = clampDockRailWidth(width);
    if (clamped === null || clamped === settingsRef.current.railWidth) return;
    const target = normalizeSettings({ ...settingsRef.current, railWidth: clamped });
    settingsRef.current = target;
    persistenceRef.current = persistenceRef.current
      .catch(() => undefined)
      .then(() => persist(target))
      .catch((error) => {
        console.error("保存右栏宽度失败", error);
      });
  }, [persist]);

  const resetRailWidth = useCallback(() => {
    const target = normalizeSettings({ ...settingsRef.current, railWidth: null });
    settingsRef.current = target;
    persistenceRef.current = persistenceRef.current
      .catch(() => undefined)
      .then(() => persist(target))
      .catch((error) => {
        console.error("重置右栏宽度失败", error);
      });
  }, [persist]);

  const panes = useMemo(() => collectDockPanes(layout.root), [layout]);
  const railWidth = clampDockRailWidth(settings.railWidth) ?? DOCK_RAIL_DEFAULT_WIDTH;

  const value = useMemo<DockSettingsContextValue>(() => ({
    settings,
    loaded,
    updateSettings,
    layout,
    findTabByKey,
    openTab,
    activateTab,
    closeTab,
    closePane,
    moveTab,
    reorderTab,
    resizeSplit,
    resetLayout,
    panes,
    drag,
    beginDockDrag,
    updateDockDrag,
    endDockDrag,
    cancelDockDrag,
    registerPaneElement,
    registerTabElement,
    registerRailElement,
    tabElements,
    railWidth,
    setRailWidth,
    resetRailWidth,
  }), [
    activateTab,
    beginDockDrag,
    cancelDockDrag,
    closePane,
    closeTab,
    drag,
    endDockDrag,
    findTabByKey,
    layout,
    loaded,
    moveTab,
    openTab,
    panes,
    railWidth,
    registerPaneElement,
    registerRailElement,
    registerTabElement,
    reorderTab,
    resetLayout,
    resetRailWidth,
    resizeSplit,
    setRailWidth,
    settings,
    tabElements,
    updateDockDrag,
    updateSettings,
  ]);

  return <DockSettingsContext.Provider value={value}>{children}</DockSettingsContext.Provider>;
}

export function useDockSettings() {
  const context = useContext(DockSettingsContext);
  if (!context) throw new Error("useDockSettings 必须在 DockSettingsProvider 内使用");
  return context;
}
