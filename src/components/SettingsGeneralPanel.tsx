import type { DshPreset, DshSettingsDescription, DshSettingsNamespace } from "../lib/desktop";
import { presetDisplayName } from "../app/model";

type SettingsGeneralPanelProps = {
  settings: DshSettingsDescription | null;
  presets: DshPreset[];
  workspace: string;
  runtimeDirectory: string;
  sidebarWidth: number;
  pluginSettings: DshSettingsNamespace[];
  onOpenDocument: () => void | Promise<void>;
  onSetDefaultPreset: (id: string) => void | Promise<void>;
  onAddWorkspace: () => void | Promise<void>;
  onResetSidebar: () => void;
  onOpenNamespace: (namespace: DshSettingsNamespace) => void;
};

export function SettingsGeneralPanel({
  settings,
  presets,
  workspace,
  runtimeDirectory,
  sidebarWidth,
  pluginSettings,
  onOpenDocument,
  onSetDefaultPreset,
  onAddWorkspace,
  onResetSidebar,
  onOpenNamespace,
}: SettingsGeneralPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">GENERAL</span><h2>通用</h2><p>管理当前桌面端连接的 DSH Host 与新会话默认值。</p></div>
        {settings?.hasDocument && <button className="settings-header-action" onClick={() => void onOpenDocument()}>打开配置文件</button>}
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>会话</h3><p>新会话使用的工作目录和 Agent Preset。</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>默认 Agent Preset</strong><small>只影响之后创建的新会话</small></span><select disabled={settings?.writable === false} value={presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void onSetDefaultPreset(event.target.value)}>{presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets)}</option>)}</select></label>
          <div className="settings-preference-row"><span><strong>工作目录</strong><small>{workspace || runtimeDirectory || "使用 DSH 运行目录"}</small></span><button onClick={() => void onAddWorkspace()}>选择目录</button></div>
          <div className="settings-preference-row"><span><strong>会话侧栏</strong><small>{sidebarWidth}px · 拖动主界面分隔线调整</small></span><button onClick={onResetSidebar} disabled={sidebarWidth === 320}>恢复默认</button></div>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>Host 设置</h3><p>公开字段可由桌面端保存；密钥始终由 DSH Host 保管。</p></div><span className="settings-count">{settings?.namespaces.length ?? "未提供"}</span></div>
        <div className="settings-namespace-list">
          {pluginSettings.length === 0 ? <p className="settings-empty">当前 Host 没有额外的可配置插件设置。</p> : pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? "重启生效" : "实时生效"} · revision {namespace.revision}{namespace.secrets.length ? ` · ${namespace.secrets.filter((secret) => secret.set).length}/${namespace.secrets.length} 个密钥已配置` : ""}</small></div><button disabled={!settings?.writable} onClick={() => onOpenNamespace(namespace)}>编辑 JSON</button></div>)}
        </div>
      </div>
    </div>
  );
}
