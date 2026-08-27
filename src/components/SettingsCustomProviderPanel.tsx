import type { CustomProviderDraft } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { PopupDialog } from "./PopupDialog";

interface SettingsCustomProviderPanelProps {
  available: boolean;
  draft: CustomProviderDraft;
  open: boolean;
  busy: boolean;
  failure: string | null;
  pendingCredential: boolean;
  modelDiscoveryFeedback: { title: string; description: string } | null;
  locale?: UiLocale;
  onToggle: () => void;
  onDraftChange: (patch: Partial<CustomProviderDraft>) => void;
  onToggleModel: (modelId: string) => void;
  onDiscover: () => void | Promise<void>;
  onCancel: () => void;
  onCreate: () => void | Promise<void>;
  onDismissModelDiscoveryFeedback: () => void;
}

export function SettingsCustomProviderPanel({
  available,
  draft,
  open,
  busy,
  failure,
  pendingCredential,
  modelDiscoveryFeedback,
  locale = "zh",
  onToggle,
  onDraftChange,
  onToggleModel,
  onDiscover,
  onCancel,
  onCreate,
  onDismissModelDiscoveryFeedback,
}: SettingsCustomProviderPanelProps) {
  if (!available) return null;

  const profileLocked = busy || pendingCredential;

  return <div className="settings-custom-provider">
    <div className="settings-custom-provider-heading">
      <div><strong>{t("settings.customProvider.title", locale)}</strong><small>{t("settings.customProvider.subtitle", locale)}</small></div>
      <button type="button" onClick={onToggle}>{open ? t("settings.customProvider.collapse", locale) : t("settings.customProvider.add", locale)}</button>
    </div>
    {open && <div className="settings-custom-provider-form">
      {pendingCredential && <p className="settings-custom-provider-status" role="status">{t("settings.customProvider.credentialPending", locale)}</p>}
      <div className="settings-custom-provider-grid">
        <label><span>Provider ID</span><input disabled={profileLocked} value={draft.provider} placeholder="my-gateway" onChange={(event) => onDraftChange({ provider: event.target.value })} /></label>
        <label><span>{t("settings.customProvider.displayName", locale)}</span><input disabled={profileLocked} value={draft.displayName} placeholder={t("settings.customProvider.optional", locale)} onChange={(event) => onDraftChange({ displayName: event.target.value })} /></label>
        <label><span>Base URL</span><input disabled={profileLocked} type="url" value={draft.baseURL} placeholder="https://api.example.com/v1" onChange={(event) => onDraftChange({ baseURL: event.target.value })} /></label>
        <label><span>{t("settings.customProvider.protocol", locale)}</span><input disabled={profileLocked} value={draft.api} placeholder="openai-completions" onChange={(event) => onDraftChange({ api: event.target.value })} /></label>
        <label><span>{t("settings.customProvider.apiKey", locale)}</span><input disabled={busy} type="password" autoComplete="off" value={draft.apiKey} placeholder={t("settings.customProvider.optional", locale)} onChange={(event) => onDraftChange({ apiKey: event.target.value })} /></label>
      </div>
      <div className="settings-custom-provider-actions"><button type="button" disabled={profileLocked} onClick={() => void onDiscover()}>{busy ? t("settings.customProvider.busy", locale) : t("settings.customProvider.discoverModels", locale)}</button></div>
      {draft.models.length > 0 && <div className="settings-custom-provider-models">{draft.models.map((model) => <label key={`custom-model-${model.id}`}><input disabled={profileLocked} type="checkbox" checked={draft.selectedModels.includes(model.id)} onChange={() => onToggleModel(model.id)} /><span><strong>{model.name || model.id}</strong><small>{model.id}</small></span></label>)}</div>}
      {failure && <p className="settings-custom-provider-error" role="alert">{failure}</p>}
      <div className="settings-custom-provider-actions"><button type="button" disabled={busy} onClick={onCancel}>{t("settings.customProvider.cancel", locale)}</button><button type="button" className="confirm" disabled={busy} onClick={() => void onCreate()}>{pendingCredential ? t("settings.customProvider.retryCredential", locale) : t("settings.customProvider.saveProvider", locale)}</button></div>
    </div>}
    {modelDiscoveryFeedback && <PopupDialog
      title={modelDiscoveryFeedback.title}
      eyebrow="MODEL DISCOVERY"
      description={modelDiscoveryFeedback.description}
      className="popup-provider-feedback-dialog"
      role="alertdialog"
      locale={locale}
      onClose={onDismissModelDiscoveryFeedback}
      footer={<button type="button" className="confirm" onClick={onDismissModelDiscoveryFeedback}>{t("common.done", locale)}</button>}
    ><p className="popup-warning-copy">{t("provider.discoveryFeedback.retryHint", locale)}</p></PopupDialog>}
  </div>;
}
