import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Bot,
  CheckSquare,
  FileCode2,
  FileText,
  GitBranch,
  ListTodo,
  PackageOpen,
  PanelRight,
  SquareTerminal,
  X,
} from "lucide-react";
import { t, type UiLocale } from "../app/i18n";
import {
  DOCK_RAIL_MAX_WIDTH,
  DOCK_RAIL_MIN_WIDTH,
  type DockNode,
  type DockPaneNode,
  type DockSplitNode,
  type DockTab,
  type DockZone,
} from "../app/dock-layout";
import { useDockSettings } from "../app/dock-settings";

type DockRailProps = {
  locale?: UiLocale;
  /** 非会话页不显示右栏；布局本身保留，回到会话页即恢复。 */
  visible?: boolean;
  /**
   * 由布局树里的标签渲染正文。DockFrame 类面板的正文由面板自己挂进宿主，
   * 因此这里只返回非面板内容（文件预览），其余返回 null。
   */
  renderTabBody?: (tab: DockTab) => ReactNode;
};

/** 各标签类型的字形。内容类型是数据（`DockTab.kind`），这里只负责映射。 */
const DOCK_TAB_ICONS: Record<string, ReactNode> = {
  "terminal-dock": <SquareTerminal />,
  "workspace-files-dock": <FileText />,
  "git-dock": <GitBranch />,
  file: <FileCode2 />,
  tasks: <ListTodo />,
  todo: <CheckSquare />,
  deliverables: <PackageOpen />,
  subagent: <Bot />,
};

/** 拖拽中的落点提示文案键。 */
const DOCK_ZONE_LABEL_KEYS: Record<DockZone, "dock.zoneCenter" | "dock.zoneTop" | "dock.zoneRight" | "dock.zoneBottom" | "dock.zoneLeft"> = {
  center: "dock.zoneCenter",
  top: "dock.zoneTop",
  right: "dock.zoneRight",
  bottom: "dock.zoneBottom",
  left: "dock.zoneLeft",
};

const DRAG_THRESHOLD = 4;
const MIN_SPLIT_FRACTION = 0.05;

/**
 * 事件的 pointerId；window 的 blur 事件没有指针信息，返回 null 表示
 * “不属于任何指针，按取消处理”。
 */
function pointerIdOf(event: Event): number | null {
  const pointerId = (event as PointerEvent).pointerId;
  return typeof pointerId === "number" ? pointerId : null;
}

/** blur/pointercancel 共用的中止判定：只处理本次指针或窗口失焦。 */
function isAbortFor(event: Event, pointerId: number): boolean {
  const eventPointerId = pointerIdOf(event);
  return eventPointerId === null || eventPointerId === pointerId;
}

function tabIcon(tab: DockTab): ReactNode {
  return DOCK_TAB_ICONS[tab.kind] ?? <PanelRight />;
}

function tabTitle(tab: DockTab): string {
  return tab.title || tab.path || tab.kind;
}

/**
 * 可停靠右栏。
 *
 * 标题栏是拖拽手柄：在标签组内拖动可以换落点（并入标签组、或在上/下/左/右
 * 开分栏），拖出右栏则取消停靠、面板回到左侧浮动。落点解析与高亮由
 * `dock-settings` 的拖拽会话统一提供。
 */
export function DockRail({ locale = "zh", visible = true, renderTabBody }: DockRailProps) {
  const {
    layout,
    drag,
    railWidth,
    setRailWidth,
    resetRailWidth,
    registerRailElement,
    registerPaneElement,
    registerTabElement,
    activateTab,
    closeTab,
    closePane,
    moveTab,
    reorderTab,
    resizeSplit,
    beginDockDrag,
    updateDockDrag,
    endDockDrag,
    cancelDockDrag,
  } = useDockSettings();
  const tabRefCallbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const paneRefCallbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const splitRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressClickRef = useRef<string | null>(null);
  const [splitPreview, setSplitPreview] = useState<{ splitId: string; sizes: number[] } | null>(null);
  const [widthPreview, setWidthPreview] = useState<number | null>(null);

  // 每个标签/面板一个稳定的 ref 回调：内联箭头每次渲染都是新引用，React 会在
  // 每次提交时 detach/attach 并触发 setState，形成无限更新循环。
  const tabRefFor = useCallback((tabId: string) => {
    let callback = tabRefCallbacks.current.get(tabId);
    if (!callback) {
      callback = (element: HTMLElement | null) => registerTabElement(tabId, element);
      tabRefCallbacks.current.set(tabId, callback);
    }
    return callback;
  }, [registerTabElement]);

  const paneRefFor = useCallback((paneId: string) => {
    let callback = paneRefCallbacks.current.get(paneId);
    if (!callback) {
      callback = (element: HTMLElement | null) => registerPaneElement(paneId, element);
      paneRefCallbacks.current.set(paneId, callback);
    }
    return callback;
  }, [registerPaneElement]);

  const beginTabDrag = (event: ReactPointerEvent<HTMLElement>, tabId: string) => {
    if (event.button !== 0) return;
    // 上一次拖拽可能没有派发 click（标签已被移走），这里清掉以免误吞下一次点击。
    suppressClickRef.current = null;
    const pointerId = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!moved && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        document.body.classList.add("dock-tab-dragging");
        beginDockDrag({ source: "tab", tabId }, moveEvent.clientX, moveEvent.clientY);
      }
      moveEvent.preventDefault();
      updateDockDrag(moveEvent.clientX, moveEvent.clientY);
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleAbort);
      window.removeEventListener("blur", handleAbort);
      document.body.classList.remove("dock-tab-dragging");
    };

    const finish = (clientX: number | null, clientY: number | null) => {
      cleanup();
      if (!moved) return;
      // 拖动结束后浏览器仍会派发一次 click，必须吞掉它，否则会误激活标签。
      suppressClickRef.current = tabId;
      if (clientX === null || clientY === null) {
        cancelDockDrag();
        return;
      }
      const settled = endDockDrag(clientX, clientY);
      const target = settled?.target ?? null;
      if (target) moveTab(tabId, { zone: target.zone, targetPaneId: target.paneId });
      // 拖出右栏即取消停靠：面板回到左侧浮动卡片。
      else closeTab(tabId);
    };

    const handleUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      finish(upEvent.clientX, upEvent.clientY);
    };
    const handleAbort = (abortEvent: Event) => {
      if (!isAbortFor(abortEvent, pointerId)) return;
      finish(null, null);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleAbort);
    window.addEventListener("blur", handleAbort);
  };

  const beginSplitResize = (event: ReactPointerEvent<HTMLDivElement>, split: DockSplitNode, index: number) => {
    if (event.button !== 0) return;
    const container = splitRefs.current.get(split.id);
    if (!container) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const base = [...split.sizes];
    const horizontal = split.axis === "row";
    document.body.classList.add("dock-split-resizing");

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const rect = container.getBoundingClientRect();
      const length = horizontal ? rect.width : rect.height;
      if (length <= 0) return;
      const position = horizontal ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top;
      const pairTotal = base[index] + base[index + 1];
      const fraction = Math.min(Math.max(position / length, MIN_SPLIT_FRACTION), pairTotal - MIN_SPLIT_FRACTION);
      const sizes = [...base];
      sizes[index] = fraction;
      sizes[index + 1] = pairTotal - fraction;
      setSplitPreview({ splitId: split.id, sizes });
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleAbort);
      window.removeEventListener("blur", handleAbort);
      document.body.classList.remove("dock-split-resizing");
    };

    const settle = (commit: boolean) => {
      cleanup();
      setSplitPreview((current) => {
        if (commit && current && current.splitId === split.id) {
          const pairTotal = current.sizes[index] + current.sizes[index + 1];
          if (pairTotal > 0) resizeSplit(split.id, index, current.sizes[index] / pairTotal);
        }
        return null;
      });
    };

    const handleUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      settle(true);
    };
    const handleAbort = (abortEvent: Event) => {
      if (!isAbortFor(abortEvent, pointerId)) return;
      settle(false);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleAbort);
    window.addEventListener("blur", handleAbort);
  };

  const beginWidthResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = railWidth;
    const grid = event.currentTarget.closest(".workspace-layout") as HTMLElement | null;
    document.body.classList.add("dock-rail-resizing");

    const applyPreview = (width: number) => {
      setWidthPreview(width);
      grid?.style.setProperty("--dock-rail-drag-width", `${width}px`);
    };

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const raw = startWidth - (moveEvent.clientX - startX);
      // 与网格模板一致：右栏最多占窗口 45%，避免窄窗口把对话列挤没。
      const maxWidth = Math.min(DOCK_RAIL_MAX_WIDTH, Math.round(window.innerWidth * 0.45));
      applyPreview(Math.min(Math.max(Math.round(raw), DOCK_RAIL_MIN_WIDTH), Math.max(maxWidth, DOCK_RAIL_MIN_WIDTH)));
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleAbort);
      window.removeEventListener("blur", handleAbort);
      document.body.classList.remove("dock-rail-resizing");
    };

    const settle = (commit: boolean) => {
      cleanup();
      grid?.style.removeProperty("--dock-rail-drag-width");
      setWidthPreview((current) => {
        if (commit && current !== null) setRailWidth(current);
        return null;
      });
    };

    const handleUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      settle(true);
    };
    const handleAbort = (abortEvent: Event) => {
      if (!isAbortFor(abortEvent, pointerId)) return;
      settle(false);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleAbort);
    window.addEventListener("blur", handleAbort);
  };

  const renderPane = (pane: DockPaneNode) => {
    const target = drag?.target?.paneId === pane.id ? drag.target.zone : null;
    return (
      <div key={pane.id} className="dock-rail-pane" ref={paneRefFor(pane.id)}>
        <div className="dock-rail-tabbar" role="tablist" aria-label={t("dock.railPaneAria", locale)}>
          {pane.tabIds.map((tabId) => {
            const tab = layout.tabs[tabId];
            if (!tab) return null;
            const selected = tabId === pane.activeTabId;
            const dragging = drag?.payload.source === "tab" && drag.payload.tabId === tabId;
            return (
              <div className={`dock-rail-tab${selected ? " selected" : ""}${dragging ? " dragging" : ""}`} key={tabId}>
                <button
                  className="dock-rail-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={tabTitle(tab)}
                  onPointerDown={(pointerEvent) => beginTabDrag(pointerEvent, tabId)}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  onKeyDown={(keyEvent) => {
                    // 键盘等价物：Alt+←/→ 在标签组内调整顺序（指针拖拽只能换落点）。
                    if (!keyEvent.altKey) return;
                    if (keyEvent.key === "ArrowLeft") {
                      keyEvent.preventDefault();
                      reorderTab(tabId, -1);
                    } else if (keyEvent.key === "ArrowRight") {
                      keyEvent.preventDefault();
                      reorderTab(tabId, 1);
                    }
                  }}
                  onClick={() => {
                    if (suppressClickRef.current === tabId) {
                      suppressClickRef.current = null;
                      return;
                    }
                    activateTab(tabId);
                  }}
                >
                  <span className="dock-rail-tab-icon" aria-hidden="true">{tabIcon(tab)}</span>
                  <span className="dock-rail-tab-label">{tabTitle(tab)}</span>
                  {tab.detail && <span className="dock-rail-tab-detail">{tab.detail}</span>}
                </button>
                <button
                  className="dock-rail-tab-close"
                  type="button"
                  title={tab.detail ? t("dock.railUndockDetailed", locale, { label: tabTitle(tab), detail: tab.detail }) : t("dock.railUndock", locale, { label: tabTitle(tab) })}
                  aria-label={t("dock.railUndock", locale, { label: tabTitle(tab) })}
                  onClick={() => closeTab(tabId)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <span className="dock-rail-tabbar-spacer" aria-hidden="true" />
          {pane.tabIds.length > 1 && (
            <button
              className="dock-rail-pane-close"
              type="button"
              title={t("dock.railPaneClose", locale)}
              aria-label={t("dock.railPaneClose", locale)}
              onClick={() => closePane(pane.id)}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="dock-rail-pane-body">
          {pane.tabIds.map((tabId) => {
            const tab = layout.tabs[tabId];
            return (
              <div
                key={tabId}
                className={`dock-rail-tab-host${tabId === pane.activeTabId ? "" : " is-inactive"}`}
                ref={tabRefFor(tabId)}
              >
                {tab ? renderTabBody?.(tab) : null}
              </div>
            );
          })}
        </div>
        {target && (
          <div className={`dock-rail-dropzone zone-${target}`} aria-hidden="true">
            <span>{t(DOCK_ZONE_LABEL_KEYS[target], locale)}</span>
          </div>
        )}
      </div>
    );
  };

  const renderNode = (node: DockNode): ReactNode => {
    if (node.kind === "pane") return renderPane(node);
    const sizes = splitPreview?.splitId === node.id ? splitPreview.sizes : node.sizes;
    return (
      <div
        key={node.id}
        className={`dock-rail-split axis-${node.axis}`}
        ref={(element) => {
          if (element) splitRefs.current.set(node.id, element);
          else splitRefs.current.delete(node.id);
        }}
      >
        {node.children.map((child, index) => (
          <div
            className="dock-rail-split-child"
            key={child.id}
            style={{ flexBasis: `${(sizes[index] ?? 0) * 100}%` }}
          >
            {renderNode(child)}
            {index < node.children.length - 1 && (
              <div
                className="dock-rail-split-resizer"
                role="separator"
                aria-orientation={node.axis === "row" ? "vertical" : "horizontal"}
                aria-label={t("dock.railSplitAria", locale)}
                onPointerDown={(pointerEvent) => beginSplitResize(pointerEvent, node, index)}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  const empty = layout.root === null;
  const activeWidth = widthPreview ?? railWidth;

  return (
    <aside
      className={`dock-rail${visible ? "" : " hidden-page"}${empty ? "" : " has-content"}${drag ? " dragging" : ""}`}
      ref={registerRailElement}
      aria-label={t("dock.railAria", locale)}
      aria-hidden={!visible}
      style={{ "--dock-rail-live-width": `${activeWidth}px` } as CSSProperties}
    >
      <div
        className="dock-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("dock.railResizeAria", locale)}
        aria-valuemin={DOCK_RAIL_MIN_WIDTH}
        aria-valuemax={DOCK_RAIL_MAX_WIDTH}
        aria-valuenow={activeWidth}
        hidden={empty}
        onPointerDown={beginWidthResize}
        onDoubleClick={() => resetRailWidth()}
      />
      {empty ? (
        // 空栏只在拖拽期间被展开成落点条（宽度由 App 决定），因此这里只需
        // 说明“松手就固定到这里”。
        <div className={`dock-rail-empty${drag?.target?.paneId === "" ? " drop-active" : ""}`}>
          <span className="dock-rail-empty-icon" aria-hidden="true"><PanelRight /></span>
          <strong>{t("dock.railEmptyTitle", locale)}</strong>
          <p>{t("dock.railEmptyHint", locale)}</p>
        </div>
      ) : (
        <div className="dock-rail-tree">{layout.root && renderNode(layout.root)}</div>
      )}
      {drag && <div className="dock-rail-drag-hint">{t(DOCK_ZONE_LABEL_KEYS[drag.target?.zone ?? "center"], locale)}</div>}
    </aside>
  );
}
