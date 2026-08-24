import { useState } from "react";
import type { DshPreset, DshSessionSummary } from "../lib/desktop";
import { displayTitle, presetDisplayName } from "../app/model";
import { t, type UiLocale } from "../app/i18n";

type ConversationHeaderProps = {
  /** 界面语言：标题与操作按钮文案按语言渲染。 */
  locale?: UiLocale;
  activeSession: DshSessionSummary | null | undefined;
  presets: DshPreset[];
  runtimeDirectory: string;
  notice: string;
  noticeIsError: boolean;
  queueCount: number;
  trajectoryOpen: boolean;
  tokenUsageOpen: boolean;
  onToggleTrajectory: () => void;
  onToggleTokenUsage: () => void;
};

export function ConversationHeader({
  locale = "zh",
  activeSession,
  presets,
  runtimeDirectory,
  notice,
  noticeIsError,
  queueCount,
  trajectoryOpen,
  tokenUsageOpen,
  onToggleTrajectory,
  onToggleTokenUsage,
}: ConversationHeaderProps) {
  const [noticeCopied, setNoticeCopied] = useState(false);

  const copyNotice = async () => {
    if (!notice) return;
    try {
      await navigator.clipboard.writeText(notice);
      setNoticeCopied(true);
      window.setTimeout(() => setNoticeCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败，不影响主流程。
    }
  };

  return (
    <header className="conversation-header">
      <div className="conversation-heading">
        <span className="conversation-title" title={activeSession ? displayTitle(activeSession, locale) : t("header.sessionAfterMessage", locale)}>
          {activeSession ? displayTitle(activeSession, locale) : t("header.newSession", locale)}
        </span>
        <span className="conversation-subtitle">{presetDisplayName(activeSession?.agentPreset, presets, locale)} · {activeSession?.cwd || runtimeDirectory || t("header.waitingForRuntime", locale)}</span>
      </div>
      <div className="conversation-actions">
        {noticeIsError && notice && (
          <button
            type="button"
            className={`header-notice${noticeCopied ? " copied" : ""}`}
            onClick={() => void copyNotice()}
            title={noticeCopied ? t("header.noticeCopied", locale) : t("header.noticeCopy", locale)}
            aria-label={t("header.noticeCopy", locale)}
          >
            {noticeCopied ? t("header.noticeCopiedShort", locale) : notice}
          </button>
        )}
        {queueCount > 0 && <span className="queue-count">{t("header.queueCount", locale, { count: queueCount })}</span>}
        {activeSession && <>
          <button className={"header-action trajectory-toggle" + (trajectoryOpen ? " selected" : "")} onClick={onToggleTrajectory} title={t("header.trajectoryTitle", locale)} aria-pressed={trajectoryOpen}>{t("header.trajectory", locale)}</button>
          <button className={"header-action token-usage-toggle" + (tokenUsageOpen ? " selected" : "")} onClick={onToggleTokenUsage} title={t("header.tokensTitle", locale)} aria-pressed={tokenUsageOpen}>Token</button>
        </>}
      </div>
    </header>
  );
}
