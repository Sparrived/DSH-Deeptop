import type { FormEvent } from "react";
import type { PetAttention, PetSessionTarget } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

interface PetNoticeCardProps {
  activities: readonly PetAttention[];
  attention?: PetAttention;
  target: PetSessionTarget;
  draft: string;
  busy: boolean;
  error: string | null;
  locale?: UiLocale;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSelect: (activityId: string) => void;
  onOpen: () => void;
  onReply: (text: string) => void;
  onAnswer: (answer: string, selectedOption: boolean) => void;
  onApproval: (allowed: boolean) => void;
  onCare?: () => void;
}

function attentionLabel(attention: PetAttention | undefined, locale: UiLocale): string {
  if (!attention) return t("pet.notice.quickReply", locale);
  if (attention.kind === "approval") return t("pet.notice.awaitingConfirm", locale);
  if (attention.kind === "question") return t("pet.notice.waitingAnswer", locale);
  if (attention.kind === "failed") return t("pet.notice.taskFailed", locale);
  if (attention.kind === "running") return t("pet.notice.running", locale);
  return t("pet.notice.taskCompleted", locale);
}

function activityListLabel(attention: PetAttention, locale: UiLocale): string {
  if (attention.kind === "approval" || attention.kind === "question") return t("pet.notice.needsInput", locale);
  if (attention.kind === "failed") return t("pet.notice.blocked", locale);
  if (attention.kind === "completed") return t("pet.notice.completed", locale);
  return t("pet.notice.inProgress", locale);
}

/** 独立桌宠的紧凑操作卡；仅发出语义动作，不直接调用 DSH。 */
export function PetNoticeCard({
  activities,
  attention,
  target,
  draft,
  busy,
  error,
  locale = "zh",
  onDraftChange,
  onClose,
  onSelect,
  onOpen,
  onReply,
  onAnswer,
  onApproval,
  onCare,
}: PetNoticeCardProps) {
  const isApproval = attention?.kind === "approval";
  const isQuestion = attention?.kind === "question";
  const isRunning = attention?.kind === "running";
  const acceptsText = !attention
    || attention.kind === "completed"
    || attention.kind === "failed"
    || (isQuestion && attention.canReply);
  const waitingCount = activities.filter((item) => item.kind !== "running").length;
  const headerLabel = activities.length > 1
    ? waitingCount > 0 ? t("pet.notice.waitingCount", locale, { count: waitingCount }) : t("pet.notice.runningCount", locale, { count: activities.length })
    : attentionLabel(attention, locale);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value || busy) return;
    if (isQuestion) onAnswer(value, false);
    else onReply(value);
  };

  return (
    <section className="pet-notice-card" aria-live="polite" data-kind={attention?.kind ?? "reply"}>
      <header className="pet-notice-header">
        <span className="pet-notice-status"><i aria-hidden="true" />{headerLabel}</span>
        <span className="pet-notice-header-actions">
          {onCare && <button type="button" className="pet-notice-care-switch" onClick={onCare}>{t("pet.notice.care", locale)}</button>}
          <button type="button" className="pet-notice-close" onClick={onClose} aria-label={t("pet.notice.aria.collapseQuick", locale)}>×</button>
        </span>
      </header>
      {activities.length > 1 && (
        <nav className="pet-activity-list" aria-label={t("pet.notice.aria.activities", locale)}>
          {activities.map((item) => (
            <button
              type="button"
              className={item.id === attention?.id ? "selected" : ""}
              data-kind={item.kind}
              key={item.id}
              onClick={() => onSelect(item.id)}
              disabled={busy}
            >
              <span><i aria-hidden="true" /><strong>{item.title}</strong><small>{activityListLabel(item, locale)}</small></span>
              <em>{item.message}</em>
            </button>
          ))}
        </nav>
      )}
      <button type="button" className="pet-notice-session" onClick={onOpen} disabled={busy}>
        <strong>{target.title}</strong><span>{t("pet.notice.openSession", locale)}</span>
      </button>
      <p className="pet-notice-message">
        {attention?.message ?? t("pet.notice.appendMessageHint", locale)}
      </p>
      {attention?.toolName && <code className="pet-notice-tool">{attention.toolName}</code>}
      {isApproval && (
        <div className="pet-notice-actions pet-notice-approval-actions">
          <button type="button" onClick={() => onApproval(false)} disabled={busy}>{t("pet.notice.skip", locale)}</button>
          <button type="button" className="confirm" onClick={() => onApproval(true)} disabled={busy}>{t("pet.notice.continue", locale)}</button>
        </div>
      )}
      {isQuestion && attention.options.length > 0 && (
        <div className="pet-notice-options">
          {attention.options.map((option) => (
            <button type="button" key={option} onClick={() => onAnswer(option, true)} disabled={busy}>{option}</button>
          ))}
        </div>
      )}
      {acceptsText && (
        <form className="pet-notice-reply" onSubmit={submit}>
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={isQuestion ? t("pet.notice.replyPlaceholder", locale) : t("pet.notice.followupPlaceholder", locale)}
            maxLength={4000}
            rows={2}
            disabled={busy}
            aria-label={isQuestion ? t("pet.notice.aria.quickAnswer", locale) : t("pet.notice.quickReply", locale)}
          />
          <button type="submit" className="confirm" disabled={busy || !draft.trim()}>
            {busy ? t("pet.notice.processing", locale) : isQuestion ? t("pet.notice.answer", locale) : t("pet.notice.send", locale)}
          </button>
        </form>
      )}
      {isQuestion && !attention.canReply && (
        <p className="pet-notice-hint">{t("pet.notice.multiQuestionHint", locale)}</p>
      )}
      {isRunning && <p className="pet-notice-hint">{t("pet.notice.lastReplyHint", locale)}</p>}
      {error && <p className="pet-notice-error">{error}</p>}
    </section>
  );
}
