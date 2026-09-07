import { useEffect, useState, type MouseEvent } from "react";
import { Settings } from "lucide-react";
import { isWindowChromeControl } from "../app/ui-model";
import type { WindowMenu } from "../app/model-types";
import { WindowControls } from "./WindowControls";
import { t, type UiLocale } from "../app/i18n";

type EditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

type WindowChromeProps = {
  locale?: UiLocale;
  windowMaximized: boolean;
  settingsOpen: boolean;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onAddWorkspace: () => void | Promise<unknown>;
  onChooseRuntimeWorkspace: () => void;
  onRestartRuntime: () => void | Promise<unknown>;
  onEditCommand: (command: EditCommand) => void;
};

export function WindowChrome({
  locale = "zh",
  windowMaximized,
  settingsOpen,
  onDrag,
  onMinimize,
  onToggleMaximize,
  onClose,
  onOpenSettings,
  onAddWorkspace,
  onChooseRuntimeWorkspace,
  onRestartRuntime,
  onEditCommand,
}: WindowChromeProps) {
  const [windowMenu, setWindowMenu] = useState<WindowMenu | null>(null);

  useEffect(() => {
    if (!windowMenu) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".window-menu")) setWindowMenu(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setWindowMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [windowMenu]);

  const toggleMenu = (menu: WindowMenu) => setWindowMenu((current) => current === menu ? null : menu);
  const runEditCommand = (command: EditCommand) => {
    onEditCommand(command);
    setWindowMenu(null);
  };
  const closeMenu = () => setWindowMenu(null);
  const handleBarMouseDown = (event: MouseEvent<HTMLElement>) => {
    // The whole custom titlebar is draggable, but controls must keep the
    // native mouse sequence intact so React can deliver their click event.
    if (isWindowChromeControl(event.target)) {
      event.stopPropagation();
      return;
    }
    onDrag(event);
  };

  return (
    <header
      className="window-bar"
      onMouseDown={handleBarMouseDown}
      onDoubleClick={(event) => { if (!isWindowChromeControl(event.target)) onToggleMaximize(); }}
    >
      <div className="brand-mark">DSH <span>DEEPTOP</span></div>
      <nav className="window-menu" aria-label={t("windowChrome.menuAria", locale)}>
        <div className="window-menu-group">
          <button className={`window-menu-button ${windowMenu === "project" ? "selected" : ""}`} onClick={() => toggleMenu("project")}>{t("windowChrome.project", locale)}</button>
          {windowMenu === "project" && <div className="window-menu-dropdown" role="menu">
            <button role="menuitem" onClick={() => { closeMenu(); void onAddWorkspace(); }}>{t("windowChrome.chooseWorkdir", locale)}</button>
            <button role="menuitem" onClick={() => { closeMenu(); onChooseRuntimeWorkspace(); }}>{t("settings.workdir.fallback", locale)}</button>
            <div className="window-menu-separator" />
            <button role="menuitem" onClick={() => { closeMenu(); void onRestartRuntime(); }}>{t("windowChrome.restartDsh", locale)}</button>
            <div className="window-menu-separator" />
            <button role="menuitem" onClick={() => { closeMenu(); onClose(); }}>{t("windowChrome.closeWindow", locale)}</button>
          </div>}
        </div>
        <div className="window-menu-group">
          <button className={`window-menu-button ${windowMenu === "edit" ? "selected" : ""}`} onClick={() => toggleMenu("edit")}>{t("windowChrome.edit", locale)}</button>
          {windowMenu === "edit" && <div className="window-menu-dropdown" role="menu">
            <button role="menuitem" onClick={() => runEditCommand("undo")}>{t("windowChrome.undo", locale)}</button>
            <button role="menuitem" onClick={() => runEditCommand("redo")}>{t("windowChrome.redo", locale)}</button>
            <div className="window-menu-separator" />
            <button role="menuitem" onClick={() => runEditCommand("cut")}>{t("windowChrome.cut", locale)}</button>
            <button role="menuitem" onClick={() => runEditCommand("copy")}>{t("common.copy", locale)}</button>
            <button role="menuitem" onClick={() => runEditCommand("paste")}>{t("windowChrome.paste", locale)}</button>
            <button role="menuitem" onClick={() => runEditCommand("selectAll")}>{t("windowChrome.selectAll", locale)}</button>
          </div>}
        </div>
      </nav>
      <div className="window-drag-space" />
      <div className="window-actions">
        <button className={`settings-button window-settings-button ${settingsOpen ? "selected" : ""}`} onClick={onOpenSettings} title={t("windowChrome.openSettings", locale)} aria-label={t("windowChrome.openSettings", locale)}><span className="settings-button-glyph" aria-hidden="true"><Settings /></span><span className="settings-button-label">{t("settings.title", locale)}</span></button>
        <WindowControls
          locale={locale}
          windowMaximized={windowMaximized}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
        />
      </div>
    </header>
  );
}
