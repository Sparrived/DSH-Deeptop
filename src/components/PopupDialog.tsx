import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PopupDialogProps {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
}

export function PopupDialog({
  title,
  eyebrow,
  description,
  children,
  footer,
  className,
  role = "dialog",
  onClose,
}: PopupDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className={`popup-modal${className ? ` ${className}` : ""}`} role={role} aria-modal="true" aria-label={title}>
      <button className="popup-backdrop" type="button" onClick={onClose} aria-label={`关闭${title}`} />
      <section className="popup-window" onMouseDown={(event) => event.stopPropagation()}>
        <header className="popup-header">
          <div className="popup-heading">
            {eyebrow && <span className="popup-eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="popup-close" type="button" onClick={onClose} aria-label={`关闭${title}`} title={`关闭${title}`}>×</button>
        </header>
        <div className="popup-body">{children}</div>
        {footer && <footer className="popup-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
