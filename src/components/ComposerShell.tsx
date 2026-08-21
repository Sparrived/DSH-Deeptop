import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { shortcutMatches, type SendShortcut } from "../app/keyboard-shortcut";
import { ComposerCandidates } from "./ComposerCandidates";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import type { ComposerAttachment, ComposerCandidate, ComposerTrigger, ModelMenuPane, PromptMode, SessionStats } from "../app/model";
import { contextPercent, formatSessionElapsed, formatTokens } from "../app/model";
import type { DshModel, DshPermissionSelect, DshSessionModels } from "../lib/desktop";

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
  defaultModelName: string;
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
  composerRef: RefObject<HTMLTextAreaElement | null>;
  selectedModelValue: string;
  selectedModelName?: string;
  selectedReasoning?: NonNullable<DshModel["reasoning"]>;
  selectedReasoningEffort?: string;
  selectedReasoningLabel?: string;
  reasoningChoices: ReasoningChoice[];
  modelMenuOpen: boolean;
  modelMenuPane: ModelMenuPane;
  sessionStats: SessionStats;
  sessionRunningMs: number;
  sendShortcut: SendShortcut;
  /** Native OS drag is hovering this composer; highlights the drop target. */
  dropActive?: boolean;
  onComposerChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onAddFiles: (files: FileList | File[]) => void | Promise<unknown>;
  onRemoveAttachment: (attachmentId: string) => void;
  permissions: DshPermissionSelect | null;
  onSetPermission: (value: string) => void | Promise<unknown>;
  onSetPromptMode: (mode: PromptMode) => void;
  onChooseCandidate: (candidate: ComposerCandidate) => void;
  onSetCandidateIndex: (index: number) => void;
  onDismissCandidates: () => void;
  onAction: () => void;
  onCancel: () => void;
  onToggleModelMenu: () => void;
  onSetModelPane: (pane: ModelMenuPane) => void;
  onChangeModel: (value: string) => void | Promise<void>;
  onChangeReasoningEffort: (value?: string) => void | Promise<void>;
}

export function ComposerShell({
  runtimeAvailable,
  activeRunning,
  activeSessionId,
  defaultModelName,
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
  composerRef,
  selectedModelValue,
  selectedModelName,
  selectedReasoning,
  selectedReasoningEffort,
  selectedReasoningLabel,
  reasoningChoices,
  modelMenuOpen,
  modelMenuPane,
  sessionStats,
  sessionRunningMs,
  sendShortcut,
  dropActive,
  onComposerChange,
  onPaste,
  onAddFiles,
  onRemoveAttachment,
  permissions,
  onSetPermission,
  onSetPromptMode,
  onChooseCandidate,
  onSetCandidateIndex,
  onDismissCandidates,
  onAction,
  onCancel,
  onToggleModelMenu,
  onSetModelPane,
  onChangeModel,
  onChangeReasoningEffort,
}: ComposerShellProps) {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && modeMenuRef.current?.contains(event.target)) return;
      setModeMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modeMenuOpen]);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void onAddFiles(event.dataTransfer.files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
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
    if (shortcutMatches(event, sendShortcut)) {
      event.preventDefault();
      onAction();
    }
  }

  return <footer className="composer-area">
    <div className={"composer-shell" + (dropActive ? " composer-drop-active" : "")} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <input ref={attachmentInputRef} className="composer-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { void onAddFiles(event.target.files ?? []); event.currentTarget.value = ""; }} />
      <textarea
        ref={composerRef}
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
          {permissions && <PermissionPicker permissions={permissions} onSetPermission={onSetPermission} showLabel />}
          <div className="mode-picker" ref={modeMenuRef}>
            <button
              className="mode-picker-trigger"
              type="button"
              aria-label="选择消息发送方式"
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title={promptMode === "queue" ? "将消息排入当前会话" : "插入当前回合"}
              onClick={() => setModeMenuOpen((open) => !open)}
            >
              <span>{promptMode === "queue" ? "排队" : "插入"}</span>
              <span className="mode-picker-chevron" aria-hidden="true">&gt;</span>
            </button>
            {modeMenuOpen && <div className="mode-menu" role="menu" aria-label="消息发送方式">
              {(["queue", "steer"] as PromptMode[]).map((mode) => {
                const selected = promptMode === mode;
                return <button
                  className={`mode-menu-option${selected ? " selected" : ""}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  key={mode}
                  onClick={() => {
                    onSetPromptMode(mode);
                    setModeMenuOpen(false);
                  }}
                >
                  <span className="mode-menu-option-label">{mode === "queue" ? "排队" : "插入"}</span>
                  <span className="mode-menu-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                </button>;
              })}
            </div>}
          </div>
        </div>
        <div className="composer-right">
          {models ? <ModelPicker
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
          /> : <div className="model-picker">
            <button className="model-picker-trigger model-picker-placeholder" type="button" disabled title="创建会话后可切换模型" aria-label={`当前默认模型：${defaultModelName}`}>
              <span className="model-picker-label">{defaultModelName}</span>
              <span className="model-picker-chevron" aria-hidden="true">v</span>
            </button>
          </div>}
          <button
            className="send-button"
            type="button"
            onClick={onAction}
            disabled={(!composer.trim() && attachments.length === 0) || loading || !runtimeAvailable}
            aria-label="发送消息"
            title={`发送消息（${sendShortcut}）`}
          >
            <span aria-hidden="true">↑</span>
          </button>
          {activeRunning && <button
            className="stop-button"
            type="button"
            onClick={onCancel}
            disabled={!activeSessionId}
            aria-label="取消当前回合"
            title="取消当前回合"
          >
            <span aria-hidden="true">×</span>
          </button>}
        </div>
      </div>
    </div>
    <div className="composer-stats" title={sessionStats.contextTokensAvailable ? (sessionStats.contextLimit ? "下一次请求的上下文估算 " + formatTokens(sessionStats.contextTokens) + " / " + formatTokens(sessionStats.contextLimit) : "已提供上下文使用量，但模型未返回窗口上限。") : "当前模型未返回上下文使用量；累计 Token 不用于推算当前上下文。"}>
      <span className="context-meter" aria-label="上下文使用量"><i style={{ width: String(contextPercent(sessionStats)) + "%" }} /></span>
      <span>上下文 {sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : "未提供"}{sessionStats.contextTokensAvailable && sessionStats.contextLimit ? " / " + formatTokens(sessionStats.contextLimit) : sessionStats.contextTokensAvailable ? " · 上限未知" : ""}</span>
      <span title="输入 Token">↓ {formatTokens(sessionStats.inputTokens)}</span>
      <span title="输出 Token">↑ {formatTokens(sessionStats.outputTokens)}</span>
      <span title="缓存命中率">缓存 {sessionStats.cacheHitRate ? String(sessionStats.cacheHitRate.toFixed(0)) + "%" : "未提供"}</span>
      <span title="会话运行时间">运行 {formatSessionElapsed(sessionRunningMs)}</span>
      <span>{sessionStats.messages} 条消息</span>
    </div>
  </footer>;
}
