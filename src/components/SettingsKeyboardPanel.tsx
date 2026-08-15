import { useEffect, useState } from "react";
import { DEFAULT_SEND_SHORTCUT, shortcutFromKeyboardEvent } from "../app/keyboard-shortcut";

type SettingsKeyboardPanelProps = {
  sendShortcut: string;
  onSendShortcutChange: (shortcut: string) => void;
};

export function SettingsKeyboardPanel({ sendShortcut, onSendShortcutChange }: SettingsKeyboardPanelProps) {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState(sendShortcut);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) setDraft(sendShortcut);
  }, [recording, sendShortcut]);

  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        setDraft(sendShortcut);
        setError("");
        return;
      }
      const next = shortcutFromKeyboardEvent(event);
      if (!next) {
        setError("请按下至少包含一个修饰键的快捷键，例如 Ctrl+Enter");
        return;
      }
      setDraft(next);
      setRecording(false);
      setError("");
      onSendShortcutChange(next);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onSendShortcutChange, recording, sendShortcut]);

  function reset() {
    setRecording(false);
    setError("");
    setDraft(DEFAULT_SEND_SHORTCUT);
    onSendShortcutChange(DEFAULT_SEND_SHORTCUT);
  }

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">KEYBOARD</span><h2>按键</h2><p>调整消息编辑器中的快捷操作，让发送和换行更符合你的输入习惯。</p></div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>消息编辑器</h3><p>快捷键只在消息输入框获得焦点时生效，不会影响文本中的换行。</p></div></div>
        <div className="settings-preference-list">
          <div className="settings-preference-row keyboard-shortcut-row">
            <span><strong>发送消息</strong><small>发送当前输入内容；处理中的回合也可以继续发送排队或插入消息。</small></span>
            <div className="shortcut-editor">
              <button
                type="button"
                className={recording ? "shortcut-capture recording" : "shortcut-capture"}
                onClick={() => { setRecording(true); setError(""); }}
                aria-label={recording ? "正在录入发送消息快捷键" : `当前发送消息快捷键：${sendShortcut}`}
              >
                {recording ? "请按下快捷键…" : draft}
              </button>
              <button type="button" className="shortcut-reset" onClick={reset} disabled={sendShortcut === "Ctrl+Enter"}>恢复默认</button>
            </div>
          </div>
        </div>
        {error && <p className="shortcut-error" role="alert">{error}</p>}
        <p className="settings-hint">录入时按 Esc 取消。快捷键必须包含 Ctrl、Alt、Shift 或 Meta 中的至少一个修饰键。</p>
      </div>

      <div className="settings-block keyboard-tips-block">
        <div className="settings-block-heading"><div><h3>输入提示</h3><p><kbd>{sendShortcut}</kbd> 发送消息；直接按 Enter 仍会换行。</p></div></div>
      </div>
    </div>
  );
}
