import type { DockSettings } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

type SettingsDockPanelProps = {
  settings: DockSettings;
  loaded: boolean;
  updating: boolean;
  /** 右栏当前停靠的面板/文件标签数量。 */
  dockedTabs: number;
  onUpdate: (patch: Partial<DockSettings>) => void | Promise<void>;
  onResetLayout: () => void;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
};

export function SettingsDockPanel({ settings, loaded, updating, dockedTabs, onUpdate, onResetLayout, locale = "zh" }: SettingsDockPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">DOCK</span>
          <h2>{t("settings.dock", locale)}</h2>
          <p>{t("dock.subtitle", locale)}</p>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div>
            <h3>{t("dock.behaviorTitle", locale)}</h3>
            <p>{t("dock.behaviorHint", locale)}</p>
          </div>
        </div>
        <div className="settings-preference-list">
          <div className="settings-preference-row">
            <span><strong>{t("dock.autoCollapse", locale)}</strong><small>{t("dock.autoCollapseHint", locale)}</small></span>
            <label className="settings-plugin-toggle" aria-label={t("dock.autoCollapse", locale)}>
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
            <h3>{t("dock.layoutTitle", locale)}</h3>
            <p>{t("dock.layoutHint", locale)}</p>
          </div>
        </div>
        <div className="settings-preference-list">
          <div className="settings-preference-row">
            <span>
              <strong>{t("dock.layoutDocked", locale)}</strong>
              <small>{t("dock.layoutDockedHint", locale, { count: dockedTabs })}</small>
            </span>
            <button type="button" className="settings-inline-action" disabled={updating} onClick={onResetLayout}>
              {t("dock.layoutReset", locale)}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div>
            <h3>{t("dock.positionTitle", locale)}</h3>
            <p>{t("dock.positionHint", locale)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
