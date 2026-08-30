import { useEffect, useState } from "react";
import type {
  DshPluginConfigDescription,
  DshPluginConfigEntry,
  DshPluginInventoryEntry,
  DshSettingsNamespace,
  DshSettingsDescription,
} from "../lib/desktop";
import { pluginDisplayName, pluginPhaseLabel } from "../app/model";
import { isSchemaEnvelope } from "../app/schema-model";
import { t, type UiLocale } from "../app/i18n";
import type { DesktopUiRuntime, UiRuntimeCatalogSnapshot, UiRuntimeStatus } from "../lib/desktop-ui-runtime/client-runtime";

type SettingsPluginsPanelProps = {
  locale: UiLocale;
  inventory: DshPluginInventoryEntry[] | null;
  excludedPlugins: DshPluginInventoryEntry[];
  visiblePlugins: DshPluginInventoryEntry[];
  search: string;
  expandedPlugin: string | null;
  pluginSettings: DshSettingsNamespace[];
  settings: DshSettingsDescription | null;
  pluginConfig: DshPluginConfigDescription | null;
  pluginConfigDraft: DshPluginConfigEntry[];
  pluginConfigDirty: boolean;
  pluginConfigSaving: boolean;
  /** App-scoped UI runtime; null keeps the section silent (e.g. tests). */
  uiRuntime: DesktopUiRuntime | null;
  onSearchChange: (value: string) => void;
  onTogglePlugin: (entryId: string) => void;
  onOpenNamespace: (namespace: DshSettingsNamespace) => void;
  onAddPlugin: () => void;
  onUpdatePlugin: (id: string, patch: Partial<Pick<DshPluginConfigEntry, "id" | "name">>) => void;
  onToggleConfigPlugin: (id: string) => void;
  onRemovePlugin: (id: string) => void;
  onCancelPluginConfig: () => void;
  onSavePluginConfig: () => void;
  onSaveAndRestart: () => void;
  onRestart: () => void;
};

function pluginStatus(plugin: DshPluginInventoryEntry, locale: UiLocale) {
  if (plugin.compatibility?.supported === false) return t("plugins.incompatibleShort", locale);
  if (!plugin.enabled) return t("plugins.disabled", locale);
  return pluginPhaseLabel(plugin.fiberPhase, locale);
}

const uiRuntimeStatusLabel: Record<UiRuntimeStatus, string> = {
  disabled: "未启用",
  loading: "发现中…",
  ready: "运行中",
  partial: "部分插件异常",
  failed: "不可用",
};

function uiPluginStateLabel(state: UiRuntimeCatalogSnapshot["plugins"][number]["state"]): string {
  switch (state) {
    case "active": return "已激活";
    case "discovered": return "已发现";
    case "checking": return "兼容性检查中…";
    case "loading": return "加载中…";
    case "activating": return "激活中…";
    case "deactivating": return "停用中…";
    case "disposed": return "已停用";
    case "check-failed": return "SDK 不兼容";
    case "load-failed": return "加载失败";
    case "activate-failed": return "激活失败";
    default: return state;
  }
}

/** Subscribes to the runtime catalog so the section re-renders on refresh/stop. */
function useUiRuntimeCatalog(runtime: DesktopUiRuntime | null): UiRuntimeCatalogSnapshot | null {
  const [snapshot, setSnapshot] = useState<UiRuntimeCatalogSnapshot | null>(() => runtime?.catalogSnapshot() ?? null);
  useEffect(() => {
    if (!runtime) return undefined;
    setSnapshot(runtime.catalogSnapshot());
    return runtime.onCatalogChange(() => setSnapshot(runtime.catalogSnapshot()));
  }, [runtime]);
  return snapshot;
}

export function SettingsPluginsPanel({
  locale,
  inventory,
  excludedPlugins,
  visiblePlugins,
  search,
  expandedPlugin,
  pluginSettings,
  settings,
  pluginConfig,
  pluginConfigDraft,
  pluginConfigDirty,
  pluginConfigSaving,
  uiRuntime,
  onSearchChange,
  onTogglePlugin,
  onOpenNamespace,
  onAddPlugin,
  onUpdatePlugin,
  onToggleConfigPlugin,
  onRemovePlugin,
  onCancelPluginConfig,
  onSavePluginConfig,
  onSaveAndRestart,
  onRestart,
}: SettingsPluginsPanelProps) {
  const writable = Boolean(settings?.writable);
  const enabledCount = pluginConfigDraft.filter((plugin) => plugin.enabled).length;
  const uiCatalog = useUiRuntimeCatalog(uiRuntime);

  return (
    <div className="settings-page settings-plugins-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">DESKTOP PLUGINS</span>
          <h2>{t("plugins.title", locale)}</h2>
          <p>{t("plugins.subtitle", locale)}</p>
        </div>
        <div className="settings-plugin-header-actions">
          <span className="settings-count">{t("plugins.available", locale, { count: visiblePlugins.length })}</span>
          <button className="settings-header-action" type="button" onClick={onRestart} disabled={!settings || pluginConfigDirty}>{t("plugins.restart", locale)}</button>
        </div>
      </div>

      <div className="settings-plugin-summary" role="status">
        <span><strong>{enabledCount}</strong> {t("plugins.willLoad", locale, { count: enabledCount })}</span>
        <span className="settings-plugin-summary-note">{t("plugins.restartNote", locale)}</span>
      </div>

      <section className="settings-block settings-plugin-config-block">
        <div className="settings-block-heading">
          <div><h3>{t("plugins.configList", locale)}</h3><p>{t("plugins.configList.hint", locale)}</p></div>
          <button className="settings-header-action" type="button" onClick={onAddPlugin} disabled={!writable || pluginConfigSaving}>{t("plugins.add", locale)}</button>
        </div>
        {pluginConfig === null ? <p className="settings-empty">{t("plugins.readingConfig", locale)}</p> : pluginConfigDraft.length === 0 ? <div className="settings-plugin-empty-action"><p className="settings-empty">{t("plugins.empty", locale)}</p><button className="settings-header-action" type="button" onClick={onAddPlugin} disabled={!writable}>{t("plugins.addFirst", locale)}</button></div> : <div className="settings-config-plugin-list">
          {pluginConfigDraft.map((plugin) => (
            <div className={`settings-config-plugin-row ${plugin.enabled ? "enabled" : "disabled"}`} key={plugin.id}>
              <label className="settings-plugin-toggle">
                <input type="checkbox" checked={plugin.enabled} disabled={!writable || plugin.system || pluginConfigSaving} onChange={() => onToggleConfigPlugin(plugin.id)} />
                <span aria-hidden="true" />
              </label>
              <div className="settings-config-plugin-fields">
                <label><span>{t("plugins.id", locale)}</span><input value={plugin.id} disabled={!writable || plugin.system || pluginConfigSaving} onChange={(event) => onUpdatePlugin(plugin.id, { id: event.target.value })} /></label>
                <label><span>{t("plugins.name", locale)}</span><input value={plugin.name} disabled={!writable || plugin.system || pluginConfigSaving} onChange={(event) => onUpdatePlugin(plugin.id, { name: event.target.value })} /></label>
              </div>
              <div className="settings-config-plugin-actions">
                <em className={plugin.enabled ? "enabled" : "disabled"}>{plugin.enabled ? t("plugins.loadNext", locale) : t("plugins.disabled", locale)}</em>
                {!plugin.system && <button type="button" onClick={() => onRemovePlugin(plugin.id)} disabled={!writable || pluginConfigSaving}>{t("common.remove", locale)}</button>}
              </div>
            </div>
          ))}
        </div>}
        <div className="settings-plugin-savebar">
          <span>{pluginConfigDirty ? t("plugins.dirty", locale) : t("plugins.synced", locale)}</span>
          <div>
            <button type="button" onClick={onCancelPluginConfig} disabled={!pluginConfigDirty || pluginConfigSaving}>{t("common.cancel", locale)}</button>
            <button type="button" onClick={onSavePluginConfig} disabled={!writable || !pluginConfigDirty || pluginConfigSaving}>{pluginConfigSaving ? t("common.saving", locale) : t("plugins.saveList", locale)}</button>
            <button type="button" className="confirm" onClick={onSaveAndRestart} disabled={!writable || !pluginConfigDirty || pluginConfigSaving}>{pluginConfigSaving ? t("plugins.processing", locale) : t("plugins.saveRestart", locale)}</button>
          </div>
        </div>
      </section>

      <section className="settings-block">
        <div className="settings-plugin-toolbar">
          <div><h3>{t("plugins.runtimeList", locale)}</h3><p>{t("plugins.runtimeList.hint", locale)}</p></div>
          <label className="settings-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={t("plugins.search", locale)} aria-label={t("plugins.search", locale)} /></label>
        </div>
        {inventory === null ? <p className="settings-empty">{t("plugins.readingInventory", locale)}</p> : visiblePlugins.length === 0 ? <p className="settings-empty">{search ? t("plugins.noMatch", locale) : t("plugins.noneAvailable", locale)}</p> : <div className="settings-plugin-grid">{visiblePlugins.map((plugin) => {
          const open = expandedPlugin === plugin.entryId;
          return <article className={`settings-plugin-card ${open ? "open" : ""}`} key={plugin.entryId}>
            <button className="settings-plugin-header" type="button" onClick={() => onTogglePlugin(plugin.entryId)} aria-expanded={open}>
              <span className="settings-plugin-name"><strong title={plugin.moduleName}>{pluginDisplayName(plugin.moduleName)}</strong><small>{plugin.moduleName}</small></span>
              <span className="settings-plugin-state"><i className={`settings-plugin-dot ${plugin.enabled ? plugin.fiberPhase ?? "unobserved" : "disabled"}`} /><em className={plugin.enabled ? "enabled" : "disabled"}>{pluginStatus(plugin, locale)}</em><b aria-hidden="true">⌄</b></span>
            </button>
            {open && <div className="settings-plugin-details"><code>{plugin.entryId}</code><dl><div><dt>{t("plugins.compat", locale)}</dt><dd>{plugin.compatibility?.supported === false ? plugin.compatibility.reason : t("plugins.supported", locale)}</dd></div><div><dt>{t("plugins.status", locale)}</dt><dd>{plugin.enabled ? pluginPhaseLabel(plugin.fiberPhase, locale) : t("plugins.disabledState", locale)}</dd></div></dl></div>}
          </article>;
        })}</div>}
      </section>

      {excludedPlugins.length > 0 && <section className="settings-block settings-plugin-excluded-block">
        <div className="settings-block-heading"><div><h3>{t("plugins.excluded", locale)}</h3><p>{t("plugins.excluded.hint", locale, { count: excludedPlugins.length })}</p></div></div>
        <div className="settings-excluded-plugin-list">{excludedPlugins.map((plugin) => <div className="settings-excluded-plugin-row" key={plugin.entryId}><span><strong>{pluginDisplayName(plugin.moduleName)}</strong><small>{plugin.moduleName}</small></span><em>{plugin.compatibility?.reason ?? t("plugins.incompatible", locale)}</em></div>)}</div>
      </section>}

      {uiCatalog && <section className="settings-block settings-ui-plugins-block">
        <div className="settings-block-heading">
          <div><h3>UI 插件</h3><p>通过 deeptop-ui-registry 登记的界面插件：声明式贡献由原生渲染，客户端模块经受控协议加载（路径围栏 + SHA-256 完整性校验）。</p></div>
          <span className={`settings-plugin-state enabled`}><em className={uiCatalog.status === "ready" ? "enabled" : "disabled"}>{uiRuntimeStatusLabel[uiCatalog.status]}</em></span>
        </div>
        {!uiCatalog.enabled ? <p className="settings-empty">UI 插件运行时未启用。</p>
          : uiCatalog.plugins.length === 0 ? <p className="settings-empty">{uiCatalog.status === "failed" ? "无法读取 UI 插件目录。" : "当前没有已登记的 UI 插件。"}</p>
            : <div className="settings-excluded-plugin-list">{uiCatalog.plugins.map((plugin) => (
              <div className="settings-excluded-plugin-row" key={plugin.pluginId}>
                <span>
                  <strong>{plugin.displayName ?? plugin.pluginId}</strong>
                  <small>{plugin.pluginId} · v{plugin.version} · Slot：{plugin.slots.join("、") || "无"} · Remote：{plugin.remotes.map((remote) => remote.namespace).join("、") || "无"}{plugin.storage ? ` · 存储：${plugin.storage}` : ""}{plugin.hasClientModule ? " · 客户端模块" : ""}</small>
                </span>
                <em>{uiPluginStateLabel(plugin.state)}</em>
              </div>
            ))}</div>}
        {uiCatalog.diagnostics.length > 0 && <ul className="settings-ui-plugin-diagnostics">
          {uiCatalog.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.pluginId}:${index}`}><strong>{diagnostic.pluginId}</strong> {diagnostic.message}</li>
          ))}
        </ul>}
      </section>}

      <section className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("plugins.settings", locale)}</h3><p>{t("plugins.settings.hint", locale)}</p></div></div>
        {pluginSettings.length === 0 ? <p className="settings-empty">{t("plugins.noSettings", locale)}</p> : <div className="settings-namespace-list">{pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? t("settings.ns.restart", locale) : t("settings.ns.live", locale)} · revision {namespace.revision}{namespace.secrets.length ? t("settings.ns.secrets", locale, { count: namespace.secrets.filter((secret) => secret.set).length, total: namespace.secrets.length }) : ""}</small></div><button disabled={!settings?.writable} onClick={() => onOpenNamespace(namespace)}>{isSchemaEnvelope(namespace.schema) ? t("settings.ns.edit", locale) : t("settings.ns.editJson", locale)}</button></div>)}</div>}
      </section>
    </div>
  );
}
