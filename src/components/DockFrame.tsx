import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, RotateCcw, X } from "lucide-react";
import {
  getDockPosition,
  isTauri,
  resetDockPosition,
  setDockPosition,
} from "../lib/desktop";
import { useDockSettings } from "../app/dock-settings";
import { FLOATING_CONTEXT_MENU_SELECTOR, isWithinSelector } from "../app/context-menu";
import { t, type UiLocale } from "../app/i18n";

type DockPosition = {
  x: number;
  y: number;
};

type DockDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: DockPosition;
  startRect: DOMRect;
};

type DockFrameProps = {
  id: string;
  locale?: UiLocale;
  side?: "left" | "right";
  className: string;
  collapsed: boolean;
  label: string;
  title: string;
  kicker: string;
  icon: ReactNode;
  railExtra?: ReactNode;
  keepBodyMounted?: boolean;
  /** 计数只用于嵌入式头部（工具区标签页）；浮动/停靠卡片头部不显示计数文字。 */
  total?: ReactNode;
  toggleGlyph?: ReactNode;
  headerContent?: ReactNode;
  railMarkClassName?: string;
  headerMarkClassName?: string;
  headerActionsClassName?: string;
  children: ReactNode;
  onToggle: () => void;
  cardClassName?: string;
  headerClassName?: string;
  headingClassName?: string;
  markClassName?: string;
  kickerClassName?: string;
  bodyClassName?: string;
  totalClassName?: string;
  toggleClassName?: string;
  railClassName?: string;
  /** Render inside the shared utility workbench rather than as a movable Dock. */
  embedded?: boolean;
};

function joinClasses(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

const defaultDockPosition: DockPosition = { x: 0, y: 0 };
const dockViewportMargin = 8;
/** 拖起标题栏多远才开启停靠会话；避免单击标题栏就让右栏闪出落点条。 */
const DRAG_THRESHOLD = 4;
/** 右栏只在桌面宽度启用；窄屏保持原有浮动/静态卡片行为。 */
const railDesktopQuery = "(min-width: 761px)";

/**
 * 浮动展开框的默认位置：桌面布局下把顶部对齐到所在 dock 排最上方第一个 dock
 * （首个 dock 自身偏移为 0，后续 dock 为相对首 dock 的负纵向偏移），而不是与
 * 自身窄栏平齐。实际布局（窄栏高度、间距、条件渲染）通过 offsetTop 差值度量。
 */
function alignedDefaultDockPosition(frame: HTMLElement | null): DockPosition {
  const parent = frame?.parentElement;
  const first = parent?.firstElementChild as HTMLElement | null;
  if (!frame || !parent || !first || first === frame) return defaultDockPosition;
  return { x: defaultDockPosition.x, y: -(frame.offsetTop - first.offsetTop) };
}

function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window === "undefined" || window.matchMedia(railDesktopQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(railDesktopQuery);
    const onChange = (event: MediaQueryListEvent) => setDesktop(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

/** Keep the card inside the WebView while preserving its saved offset. */
function moveDockPosition(position: DockPosition, delta: DockPosition, startRect: DOMRect): DockPosition {
  const minDeltaX = dockViewportMargin - startRect.left;
  const maxDeltaX = Math.max(minDeltaX, window.innerWidth - dockViewportMargin - startRect.right);
  const minDeltaY = dockViewportMargin - startRect.top;
  const maxDeltaY = Math.max(minDeltaY, window.innerHeight - dockViewportMargin - startRect.bottom);
  return {
    x: position.x + Math.min(maxDeltaX, Math.max(minDeltaX, delta.x)),
    y: position.y + Math.min(maxDeltaY, Math.max(minDeltaY, delta.y)),
  };
}

/**
 * Dock 卡片。
 *
 * 面板有两种归宿，切换靠点击图标条或拖拽（没有单独的钉住按钮）：
 *
 * - **浮动**：卡片跟着标题栏拖拽移动，位置按面板记忆（Tauri 持久化）。
 *   把标题栏拖进右栏松手即固定为停靠标签。
 * - **停靠**：正文移进右栏对应标签的宿主元素，标签栏、分栏与关闭都交给
 *   右栏，卡片自身只保留右栏左缘那条常驻图标条入口——点击图标即停靠。
 *   把标签拖出右栏即取消停靠，回到浮动卡片。
 *
 * 卡片正文始终渲染进 `bodyRef` 这个 DockFrame 自己创建的正文节点，节点再被
 * 搬到当前宿主里。于是「浮动 ↔ 停靠」只是搬动一个 DOM 节点，正文组件
 * （终端会话、文件树）不会被卸载重建，运行中的状态得以保留。
 */
export function DockFrame({
  id,
  locale = "zh",
  side = "right",
  className,
  collapsed,
  label,
  title,
  kicker,
  icon,
  railExtra,
  keepBodyMounted = false,
  total,
  toggleGlyph = <ChevronRight />,
  headerContent,
  railMarkClassName,
  headerMarkClassName,
  headerActionsClassName,
  children,
  onToggle,
  cardClassName,
  headerClassName,
  headingClassName,
  markClassName,
  kickerClassName,
  bodyClassName,
  totalClassName,
  toggleClassName,
  railClassName,
  embedded = false,
}: DockFrameProps) {
  const frameRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardSlotRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<DockPosition>(defaultDockPosition);
  const dragStateRef = useRef<DockDragState | null>(null);
  /** 本次拖拽是否已经开启停靠会话（右栏落点条 / 落点提示）。 */
  const dockSessionRef = useRef(false);
  const persistenceRef = useRef<Promise<void>>(Promise.resolve());
  const [position, setPosition] = useState<DockPosition>(defaultDockPosition);
  const [positionReady, setPositionReady] = useState(() => !isTauri());
  const [dragging, setDragging] = useState(false);
  const {
    settings: dockSettings,
    loaded: dockSettingsLoaded,
    tabElements,
    findTabByKey,
    openTab,
    beginDockDrag,
    updateDockDrag,
    endDockDrag,
    cancelDockDrag,
  } = useDockSettings();
  const desktopLayout = useDesktopLayout();
  // 停靠状态由布局树权威决定：同一类面板在右栏只存在一个标签。
  // 窄屏没有右栏（网格里没有那一列），此时停靠标签回退为浮动/流内卡片，
  // 否则面板会被困在 display:none 的右栏里既看不到也关不掉。
  const dockedTab = embedded ? null : findTabByKey(id);
  const docked = dockedTab !== null && desktopLayout;
  const dockedTabHost = dockedTab ? tabElements[dockedTab.id] ?? null : null;
  // 窄屏卡片退化为流内静态布局，默认位置保持零偏移；用 ref 避免跨断点重载已保存位置。
  const desktopLayoutRef = useRef(desktopLayout);
  useEffect(() => {
    desktopLayoutRef.current = desktopLayout;
  }, [desktopLayout]);
  const persistDockPosition = (next: DockPosition) => {
    persistenceRef.current = persistenceRef.current
      .catch(() => undefined)
      .then(() => setDockPosition(id, next))
      .catch(() => undefined);
  };
  const clearDockPosition = () => {
    persistenceRef.current = persistenceRef.current
      .catch(() => undefined)
      .then(() => resetDockPosition(id))
      .catch(() => undefined);
  };
  const contentId = `${id}-content`;
  const stateClass = collapsed ? "collapsed" : "expanded";

  // 正文节点：DockFrame 自建并长期持有，React 只向它做 portal。节点被搬进
  // 卡片正文槽或右栏标签宿主，因此停靠状态切换不会重建正文组件。
  const bodyRef = useRef<HTMLDivElement | null>(null);
  if (!bodyRef.current && typeof document !== "undefined") {
    const body = document.createElement("div");
    body.className = joinClasses("dock-frame-body", "dock-frame-portal", bodyClassName);
    bodyRef.current = body;
  }

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // 正文节点是自建节点，类名由这里同步（面板各自的 bodyClassName 提供排版）。
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.className = joinClasses("dock-frame-body", "dock-frame-portal", bodyClassName);
  }, [bodyClassName]);

  // 把正文节点挂到当前宿主：停靠时是右栏的标签宿主，浮动时是卡片正文槽。
  // 用 layout effect：先于浏览器的下一帧完成挂载，正文不会先空一帧；子组件的
  // layout/effect（例如 xterm 的 open/fit）也因此总能测到已入文档的宿主。
  // 右栏宿主晚一拍才登记时节点留在原处，正文不会中断。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (embedded) return;
    const slot = docked ? dockedTabHost : (keepBodyMounted || !collapsed ? cardSlotRef.current : null);
    if (!slot) return;
    slot.appendChild(body);
    return () => {
      if (body.parentElement === slot) body.remove();
    };
  }, [collapsed, docked, dockedTabHost, embedded, keepBodyMounted]);

  useEffect(() => {
    if (embedded || docked) return;
    let active = true;
    // 默认位置：桌面布局下展开框顶部与排内最上方第一个 dock 平齐；窄屏零偏移。
    const initial = desktopLayoutRef.current ? alignedDefaultDockPosition(frameRef.current) : defaultDockPosition;
    positionRef.current = initial;
    setPosition(initial);
    setPositionReady(!isTauri());
    if (!isTauri()) return () => { active = false; };

    void getDockPosition(id)
      .then((saved) => {
        if (!active) return;
        const next = saved ?? initial;
        positionRef.current = next;
        setPosition(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPositionReady(true);
      });

    return () => {
      active = false;
    };
  }, [docked, embedded, id]);

  useEffect(() => {
    if (embedded || collapsed || docked || !dockSettingsLoaded || !dockSettings.autoCollapseOnOutsideClick) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      // 右键菜单等浮动弹层通过 createPortal 渲染到 document.body，物理上位于 Dock 框之外，
      // 但属于 Dock 内容交互的上下文，不应计为“外部区域”触发自动收起。
      if (isWithinSelector(target, FLOATING_CONTEXT_MENU_SELECTOR)) return;
      if (target instanceof Node && !frameRef.current?.contains(target)) {
        onToggle();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [collapsed, docked, dockSettings.autoCollapseOnOutsideClick, dockSettingsLoaded, embedded, onToggle]);

  useEffect(() => {
    if (embedded || collapsed || docked || !positionReady) return;

    const clampCurrentPosition = () => {
      const card = cardRef.current;
      if (!card) return;
      const current = positionRef.current;
      const next = moveDockPosition(current, { x: 0, y: 0 }, card.getBoundingClientRect());
      if (next.x === current.x && next.y === current.y) return;
      positionRef.current = next;
      setPosition(next);
      persistDockPosition(next);
    };

    window.addEventListener("resize", clampCurrentPosition);
    const frame = window.requestAnimationFrame(clampCurrentPosition);
    return () => {
      window.removeEventListener("resize", clampCurrentPosition);
      window.cancelAnimationFrame(frame);
    };
  }, [collapsed, docked, embedded, id, positionReady]);

  useEffect(() => {
    if (!dragging) return;

    const finishDrag = (event?: Event) => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setDragging(false);
      // pointercancel / blur 没有可提交的落点：只取消停靠会话，位置照旧记忆。
      if (event?.type !== "pointerup") {
        cancelDockDrag();
        persistDockPosition(positionRef.current);
        return;
      }
      const pointer = event as PointerEvent;
      const settled = endDockDrag(pointer.clientX, pointer.clientY);
      const target = settled?.target ?? null;
      // 落在右栏上：固定为停靠标签，不再记忆浮动位置。
      if (target) {
        openTab({ kind: id, title, detail: kicker }, { zone: target.zone, targetPaneId: target.paneId });
        return;
      }
      persistDockPosition(positionRef.current);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const next = moveDockPosition(drag.startPosition, {
        x: event.clientX - drag.startX,
        y: event.clientY - drag.startY,
      }, drag.startRect);
      positionRef.current = next;
      setPosition(next);
      // 只有真的拖起来才开启停靠会话：单击标题栏不该让右栏闪出落点条。
      if (dockSessionRef.current || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD) {
        if (!dockSessionRef.current) {
          dockSessionRef.current = true;
          beginDockDrag({ source: "panel", tab: { id, kind: id, title, detail: kicker } }, event.clientX, event.clientY);
        }
        updateDockDrag(event.clientX, event.clientY);
      }
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishDrag);
    document.addEventListener("pointercancel", finishDrag);
    window.addEventListener("blur", finishDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishDrag);
      document.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
      cancelDockDrag();
    };
  }, [cancelDockDrag, dragging, endDockDrag, id, kicker, openTab, title, updateDockDrag]);

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (docked || !positionReady || event.button !== 0 || (event.target instanceof Element && event.target.closest("button, input, select, textarea, a, [contenteditable=\"true\"]"))) return;
    const card = cardRef.current;
    if (!card) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: positionRef.current,
      startRect: card.getBoundingClientRect(),
    };
    setDragging(true);
    dockSessionRef.current = false;
  };

  /**
   * 图标条入口的点击语义：桌面下默认把面板停靠进右栏（`openTab` 对已存在的标签
   * 只做复用并带到前台），窄屏没有右栏，退回展开/收起浮动卡片。
   */
  const handleRailToggle = () => {
    if (!desktopLayout) {
      onToggle();
      return;
    }
    openTab({ kind: id, title, detail: kicker }, { zone: "center" });
  };

  const handleResetPosition = () => {
    dragStateRef.current = null;
    setDragging(false);
    const next = desktopLayoutRef.current ? alignedDefaultDockPosition(frameRef.current) : defaultDockPosition;
    positionRef.current = next;
    setPosition(next);
    clearDockPosition();
  };

  if (embedded) {
    return (
      <section
        ref={frameRef}
        id={contentId}
        className={joinClasses("dock-frame", "dock-frame-embedded", className)}
        aria-label={label}
        aria-live="polite"
      >
        <header className={joinClasses("dock-frame-header", "dock-frame-embedded-header", headerClassName)}>
          <div className="dock-frame-titlebar">
            <div className={joinClasses("dock-frame-heading", headingClassName)}>
              <span className={joinClasses("dock-frame-mark", headerMarkClassName ?? markClassName)} aria-hidden="true">{icon}</span>
              <div className="dock-frame-titles">
                <span className={joinClasses("dock-frame-kicker", kickerClassName)}>{kicker}</span>
                <h2>{title}</h2>
                {headerContent}
              </div>
            </div>
            <div className={joinClasses("dock-frame-toolbar", headerActionsClassName)} role="group" aria-label={t("dock.toolbarAria", locale, { label })}>
              {total !== undefined && <span className={joinClasses("dock-frame-total", totalClassName)}>{total}</span>}
              <button
                className={joinClasses("dock-frame-toggle", toggleClassName)}
                type="button"
                onClick={onToggle}
                aria-label={t("dock.collapse", locale, { label })}
                title={t("common.close", locale)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
        <div className={joinClasses("dock-frame-body", bodyClassName)}>{children}</div>
      </section>
    );
  }

  const positionStyle = {
    "--dock-position-x": `${position.x}px`,
    "--dock-position-y": `${position.y}px`,
  } as CSSProperties;

  const cardNode = !docked && (keepBodyMounted || !collapsed) ? (
    <div
      ref={cardRef}
      id={contentId}
      className={joinClasses("dock-frame-card", cardClassName, collapsed ? "dock-frame-card-collapsed" : undefined, dragging ? "dock-frame-card-dragging" : undefined)}
      style={positionStyle}
      hidden={collapsed}
    >
      <header className={joinClasses("dock-frame-header", headerClassName, dragging ? "dock-frame-header-dragging" : undefined)} onPointerDown={handleDragPointerDown}>
        <div className="dock-frame-titlebar">
          <div className={joinClasses("dock-frame-heading", headingClassName)}>
            <span className={joinClasses("dock-frame-mark", headerMarkClassName ?? markClassName)} aria-hidden="true">{icon}</span>
            <div className="dock-frame-titles">
              <span className={joinClasses("dock-frame-kicker", kickerClassName)}>{kicker}</span>
              <h2>{title}</h2>
              {headerContent}
            </div>
          </div>
          {/* 标题行动作组：还原位置紧挨收起钮左侧，两者同一行，动作不再另起一行。 */}
          <div className={joinClasses("dock-frame-titlebar-actions", headerActionsClassName)} role="group" aria-label={t("dock.toolbarAria", locale, { label })}>
            <button
              className="dock-frame-reset"
              type="button"
              onClick={handleResetPosition}
              aria-label={t("dock.resetPosition", locale)}
              title={t("dock.resetPosition", locale)}
            >
              <RotateCcw aria-hidden="true" />
            </button>
            <button
              className={joinClasses("dock-frame-toggle", toggleClassName)}
              type="button"
              onClick={onToggle}
              aria-controls={contentId}
              aria-expanded={!collapsed}
              aria-label={t("dock.collapse", locale, { label })}
              title={t("dock.collapse", locale, { label })}
            >
              <span aria-hidden="true">{toggleGlyph}</span>
            </button>
          </div>
        </div>
      </header>
      {/* 正文槽：内容节点由上面的 effect 挂进来，React 不参与这里的子节点。 */}
      <div ref={cardSlotRef} className="dock-frame-body-slot" />
    </div>
  ) : null;

  return (
    <aside
      ref={frameRef}
      className={joinClasses("dock-frame", `dock-frame-${side}`, className, stateClass, docked ? "docked-to-rail" : undefined)}
      data-dock-id={id}
      aria-label={label}
      aria-live="polite"
    >
      <button
        className={joinClasses("dock-frame-rail", railClassName)}
        type="button"
        onClick={handleRailToggle}
        aria-controls={contentId}
        aria-expanded={docked || !collapsed}
        aria-label={docked ? t("dock.reveal", locale, { label }) : desktopLayout ? t("dock.dockToRail", locale, { label }) : collapsed ? t("dock.expand", locale, { label }) : t("dock.collapse", locale, { label })}
        title={docked ? t("dock.dockedToRail", locale, { label }) : desktopLayout ? t("dock.dockToRail", locale, { label }) : collapsed ? t("dock.expand", locale, { label }) : t("dock.collapse", locale, { label })}
      >
        <span className={joinClasses("dock-frame-rail-mark", railMarkClassName ?? markClassName)} aria-hidden="true">{icon}</span>
        {railExtra}
      </button>
      {cardNode}
      {/* 面板正文：始终 portal 进 DockFrame 自己持有的正文节点，
          节点被上面的 effect 搬到当前宿主，因此切换停靠不会卸载正文。 */}
      {bodyRef.current && createPortal(children, bodyRef.current)}
    </aside>
  );
}
