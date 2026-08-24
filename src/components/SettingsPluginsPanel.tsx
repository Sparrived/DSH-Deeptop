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

      <section className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("plugins.settings", locale)}</h3><p>{t("plugins.settings.hint", locale)}</p></div></div>
        {pluginSettings.length === 0 ? <p className="settings-empty">{t("plugins.noSettings", locale)}</p> : <div className="settings-namespace-list">{pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? t("settings.ns.restart", locale) : t("settings.ns.live", locale)} · revision {namespace.revision}{namespace.secrets.length ? t("settings.ns.secrets", locale, { count: namespace.secrets.filter((secret) => secret.set).length, total: namespace.secrets.length }) : ""}</small></div><button disabled={!settings?.writable} onClick={() => onOpenNamespace(namespace)}>{isSchemaEnvelope(namespace.schema) ? t("settings.ns.edit", locale) : t("settings.ns.editJson", locale)}</button></div>)}</div>}
      </section>
    </div>
  );
}
