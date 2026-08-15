import type { DiscoveredModel } from "../app/model";
import type { DshCredential, DshModelGroup, DshProvider } from "../lib/desktop";

type ProviderDraft = {
  baseURL: string;
  api: string;
};

type ProviderAction = () => void | Promise<unknown>;

export interface SettingsProviderCardView {
  provider: DshProvider;
  secretTotal: number;
  secretConfigured: number;
  hasCredential: boolean;
  credential?: DshCredential;
  modelGroups: DshModelGroup[];
  configuredModels: Array<Record<string, unknown>>;
  draft: ProviderDraft;
  candidates: DiscoveredModel[];
  selectedCandidateIds: string[];
  removable: boolean;
  open: boolean;
  settingsWritable: boolean;
  namespaceAvailable: boolean;
  discoveryBusy: boolean;
  credentialDraft: string;
  credentialBusy: boolean;
}

export interface SettingsProviderCardActions {
  onToggle: () => void;
  onDraftChange: (patch: Partial<ProviderDraft>) => void;
  onSaveSettings: ProviderAction;
  onDiscoverModels: ProviderAction;
  onRemoveModel: (modelId: string) => void | Promise<unknown>;
  onToggleModelImages: (modelId: string) => void | Promise<unknown>;
  onToggleCandidate: (modelId: string) => void;
  onApplyCandidates: ProviderAction;
  onCredentialDraftChange: (value: string) => void;
  onSaveCredential: ProviderAction;
  onClearCredential: ProviderAction;
  onRemoveConfiguration: ProviderAction;
  onOpenNamespace: () => void;
}

interface SettingsProviderCardProps {
  view: SettingsProviderCardView;
  actions: SettingsProviderCardActions;
}

export function SettingsProviderCard({ view, actions }: SettingsProviderCardProps) {
  const { provider, credential, draft } = view;
  const selectedCandidates = new Set(view.selectedCandidateIds);
  const canEditSettings = view.settingsWritable && view.namespaceAvailable;

  return <article className={`settings-provider-card ${view.open ? "open" : ""}`}>
    <button type="button" className="settings-provider-header" onClick={actions.onToggle} aria-expanded={view.open}>
      <span className="settings-provider-title"><strong>{provider.displayName}</strong><small>{provider.provider}</small></span>
      <span className="settings-provider-trailing"><i className={provider.active ? "active" : ""} /><span>{provider.active ? "可用" : "未激活"}</span><b aria-hidden="true">⌄</b></span>
    </button>
    {view.open && <div className="settings-provider-details">
      <div className="settings-provider-meta"><div><span>设置命名空间</span><code>{provider.settingsNs}</code></div><div><span>API 密钥</span><strong className={view.hasCredential ? "configured" : "unconfigured"}>{view.secretTotal === 0 ? (view.hasCredential ? "已配置" : "未配置") : `${view.secretConfigured}/${view.secretTotal} 已配置`}</strong></div></div>
      {view.modelGroups.length > 0 && <div className="settings-provider-models"><span className="settings-detail-label">Host 模型目录</span>{view.modelGroups.flatMap((group) => group.models).slice(0, 8).map((model) => <span className="settings-model-chip" key={`${provider.provider}-${model.id}`}>{model.name}</span>)}</div>}
      <div className="settings-provider-draft">
        <label><span>Base URL</span><input type="url" value={draft.baseURL} placeholder="使用 Provider 默认地址" onChange={(event) => actions.onDraftChange({ baseURL: event.target.value })} /></label>
        {provider.settingsNs === "llm-pi-ai" && <label><span>协议</span><input value={draft.api} placeholder="openai-completions / anthropic-messages" onChange={(event) => actions.onDraftChange({ api: event.target.value })} /></label>}
        <div className="settings-provider-draft-actions"><button disabled={!canEditSettings} onClick={() => void actions.onSaveSettings()}>保存连接</button><button disabled={view.discoveryBusy || !view.namespaceAvailable} onClick={() => void actions.onDiscoverModels()}>{view.discoveryBusy ? "发现中" : "发现模型"}</button></div>
      </div>
      {view.configuredModels.length > 0 && <div className="settings-provider-models configured"><span className="settings-detail-label">配置模型</span>{view.configuredModels.map((model) => {
        const modelId = String(model.id);
        const imageEnabled = Array.isArray(model.input) && model.input.includes("image");
        return <span className="settings-model-chip editable" key={`${provider.provider}-configured-${modelId}`}>
          <span>{String(model.name || modelId)}</span>
          <button type="button" onClick={() => void actions.onToggleModelImages(modelId)} title={imageEnabled ? "关闭图片输入声明" : "声明支持图片输入"} aria-label={`${imageEnabled ? "关闭" : "开启"} ${String(model.name || modelId)} 的图片输入`}>{imageEnabled ? "图" : "文"}</button>
          <button type="button" onClick={() => void actions.onRemoveModel(modelId)} title={`移除 ${String(model.name || modelId)}`} aria-label={`移除 ${String(model.name || modelId)}`}>×</button>
        </span>;
      })}</div>}
      {view.candidates.length > 0 && <div className="settings-provider-candidates"><div className="settings-provider-candidates-heading"><span>发现结果</span><button type="button" disabled={selectedCandidates.size === 0} onClick={() => void actions.onApplyCandidates()}>应用选中</button></div>{view.candidates.map((model) => <label key={`${provider.provider}-candidate-${model.id}`}><input type="checkbox" checked={selectedCandidates.has(model.id)} onChange={() => actions.onToggleCandidate(model.id)} /><span><strong>{model.name || model.id}</strong><small>{model.id}{model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} context` : ""}</small></span></label>)}</div>}
      <div className="settings-provider-secret">
        <label><span>API 密钥</span><input type="password" autoComplete="off" value={view.credentialDraft} onChange={(event) => actions.onCredentialDraftChange(event.target.value)} placeholder={credential?.configured ? "已配置，输入新密钥替换" : "输入密钥"} disabled={credential?.writable === false || view.credentialBusy} /></label>
        <div><small>{credential?.source ? `来源：${credential.source}` : credential?.configured ? "已配置" : "未配置"}</small><button disabled={credential?.writable === false || view.credentialBusy} onClick={() => void actions.onSaveCredential()}>{view.credentialBusy ? "保存中" : "保存"}</button>{credential?.configured && credential.writable !== false && <button onClick={() => void actions.onClearCredential()}>清除</button>}</div>
      </div>
      <div className="settings-provider-footer"><small>{provider.declared === false ? "运行中路由" : "可配置路由"}</small><span>{view.removable && <button disabled={!canEditSettings} onClick={() => void actions.onRemoveConfiguration()}>移除</button>}<button disabled={!canEditSettings} onClick={actions.onOpenNamespace}>编辑公开设置</button></span></div>
    </div>}
  </article>;
}
