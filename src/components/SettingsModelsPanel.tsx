import type { DshProvider, DshSettingsDescription, DshSettingsNamespace } from "../lib/desktop";
import { credentialRefForProvider, providerModels, valueAtPath } from "../app/settings-model";
import type { DshHostModelCatalog } from "../app/model-types";
import type { ProviderSettingsController } from "../app/useProviderSettings";
import { SettingsCustomProviderPanel } from "./SettingsCustomProviderPanel";
import { SettingsModelCatalog } from "./SettingsModelCatalog";
import { SettingsProviderCard, type SettingsProviderCardActions, type SettingsProviderCardView } from "./SettingsProviderCard";
import { t, type UiLocale } from "../app/i18n";

type SettingsModelsPanelProps = {
  providers: DshProvider[];
  settings: DshSettingsDescription | null;
  hostModels: DshHostModelCatalog | null;
  providerSettings: ProviderSettingsController;
  onOpenNamespace: (namespace: DshSettingsNamespace | undefined) => void;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
};

export function SettingsModelsPanel({ providers, settings, hostModels, providerSettings, onOpenNamespace, locale = "zh" }: SettingsModelsPanelProps) {
  const {
    credentials,
    credentialDrafts,
    credentialBusy,
    discoveredModels,
    discoveredSelections,
    discoveryBusy,
    customProviderOpen,
    customProviderBusy,
    customProviderDraft,
    expandedProvider,
    getProviderDraft,
    updateProviderDraft,
    toggleProvider,
    updateCredentialDraft,
    clearProviderCredential,
    toggleDiscoveredCandidate,
    toggleCustomProvider,
    updateCustomProviderDraft,
    toggleCustomProviderModel,
    closeCustomProvider,
    saveProviderCredential,
    saveProviderSettings,
    discoverProviderModels,
    applyDiscoveredModels,
    removeProviderModel,
    toggleProviderModelImages,
    removeProviderConfiguration,
    discoverCustomProviderModels,
    createCustomProvider,
  } = providerSettings;

  return (
    <div className="settings-page">
      <div className="settings-page-header"><div><span className="settings-overline">MODELS</span><h2>{t("settings.models", locale)}</h2><p>{t("models.subtitle", locale)}</p></div><span className="settings-count">{t("models.count", locale, { count: providers.length })}</span></div>
      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>Provider</h3><p>{t("models.providersHint", locale)}</p></div></div>
        <SettingsCustomProviderPanel
          available={Boolean(settings?.namespaces.some((namespace) => namespace.ns === "llm-pi-ai"))}
          draft={customProviderDraft}
          open={customProviderOpen}
          busy={customProviderBusy}
          failure={providerSettings.customProviderFailure}
          pendingCredential={providerSettings.pendingCustomProviderCredential !== null}
          modelDiscoveryFeedback={providerSettings.modelDiscoveryFeedback}
          locale={locale}
          onToggle={toggleCustomProvider}
          onDraftChange={updateCustomProviderDraft}
          onToggleModel={toggleCustomProviderModel}
          onDiscover={discoverCustomProviderModels}
          onCancel={closeCustomProvider}
          onCreate={createCustomProvider}
          onDismissModelDiscoveryFeedback={providerSettings.dismissModelDiscoveryFeedback}
        />
        {providers.length === 0 ? <p className="settings-empty">{t("models.empty", locale)}</p> : <div className="settings-provider-grid">{providers.map((provider) => {
          const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
          const secretTotal = namespace?.secrets.length ?? 0;
          const secretConfigured = namespace?.secrets.filter((secret) => secret.set).length ?? 0;
          const secretRef = credentialRefForProvider(provider, namespace);
          const credential = credentials[secretRef];
          const modelGroups = hostModels?.groups.filter((group) => group.id === provider.provider || group.id.startsWith(`${provider.provider}:`) || group.id.includes(provider.provider)) ?? [];
          const configuredModels = providerModels(provider, namespace);
          const draft = getProviderDraft(provider);
          const candidates = discoveredModels[provider.provider] ?? [];
          const removable = provider.settingsPath.length > 0 && valueAtPath(namespace?.user, provider.settingsPath) !== undefined;
          const view: SettingsProviderCardView = {
            provider,
            secretTotal,
            secretConfigured,
            hasCredential: credential?.configured ?? secretConfigured > 0,
            credential,
            modelGroups,
            configuredModels,
            draft,
            candidates,
            selectedCandidateIds: discoveredSelections[provider.provider] ?? [],
            removable,
            open: expandedProvider === provider.provider,
            settingsWritable: settings?.writable ?? false,
            namespaceAvailable: Boolean(namespace),
            discoveryBusy: discoveryBusy === provider.provider,
            credentialDraft: credentialDrafts[provider.provider] ?? "",
            credentialBusy: credentialBusy === provider.provider,
          };
          const actions: SettingsProviderCardActions = {
            onToggle: () => toggleProvider(provider.provider),
            onDraftChange: (patch) => updateProviderDraft(provider, patch),
            onSaveSettings: () => saveProviderSettings(provider, { baseURL: draft.baseURL.trim() || null, ...(provider.settingsNs === "llm-pi-ai" ? { api: draft.api.trim() || null } : {}) }),
            onDiscoverModels: () => discoverProviderModels(provider, draft.baseURL, draft.api),
            onRemoveModel: (modelId) => removeProviderModel(provider, modelId),
            onToggleModelImages: (modelId) => toggleProviderModelImages(provider, modelId),
            onToggleCandidate: (modelId) => toggleDiscoveredCandidate(provider.provider, modelId),
            onApplyCandidates: () => applyDiscoveredModels(provider),
            onCredentialDraftChange: (value) => updateCredentialDraft(provider.provider, value),
            onSaveCredential: () => saveProviderCredential(provider),
            onClearCredential: () => clearProviderCredential(provider),
            onRemoveConfiguration: () => removeProviderConfiguration(provider),
            onOpenNamespace: () => onOpenNamespace(namespace),
          };
          return <SettingsProviderCard key={provider.provider} view={view} actions={actions} locale={locale} />;
        })}</div>}
      </div>

      <SettingsModelCatalog catalog={hostModels} locale={locale} />
    </div>
  );
}
