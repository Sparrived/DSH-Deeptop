import { MarkdownContent } from "../lib/markdown";
import type { PendingApproval, PendingQuestion } from "../app/model";

type ApprovalOutcome = "allowed-once" | "rejected";

function parseRecommendedLabel(label: string) {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? { label: label.replace(suffix, ""), recommended: true }
    : { label, recommended: false };
}

type InteractionPanelProps = {
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  answers: Record<string, string[]>;
  customAnswers: Record<string, string>;
  onApproval: (outcome: ApprovalOutcome) => void | Promise<void>;
  onToggleAnswer: (questionId: string, value: string, multiSelect: boolean | undefined) => void;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onCancelQuestion: () => void | Promise<void>;
  onSubmitQuestion: () => void | Promise<void>;
};

export function InteractionPanel({
  approval,
  question,
  answers,
  customAnswers,
  onApproval,
  onToggleAnswer,
  onCustomAnswerChange,
  onCancelQuestion,
  onSubmitQuestion,
}: InteractionPanelProps) {
  if (!approval && !question) return null;

  return (
    <section className="interaction-panel">
      {approval && (
        <div className="approval-request">
          <div><strong>需要确认</strong><span>{approval.toolName}</span><p>{approval.reason || "Agent 请求执行此工具。"}</p></div>
          <div className="interaction-actions"><button onClick={() => void onApproval("rejected")}>拒绝</button><button className="confirm" onClick={() => void onApproval("allowed-once")}>允许一次</button></div>
        </div>
      )}
      {question && (
        <div className="question-request">
          {question.questions.map((item) => (
            <div className="question-item" key={item.id}>
              <strong>{item.header || "Agent 的问题"}</strong><p>{item.question}</p>
              {item.detail && <div className="question-detail"><MarkdownContent text={item.detail} /></div>}
              {(item.options ?? []).length > 0 && (
                <div className="question-options">
                  {(item.options ?? []).map((option) => {
                    const checked = (item.multiSelect === true || !customAnswers[item.id]?.trim()) && (answers[item.id] ?? []).includes(option.label);
                    const display = parseRecommendedLabel(option.label);
                    return <button className={checked ? "checked" : ""} key={option.label} onClick={() => onToggleAnswer(item.id, option.label, item.multiSelect)}>
                      <span>{checked ? "✓" : "○"}</span>
                      <span className="question-option-copy"><strong>{display.label}</strong>{option.description && <small>{option.description}</small>}{display.recommended && <small className="recommended">推荐</small>}</span>
                    </button>;
                  })}
                </div>
              )}
              {(item.options ?? []).length > 0 ? (
                <input
                  className="question-custom-answer question-custom-input"
                  value={customAnswers[item.id] ?? ""}
                  onChange={(event) => onCustomAnswerChange(item.id, event.target.value)}
                  placeholder="输入自定义回答"
                  aria-label={`${item.header || item.question} 自定义回答`}
                />
              ) : (
                <textarea
                  className="question-custom-answer"
                  value={customAnswers[item.id] ?? ""}
                  onChange={(event) => onCustomAnswerChange(item.id, event.target.value)}
                  placeholder="输入自定义回答"
                  aria-label={`${item.header || item.question} 自定义回答`}
                />
              )}
            </div>
          ))}
          <div className="interaction-actions"><button onClick={() => void onCancelQuestion()}>取消</button><button className="confirm" onClick={() => void onSubmitQuestion()}>提交回答</button></div>
        </div>
      )}
    </section>
  );
}
