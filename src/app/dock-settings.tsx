import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getDockSettings, isTauri, setDockSettings, type DockSettings } from "../lib/desktop";

const defaultDockSettings: DockSettings = {
  autoCollapseOnOutsideClick: false,
};

type DockSettingsContextValue = {
  settings: DockSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<DockSettings>) => Promise<void>;
};

const DockSettingsContext = createContext<DockSettingsContextValue | null>(null);

export function DockSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultDockSettings);
  const [loaded, setLoaded] = useState(() => !isTauri());

  useEffect(() => {
    let active = true;
    if (!isTauri()) return () => { active = false; };
    void getDockSettings()
      .then((next) => {
        if (active) setSettings(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateSettings(patch: Partial<DockSettings>) {
    const next = { ...settings, ...patch };
    if (isTauri()) {
      const saved = await setDockSettings(next);
      setSettings(saved);
    } else {
      setSettings(next);
    }
  }

  const value = useMemo(() => ({ settings, loaded, updateSettings }), [loaded, settings]);
  return <DockSettingsContext.Provider value={value}>{children}</DockSettingsContext.Provider>;
}

export function useDockSettings() {
  const context = useContext(DockSettingsContext);
  if (!context) throw new Error("useDockSettings 必须在 DockSettingsProvider 内使用");
  return context;
}
