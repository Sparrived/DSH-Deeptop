import type { DiscoveredModel } from "../app/model";
import type { DshCredential, DshModelGroup, DshProvider } from "../lib/desktop";
import { PopupDialog } from "./PopupDialog";
import { t, type UiLocale } from "../app/i18n";

type ProviderDraft = {
  baseURL: string;
  api: string;
};

type ProviderAction = () => void | Promise<unknown>;

export interface SettingsProviderCardView {
  provider: DshProvider;
  secretTotal: number;
  secretConfigured: number;
  hasCredential: boolean;
  credential?: DshCredential;
  modelGroups: DshModelGroup[];
  configuredModels: Array<Record<string, unknown>>;
  draft: ProviderDraft;
  candidates: DiscoveredModel[];
  selectedCandidateIds: string[];
  removable: boolean;
  open: boolean;
  settingsWritable: boolean;
  namespaceAvailable: boolean;
  discoveryBusy: boolean;
  credentialDraft: string;
  credentialBusy: boolean;
}

export interface SettingsProviderCardActions {
  onToggle: () => void;
  onDraftChange: (patch: Partial<ProviderDraft>) => void;
  onSaveSettings: ProviderAction;
  onDiscoverModels: ProviderAction;
  onRemoveModel: (modelId: string) => void | Promise<unknown>;
  onToggleModelImages: (modelId: string) => void | Promise<unknown>;
  onToggleCandidate: (modelId: string) => void;
  onApplyCandidates: ProviderAction;
  onCredentialDraftChange: (value: string) => void;
  onSaveCredential: ProviderAction;
  onClearCredential: ProviderAction;
  onRemoveConfiguration: ProviderAction;
  onOpenNamespace: () => void;
}

interface SettingsProviderCardProps {
  view: SettingsProviderCardView;
  actions: SettingsProviderCardActions;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
}

export function SettingsProviderCard({ view, actions, locale = "zh" }: SettingsProviderCardProps) {
  const { provider, credential, draft } = view;

  return <article className={`settings-provider-card ${view.open ? "open" : ""}`}>
    <button type="button" className="settings-provider-header" onClick={actions.onToggle} aria-expanded={view.open} aria-haspopup="dialog">
      <span className="settings-provider-title"><strong>{provider.displayName}</strong><small>{provider.provider}</small></span>
      <span className="settings-provider-trailing"><i className={provider.active ? "active" : ""} /><span>{t(provider.active ? "provider.active" : "provider.inactive", locale)}</span><b aria-hidden="true">⌄</b></span>
    </button>
    {view.open && <PopupDialog
      title={provider.displayName}
      eyebrow="MODEL / PROVIDER"
      description={`${provider.provider} · ${t(provider.active ? "provider.active" : "provider.inactive", locale)}`}
      className="popup-provider-dialog"
      locale={locale}
      onClose={actions.onToggle}
    >
      <ProviderDetails view={view} actions={actions} locale={locale} />
    </PopupDialog>}
  </article>;
}

function ProviderDetails({ view, actions, locale = "zh" }: SettingsProviderCardProps) {
  const { provider, credential, draft } = view;
  const selectedCandidates = new Set(view.selectedCandidateIds);
  const canEditSettings = view.settingsWritable && view.namespaceAvailable;

  return <div className="settings-provider-details">
    <div className="settings-provider-meta"><div><span>{t("provider.settingsNamespace", locale)}</span><code>{provider.settingsNs}</code></div><div><span>{t("provider.apiKey", locale)}</span><strong className={view.hasCredential ? "configured" : "unconfigured"}>{view.secretTotal === 0 ? (view.hasCredential ? t("provider.secretConfigured", locale) : t("provider.secretNotConfigured", locale)) : t("settings.ns.secrets", locale, { count: view.secretConfigured, total: view.secretTotal })}</strong></div></div>
    {view.modelGroups.length > 0 && <div className="settings-provider-models"><span className="settings-detail-label">{t("provider.hostModelCatalog", locale)}</span>{view.modelGroups.flatMap((group) => group.models).slice(0, 8).map((model) => <span className="settings-model-chip" key={`${provider.provider}-${model.id}`}>{model.name}</span>)}</div>}
    <div className="settings-provider-draft">
      <label><span>Base URL</span><input type="url" value={draft.baseURL} placeholder={t("provider.baseUrlPlaceholder", locale)} onChange={(event) => actions.onDraftChange({ baseURL: event.target.value })} /></label>
      {provider.settingsNs === "llm-pi-ai" && <label><span>{t("provider.protocol", locale)}</span><input value={draft.api} placeholder="openai-completions / anthropic-messages" onChange={(event) => actions.onDraftChange({ api: event.target.value })} /></label>}
      <div className="settings-provider-draft-actions"><button type="button" disabled={!canEditSettings} onClick={() => void actions.onSaveSettings()}>{t("provider.saveConnection", locale)}</button><button type="button" disabled={view.discoveryBusy || !view.namespaceAvailable} onClick={() => void actions.onDiscoverModels()}>{view.discoveryBusy ? t("provider.discovering", locale) : t("provider.discoverModels", locale)}</button></div>
    </div>
    {view.configuredModels.length > 0 && <div className="settings-provider-models configured"><span className="settings-detail-label">{t("provider.configuredModels", locale)}</span>{view.configuredModels.map((model) => {
      const modelId = String(model.id);
      const imageEnabled = Array.isArray(model.input) && model.input.includes("image");
      return <span className="settings-model-chip editable" key={`${provider.provider}-configured-${modelId}`}>
        <span>{String(model.name || modelId)}</span>
        <button type="button" onClick={() => void actions.onToggleModelImages(modelId)} title={imageEnabled ? t("provider.imageInputOff", locale) : t("provider.imageInputOn", locale)} aria-label={imageEnabled ? t("provider.imageToggleOffAria", locale, { name: String(model.name || modelId) }) : t("provider.imageToggleOnAria", locale, { name: String(model.name || modelId) })}>{imageEnabled ? t("provider.imageGlyph", locale) : t("provider.textGlyph", locale)}</button>
        <button type="button" onClick={() => void actions.onRemoveModel(modelId)} title={t("provider.removeModel", locale, { name: String(model.name || modelId) })} aria-label={t("provider.removeModel", locale, { name: String(model.name || modelId) })}>×</button>
      </span>;
    })}</div>}
    {view.candidates.length > 0 && <div className="settings-provider-candidates"><div className="settings-provider-candidates-heading"><span>{t("provider.discoveryResults", locale)}</span><button type="button" disabled={selectedCandidates.size === 0} onClick={() => void actions.onApplyCandidates()}>{t("provider.applySelected", locale)}</button></div>{view.candidates.map((model) => <label key={`${provider.provider}-candidate-${model.id}`}><input type="checkbox" checked={selectedCandidates.has(model.id)} onChange={() => actions.onToggleCandidate(model.id)} /><span><strong>{model.name || model.id}</strong><small>{model.id}{model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} context` : ""}</small></span></label>)}</div>}
    <div className="settings-provider-secret">
      <label><span>{t("provider.apiKey", locale)}</span><input type="password" autoComplete="off" value={view.credentialDraft} onChange={(event) => actions.onCredentialDraftChange(event.target.value)} placeholder={credential?.configured ? t("provider.secretReplace", locale) : t("provider.secretPlaceholder", locale)} disabled={credential?.writable === false || view.credentialBusy} /></label>
      <div><small>{credential?.source ? t("provider.secretSource", locale, { source: credential.source }) : credential?.configured ? t("provider.secretConfigured", locale) : t("provider.secretNotConfigured", locale)}</small><button type="button" disabled={credential?.writable === false || view.credentialBusy} onClick={() => void actions.onSaveCredential()}>{view.credentialBusy ? t("common.saving", locale) : t("common.save", locale)}</button>{credential?.configured && credential.writable !== false && <button type="button" onClick={() => void actions.onClearCredential()}>{t("provider.clearSecret", locale)}</button>}</div>
    </div>
    <div className="settings-provider-footer"><small>{provider.declared === false ? t("provider.runtimeRoute", locale) : t("provider.configurableRoute", locale)}</small><span>{view.removable && <button type="button" disabled={!canEditSettings} onClick={() => void actions.onRemoveConfiguration()}>{t("common.remove", locale)}</button>}<button type="button" disabled={!canEditSettings} onClick={actions.onOpenNamespace}>{t("settings.ns.edit", locale)}</button></span></div>
  </div>;
}
