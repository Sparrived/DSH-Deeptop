import { presetDescription, presetDisplayName } from "../app/model";
import type { DshPreset } from "../lib/desktop";

type AsyncAction = () => void | Promise<unknown>;

export interface InspectorPresetCopy {
  from: string;
  id: string;
  name: string;
}

export interface InspectorPresetView {
  id: string;
  content: string;
}

interface PresetSurfacePanelProps {
  presets: DshPreset[];
  writable?: boolean;
  authorable: boolean;
  copy: InspectorPresetCopy | null;
  view: InspectorPresetView | null;
  onSetDefault: (id: string) => void | Promise<unknown>;
  onRead: (id: string) => void | Promise<unknown>;
  onOpenDocument: (id: string) => void | Promise<unknown>;
  onBeginCopy: (id: string) => void;
  onCopyChange: (patch: Partial<InspectorPresetCopy>) => void;
  onCopy: AsyncAction;
  onCancelCopy: () => void;
  onCloseView: () => void;
  onRemove: (id: string) => void | Promise<unknown>;
}

export function PresetSurfacePanel({
  presets,
  writable,
  authorable,
  copy,
  view,
  onSetDefault,
  onRead,
  onOpenDocument,
  onBeginCopy,
  onCopyChange,
  onCopy,
  onCancelCopy,
  onCloseView,
  onRemove,
}: PresetSurfacePanelProps) {
  return <div className="surface-content">
    <div className="surface-intro"><strong>Agent Preset</strong><p>Preset 决定会话 Agent 所运行的工具、提示词和能力。新会话 chip 与设置页共享同一份名单。</p></div>
    <label className="surface-field">新会话默认
      <select disabled={writable === false} value={presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void onSetDefault(event.target.value)}>
        {presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets)}</option>)}
      </select>
    </label>
    <div className="surface-list">{presets.map((preset) => (
      <div className="surface-row" key={preset.id}>
        <div><strong>{presetDisplayName(preset.id, presets)}</strong><small>{preset.id} · {preset.trust}{preset.isDefault ? " · 默认" : ""}</small><p>{presetDescription(preset)}</p>{preset.broken && <p className="surface-error">{preset.broken}</p>}</div>
        <div className="surface-row-actions">{!preset.broken && <button onClick={() => void onRead(preset.id)} title="查看组合内容">查看</button>}{preset.trust === "user" && <button onClick={() => void onOpenDocument(preset.id)} title="打开 Preset 文件夹">打开</button>}<button disabled={!authorable || Boolean(preset.broken)} onClick={() => onBeginCopy(preset.id)} title="复制 Preset">复制</button>{preset.trust === "user" && <button onClick={() => void onRemove(preset.id)} title="删除 Preset">删除</button>}</div>
      </div>
    ))}</div>
    {!authorable && <p className="surface-muted">当前 Profile 未开放用户 Preset 创建。</p>}
    {authorable && <p className="surface-muted">可复制现有 Preset 创建用户组合；编辑仍由 DSH Host 负责打开本地文件。</p>}
    {copy && <div className="surface-dialog"><strong>复制 {copy.from}</strong><input placeholder="新 Preset id" value={copy.id} onChange={(event) => onCopyChange({ id: event.target.value })} /><input placeholder="显示名称（可选）" value={copy.name} onChange={(event) => onCopyChange({ name: event.target.value })} /><div className="surface-dialog-actions"><button onClick={onCancelCopy}>取消</button><button className="confirm" disabled={!copy.id.trim()} onClick={() => void onCopy()}>创建</button></div></div>}
    {view && <div className="surface-dialog"><strong>{view.id} / agent.cordis.yml</strong><pre className="surface-code">{view.content}</pre><button onClick={onCloseView}>关闭</button></div>}
  </div>;
}
