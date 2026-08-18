import type { DshPreset, DshSettingsDescription, DshSettingsNamespace, WindowsContextMenuStatus } from "../lib/desktop";
import { presetDisplayName } from "../app/model";
import type { DshHostModelCatalog, ModelSelection } from "../app/model";

const PERMISSION_PRESETS = [
  { value: "read-only", label: "只读", description: "仅读取和分析内容" },
  { value: "workspace-write", label: "工作区可写", description: "可修改当前工作区文件" },
  { value: "danger-full-access", label: "完全访问", description: "允许不受限制的文件与外部操作" },
] as const;

function modelKey(selection: ModelSelection | null) {
  return selection ? `${selection.provider}\u0000${selection.model}` : "";
}

type SettingsGeneralPanelProps = {
  settings: DshSettingsDescription | null;
  presets: DshPreset[];
  hostModels: DshHostModelCatalog | null;
  defaultModel: ModelSelection | null;
  defaultPermission: string | null;
  workspace: string;
  runtimeDirectory: string;
  sidebarWidth: number;
  pluginSettings: DshSettingsNamespace[];
  contextMenuStatus: WindowsContextMenuStatus | null;
  contextMenuUpdating: boolean;
  onSetContextMenuEnabled: (enabled: boolean) => void | Promise<void>;
  onOpenDocument: () => void | Promise<void>;
  onSetDefaultPreset: (id: string) => void | Promise<void>;
  onSetDefaultModel: (selection: ModelSelection) => void | Promise<void>;
  onSetDefaultPermission: (value: string) => void | Promise<void>;
  onAddWorkspace: () => void | Promise<void>;
  onResetSidebar: () => void;
  onOpenNamespace: (namespace: DshSettingsNamespace) => void;
};

export function SettingsGeneralPanel({
  settings,
  presets,
  hostModels,
  defaultModel,
  defaultPermission,
  workspace,
  runtimeDirectory,
  sidebarWidth,
  pluginSettings,
  contextMenuStatus,
  contextMenuUpdating,
  onSetContextMenuEnabled,
  onOpenDocument,
  onSetDefaultPreset,
  onSetDefaultModel,
  onSetDefaultPermission,
  onAddWorkspace,
  onResetSidebar,
  onOpenNamespace,
}: SettingsGeneralPanelProps) {
  const modelOptions = hostModels?.groups.flatMap((group) => group.models.map((model) => ({
    value: `${group.id}\u0000${model.id}`,
    provider: group.id,
    model: model.id,
    label: `${group.name} / ${model.name}`,
    reasoning: model.reasoning,
  }))) ?? [];
  const selectedModel = modelOptions.find((option) => option.value === modelKey(defaultModel));
  const permission = PERMISSION_PRESETS.find((option) => option.value === defaultPermission);
  const permissionNamespace = settings?.namespaces.find((namespace) => namespace.ns === "permission");
  const modelNamespace = settings?.namespaces.find((namespace) => namespace.ns === "agent-default-model");
  const permissionStorageHint = permissionNamespace ? "由 DSH Host 应用到新会话" : "保存在此桌面端，并应用到新会话";
  const modelReasoning = selectedModel?.reasoning;
  const reasoningValue = defaultModel?.reasoningEffort ?? modelReasoning?.defaultEffort ?? "";

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">GENERAL</span><h2>通用</h2><p>管理当前桌面端连接的 DSH Host 与新会话默认值。</p></div>
        {settings?.hasDocument && <button className="settings-header-action" onClick={() => void onOpenDocument()}>打开配置文件</button>}
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>会话</h3><p>这些选项只影响之后创建的新会话；已打开的会话保持自己的运行状态。</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>默认 Agent Preset</strong><small>决定新会话使用的工具和能力</small></span><select disabled={settings?.writable === false} value={presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void onSetDefaultPreset(event.target.value)}>{presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets)}</option>)}</select></label>
          <label className="settings-preference-row"><span><strong>默认权限模式</strong><small>{permission?.description ?? "选择新会话启动时的权限"} · {permissionStorageHint}</small></span><select disabled={!settings || settings.writable === false} value={defaultPermission ?? ""} onChange={(event) => void onSetDefaultPermission(event.target.value)}><option value="" disabled>Host 未提供</option>{PERMISSION_PRESETS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="settings-preference-row"><span><strong>默认模型</strong><small>{modelNamespace ? "通过 DSH 设置保存，并应用到新会话" : "保存在此桌面端，并应用到新会话"}</small></span><select disabled={modelOptions.length === 0} value={modelKey(defaultModel)} onChange={(event) => { const option = modelOptions.find((item) => item.value === event.target.value); if (option) void onSetDefaultModel({ provider: option.provider, model: option.model, ...(option.reasoning?.defaultEffort ? { reasoningEffort: option.reasoning.defaultEffort } : {}) }); }}><option value="" disabled>选择模型</option>{modelOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          {modelReasoning && <label className="settings-preference-row"><span><strong>默认思考程度</strong><small>仅对支持思考程度的模型生效</small></span><select disabled={!defaultModel} value={reasoningValue} onChange={(event) => { if (defaultModel) void onSetDefaultModel({ ...defaultModel, reasoningEffort: event.target.value || undefined }); }}><option value="">跟随模型默认</option>{modelReasoning.efforts.map((effort) => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select></label>}
          <div className="settings-preference-row"><span><strong>工作目录</strong><small>{workspace || runtimeDirectory || "使用 DSH 运行目录"}</small></span><button onClick={() => void onAddWorkspace()}>选择目录</button></div>
          <div className="settings-preference-row"><span><strong>会话侧栏</strong><small>{sidebarWidth}px · 拖动主界面分隔线调整</small></span><button onClick={onResetSidebar} disabled={sidebarWidth === 320}>恢复默认</button></div>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>右键启动</h3><p>在 Windows 资源管理器中添加“使用 Deeptop 启动”，从选中的文件或文件夹打开对应工作目录。</p></div></div>
        {contextMenuStatus?.supported ? <div className="settings-preference-row"><span><strong>资源管理器右键菜单</strong><small>{contextMenuStatus.message} · 修改后可能需要重新打开资源管理器窗口</small></span><label className="settings-plugin-toggle" aria-label="启用资源管理器右键菜单"><input type="checkbox" checked={contextMenuStatus.enabled} disabled={contextMenuUpdating} onChange={(event) => void onSetContextMenuEnabled(event.target.checked)} /><span aria-hidden="true" /></label></div> : <p className="settings-empty">{contextMenuStatus?.message ?? "正在检查 Windows 右键菜单状态…"}</p>}
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
