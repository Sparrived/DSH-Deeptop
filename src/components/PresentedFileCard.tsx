import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, FolderOpen, SquareArrowOutUpRight } from "lucide-react";
import { pathBasename, type DeliverableFileDiff } from "../app/model";
import { fileTypeLabel } from "../app/file-type";
import {
  presentedFileManagerKey,
  presentedMenuDisabled,
  presentedPending,
  presentedStatusIsError,
  presentedStatusKey,
  type PresentedAction,
  type PresentedHost,
  type PresentedOpenPhase,
} from "../app/presented-file";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { t, type UiLocale } from "../app/i18n";

type PresentedFileCardProps = {
  path: string;
  /** 卡片副标题：文件所在目录。执行过原生动作后由阶段状态取代。 */
  detail: string;
  diff?: DeliverableFileDiff;
  locale: UiLocale;
  phase?: PresentedOpenPhase;
  /** 原生宿主元数据；`null` 时菜单整体禁用。 */
  host: PresentedHost | null;
  onPreview: (path: string) => void | Promise<void>;
  onAction: (path: string, action: PresentedAction) => void | Promise<void>;
};

/**
 * 一张交付文件卡片：主体按钮在应用内预览（第 2 条），旁挂 chevron 菜单执行
 * 两个原生动作。动作执行后把焦点还给主体按钮，菜单项在进行中禁用，
 * 阶段状态显示在副标题位置（上游 `PresentedFileCard.tsx` 的行为）。
 */
export function PresentedFileCard({ path, detail, diff, locale, phase, host, onPreview, onAction }: PresentedFileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLButtonElement | null>(null);
  const chevronRef = useRef<HTMLButtonElement | null>(null);
  const { menuRef, menuAt } = useFloatingMenuPosition(anchor);
  const pending = presentedPending(phase);
  const disabled = presentedMenuDisabled(phase, host);
  if (disabled && menuOpen) setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && (chevronRef.current?.contains(event.target) || menuRef.current?.contains(event.target))) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      chevronRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, menuRef]);

  const manager = host?.fileManager ?? "directory";
  const status = presentedStatusKey(phase, manager);
  const statusText = status === null
    ? detail
    : t(status.key, locale, status.manager ? { manager: t(presentedFileManagerKey(manager), locale) } : undefined);

  function run(action: PresentedAction) {
    setMenuOpen(false);
    previewRef.current?.focus();
    void onAction(path, action);
  }

  return <div className="deliverable-file-row" data-phase={phase ?? "idle"}>
    <button
      ref={previewRef}
      className="deliverable-file"
      type="button"
      onClick={() => void onPreview(path)}
      title={path}
      aria-label={diff ? t("deliverables.openFileAriaDetailed", locale, { path, added: diff.added, removed: diff.removed }) : t("deliverables.openFileAria", locale, { path })}
    >
      <span className="deliverable-file-type" aria-hidden="true">{fileTypeLabel(path)}</span>
      <span className="deliverable-file-copy">
        <strong>{pathBasename(path)}</strong>
        <small className="deliverable-file-status" role={status === null ? undefined : "status"} data-error={presentedStatusIsError(phase) ? true : undefined}>{statusText}</small>
      </span>
      {diff && <span className="deliverable-file-diff" aria-label={t("deliverables.addedRemoved", locale, { added: diff.added, removed: diff.removed })}><b>+{diff.added}</b><b>−{diff.removed}</b></span>}
      <span className="deliverable-file-open" aria-hidden="true"><ExternalLink /></span>
    </button>
    <button
      ref={chevronRef}
      className="deliverable-file-menu"
      type="button"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={t("deliverables.moreActionsAria", locale, { path })}
      title={t("deliverables.moreActionsAria", locale, { path })}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ x: rect.left, y: rect.bottom });
        setMenuOpen((open) => !open);
      }}
    >
      <ChevronDown aria-hidden="true" />
    </button>
    {menuOpen && anchor && createPortal(
      <div
        ref={menuRef}
        className="deliverable-file-actions"
        style={{ left: menuAt?.left ?? anchor.x, top: menuAt?.top ?? anchor.y }}
        role="menu"
        aria-label={t("deliverables.moreActionsAria", locale, { path })}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button role="menuitem" disabled={pending} onClick={() => run("open")}>
          <SquareArrowOutUpRight aria-hidden="true" />{t("deliverables.openWithDefaultApp", locale)}
        </button>
        <button role="menuitem" disabled={pending} onClick={() => run("reveal")}>
          <FolderOpen aria-hidden="true" />{t("deliverables.revealInManager", locale, { manager: t(presentedFileManagerKey(manager), locale) })}
        </button>
      </div>,
      document.body,
    )}
  </div>;
}
