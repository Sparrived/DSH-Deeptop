import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  getDockPosition,
  isTauri,
  resetDockPosition,
  setDockPosition,
} from "../lib/desktop";
import { useDockSettings } from "../app/dock-settings";
import { FLOATING_CONTEXT_MENU_SELECTOR, isWithinSelector } from "../app/context-menu";
import { PINNABLE_DOCKS } from "../app/dock-pin";

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
  side?: "left" | "right";
  className: string;
  collapsed: boolean;
  label: string;
  title: string;
  kicker: string;
  icon: ReactNode;
  railExtra?: ReactNode;
  keepBodyMounted?: boolean;
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
};

function joinClasses(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

const defaultDockPosition: DockPosition = { x: 0, y: 0 };
const dockViewportMargin = 8;

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

export function DockFrame({
  id,
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
  toggleGlyph = "›",
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
}: DockFrameProps) {
  const frameRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<DockPosition>(defaultDockPosition);
  const dragStateRef = useRef<DockDragState | null>(null);
  const persistenceRef = useRef<Promise<void>>(Promise.resolve());
  const [position, setPosition] = useState<DockPosition>(defaultDockPosition);
  const [positionReady, setPositionReady] = useState(() => !isTauri());
  const [dragging, setDragging] = useState(false);
  const { settings: dockSettings, loaded: dockSettingsLoaded, isDockPinned, toggleDockPinned } = useDockSettings();
  // 钉住的 Dock 不再浮动：忽略拖拽偏移，卡片固定在轨道旁的分栏内。
  const pinned = isDockPinned(id);
  const pinnedCardWidth = PINNABLE_DOCKS.find((dock) => dock.id === id)?.width;
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

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    let active = true;
    positionRef.current = defaultDockPosition;
    setPosition(defaultDockPosition);
    setPositionReady(!isTauri());
    if (!isTauri()) return () => { active = false; };

    void getDockPosition(id)
      .then((saved) => {
        if (!active) return;
        const next = saved ?? defaultDockPosition;
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
  }, [id]);

  useEffect(() => {
    if (collapsed || pinned || !dockSettingsLoaded || !dockSettings.autoCollapseOnOutsideClick) return;

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
  }, [collapsed, pinned, dockSettings.autoCollapseOnOutsideClick, dockSettingsLoaded, onToggle]);

  useEffect(() => {
    if (collapsed || !positionReady) return;

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
  }, [collapsed, id, positionReady]);

  useEffect(() => {
    if (!dragging) return;

    const finishDrag = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setDragging(false);
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
    };
  }, [dragging, id]);

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (pinned || !positionReady || event.button !== 0 || (event.target instanceof Element && event.target.closest("button, input, select, textarea, a, [contenteditable=\"true\"]"))) return;
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
  };

  const handleResetPosition = () => {
    dragStateRef.current = null;
    setDragging(false);
    positionRef.current = defaultDockPosition;
    setPosition(defaultDockPosition);
    clearDockPosition();
  };

  const positionStyle = {
    "--dock-position-x": `${position.x}px`,
    "--dock-position-y": `${position.y}px`,
  } as CSSProperties;
  const frameStyle = pinned && pinnedCardWidth
    ? ({ ...positionStyle, "--pin-card-width": `${pinnedCardWidth}px` } as CSSProperties)
    : positionStyle;

  return (
    <aside
      ref={frameRef}
      className={joinClasses("dock-frame", `dock-frame-${side}`, className, stateClass, pinned ? "pinned" : undefined)}
      data-dock-id={id}
      style={frameStyle}
      aria-label={label}
      aria-live="polite"
    >
      <button
        className={joinClasses("dock-frame-rail", railClassName)}
        type="button"
        onClick={onToggle}
        aria-controls={contentId}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `展开${label}` : `收起${label}`}
        title={collapsed ? `展开${label}` : `收起${label}`}
      >
        <span className={joinClasses("dock-frame-rail-mark", railMarkClassName ?? markClassName)} aria-hidden="true">{icon}</span>
        {railExtra}
      </button>

      {(keepBodyMounted || !collapsed) && (
        <div
          ref={cardRef}
          id={contentId}
          className={joinClasses("dock-frame-card", cardClassName, collapsed ? "dock-frame-card-collapsed" : undefined, dragging ? "dock-frame-card-dragging" : undefined)}
          style={positionStyle}
          hidden={collapsed}
        >
          <header className={joinClasses("dock-frame-header", headerClassName, dragging ? "dock-frame-header-dragging" : undefined)} onPointerDown={handleDragPointerDown}>
            <div className={joinClasses("dock-frame-heading", headingClassName)}>
              <span className={joinClasses("dock-frame-mark", headerMarkClassName ?? markClassName)} aria-hidden="true">{icon}</span>
              <div>
                <span className={joinClasses("dock-frame-kicker", kickerClassName)}>{kicker}</span>
                <h2>{title}</h2>
                {headerContent}
              </div>
            </div>
            <div className={joinClasses("dock-frame-header-actions", headerActionsClassName)}>
              {total !== undefined && <span className={joinClasses("dock-frame-total", totalClassName)}>{total}</span>}
              <button
                className={joinClasses("dock-frame-pin", pinned ? "active" : undefined)}
                type="button"
                onClick={() => toggleDockPinned(id)}
                aria-pressed={pinned}
                aria-label={pinned ? `取消钉住${label}` : `钉住${label}`}
                title={pinned ? "取消钉住：恢复浮动卡片" : "钉住：固定为不遮挡对话的分栏"}
              >
                <span aria-hidden="true">📌</span>
              </button>
              {!pinned && (
                <button
                  className="dock-frame-reset"
                  type="button"
                  onClick={handleResetPosition}
                  aria-label="还原面板位置"
                  title="还原面板位置"
                >
                  <span aria-hidden="true">↺</span>
                </button>
              )}
              <button
                className={joinClasses("dock-frame-toggle", toggleClassName)}
                type="button"
                onClick={onToggle}
                aria-controls={contentId}
                aria-expanded={true}
                aria-label={`收起${label}`}
                title={`收起${label}`}
              >
                <span aria-hidden="true">{toggleGlyph}</span>
              </button>
            </div>
          </header>
          <div className={joinClasses("dock-frame-body", bodyClassName)}>{children}</div>
        </div>
      )}
    </aside>
  );
}
