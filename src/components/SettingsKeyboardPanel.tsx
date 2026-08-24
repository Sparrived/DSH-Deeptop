import { isSendShortcut, SEND_SHORTCUT_OPTIONS, type SendShortcut } from "../app/keyboard-shortcut";
import { t, type UiLocale } from "../app/i18n";

type SettingsKeyboardPanelProps = {
  sendShortcut: SendShortcut;
  onSendShortcutChange: (shortcut: SendShortcut) => void;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
};

export function SettingsKeyboardPanel({ sendShortcut, onSendShortcutChange, locale = "zh" }: SettingsKeyboardPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">KEYBOARD</span><h2>{t("settings.keyboard", locale)}</h2><p>{t("keyboard.subtitle", locale)}</p></div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("keyboard.editorTitle", locale)}</h3><p>{t("keyboard.editorHint", locale)}</p></div></div>
        <div className="settings-preference-list">
          <div className="settings-preference-row keyboard-shortcut-row">
            <span><strong>{t("composer.send", locale)}</strong><small>{t("keyboard.sendHint", locale)}</small></span>
            <select
              value={sendShortcut}
              aria-label={t("keyboard.sendShortcutAria", locale)}
              onChange={(event) => {
                if (isSendShortcut(event.target.value)) onSendShortcutChange(event.target.value);
              }}
            >
              {SEND_SHORTCUT_OPTIONS.map((shortcut) => <option value={shortcut} key={shortcut}>{shortcut}</option>)}
            </select>
          </div>
        </div>
        <p className="settings-hint">{t("keyboard.currentShortcut", locale, { shortcut: sendShortcut })}</p>
      </div>

      <div className="settings-block keyboard-tips-block">
        <div className="settings-block-heading"><div><h3>{t("keyboard.tipsTitle", locale)}</h3><p><kbd>{sendShortcut}</kbd> {t("keyboard.tipsHint", locale)}</p></div></div>
      </div>
    </div>
  );
}
