import type { FormEvent } from "react";
import type { PetAttention, PetSessionTarget } from "../lib/desktop";

interface PetNoticeCardProps {
  activities: readonly PetAttention[];
  attention?: PetAttention;
  target: PetSessionTarget;
  draft: string;
  busy: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSelect: (activityId: string) => void;
  onOpen: () => void;
  onReply: (text: string) => void;
  onAnswer: (answer: string, selectedOption: boolean) => void;
  onApproval: (allowed: boolean) => void;
  onCare?: () => void;
}

function attentionLabel(attention?: PetAttention): string {
  if (!attention) return "快捷回复";
  if (attention.kind === "approval") return "等你确认";
  if (attention.kind === "question") return "等待回答";
  if (attention.kind === "failed") return "任务失败";
  if (attention.kind === "running") return "正在运行";
  return "任务完成";
}

function activityListLabel(attention: PetAttention): string {
  if (attention.kind === "approval" || attention.kind === "question") return "需要输入";
  if (attention.kind === "failed") return "已阻塞";
  if (attention.kind === "completed") return "已完成";
  return "运行中";
}

/** 独立桌宠的紧凑操作卡；仅发出语义动作，不直接调用 DSH。 */
export function PetNoticeCard({
  activities,
  attention,
  target,
  draft,
  busy,
  error,
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
    ? waitingCount > 0 ? `${waitingCount} 个会话待处理` : `${activities.length} 个会话运行中`
    : attentionLabel(attention);
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
          {onCare && <button type="button" className="pet-notice-care-switch" onClick={onCare}>照顾</button>}
          <button type="button" className="pet-notice-close" onClick={onClose} aria-label="收起快捷卡片">×</button>
        </span>
      </header>
      {activities.length > 1 && (
        <nav className="pet-activity-list" aria-label="会话活动">
          {activities.map((item) => (
            <button
              type="button"
              className={item.id === attention?.id ? "selected" : ""}
              data-kind={item.kind}
              key={item.id}
              onClick={() => onSelect(item.id)}
              disabled={busy}
            >
              <span><i aria-hidden="true" /><strong>{item.title}</strong><small>{activityListLabel(item)}</small></span>
              <em>{item.message}</em>
            </button>
          ))}
        </nav>
      )}
      <button type="button" className="pet-notice-session" onClick={onOpen} disabled={busy}>
        <strong>{target.title}</strong><span>打开会话</span>
      </button>
      <p className="pet-notice-message">
        {attention?.message ?? "不用切回主窗口，也可以直接向这个会话追加一条消息。"}
      </p>
      {attention?.toolName && <code className="pet-notice-tool">{attention.toolName}</code>}
      {isApproval && (
        <div className="pet-notice-actions pet-notice-approval-actions">
          <button type="button" onClick={() => onApproval(false)} disabled={busy}>先不用</button>
          <button type="button" className="confirm" onClick={() => onApproval(true)} disabled={busy}>继续</button>
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
            placeholder={isQuestion ? "输入回答…" : "继续追问…"}
            maxLength={4000}
            rows={2}
            disabled={busy}
            aria-label={isQuestion ? "快捷回答" : "快捷回复"}
          />
          <button type="submit" className="confirm" disabled={busy || !draft.trim()}>
            {busy ? "处理中" : isQuestion ? "回答" : "发送"}
          </button>
        </form>
      )}
      {isQuestion && !attention.canReply && (
        <p className="pet-notice-hint">包含多个问题，请打开会话逐项回答。</p>
      )}
      {isRunning && <p className="pet-notice-hint">处理结束后会在这里显示最后一段回复。</p>}
      {error && <p className="pet-notice-error">{error}</p>}
    </section>
  );
}
