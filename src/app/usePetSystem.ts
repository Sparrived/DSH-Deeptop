import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportPetBundle,
  getPetCareState,
  getPetLibrary,
  getPetSettings,
  installPetBundle,
  listenToPetCareChanges,
  openPetsDirectory,
  pickPetBundle,
  readPetBundle,
  removePetBundle,
  setPetSettings,
  showPetWindow,
  type PetBundle,
  type PetCareState,
  type PetLibrarySnapshot,
  type PetSettings,
} from "../lib/desktop";
import {
  defaultPetSettings,
  normalizePetSettings,
  petLibraryEntries,
  petSettingsAfterRemoval,
} from "./pet-model";

interface UsePetSystemOptions {
  desktop: boolean;
  libraryRequested: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
}

const emptyLibrary: PetLibrarySnapshot = { directory: "", pets: [], warnings: [] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePetSystem({ desktop, libraryRequested, onNotice, onError, onConfirm }: UsePetSystemOptions) {
  const [settings, setSettingsState] = useState<PetSettings>({ ...defaultPetSettings });
  const [library, setLibrary] = useState<PetLibrarySnapshot>(emptyLibrary);
  const [loaded, setLoaded] = useState(!desktop);
  const [libraryLoaded, setLibraryLoaded] = useState(!desktop);
  const [busy, setBusy] = useState(false);
  const [previewBundle, setPreviewBundle] = useState<PetBundle | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [careState, setCareState] = useState<PetCareState | null>(null);
  const [careError, setCareError] = useState<string | null>(null);

  const entries = useMemo(() => petLibraryEntries(library.pets), [library.pets]);
  const availableIds = useMemo(() => new Set(entries.map((pet) => pet.id)), [entries]);
  const selectedPet = entries.find((pet) => pet.id === settings.selectedPetId) ?? entries[0] ?? null;

  useEffect(() => {
    if (!desktop || !libraryRequested) {
      setCareState(null);
      setCareError(null);
      return;
    }
    let active = true;
    let unlisten: (() => void) | null = null;
    async function initializeCare() {
      const nextUnlisten = await listenToPetCareChanges((nextState) => {
        if (active) setCareState(nextState);
      });
      if (!active) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
      const nextState = await getPetCareState();
      if (!active) return;
      setCareState(nextState);
      setCareError(null);
    }
    void initializeCare().catch((error) => {
      if (active) setCareError(errorText(error));
      unlisten?.();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [desktop, libraryRequested]);

  useEffect(() => {
    let active = true;
    if (!desktop) {
      setLoaded(true);
      return () => {
        active = false;
      };
    }

    void getPetSettings()
      .then((rawSettings) => {
        if (active) setSettingsState(normalizePetSettings(rawSettings));
      })
      .catch((error) => {
        if (!active) return;
        setSettingsState({ ...defaultPetSettings });
        onError(`读取宠物设置失败，已使用默认值：${errorText(error)}`);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [desktop, onError]);

  useEffect(() => {
    if (!desktop || !loaded || !settings.enabled || !settings.selectedPetId) return;
    void showPetWindow().catch((error) => {
      onError(`恢复宠物失败，主界面不受影响：${errorText(error)}`);
    });
  }, [desktop, loaded, onError, settings.enabled]);

  useEffect(() => {
    if (!desktop || !loaded || libraryLoaded || (!settings.enabled && !libraryRequested)) return;
    let active = true;
    async function loadLibrary() {
      const nextLibrary = await getPetLibrary();
      const ids = new Set(nextLibrary.pets.map((pet) => pet.id));
      const nextSettings = normalizePetSettings(settings, ids);
      if (!active) return;
      setLibrary(nextLibrary);
      setSettingsState(nextSettings);
      setLibraryLoaded(true);
      if (nextSettings.selectedPetId !== settings.selectedPetId) {
        void setPetSettings(nextSettings).catch(() => undefined);
      }
    }
    void loadLibrary().catch((error) => {
      if (!active) return;
      setLibraryLoaded(true);
      onError(`读取宠物库失败，主界面不受影响：${errorText(error)}`);
    });
    return () => {
      active = false;
    };
  }, [desktop, libraryLoaded, libraryRequested, loaded, onError, settings]);

  useEffect(() => {
    let active = true;
    if (!desktop || !libraryRequested || !selectedPet) {
      setPreviewBundle(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return () => {
        active = false;
      };
    }
    setPreviewBundle(null);
    setPreviewLoading(true);
    setPreviewError(null);
    void readPetBundle(selectedPet.id)
      .then((bundle) => {
        if (active) setPreviewBundle(bundle);
      })
      .catch((error) => {
        if (active) setPreviewError(errorText(error));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [desktop, libraryRequested, selectedPet?.id]);

  const updateSettings = useCallback(async (patch: Partial<PetSettings>) => {
    const next = normalizePetSettings({ ...settings, ...patch }, availableIds);
    setBusy(true);
    try {
      const saved = await setPetSettings(next);
      setSettingsState(normalizePetSettings(saved, availableIds));
    } catch (error) {
      onError(`保存宠物设置失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, [availableIds, onError, settings]);

  const selectPet = useCallback(async (id: string) => {
    if (!availableIds.has(id) || id === settings.selectedPetId) return;
    setBusy(true);
    try {
      const next = normalizePetSettings({ ...settings, selectedPetId: id }, availableIds);
      const saved = await setPetSettings(next);
      setSettingsState(normalizePetSettings(saved, availableIds));
      onNotice(`已选择宠物：${entries.find((pet) => pet.id === id)?.name ?? id}`);
    } catch (error) {
      onError(`切换宠物失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, [availableIds, entries, onError, onNotice, settings]);

  const importBundle = useCallback(async () => {
    if (!desktop) {
      onError("宠物包导入只在 Deeptop 桌面端可用");
      return;
    }
    setBusy(true);
    try {
      const candidate = await pickPetBundle();
      if (!candidate) return;
      const existing = library.pets.find((pet) => pet.id === candidate.pet.id);
      if (candidate.replaceRequired) {
        const message = existing
          ? `宠物“${existing.name}”已安装。要用 ${candidate.pet.version} 版本替换当前 ${existing.version} 版本吗？`
          : `同 ID 的旧宠物包无法加载。要用“${candidate.pet.name}”${candidate.pet.version} 替换并修复它吗？`;
        if (!await onConfirm(message)) return;
      }
      const installed = await installPetBundle(candidate.path, candidate.replaceRequired);
      const nextLibrary = await getPetLibrary();
      const ids = new Set(nextLibrary.pets.map((pet) => pet.id));
      const nextSettings = normalizePetSettings({ ...settings, enabled: true, selectedPetId: installed.id }, ids);
      const saved = await setPetSettings(nextSettings);
      setLibrary(nextLibrary);
      setSettingsState(normalizePetSettings(saved, ids));
      onNotice(`已安装并启用宠物：${installed.name}`);
    } catch (error) {
      onError(`导入宠物失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, [desktop, library.pets, onConfirm, onError, onNotice, settings]);

  const exportSelected = useCallback(async () => {
    if (!settings.selectedPetId) {
      onError("当前没有可分享的宠物");
      return;
    }
    setBusy(true);
    try {
      const path = await exportPetBundle(settings.selectedPetId);
      if (path) onNotice(`宠物包已导出：${path}`);
    } catch (error) {
      onError(`导出宠物失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, [onError, onNotice, settings.selectedPetId]);

  const removeSelected = useCallback(async () => {
    const pet = entries.find((entry) => entry.id === settings.selectedPetId);
    if (!pet || !await onConfirm(`移除宠物“${pet.name}”？只会删除 Deeptop 保存的宠物包副本。`)) return;
    setBusy(true);
    try {
      await removePetBundle(pet.id);
      const nextLibrary = await getPetLibrary();
      const nextSettings = petSettingsAfterRemoval(settings, nextLibrary.pets);
      const ids = new Set(nextLibrary.pets.map((entry) => entry.id));
      const saved = await setPetSettings(nextSettings);
      setLibrary(nextLibrary);
      setSettingsState(normalizePetSettings(saved, ids));
      onNotice(`已移除宠物：${pet.name}`);
    } catch (error) {
      onError(`移除宠物失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, [entries, onConfirm, onError, onNotice, settings]);

  const openDirectory = useCallback(async () => {
    try {
      await openPetsDirectory();
    } catch (error) {
      onError(`打开宠物目录失败：${errorText(error)}`);
    }
  }, [onError]);

  return {
    settings,
    library,
    entries,
    selectedPet,
    loaded,
    libraryLoaded,
    busy,
    previewBundle,
    previewLoading,
    previewError,
    careState,
    careError,
    updateSettings,
    selectPet,
    importBundle,
    exportSelected,
    removeSelected,
    openDirectory,
  };
}
