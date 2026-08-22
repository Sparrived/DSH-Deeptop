import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getDockSettings, isTauri, setDockSettings, type DockSettings } from "../lib/desktop";
import { isDockPinned, normalizePinnedDocks, withDockPinned } from "./dock-pin";

const defaultDockSettings: DockSettings = {
  autoCollapseOnOutsideClick: false,
  pinned: {},
};

type DockSettingsContextValue = {
  settings: DockSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<DockSettings>) => Promise<void>;
  pinnedDocks: Record<string, boolean>;
  isDockPinned: (id: string) => boolean;
  toggleDockPinned: (id: string) => void;
};

const DockSettingsContext = createContext<DockSettingsContextValue | null>(null);

function normalizeSettings(settings: Partial<DockSettings> | null | undefined): DockSettings {
  return {
    autoCollapseOnOutsideClick: settings?.autoCollapseOnOutsideClick === true,
    pinned: normalizePinnedDocks(settings?.pinned),
  };
}

export function DockSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultDockSettings);
  const [loaded, setLoaded] = useState(() => !isTauri());

  useEffect(() => {
    let active = true;
    if (!isTauri()) return () => { active = false; };
    void getDockSettings()
      .then((next) => {
        if (active) setSettings(normalizeSettings(next));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback(async (next: DockSettings) => {
    if (!isTauri()) {
      setSettings(next);
      return;
    }
    // 桥接保存失败时保留本地状态并抛出，让调用方决定如何提示。
    const saved = await setDockSettings(next);
    setSettings(normalizeSettings(saved));
  }, []);

  const updateSettings = useCallback(async (patch: Partial<DockSettings>) => {
    await persist(normalizeSettings({ ...settings, ...patch }));
  }, [persist, settings]);

  const toggleDockPinned = useCallback((id: string) => {
    const next = withDockPinned(settings.pinned, id, !isDockPinned(settings.pinned, id));
    void persist(normalizeSettings({ ...settings, pinned: next })).catch((error) => {
      console.error("保存 Dock 钉住状态失败", error);
    });
  }, [persist, settings]);

  const value = useMemo<DockSettingsContextValue>(() => ({
    settings,
    loaded,
    updateSettings,
    pinnedDocks: settings.pinned,
    isDockPinned: (id: string) => isDockPinned(settings.pinned, id),
    toggleDockPinned,
  }), [loaded, settings, toggleDockPinned, updateSettings]);

  return <DockSettingsContext.Provider value={value}>{children}</DockSettingsContext.Provider>;
}

export function useDockSettings() {
  const context = useContext(DockSettingsContext);
  if (!context) throw new Error("useDockSettings 必须在 DockSettingsProvider 内使用");
  return context;
}
