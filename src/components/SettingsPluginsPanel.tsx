import type { DshPluginInventoryEntry, DshSettingsNamespace, DshSettingsDescription } from "../lib/desktop";
import { pluginDisplayName, pluginPhaseLabel } from "../app/model";

type SettingsPluginsPanelProps = {
  inventory: DshPluginInventoryEntry[] | null;
  visiblePlugins: DshPluginInventoryEntry[];
  search: string;
  expandedPlugin: string | null;
  pluginSettings: DshSettingsNamespace[];
  settings: DshSettingsDescription | null;
  onSearchChange: (value: string) => void;
  onTogglePlugin: (entryId: string) => void;
  onOpenNamespace: (namespace: DshSettingsNamespace) => void;
};

export function SettingsPluginsPanel({
  inventory,
  visiblePlugins,
  search,
  expandedPlugin,
  pluginSettings,
  settings,
  onSearchChange,
  onTogglePlugin,
  onOpenNamespace,
}: SettingsPluginsPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header"><div><span className="settings-overline">PLUGINS</span><h2>插件</h2><p>这是当前 Cordis Loader 的只读快照；插件的启停和装载仍由 DSH Profile 决定。</p></div><span className="settings-count">{inventory?.length ?? "—"} 个插件</span></div>
      <div className="settings-block">
        <div className="settings-plugin-toolbar"><div><h3>插件列表</h3><p>展开条目查看 Loader id 和生命周期状态。</p></div><label className="settings-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索插件" aria-label="搜索插件" /></label></div>
        {inventory === null ? <p className="settings-empty">正在读取插件清单…</p> : visiblePlugins.length === 0 ? <p className="settings-empty">{search ? "没有匹配的插件。" : "当前没有已加载插件。"}</p> : <div className="settings-plugin-grid">{visiblePlugins.map((plugin) => {
          const open = expandedPlugin === plugin.entryId;
          return <article className={`settings-plugin-card ${open ? "open" : ""}`} key={plugin.entryId}>
            <button className="settings-plugin-header" onClick={() => onTogglePlugin(plugin.entryId)} aria-expanded={open}>
              <span className="settings-plugin-name"><strong title={plugin.moduleName}>{pluginDisplayName(plugin.moduleName)}</strong><small>{plugin.moduleName}</small></span>
              <span className="settings-plugin-state">{plugin.enabled && <i className={`settings-plugin-dot ${plugin.fiberPhase ?? "unobserved"}`} />}<em className={plugin.enabled ? "enabled" : "disabled"}>{plugin.enabled ? "已启用" : "已禁用"}</em><b aria-hidden="true">⌄</b></span>
            </button>
            {open && <div className="settings-plugin-details"><code>{plugin.entryId}</code><dl><div><dt>配置</dt><dd>{plugin.enabled ? "已启用" : "已禁用"}</dd></div>{plugin.enabled && <div><dt>Cordis</dt><dd>{pluginPhaseLabel(plugin.fiberPhase)}</dd></div>}</dl></div>}
          </article>;
        })}</div>}
      </div>
      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>插件配置</h3><p>由 Host 暴露的插件设置命名空间。</p></div></div>
        {pluginSettings.length === 0 ? <p className="settings-empty">当前没有单独的插件设置项。</p> : <div className="settings-namespace-list">{pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? "重启生效" : "实时生效"} · revision {namespace.revision}</small></div><button disabled={!settings?.writable} onClick={() => onOpenNamespace(namespace)}>编辑 JSON</button></div>)}</div>}
      </div>
    </div>
  );
}
