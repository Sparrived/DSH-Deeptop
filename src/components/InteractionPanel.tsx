import { MarkdownContent } from "../lib/markdown";
import { planReviewOf, type PlanReviewQuestion } from "../app/ui-model";
import type { PendingApproval, PendingQuestion } from "../app/model";
import { displayToolName } from "../app/tool-call-display";
import { t, type UiLocale } from "../app/i18n";

type ApprovalOutcome = "allowed-once" | "rejected";

type InteractionPanelProps = {
  /** 界面语言：确认/提问面板文案按语言渲染。 */
  locale?: UiLocale;
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  answers: Record<string, string[]>;
  customAnswers: Record<string, string>;
  onApproval: (outcome: ApprovalOutcome) => void | Promise<void>;
  /** @deprecated ask-user 提问由 FloatingQuestionCard 渲染,不再内联在这里。保留参数是为了不破坏现有调用点。 */
  onToggleAnswer?: (questionId: string, value: string, multiSelect: boolean | undefined) => void;
  /** @deprecated ask-user 提问由 FloatingQuestionCard 渲染。 */
  onCustomAnswerChange?: (questionId: string, value: string) => void;
  /** @deprecated ask-user 提问由 FloatingQuestionCard 渲染。 */
  onCancelQuestion?: () => void | Promise<void>;
  /** @deprecated ask-user 提问由 FloatingQuestionCard 渲染。 */
  onSubmitQuestion?: () => void | Promise<void>;
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
  onApproval,
  onCancelQuestion,
  onPlanReview,
}: InteractionPanelProps) {
  const planReview = question ? planReviewOf(question.questions) : null;
  // 普通 ask-user 提问由 FloatingQuestionCard 浮层渲染，这里只剩 approval 与
  // plan-review 两种内联内容。两者都没有时整块不渲染：空面板会在发送框与提问
  // 弹层之间压出一条不透明空条(自定义背景图下尤其明显)。
  if (!approval && !(planReview && onCancelQuestion)) return null;

  return (
    <section className="interaction-panel">
      {approval && (
        <div className="approval-request">
          <div><strong>{t("interaction.requiresApproval", locale)}</strong><span>{displayToolName(approval.toolName)}</span><p>{approval.reason || t("interaction.defaultReason", locale)}</p></div>
          <div className="interaction-actions"><button onClick={() => void onApproval("rejected")}>{t("interaction.reject", locale)}</button><button className="confirm" onClick={() => void onApproval("allowed-once")}>{t("interaction.allowOnce", locale)}</button></div>
        </div>
      )}
      {/* ask-user 提问由 FloatingQuestionCard 浮层渲染(右下角,不再占对话流)。
         这里仅保留 plan-review(单决策单计划的 shape)内联显示。 */}
      {planReview && onCancelQuestion && (
        <PlanReviewPanel review={planReview} locale={locale} onReview={(label) => void onPlanReview(planReview, label)} onDiscuss={onCancelQuestion} />
      )}
    </section>
  );
}
