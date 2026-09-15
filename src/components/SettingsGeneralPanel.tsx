import type { CloseBehavior, DshEffectiveNetworkProxy, DshNetworkProxy, DshPreset, DshSettingsDescription, DshSettingsNamespace, WindowBehaviorSettings, WindowsContextMenuStatus } from "../lib/desktop";
import { useState, useEffect } from "react";
import { presetDisplayName } from "../app/model";
import type { DshHostModelCatalog, ModelSelection } from "../app/model";
import type { DshPermissionSelect } from "../lib/desktop";
import { isSchemaEnvelope } from "../app/schema-model";
import { hasTranslation, t, type UiLocale } from "../app/i18n";
import { PromptInjectionPanel } from "./PromptInjectionPanel";

function modelKey(selection: ModelSelection | null) {
  return selection ? `${selection.provider}\u0000${selection.model}` : "";
}

function permissionLabel(option: DshPermissionSelect["options"][number], locale: UiLocale) {
  const nameKey = (option as { nameKey?: string }).nameKey;
  if (nameKey && hasTranslation(nameKey)) return t(nameKey, locale);
  return typeof option.name === "string" && option.name.trim() ? option.name : option.value;
}

function permissionDescription(option: DshPermissionSelect["options"][number], locale: UiLocale): string | null {
  const descriptionKey = (option as { descriptionKey?: string }).descriptionKey;
  if (descriptionKey && hasTranslation(descriptionKey)) return t(descriptionKey, locale);
  return option.description ?? null;
}

type SettingsGeneralPanelProps = {
  settings: DshSettingsDescription | null;
  presets: DshPreset[];
  hostModels: DshHostModelCatalog | null;
  defaultModel: ModelSelection | null;
  defaultPermission: string | null;
  /** Preset options exposed by the official permission namespace schema (fallback: local trio). */
  permissionOptions: DshPermissionSelect["options"];
  /** 界面语言：本地状态与 Host locale 命名空间双向同步。 */
  locale: UiLocale;
  onLocaleChange: (locale: UiLocale) => void;
  workspace: string;
  runtimeDirectory: string;
  sidebarWidth: number;
  pluginSettings: DshSettingsNamespace[];
  contextMenuStatus: WindowsContextMenuStatus | null;
  contextMenuUpdating: boolean;
  windowBehavior: WindowBehaviorSettings;
  windowBehaviorSupported: boolean;
  windowBehaviorUpdating: boolean;
  networkProxy: DshNetworkProxy;
  networkEffective: DshEffectiveNetworkProxy;
  networkProxyUpdating: boolean;
  onUpdateNetworkProxy: (proxy: DshNetworkProxy) => void | Promise<void>;
  onSetContextMenuEnabled: (enabled: boolean) => void | Promise<void>;
  onUpdateWindowBehavior: (patch: Partial<WindowBehaviorSettings>) => void | Promise<void>;
  onOpenDocument: () => void | Promise<void>;
  onSetDefaultPreset: (id: string) => void | Promise<void>;
  onSetDefaultModel: (selection: ModelSelection) => void | Promise<void>;
  onSetDefaultPermission: (value: string) => void | Promise<void>;
  onAddWorkspace: () => void | Promise<void>;
  onResetSidebar: () => void;
  onOpenNamespace: (namespace: DshSettingsNamespace) => void;
  /** 全局提示词注入：文本由 Deeptop 命名空间承载并注入每个 Session 的 system prompt。 */
  promptInjection: {
    current: string;
    saving: boolean;
    onSave: (next: string) => void | Promise<void>;
  };
};

export function SettingsGeneralPanel({
  settings,
  presets,
  hostModels,
  defaultModel,
  defaultPermission,
  permissionOptions,
  locale,
  onLocaleChange,
  workspace,
  runtimeDirectory,
  sidebarWidth,
  pluginSettings,
  contextMenuStatus,
  contextMenuUpdating,
  windowBehavior,
  windowBehaviorSupported,
  windowBehaviorUpdating,
  networkProxy,
  networkEffective,
  networkProxyUpdating,
  onUpdateNetworkProxy,
  onSetContextMenuEnabled,
  onUpdateWindowBehavior,
  onOpenDocument,
  onSetDefaultPreset,
  onSetDefaultModel,
  onSetDefaultPermission,
  onAddWorkspace,
  onResetSidebar,
  onOpenNamespace,
  promptInjection,
}: SettingsGeneralPanelProps) {
  const modelOptions = hostModels?.groups.flatMap((group) => group.models.map((model) => ({
    value: `${group.id}\u0000${model.id}`,
    provider: group.id,
    model: model.id,
    label: `${group.name} / ${model.name}`,
    reasoning: model.reasoning,
  }))) ?? [];
  const selectedModel = modelOptions.find((option) => option.value === modelKey(defaultModel));
  const permission = permissionOptions.find((option) => option.value === defaultPermission);
  const permissionNamespace = settings?.namespaces.find((namespace) => namespace.ns === "permission");
  const modelNamespace = settings?.namespaces.find((namespace) => namespace.ns === "agent-default-model");
  const permissionStorageHint = permissionNamespace ? t("settings.perm.hostApply", locale) : t("settings.perm.localApply", locale);
  const modelReasoning = selectedModel?.reasoning;
  const reasoningValue = defaultModel?.reasoningEffort ?? modelReasoning?.defaultEffort ?? "";
  const [proxyUrl, setProxyUrl] = useState(networkProxy.url);
  const [proxyEnabled, setProxyEnabled] = useState(networkProxy.enabled);
  useEffect(() => {
    setProxyUrl(networkProxy.url);
    setProxyEnabled(networkProxy.enabled);
  }, [networkProxy.url, networkProxy.enabled]);

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">GENERAL</span><h2>{t("settings.general.title", locale)}</h2><p>{t("settings.general.subtitle", locale)}</p></div>
        {settings?.hasDocument && <button className="settings-header-action" onClick={() => void onOpenDocument()}>{t("settings.general.openConfig", locale)}</button>}
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("settings.language", locale)}</h3><p>{t("settings.language.hint", locale)}</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>{t("settings.language", locale)}</strong><small>{t("settings.language.hint", locale)}</small></span><select value={locale} onChange={(event) => onLocaleChange(event.target.value as UiLocale)}><option value="zh">中文</option><option value="en">English</option></select></label>
        </div>
      </div>

      <PromptInjectionPanel
        current={promptInjection.current}
        settings={settings}
        saving={promptInjection.saving}
        locale={locale}
        onSave={promptInjection.onSave}
      />

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("settings.session", locale)}</h3><p>{t("settings.session.hint", locale)}</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>{t("settings.defaultPreset", locale)}</strong><small>{t("settings.defaultPreset.hint", locale)}</small></span><select disabled={settings?.writable === false} value={presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void onSetDefaultPreset(event.target.value)}>{presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets, locale)}</option>)}</select></label>
          <label className="settings-preference-row"><span><strong>{t("settings.defaultPermission", locale)}</strong><small>{(permission ? permissionDescription(permission, locale) : null) ?? t("settings.defaultPermission.hint", locale)} · {permissionStorageHint}</small></span><select disabled={!settings || settings.writable === false} value={defaultPermission ?? ""} onChange={(event) => void onSetDefaultPermission(event.target.value)}><option value="" disabled>{t("settings.perm.none", locale)}</option>{permissionOptions.map((option) => <option value={option.value} key={option.value}>{permissionLabel(option, locale)}</option>)}</select></label>
          <label className="settings-preference-row"><span><strong>{t("settings.defaultModel", locale)}</strong><small>{modelNamespace ? t("settings.defaultModel.savedHost", locale) : t("settings.defaultModel.savedLocal", locale)}</small></span><select disabled={modelOptions.length === 0} value={modelKey(defaultModel)} onChange={(event) => { const option = modelOptions.find((item) => item.value === event.target.value); if (option) void onSetDefaultModel({ provider: option.provider, model: option.model, ...(option.reasoning?.defaultEffort ? { reasoningEffort: option.reasoning.defaultEffort } : {}) }); }}><option value="" disabled>{t("settings.defaultModel.choose", locale)}</option>{modelOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          {modelReasoning && <label className="settings-preference-row"><span><strong>{t("settings.defaultReasoning", locale)}</strong><small>{t("settings.defaultReasoning.hint", locale)}</small></span><select disabled={!defaultModel} value={reasoningValue} onChange={(event) => { if (defaultModel) void onSetDefaultModel({ ...defaultModel, reasoningEffort: event.target.value || undefined }); }}><option value="">{t("settings.followModel", locale)}</option>{modelReasoning.efforts.map((effort) => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select></label>}
          <div className="settings-preference-row"><span><strong>{t("settings.workdir", locale)}</strong><small>{workspace || runtimeDirectory || t("settings.workdir.fallback", locale)}</small></span><button onClick={() => void onAddWorkspace()}>{t("settings.workdir.choose", locale)}</button></div>
          <div className="settings-preference-row"><span><strong>{t("settings.sidebarWidth", locale)}</strong><small>{t("settings.sidebarWidth.hint", locale, { width: sidebarWidth })}</small></span><button onClick={onResetSidebar} disabled={sidebarWidth === 320}>{t("settings.sidebarReset", locale)}</button></div>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("settings.contextMenu", locale)}</h3><p>{t("settings.contextMenu.hint", locale)}</p></div></div>
        {contextMenuStatus?.supported ? <div className="settings-preference-row"><span><strong>{t("settings.contextMenu.enable", locale)}</strong><small>{contextMenuStatus.message} · {t("settings.contextMenu.reopen", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("settings.contextMenu.enableAria", locale)}><input type="checkbox" checked={contextMenuStatus.enabled} disabled={contextMenuUpdating} onChange={(event) => void onSetContextMenuEnabled(event.target.checked)} /><span aria-hidden="true" /></label></div> : <p className="settings-empty">{contextMenuStatus?.message ?? t("settings.contextMenu.checking", locale)}</p>}
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("settings.window", locale)}</h3><p>{t("settings.window.hint", locale)}</p></div></div>
        {windowBehaviorSupported ? <div className="settings-preference-list">
          <div className="settings-preference-row"><span><strong>{t("settings.window.minimize", locale)}</strong><small>{t("settings.window.minimize.hint", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("settings.window.minimizeAria", locale)}><input type="checkbox" checked={windowBehavior.minimizeToTray} disabled={windowBehaviorUpdating} onChange={(event) => void onUpdateWindowBehavior({ minimizeToTray: event.target.checked })} /><span aria-hidden="true" /></label></div>
          <div className="settings-preference-row"><span><strong>{t("settings.window.close", locale)}</strong><small>{t("settings.window.close.hint", locale)}</small></span><select disabled={windowBehaviorUpdating} value={windowBehavior.closeBehavior} onChange={(event) => void onUpdateWindowBehavior({ closeBehavior: event.target.value as CloseBehavior })}><option value="ask">{t("settings.window.closeAsk", locale)}</option><option value="hide-to-tray">{t("settings.window.closeHide", locale)}</option><option value="exit">{t("settings.window.closeExit", locale)}</option></select></div>
        </div> : <p className="settings-empty">{t("settings.window.unavailable", locale)}</p>}
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("settings.proxy", locale)}</h3><p>{t("settings.proxy.hint", locale)}</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>{t("settings.proxy.enable", locale)}</strong><small>{t("settings.proxy.enable.hint", locale)}</small></span><label className="settings-plugin-toggle" aria-label={t("settings.proxy.enableAria", locale)}><input type="checkbox" checked={proxyEnabled} disabled={networkProxyUpdating} onChange={(event) => setProxyEnabled(event.target.checked)} /><span aria-hidden="true" /></label></label>
          <div className="settings-preference-row"><span><strong>{t("settings.proxy.url", locale)}</strong><small>{t("settings.proxy.url.hint", locale)}</small></span><input className="settings-text-input" type="text" value={proxyUrl} placeholder="http://127.0.0.1:7890" disabled={networkProxyUpdating} onChange={(event) => setProxyUrl(event.target.value)} /></div>
          <div className="settings-preference-row"><span><strong>{t("settings.proxy.current", locale)}</strong><small>{networkEffective.source === "system" ? t("settings.proxy.following", locale, { url: networkEffective.url || t("settings.proxy.none", locale) }) : networkEffective.source === "explicit" ? t("settings.proxy.explicit", locale, { url: networkEffective.url }) : t("settings.proxy.direct", locale)}</small></span><span className="settings-state-tag" data-source={networkEffective.source}>{networkEffective.source === "system" ? t("settings.proxy.tagSystem", locale) : networkEffective.source === "explicit" ? t("settings.proxy.tagExplicit", locale) : t("settings.proxy.tagDirect", locale)}</span></div>
          <div className="settings-preference-row"><span><strong>{t("settings.proxy.apply", locale)}</strong><small>{networkProxyUpdating ? t("settings.proxy.applying", locale) : t("settings.proxy.apply.hint", locale)}</small></span><button disabled={networkProxyUpdating} onClick={() => void onUpdateNetworkProxy({ enabled: proxyEnabled, url: proxyUrl })}>{networkProxyUpdating ? t("settings.proxy.applyingShort", locale) : proxyEnabled ? t("settings.proxy.applyNow", locale) : t("settings.proxy.applyFollow", locale)}</button></div>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("settings.host", locale)}</h3><p>{t("settings.host.hint", locale)}</p></div><span className="settings-count">{settings?.namespaces.length ?? t("settings.host.unavailable", locale)}</span></div>
        <div className="settings-namespace-list">
          {pluginSettings.length === 0 ? <p className="settings-empty">{t("settings.host.empty", locale)}</p> : pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? t("settings.ns.restart", locale) : t("settings.ns.live", locale)} · revision {namespace.revision}{namespace.secrets.length ? t("settings.ns.secrets", locale, { count: namespace.secrets.filter((secret) => secret.set).length, total: namespace.secrets.length }) : ""}</small></div><button disabled={!settings?.writable} onClick={() => onOpenNamespace(namespace)}>{isSchemaEnvelope(namespace.schema) ? t("settings.ns.edit", locale) : t("settings.ns.editJson", locale)}</button></div>)}
        </div>
      </div>
    </div>
  );
}
