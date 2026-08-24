import type { CustomProviderDraft } from "../app/model";
import { t, type UiLocale } from "../app/i18n";

interface SettingsCustomProviderPanelProps {
  available: boolean;
  draft: CustomProviderDraft;
  open: boolean;
  busy: boolean;
  locale?: UiLocale;
  onToggle: () => void;
  onDraftChange: (patch: Partial<CustomProviderDraft>) => void;
  onToggleModel: (modelId: string) => void;
  onDiscover: () => void | Promise<void>;
  onCancel: () => void;
  onCreate: () => void | Promise<void>;
}

export function SettingsCustomProviderPanel({
  available,
  draft,
  open,
  busy,
  locale = "zh",
  onToggle,
  onDraftChange,
  onToggleModel,
  onDiscover,
  onCancel,
  onCreate,
}: SettingsCustomProviderPanelProps) {
  if (!available) return null;

  return <div className="settings-custom-provider">
    <div className="settings-custom-provider-heading">
      <div><strong>{t("settings.customProvider.title", locale)}</strong><small>{t("settings.customProvider.subtitle", locale)}</small></div>
      <button type="button" onClick={onToggle}>{open ? t("settings.customProvider.collapse", locale) : t("settings.customProvider.add", locale)}</button>
    </div>
    {open && <div className="settings-custom-provider-form">
      <div className="settings-custom-provider-grid">
        <label><span>Provider ID</span><input value={draft.provider} placeholder="my-gateway" onChange={(event) => onDraftChange({ provider: event.target.value })} /></label>
        <label><span>{t("settings.customProvider.displayName", locale)}</span><input value={draft.displayName} placeholder={t("settings.customProvider.optional", locale)} onChange={(event) => onDraftChange({ displayName: event.target.value })} /></label>
        <label><span>Base URL</span><input type="url" value={draft.baseURL} placeholder="https://api.example.com/v1" onChange={(event) => onDraftChange({ baseURL: event.target.value })} /></label>
        <label><span>{t("settings.customProvider.protocol", locale)}</span><input value={draft.api} placeholder="openai-completions" onChange={(event) => onDraftChange({ api: event.target.value })} /></label>
        <label><span>{t("settings.customProvider.apiKey", locale)}</span><input type="password" autoComplete="off" value={draft.apiKey} placeholder={t("settings.customProvider.optional", locale)} onChange={(event) => onDraftChange({ apiKey: event.target.value })} /></label>
      </div>
      <div className="settings-custom-provider-actions"><button type="button" disabled={busy} onClick={() => void onDiscover()}>{busy ? t("settings.customProvider.busy", locale) : t("settings.customProvider.discoverModels", locale)}</button></div>
      {draft.models.length > 0 && <div className="settings-custom-provider-models">{draft.models.map((model) => <label key={`custom-model-${model.id}`}><input type="checkbox" checked={draft.selectedModels.includes(model.id)} onChange={() => onToggleModel(model.id)} /><span><strong>{model.name || model.id}</strong><small>{model.id}</small></span></label>)}</div>}
      <div className="settings-custom-provider-actions"><button type="button" onClick={onCancel}>{t("settings.customProvider.cancel", locale)}</button><button type="button" className="confirm" disabled={busy} onClick={() => void onCreate()}>{t("settings.customProvider.saveProvider", locale)}</button></div>
    </div>}
  </div>;
}
