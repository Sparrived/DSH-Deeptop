import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, Paperclip, Send, Square, X } from "lucide-react";
import { imageDataUrl } from "../app/image-preview-model";
import { shortcutMatches, type SendShortcut } from "../app/keyboard-shortcut";
import { resolveSubmitMode } from "../app/submit-mode";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { ComposerCandidates } from "./ComposerCandidates";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import type { ComposerAttachment, ComposerCandidate, ComposerTrigger, ModelMenuPane, PromptMode, SessionStats } from "../app/model";
import { planEffectiveTarget } from "../app/ui-model";
import { t, type UiLocale } from "../app/i18n";
import type { DshModel, DshPermissionSelect, DshPlanProjection, DshSessionModels } from "../lib/desktop";
import { StatsPills } from "./StatsPills";

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
  selectedModelLabel?: string;
  selectedReasoning?: NonNullable<DshModel["reasoning"]>;
  selectedReasoningEffort?: string;
  selectedReasoningLabel?: string;
  reasoningChoices: ReasoningChoice[];
  modelMenuOpen: boolean;
  modelMenuPane: ModelMenuPane;
  sessionStats: SessionStats;
  sessionRunningMs: number;
  /** 打开完整会话看板；统计胶囊弹窗以此为出口。 */
  onOpenSessionDashboard?: () => void;
  sendShortcut: SendShortcut;
  /** Native OS drag is hovering this composer; highlights the drop target. */
  dropActive?: boolean;
  /** Official plan-mode projection; renders the input-area chip while active. */
  plan?: DshPlanProjection | null;
  /** Fixed session tools rendered beside the composer on desktop. */
  utilityPanel?: ReactNode;
  onExitPlan: () => void | Promise<unknown>;
  /** 界面语言：placeholder 与操作按钮按语言渲染。 */
  locale: UiLocale;
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
  selectedModelLabel,
  selectedReasoning,
  selectedReasoningEffort,
  selectedReasoningLabel,
  reasoningChoices,
  modelMenuOpen,
  modelMenuPane,
  sessionStats,
  sessionRunningMs,
  onOpenSessionDashboard,
  sendShortcut,
  dropActive,
  plan,
  utilityPanel,
  onExitPlan,
  locale,
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
  // 待发送图片的快速预览：与统计胶囊共用「锚点 + 视口钳制」的浮动弹窗座位。
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<{ x: number; y: number } | null>(null);
  const attachmentsRef = useRef<HTMLDivElement | null>(null);
  const { menuRef: previewRef, menuAt: previewAt } = useFloatingMenuPosition(previewAnchor);
  const previewAttachment = attachments.find((attachment) => attachment.id === previewId) ?? null;

  // The upward picker records the preference; this is what the gesture actually
  // delivers, resolved by the same rule the submission itself uses. While a turn
  // is running the send button carries the resolved delivery as its visible
  // state, except on a `/` command line: that gesture executes a command
  // instead of queueing or inserting a message.
  const submitMode = resolveSubmitMode(promptMode, activeRunning);
  const showSendMode = activeRunning && !composer.trimStart().startsWith("/");
  const sendLabel = showSendMode
    ? (submitMode === "steer" ? t("composer.steerLabel", locale) : t("composer.queueLabel", locale))
    : t("composer.send", locale);

  useEffect(() => {
    if (!modeMenuOpen) return;
    // The picker only exists while a running turn can be queued or inserted
    // into; the preference survives the turn, an open menu must not.
    if (!showSendMode) {
      setModeMenuOpen(false);
      return;
    }
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
  }, [modeMenuOpen, showSendMode]);

  // 预览跟随附件：移除或发送后附件消失，弹窗不能留在原地。
  useEffect(() => {
    if (previewId === null) return;
    if (!attachments.some((attachment) => attachment.id === previewId)) setPreviewId(null);
  }, [attachments, previewId]);

  useEffect(() => {
    if (previewId === null) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && (attachmentsRef.current?.contains(event.target) || previewRef.current?.contains(event.target))) return;
      setPreviewId(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPreviewId(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewId, previewRef]);

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
    <div className="composer-workbench">
      {attachments.length > 0 && <div className="composer-attachments" role="group" aria-label={t("composer.attachmentsAria", locale)} ref={attachmentsRef} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        {attachments.map((attachment) => {
          const active = previewId === attachment.id;
          return <div className={"composer-attachment" + (active ? " composer-attachment-previewing" : "")} key={attachment.id}>
            <button
              className="composer-attachment-open"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={active}
              title={t("composer.previewAttachment", locale)}
              aria-label={t("composer.previewAttachmentAria", locale, { name: attachment.name })}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setPreviewAnchor({ x: rect.left, y: rect.top });
                setPreviewId(active ? null : attachment.id);
              }}
            >
              <img src={imageDataUrl(attachment.mediaType, attachment.data)} alt={attachment.name} />
              <span title={attachment.name}>{attachment.name}</span>
            </button>
            <button className="composer-attachment-remove" type="button" onClick={() => onRemoveAttachment(attachment.id)} title={t("composer.removeAttachment", locale)} aria-label={t("composer.removeAttachmentAria", locale, { name: attachment.name })}><X aria-hidden="true" /></button>
          </div>;
        })}
      </div>}
      <div className={"composer-shell" + (dropActive ? " composer-drop-active" : "")} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <input ref={attachmentInputRef} className="composer-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { void onAddFiles(event.target.files ?? []); event.currentTarget.value = ""; }} />
      <textarea
        ref={composerRef}
        value={composer}
        onChange={(event) => onComposerChange(event.target.value)}
        onPaste={onPaste}
        onKeyDown={handleKeyDown}
        placeholder={planEffectiveTarget(plan) ? t("composer.planPlaceholder", locale) : activeRunning ? t("composer.queueOrInsertPlaceholder", locale) : t("composer.placeholder", locale)}
        rows={3}
        disabled={!runtimeAvailable}
        aria-controls={candidates.length > 0 && !candidatesDismissed ? "composer-candidates" : undefined}
        aria-activedescendant={candidates.length > 0 && !candidatesDismissed ? "composer-candidate-" + activeCandidateIndex : undefined}
      />
      {planEffectiveTarget(plan) && <div className="composer-plan-chip" role="status" aria-label={t("composer.planActiveAria", locale)}>
        <span className="composer-plan-chip-label">Plan</span>
        <span className="composer-plan-chip-note">{t("composer.planChipNote", locale)}</span>
        <button type="button" className="composer-plan-chip-exit" onClick={() => void onExitPlan()} title={t("composer.planExitTitle", locale)} aria-label={t("composer.planExitAria", locale)}><X aria-hidden="true" /></button>
      </div>}
      <ComposerCandidates
        locale={locale}
        candidates={candidates}
        triggerKind={triggerKind}
        dismissed={candidatesDismissed}
        activeIndex={activeCandidateIndex}
        onChoose={onChooseCandidate}
      />
      <div className="composer-controls">
        <div className="composer-left">
          <button className="attachment-button" type="button" onClick={() => attachmentInputRef.current?.click()} title={t("composer.attach", locale)}><Paperclip aria-hidden="true" /> {t("composer.attachLabel", locale)}{attachments.length > 0 ? " " + attachments.length : ""}</button>
          {permissions && <PermissionPicker permissions={permissions} onSetPermission={onSetPermission} showLabel locale={locale} />}
        </div>
        <div className="composer-right">
          {models ? <ModelPicker
            models={models}
            menuRef={modelMenuRef}
            selectedModelValue={selectedModelValue}
            selectedModelLabel={selectedModelLabel}
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
            <button className="model-picker-trigger model-picker-placeholder" type="button" disabled title={t("composer.modelPlaceholderTitle", locale)} aria-label={t("composer.modelDefaultAria", locale, { name: defaultModelName })}>
              <span className="model-picker-label">{defaultModelName}</span>
              <span className="model-picker-chevron" aria-hidden="true"><ChevronDown /></span>
            </button>
          </div>}
          <div className={"send-group" + (showSendMode ? " send-group-mode" : "")}>
            <button
              className="send-button"
              type="button"
              onClick={onAction}
              disabled={(!composer.trim() && attachments.length === 0) || loading || !runtimeAvailable}
              aria-label={sendLabel}
              title={`${sendLabel}（${sendShortcut}）`}
            >
              <Send aria-hidden="true" />
              {showSendMode && <span className="send-button-mode-label">{sendLabel}</span>}
            </button>
            {showSendMode && <div className="mode-picker" ref={modeMenuRef}>
              <button
                className="mode-picker-trigger"
                type="button"
                aria-label={t("composer.pickSendModeAria", locale)}
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
                title={promptMode === "queue" ? t("composer.queueTitle", locale) : t("composer.steerTitle", locale)}
                onClick={() => setModeMenuOpen((open) => !open)}
              >
                <ChevronUp aria-hidden="true" />
              </button>
              {modeMenuOpen && <div className="mode-menu" role="menu" aria-label={t("composer.modeMenuAria", locale)}>
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
                    <span className="mode-menu-option-label">{mode === "queue" ? t("composer.queueLabel", locale) : t("composer.steerLabel", locale)}</span>
                    <span className="mode-menu-check" aria-hidden="true">{selected && <Check />}</span>
                  </button>;
                })}
              </div>}
            </div>}
          </div>
          {activeRunning && <button
            className="stop-button"
            type="button"
            onClick={onCancel}
            disabled={!activeSessionId}
            aria-label={t("composer.stop", locale)}
            title={t("composer.stop", locale)}
          >
            <Square aria-hidden="true" />
          </button>}
        </div>
      </div>
      </div>
      {utilityPanel}
    </div>
    <StatsPills sessionStats={sessionStats} sessionRunningMs={sessionRunningMs} locale={locale} onOpenDashboard={onOpenSessionDashboard} />
    {previewAttachment && previewAnchor && createPortal(
      <div
        ref={previewRef}
        className="attachment-preview"
        role="dialog"
        aria-label={t("composer.previewAttachmentAria", locale, { name: previewAttachment.name })}
        style={{ left: previewAt?.left ?? previewAnchor.x, top: previewAt?.top ?? previewAnchor.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <img src={imageDataUrl(previewAttachment.mediaType, previewAttachment.data)} alt={previewAttachment.name} />
        <div className="attachment-preview-caption">
          <span className="attachment-preview-name" title={previewAttachment.name}>{previewAttachment.name}</span>
          <button type="button" className="attachment-preview-close" onClick={() => setPreviewId(null)} title={t("common.close", locale)} aria-label={t("common.close", locale)}><X aria-hidden="true" /></button>
        </div>
      </div>,
      document.body,
    )}
  </footer>;
}
