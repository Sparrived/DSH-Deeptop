import { useState } from "react";
import {
  type DshCredential,
  type DshProvider,
  type DshSettingsDescription,
} from "../lib/desktop";
import { desktopRequest } from "../lib/desktop-api";
import { errorText, providerModels, providerProfile, providerSettingsOps, valueAtPath } from "./settings-model";
import type { CustomProviderDraft, DiscoveredModel, ProviderSettingsPatch } from "./model-types";
import { t, type UiLocale } from "./i18n.ts";

type UseProviderModelCatalogOptions = {
  settings: DshSettingsDescription | null;
  credentials: Record<string, DshCredential>;
  credentialDrafts: Record<string, string>;
  locale: UiLocale;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
  loadRuntimeDetails: () => Promise<void>;
};

const emptyCustomProviderDraft: CustomProviderDraft = {
  provider: "",
  displayName: "",
  baseURL: "",
  api: "openai-completions",
  apiKey: "",
  models: [],
  selectedModels: [],
};

type PendingCustomProviderCredential = {
  route: string;
  keyRef: string;
};

export function useProviderModelCatalog({ settings, credentials, credentialDrafts, locale, onNotice, onError, onConfirm, loadRuntimeDetails }: UseProviderModelCatalogOptions) {
  const [providerDrafts, setProviderDrafts] = useState<Record<string, { baseURL: string; api: string }>>({});
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, DiscoveredModel[]>>({});
  const [discoveredSelections, setDiscoveredSelections] = useState<Record<string, string[]>>({});
  const [discoveryBusy, setDiscoveryBusy] = useState<string | null>(null);
  const [customProviderOpen, setCustomProviderOpen] = useState(false);
  const [customProviderBusy, setCustomProviderBusy] = useState(false);
  const [customProviderDraft, setCustomProviderDraft] = useState<CustomProviderDraft>(emptyCustomProviderDraft);
  const [customProviderFailure, setCustomProviderFailure] = useState<string | null>(null);
  const [pendingCustomProviderCredential, setPendingCustomProviderCredential] = useState<PendingCustomProviderCredential | null>(null);
  const [modelDiscoveryFeedback, setModelDiscoveryFeedback] = useState<{ title: string; description: string } | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  function getProviderDraft(provider: DshProvider) {
    const current = providerDrafts[provider.provider];
    if (current) return current;
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    const profile = providerProfile(provider, namespace);
    return {
      baseURL: typeof profile?.baseURL === "string" ? profile.baseURL : "",
      api: typeof profile?.api === "string" ? profile.api : "",
    };
  }

  function updateProviderDraft(provider: DshProvider, patch: Partial<{ baseURL: string; api: string }>) {
    setProviderDrafts((current) => ({ ...current, [provider.provider]: { ...getProviderDraft(provider), ...patch } }));
  }

  function toggleProvider(providerId: string) {
    setExpandedProvider((current) => current === providerId ? null : providerId);
  }

  function toggleDiscoveredCandidate(providerId: string, modelId: string) {
    setDiscoveredSelections((current) => {
      const next = new Set(current[providerId] ?? []);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return { ...current, [providerId]: [...next] };
    });
  }

  function updateCustomProviderDraft(patch: Partial<CustomProviderDraft>) {
    setCustomProviderDraft((current) => ({ ...current, ...patch }));
    setCustomProviderFailure(null);
  }

  function toggleCustomProvider() {
    setCustomProviderOpen((open) => !open);
  }

  function closeCustomProvider() {
    setCustomProviderOpen(false);
  }

  function dismissModelDiscoveryFeedback() {
    setModelDiscoveryFeedback(null);
  }

  function reportModelDiscoveryFailure(error: unknown) {
    const message = errorText(error, locale);
    setModelDiscoveryFeedback({
      title: t("provider.discoveryFeedback.failedTitle", locale),
      description: t("provider.discoveryFeedback.failedDescription", locale, { error: message }),
    });
    onError(t("provider.notice.discoverFailed", locale, { error: message }));
  }

  function reportEmptyModelDiscovery() {
    setModelDiscoveryFeedback({
      title: t("provider.discoveryFeedback.emptyTitle", locale),
      description: t("provider.discoveryFeedback.emptyDescription", locale),
    });
  }

  function toggleCustomProviderModel(modelId: string) {
    setCustomProviderDraft((current) => ({
      ...current,
      selectedModels: current.selectedModels.includes(modelId)
        ? current.selectedModels.filter((id) => id !== modelId)
        : [...current.selectedModels, modelId],
    }));
    setCustomProviderFailure(null);
  }

  async function saveProviderSettings(provider: DshProvider, patch: ProviderSettingsPatch) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    if (!namespace || !settings?.writable) {
      onNotice(t("provider.notice.settingsReadonly", locale));
      return false;
    }
    const ops = providerSettingsOps(provider.settingsPath, providerProfile(provider, namespace), patch);
    if (ops.length === 0) return true;
    try {
      await desktopRequest("settings.mutate", { ns: provider.settingsNs, ops, expectedRevision: namespace.revision });
      await loadRuntimeDetails();
      onNotice(t("provider.notice.settingsSaved", locale, { name: provider.displayName }));
      return true;
    } catch (error) {
      onError(errorText(error));
      return false;
    }
  }

  async function discoverProviderModels(provider: DshProvider, baseURL: string, api: string) {
    if (!provider.settingsNs) return;
    setDiscoveryBusy(provider.provider);
    try {
      const key = credentialDrafts[provider.provider]?.trim();
      const result = await desktopRequest("llm.discoverModels", {
        settingsNs: provider.settingsNs,
        provider: provider.provider,
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        ...(api.trim() ? { api: api.trim() } : {}),
        ...(key ? { apiKey: key } : {}),
      });
      const models = (result.models ?? []).filter((model) => typeof model.id === "string" && model.id.trim());
      setDiscoveredModels((current) => ({ ...current, [provider.provider]: models }));
      const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
      const existing = new Set(providerModels(provider, namespace).map((model) => String(model.id)));
      setDiscoveredSelections((current) => ({ ...current, [provider.provider]: models.filter((model) => !existing.has(model.id)).map((model) => model.id) }));
      if (models.length > 0) onNotice(t("provider.notice.modelsFound", locale, { count: models.length }));
      else reportEmptyModelDiscovery();
    } catch (error) {
      reportModelDiscoveryFailure(error);
    } finally {
      setDiscoveryBusy(null);
    }
  }

  async function applyDiscoveredModels(provider: DshProvider) {
    const candidates = discoveredModels[provider.provider] ?? [];
    const selected = new Set(discoveredSelections[provider.provider] ?? []);
    if (candidates.length === 0 || selected.size === 0) return;
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    const existing = providerModels(provider, namespace);
    const byId = new Map(existing.map((model) => [String(model.id), model]));
    for (const candidate of candidates) {
      if (!selected.has(candidate.id) || byId.has(candidate.id)) continue;
      byId.set(candidate.id, {
        id: candidate.id,
        ...(candidate.name ? { name: candidate.name } : {}),
        ...(candidate.contextWindow !== undefined ? { contextWindow: candidate.contextWindow } : {}),
        ...(candidate.maxTokens !== undefined ? { maxTokens: candidate.maxTokens } : {}),
      });
    }
    if (await saveProviderSettings(provider, { models: [...byId.values()] })) {
      setDiscoveredModels((current) => ({ ...current, [provider.provider]: [] }));
      setDiscoveredSelections((current) => ({ ...current, [provider.provider]: [] }));
    }
  }

  async function removeProviderModel(provider: DshProvider, modelId: string) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    const next = providerModels(provider, namespace).filter((model) => String(model.id) !== modelId);
    await saveProviderSettings(provider, { models: next });
  }

  async function toggleProviderModelImages(provider: DshProvider, modelId: string) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    const current = providerModels(provider, namespace);
    const target = current.find((model) => String(model.id) === modelId);
    if (!target) {
      onNotice(t("provider.notice.saveModelFirst", locale));
      return;
    }
    const input = Array.isArray(target.input) && target.input.includes("image") ? ["text"] : ["text", "image"];
    await saveProviderSettings(provider, {
      models: current.map((model) => String(model.id) === modelId ? { ...model, input } : model),
    });
  }

  async function removeProviderConfiguration(provider: DshProvider) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    if (!namespace || provider.settingsPath.length === 0 || valueAtPath(namespace.user, provider.settingsPath) === undefined) return;
    if (!await onConfirm(t("provider.notice.removeProviderConfirm", locale, { name: provider.displayName }))) return;
    try {
      await desktopRequest("settings.mutate", { ns: provider.settingsNs, ops: [{ op: "unset", path: provider.settingsPath }], expectedRevision: namespace.revision });
      const profile = providerProfile(provider, namespace);
      const derivedRef = `${provider.provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
      if (profile?.apiKeyEnv === derivedRef && credentials[derivedRef]?.configured && credentials[derivedRef].writable) await desktopRequest("credentials.unset", { ref: derivedRef });
      await loadRuntimeDetails();
      onNotice(t("provider.notice.providerRemoved", locale, { name: provider.displayName }));
    } catch (error) {
      onError(t("provider.notice.removeFailed", locale, { error: errorText(error) }));
    }
  }

  async function discoverCustomProviderModels() {
    const draft = customProviderDraft;
    if (!draft.baseURL.trim()) {
      setModelDiscoveryFeedback({
        title: t("provider.discoveryFeedback.failedTitle", locale),
        description: t("provider.discoveryFeedback.failedDescription", locale, { error: t("provider.notice.baseUrlRequired", locale) }),
      });
      return;
    }
    setCustomProviderBusy(true);
    try {
      const result = await desktopRequest("llm.discoverModels", {
        settingsNs: "llm-pi-ai",
        baseURL: draft.baseURL.trim(),
        ...(draft.api.trim() ? { api: draft.api.trim() } : {}),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      const models = (result.models ?? []).filter((model) => typeof model.id === "string" && model.id.trim());
      setCustomProviderDraft((current) => ({ ...current, models, selectedModels: models.map((model) => model.id) }));
      if (models.length > 0) onNotice(t("provider.notice.modelsFound", locale, { count: models.length }));
      else reportEmptyModelDiscovery();
    } catch (error) {
      reportModelDiscoveryFailure(error);
    } finally {
      setCustomProviderBusy(false);
    }
  }

  async function refreshAfterCustomProviderSave() {
    try {
      await loadRuntimeDetails();
      return true;
    } catch (error) {
      onError(t("provider.notice.providerAddedRefreshFailed", locale, { error: errorText(error, locale) }));
      return false;
    }
  }

  async function finishCustomProviderSave() {
    const refreshed = await refreshAfterCustomProviderSave();
    setPendingCustomProviderCredential(null);
    setCustomProviderFailure(null);
    setCustomProviderDraft(emptyCustomProviderDraft);
    setCustomProviderOpen(false);
    if (refreshed) onNotice(t("provider.notice.providerAdded", locale));
  }

  async function createCustomProvider() {
    const draft = customProviderDraft;
    const route = draft.provider.trim();
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(route)) {
      const message = t("provider.notice.idInvalid", locale);
      setCustomProviderFailure(message);
      onError(message);
      return;
    }
    if (!draft.baseURL.trim() || !draft.api.trim()) {
      const message = t("provider.notice.baseUrlProtocolRequired", locale);
      setCustomProviderFailure(message);
      onError(message);
      return;
    }

    const pending = pendingCustomProviderCredential;
    if (pending) {
      if (pending.route !== route) return;
      if (!draft.apiKey.trim()) {
        const message = t("provider.notice.customProviderKeyRequired", locale);
        setCustomProviderFailure(message);
        onError(message);
        return;
      }
      setCustomProviderBusy(true);
      try {
        await desktopRequest("credentials.set", { ref: pending.keyRef, value: draft.apiKey.trim() });
        await finishCustomProviderSave();
      } catch (error) {
        const message = t("provider.notice.keySaveFailed", locale, { error: errorText(error, locale) });
        setCustomProviderFailure(message);
        onError(message);
      } finally {
        setCustomProviderBusy(false);
      }
      return;
    }

    const namespace = settings?.namespaces.find((item) => item.ns === "llm-pi-ai");
    const exists = valueAtPath(namespace?.value, ["providers", route]) !== undefined
      || valueAtPath(namespace?.user, ["providers", route]) !== undefined;
    if (!namespace || !settings?.writable || exists) {
      const message = t("provider.notice.providerExists", locale);
      setCustomProviderFailure(message);
      onError(message);
      return;
    }
    const selected = new Set(draft.selectedModels);
    const models = draft.models.filter((model) => selected.has(model.id)).map((model) => ({
      id: model.id,
      ...(model.name ? { name: model.name } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    }));
    if (models.length === 0) {
      const message = t("provider.notice.selectModel", locale);
      setCustomProviderFailure(message);
      onError(message);
      return;
    }

    const key = draft.apiKey.trim();
    const keyRef = `${route.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    setCustomProviderBusy(true);
    try {
      await desktopRequest("settings.mutate", {
        ns: "llm-pi-ai",
        ops: [{ op: "set", path: ["providers", route], value: { ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}), ...(key ? { apiKeyEnv: keyRef } : {}), api: draft.api.trim(), baseURL: draft.baseURL.trim(), models } }],
        expectedRevision: namespace.revision,
      });
      if (key) {
        setPendingCustomProviderCredential({ route, keyRef });
        try {
          await desktopRequest("credentials.set", { ref: keyRef, value: key });
        } catch (error) {
          await refreshAfterCustomProviderSave();
          const message = t("provider.notice.keySaveFailed", locale, { error: errorText(error, locale) });
          setCustomProviderFailure(message);
          onError(message);
          return;
        }
      }
      await finishCustomProviderSave();
    } catch (error) {
      const message = t("provider.notice.addFailed", locale, { error: errorText(error, locale) });
      setCustomProviderFailure(message);
      onError(message);
    } finally {
      setCustomProviderBusy(false);
    }
  }

  return {
    providerDrafts,
    discoveredModels,
    discoveredSelections,
    discoveryBusy,
    customProviderOpen,
    customProviderBusy,
    customProviderDraft,
    customProviderFailure,
    pendingCustomProviderCredential,
    modelDiscoveryFeedback,
    expandedProvider,
    getProviderDraft,
    updateProviderDraft,
    toggleProvider,
    toggleDiscoveredCandidate,
    updateCustomProviderDraft,
    toggleCustomProvider,
    toggleCustomProviderModel,
    closeCustomProvider,
    dismissModelDiscoveryFeedback,
    saveProviderSettings,
    discoverProviderModels,
    applyDiscoveredModels,
    removeProviderModel,
    toggleProviderModelImages,
    removeProviderConfiguration,
    discoverCustomProviderModels,
    createCustomProvider,
  };
}

export type ProviderModelCatalogController = ReturnType<typeof useProviderModelCatalog>;
