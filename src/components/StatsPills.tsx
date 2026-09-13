import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChartNoAxesColumn, Database } from "lucide-react";
import { t, type UiLocale } from "../app/i18n";
import type { SessionStats } from "../app/model-types";
import { timingMetricRows, usageMetricRows } from "../app/session-metrics";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";

export type StatsPillKind = "timing" | "usage";

type StatsPillsProps = {
  sessionStats: SessionStats;
  sessionRunningMs: number;
  locale: UiLocale;
  /** 打开完整会话看板；缺省时弹窗不显示这个出口。 */
  onOpenDashboard?: () => void;
};

const PILLS: Array<{ kind: StatsPillKind; titleKey: string; icon: ReactNode }> = [
  { kind: "timing", titleKey: "composer.stats.timingTitle", icon: <ChartNoAxesColumn aria-hidden="true" /> },
  { kind: "usage", titleKey: "composer.stats.usageTitle", icon: <Database aria-hidden="true" /> },
];

/**
 * 输入区下方的两个统计胶囊：仪表盘打开「时间与速度」，数据库打开
 * 「Token 用量」。两者共用一个弹窗座位，锚在按钮上方并在视口内钳制
 * （与上游 `StatsPills.tsx` 的入口一致，分析能力仍由会话看板提供）。
 */
export function StatsPills({ sessionStats, sessionRunningMs, locale, onOpenDashboard }: StatsPillsProps) {
  const [open, setOpen] = useState<StatsPillKind | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const pillsRef = useRef<HTMLDivElement | null>(null);
  const { menuRef, menuAt } = useFloatingMenuPosition(anchor);

  useEffect(() => {
    if (open === null) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && (pillsRef.current?.contains(event.target) || menuRef.current?.contains(event.target))) return;
      setOpen(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuRef, open]);

  const title = open === null ? "" : t(open === "timing" ? "composer.stats.timingTitle" : "composer.stats.usageTitle", locale);
  const rows = open === null ? [] : open === "timing" ? timingMetricRows(sessionStats, sessionRunningMs) : usageMetricRows(sessionStats);

  return <div className="composer-stats">
    <div className="stats-pills" role="group" aria-label={t("composer.stats.pillsAria", locale)} ref={pillsRef}>
      {PILLS.map((pill) => {
        const active = open === pill.kind;
        const label = t(pill.titleKey, locale);
        return <button
          key={pill.kind}
          type="button"
          className={"stats-pill" + (active ? " selected" : "")}
          aria-haspopup="dialog"
          aria-expanded={active}
          aria-label={label}
          title={label}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setAnchor({ x: rect.left, y: rect.top });
            setOpen(active ? null : pill.kind);
          }}
        >{pill.icon}</button>;
      })}
    </div>
    {open !== null && anchor && createPortal(
      <div
        ref={menuRef}
        className="stats-popup"
        role="dialog"
        aria-label={title}
        style={{ left: menuAt?.left ?? anchor.x, top: menuAt?.top ?? anchor.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <strong className="stats-popup-title">{title}</strong>
        <div className="stats-popup-rows">
          {rows.map((row) => <div className="stats-popup-row" key={row.key}>
            <span className="stats-popup-label">{t(row.labelKey, locale)}</span>
            <b>{row.value}</b>
            <small>{row.detailKey ? t(row.detailKey, locale, row.detailParams) : row.detail}</small>
            {row.percent !== undefined && <span className="stats-popup-meter" aria-hidden="true"><i style={{ width: String(row.percent) + "%" }} /></span>}
          </div>)}
        </div>
        {onOpenDashboard && <button type="button" className="stats-popup-more" onClick={() => { setOpen(null); onOpenDashboard(); }}>{t("composer.stats.openDashboard", locale)}</button>}
      </div>,
      document.body,
    )}
  </div>;
}
