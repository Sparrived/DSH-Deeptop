import { useState } from "react";
import {
  bridgeRequest,
  type DshCredential,
  type DshProvider,
  type DshSettingsDescription,
} from "../lib/desktop";
import { errorText, providerModels, providerProfile, valueAtPath } from "./settings-model";
import type { CustomProviderDraft, DiscoveredModel, ProviderSettingsPatch } from "./model-types";

type UseProviderModelCatalogOptions = {
  settings: DshSettingsDescription | null;
  credentials: Record<string, DshCredential>;
  credentialDrafts: Record<string, string>;
  onNotice: (message: string) => void;
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

export function useProviderModelCatalog({ settings, credentials, credentialDrafts, onNotice, loadRuntimeDetails }: UseProviderModelCatalogOptions) {
  const [providerDrafts, setProviderDrafts] = useState<Record<string, { baseURL: string; api: string }>>({});
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, DiscoveredModel[]>>({});
  const [discoveredSelections, setDiscoveredSelections] = useState<Record<string, string[]>>({});
  const [discoveryBusy, setDiscoveryBusy] = useState<string | null>(null);
  const [customProviderOpen, setCustomProviderOpen] = useState(false);
  const [customProviderBusy, setCustomProviderBusy] = useState(false);
  const [customProviderDraft, setCustomProviderDraft] = useState<CustomProviderDraft>(emptyCustomProviderDraft);
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
  }

  function toggleCustomProvider() {
    setCustomProviderOpen((open) => !open);
  }

  function closeCustomProvider() {
    setCustomProviderOpen(false);
  }

  function toggleCustomProviderModel(modelId: string) {
    setCustomProviderDraft((current) => ({
      ...current,
      selectedModels: current.selectedModels.includes(modelId)
        ? current.selectedModels.filter((id) => id !== modelId)
        : [...current.selectedModels, modelId],
    }));
  }

  async function saveProviderSettings(provider: DshProvider, patch: ProviderSettingsPatch) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    if (!namespace || !settings?.writable) {
      onNotice("当前 Provider 设置不可写");
      return false;
    }
    const ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> = [];
    for (const key of ["baseURL", "api"] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value) ops.push({ op: "set", path: [...provider.settingsPath, key], value });
      else ops.push({ op: "unset", path: [...provider.settingsPath, key] });
    }
    if ("models" in patch) {
      if (patch.models && patch.models.length > 0) ops.push({ op: "set", path: [...provider.settingsPath, "models"], value: patch.models });
      else ops.push({ op: "unset", path: [...provider.settingsPath, "models"] });
    }
    if (ops.length === 0) return true;
    try {
      await bridgeRequest("settings.mutate", { ns: provider.settingsNs, ops, expectedRevision: namespace.revision });
      await loadRuntimeDetails();
      onNotice(`${provider.displayName} 设置已保存`);
      return true;
    } catch (error) {
      onNotice(errorText(error));
      return false;
    }
  }

  async function discoverProviderModels(provider: DshProvider, baseURL: string, api: string) {
    if (!provider.settingsNs) return;
    setDiscoveryBusy(provider.provider);
    try {
      const key = credentialDrafts[provider.provider]?.trim();
      const result = await bridgeRequest<{ models: DiscoveredModel[] }>("llm.discoverModels", {
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
      onNotice(models.length > 0 ? `发现 ${models.length} 个候选模型` : "该端点没有返回模型");
    } catch (error) {
      onNotice(`模型发现失败：${errorText(error)}`);
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
      onNotice("请先将模型写入 Provider 配置，再声明图片输入能力");
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
    if (!window.confirm(`移除 Provider“${provider.displayName}”？`)) return;
    try {
      await bridgeRequest("settings.mutate", { ns: provider.settingsNs, ops: [{ op: "unset", path: provider.settingsPath }], expectedRevision: namespace.revision });
      const profile = providerProfile(provider, namespace);
      const derivedRef = `${provider.provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
      if (profile?.apiKeyEnv === derivedRef && credentials[derivedRef]?.configured && credentials[derivedRef].writable) await bridgeRequest("credentials.unset", { ref: derivedRef });
      await loadRuntimeDetails();
      onNotice(`${provider.displayName} 已移除`);
    } catch (error) {
      onNotice(`移除失败：${errorText(error)}`);
    }
  }

  async function discoverCustomProviderModels() {
    const draft = customProviderDraft;
    if (!draft.baseURL.trim()) {
      onNotice("请先输入 Provider Base URL");
      return;
    }
    setCustomProviderBusy(true);
    try {
      const result = await bridgeRequest<{ models: DiscoveredModel[] }>("llm.discoverModels", {
        settingsNs: "llm-pi-ai",
        baseURL: draft.baseURL.trim(),
        ...(draft.api.trim() ? { api: draft.api.trim() } : {}),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      const models = (result.models ?? []).filter((model) => typeof model.id === "string" && model.id.trim());
      setCustomProviderDraft((current) => ({ ...current, models, selectedModels: models.map((model) => model.id) }));
      onNotice(models.length > 0 ? `发现 ${models.length} 个候选模型` : "该端点没有返回模型");
    } catch (error) {
      onNotice(`模型发现失败：${errorText(error)}`);
    } finally {
      setCustomProviderBusy(false);
    }
  }

  async function createCustomProvider() {
    const draft = customProviderDraft;
    const route = draft.provider.trim();
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(route)) {
      onNotice("Provider ID 需使用小写字母、数字和短横线，且以字母开头");
      return;
    }
    if (!draft.baseURL.trim() || !draft.api.trim()) {
      onNotice("请填写 Base URL 和协议");
      return;
    }
    const namespace = settings?.namespaces.find((item) => item.ns === "llm-pi-ai");
    if (!namespace || valueAtPath(namespace.value, ["providers", route]) !== undefined) {
      onNotice("Provider ID 已存在或当前 Host 不支持自定义 Provider");
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
      onNotice("至少选择一个模型");
      return;
    }
    setCustomProviderBusy(true);
    try {
      const keyRef = `${route.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
      await bridgeRequest("settings.mutate", {
        ns: "llm-pi-ai",
        ops: [{ op: "set", path: ["providers", route], value: { ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}), ...(draft.apiKey.trim() ? { apiKeyEnv: keyRef } : {}), api: draft.api.trim(), baseURL: draft.baseURL.trim(), models } }],
        expectedRevision: namespace.revision,
      });
      if (draft.apiKey.trim()) await bridgeRequest("credentials.set", { ref: keyRef, value: draft.apiKey.trim() });
      await loadRuntimeDetails();
      setCustomProviderDraft(emptyCustomProviderDraft);
      setCustomProviderOpen(false);
      onNotice("自定义 Provider 已添加");
    } catch (error) {
      onNotice(`添加失败：${errorText(error)}`);
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
    expandedProvider,
    getProviderDraft,
    updateProviderDraft,
    toggleProvider,
    toggleDiscoveredCandidate,
    updateCustomProviderDraft,
    toggleCustomProvider,
    toggleCustomProviderModel,
    closeCustomProvider,
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
