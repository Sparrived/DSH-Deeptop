import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Circle, Minus } from "lucide-react";
import { MarkdownContent } from "../lib/markdown";
import type { DshQuestion } from "../lib/desktop";
import type { PendingQuestion } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { firstUnansweredQuestionIndex } from "../app/ui-model";

type FloatingQuestionCardProps = {
  /** 界面语言：按钮标签与占位文本按语言渲染。 */
  locale?: UiLocale;
  /** 当前 pending 的提问批次；null 时不渲染。 */
  question: PendingQuestion | null;
  /** 每一题的多选答案。 */
  answers: Record<string, string[]>;
  /** 每一题的自定义文本答案。 */
  customAnswers: Record<string, string>;
  onToggleAnswer: (questionId: string, value: string, multiSelect: boolean | undefined) => void;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onCopyQuestion: (text: string) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onSubmit: () => void | Promise<void>;
  /**
   * 切换 minimised 状态时由父级持久化保存(可选)。
   * 用于让 deeptop 在用户重启后仍记得上一题的折叠状态。
   * 留空时使用组件本地 useState,刷新后会重置为展开。
   */
  onMinimizedChange?: (minimized: boolean) => void;
};

type Phase = "expanded" | "minimized";

function parseRecommendedLabel(label: string) {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? { label: label.replace(suffix, ""), recommended: true }
    : { label, recommended: false };
}

function QuestionBody({
  item,
  multiSelectOverride,
  answers,
  customAnswers,
  onToggleAnswer,
  onCustomAnswerChange,
  onCopyQuestion,
  locale,
}: {
  item: DshQuestion;
  multiSelectOverride: boolean | undefined;
  answers: Record<string, string[]>;
  customAnswers: Record<string, string>;
  onToggleAnswer: FloatingQuestionCardProps["onToggleAnswer"];
  onCustomAnswerChange: FloatingQuestionCardProps["onCustomAnswerChange"];
  onCopyQuestion: FloatingQuestionCardProps["onCopyQuestion"];
  locale: UiLocale;
}) {
  const hasOptions = (item.options ?? []).length > 0;
  return (
    <div className="floating-question-body" data-question-id={item.id}>
      <div className="floating-question-prompt">
        <strong>{item.header || t("interaction.defaultQuestionTitle", locale)}</strong>
        <p>{item.question}</p>
        <button type="button" className="floating-question-copy" onClick={() => void onCopyQuestion(item.question)}>{t("common.copy", locale)}</button>
        {item.detail && <div className="question-detail"><MarkdownContent text={item.detail} locale={locale} /></div>}
      </div>
      {hasOptions && (
        <div className="question-options">
          {(item.options ?? []).map((option: { label: string; description?: string }) => {
            const checked = (item.multiSelect === true || !customAnswers[item.id]?.trim()) && (answers[item.id] ?? []).includes(option.label);
            const display = parseRecommendedLabel(option.label);
            return (
              <button type="button" className={checked ? "checked" : ""} key={option.label} onClick={() => onToggleAnswer(item.id, option.label, multiSelectOverride)}>
                <span aria-hidden="true">{checked ? <Check /> : <Circle />}</span>
                <span className="question-option-copy"><strong>{display.label}</strong>{option.description && <small>{option.description}</small>}{display.recommended && <small className="recommended">{t("interaction.recommended", locale)}</small>}</span>
              </button>
            );
          })}
        </div>
      )}
      {hasOptions ? (
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
  );
}

/**
 * 浮动问题卡片 + 卵石 (pebble) 收起态。
 *
 * 把 ask-user 提问从对话流底部搬到右下角的固定层,conversation
 * 列不再被它顶上去;卵石是一颗小药丸,在卡片被收起时留在同一
 * 锚点,显示「待回答 i/N」与柔和的脉动圆点,点击即展开。卡片
 * 与卵石互斥存在,锚点保持不动。
 *
 * - `aria-expanded` 反映 !minimized
 * - 卵石的 `aria-label` 是 nav.pebble,是唯一的展开入口
 * - 切换 minimize 时父级 onMinimizedChange(可选)用于持久化
 * - 卡片正文用 data-question-scroll + key="body-<index>" 在
 *   index 变化时重挂,触发 CSS keyframe 的 slide+fade 过渡;
 *   prefers-reduced-motion 用户看不到该过渡
 */
export function FloatingQuestionCard({
  locale = "zh",
  question,
  answers,
  customAnswers,
  onToggleAnswer,
  onCustomAnswerChange,
  onCopyQuestion,
  onCancel,
  onSubmit,
  onMinimizedChange,
}: FloatingQuestionCardProps) {
  const [phase, setPhase] = useState<Phase>("expanded");

  // pending 批次切换 / 重新打开时强制重置为展开
  useEffect(() => {
    if (question) {
      setPhase("expanded");
    }
  }, [question?.rpcId, question?.questions[0]?.id]);

  const items = question?.questions ?? [];
  const total = items.length;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [question?.rpcId, question?.questions[0]?.id]);

  // 防止 index 越界
  const safeIndex = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const current = items[safeIndex];

  const isMulti = current?.multiSelect;
  const isLast = safeIndex >= total - 1;
  const summary = useMemo(
    () => (total > 0 ? t("interaction.pebble.summary", locale, { index: safeIndex + 1, total }) : ""),
    [locale, safeIndex, total],
  );

  if (!question || !current) return null;

  function setMinimized(next: Phase) {
    setPhase(next);
    onMinimizedChange?.(next === "minimized");
  }

  function goPrev() {
    if (safeIndex > 0) setIndex(safeIndex - 1);
  }
  function goNext() {
    if (safeIndex < total - 1) setIndex(safeIndex + 1);
  }
  function submit() {
    const unanswered = firstUnansweredQuestionIndex(items, answers, customAnswers);
    if (unanswered !== -1) {
      setIndex(unanswered);
      return;
    }
    void onSubmit();
  }

  // 单选 + 选项数 == 1 + 没自定义文本 → 自动跳下一题
  // 保持原 InteractionPanel 的 auto-advance 行为(多选不自动跳)
  function handleSingleToggle(qid: string, value: string) {
    onToggleAnswer(qid, value, isMulti);
    if (isMulti === false) {
      // 单选模式
      if (!isLast) goNext();
    }
  }

  const ariaExpanded = phase === "expanded";

  return (
    <div className="floating-question-anchor">
      {phase === "expanded" && (
        <div
          className="floating-question-card"
          role="dialog"
          aria-label={t("interaction.defaultQuestionTitle", locale)}
          aria-expanded={ariaExpanded}
        >
          <div className="floating-question-header">
            <span className="floating-question-progress">{summary}</span>
            <button
              type="button"
              className="floating-question-minimize"
              onClick={() => setMinimized("minimized")}
              aria-label={t("interaction.nav.minimize", locale)}
              title={t("interaction.nav.minimize", locale)}
            ><Minus aria-hidden="true" /></button>
            <button
              type="button"
              className="floating-question-cancel"
              onClick={() => void onCancel()}
            >{t("common.cancel", locale)}</button>
          </div>
          {/* key="body-<index>" 强制在 index 变化时重挂,触发 slide+fade */}
          <div
            key={`body-${safeIndex}`}
            className="floating-question-scroll"
            data-question-scroll
            data-index={safeIndex}
          >
            <QuestionBody
              item={current}
              multiSelectOverride={isMulti}
              answers={answers}
              customAnswers={customAnswers}
              onToggleAnswer={handleSingleToggle}
              onCustomAnswerChange={onCustomAnswerChange}
               onCopyQuestion={onCopyQuestion}
              locale={locale}
            />
          </div>
          <div className="floating-question-footer">
            <div className="floating-question-nav">
              <button type="button" onClick={goPrev} disabled={safeIndex === 0}><ChevronLeft aria-hidden="true" /></button>
              <span>{safeIndex + 1}/{total}</span>
              <button type="button" onClick={goNext} disabled={isLast}><ChevronRight aria-hidden="true" /></button>
            </div>
            <div className="floating-question-actions">
              <button type="button" className="confirm" onClick={submit}>{t("interaction.submitAnswer", locale)}</button>
            </div>
          </div>
        </div>
      )}
      {phase === "minimized" && (
        <button
          type="button"
          className="question-pebble"
          onClick={() => setMinimized("expanded")}
          aria-label={t("interaction.nav.pebble", locale)}
          title={t("interaction.nav.pebble", locale)}
        >
          <span className="question-pebble-dot" aria-hidden="true" />
          <span className="question-pebble-label">{summary}</span>
        </button>
      )}
    </div>
  );
}
