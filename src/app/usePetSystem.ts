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
import { t, type UiLocale } from "./i18n.ts";

interface UsePetSystemOptions {
  desktop: boolean;
  libraryRequested: boolean;
  locale: UiLocale;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
}

const emptyLibrary: PetLibrarySnapshot = { directory: "", pets: [], warnings: [] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePetSystem({ desktop, libraryRequested, locale, onNotice, onError, onConfirm }: UsePetSystemOptions) {
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
        onError(t("pet.error.loadSettings", locale, { error: errorText(error) }));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [desktop, locale, onError]);

  useEffect(() => {
    if (!desktop || !loaded || !settings.enabled || !settings.selectedPetId) return;
    void showPetWindow().catch((error) => {
      onError(t("pet.error.restoreWindow", locale, { error: errorText(error) }));
    });
  }, [desktop, loaded, locale, onError, settings.enabled]);

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
      onError(t("pet.error.loadLibrary", locale, { error: errorText(error) }));
    });
    return () => {
      active = false;
    };
  }, [desktop, libraryLoaded, libraryRequested, loaded, locale, onError, settings]);

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
      onError(t("pet.error.saveSettings", locale, { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  }, [availableIds, locale, onError, settings]);

  const selectPet = useCallback(async (id: string) => {
    if (!availableIds.has(id) || id === settings.selectedPetId) return;
    setBusy(true);
    try {
      const next = normalizePetSettings({ ...settings, selectedPetId: id }, availableIds);
      const saved = await setPetSettings(next);
      setSettingsState(normalizePetSettings(saved, availableIds));
      onNotice(t("pet.notice.selected", locale, { name: entries.find((pet) => pet.id === id)?.name ?? id }));
    } catch (error) {
      onError(t("pet.error.switchPet", locale, { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  }, [availableIds, entries, locale, onError, onNotice, settings]);

  const importBundle = useCallback(async () => {
    if (!desktop) {
      onError(t("pet.error.importDesktopOnly", locale));
      return;
    }
    setBusy(true);
    try {
      const candidate = await pickPetBundle();
      if (!candidate) return;
      const existing = library.pets.find((pet) => pet.id === candidate.pet.id);
      if (candidate.replaceRequired) {
        const message = existing
          ? t("pet.confirm.replaceExisting", locale, {
              name: existing.name,
              version: candidate.pet.version,
              existingVersion: existing.version,
            })
          : t("pet.confirm.replaceBroken", locale, {
              name: candidate.pet.name,
              version: candidate.pet.version,
            });
        if (!await onConfirm(message)) return;
      }
      const installed = await installPetBundle(candidate.path, candidate.replaceRequired);
      const nextLibrary = await getPetLibrary();
      const ids = new Set(nextLibrary.pets.map((pet) => pet.id));
      const nextSettings = normalizePetSettings({ ...settings, enabled: true, selectedPetId: installed.id }, ids);
      const saved = await setPetSettings(nextSettings);
      setLibrary(nextLibrary);
      setSettingsState(normalizePetSettings(saved, ids));
      onNotice(t("pet.notice.installed", locale, { name: installed.name }));
    } catch (error) {
      onError(t("pet.error.import", locale, { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  }, [desktop, library.pets, locale, onConfirm, onError, onNotice, settings]);

  const exportSelected = useCallback(async () => {
    if (!settings.selectedPetId) {
      onError(t("pet.error.noShareablePet", locale));
      return;
    }
    setBusy(true);
    try {
      const path = await exportPetBundle(settings.selectedPetId);
      if (path) onNotice(t("pet.notice.exported", locale, { path }));
    } catch (error) {
      onError(t("pet.error.export", locale, { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  }, [locale, onError, onNotice, settings.selectedPetId]);

  const removeSelected = useCallback(async () => {
    const pet = entries.find((entry) => entry.id === settings.selectedPetId);
    if (!pet || !await onConfirm(t("pet.confirm.remove", locale, { name: pet.name }))) return;
    setBusy(true);
    try {
      await removePetBundle(pet.id);
      const nextLibrary = await getPetLibrary();
      const nextSettings = petSettingsAfterRemoval(settings, nextLibrary.pets);
      const ids = new Set(nextLibrary.pets.map((entry) => entry.id));
      const saved = await setPetSettings(nextSettings);
      setLibrary(nextLibrary);
      setSettingsState(normalizePetSettings(saved, ids));
      onNotice(t("pet.notice.removed", locale, { name: pet.name }));
    } catch (error) {
      onError(t("pet.error.remove", locale, { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  }, [entries, locale, onConfirm, onError, onNotice, settings]);

  const openDirectory = useCallback(async () => {
    try {
      await openPetsDirectory();
    } catch (error) {
      onError(t("pet.error.openDirectory", locale, { error: errorText(error) }));
    }
  }, [locale, onError]);

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
