import { MarkdownContent } from "../lib/markdown";
import { planReviewOf, type PlanReviewQuestion } from "../app/ui-model";
import type { PendingApproval, PendingQuestion } from "../app/model";
import { t, type UiLocale } from "../app/i18n";

type ApprovalOutcome = "allowed-once" | "rejected";

function parseRecommendedLabel(label: string) {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? { label: label.replace(suffix, ""), recommended: true }
    : { label, recommended: false };
}

type InteractionPanelProps = {
  /** 界面语言：确认/提问面板文案按语言渲染。 */
  locale?: UiLocale;
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  answers: Record<string, string[]>;
  customAnswers: Record<string, string>;
  onApproval: (outcome: ApprovalOutcome) => void | Promise<void>;
  onToggleAnswer: (questionId: string, value: string, multiSelect: boolean | undefined) => void;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onCancelQuestion: () => void | Promise<void>;
  onSubmitQuestion: () => void | Promise<void>;
  /** Resolve a plan-review question by sending the given option label verbatim. */
  onPlanReview: (review: PlanReviewQuestion, label: string) => void | Promise<void>;
};

function PlanReviewPanel({
  review,
  locale,
  onReview,
  onDiscuss,
}: {
  review: PlanReviewQuestion;
  locale: UiLocale;
  onReview: (label: string) => void | Promise<void>;
  onDiscuss: () => void | Promise<void>;
}) {
  return <div className="plan-review-request" data-plan-review-key={review.item.id}>
    <div className="plan-review-head">
      <strong>{review.item.header || "Plan Review"}</strong>
      <span>{t("interaction.plan.pending", locale)}</span>
    </div>
    <p>{review.item.question}</p>
    {review.hasPlan && <div className="plan-review-detail"><MarkdownContent text={review.item.detail ?? ""} locale={locale} /></div>}
    <div className="interaction-actions">
      <button onClick={() => void onDiscuss()}>{t("interaction.plan.discuss", locale)}</button>
      {review.decline && <button onClick={() => void onReview(review.decline!)}>{t("interaction.reject", locale)}</button>}
      <button className="confirm" onClick={() => void onReview(review.approve)}>{t("interaction.confirmExecute", locale)}</button>
    </div>
  </div>;
}

export function InteractionPanel({
  locale = "zh",
  approval,
  question,
  answers,
  customAnswers,
  onApproval,
  onToggleAnswer,
  onCustomAnswerChange,
  onCancelQuestion,
  onSubmitQuestion,
  onPlanReview,
}: InteractionPanelProps) {
  if (!approval && !question) return null;
  const planReview = question ? planReviewOf(question.questions) : null;

  return (
    <section className="interaction-panel">
      {approval && (
        <div className="approval-request">
          <div><strong>{t("interaction.requiresApproval", locale)}</strong><span>{approval.toolName}</span><p>{approval.reason || t("interaction.defaultReason", locale)}</p></div>
          <div className="interaction-actions"><button onClick={() => void onApproval("rejected")}>{t("interaction.reject", locale)}</button><button className="confirm" onClick={() => void onApproval("allowed-once")}>{t("interaction.allowOnce", locale)}</button></div>
        </div>
      )}
      {planReview ? (
        <PlanReviewPanel review={planReview} locale={locale} onReview={(label) => void onPlanReview(planReview, label)} onDiscuss={onCancelQuestion} />
      ) : question && (
        <div className="question-request">
          {question.questions.map((item) => (
            <div className="question-item" key={item.id}>
              <strong>{item.header || t("interaction.defaultQuestionTitle", locale)}</strong><p>{item.question}</p>
              {item.detail && <div className="question-detail"><MarkdownContent text={item.detail} locale={locale} /></div>}
              {(item.options ?? []).length > 0 && (
                <div className="question-options">
                  {(item.options ?? []).map((option) => {
                    const checked = (item.multiSelect === true || !customAnswers[item.id]?.trim()) && (answers[item.id] ?? []).includes(option.label);
                    const display = parseRecommendedLabel(option.label);
                    return <button className={checked ? "checked" : ""} key={option.label} onClick={() => onToggleAnswer(item.id, option.label, item.multiSelect)}>
                      <span>{checked ? "✓" : "○"}</span>
                      <span className="question-option-copy"><strong>{display.label}</strong>{option.description && <small>{option.description}</small>}{display.recommended && <small className="recommended">{t("interaction.recommended", locale)}</small>}</span>
                    </button>;
                  })}
                </div>
              )}
              {(item.options ?? []).length > 0 ? (
                <input
                  className="question-custom-answer question-custom-input"
                  value={customAnswers[item.id] ?? ""}
                  onChange={(event) => onCustomAnswerChange(item.id, event.target.value)}
                  placeholder={t("interaction.customAnswerPlaceholder", locale)}
                  aria-label={t("interaction.customAnswerAria", locale, { title: item.header || item.question })}
                />
              ) : (
                <textarea
                  className="question-custom-answer"
                  value={customAnswers[item.id] ?? ""}
                  onChange={(event) => onCustomAnswerChange(item.id, event.target.value)}
                  placeholder={t("interaction.customAnswerPlaceholder", locale)}
                  aria-label={t("interaction.customAnswerAria", locale, { title: item.header || item.question })}
                />
              )}
            </div>
          ))}
          <div className="interaction-actions"><button onClick={() => void onCancelQuestion()}>{t("common.cancel", locale)}</button><button className="confirm" onClick={() => void onSubmitQuestion()}>{t("interaction.submitAnswer", locale)}</button></div>
        </div>
      )}
    </section>
  );
}
