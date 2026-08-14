import { useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { ComposerCandidates } from "./ComposerCandidates";
import { ModelPicker } from "./ModelPicker";
import type { ComposerAttachment, ComposerCandidate, ComposerTrigger, ModelMenuPane, PromptMode, SessionStats } from "../app/model";
import { contextPercent, formatTokens } from "../app/model";
import type { DshModel, DshSessionModels } from "../lib/desktop";

type ReasoningChoice = {
  key: string;
  id?: string;
  name: string;
  description?: string;
};

interface ComposerShellProps {
  runtimeAvailable: boolean;
  activeRunning: boolean;
  activeSessionId: string | null;
  hasActiveSession: boolean;
  loading: boolean;
  composer: string;
  attachments: ComposerAttachment[];
  promptMode: PromptMode;
  candidates: ComposerCandidate[];
  triggerKind?: ComposerTrigger["kind"];
  candidatesDismissed: boolean;
  activeCandidateIndex: number;
  models: DshSessionModels | null;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  selectedModelValue: string;
  selectedModelName?: string;
  selectedReasoning?: NonNullable<DshModel["reasoning"]>;
  selectedReasoningEffort?: string;
  selectedReasoningLabel?: string;
  reasoningChoices: ReasoningChoice[];
  modelMenuOpen: boolean;
  modelMenuPane: ModelMenuPane;
  sessionStats: SessionStats;
  workspaceLabel: string;
  onComposerChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onAddFiles: (files: FileList | File[]) => void | Promise<unknown>;
  onRemoveAttachment: (attachmentId: string) => void;
  onSetPromptMode: (mode: PromptMode) => void;
  onChooseCandidate: (candidate: ComposerCandidate) => void;
  onSetCandidateIndex: (index: number) => void;
  onDismissCandidates: () => void;
  onAction: () => void;
  onToggleModelMenu: () => void;
  onSetModelPane: (pane: ModelMenuPane) => void;
  onChangeModel: (value: string) => void | Promise<void>;
  onChangeReasoningEffort: (value?: string) => void | Promise<void>;
}

export function ComposerShell({
  runtimeAvailable,
  activeRunning,
  activeSessionId,
  hasActiveSession,
  loading,
  composer,
  attachments,
  promptMode,
  candidates,
  triggerKind,
  candidatesDismissed,
  activeCandidateIndex,
  models,
  modelMenuRef,
  selectedModelValue,
  selectedModelName,
  selectedReasoning,
  selectedReasoningEffort,
  selectedReasoningLabel,
  reasoningChoices,
  modelMenuOpen,
  modelMenuPane,
  sessionStats,
  workspaceLabel,
  onComposerChange,
  onPaste,
  onAddFiles,
  onRemoveAttachment,
  onSetPromptMode,
  onChooseCandidate,
  onSetCandidateIndex,
  onDismissCandidates,
  onAction,
  onToggleModelMenu,
  onSetModelPane,
  onChangeModel,
  onChangeReasoningEffort,
}: ComposerShellProps) {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void onAddFiles(event.dataTransfer.files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (candidates.length > 0 && !candidatesDismissed) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        onSetCandidateIndex((activeCandidateIndex + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onSetCandidateIndex((activeCandidateIndex - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDismissCandidates();
        return;
      }
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        onChooseCandidate(candidates[activeCandidateIndex]);
        return;
      }
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onAction();
    }
  }

  return <footer className="composer-area">
    <div className="composer-shell" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <input ref={attachmentInputRef} className="composer-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { void onAddFiles(event.target.files ?? []); event.currentTarget.value = ""; }} />
      <textarea
        value={composer}
        onChange={(event) => onComposerChange(event.target.value)}
        onPaste={onPaste}
        onKeyDown={handleKeyDown}
        placeholder={activeRunning ? "输入要排队或插入当前回合的内容" : "输入消息，开始与 DSH 对话"}
        rows={3}
        disabled={!runtimeAvailable}
        aria-controls={candidates.length > 0 && !candidatesDismissed ? "composer-candidates" : undefined}
        aria-activedescendant={candidates.length > 0 && !candidatesDismissed ? "composer-candidate-" + activeCandidateIndex : undefined}
      />
      {attachments.length > 0 && <div className="composer-attachments" aria-label="待发送图片">
        {attachments.map((attachment) => (
          <div className="composer-attachment" key={attachment.id}>
            <img src={"data:" + attachment.mediaType + ";base64," + attachment.data} alt={attachment.name} />
            <span title={attachment.name}>{attachment.name}</span>
            <button type="button" onClick={() => onRemoveAttachment(attachment.id)} title="移除图片" aria-label={"移除 " + attachment.name}>×</button>
          </div>
        ))}
      </div>}
      <ComposerCandidates
        candidates={candidates}
        triggerKind={triggerKind}
        dismissed={candidatesDismissed}
        activeIndex={activeCandidateIndex}
        onChoose={onChooseCandidate}
      />
      <div className="composer-controls">
        <div className="composer-left">
          <button className="attachment-button" type="button" onClick={() => attachmentInputRef.current?.click()} title="添加图片附件">＋ 图片{attachments.length > 0 ? " " + attachments.length : ""}</button>
          <button className={"mode-button " + (promptMode === "queue" ? "selected" : "")} onClick={() => onSetPromptMode("queue")} title="将消息排入当前会话">排队</button>
          <button className={"mode-button " + (promptMode === "steer" ? "selected" : "")} onClick={() => onSetPromptMode("steer")} title="插入当前回合">插入</button>
        </div>
        <div className="composer-right">
          {hasActiveSession && models && <ModelPicker
            models={models}
            menuRef={modelMenuRef}
            selectedModelValue={selectedModelValue}
            selectedModelName={selectedModelName}
            selectedReasoning={selectedReasoning}
            selectedReasoningEffort={selectedReasoningEffort}
            selectedReasoningLabel={selectedReasoningLabel}
            reasoningChoices={reasoningChoices}
            menuOpen={modelMenuOpen}
            menuPane={modelMenuPane}
            onToggleMenu={onToggleModelMenu}
            onSetPane={onSetModelPane}
            onChangeModel={onChangeModel}
            onChangeReasoningEffort={onChangeReasoningEffort}
          />}
          <button
            className={activeRunning ? "stop-button" : "send-button"}
            onClick={onAction}
            disabled={activeRunning ? !activeSessionId : (!composer.trim() && attachments.length === 0) || loading || !runtimeAvailable}
            title={activeRunning ? "停止当前回合" : "发送消息"}
          >
            {activeRunning ? "停止" : "发送"}
          </button>
        </div>
      </div>
    </div>
    <div className="composer-stats" title={sessionStats.contextLimit ? "上下文 " + formatTokens(sessionStats.contextTokens) + " / " + formatTokens(sessionStats.contextLimit) : "当前模型未返回上下文窗口上限；使用量仍按请求统计。"}>
      <span className="context-meter" aria-label="上下文使用量"><i style={{ width: String(contextPercent(sessionStats)) + "%" }} /></span>
      <span>上下文 {formatTokens(sessionStats.contextTokens)}{sessionStats.contextLimit ? " / " + formatTokens(sessionStats.contextLimit) : " · 上限未知"}</span>
      <span title="输入 Token">↓ {formatTokens(sessionStats.inputTokens)}</span>
      <span title="输出 Token">↑ {formatTokens(sessionStats.outputTokens)}</span>
      <span title="缓存命中率">缓存 {sessionStats.cacheHitRate ? String(sessionStats.cacheHitRate.toFixed(0)) + "%" : "—"}</span>
      <span title="首个 Token 延迟">首 T {sessionStats.firstTokenMs ? String(Math.round(sessionStats.firstTokenMs)) + "ms" : "—"}</span>
      <span>{sessionStats.messages} 条消息</span>
    </div>
    <div className="composer-hint">Ctrl / Cmd + Enter 发送 <span>{workspaceLabel}</span></div>
  </footer>;
}
