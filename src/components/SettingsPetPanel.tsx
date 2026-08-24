import { useCallback, useEffect, useMemo, useState } from "react";
import type { PetAnimationState, PetBundle, PetBundleDescriptor, PetCareState, PetSettings } from "../lib/desktop";
import { petAnimationDurationMs, petSpritesheetAssetSource } from "../app/pet-model";
import { PetCanvas } from "./PetCanvas";
import { t, type UiLocale } from "../app/i18n";

interface SettingsPetPanelProps {
  locale?: UiLocale;
  desktop: boolean;
  settings: PetSettings;
  entries: PetBundleDescriptor[];
  selectedPet: PetBundleDescriptor | null;
  directory: string;
  warnings: string[];
  loaded: boolean;
  busy: boolean;
  previewBundle: PetBundle | null;
  previewLoading: boolean;
  previewError: string | null;
  careState: PetCareState | null;
  careError: string | null;
  onUpdate: (patch: Partial<PetSettings>) => void | Promise<void>;
  onSelect: (id: string) => void | Promise<void>;
  onImport: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onOpenDirectory: () => void | Promise<void>;
}

interface PetSettingsPreviewProps {
  selectedPet: PetBundleDescriptor | null;
  bundle: PetBundle | null;
  loading: boolean;
  error: string | null;
  motionEnabled: boolean;
  locale: UiLocale;
}

function PetSettingsPreview({ selectedPet, bundle, loading, error, motionEnabled, locale }: PetSettingsPreviewProps) {
  const [animation, setAnimation] = useState<PetAnimationState>("idle");
  const [ready, setReady] = useState(false);
  const source = useMemo(() => bundle ? petSpritesheetAssetSource(bundle) : null, [bundle]);
  const handleReadyChange = useCallback((nextReady: boolean) => setReady(nextReady), []);

  useEffect(() => {
    setAnimation("idle");
    setReady(false);
  }, [selectedPet?.id, source]);

  useEffect(() => {
    if (animation === "idle") return;
    const timer = window.setTimeout(() => setAnimation("idle"), petAnimationDurationMs(animation));
    return () => window.clearTimeout(timer);
  }, [animation]);

  return (
    <div className="pet-settings-preview">
      <button
        type="button"
        className="pet-settings-preview-stage"
        disabled={!source || loading}
        onClick={() => setAnimation((current) => current === "jumping" ? "waving" : "jumping")}
        aria-label={selectedPet ? t("pets.previewInteractAria", locale, { name: selectedPet.name }) : t("pets.notInstalled", locale)}
      >
        {source ? (
          <span className={`pet-settings-preview-visual${ready ? " asset-ready" : ""}`}>
            <PetCanvas
              state={animation}
              source={source}
              lookDirection={null}
              motionEnabled={motionEnabled}
              onReadyChange={handleReadyChange}
            />
          </span>
        ) : <span className="pet-settings-preview-status">{loading ? t("pets.loading", locale) : selectedPet ? t("pets.previewUnavailable", locale) : t("pets.notInstalled", locale)}</span>}
      </button>
      <div className="pet-settings-preview-actions">
        <button type="button" disabled={!source || loading} onClick={() => setAnimation("waving")}>{t("pets.wave", locale)}</button>
        <button type="button" disabled={!source || loading} onClick={() => setAnimation("jumping")}>{t("pets.jump", locale)}</button>
      </div>
      {error && <small className="pet-settings-preview-error">{t("pets.previewError", locale, { error })}</small>}
    </div>
  );
}

export function SettingsPetPanel({
  locale = "zh",
  desktop,
  settings,
  entries,
  selectedPet,
  directory,
  warnings,
  loaded,
  busy,
  previewBundle,
  previewLoading,
  previewError,
  careState,
  careError,
  onUpdate,
  onSelect,
  onImport,
  onExport,
  onRemove,
  onOpenDirectory,
}: SettingsPetPanelProps) {
  const controlsDisabled = busy || !selectedPet;
  return (
    <div className="settings-page pet-settings-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">DESKTOP PETS</span>
          <h2>{t("settings.pets", locale)}</h2>
          <p>{t("pets.subtitle", locale)}</p>
        </div>
        <label className="pet-master-switch">
          <span>{settings.enabled ? t("pets.enabled", locale) : t("pets.disabled", locale)}</span>
          <span className="settings-plugin-toggle" aria-label={t("pets.enableAria", locale)}>
            <input type="checkbox" checked={settings.enabled} disabled={!loaded || busy || !selectedPet} onChange={(event) => void onUpdate({ enabled: event.target.checked })} />
            <span aria-hidden="true" />
          </span>
        </label>
      </div>

      {!loaded ? <p className="settings-empty">{t("pets.readingSettings", locale)}</p> : (
        <>
          <section className="settings-block pet-current-card">
            <div className="pet-current-showcase">
              <PetSettingsPreview
                selectedPet={selectedPet}
                bundle={previewBundle}
                loading={previewLoading}
                error={previewError}
                motionEnabled={settings.motionEnabled}
                locale={locale}
              />
              <div className="pet-current-details">
                <div className="settings-block-heading">
                  <div><h3>{selectedPet?.name ?? t("pets.notInstalled", locale)}</h3><p>{selectedPet?.description || t("pets.installPrompt", locale)}</p></div>
                  {selectedPet && <span className="pet-source-badge">{t("pets.installed", locale)}</span>}
                </div>
                <p className="pet-current-hint">{selectedPet ? t("pets.previewHint", locale) : t("pets.libraryHint", locale)}</p>
                {selectedPet && settings.careEnabled && careState && (
                  <div className="pet-care-summary" aria-label={t("pets.careAria", locale)}>
                    <span><small>{t("pets.satiety", locale)}</small><strong>{Math.round(careState.satiety)}</strong></span>
                    <span><small>{t("pets.mood", locale)}</small><strong>{Math.round(careState.mood)}</strong></span>
                    <span><small>{t("pets.affection", locale)}</small><strong>{Math.round(careState.affection)}</strong></span>
                  </div>
                )}
                {careError && <small className="pet-settings-preview-error">{t("pets.careError", locale, { error: careError })}</small>}
              </div>
            </div>
          </section>

          <section className="settings-block">
            <div className="settings-block-heading"><div><h3>{t("pets.display", locale)}</h3><p>{t("pets.displayHint", locale)}</p></div></div>
            <div className="settings-preference-list">
              <label className="settings-preference-row"><span><strong>{t("pets.currentPet", locale)}</strong><small>{t("pets.availableCount", locale, { count: entries.length })}</small></span><select value={selectedPet?.id ?? ""} disabled={busy || entries.length === 0} onChange={(event) => void onSelect(event.target.value)}>{entries.length === 0 && <option value="">{t("pets.notInstalled", locale)}</option>}{entries.map((pet) => <option value={pet.id} key={pet.id}>{pet.name}</option>)}</select></label>
              <label className="settings-preference-row"><span><strong>{t("pets.anchor", locale)}</strong><small>{t("pets.anchorHint", locale)}</small></span><select value={settings.anchor} disabled={controlsDisabled} onChange={(event) => void onUpdate({ anchor: event.target.value === "bottom-left" ? "bottom-left" : "bottom-right" })}><option value="bottom-right">{t("pets.bottomRight", locale)}</option><option value="bottom-left">{t("pets.bottomLeft", locale)}</option></select></label>
              <label className="settings-preference-row"><span><strong>{t("pets.size", locale)}</strong><small>{t("pets.sizeHint", locale)}</small></span><select value={settings.size} disabled={controlsDisabled} onChange={(event) => void onUpdate({ size: Number(event.target.value) })}><option value="64">{t("pets.sizeSmall", locale)}</option><option value="88">{t("pets.sizeMedium", locale)}</option><option value="112">{t("pets.sizeLarge", locale)}</option><option value="144">{t("pets.sizeXLarge", locale)}</option></select></label>
              <div className="settings-preference-row"><span><strong>{t("pets.alwaysOnTop", locale)}</strong><small>{t("pets.alwaysOnTopHint", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("pets.alwaysOnTopAria", locale)}><input type="checkbox" checked={settings.alwaysOnTop} disabled={controlsDisabled} onChange={(event) => void onUpdate({ alwaysOnTop: event.target.checked })} /><span aria-hidden="true" /></label></div>
              <div className="settings-preference-row"><span><strong>{t("pets.motion", locale)}</strong><small>{t("pets.motionHint", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("pets.motionAria", locale)}><input type="checkbox" checked={settings.motionEnabled} disabled={controlsDisabled} onChange={(event) => void onUpdate({ motionEnabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
              <div className="settings-preference-row"><span><strong>{t("pets.interactions", locale)}</strong><small>{t("pets.interactionsHint", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("pets.interactionsAria", locale)}><input type="checkbox" checked={settings.interactionsEnabled} disabled={controlsDisabled} onChange={(event) => void onUpdate({ interactionsEnabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
              <div className="settings-preference-row"><span><strong>{t("pets.care", locale)}</strong><small>{t("pets.careHint", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("pets.careToggleAria", locale)}><input type="checkbox" checked={settings.careEnabled} disabled={controlsDisabled} onChange={(event) => void onUpdate({ careEnabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
            </div>
          </section>

          <section className="settings-block">
            <div className="settings-block-heading"><div><h3>{t("pets.library", locale)}</h3><p>{t("pets.libraryHint2", locale)}</p></div><div className="pet-library-actions"><button type="button" className="settings-header-action" disabled={!desktop || busy} onClick={() => void onImport()}>{t("pets.install", locale)}</button>{selectedPet && <button type="button" className="settings-header-action" disabled={!desktop || busy} onClick={() => void onExport()}>{t("pets.share", locale)}</button>}{selectedPet && <button type="button" className="settings-header-action danger-button" disabled={!desktop || busy} onClick={() => void onRemove()}>{t("common.delete", locale)}</button>}</div></div>
            <details className="pet-library-more">
              <summary>{t("pets.manage", locale)}</summary>
              <div className="pet-library-more-content">
                <div className="pet-library-directory"><span>{t("pets.localDirectory", locale)}</span><code>{directory || t("common.desktopOnly", locale)}</code><button type="button" className="settings-header-action" disabled={!desktop} onClick={() => void onOpenDirectory()}>{t("common.openDirectory", locale)}</button></div>
                <div className="pet-creator-guide">
                  <strong>{t("pets.creatorTitle", locale)}</strong>
                  <p>{t("pets.creatorHint", locale)}</p>
                  <code>npm run pet:pack -- &lt;{t("pets.creatorDirPlaceholder", locale)}&gt;</code>
                  <small>{t("pets.creatorNote", locale)}</small>
                </div>
              </div>
            </details>
            {warnings.length > 0 && <div className="pet-library-warnings" role="status"><strong>{t("pets.warningsTitle", locale, { count: warnings.length })}</strong>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
            <p className="pet-library-footnote">{t("pets.footnote", locale)}</p>
          </section>
        </>
      )}
    </div>
  );
}
