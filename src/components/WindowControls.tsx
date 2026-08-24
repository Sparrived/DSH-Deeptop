import { t, type UiLocale } from "../app/i18n";

type WindowControlsProps = {
  locale?: UiLocale;
  windowMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function WindowControls({ locale = "zh", windowMaximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  return (
    <div className="window-controls" aria-label={t("windowChrome.controls", locale)}>
      <button className="window-control minimize" onClick={onMinimize} title={t("windowChrome.minimize", locale)} aria-label={t("windowChrome.minimize", locale)}><span className="window-control-glyph" aria-hidden="true" /></button>
      <button className={`window-control ${windowMaximized ? "restore" : "maximize"}`} onClick={onToggleMaximize} title={windowMaximized ? t("windowChrome.restore", locale) : t("windowChrome.maximize", locale)} aria-label={windowMaximized ? t("windowChrome.restore", locale) : t("windowChrome.maximize", locale)}><span className="window-control-glyph" aria-hidden="true" /></button>
      <button className="window-control close" onClick={onClose} title={t("windowChrome.close", locale)} aria-label={t("windowChrome.close", locale)}><span className="window-control-glyph" aria-hidden="true" /></button>
    </div>
  );
}