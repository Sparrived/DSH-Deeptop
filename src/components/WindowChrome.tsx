import { useEffect, useState, type MouseEvent } from "react";
import { isWindowChromeControl } from "../app/ui-model";
import type { WindowMenu } from "../app/model-types";
import { WindowControls } from "./WindowControls";

type EditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

type WindowChromeProps = {
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

  return (
    <header
      className="window-bar"
      onMouseDown={onDrag}
      onDoubleClick={(event) => { if (!isWindowChromeControl(event.target)) onToggleMaximize(); }}
    >
      <div className="brand-mark">DSH <span>DEEPTOP</span></div>
      <nav className="window-menu" aria-label="应用菜单">
        <div className="window-menu-group">
          <button className={`window-menu-button ${windowMenu === "project" ? "selected" : ""}`} onClick={() => toggleMenu("project")}>项目</button>
          {windowMenu === "project" && <div className="window-menu-dropdown" role="menu">
            <button role="menuitem" onClick={() => { closeMenu(); void onAddWorkspace(); }}>选择工作目录...</button>
            <button role="menuitem" onClick={() => { closeMenu(); onChooseRuntimeWorkspace(); }}>使用 DSH 运行目录</button>
            <div className="window-menu-separator" />
            <button role="menuitem" onClick={() => { closeMenu(); void onRestartRuntime(); }}>重新启动 DSH</button>
            <div className="window-menu-separator" />
            <button role="menuitem" onClick={() => { closeMenu(); onClose(); }}>关闭窗口</button>
          </div>}
        </div>
        <div className="window-menu-group">
          <button className={`window-menu-button ${windowMenu === "edit" ? "selected" : ""}`} onClick={() => toggleMenu("edit")}>编辑</button>
          {windowMenu === "edit" && <div className="window-menu-dropdown" role="menu">
            <button role="menuitem" onClick={() => runEditCommand("undo")}>撤销</button>
            <button role="menuitem" onClick={() => runEditCommand("redo")}>重做</button>
            <div className="window-menu-separator" />
            <button role="menuitem" onClick={() => runEditCommand("cut")}>剪切</button>
            <button role="menuitem" onClick={() => runEditCommand("copy")}>复制</button>
            <button role="menuitem" onClick={() => runEditCommand("paste")}>粘贴</button>
            <button role="menuitem" onClick={() => runEditCommand("selectAll")}>全选</button>
          </div>}
        </div>
      </nav>
      <div className="window-drag-space" />
      <div className="window-actions">
        <button className={`settings-button window-settings-button ${settingsOpen ? "selected" : ""}`} onClick={onOpenSettings} title="打开设置" aria-label="打开设置">⚙</button>
        <WindowControls
          windowMaximized={windowMaximized}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
        />
      </div>
    </header>
  );
}
