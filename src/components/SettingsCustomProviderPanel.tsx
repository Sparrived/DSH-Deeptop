import type { CustomProviderDraft } from "../app/model";

interface SettingsCustomProviderPanelProps {
  available: boolean;
  draft: CustomProviderDraft;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onDraftChange: (patch: Partial<CustomProviderDraft>) => void;
  onToggleModel: (modelId: string) => void;
  onDiscover: () => void | Promise<void>;
  onCancel: () => void;
  onCreate: () => void | Promise<void>;
}

export function SettingsCustomProviderPanel({
  available,
  draft,
  open,
  busy,
  onToggle,
  onDraftChange,
  onToggleModel,
  onDiscover,
  onCancel,
  onCreate,
}: SettingsCustomProviderPanelProps) {
  if (!available) return null;

  return <div className="settings-custom-provider">
    <div className="settings-custom-provider-heading">
      <div><strong>自定义 Provider</strong><small>添加 OpenAI-compatible 或其他 pi-ai 协议端点。</small></div>
      <button type="button" onClick={onToggle}>{open ? "收起" : "添加"}</button>
    </div>
    {open && <div className="settings-custom-provider-form">
      <div className="settings-custom-provider-grid">
        <label><span>Provider ID</span><input value={draft.provider} placeholder="my-gateway" onChange={(event) => onDraftChange({ provider: event.target.value })} /></label>
        <label><span>显示名称</span><input value={draft.displayName} placeholder="可选" onChange={(event) => onDraftChange({ displayName: event.target.value })} /></label>
        <label><span>Base URL</span><input type="url" value={draft.baseURL} placeholder="https://api.example.com/v1" onChange={(event) => onDraftChange({ baseURL: event.target.value })} /></label>
        <label><span>协议</span><input value={draft.api} placeholder="openai-completions" onChange={(event) => onDraftChange({ api: event.target.value })} /></label>
        <label><span>API 密钥</span><input type="password" autoComplete="off" value={draft.apiKey} placeholder="可选" onChange={(event) => onDraftChange({ apiKey: event.target.value })} /></label>
      </div>
      <div className="settings-custom-provider-actions"><button type="button" disabled={busy} onClick={() => void onDiscover()}>{busy ? "处理中" : "发现模型"}</button></div>
      {draft.models.length > 0 && <div className="settings-custom-provider-models">{draft.models.map((model) => <label key={`custom-model-${model.id}`}><input type="checkbox" checked={draft.selectedModels.includes(model.id)} onChange={() => onToggleModel(model.id)} /><span><strong>{model.name || model.id}</strong><small>{model.id}</small></span></label>)}</div>}
      <div className="settings-custom-provider-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" className="confirm" disabled={busy} onClick={() => void onCreate()}>保存 Provider</button></div>
    </div>}
  </div>;
}
