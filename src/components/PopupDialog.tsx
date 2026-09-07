import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { t, type UiLocale } from "../app/i18n";

interface PopupDialogProps {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  descriptionInBody?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  role?: "dialog" | "alertdialog";
  locale?: UiLocale;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hidden || element.closest("[hidden]")) return false;
    if (element.getAttribute("aria-hidden") === "true" || element.getAttribute("aria-disabled") === "true") return false;
    if (element.tabIndex < 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export function PopupDialog({
  title,
  eyebrow,
  description,
  descriptionInBody = false,
  children,
  footer,
  className,
  role = "dialog",
  locale = "zh",
  onClose,
}: PopupDialogProps) {
  const instanceId = useId();
  const titleId = `popup-title-${instanceId}`;
  const descriptionId = `popup-description-${instanceId}`;
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstFocusable = getFocusableElements(dialog)[0] ?? dialog;
    firstFocusable.focus();
    return () => {
      const previouslyFocusedElement = previouslyFocusedElementRef.current;
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialog.contains(activeElement) || activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className={`popup-modal${className ? ` ${className}` : ""}`}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <button className="popup-backdrop" type="button" onClick={onClose} aria-label={t("popup.closeTitle", locale, { title })} />
      <section ref={dialogRef} className="popup-window" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header className="popup-header">
          <div className="popup-heading">
            {eyebrow && <span className="popup-eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
            {description && !descriptionInBody && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="popup-close" type="button" onClick={onClose} aria-label={t("popup.closeTitle", locale, { title })} title={t("popup.closeTitle", locale, { title })}><X aria-hidden="true" /></button>
        </header>
        <div className="popup-body">{description && descriptionInBody && <p id={descriptionId} className="popup-confirm-message">{description}</p>}{children}</div>
        {footer && <footer className="popup-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
