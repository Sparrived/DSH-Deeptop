import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowChromeControl } from "./ui-model";
import { errorText } from "./settings-model";

type UseWindowControlsOptions = {
  desktop: boolean;
  onError: (message: string) => void;
};

export function useWindowControls({ desktop, onError }: UseWindowControlsOptions) {
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then(setWindowMaximized).catch(() => undefined);
    void appWindow.onResized(() => {
      void appWindow.isMaximized().then(setWindowMaximized).catch(() => undefined);
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, [desktop]);

  async function startWindowDrag(event: MouseEvent<HTMLElement>) {
    if (!desktop || event.button !== 0 || isWindowChromeControl(event.target)) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      onError(errorText(error));
    }
  }

  async function toggleWindowMaximize() {
    if (!desktop) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setWindowMaximized(await appWindow.isMaximized());
    } catch (error) {
      onError(errorText(error));
    }
  }

  async function minimizeWindow() {
    if (!desktop) return;
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      onError(errorText(error));
    }
  }

  async function closeWindow() {
    if (!desktop) return;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      onError(errorText(error));
    }
  }

  return { windowMaximized, startWindowDrag, toggleWindowMaximize, minimizeWindow, closeWindow };
}
