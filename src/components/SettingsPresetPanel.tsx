import type { DshPreset } from "../lib/desktop";
import { presetDescription, presetDisplayName } from "../app/model";
import { t, type UiLocale } from "../app/i18n";

type SettingsPresetPanelProps = {
  presets: DshPreset[];
  writable?: boolean;
  authorable: boolean;
  onSetDefault: (id: string) => void | Promise<void>;
  onRead: (id: string) => void | Promise<void>;
  onOpenDocument: (id: string) => void | Promise<void>;
  onBeginCopy: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
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
  locale = "zh",
}: SettingsPresetPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">AGENT PRESETS</span><h2>{t("settings.presets", locale)}</h2><p>{t("preset.subtitle", locale)}</p></div>
        <span className="settings-count">{t("preset.count", locale, { count: presets.length })}</span>
      </div>
      {presets.length === 0 ? <p className="settings-empty">{t("preset.empty", locale)}</p> : (
        <div className="settings-preset-groups">
          {(["system", "user"] as const).map((trust) => {
            const group = presets.filter((preset) => preset.trust === trust);
            if (group.length === 0) return null;
            return <section className="settings-preset-group" key={trust}>
              <h3>{trust === "system" ? t("preset.builtin", locale) : t("preset.custom", locale)}</h3>
              <div className="settings-preset-list">
                {group.map((preset) => <article className={`settings-preset-card${preset.isDefault ? " active" : ""}${preset.broken ? " broken" : ""}`} key={preset.id}>
                  <div className="settings-preset-copy">
                    <div className="settings-preset-heading"><strong>{presetDisplayName(preset.id, presets, locale)}</strong>{preset.isDefault && <span>{t("preset.currentDefault", locale)}</span>}{preset.broken && <span className="error">{t("preset.loadFailed", locale)}</span>}</div>
                    <small>{preset.id} · {trust === "system" ? t("preset.builtin", locale) : t("preset.custom", locale)}</small>
                  </div>
                  <div className="settings-preset-actions">
                    <button disabled={writable === false || Boolean(preset.broken) || preset.isDefault} onClick={() => void onSetDefault(preset.id)}>{t("preset.setDefault", locale)}</button>
                    {trust === "system" && !preset.broken && <button onClick={() => void onRead(preset.id)}>{t("preset.view", locale)}</button>}
                    {trust === "user" && <button onClick={() => void onOpenDocument(preset.id)}>{t("preset.openDirectory", locale)}</button>}
                    <button disabled={!authorable || Boolean(preset.broken)} onClick={() => onBeginCopy(preset.id)}>{t("common.copy", locale)}</button>
                    {trust === "user" && <button className="danger" onClick={() => void onRemove(preset.id)}>{t("common.delete", locale)}</button>}
                  </div>
                  <div className="settings-preset-description">
                    <p>{presetDescription(preset, locale)}</p>
                    {preset.broken && <p className="settings-preset-error">{preset.broken}</p>}
                  </div>
                </article>)}
              </div>
            </section>;
          })}
        </div>
      )}
      {!authorable && presets.length > 0 && <p className="surface-muted">{t("preset.notAuthorable", locale)}</p>}
    </div>
  );
}
