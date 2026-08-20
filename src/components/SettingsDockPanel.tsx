import type { DockSettings } from "../lib/desktop";

type SettingsDockPanelProps = {
  settings: DockSettings;
  loaded: boolean;
  updating: boolean;
  onUpdate: (patch: Partial<DockSettings>) => void | Promise<void>;
};

export function SettingsDockPanel({ settings, loaded, updating, onUpdate }: SettingsDockPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">DOCK</span>
          <h2>Dock</h2>
          <p>管理展开面板的交互行为和位置。</p>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div>
            <h3>展开框行为</h3>
            <p>控制 Dock 展开后点击其他区域时是否自动收起。默认关闭，关闭后可继续通过收起按钮或窄栏收起。</p>
          </div>
        </div>
        <div className="settings-preference-list">
          <div className="settings-preference-row">
            <span><strong>点击外部区域自动收起</strong><small>点击展开框以外的应用区域后收起当前 Dock</small></span>
            <label className="settings-plugin-toggle" aria-label="点击外部区域自动收起">
              <input
                type="checkbox"
                checked={settings.autoCollapseOnOutsideClick}
                disabled={!loaded || updating}
                onChange={(event) => void onUpdate({ autoCollapseOnOutsideClick: event.target.checked })}
              />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div>
            <h3>位置</h3>
            <p>展开框支持拖拽标题栏移动，位置会自动记忆。还原位置按钮位于每个展开框标题栏。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
