import type {
  DshPluginConfigDescription,
  DshPluginConfigEntry,
  DshPluginInventoryEntry,
  DshSettingsNamespace,
  DshSettingsDescription,
} from "../lib/desktop";
import { pluginDisplayName, pluginPhaseLabel } from "../app/model";

type SettingsPluginsPanelProps = {
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

function pluginStatus(plugin: DshPluginInventoryEntry) {
  if (plugin.compatibility?.supported === false) return "不兼容";
  if (!plugin.enabled) return "已停用";
  return pluginPhaseLabel(plugin.fiberPhase);
}

export function SettingsPluginsPanel({
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
          <h2>插件</h2>
          <p>只显示 Deeptop 能加载的 Host/Cordis 插件。WebUI 客户端插件会被自动排除，不会进入桌面 Profile。</p>
        </div>
        <div className="settings-plugin-header-actions">
          <span className="settings-count">{visiblePlugins.length} 个可用</span>
          <button className="settings-header-action" type="button" onClick={onRestart} disabled={!settings || pluginConfigDirty}>重启 Deeptop</button>
        </div>
      </div>

      <div className="settings-plugin-summary" role="status">
        <span><strong>{enabledCount}</strong> 个插件将在下次启动加载</span>
        <span className="settings-plugin-summary-note">保存配置后需要重启 Deeptop 才能应用</span>
      </div>

      <section className="settings-block settings-plugin-config-block">
        <div className="settings-block-heading">
          <div><h3>桌面插件列表</h3><p>在这里启用、停用、添加或移除用户插件。内置 Deeptop 服务始终保留。</p></div>
          <button className="settings-header-action" type="button" onClick={onAddPlugin} disabled={!writable || pluginConfigSaving}>添加插件</button>
        </div>
        {pluginConfig === null ? <p className="settings-empty">正在读取插件配置…</p> : pluginConfigDraft.length === 0 ? <div className="settings-plugin-empty-action"><p className="settings-empty">还没有添加用户插件。</p><button className="settings-header-action" type="button" onClick={onAddPlugin} disabled={!writable}>添加第一个插件</button></div> : <div className="settings-config-plugin-list">
          {pluginConfigDraft.map((plugin) => (
            <div className={`settings-config-plugin-row ${plugin.enabled ? "enabled" : "disabled"}`} key={plugin.id}>
              <label className="settings-plugin-toggle">
                <input type="checkbox" checked={plugin.enabled} disabled={!writable || plugin.system || pluginConfigSaving} onChange={() => onToggleConfigPlugin(plugin.id)} />
                <span aria-hidden="true" />
              </label>
              <div className="settings-config-plugin-fields">
                <label><span>插件 id</span><input value={plugin.id} disabled={!writable || plugin.system || pluginConfigSaving} onChange={(event) => onUpdatePlugin(plugin.id, { id: event.target.value })} /></label>
                <label><span>模块路径或包名</span><input value={plugin.name} disabled={!writable || plugin.system || pluginConfigSaving} onChange={(event) => onUpdatePlugin(plugin.id, { name: event.target.value })} /></label>
              </div>
              <div className="settings-config-plugin-actions">
                <em className={plugin.enabled ? "enabled" : "disabled"}>{plugin.enabled ? "下次启动加载" : "已停用"}</em>
                {!plugin.system && <button type="button" onClick={() => onRemovePlugin(plugin.id)} disabled={!writable || pluginConfigSaving}>移除</button>}
              </div>
            </div>
          ))}
        </div>}
        <div className="settings-plugin-savebar">
          <span>{pluginConfigDirty ? "有未保存的插件改动" : "插件列表已同步"}</span>
          <div>
            <button type="button" onClick={onCancelPluginConfig} disabled={!pluginConfigDirty || pluginConfigSaving}>取消</button>
            <button type="button" onClick={onSavePluginConfig} disabled={!writable || !pluginConfigDirty || pluginConfigSaving}>{pluginConfigSaving ? "保存中…" : "保存列表"}</button>
            <button type="button" className="confirm" onClick={onSaveAndRestart} disabled={!writable || !pluginConfigDirty || pluginConfigSaving}>{pluginConfigSaving ? "处理中…" : "保存并重启"}</button>
          </div>
        </div>
      </section>

      <section className="settings-block">
        <div className="settings-plugin-toolbar">
          <div><h3>运行时清单</h3><p>这是当前 DSH 进程已发现的插件状态。展开条目查看 Loader id 和生命周期。</p></div>
          <label className="settings-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索插件" aria-label="搜索插件" /></label>
        </div>
        {inventory === null ? <p className="settings-empty">正在读取运行时清单…</p> : visiblePlugins.length === 0 ? <p className="settings-empty">{search ? "没有匹配的可用插件。" : "当前没有可用插件。"}</p> : <div className="settings-plugin-grid">{visiblePlugins.map((plugin) => {
          const open = expandedPlugin === plugin.entryId;
          return <article className={`settings-plugin-card ${open ? "open" : ""}`} key={plugin.entryId}>
            <button className="settings-plugin-header" type="button" onClick={() => onTogglePlugin(plugin.entryId)} aria-expanded={open}>
              <span className="settings-plugin-name"><strong title={plugin.moduleName}>{pluginDisplayName(plugin.moduleName)}</strong><small>{plugin.moduleName}</small></span>
              <span className="settings-plugin-state"><i className={`settings-plugin-dot ${plugin.enabled ? plugin.fiberPhase ?? "unobserved" : "disabled"}`} /><em className={plugin.enabled ? "enabled" : "disabled"}>{pluginStatus(plugin)}</em><b aria-hidden="true">⌄</b></span>
            </button>
            {open && <div className="settings-plugin-details"><code>{plugin.entryId}</code><dl><div><dt>兼容性</dt><dd>{plugin.compatibility?.supported === false ? plugin.compatibility.reason : "支持 Deeptop 桌面端"}</dd></div><div><dt>状态</dt><dd>{plugin.enabled ? pluginPhaseLabel(plugin.fiberPhase) : "已禁用"}</dd></div></dl></div>}
          </article>;
        })}</div>}
      </section>

      {excludedPlugins.length > 0 && <section className="settings-block settings-plugin-excluded-block">
        <div className="settings-block-heading"><div><h3>已排除的插件</h3><p>{excludedPlugins.length} 个插件依赖 WebUI 客户端运行时，Deeptop 不会加载。</p></div></div>
        <div className="settings-excluded-plugin-list">{excludedPlugins.map((plugin) => <div className="settings-excluded-plugin-row" key={plugin.entryId}><span><strong>{pluginDisplayName(plugin.moduleName)}</strong><small>{plugin.moduleName}</small></span><em>{plugin.compatibility?.reason ?? "不兼容 Deeptop"}</em></div>)}</div>
      </section>}

      <section className="settings-block">
        <div className="settings-block-heading"><div><h3>插件设置</h3><p>由 Host 暴露的插件设置命名空间。</p></div></div>
        {pluginSettings.length === 0 ? <p className="settings-empty">当前没有单独的插件设置项。</p> : <div className="settings-namespace-list">{pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? "重启生效" : "实时生效"} · revision {namespace.revision}</small></div><button disabled={!settings?.writable} onClick={() => onOpenNamespace(namespace)}>编辑 JSON</button></div>)}</div>}
      </section>
    </div>
  );
}
