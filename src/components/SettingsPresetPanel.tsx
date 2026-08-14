import type { DshPreset } from "../lib/desktop";
import { presetDescription, presetDisplayName } from "../app/model";

type SettingsPresetPanelProps = {
  presets: DshPreset[];
  writable?: boolean;
  authorable: boolean;
  onSetDefault: (id: string) => void | Promise<void>;
  onRead: (id: string) => void | Promise<void>;
  onOpenDocument: (id: string) => void | Promise<void>;
  onBeginCopy: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
};

export function SettingsPresetPanel({
  presets,
  writable,
  authorable,
  onSetDefault,
  onRead,
  onOpenDocument,
  onBeginCopy,
  onRemove,
}: SettingsPresetPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">AGENT PRESETS</span><h2>Agent Preset</h2><p>Preset 决定会话 Agent 所运行的工具、提示词和能力。默认值只影响之后创建的新会话。</p></div>
        <span className="settings-count">{presets.length} 个</span>
      </div>
      {presets.length === 0 ? <p className="settings-empty">当前 Profile 未提供 Agent Preset。</p> : (
        <div className="settings-preset-groups">
          {(["system", "user"] as const).map((trust) => {
            const group = presets.filter((preset) => preset.trust === trust);
            if (group.length === 0) return null;
            return <section className="settings-preset-group" key={trust}>
              <h3>{trust === "system" ? "内置" : "自定义"}</h3>
              <div className="settings-preset-list">
                {group.map((preset) => <article className={`settings-preset-card${preset.isDefault ? " active" : ""}${preset.broken ? " broken" : ""}`} key={preset.id}>
                  <div className="settings-preset-copy">
                    <div className="settings-preset-heading"><strong>{presetDisplayName(preset.id, presets)}</strong>{preset.isDefault && <span>当前默认</span>}{preset.broken && <span className="error">加载失败</span>}</div>
                    <small>{preset.id} · {trust === "system" ? "内置" : "自定义"}</small>
                    <p>{presetDescription(preset)}</p>
                    {preset.broken && <p className="settings-preset-error">{preset.broken}</p>}
                  </div>
                  <div className="settings-preset-actions">
                    <button disabled={writable === false || Boolean(preset.broken) || preset.isDefault} onClick={() => void onSetDefault(preset.id)}>设为默认</button>
                    {trust === "system" && !preset.broken && <button onClick={() => void onRead(preset.id)}>查看</button>}
                    {trust === "user" && <button onClick={() => void onOpenDocument(preset.id)}>打开目录</button>}
                    <button disabled={!authorable || Boolean(preset.broken)} onClick={() => onBeginCopy(preset.id)}>复制</button>
                    {trust === "user" && <button className="danger" onClick={() => void onRemove(preset.id)}>删除</button>}
                  </div>
                </article>)}
              </div>
            </section>;
          })}
        </div>
      )}
      {!authorable && presets.length > 0 && <p className="surface-muted">当前 Profile 未开放用户 Preset 创建。</p>}
    </div>
  );
}
