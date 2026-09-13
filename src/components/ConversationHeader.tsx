import { useState } from "react";
import { Plus } from "lucide-react";
import type { DshGoalProjection, DshPreset, DshSessionSummary } from "../lib/desktop";
import { displayTitle, presetDisplayName } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { CurrentGoalBar } from "./CurrentGoalBar";

type ConversationHeaderProps = {
  /** 界面语言：标题与操作按钮文案按语言渲染。 */
  locale?: UiLocale;
  activeSession: DshSessionSummary | null | undefined;
  presets: DshPreset[];
  runtimeDirectory: string;
  notice: string;
  noticeIsError: boolean;
  queueCount: number;
  activeGoal: DshGoalProjection["goal"] | null;
  goalRoundsStarted: number;
  goalCollapsed: boolean;
  goalBusy: boolean;
  /** 只有对话页显示 Goal 状态条与创建入口。 */
  conversationPageActive: boolean;
  trajectoryOpen: boolean;
  sessionDashboardOpen: boolean;
  onOpenGoal: () => void;
  onToggleGoalCollapsed: () => void;
  onToggleGoalPhase: () => void;
  onToggleTrajectory: () => void;
  onToggleSessionDashboard: () => void;
};

export function ConversationHeader({
  locale = "zh",
  activeSession,
  presets,
  runtimeDirectory,
  notice,
  noticeIsError,
  queueCount,
  activeGoal,
  goalRoundsStarted,
  goalCollapsed,
  goalBusy,
  conversationPageActive,
  trajectoryOpen,
  sessionDashboardOpen,
  onOpenGoal,
  onToggleGoalCollapsed,
  onToggleGoalPhase,
  onToggleTrajectory,
  onToggleSessionDashboard,
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
        <div className="conversation-title-row">
          <span className="conversation-title" title={activeSession ? displayTitle(activeSession, locale) : t("header.sessionAfterMessage", locale)}>
            {activeSession ? displayTitle(activeSession, locale) : t("header.newSession", locale)}
          </span>
          <span className="conversation-subtitle">{presetDisplayName(activeSession?.agentPreset, presets, locale)} · {activeSession?.cwd || runtimeDirectory || t("header.waitingForRuntime", locale)}</span>
        </div>
        <CurrentGoalBar
          locale={locale}
          activeGoal={activeGoal}
          roundsStarted={goalRoundsStarted}
          collapsed={goalCollapsed}
          busy={goalBusy}
          onOpen={onOpenGoal}
          onToggleCollapsed={onToggleGoalCollapsed}
          onTogglePhase={onToggleGoalPhase}
        />
        {conversationPageActive && !activeGoal && <button
          type="button"
          className="current-goal-create"
          onClick={onOpenGoal}
          title={t("goal.createFirst", locale)}
        ><Plus aria-hidden="true" />{t("goal.create", locale)}</button>}
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
        {queueCount > 0 && <span className="queue-count" key={queueCount}>{t("header.queueCount", locale, { count: queueCount })}</span>}
        {activeSession && <>
          <button className={"header-action trajectory-toggle" + (trajectoryOpen ? " selected" : "")} onClick={onToggleTrajectory} title={t("header.trajectoryTitle", locale)} aria-pressed={trajectoryOpen}>{t("header.trajectory", locale)}</button>
          <button className={"header-action session-dashboard-toggle" + (sessionDashboardOpen ? " selected" : "")} onClick={onToggleSessionDashboard} title={t("header.sessionDashboardTitle", locale)} aria-pressed={sessionDashboardOpen}>{t("header.sessionDashboard", locale)}</button>
        </>}
      </div>
    </header>
  );
}
