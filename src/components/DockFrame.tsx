import type { ReactNode } from "react";

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
  const contentId = `${id}-content`;
  const stateClass = collapsed ? "collapsed" : "expanded";

  return (
    <aside
      className={joinClasses("dock-frame", `dock-frame-${side}`, className, stateClass)}
      data-dock-id={id}
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

      {!collapsed && (
        <div id={contentId} className={joinClasses("dock-frame-card", cardClassName)}>
          <header className={joinClasses("dock-frame-header", headerClassName)}>
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
