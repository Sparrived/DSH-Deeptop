import { isSendShortcut, SEND_SHORTCUT_OPTIONS, type SendShortcut } from "../app/keyboard-shortcut";

type SettingsKeyboardPanelProps = {
  sendShortcut: SendShortcut;
  onSendShortcutChange: (shortcut: SendShortcut) => void;
};

export function SettingsKeyboardPanel({ sendShortcut, onSendShortcutChange }: SettingsKeyboardPanelProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">KEYBOARD</span><h2>按键</h2><p>调整消息编辑器中的快捷操作，让发送和换行更符合你的输入习惯。</p></div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>消息编辑器</h3><p>选择消息输入框的发送按键，另一种按键可用于换行。</p></div></div>
        <div className="settings-preference-list">
          <div className="settings-preference-row keyboard-shortcut-row">
            <span><strong>发送消息</strong><small>发送当前输入内容；处理中的回合也可以继续发送排队或插入消息。</small></span>
            <select
              value={sendShortcut}
              aria-label="发送消息按键"
              onChange={(event) => {
                if (isSendShortcut(event.target.value)) onSendShortcutChange(event.target.value);
              }}
            >
              {SEND_SHORTCUT_OPTIONS.map((shortcut) => <option value={shortcut} key={shortcut}>{shortcut}</option>)}
            </select>
          </div>
        </div>
        <p className="settings-hint">当前发送键：{sendShortcut}。在消息输入框中生效。</p>
      </div>

      <div className="settings-block keyboard-tips-block">
        <div className="settings-block-heading"><div><h3>输入提示</h3><p><kbd>{sendShortcut}</kbd> 发送消息；另一种按键用于换行。</p></div></div>
      </div>
    </div>
  );
}
