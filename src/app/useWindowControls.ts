import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowChromeControl } from "./ui-model";
import { errorText } from "./settings-model";
import { trackAsyncCleanup } from "../lib/async-cleanup";

type UseWindowControlsOptions = {
  desktop: boolean;
  minimizeToTray: boolean;
  onCloseRequested: () => void;
  onError: (message: string) => void;
};

export function useWindowControls({ desktop, minimizeToTray, onCloseRequested, onError }: UseWindowControlsOptions) {
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    const cleanups: Array<() => void> = [];
    let disposed = false;
    void appWindow.isMaximized().then((maximized) => {
      if (!disposed) setWindowMaximized(maximized);
    }).catch(() => undefined);
    trackAsyncCleanup(cleanups, appWindow.onResized(() => {
      if (disposed) return;
      void appWindow.isMaximized().then((maximized) => {
        if (!disposed) setWindowMaximized(maximized);
      }).catch(() => undefined);
    }), () => disposed);
    return () => {
      disposed = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
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
      if (minimizeToTray) {
        await getCurrentWindow().hide();
      } else {
        await getCurrentWindow().minimize();
      }
    } catch (error) {
      onError(errorText(error));
    }
  }

  function closeWindow() {
    if (desktop) onCloseRequested();
  }

  return { windowMaximized, startWindowDrag, toggleWindowMaximize, minimizeWindow, closeWindow };
}
