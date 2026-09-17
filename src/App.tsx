import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, CheckSquare, ChevronDown, ListTodo, PackageOpen, X } from "lucide-react";
import { type UnlistenFn } from "./lib/desktop";
import { StartupSplash } from "./components/StartupSplash";
import { ConversationTranscript } from "./components/ConversationTranscript";
import { ConversationHeader } from "./components/ConversationHeader";
import { SessionDashboard } from "./components/SessionDashboard";
import { ComposerShell } from "./components/ComposerShell";
import { InteractionPanel } from "./components/InteractionPanel";
import { FloatingQuestionCard } from "./components/FloatingQuestionCard";
import { SettingsAboutPanel } from "./components/SettingsAboutPanel";
import { SettingsAppearancePanel } from "./components/SettingsAppearancePanel";
import { SettingsGeneralPanel } from "./components/SettingsGeneralPanel";
import { SettingsDockPanel } from "./components/SettingsDockPanel";
import { SettingsKeyboardPanel } from "./components/SettingsKeyboardPanel";
import { SettingsLogsPanel } from "./components/SettingsLogsPanel";
import { SettingsModelsPanel } from "./components/SettingsModelsPanel";
import { SchemaFormPanel, type SchemaPathOp } from "./components/SchemaFormPanel";
// @deeptop-pets:start app-settings-import
import { SettingsPetPanel } from "./components/SettingsPetPanel";
// @deeptop-pets:end app-settings-import
import { SettingsPluginsPanel } from "./components/SettingsPluginsPanel";
import { SettingsPresetPanel } from "./components/SettingsPresetPanel";
import { SettingsToolsPanel } from "./components/SettingsToolsPanel";
import { SkillInstallDialog } from "./components/SkillInstallDialog";
import { QueueDock } from "./components/QueueDock";
import { SessionSidebar, type WorkspaceGroup } from "./components/SessionSidebar";
import { SubagentDock } from "./components/SubagentDock";
import { SubagentPanel } from "./components/SubagentPanel";
import { TaskPanel, TodoPanel } from "./components/TodoPanel";
import { WorkspaceFilesPanel } from "./components/WorkspaceFilesPanel";
import { GitDock } from "./components/GitDock";
import { TerminalDock } from "./components/TerminalDock";
import { DeliverablesPanel } from "./components/DeliverablesPanel";
import { GoalSurfacePanel, type GoalAction } from "./components/GoalSurfacePanel";
import { UtilityDockShelf, UtilityPanelEmptyState, type UtilityDockId } from "./components/UtilityDockShelf";
import { WindowChrome } from "./components/WindowChrome";
import { DockSettingsProvider, useDockSettings } from "./app/dock-settings";
import { buildActiveSessionView } from "./app/active-session-view";
import { DOCK_RAIL_DEFAULT_WIDTH, DOCK_RAIL_EMPTY_WIDTH, DOCK_RAIL_STRIP_WIDTH, type DockTab } from "./app/dock-layout";
import { DockRail } from "./components/DockRail";
import { DockTabBody } from "./components/DockTabBody";
import { PopupDialog } from "./components/PopupDialog";
import { PluginInstallDialog, type PluginInstallDraft } from "./components/PluginInstallDialog";
import { useProviderSettings } from "./app/useProviderSettings";
import { readSubagentRouting, subagentRoutingOps, SUBAGENT_MODEL_SELECTION_NS, SUBAGENT_ROUTING_NS, type SubagentRoutingSave } from "./app/subagent-routing-model";
import { PROMPT_INJECTION_NS } from "./app/prompt-injection-model";
import { acceptedSettingsSectionId, isPluginSectionId } from "./app/settings-section-model";
import { useToolSettings } from "./app/useToolSettings";
import { useWindowControls } from "./app/useWindowControls";
import { normalizeWindowBehavior } from "./app/window-behavior";
import { clearQueuedSessionEvents, routeBridgeEvent } from "./app/bridge-event-handler";
import { displayHistoryStartSeq, latestRoundInputIndex, loadCompleteDisplayHistory, mergeDisplayHistory, needsNewestRoundFill } from "./app/display-history";
import { loadedTurnFacts, mergeTurnRailItems, EMPTY_RAIL_ITEMS, type TurnRailItem } from "./app/turn-rail-model";
import { roundActivityLive } from "./app/turn-group-model";
import { emptyGoalBarState, nextGoalBarState } from "./app/goal-bar-state";
import { trackAsyncCleanup } from "./lib/async-cleanup";
import { ImageAttachmentCache } from "./app/image-attachment-cache";
import { BoundedClaimSet } from "./app/bounded-claim-set";
import {
  checkDsh,
  checkForUpdates,
  cancelUpdateCheck,
  DEEPTOP_PROJECT_URL,
  DEEPTOP_VERSION,
  exportRuntimeLogs,
  getRuntimeLogs,
  isTauri,
  listenToDiagnostic,
  listenToNotificationClick,
  listenToTrayNewChat,
  listenToTraySessionOpen,
  listenToRuntimeLog,
  listenToRuntimeStatus,
  listenToUpdateProgress,
  listenToWebviewFileDrop,
  downloadUpdate,
  cancelUpdateDownload,
  launchUpdateInstaller,
  listenToSingleInstance,
  listenToExternalLaunch,
  listPendingExternalLaunches,
  acknowledgePendingExternalLaunch,
  getWindowsContextMenuStatus,
  setWindowsContextMenuEnabled,
  getWindowBehaviorSettings,
  setWindowBehaviorSettings,
  getNetworkProxy,
  setNetworkProxy,
  presentedHost,
  revealInExplorer,
  writeClipboard,
  type DshNetworkProxy,
  type DshEffectiveNetworkProxy,
  resolveWindowClose,
  listPendingWindowClose,
  cancelWindowClose,
  listenToWindowCloseRequested,
  type CloseBehavior,
  type WindowBehaviorSettings,
  openExternalUrl,
  openConnectionUrl,
  openLogsDirectory,
  openNodejsDownload,
  saveExportFile,
  moveExportTempFile,
  pickPluginEntry,
  pickWorkspace,
  readDroppedImage,
  listPendingOpenSessions,
  acknowledgePendingOpenSession,
  updateTraySessionMenu,
  refreshDsh,
  terminateDshProcesses,
  isSessionLogCorruption,
  repairCorruptSession,
  missingAgentPresetInfo,
  type DshBridgeEvent,
  type DshGoalProjection,
  type DshHistoryEntry,
  type DshJob,
  type DshJobOutput,
  type DshCommandDescriptor,
  type DshPluginConfigDescription,
  type DshPluginConfigEntry,
  type DshPluginConfigMutation,
  type DshPluginInventoryEntry,
  type DshPluginInventorySnapshot,
  type DshPermissionSelect,
  type DshPlanProjection,
  type DshPreset,
  type DshPresetRoster,
  type DshQuestion,
  type DshQueueItem,
  type DshSettingsDescription,
  type DshSettingsNamespace,
  type DshProvider,
  type DshSkill,
  type DshFileReferenceCandidate,
  type DshPromptContentPart,
  type DshSessionModels,
  type DshSessionReferenceCandidate,
  type DshSessionPromptPayload,
  type DshSessionSummary,
  type DshStatus,
  type DshRuntimeLog,
  type DshHostCapabilities,
  type ExternalLaunchRequest,
  type WindowsContextMenuStatus,
  type DshSubagentAddress,
  type DshSubagentCatalog,
  type DshWorkspace,
  type PresentedHostInfo,
} from "./lib/desktop";
import { desktopClientRuntime } from "./lib/desktop-client-runtime";
import { desktopRequest, desktopRemoteInvoke } from "./lib/desktop-api";
import { seedBridgeLinkStatus } from "./lib/bridge-link";
import { overlayProjections, sessionProjectionCache } from "./app/projection-cache";
import { historyPageCache, HISTORY_PAGE_SIZE_DEFAULT, ownsHistoryView, type HistoryLatestLoad } from "./app/history-page-cache";
import {
  indexWorkspacesBySessionId,
  reorderWorkspaceProjections,
  sessionsForWorkspace,
  upsertWorkspaceProjection,
  workspaceFromHostEvent,
  workspacePathForSession,
} from "./app/workspace-session-model";

/** 历史向前分页的页大小：更细粒度缓存，避免一次拉取过多造成长页渲染卡顿。 */
const HISTORY_PAGE_SIZE = HISTORY_PAGE_SIZE_DEFAULT;
/**
 * 一次「读取更早消息」最多向前翻的页数：目标是把上一轮的输入补进来，正常一轮
 * 只需 1-5 页；上限只兜住超长轮次，翻不到就交给下一次点击继续（页缓存复用）。
 */
const HISTORY_OLDER_PAGE_LIMIT = 24;
/**
 * 打开会话后「补齐最近一轮」最多向前翻的页数：最新一页常落在这一轮中间，
 * 需要补到这一轮的输入行；上限兜住超长轮次，翻不到就保持现状，用户仍可手动继续。
 */
const HISTORY_ROUND_FILL_PAGE_LIMIT = 16;
import { capabilityNotice, capabilityStatus } from "./app/capability-model";
import { useDesktopUiRuntime } from "./app/use-ui-runtime";
import { toSessionUiContext } from "./app/ui-plugin-model";
import { SlotOutlet } from "./components/SlotOutlet";
import { SettingsPluginSectionNav, SettingsPluginSectionPanel } from "./components/SettingsPluginSections";
import {
  composerReferenceText,
  subagentDisplayName,
  subagentActivityLabel,
  subagentModeLabel,
  subagentTreeChildId,
  detectComposerTrigger,
  droppedImageMediaType,
  insertComposerCandidate,
  insertComposerText,
  referenceComposerCandidates,
  modelPickerGroups,
  imageLimitsFromProjection,
  imageBatchLimitError,
  modelSupportsImages,
  promptContentParts,
  imageMediaType,
  readImageFile,
  formatDate,
  displayTitle,
  textFromContent,
  readSessionStats,
  recordValue,
  formatTokens,
  modelPricingSourceUrl,
  contextForm,
  contextSummary,
  applyTodoSnapshot,
  todoProjection,
  todosFromHistory,
  turnTimingFromHistory,
  sessionElapsedMs,
  workflowViewsFromHistory,
  deliverablesFromHistory,
  transcriptFromHistory,
  errorText,
  jsonText,
  parseJsonObject,
  settingsOps,
  valueAtPath,
  sessionPath,
  fileTabDetail,
  pathBasename,
  presetDisplayName,
  projectName,
  sessionIsVisible,
  isInjectedMessage,
  retryBoundarySeq,
  retryPromptSourceParts,
  questionAnswerItems,
} from "./app/model";
import {
  type PromptMode,
  type AppearanceSection,
  type ModelMenuPane,
  type SessionAction,
  type ThemeMode,
  type SessionContextMenu,
  type PendingApproval,
  type PendingQuestion,
  type TodoItem,
  type SurfaceTab,
  type SettingsSection,
  type SettingsDraft,
  type GoalRef,
  type DshHostModelCatalog,
  type ModelSelection,
  type ComposerCandidate,
  type ComposerTrigger,
  type SessionSearchResult,
  type ComposerAttachment,
  type SessionStats,
  type ChildSubagentEntry,
  type SubagentSession,
} from "./app/model";
import {
  readWorkspaceViewPreferences,
  writeWorkspaceViewPreferences,
} from "./app/workspace-view";
import { firstSessionForWorkspace, isWorkspaceSelectionCurrent } from "./app/workspace-session-selection";
import {
  backgroundZones,
  defaultAppearance,
  defaultBackgroundConfig,
  defaultBackgrounds,
  hasAnyBackground,
  useAppearanceSettings,
} from "./app/useAppearanceSettings";
import { useThemeHostSync } from "./app/useThemeHostSync";
import { useLocaleHostSync } from "./app/useLocaleHostSync";
import { readStoredLocale, t, writeStoredLocale, type UiLocale } from "./app/i18n";
import { SEND_SHORTCUT_STORAGE_KEY, readSendShortcut, type SendShortcut } from "./app/keyboard-shortcut";
import { defaultWorkingIndicator, normalizeWorkingIndicator } from "./app/working-indicator";
import { externalLaunchKey } from "./lib/external-launch";
import { DEFAULT_PERMISSION_OPTIONS, isDefaultPermission, readStoredDefaultModel, readStoredDefaultPermission, writeStoredDefaultModel, writeStoredDefaultPermission, type DefaultPermission } from "./app/session-defaults";
import { isSchemaEnvelope, schemaEnumChoices, schemaNodeAtPath } from "./app/schema-model";
import { MODEL_REASONING_EFFORT_PRESET, MODEL_REASONING_EFFORT_PRESET_NAMES, declareModelReasoningEffortsOps, providerModels } from "./app/settings-model";
import { resolveSubmitMode } from "./app/submit-mode";
import { presentedPhaseKey, type PresentedAction, type PresentedOpenPhase } from "./app/presented-file";
import {
  reconcileSessionIndicators,
  sessionIndicatorForHistory,
  type SessionIndicator,
} from "./app/session-runtime-state";
import type { PlanReviewQuestion } from "./app/ui-model";
import { planReviewOf } from "./app/ui-model";
import { buildTraySessionMenu } from "./app/tray-model";
import { updateCheckStateFromResult, updateCheckErrorMessage, updateDownloadStateFromEvent, type UpdateChannel, type UpdateCheckState, type UpdateDownloadState } from "./app/update-model";
// @deeptop-pets:start app-runtime-imports
import { listenToPetActionRequests, updatePetActivity, type PetAction } from "./lib/desktop";
import { usePetSystem } from "./app/usePetSystem";
import {
  petCompletionMessageFromHistory,
  projectPetActivity,
  type PetCompletionSignal,
} from "./app/pet-attention-model";
// @deeptop-pets:end app-runtime-imports

const demoStatus: DshStatus = {
  dshHome: "",
  runtimeDirectory: "",
  packageName: "@deepseek-ai/dsh（内嵌运行时）",
  runtimeAvailable: false,
  runtimeStarting: false,
  installing: false,
  registryTesting: false,
  selectedRegistry: null,
  nodeAvailable: false,
  npmAvailable: false,
  packageAvailable: false,
  message: "浏览器预览模式",
};

type PresetMigrationRequest = {
  session: DshSessionSummary;
  missingPreset: string;
  availablePresetIds: string[];
};

type PopupRequest =
  | {
      kind: "confirm";
      message: string;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "close-behavior";
      resolve: (value: Exclude<CloseBehavior, "ask"> | null) => void;
    }
  | {
      kind: "prompt";
      title: string;
      description?: string;
      value: string;
      resolve: (value: string | null) => void;
    };

function WindowCloseBehaviorDialog({
  locale,
  onClose,
  onSelect,
}: {
  locale: UiLocale;
  onClose: () => void;
  onSelect: (behavior: Exclude<CloseBehavior, "ask">) => void;
}) {
  return <PopupDialog
    locale={locale}
    title={t("dialog.closeBehavior.title", locale)}
    eyebrow="DSH / 窗口行为"
    description={t("dialog.closeBehavior.description", locale)}
    className="popup-close-behavior-dialog"
    role="alertdialog"
    onClose={onClose}
    footer={<><button type="button" onClick={onClose}>{t("common.cancel", locale)}</button><button type="button" onClick={() => onSelect("hide-to-tray")}>{t("dialog.closeBehavior.hide", locale)}</button><button type="button" className="confirm" onClick={() => onSelect("exit")}>{t("dialog.closeBehavior.exit", locale)}</button></>}
  >
    <div className="close-behavior-options"><div className="close-behavior-option"><strong>{t("dialog.closeBehavior.hide", locale)}</strong><span>{t("dialog.closeBehavior.hideHint", locale)}</span></div><div className="close-behavior-option"><strong>{t("dialog.closeBehavior.exit", locale)}</strong><span>{t("dialog.closeBehavior.exitHint", locale)}</span></div></div>
  </PopupDialog>;
}

function DshConflictDialog({
  locale,
  conflict,
  busy,
  onClose,
  onTerminate,
}: {
  locale: UiLocale;
  conflict: NonNullable<DshStatus["processConflict"]>;
  busy: boolean;
  onClose: () => void;
  onTerminate: () => void;
}) {
  return <PopupDialog
    locale={locale}
    title={t("dialog.conflict.title", locale)}
    eyebrow="DSH / 进程冲突"
    description={t("dialog.conflict.description", locale, { home: conflict.dshHome })}
    className="popup-dsh-conflict-dialog"
    role="alertdialog"
    onClose={onClose}
    footer={<><button type="button" disabled={busy} onClick={onClose}>{t("dialog.conflict.later", locale)}</button><button type="button" className="confirm danger-button" disabled={busy} onClick={onTerminate}>{busy ? t("dialog.conflict.terminating", locale) : t("dialog.conflict.terminate", locale)}</button></>}
  >
    <div className="dsh-conflict-process-list">{conflict.processes.map((process) => <div className="dsh-conflict-process" key={process.pid}><strong>PID {process.pid}</strong><code>{process.commandLine}</code></div>)}</div>
    <p className="popup-warning-copy">{t("dialog.conflict.warning", locale)}</p>
  </PopupDialog>;
}

const FRONTEND_VISUAL_RESET_VERSION = "workbench-v2";
let frontendVisualResetChecked = false;

function sameWorkspacePath(left?: string, right?: string) {
  if (!left || !right) return false;
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").toLocaleLowerCase();
  return normalize(left) === normalize(right);
}

type WorkspaceRepairResult = {
  attached: number;
  rejected: number;
  reason?: string;
};

function applyFrontendVisualResetOnce() {
  if (frontendVisualResetChecked) return;
  frontendVisualResetChecked = true;
  try {
    if (localStorage.getItem("deeptop.frontend-visual-reset") === FRONTEND_VISUAL_RESET_VERSION) return;
    localStorage.setItem("deeptop.frontend-visual-reset", FRONTEND_VISUAL_RESET_VERSION);
    localStorage.setItem("deeptop.theme", "light");
    localStorage.setItem("deeptop.sidebar-width", "320");
  } catch {
    // The native webview may disable storage in a restricted preview.
  }
}

type AppearanceConfigSection = "theme" | "background" | "typography" | "css";

type AppearanceConfigEnvelope = {
  kind: "deeptop-appearance-config";
  version: 1;
  section: AppearanceConfigSection;
  exportedAt: string;
  data: Record<string, unknown>;
};

function appearanceSectionLabel(section: AppearanceConfigSection, locale: UiLocale) {
  return section === "theme"
    ? t("settings.theme", locale)
    : section === "background"
      ? t("settings.background", locale)
      : section === "typography"
        ? t("settings.typography", locale)
        : t("settings.css", locale);
}

function emptySessionStats(): SessionStats {
  return {
    tokenUsageSource: "none",
    tokenUsageAvailable: false,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextTokens: 0,
    contextTokensAvailable: false,
    contextLimit: 0,
    cacheHitRate: 0,
    messages: 0,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function AppContent() {
  const desktop = isTauri();
  applyFrontendVisualResetOnce();
  const [status, setStatus] = useState<DshStatus>(() => desktop
    ? { ...demoStatus, runtimeStarting: true, message: "正在检查DeepSeek Harness..." }
    : demoStatus);
  const [sessions, setSessions] = useState<DshSessionSummary[]>([]);
  const [archivedSessionIds, setArchivedSessionIds] = useState<Set<string>>(new Set());
  const [sessionIndicators, setSessionIndicators] = useState<Record<string, SessionIndicator>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<DshHistoryEntry[]>([]);
  const historyRef = useRef<DshHistoryEntry[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  // 轮次导航：完整轮次大纲（turnOutline 投影）与正在翻页加载的轮次。
  const [turnOutline, setTurnOutline] = useState<unknown>([]);
  const [turnOutlineSessionId, setTurnOutlineSessionId] = useState<string | null>(null);
  const [turnBusy, setTurnBusy] = useState<number | null>(null);
  const [navigatedTurn, setNavigatedTurn] = useState<number | null>(null);
  const turnOutlineRequestRef = useRef(0);
  // 对话框只保留分页窗口；看板单独缓存完整会话，避免统计口径随滚动位置变化。
  const [dashboardHistory, setDashboardHistory] = useState<DshHistoryEntry[]>([]);
  const [dashboardHistorySessionId, setDashboardHistorySessionId] = useState<string | null>(null);
  const [dashboardHistoryLoading, setDashboardHistoryLoading] = useState(false);
  const [dashboardHistoryError, setDashboardHistoryError] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [sessionDashboardOpen, setSessionDashboardOpen] = useState(false);
  // 交付卡片的原生宿主元数据与动作阶段：阶段按“被查看会话 + 文件路径”记账，
  // 切换会话不会把上一个会话的打开状态带到同名路径上。
  const [presentedHostInfo, setPresentedHostInfo] = useState<PresentedHostInfo | null>(null);
  const [presentedPhases, setPresentedPhases] = useState<Record<string, PresentedOpenPhase>>({});
  // 文件管理器名称由原生侧给出；非桌面端保持 null，交付卡片菜单整体禁用。
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void presentedHost()
      .then((host) => { if (active) setPresentedHostInfo(host); })
      .catch(() => { if (active) setPresentedHostInfo(null); });
    return () => { active = false; };
  }, [desktop]);
  const [workspace, setWorkspace] = useState("");
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [referenceCandidates, setReferenceCandidates] = useState<ComposerCandidate[]>([]);
  const referenceRequestRef = useRef(0);
  const [composerCandidateIndex, setComposerCandidateIndex] = useState(0);
  const [composerMenuDismissed, setComposerMenuDismissed] = useState(false);
  const [promptMode, setPromptMode] = useState<PromptMode>("queue");
  const [sendShortcut, setSendShortcut] = useState(readSendShortcut);
  const [notice, setNoticeState] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  // 右上角提示：普通提示默认不显示；报错时以黄色显示，并支持点击复制。
  const setNotice = useCallback((text: string) => { setNoticeState(text); setNoticeIsError(false); }, []);
  const setErrorNotice = useCallback((text: string) => { setNoticeState(text); setNoticeIsError(true); }, []);
  const [startupLogs, setStartupLogs] = useState<DshRuntimeLog[]>([]);
  const [dshConflictBusy, setDshConflictBusy] = useState(false);
  const [appLogs, setAppLogs] = useState<DshRuntimeLog[]>([]);
  const [logExportPath, setLogExportPath] = useState<string | null>(null);
  const [logExporting, setLogExporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryingMessageSeq, setRetryingMessageSeq] = useState<number | null>(null);
  // 会话日志损坏（崩溃导致）时，记录当前无法打开的会话，用于展示“修复并重新打开”按钮。
  const [corruptSession, setCorruptSession] = useState<DshSessionSummary | null>(null);
  const [repairingSession, setRepairingSession] = useState(false);
  const [presetMigration, setPresetMigration] = useState<PresetMigrationRequest | null>(null);
  const [presetMigrationSelection, setPresetMigrationSelection] = useState("");
  const [presetMigrationRunning, setPresetMigrationRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteSearchResults, setRemoteSearchResults] = useState<SessionSearchResult[] | null>(null);
  const [models, setModels] = useState<DshSessionModels | null>(null);
  const [draftModelSelection, setDraftModelSelection] = useState<ModelSelection | null>(null);
  const [storedDefaultModel, setStoredDefaultModel] = useState<ModelSelection | null>(readStoredDefaultModel);
  const [storedDefaultPermission, setStoredDefaultPermission] = useState<DefaultPermission | null>(readStoredDefaultPermission);
  const [draftPermission, setDraftPermission] = useState<DefaultPermission | null>(null);
  const [commands, setCommands] = useState<DshCommandDescriptor[]>([]);
  const [permissionSelect, setPermissionSelect] = useState<DshPermissionSelect | null>(null);
  const [pendingPermissionValue, setPendingPermissionValue] = useState<DefaultPermission | null>(null);
  const [pendingDefaultPermission, setPendingDefaultPermission] = useState<DefaultPermission | null>(null);
  const [plan, setPlan] = useState<DshPlanProjection | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPane, setModelMenuPane] = useState<ModelMenuPane>("root");
  const [sessionStats, setSessionStats] = useState<SessionStats>(emptySessionStats);
  const [presets, setPresets] = useState<DshPreset[]>([]);
  const [presetAuthorable, setPresetAuthorable] = useState(false);
  const [presetHasDocument, setPresetHasDocument] = useState(false);
  const [nextPreset, setNextPreset] = useState("");
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<DshWorkspace[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("deeptop.sidebar-width"));
      return Number.isFinite(saved) ? Math.min(440, Math.max(300, saved)) : 320;
    } catch {
      return 320;
    }
  });
  // 侧栏收起状态与宽度分开保存：收起只改变呈现，展开仍回到用户拖动过的宽度。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("deeptop.sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem("deeptop.theme");
      return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [locale, setLocale] = useState<UiLocale>(readStoredLocale);
  // 工作区视图偏好：置顶顺序与左下角工作区菜单中未置顶二级列表的展开状态（默认收起）。
  const [unpinnedSectionOpen, setUnpinnedSectionOpen] = useState(() => readWorkspaceViewPreferences().unpinnedSectionOpen);
  const [pinnedWorkspaceIds, setPinnedWorkspaceIds] = useState<string[]>(() => readWorkspaceViewPreferences().pinnedWorkspaceIds);
  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspacePickerMenuRef = useRef<HTMLDivElement | null>(null);
  const [runtimeDetails, setRuntimeDetails] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<DshProvider[]>([]);
  const [hostModels, setHostModels] = useState<DshHostModelCatalog | null>(null);
  const [pluginInventory, setPluginInventory] = useState<DshPluginInventoryEntry[] | null>(null);
  const [excludedPlugins, setExcludedPlugins] = useState<DshPluginInventoryEntry[]>([]);
  const [pluginConfig, setPluginConfig] = useState<DshPluginConfigDescription | null>(null);
  const [pluginConfigDraft, setPluginConfigDraft] = useState<DshPluginConfigEntry[]>([]);
  const [pluginConfigSaving, setPluginConfigSaving] = useState(false);
  const [pluginInstallOpen, setPluginInstallOpen] = useState(false);
  const [pluginPickingEntry, setPluginPickingEntry] = useState(false);
  const [skillInstallOpen, setSkillInstallOpen] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appearanceSection, setAppearanceSection] = useState<AppearanceSection>("theme");
  const [pluginSearch, setPluginSearch] = useState("");
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [skills, setSkills] = useState<DshSkill[]>([]);
  const [subagents, setSubagents] = useState<DshSubagentCatalog | null>(null);
  // 递归树懒加载的目录缓存：treeKey = `${parentSessionId}\u0000${childSessionId}`，
  // 值为该 child 的子目录（null 表示加载中）。展开分支时才发起 subagent.list。
  const [subagentCatalogs, setSubagentCatalogs] = useState<Record<string, DshSubagentCatalog | null>>({});
  const [subagentBranchExpanded, setSubagentBranchExpanded] = useState<Record<string, boolean>>({});
  const [subagentBranchErrors, setSubagentBranchErrors] = useState<Record<string, string>>({});
  const [subagentPanelOpen, setSubagentPanelOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [subagentLoadingId, setSubagentLoadingId] = useState<string | null>(null);
  const [subagentLoadError, setSubagentLoadError] = useState<string | null>(null);
  const [subagentSession, setSubagentSession] = useState<SubagentSession | null>(null);
  const [subagentComposer, setSubagentComposer] = useState("");
  const [settings, setSettings] = useState<DshSettingsDescription | null>(null);
  // 官方插件能力探测结果：null 表示尚未探测（界面不降级，保持旧行为）；
  // 探测后缺失的能力由 capabilityStatus 映射为功能开关并提示。
  const [capabilities, setCapabilities] = useState<DshHostCapabilities | null>(null);
  const capabilityFeatures = capabilityStatus(capabilities).features;
  const [contextMenuStatus, setContextMenuStatus] = useState<WindowsContextMenuStatus | null>(null);
  const [contextMenuUpdating, setContextMenuUpdating] = useState(false);
  const [windowBehavior, setWindowBehavior] = useState<WindowBehaviorSettings>({ minimizeToTray: false, closeBehavior: "ask" });
  const [windowBehaviorUpdating, setWindowBehaviorUpdating] = useState(false);
  const [networkProxy, setNetworkProxyState] = useState<DshNetworkProxy>({ enabled: false, url: "" });
  const [networkEffective, setNetworkEffective] = useState<DshEffectiveNetworkProxy>({ source: "none", url: "", noProxy: "" });
  const [networkProxyUpdating, setNetworkProxyUpdating] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [goal, setGoal] = useState<DshGoalProjection | null | undefined>(undefined);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalMaxRoundsDraft, setGoalMaxRoundsDraft] = useState("");
  const [goalPanelOpen, setGoalPanelOpen] = useState(false);
  const [goalPanelBusy, setGoalPanelBusy] = useState(false);
  const [goalBarCollapsed, setGoalBarCollapsed] = useState(true);
  const goalBarStateRef = useRef(emptyGoalBarState());
  const [presetView, setPresetView] = useState<{ id: string; content: string } | null>(null);
  const [presetCopy, setPresetCopy] = useState<{ from: string; id: string; name: string } | null>(null);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const surfaceRequestRef = useRef(0);
  const surfaceAbortRef = useRef<AbortController | null>(null);
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>(DEEPTOP_VERSION.includes("-") ? "development" : "stable");
  const [updateState, setUpdateState] = useState<UpdateCheckState>({ status: "idle", channel: updateChannel });
  const [updateDownloadState, setUpdateDownloadState] = useState<UpdateDownloadState>({ status: "idle" });
  const updateCheckRequestRef = useRef(0);
  const updateDownloadRequestRef = useRef(0);
  const updateDownloadReleaseRef = useRef<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DshSessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [queue, setQueue] = useState<DshQueueItem[]>([]);
  const [queueEditingId, setQueueEditingId] = useState<string | null>(null);
  const [queueEditingText, setQueueEditingText] = useState("");
  const [sessionJobs, setSessionJobs] = useState<Record<string, DshJob[]>>({});
  const [activeUtilityPanel, setActiveUtilityPanel] = useState<UtilityDockId | null>(null);
  const [jobNow, setJobNow] = useState(() => Date.now());
  const [filesOpen, setFilesOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, PendingApproval>>({});
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, PendingQuestion>>({});
  // @deeptop-pets:start app-completion-state
  const [petCompletions, setPetCompletions] = useState<Record<string, PetCompletionSignal>>({});
  // @deeptop-pets:end app-completion-state
  const [questionAnswersBySession, setQuestionAnswersBySession] = useState<Record<string, Record<string, string[]>>>({});
  const [questionCustomAnswersBySession, setQuestionCustomAnswersBySession] = useState<Record<string, Record<string, string>>>({});
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenu | null>(null);
  const [archiveTargets, setArchiveTargets] = useState<DshSessionSummary[] | null>(null);
  const [deleteArchivedTargets, setDeleteArchivedTargets] = useState<DshSessionSummary[] | null>(null);
  const [archiveMutationPending, setArchiveMutationPending] = useState(false);
  const archiveMutationPendingRef = useRef(false);
  const [popupRequest, setPopupRequest] = useState<PopupRequest | null>(null);
  const [popupValue, setPopupValue] = useState("");
  const popupQueueRef = useRef<PopupRequest[]>([]);
  const activePopupRequestRef = useRef<PopupRequest | null>(null);
  const requestWindowCloseRef = useRef<() => void>(() => undefined);
  const closeRequestPendingRef = useRef(false);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const transcriptScroll = useRef<HTMLDivElement | null>(null);
  const draggedSessionRef = useRef<string | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const historyLoadingOlderRef = useRef(false);
  const dashboardHistoryRequestRef = useRef(0);
  const dashboardHistoryAbortRef = useRef<AbortController | null>(null);
  const [transcriptFollowing, setTranscriptFollowing] = useState(true);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionsRef = useRef<DshSessionSummary[]>(sessions);
  sessionsRef.current = sessions;
  // @deeptop-pets:start app-action-refs
  const pendingApprovalsRef = useRef(pendingApprovals);
  pendingApprovalsRef.current = pendingApprovals;
  const pendingQuestionsRef = useRef(pendingQuestions);
  pendingQuestionsRef.current = pendingQuestions;
  const petCompletionPreviewRequestsRef = useRef(new Set<string>());
  const petActionHandlerRef = useRef<(action: PetAction) => void>(() => undefined);
  useEffect(() => {
    petActionHandlerRef.current = (action) => { void handlePetAction(action); };
  });
  // @deeptop-pets:end app-action-refs
  // 拖放处理注册一次即可，因此通过 ref 读取随渲染变化的工作区、模型限制和附件。
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const attachmentsRef = useRef<ComposerAttachment[]>(attachments);
  attachmentsRef.current = attachments;
  const [composerDropActive, setComposerDropActive] = useState(false);
  const openSessionRef = useRef<(session: DshSessionSummary) => Promise<boolean>>(() => Promise.resolve(false));
  const chooseWorkspaceRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());
  const syncConversationToWorkspaceRef = useRef<(path: string, knownWorkspace?: DshWorkspace | null) => Promise<void>>(() => Promise.resolve());
  const openingNotificationSessionsRef = useRef(new Set<string>());
  const runtimeAvailableRef = useRef(desktop && status.runtimeAvailable);
  // DSH crash recovery tracking: remembers that we observed a down period and
  // which session was active at that moment, so once DSH comes back we can
  // reconcile stale session state and re-open that session.
  const runtimeDownRef = useRef(false);
  const downActiveSessionRef = useRef<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const contextProjectionRef = useRef(false);
  const workspaceSelectionInitializedRef = useRef(false);
  const workspaceRepairNoticeRef = useRef("");
  const selectedSubagentRef = useRef<string | null>(null);
  const subagentRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const workspaceSelectionRequestRef = useRef(0);
  const workspaceMutationQueueRef = useRef(Promise.resolve());
  const workspacesRef = useRef<DshWorkspace[]>(workspaces);
  workspacesRef.current = workspaces;
  function commitWorkspaces(next: DshWorkspace[]) {
    workspacesRef.current = next;
    setWorkspaces(next);
  }
  function updateWorkspaces(project: (current: DshWorkspace[]) => DshWorkspace[]) {
    commitWorkspaces(project(workspacesRef.current));
  }
  const creatingSessionRef = useRef<Promise<string> | null>(null);
  const sessionLoadRequestRef = useRef(0);
  const skillsRequestRef = useRef(0);
  const skillsAbortRef = useRef<AbortController | null>(null);
  const retryingMessageRef = useRef<number | null>(null);
  const retryingSessionRef = useRef<string | null>(null);
  const imageAttachmentCacheRef = useRef(new ImageAttachmentCache());
  const externalLaunchQueueRef = useRef<ExternalLaunchRequest[]>([]);
  const externalLaunchFlushRef = useRef<Promise<void> | null>(null);
  const externalLaunchBootedRef = useRef(false);

  function clearDashboardHistory() {
    dashboardHistoryAbortRef.current?.abort();
    dashboardHistoryAbortRef.current = null;
    dashboardHistoryRequestRef.current += 1;
    setDashboardHistory([]);
    setDashboardHistorySessionId(null);
    setDashboardHistoryLoading(false);
    setDashboardHistoryError(null);
  }

  const loadImageAttachment = useCallback((attachmentId: string) => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return Promise.reject(new Error(t("err.noOpenSession", locale)));
    const key = `${sessionId}:${attachmentId}`;
    const cached = imageAttachmentCacheRef.current.get(key);
    if (cached) return cached;
    const request = desktopRequest("session.attachment", {
      sessionId,
      attachmentId,
    }).then((result) => `data:${result.attachment.mediaType};base64,${result.data}`);
    imageAttachmentCacheRef.current.set(key, request);
    void request.then((value) => {
      imageAttachmentCacheRef.current.updateSize(key, request, value.length);
    }).catch(() => {
      imageAttachmentCacheRef.current.delete(key, request);
    });
    return request;
  }, []);

  function enqueuePopupRequest(request: PopupRequest) {
    if (activePopupRequestRef.current) {
      popupQueueRef.current.push(request);
      return;
    }
    activePopupRequestRef.current = request;
    setPopupValue(request.kind === "prompt" ? request.value : "");
    setPopupRequest(request);
  }

  function requestConfirm(message: string) {
    return new Promise<boolean>((resolve) => {
      enqueuePopupRequest({ kind: "confirm", message, resolve });
    });
  }

  const requestPrompt = useCallback((title: string, value = "", description?: string) => {
    return new Promise<string | null>((resolve) => {
      enqueuePopupRequest({ kind: "prompt", title, value, description, resolve });
    });
  }, []);

  const uiHostActions = useMemo(() => ({
    prompt: ({ title, value, description }: { title: string; value?: string; description?: string }) => requestPrompt(title, value ?? "", description),
    notify: (message: string, kind: "info" | "error" = "info") => {
      if (kind === "error") setErrorNotice(message);
      else setNotice(message);
    },
  }), [requestPrompt, setErrorNotice, setNotice]);

  function requestCloseBehavior() {
    return new Promise<Exclude<CloseBehavior, "ask"> | null>((resolve) => {
      enqueuePopupRequest({ kind: "close-behavior", resolve });
    });
  }

  async function requestWindowClose() {
    if (!desktop || closeRequestPendingRef.current) return;
    closeRequestPendingRef.current = true;
    try {
      const behavior = windowBehavior.closeBehavior === "ask" ? await requestCloseBehavior() : windowBehavior.closeBehavior;
      if (!behavior) {
        await cancelWindowClose();
        return;
      }
      await resolveWindowClose(behavior);
      setWindowBehavior((current) => ({ ...current, closeBehavior: behavior }));
    } catch (error) {
      await cancelWindowClose().catch(() => undefined);
      setErrorNotice(t("notice.closeWindowFailed", locale, { error: errorText(error, locale) }));
    } finally {
      closeRequestPendingRef.current = false;
    }
  }

  async function updateWindowBehavior(patch: Partial<WindowBehaviorSettings>) {
    const next = { ...windowBehavior, ...patch };
    setWindowBehaviorUpdating(true);
    try {
      setWindowBehavior(await setWindowBehaviorSettings(next));
      setNotice(t("notice.windowBehaviorSaved", locale));
    } catch (error) {
      setErrorNotice(t("notice.windowBehaviorSaveFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setWindowBehaviorUpdating(false);
    }
  }

  async function updateNetworkProxy(proxy: DshNetworkProxy) {
    setNetworkProxyUpdating(true);
    try {
      const result = await setNetworkProxy(proxy);
      setNetworkProxyState(result.proxy);
      setNetworkEffective(result.effective);
      const label = result.effective.source === "system" ? t("notice.proxyLabelSystem", locale) : result.effective.source === "explicit" ? t("notice.proxyLabelExplicit", locale) : t("notice.proxyLabelDirect", locale);
      setNotice(result.applied ? t("notice.proxySavedLive", locale, { label }) : t("notice.proxySavedPending", locale, { label }));
    } catch (error) {
      setErrorNotice(t("notice.proxyError", locale, { error: errorText(error, locale) }));
    } finally {
      setNetworkProxyUpdating(false);
    }
  }

  function settlePopup(value: boolean | string | Exclude<CloseBehavior, "ask"> | null) {
    const current = activePopupRequestRef.current;
    if (!current) return;
    if (current.kind === "confirm") current.resolve(value === true);
    else if (current.kind === "close-behavior") current.resolve(value === "hide-to-tray" || value === "exit" ? value : null);
    else current.resolve(typeof value === "string" ? value : null);
    const next = popupQueueRef.current.shift() ?? null;
    activePopupRequestRef.current = next;
    setPopupValue(next?.kind === "prompt" ? next.value : "");
    setPopupRequest(next);
  }

  const {
    windowMaximized,
    startWindowDrag,
    toggleWindowMaximize,
    minimizeWindow,
    closeWindow,
  } = useWindowControls({ desktop, minimizeToTray: windowBehavior.minimizeToTray, onCloseRequested: () => requestWindowCloseRef.current(), onError: setErrorNotice });
  requestWindowCloseRef.current = requestWindowClose;
  const {
    appearance,
    appearanceStyle,
    appearanceFontPreset,
    appearanceCodeFontPreset,
    appearanceFontPresets,
    appearanceCodeFontPresets,
    appTheme,
    themeFilesInfo,
    themePathError,
    themePathLoading,
    themeIds,
    updateAppearance,
    updateBackground,
    clearBackground,
    handleBackgroundFile,
    handleThemeFile,
    setAppTheme,
    handlePickThemeCss,
    reloadThemeCss,
    openThemesDirectory,
    rescanThemes,
    resetAppearance,
  } = useAppearanceSettings({ onNotice: setNotice, onError: setErrorNotice, locale });
  // 本地主题与 Host ui-theme 命名空间双向同步：启动采纳 Host、用户修改回写、
  // 外部修改（settings/document-updated）重新采纳。
  const { pushToHost: pushThemeToHost } = useThemeHostSync({
    desktop,
    themeMode,
    onUserChange: setThemeMode,
  });
  function changeThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    void pushThemeToHost();
  }
  // 界面语言：本地持久化 + 与 Host locale 命名空间双向同步。
  const { pushToHost: pushLocaleToHost } = useLocaleHostSync({
    desktop,
    locale,
    onUserChange: setLocale,
  });
  function changeLocale(next: UiLocale) {
    setLocale(next);
    writeStoredLocale(next);
    void pushLocaleToHost(next);
  }
  // @deeptop-pets:start app-system-hook
  const petSystem = usePetSystem({
    desktop,
    libraryRequested: (settingsSection as string) === "pets",
    onNotice: setNotice,
    onError: setErrorNotice,
    onConfirm: requestConfirm,
    locale,
  });
  // @deeptop-pets:end app-system-hook
  const {
    settings: dockSettings,
    loaded: dockSettingsLoaded,
    updateSettings: updateDockSettings,
    layout: dockLayout,
    drag: dockDrag,
    closeTab: closeDockTab,
    openTab: openDockTab,
    resetLayout: resetDockLayout,
  } = useDockSettings();
  const [dockSettingsUpdating, setDockSettingsUpdating] = useState(false);

  async function updateDockSettingsWithNotice(patch: Partial<import("./lib/desktop").DockSettings>) {
    setDockSettingsUpdating(true);
    try {
      await updateDockSettings(patch);
      setNotice(t("notice.dockSettingsSaved", locale));
    } catch (error) {
      setErrorNotice(t("notice.dockSettingsSaveFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setDockSettingsUpdating(false);
    }
  }

  function downloadAppearanceConfig(section: AppearanceConfigSection, data: Record<string, unknown>) {
    const envelope: AppearanceConfigEnvelope = { kind: "deeptop-appearance-config", version: 1, section, exportedAt: new Date().toISOString(), data };
    const content = JSON.stringify(envelope, null, 2);
    const fileName = `deeptop-appearance-${section}.json`;
    if (!desktop) {
      setErrorNotice(t("notice.configExportDesktopOnly", locale));
      return;
    }
    void saveExportFile(fileName, new TextEncoder().encode(content)).then((savedPath) => {
      if (savedPath) setNotice(t("notice.configExported", locale, { section: appearanceSectionLabel(section, locale) }));
    }).catch((error) => setErrorNotice(t("notice.exportFailed", locale, { error: errorText(error, locale) })));
  }

  function exportAppearanceConfig() {
    const section = appearanceSection;
    const data = section === "theme" ? { themeMode, appTheme, themeCssPath: appearance.themeCssPath } : section === "background" ? { backgrounds: appearance.backgrounds } : section === "typography" ? { fontFamily: appearance.fontFamily, codeFontFamily: appearance.codeFontFamily, messageFontSize: appearance.messageFontSize, messageLineHeight: appearance.messageLineHeight, streamingFadeDuration: appearance.streamingFadeDuration, streamingFadeInk: appearance.streamingFadeInk, workingIndicator: appearance.workingIndicator } : { customCss: appearance.customCss, customCssName: appearance.customCssName, customCssEnabled: appearance.customCssEnabled };
    downloadAppearanceConfig(section, data);
  }

  function normalizeImportedBackgrounds(value: unknown) {
    if (!value || typeof value !== "object") throw new Error(t("err.backgroundInvalid", locale));
    const source = value as Record<string, unknown>;
    const next = { ...appearance.backgrounds };
    for (const zone of backgroundZones) {
      const input = source[zone];
      if (!input || typeof input !== "object") continue;
      const record = input as Record<string, unknown>;
      const fallback = defaultBackgroundConfig(zone);
      const image = typeof record.image === "string" && (/^(?:https?:|data:image\/)/i.test(record.image) || record.image === "") ? record.image : fallback.image;
      const number = (key: string, min: number, max: number, fallbackValue: number) => { const candidate = Number(record[key]); return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallbackValue; };
      next[zone] = { image, name: typeof record.name === "string" ? record.name.slice(0, 200) : fallback.name, opacity: number("opacity", 0.05, 0.45, fallback.opacity), panelOpacity: number("panelOpacity", 0, 100, fallback.panelOpacity), blur: number("blur", 0, 16, fallback.blur), size: record.size === "contain" ? "contain" : "cover", position: ["center", "top", "bottom", "left", "right"].includes(String(record.position)) ? record.position as typeof fallback.position : fallback.position };
    }
    return next;
  }

  async function importAppearanceConfig(file: File | undefined) {
    if (!file) return;
    if (file.size > 8_000_000) { setErrorNotice(t("notice.configTooLarge", locale)); return; }
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppearanceConfigEnvelope>;
      if (parsed.kind !== "deeptop-appearance-config" || parsed.version !== 1 || parsed.section !== appearanceSection || !parsed.data || typeof parsed.data !== "object") throw new Error(`${t("notice.configSectionMismatch", locale, { section: appearanceSectionLabel(appearanceSection, locale) })}`);
      const data = parsed.data as Record<string, unknown>;
      if (appearanceSection === "theme") {
        const nextMode = data.themeMode === "light" || data.themeMode === "dark" || data.themeMode === "system" ? data.themeMode : null;
        // 接受任意非空字符串主题 id（themes/ 下用户放入的自定义主题也可导入）。
        const nextTheme = typeof data.appTheme === "string" && data.appTheme.length > 0 && data.appTheme.length <= 200 ? data.appTheme : null;
        const nextPath = typeof data.themeCssPath === "string" && data.themeCssPath.length <= 2000 ? data.themeCssPath : "";
        if (!nextMode || !nextTheme) throw new Error(t("err.themeInvalid", locale));
        changeThemeMode(nextMode);
        setAppTheme(nextTheme);
        updateAppearance({ themeCssPath: nextPath });
      } else if (appearanceSection === "background") {
        updateAppearance({ backgrounds: normalizeImportedBackgrounds(data.backgrounds) });
      } else if (appearanceSection === "typography") {
        const fontFamily = typeof data.fontFamily === "string" && data.fontFamily.trim() ? data.fontFamily.slice(0, 500) : defaultAppearance.fontFamily;
        const codeFontFamily = typeof data.codeFontFamily === "string" && data.codeFontFamily.trim() ? data.codeFontFamily.slice(0, 500) : defaultAppearance.codeFontFamily;
        const messageFontSize = Number(data.messageFontSize);
        const messageLineHeight = Number(data.messageLineHeight);
        const streamingFadeDuration = Number(data.streamingFadeDuration);
        const streamingFadeInk = Number(data.streamingFadeInk);
        updateAppearance({ fontFamily, codeFontFamily, messageFontSize: Number.isFinite(messageFontSize) ? Math.min(18, Math.max(14, messageFontSize)) : defaultAppearance.messageFontSize, messageLineHeight: Number.isFinite(messageLineHeight) ? Math.min(2.2, Math.max(1.35, messageLineHeight)) : defaultAppearance.messageLineHeight, streamingFadeDuration: Number.isFinite(streamingFadeDuration) ? Math.min(1500, Math.max(150, streamingFadeDuration)) : defaultAppearance.streamingFadeDuration, streamingFadeInk: Number.isFinite(streamingFadeInk) ? Math.min(1, Math.max(0.05, streamingFadeInk)) : defaultAppearance.streamingFadeInk, workingIndicator: normalizeWorkingIndicator(data.workingIndicator) });
      } else {
        const customCss = typeof data.customCss === "string" && data.customCss.length <= 500_000 ? data.customCss : "";
        updateAppearance({ customCss, customCssName: typeof data.customCssName === "string" ? data.customCssName.slice(0, 200) : "", customCssEnabled: data.customCssEnabled === true && Boolean(customCss) });
      }
      setNotice(t("notice.configApplied", locale, { section: appearanceSectionLabel(appearanceSection, locale), name: file.name }));
    } catch (error) { setErrorNotice(t("notice.configImportFailed", locale, { error: errorText(error, locale) })); }
  }
  function resetAppearanceSection() {
    if (appearanceSection === "theme") {
      changeThemeMode("system");
      setAppTheme("monokai-pro");
      // 拼出 monokai-pro 对应的默认主题 CSS 路径；不依赖 themeFilesInfo 字段名。
      const fallback = themeFilesInfo
        ? `${themeFilesInfo.themesDir.replace(/[\\/]+$/, "")}/monokai-pro.css`
        : appearance.themeCssPath;
      updateAppearance({ themeCssPath: fallback });
    } else if (appearanceSection === "background") {
      updateAppearance({ backgrounds: defaultBackgrounds() });
    } else if (appearanceSection === "typography") {
      updateAppearance({ fontFamily: defaultAppearance.fontFamily, codeFontFamily: defaultAppearance.codeFontFamily, messageFontSize: defaultAppearance.messageFontSize, messageLineHeight: defaultAppearance.messageLineHeight, streamingFadeDuration: defaultAppearance.streamingFadeDuration, streamingFadeInk: defaultAppearance.streamingFadeInk, workingIndicator: { ...defaultWorkingIndicator, texts: [...defaultWorkingIndicator.texts] } });
    } else {
      updateAppearance({ customCss: "", customCssName: "", customCssEnabled: false });
    }
    setNotice(t("notice.configReset", locale, { section: appearanceSectionLabel(appearanceSection, locale) }));
  }

  const providerSettings = useProviderSettings({
    desktop,
    settings,
    providers,
    onNotice: setNotice,
    onError: setErrorNotice,
    onConfirm: requestConfirm,
    loadRuntimeDetails,
    locale,
  });
  const loadCurrentSessionSkills = useCallback(async (requestedSessionId = activeSessionRef.current) => {
    const requestId = ++skillsRequestRef.current;
    skillsAbortRef.current?.abort(new Error("新的 Skill 列表请求已开始"));
    const controller = new AbortController();
    skillsAbortRef.current = controller;
    if (!desktop || !requestedSessionId || !capabilityFeatures.skills) {
      controller.abort();
      setSkills([]);
      return;
    }
    try {
      const result = await desktopRequest("skill.list", { sessionId: requestedSessionId }, controller.signal, { waitForReconnect: true });
      if (controller.signal.aborted || requestId !== skillsRequestRef.current || activeSessionRef.current !== requestedSessionId) return;
      setSkills(result.skills);
    } catch (error) {
      if (controller.signal.aborted || requestId !== skillsRequestRef.current || activeSessionRef.current !== requestedSessionId) return;
      setSkills([]);
      setErrorNotice(errorText(error, locale));
    } finally {
      if (skillsAbortRef.current === controller) skillsAbortRef.current = null;
    }
  }, [capabilityFeatures.skills, desktop, locale, setErrorNotice]);

  // 任务输出：桥接侧走 DSH 的非消费式投影（`ctx.jobs.peek`），既不取走模型
  // `job_output` 仍在读的输出，也允许展开行跟随运行态心跳刷新；读取失败由面板
  // 就地展示，不升级为全局提示。
  const loadTaskOutput = useCallback(async (jobId: string): Promise<DshJobOutput> => {
    const sessionId = activeSessionRef.current;
    if (!desktop || !sessionId) throw new Error(t("common.desktopOnly", locale));
    return desktopRequest("job.output", { sessionId, jobId });
  }, [desktop, locale]);

  const toolSettings = useToolSettings({
    desktop,
    runtimeAvailable: status.runtimeAvailable,
    visible: showInspector && settingsSection === "tools" && capabilityFeatures.tools,
    locale,
    onNotice: setNotice,
    onError: setErrorNotice,
    onSkillsChanged: () => loadCurrentSessionSkills(),
  });
  useEffect(() => {
    if (desktop && showInspector && settingsSection === "tools" && capabilityFeatures.tools && !toolSettings.loaded && !toolSettings.loading && !toolSettings.loadAttempted) {
      void toolSettings.load();
    }
  }, [capabilityFeatures.tools, desktop, settingsSection, showInspector, toolSettings.load, toolSettings.loadAttempted, toolSettings.loaded, toolSettings.loading]);
  const activeSession = sessions.find((session) => session.sessionId === activeSessionId);
  const activeRunning = Boolean(activeSession?.running);

  // 桌面 UI 插件运行时：发现/激活插件并维护 Slot Registry；无插件时主应用完全不变。
  const uiRuntime = useDesktopUiRuntime();
  useEffect(() => {
    uiRuntime.setHostContext(locale, uiHostActions);
  }, [locale, uiHostActions, uiRuntime]);
  useEffect(() => {
    uiRuntime.updateSession(activeSession ? toSessionUiContext(activeSession, displayTitle(activeSession)) : null);
  }, [uiRuntime, activeSession]);

  const activeJobs = activeSessionId ? sessionJobs[activeSessionId] ?? [] : [];
  const approval = activeSessionId ? pendingApprovals[activeSessionId] ?? null : null;
  const question = activeSessionId ? pendingQuestions[activeSessionId] ?? null : null;
  // @deeptop-pets:start app-activity-projection
  const petSessions = useMemo(() => sessions.map((session) => ({
    sessionId: session.sessionId,
    title: displayTitle(session, locale),
    running: session.running,
    updatedAt: session.updatedAt,
  })), [sessions]);

  // 桌宠未启用时整个预览链没有消费者：跳过候选生成（以及下方的 history 预取），
  // 避免每次会话状态变化都为所有已完成会话额外发起一轮 session.history。
  const petCompletionCandidates = useMemo<PetCompletionSignal[]>(() => {
    if (!petSystem.settings.enabled) return [];
    return sessions
      .filter((session) => !session.running)
      .filter((session) => sessionIndicators[session.sessionId] === "completed" || sessionIndicators[session.sessionId] === "error")
      .map((session) => {
        const kind = sessionIndicators[session.sessionId] === "error" ? "failed" : "completed";
        return {
          id: `${kind}:${session.sessionId}:${session.updatedAt}`,
          sessionId: session.sessionId,
          kind,
          title: displayTitle(session, locale),
          message: "",
          updatedAt: session.updatedAt,
          previewLoaded: false,
        };
      });
  }, [petSystem.settings.enabled, sessionIndicators, sessions]);

  useEffect(() => {
    setPetCompletions((current) => {
      const next: Record<string, PetCompletionSignal> = {};
      let changed = Object.keys(current).length !== petCompletionCandidates.length;
      for (const candidate of petCompletionCandidates) {
        const existing = current[candidate.sessionId];
        if (existing?.id === candidate.id && existing.title === candidate.title) {
          next[candidate.sessionId] = existing;
          continue;
        }
        changed = true;
        next[candidate.sessionId] = candidate;
      }
      return changed ? next : current;
    });
  }, [petCompletionCandidates]);

  useEffect(() => {
    if (!desktop) return;
    for (const completion of Object.values(petCompletions)) {
      if (completion.previewLoaded || petCompletionPreviewRequestsRef.current.has(completion.id)) continue;
      petCompletionPreviewRequestsRef.current.add(completion.id);
      void desktopRequest("session.history", {
        sessionId: completion.sessionId,
        maxMessages: 40,
      }).then((result) => {
        const message = petCompletionMessageFromHistory(result.events);
        setPetCompletions((current) => {
          const existing = current[completion.sessionId];
          if (existing?.id !== completion.id) return current;
          return {
            ...current,
            [completion.sessionId]: { ...existing, message, previewLoaded: true },
          };
        });
      }).catch((error) => {
        console.error(`读取桌宠会话摘要失败：${completion.sessionId}`, error);
        setPetCompletions((current) => {
          const existing = current[completion.sessionId];
          if (existing?.id !== completion.id) return current;
          return {
            ...current,
            [completion.sessionId]: { ...existing, previewLoaded: true },
          };
        });
      }).finally(() => {
        petCompletionPreviewRequestsRef.current.delete(completion.id);
      });
    }
  }, [desktop, petCompletions]);

  const petActivity = useMemo(() => projectPetActivity({
    activeSessionId,
    sessions: petSessions,
    approvals: Object.values(pendingApprovals),
    questions: Object.values(pendingQuestions),
    completions: Object.values(petCompletions),
  }), [activeSessionId, pendingApprovals, pendingQuestions, petCompletions, petSessions]);

  useEffect(() => {
    if (!desktop || !petSystem.loaded || !petSystem.settings.enabled) return;
    void updatePetActivity(petActivity).catch((error) => {
      console.error("同步桌宠任务状态失败", error);
    });
  }, [desktop, petActivity, petSystem.loaded, petSystem.settings.enabled]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const cleanups: Array<UnlistenFn> = [];
    trackAsyncCleanup(cleanups, listenToPetActionRequests((action) => {
      if (active) petActionHandlerRef.current(action);
    }), () => !active, undefined, (error) => console.error("监听桌宠快捷动作失败", error));
    return () => {
      active = false;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [desktop]);
  // @deeptop-pets:end app-activity-projection
  const pendingSessionIds = useMemo(
    () => new Set([...Object.keys(pendingApprovals), ...Object.keys(pendingQuestions)]),
    [pendingApprovals, pendingQuestions],
  );
  const questionAnswers = activeSessionId ? questionAnswersBySession[activeSessionId] ?? {} : {};
  const questionCustomAnswers = activeSessionId ? questionCustomAnswersBySession[activeSessionId] ?? {} : {};

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
    if (activeSessionId !== retryingSessionRef.current && retryingMessageRef.current === null) {
      setRetryingMessageSeq(null);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!desktop) return;
    void getWindowBehaviorSettings().then(normalizeWindowBehavior).then(setWindowBehavior).catch((error) => setErrorNotice(t("notice.windowBehaviorReadFailed", locale, { error: errorText(error, locale) })));
    void getNetworkProxy().then((snapshot) => {
      setNetworkProxyState(snapshot.explicit);
      setNetworkEffective(snapshot.effective);
    }).catch(() => { /* 读取失败不阻断启动 */ });
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const setupWindowCloseListener = async () => {
      try {
        // Register before consuming the pending flag so a close request cannot
        // arrive in the gap between these two startup operations.
        const cleanup = await listenToWindowCloseRequested(() => { requestWindowCloseRef.current(); });
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const pending = await listPendingWindowClose();
        if (pending && !disposed) requestWindowCloseRef.current();
      } catch {
        // The native close event is best-effort; the visible close button still
        // reports failures through requestWindowClose's command path.
      }
    };
    void setupWindowCloseListener();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    const cleanups: Array<UnlistenFn> = [];
    let disposed = false;
    trackAsyncCleanup(cleanups, listenToUpdateProgress((progress) => {
      if (disposed) return;
      const expectedRelease = updateDownloadReleaseRef.current;
      if (progress.releaseTag && (!expectedRelease || progress.releaseTag !== expectedRelease)) return;
      if (!progress.releaseTag && (progress.phase === "failed" || progress.phase === "cancelled") && !expectedRelease) return;
      setUpdateDownloadState(updateDownloadStateFromEvent(progress, locale));
    }), () => disposed);
    return () => {
      disposed = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [desktop]);

  // 系统级文件拖放：Tauri 默认拦截原生拖放，WebView2 不会向页面派发携带
  // OS 文件的 HTML5 drop 事件，因此通过原生事件按落点是否在输入框内分发。
  useEffect(() => {
    if (!desktop) return;
    const cleanups: Array<UnlistenFn> = [];
    let disposed = false;
    // 附件胶囊已移到发送框上方：两者同属落点区域，否则拖到胶囊行会被判为未命中。
    const overComposer = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest(".composer-shell, .composer-attachments") != null;
    trackAsyncCleanup(cleanups, listenToWebviewFileDrop((event) => {
      if (disposed) return;
      if (event.type === "leave") {
        setComposerDropActive(false);
        return;
      }
      const hit = overComposer(event.x, event.y);
      if (event.type === "drop") {
        setComposerDropActive(false);
        if (hit) void acceptDroppedPaths(event.paths);
        return;
      }
      setComposerDropActive(hit);
    }), () => disposed);
    return () => {
      disposed = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      setComposerDropActive(false);
    };
  }, [desktop]);


  useEffect(() => {
    selectedSubagentRef.current = selectedSubagentId;
  }, [selectedSubagentId]);

  useEffect(() => {
    setModelMenuOpen(false);
    setModelMenuPane("root");
    setPresetMenuOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && modelMenuRef.current?.contains(event.target)) return;
      setModelMenuOpen(false);
      setModelMenuPane("root");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!presetMenuOpen) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".preset-seat")) return;
      setPresetMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPresetMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [presetMenuOpen]);

  useEffect(() => {
    writeWorkspaceViewPreferences({ pinnedWorkspaceIds, unpinnedSectionOpen });
  }, [pinnedWorkspaceIds, unpinnedSectionOpen]);

  // 左下角工作区一级菜单：点击外部或按 Esc 自动收起。
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && workspacePickerMenuRef.current?.contains(event.target)) return;
      setWorkspaceMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [workspaceMenuOpen]);

  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!showInspector) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = inspectorPanelRef.current;
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled]):not([type=\"hidden\"])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[contenteditable=\"true\"]",
      "[tabindex]:not([tabindex=\"-1\"])",
    ].join(",");
    const getFocusable = () => {
      if (!panel) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
        if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
        if (element.getAttribute("aria-disabled") === "true") return false;
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    };
    const frame = window.requestAnimationFrame(() => {
      const first = getFocusable()[0];
      if (first) first.focus();
      else panel?.focus();
    });
    // A nested PopupDialog owns the focus loop while it is open; skip the
    // inspector trap so the two handlers do not fight over Tab.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || document.querySelector(".popup-modal")) return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!panel?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [showInspector]);

  useEffect(() => {
    if (!showInspector && !settingsDraft && !presetCopy && !presetView) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || skillInstallOpen) return;
      if (settingsDraft) {
        setSettingsDraft(null);
      } else if (presetCopy) {
        setPresetCopy(null);
      } else if (presetView) {
        setPresetView(null);
      } else {
        closeSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [presetCopy, presetView, settingsDraft, showInspector, skillInstallOpen]);

  useEffect(() => {
    if (!activeUtilityPanel && !subagentPanelOpen) return;
    const dismissUtilityPanel = () => {
      setSubagentPanelOpen(false);
      setActiveUtilityPanel(null);
    };
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".utility-panel-shelf")) return;
      dismissUtilityPanel();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismissUtilityPanel();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeUtilityPanel, subagentPanelOpen]);

  useEffect(() => {
    if (!sessionContextMenu) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".session-context-menu")) {
        setSessionContextMenu(null);
      }
    };
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".session-row")) {
        setSessionContextMenu(null);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSessionContextMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [sessionContextMenu]);

  useEffect(() => {
    if (!renameTarget) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setRenameTarget(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [renameTarget]);

  const loadDashboardHistory = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    if (!desktop || !sessionId) return;
    const request = dashboardHistoryRequestRef.current + 1;
    const generation = sessionLoadRequestRef.current;
    dashboardHistoryRequestRef.current = request;
    dashboardHistoryAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardHistoryAbortRef.current = controller;
    setDashboardHistoryLoading(true);
    setDashboardHistoryError(null);
    const stillOwnsDashboard = () => !controller.signal.aborted
      && request === dashboardHistoryRequestRef.current
      && generation === sessionLoadRequestRef.current
      && activeSessionRef.current === sessionId;
    try {
      const entries = await loadCompleteDisplayHistory(
        (beforeSeq) => desktopRequest("session.history", {
          sessionId,
          maxMessages: 100,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
        }, controller.signal, { waitForReconnect: true }),
        stillOwnsDashboard,
      );
      if (!entries || !stillOwnsDashboard()) return;
      setDashboardHistory(mergeDisplayHistory(entries, historyRef.current));
      setDashboardHistorySessionId(sessionId);
    } catch (error) {
      if (stillOwnsDashboard()) setDashboardHistoryError(errorText(error, locale));
    } finally {
      if (request === dashboardHistoryRequestRef.current) {
        dashboardHistoryAbortRef.current = null;
        setDashboardHistoryLoading(false);
      }
    }
  }, [desktop, locale]);

  useEffect(() => {
    if (!sessionDashboardOpen || !activeSessionId || !desktop || dashboardHistoryLoading || dashboardHistoryError || dashboardHistorySessionId === activeSessionId) return;
    void loadDashboardHistory();
  }, [activeSessionId, dashboardHistoryError, dashboardHistoryLoading, dashboardHistorySessionId, desktop, loadDashboardHistory, sessionDashboardOpen]);

  const transcript = useMemo(() => transcriptFromHistory(history, locale), [history, locale]);
  const subagentTranscript = useMemo(() => subagentSession ? transcriptFromHistory(subagentSession.history, locale) : [], [subagentSession, locale]);
  const turnTiming = useMemo(() => turnTimingFromHistory(history), [history]);
  // 会话运行时间：首个事件到最后一个事件（会话运行中则以当前时间延伸，随 jobNow 每秒刷新）。
  const sessionRunningMs = useMemo(
    () => sessionElapsedMs(history, activeRunning ? jobNow : undefined),
    [history, jobNow, activeRunning],
  );
  const dashboardEntries = useMemo(
    () => dashboardHistorySessionId === activeSessionId ? mergeDisplayHistory(dashboardHistory, history) : history,
    [activeSessionId, dashboardHistory, dashboardHistorySessionId, history],
  );
  const dashboardHistoryStats = useMemo(() => readSessionStats(dashboardEntries), [dashboardEntries]);
  const dashboardSessionStats = useMemo(() => sessionStats.tokenUsageSource === "projection"
    ? { ...sessionStats, messages: dashboardHistoryStats.messages }
    : {
        ...sessionStats,
        inputTokens: dashboardHistoryStats.inputTokens,
        outputTokens: dashboardHistoryStats.outputTokens,
        totalTokens: dashboardHistoryStats.totalTokens,
        reasoningTokens: dashboardHistoryStats.reasoningTokens,
        uncachedInputTokens: dashboardHistoryStats.uncachedInputTokens,
        cacheReadTokens: dashboardHistoryStats.cacheReadTokens,
        cacheWriteTokens: dashboardHistoryStats.cacheWriteTokens,
        cacheHitRate: dashboardHistoryStats.cacheHitRate,
        tokenUsageSource: dashboardHistoryStats.tokenUsageSource,
        tokenUsageAvailable: dashboardHistoryStats.tokenUsageAvailable,
        messages: dashboardHistoryStats.messages,
      }, [dashboardHistoryStats, sessionStats]);
  const dashboardRunningMs = useMemo(
    () => sessionElapsedMs(dashboardEntries, activeRunning ? jobNow : undefined),
    [activeRunning, dashboardEntries, jobNow],
  );
  const dashboardAwaitingHistory = activeSessionId !== null
    && dashboardHistorySessionId !== activeSessionId
    && dashboardHistoryError === null;
  const dashboardLoading = dashboardHistoryLoading || dashboardAwaitingHistory;

  // 窗口失焦时停摆装饰动画（用户看不到，且让出渲染资源）。
  useEffect(() => {
    const handleBlur = () => document.body.classList.add("deeptop-window-blurred");
    const handleFocus = () => document.body.classList.remove("deeptop-window-blurred");
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.body.classList.remove("deeptop-window-blurred");
    };
  }, []);

  // 空闲降载：把「存在活动回合/任务」反映到 body 类，CSS 据此停摆运行态光带
  // 等无限动画；否则窗口空闲时合成线程仍为这些装饰动画持续工作。
  // 运行态可能属于侧栏里的其它会话，不能只看当前会话；同时只依赖布尔值，
  // 避免流式历史每帧生成新的 turnTiming 对象，反复重置 CSS 动画。
  const hasLiveJob = activeJobs.some((job) => job.status === "running" || job.status === "stopping");
  const hasLiveTodo = todos?.some((item) => item.status === "in_progress" && item.startedAt !== undefined) ?? false;
  const hasLiveTurn = turnTiming.startedAt !== undefined && turnTiming.finishedAt === undefined;
  const hasLiveSession = sessions.some((session) => session.running) || pendingSessionIds.size > 0;
  const hasLiveActivity = hasLiveSession || hasLiveJob || hasLiveTodo || hasLiveTurn;
  useEffect(() => {
    document.body.classList.toggle("deeptop-activity-live", hasLiveActivity);
    if (!hasLiveActivity) return;
    const timer = window.setInterval(() => setJobNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      document.body.classList.remove("deeptop-activity-live");
    };
  }, [hasLiveActivity]);

  const todoCounts = useMemo(() => ({
    completed: todos?.filter((item) => item.status === "completed").length ?? 0,
    inProgress: todos?.filter((item) => item.status === "in_progress").length ?? 0,
    pending: todos?.filter((item) => item.status === "pending").length ?? 0,
  }), [todos]);
  const todoVisible = todos !== null && todos.length > 0;
  const deliverables = useMemo(() => {
    const deliverableItems = transcript.filter((item) => item.kind === "deliverables");
    return deliverableItems.length > 0
      ? {
          ...deliverableItems[deliverableItems.length - 1],
          files: [...new Set(deliverableItems.flatMap((item) => item.files ?? []))],
          fileDiffs: Object.fromEntries(deliverableItems.flatMap((item) => Object.entries(item.fileDiffs ?? {})).reduce((entries, [path, diff]) => {
            const current = entries.get(path) ?? { added: 0, removed: 0 };
            entries.set(path, { added: current.added + diff.added, removed: current.removed + diff.removed });
            return entries;
          }, new Map<string, { added: number; removed: number }>())),
        }
      : null;
  }, [transcript]);
  const deliverablesVisible = deliverables !== null;
  const filesCollapsed = !filesOpen;
  function selectUtilityPanel(panel: UtilityDockId) {
    const next = activeUtilityPanel === panel ? null : panel;
    setActiveUtilityPanel(next);
    if (next !== "subagent") setSubagentPanelOpen(false);
    setJobNow(Date.now());
  }
  const visibleSessions = useMemo(() => {
    const remoteIds = remoteSearchResults ? new Set(remoteSearchResults.map((item) => item.sessionId)) : undefined;
    const filtered = sessions.filter((session) => {
      if (archivedSessionIds.has(session.sessionId)) return false;
      if (!sessionIsVisible(session, "", remoteSearchResults ? "" : search)) return false;
      return remoteIds ? remoteIds.has(session.sessionId) : true;
    });
    if (!remoteSearchResults) return filtered;
    const order = new Map(remoteSearchResults.map((item, index) => [item.sessionId, index]));
    return filtered.sort((left, right) => (order.get(left.sessionId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.sessionId) ?? Number.MAX_SAFE_INTEGER));
  }, [archivedSessionIds, remoteSearchResults, search, sessions]);
  const searchResultById = useMemo(() => new Map((remoteSearchResults ?? []).map((item) => [item.sessionId, item.snippet])), [remoteSearchResults]);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.sessionId, session])), [sessions]);
  const archivedSessions = useMemo(
    () => [...archivedSessionIds].map((sessionId) => sessionById.get(sessionId)).filter((session): session is DshSessionSummary => session !== undefined),
    [archivedSessionIds, sessionById],
  );
  const workspaceBySessionId = useMemo(() => indexWorkspacesBySessionId(workspaces), [workspaces]);
  const activeSessionView = useMemo(() => buildActiveSessionView(sessions, workspaces, {
    archivedSessionIds,
    indicators: sessionIndicators,
  }), [archivedSessionIds, sessionIndicators, sessions, workspaces]);
  const trayWorkspaceTitles = useMemo(() => new Map(
    [...workspaceBySessionId].map(([sessionId, workspaceItem]) => [sessionId, workspaceItem.title]),
  ), [workspaceBySessionId]);
  const traySessionMenu = useMemo(() => buildTraySessionMenu(sessions, {
    archivedSessionIds,
    indicators: sessionIndicators,
    pendingSessionIds,
    activeSessionId,
    workspaceTitles: trayWorkspaceTitles,
  }, locale), [activeSessionId, archivedSessionIds, pendingSessionIds, sessionIndicators, sessions, trayWorkspaceTitles, locale]);

  useEffect(() => {
    if (!desktop) return;
    void updateTraySessionMenu(traySessionMenu).catch((error) => {
      setErrorNotice(t("notice.trayUpdateFailed", locale, { error: errorText(error, locale) }));
    });
  }, [desktop, setErrorNotice, traySessionMenu]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => sameWorkspacePath(item.path, workspace)) ?? null,
    [workspace, workspaces],
  );
  // 会话区：当前选中工作区的会话（工作区内置顶会话优先）；未选择工作区时显示 Host 未登记的会话。
  const selectedWorkspaceGroup = useMemo<WorkspaceGroup>(() => ({
    workspace: selectedWorkspace,
    workspaceId: selectedWorkspace?.workspaceId ?? "__ungrouped__",
    sessions: sessionsForWorkspace(visibleSessions, workspaces, selectedWorkspace),
  }), [selectedWorkspace, visibleSessions, workspaces]);
  const defaultModelSelection = useMemo<ModelSelection | null>(() => {
    const configured = settings?.namespaces.find((namespace) => namespace.ns === "agent-default-model")?.value;
    const configuredModel = valueAtPath(configured, ["model"]);
    const configuredProvider = valueAtPath(configured, ["provider"]);
    const configuredSelection = configuredModel && typeof configuredModel === "object" && !Array.isArray(configuredModel)
      ? {
        provider: valueAtPath(configuredModel, ["provider"]),
        model: valueAtPath(configuredModel, ["model"]),
        reasoningEffort: valueAtPath(configuredModel, ["reasoningEffort"]),
      }
      : { provider: configuredProvider, model: configuredModel, reasoningEffort: valueAtPath(configured, ["reasoningEffort"]) };
    // RC8 的 groups 是 advisory 目录，不能用它判断当前模型是否可路由。
    // Host 的 session.models.routable/current 才是活动会话的权威状态。
    const isAvailable = (selection: ModelSelection) => Boolean(selection.provider && selection.model);
    if (typeof configuredSelection.provider === "string" && typeof configuredSelection.model === "string") {
      const selection = {
        provider: configuredSelection.provider,
        model: configuredSelection.model,
        ...(typeof configuredSelection.reasoningEffort === "string" ? { reasoningEffort: configuredSelection.reasoningEffort } : {}),
      } satisfies ModelSelection;
      if (isAvailable(selection)) return selection;
    }
    if (storedDefaultModel && isAvailable(storedDefaultModel)) return storedDefaultModel;
    const runtimeProvider = runtimeDetails?.provider;
    const runtimeModel = runtimeDetails?.model;
    if (typeof runtimeProvider === "string" && typeof runtimeModel === "string") {
      return { provider: runtimeProvider, model: runtimeModel };
    }
    const fallbackGroup = hostModels?.groups[0];
    const fallbackModel = fallbackGroup?.models[0];
    return fallbackGroup && fallbackModel ? { provider: fallbackGroup.id, model: fallbackModel.id } : null;
  }, [hostModels, runtimeDetails, settings, storedDefaultModel]);
  const defaultPermission = useMemo<DefaultPermission | null>(() => {
    const configured = settings?.namespaces.find((namespace) => namespace.ns === "permission")?.value;
    const value = valueAtPath(configured, ["defaultPreset"]);
    return isDefaultPermission(value) ? value : storedDefaultPermission;
  }, [settings, storedDefaultPermission]);
  // The official permission namespace declares its defaultPreset enum via the
  // schemastery schema; when present the desktop offers exactly those presets
  // (workspace-write / danger-full-access by default, deployment-extended),
  // and falls back to the local three-tier list only when the namespace or its
  // schema does not expose choices. read-only stays a local-only option.
  const permissionOptions = useMemo(() => {
    const namespace = settings?.namespaces.find((item) => item.ns === "permission");
    const envelope = namespace?.schema;
    if (isSchemaEnvelope(envelope)) {
      const defaultPresetNode = schemaNodeAtPath(envelope, ["defaultPreset"]);
      const choices = schemaEnumChoices(defaultPresetNode, envelope);
      const mapped = choices.map((choice) => ({
        value: String(choice.value),
        name: choice.label ?? String(choice.value),
        ...(choice.description ? { description: choice.description } : {}),
      }));
      if (mapped.length > 0) return mapped;
    }
    return DEFAULT_PERMISSION_OPTIONS;
  }, [settings]);
  const newSessionPermissionSelect = useMemo<DshPermissionSelect | null>(() => {
    const currentValue = draftPermission ?? defaultPermission;
    return currentValue
      ? { options: permissionOptions, currentValue }
      : null;
  }, [defaultPermission, draftPermission, permissionOptions]);
  const composerPermissions = permissionSelect ?? newSessionPermissionSelect;
  const defaultModelName = useMemo(() => {
    if (!defaultModelSelection) return t("modelPicker.defaultModel", locale);
    const provider = hostModels?.groups.find((group) => group.id === defaultModelSelection.provider);
    const model = provider?.models.find((item) => item.id === defaultModelSelection.model)?.name ?? defaultModelSelection.model;
    return `${provider?.name ?? defaultModelSelection.provider} / ${model}`;
  }, [defaultModelSelection, hostModels, locale]);
  const pendingModelSelection = draftModelSelection ?? defaultModelSelection;
  const composerModels = !activeSessionId && hostModels && pendingModelSelection
    ? {
      ...hostModels,
      current: pendingModelSelection,
      contextWindow: hostModels.groups.find((group) => group.id === pendingModelSelection.provider)?.models.find((model) => model.id === pendingModelSelection.model)?.contextWindow,
      routable: true,
    } satisfies DshSessionModels
    : models;
  const composerModelGroups = composerModels ? modelPickerGroups(composerModels, locale) : [];
  const selectedModelSupportsImages = modelSupportsImages(
    composerModelGroups.find((group) => group.id === composerModels?.current.provider)
      ?.models.find((model) => model.id === composerModels?.current.model),
  );
  const modelOptions = useMemo(() => {
    if (!composerModels) return [];
    const options = composerModelGroups.flatMap((group) => group.models.map((model) => ({
      value: `${group.id}\u0000${model.id}`,
      label: `${group.name} / ${model.name}`,
      name: model.name,
      description: model.description,
      provider: group.id,
      model: model.id,
      reasoning: model.reasoning,
    })));
    return options;
  }, [composerModelGroups, composerModels]);
  const selectedModelValue = composerModels ? `${composerModels.current.provider}\u0000${composerModels.current.model}` : "";
  const selectedModel = modelOptions.find((option) => option.value === selectedModelValue);
  const selectedReasoning = selectedModel?.reasoning;
  const selectedReasoningEffort = composerModels?.current.reasoningEffort ?? selectedReasoning?.defaultEffort;
  // 内置 catalog 之外的模型（手写路由、网关新模型）DSH 无从得知思考档位，
  // 但档位本来就是本地声明：这里允许在发送框直接滑选，首次提交时把声明写进
  // 该路由的本地设置，省掉「先去设置里声明再回来选」的往返。
  const reasoningDeclaration = useMemo(() => {
    if (selectedReasoning !== undefined || !settings?.writable) return undefined;
    const selection = composerModels?.current;
    if (!selection) return undefined;
    const provider = providers.find((item) => item.provider === selection.provider && item.settingsNs === "llm-pi-ai");
    const namespace = provider && settings.namespaces.find((item) => item.ns === provider.settingsNs);
    return provider && namespace ? { provider, namespace } : undefined;
  }, [composerModels, providers, selectedReasoning, settings]);
  // 预设档位与声明后的档位列表同形：默认档在最前、档位顺序一致、名称同为
  // 英文，因此声明落地、目录刷新之后滑块与标签都不变。
  const presetReasoningChoices = useMemo<Array<{ key: string; id?: string; name: string; description?: string }>>(() => [
    { key: "provider-default", name: t("reasoning.default", locale) },
    ...Object.keys(MODEL_REASONING_EFFORT_PRESET).map((id) => ({
      key: `effort:${id}`,
      id,
      name: MODEL_REASONING_EFFORT_PRESET_NAMES[id] ?? id,
    })),
  ], [locale]);
  const reasoningChoices: Array<{ key: string; id?: string; name: string; description?: string }> = selectedReasoning === undefined
    ? (reasoningDeclaration ? presetReasoningChoices : [])
    : [
      ...(selectedReasoning.defaultEffort === undefined ? [{ key: "provider-default", name: t("reasoning.default", locale) }] : []),
      ...selectedReasoning.efforts.map((effort) => ({ key: `effort:${effort.id}`, id: effort.id, name: effort.name, description: effort.description })),
    ];
  const selectedReasoningLabel = selectedReasoningEffort !== undefined
    ? reasoningChoices.find((choice) => choice.id === selectedReasoningEffort)?.name ?? selectedReasoningEffort
    : selectedReasoning === undefined ? undefined : t("reasoning.default", locale);

  const goalProjectionLoaded = goal !== undefined;
  const activeGoal = goal && typeof goal === "object" ? goal.goal : null;
  const goalRoundsStarted = goal && typeof goal === "object" ? goal.roundsStarted : 0;
  // 对话、轨迹和会话看板共用同一内容壳；只有对话页显示 Goal、Dock 等会话工具。
  const conversationPageActive = !trajectoryOpen && !sessionDashboardOpen;
  const visibleGoal = conversationPageActive ? activeGoal : null;
  useEffect(() => {
    const next = nextGoalBarState({
      state: goalBarStateRef.current,
      projectionLoaded: goalProjectionLoaded,
      goalId: activeGoal?.id ?? null,
      phase: activeGoal?.phase,
    });
    goalBarStateRef.current = { initialized: next.initialized, goalId: next.goalId, phase: next.phase };
    if (next.collapsed !== null) setGoalBarCollapsed(next.collapsed);
  }, [goalProjectionLoaded, activeGoal?.id, activeGoal?.phase]);
  useEffect(() => {
    if (!conversationPageActive) setGoalPanelOpen(false);
  }, [conversationPageActive]);
  const subagentEntries = subagents?.entries ?? [];
  const childSubagents = subagentEntries.filter((entry): entry is ChildSubagentEntry => entry.kind === "child");
  // 步骤区收起用的「这一轮是否还在推进」：一次模型返回结束后 agent 状态会短暂回到
  // idle，但子代理、后台任务、目标循环、排队输入、等待输入的批准都说明这一轮还没结束；
  // 任一项为真就保持步骤展开，避免轮次途中反复收起再展开。
  const transcriptLoopLive = roundActivityLive({
    agentRunning: activeRunning,
    turnOpen: hasLiveTurn,
    subagentRunning: childSubagents.some((entry) => entry.activity === "running"),
    jobRunning: hasLiveJob,
    goalActive: goal?.goal.phase === "active",
    queuedTurn: queue.length > 0,
    awaitingInput: activeSessionId !== null && pendingSessionIds.has(activeSessionId),
  });
  // 可停靠右栏：停靠状态由布局树权威决定，浮动卡片只负责未停靠时的位置。
  // 看板/轨迹页不显示右栏，但布局保留，回到对话页即恢复。
  /**
   * 面板标签离开右栏的两种归宿：拖出右栏是取消停靠，面板回到浮动卡片；关闭（标签叉
   * 或关闭整组）要连它的浮动卡片一起收起，只留图标条入口——否则“关掉”的面板会又飘
   * 出来，两种操作在面板这侧就分不开了。
   */
  const dockPanelOpenSetters: Record<string, (open: boolean) => void> = {
    "terminal-dock": setTerminalOpen,
    "workspace-files-dock": setFilesOpen,
    "git-dock": setGitOpen,
  };
  const handleDockTabsLeaveRail = (tabs: DockTab[], reason: "undock" | "close") => {
    const open = reason === "undock";
    for (const tab of tabs) dockPanelOpenSetters[tab.kind]?.(open);
  };
  /**
   * 在右栏按行打开文件。标签按路径去重：重复点击是复用并定位到新的行，
   * 而不是再开一个标签。
   */
  const openSessionFile = (path: string, location?: { line?: number }) => {
    const session = sessionsRef.current.find((item) => item.sessionId === activeSessionRef.current);
    const resolved = sessionPath(session?.cwd ?? workspace, path);
    openDockTab({
      kind: "file",
      title: pathBasename(path) || path,
      detail: fileTabDetail(path),
      path: resolved,
      line: location?.line,
    });
  };
  const composerTrigger = useMemo(() => detectComposerTrigger(composer), [composer]);
  const composerCandidates = useMemo<ComposerCandidate[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "reference") {
      const referenceMatches = referenceCandidates;
      const subagentMatches = childSubagents
        .filter((entry) => `${entry.label ?? ""} ${entry.id}`.toLocaleLowerCase().includes(composerTrigger.query.toLocaleLowerCase()))
        .slice(0, 8)
        .map((entry) => {
          const label = entry.label?.trim() || entry.id;
          return { kind: "subagent" as const, id: entry.id, label: `@${label}`, detail: `${subagentModeLabel(entry.mode, locale)} · ${subagentActivityLabel(entry.activity, locale)}`, insertText: `@${label}` };
        });
      return [...referenceMatches, ...subagentMatches].slice(0, 8);
    }
    const commandCandidates = commands
      .filter((command) => `${command.name} ${command.description}`.toLocaleLowerCase().includes(composerTrigger.query))
      .slice(0, 8)
      .map((command) => ({ kind: "command" as const, id: command.name, label: `/${command.name}`, detail: command.description, insertText: `/${command.name}` }));
    const skillCandidates = skills
      .filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(composerTrigger.query))
      .slice(0, 8)
      .map((skill) => ({ kind: "skill" as const, id: skill.name, label: `/${skill.name}`, detail: skill.description, insertText: `/${skill.name}` }));
    return [...commandCandidates, ...skillCandidates].slice(0, 8);
  }, [childSubagents, commands, composerTrigger, referenceCandidates, skills]);
  useEffect(() => {
    const trigger = composerTrigger;
    const requestId = ++referenceRequestRef.current;
    const controller = new AbortController();
    if (!activeSessionId || !trigger || trigger.kind !== "reference" || !capabilityFeatures.references) {
      setReferenceCandidates([]);
      controller.abort();
      return () => controller.abort();
    }
    const query = trigger.query;
    const fileRequest = desktopRequest("reference.files", { sessionId: activeSessionId, query }, controller.signal);
    const sessionRequest = trigger.quoted
      ? Promise.resolve({ items: [] as DshSessionReferenceCandidate[] })
      : desktopRequest("reference.sessions", { sessionId: activeSessionId, query }, controller.signal);
    void Promise.allSettled([fileRequest, sessionRequest]).then(([files, sessions]) => {
      if (controller.signal.aborted || requestId !== referenceRequestRef.current) return;
      const fileItems = files.status === "fulfilled" ? files.value.items : [];
      const sessionItems = sessions.status === "fulfilled" ? sessions.value.items : [];
      setReferenceCandidates(referenceComposerCandidates(fileItems, sessionItems, trigger.quoted === true, locale));
    });
    return () => { controller.abort(); };
  }, [activeSessionId, composerTrigger, capabilityFeatures.references]);
  const activeComposerCandidateIndex = composerCandidates.length === 0
    ? 0
    : Math.min(composerCandidateIndex, composerCandidates.length - 1);
  const selectedSubagentIndex = childSubagents.findIndex((entry) => entry.id === selectedSubagentId);
  const selectedSubagent = selectedSubagentIndex >= 0 ? childSubagents[selectedSubagentIndex] : undefined;
  const providerNamespaces = useMemo(() => new Set(providers.map((provider) => provider.settingsNs)), [providers]);
  // 提示词注入已由插件自带设置面板承载（settings.sections），不再出现在通用命名空间列表里。
  const pluginSettings = useMemo(() => (settings?.namespaces ?? []).filter((namespace) => !providerNamespaces.has(namespace.ns) && namespace.ns !== PROMPT_INJECTION_NS && !["locale", "permission", "ui-conversation", "ui-theme", "ui-onboarding"].includes(namespace.ns)), [providerNamespaces, settings]);
  const subagentRoutingCurrent = useMemo(() => readSubagentRouting(
    settings?.namespaces.find((namespace) => namespace.ns === SUBAGENT_MODEL_SELECTION_NS),
    settings?.namespaces.find((namespace) => namespace.ns === SUBAGENT_ROUTING_NS),
  ), [settings]);
  const visiblePlugins = useMemo(() => {
    const query = pluginSearch.trim().toLocaleLowerCase();
    return (pluginInventory ?? []).filter((plugin) => plugin.compatibility?.supported !== false)
      .filter((plugin) => !query || `${plugin.entryId} ${plugin.moduleName}`.toLocaleLowerCase().includes(query));
  }, [pluginInventory, pluginSearch]);
  const pluginConfigDirty = useMemo(() => JSON.stringify(pluginConfig?.plugins ?? []) !== JSON.stringify(pluginConfigDraft), [pluginConfig, pluginConfigDraft]);

  function applyPluginConfig(description: DshPluginConfigDescription) {
    setPluginConfig(description);
    setPluginConfigDraft(description.plugins);
  }

  async function loadPluginConfig() {
    if (!desktop) return;
    const result = await desktopRequest("plugin.config.describe");
    applyPluginConfig(result);
  }

  function addPlugin(draft: PluginInstallDraft): string | null {
    if (!desktop) return t("err.addPluginDesktopOnly", locale);
    setPluginConfigDraft((current) => [...current, {
      id: draft.id,
      name: draft.name,
      enabled: true,
      system: false,
      compatibility: { supported: true },
    }]);
    setPluginInstallOpen(false);
    setNotice(t("notice.pluginAdded", locale, { draft: draft.id }));
    return null;
  }

  async function pickPluginEntryForInstall(): Promise<string | null> {
    if (!desktop) return null;
    setPluginPickingEntry(true);
    try {
      return await pickPluginEntry();
    } catch (error) {
      setErrorNotice(errorText(error, locale));
      return null;
    } finally {
      setPluginPickingEntry(false);
    }
  }

  async function savePluginConfig(): Promise<boolean> {
    if (!pluginConfig || !settings?.writable || pluginConfigSaving) return false;
    setPluginConfigSaving(true);
    try {
      const result = await desktopRequest("plugin.config.mutate", {
        expectedRevision: pluginConfig.revision,
        plugins: pluginConfigDraft.map(({ id, name, enabled }) => ({ id, name, enabled })),
      });
      applyPluginConfig(result);
      setNotice(t("notice.pluginsSavedRestart", locale));
      return true;
    } catch (error) {
      setErrorNotice(errorText(error, locale));
      return false;
    } finally {
      setPluginConfigSaving(false);
    }
  }

  function cancelPluginConfig() {
    if (pluginConfig) setPluginConfigDraft(pluginConfig.plugins);
  }

  function togglePluginConfig(id: string) {
    setPluginConfigDraft((current) => current.map((plugin) => plugin.id === id ? { ...plugin, enabled: !plugin.enabled } : plugin));
  }

  function removePluginConfig(id: string) {
    setPluginConfigDraft((current) => current.filter((plugin) => plugin.id !== id));
  }

  useEffect(() => {
    try {
      localStorage.setItem("deeptop.sidebar-width", String(sidebarWidth));
    } catch {
      // The native webview may disable storage in a restricted preview.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("deeptop.sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      // The native webview may disable storage in a restricted preview.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("deeptop.theme", themeMode);
    } catch {
      // The native webview may disable storage in a restricted preview.
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode; };
    apply();
    if (themeMode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const resize = sidebarResizeRef.current;
      if (!resize) return;
      setSidebarWidth(Math.min(440, Math.max(300, resize.startWidth + event.clientX - resize.startX)));
    };
    const handlePointerUp = () => {
      sidebarResizeRef.current = null;
      document.body.classList.remove("sidebar-resizing");
    };
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      searchRequestRef.current += 1;
      setRemoteSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => { void searchSessions(); }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function loadSessions(selectFirst = false): Promise<DshSessionSummary[] | undefined> {
    if (!desktop) return undefined;
    const workspaceVersion = workspaceRequestRef.current;
    const [sessionResult, workspaceResult] = await Promise.allSettled([
      desktopRequest("session.list"),
      desktopRequest("workspace.list"),
    ]);
    if (sessionResult.status !== "fulfilled") throw sessionResult.reason;
    const result = sessionResult.value;
    let archivedIds = archivedSessionIds;
    if (workspaceResult.status === "fulfilled" && workspaceVersion === workspaceRequestRef.current) {
      archivedIds = new Set(workspaceResult.value.archivedSessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0));
      commitWorkspaces(workspaceResult.value.items);
      setArchivedSessionIds(archivedIds);
    }
    const unique = [...new Map(result.items.filter((session) => session.sessionId).map((session) => [session.sessionId, session])).values()];
    setSessions(unique);
    if (selectFirst && !activeSessionRef.current) {
      const next = unique.find((session) => !archivedIds.has(session.sessionId) && !session.blank);
      if (next) await openSession(next);
    }
    return unique;
  }

  async function loadRuntimeDetails(sessionItems = sessions) {
    if (!desktop) return;
    const workspaceVersion = workspaceRequestRef.current;
    // Provider 改动只让 Host 目录（llm.models）失效，发送框用的却是活动会话目录
    // （session.models）：分组来自 Host、routable 来自 Host 与投影的比对结果，
    // 所以这里必须一起重取，否则已打开的会话仍显示改动前的模型与可路由状态。
    const activeSessionId = activeSessionRef.current;
    const sessionModelsRequest = activeSessionId
      ? desktopRequest("session.models", { sessionId: activeSessionId })
      : Promise.resolve(null);
    const [hostResult, presetResult, workspaceResult, settingsResult, providerResult, modelResult, pluginResult, pluginConfigResult, capabilityResult, sessionModelsResult] = await Promise.allSettled([
      desktopRequest("host.describe"),
      desktopRequest("agentPreset.list"),
      desktopRequest("workspace.list"),
      desktopRequest("settings.describe"),
      desktopRequest("llm.providers"),
      desktopRequest("llm.models"),
      desktopRequest("plugin.list"),
      desktopRequest("plugin.config.describe"),
      desktopRequest("desktop.capabilities"),
      sessionModelsRequest,
    ]);
    if (hostResult.status === "fulfilled") setRuntimeDetails(hostResult.value);
    if (presetResult.status === "fulfilled") {
      setPresets(presetResult.value.presets);
      setPresetAuthorable(presetResult.value.authorable);
      setPresetHasDocument(presetResult.value.hasDocument);
    }
    if (workspaceResult.status === "fulfilled" && workspaceVersion === workspaceRequestRef.current) {
      let workspaceItems = workspaceResult.value.items;
      let archivedIds = new Set(workspaceResult.value.archivedSessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0));
      const repair = await repairWorkspaceMembership(workspaceItems, sessionItems);
      if (repair.attached > 0) {
        try {
          const refreshed = await desktopRequest("workspace.list");
          workspaceItems = refreshed.items;
          archivedIds = new Set(refreshed.archivedSessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0));
        } catch {
          // The attach writes are durable; the next refresh will pick up the new projection.
        }
      }
      if (workspaceVersion === workspaceRequestRef.current) {
        if (repair.attached > 0 && repair.rejected === 0) setNotice(t("notice.repairAttached", locale, { count: repair.attached }));
        else if (repair.rejected > 0) {
          const message = repair.attached > 0
            ? t("notice.repairPartial", locale, { attached: repair.attached, rejected: repair.rejected, reason: repair.reason ?? "" })
            : t("notice.repairNone", locale, { rejected: repair.rejected, reason: repair.reason ?? "" });
          if (message !== workspaceRepairNoticeRef.current) {
            workspaceRepairNoticeRef.current = message;
            setErrorNotice(message);
          }
        } else {
          workspaceRepairNoticeRef.current = "";
        }
        commitWorkspaces(workspaceItems);
        setArchivedSessionIds(archivedIds);
        if (!workspaceSelectionInitializedRef.current && activeSessionRef.current) {
          setWorkspace(workspacePathForSession(activeSessionRef.current, workspaceItems));
          workspaceSelectionInitializedRef.current = true;
        }
      }
    }
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    if (providerResult.status === "fulfilled") setProviders(providerResult.value.providers);
    if (modelResult.status === "fulfilled") setHostModels(modelResult.value);
    // 晚到的响应不得覆盖用户已切换过去的会话；imageLimits 只在实时投影里，
    // 重取的目录没有它时保留发送框已有的值。
    if (sessionModelsResult.status === "fulfilled" && sessionModelsResult.value && activeSessionRef.current === activeSessionId) {
      const refreshedModels = sessionModelsResult.value;
      setModels((current) => current?.imageLimits && !refreshedModels.imageLimits
        ? { ...refreshedModels, imageLimits: current.imageLimits }
        : refreshedModels);
    }
    if (pluginResult.status === "fulfilled") {
      setPluginInventory(pluginResult.value.entries);
      setExcludedPlugins(pluginResult.value.excluded ?? []);
    }
    if (pluginConfigResult.status === "fulfilled") applyPluginConfig(pluginConfigResult.value);
    if (capabilityResult.status === "fulfilled") {
      setCapabilities(capabilityResult.value);
      const noticeText = capabilityNotice(capabilityResult.value, locale);
      if (noticeText) setNotice(noticeText);
    }
  }

  async function loadSubagents(parentSessionId = activeSessionRef.current) {
    if (!desktop || !parentSessionId) return;
    try {
      setSubagents(await desktopRequest("subagent.list", { parentSessionId }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  /** Expand/collapse one recursive subagent branch; loads children lazily. */
  function toggleSubagentBranch(treeKey: string) {
    setSubagentBranchExpanded((current) => ({ ...current, [treeKey]: !current[treeKey] }));
    if (subagentCatalogs[treeKey] !== undefined) return;
    const childSessionId = subagentTreeChildId(treeKey);
    if (!childSessionId) return;
    setSubagentCatalogs((current) => ({ ...current, [treeKey]: null }));
    setSubagentBranchErrors((current) => {
      const next = { ...current };
      delete next[treeKey];
      return next;
    });
    void desktopRequest("subagent.list", { parentSessionId: childSessionId })
      .then((catalog) => {
        setSubagentCatalogs((current) => ({ ...current, [treeKey]: catalog }));
      })
      .catch((error) => {
        setSubagentBranchErrors((current) => ({ ...current, [treeKey]: errorText(error, locale) }));
        setSubagentCatalogs((current) => {
          const next = { ...current };
          delete next[treeKey];
          return next;
        });
      });
  }

  async function loadCommands(sessionId = activeSessionRef.current) {
    if (!desktop || !sessionId) {
      setCommands([]);
      return;
    }
    if (!capabilityFeatures.commands) {
      setCommands([]);
      return;
    }
    try {
      const result = await desktopRemoteInvoke("commands/list", { agentId: sessionId });
      if (activeSessionRef.current !== sessionId) return;
      setCommands(Array.isArray(result) ? [...result] : []);
    } catch {
      if (activeSessionRef.current !== sessionId) return;
      setCommands([]);
    }
  }

  useEffect(() => {
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
    setActiveUtilityPanel(null);
    setSkills([]);
    setCommands([]);
    setPermissionSelect(null);
    setPlan(null);
    void loadSubagents();
    void loadCurrentSessionSkills(activeSessionId);
    if (activeSessionId) void loadCommands(activeSessionId);
    return () => {
      skillsAbortRef.current?.abort(new Error("会话已切换"));
    };
  }, [activeSessionId, loadCurrentSessionSkills]);

  useEffect(() => {
    setComposerCandidateIndex(0);
    setComposerMenuDismissed(false);
  }, [composerTrigger?.kind, composerTrigger?.query]);

  async function loadSurface(tab: SurfaceTab) {
    if (!desktop || !activeSessionId && ["skills", "subagents", "goal"].includes(tab)) return;
    const requestId = ++surfaceRequestRef.current;
    surfaceAbortRef.current?.abort(new Error("新的页面请求已开始"));
    const controller = new AbortController();
    surfaceAbortRef.current = controller;
    const current = () => !controller.signal.aborted && requestId === surfaceRequestRef.current;
    setSurfaceLoading(true);
    try {
      if (tab === "skills" && activeSessionId) {
        const result = await desktopRequest("skill.list", { sessionId: activeSessionId }, controller.signal, { waitForReconnect: true });
        if (current() && activeSessionRef.current === activeSessionId) setSkills(result.skills);
      }
      if (tab === "subagents" && activeSessionId) {
        const result = await desktopRequest("subagent.list", { parentSessionId: activeSessionId }, controller.signal);
        if (current() && activeSessionRef.current === activeSessionId) setSubagents(result);
      }
      if (tab === "runtime" && activeSessionId) {
        await loadCommands(activeSessionId);
      }
      if (tab === "goal" && activeSessionId) {
        const historyResult = await desktopRequest("session.history", { sessionId: activeSessionId, maxMessages: 100 }, controller.signal);
        if (current() && activeSessionRef.current === activeSessionId) {
          setGoal((historyResult.projections?.values.goal as DshGoalProjection | null | undefined) ?? null);
        }
      }
      if (tab === "settings") {
        const [settingsResult, pluginResult, pluginConfigResult] = await Promise.allSettled([
          desktopRequest("settings.describe", undefined, controller.signal),
          desktopRequest("plugin.list", undefined, controller.signal),
          desktopRequest("plugin.config.describe", undefined, controller.signal),
        ]);
        if (!current()) return;
        if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
        if (pluginResult.status === "fulfilled") {
          setPluginInventory(pluginResult.value.entries);
          setExcludedPlugins(pluginResult.value.excluded ?? []);
        }
        if (pluginConfigResult.status === "fulfilled") applyPluginConfig(pluginConfigResult.value);
      }
    } catch (error) {
      if (current()) setErrorNotice(errorText(error, locale));
    } finally {
      if (current()) {
        setSurfaceLoading(false);
        if (surfaceAbortRef.current === controller) surfaceAbortRef.current = null;
      }
    }
  }

  async function refreshSettings() {
    const result = await desktopRequest("settings.describe");
    setSettings(result);
    return result;
  }

  // 命名空间写入后的刷新。Provider 命名空间直接决定模型路由（Settings > Models
  // 的 JSON/Schema 编辑器也写这里），必须走完整运行时刷新，让 Host 目录与活动
  // 会话目录一起失效；其它命名空间只重读设置视图。
  async function refreshAfterSettingsWrite(ns: string) {
    if (providers.some((provider) => provider.settingsNs === ns)) {
      await loadRuntimeDetails();
      return;
    }
    await refreshSettings();
  }

  function stagePresetForNextSession(id: string) {
    const preset = presets.find((item) => item.id === id && !item.broken);
    if (!preset) return;
    setNextPreset(id);
    setPresetMenuOpen(false);
    setNotice(t("notice.nextSessionPreset", locale, { presetDisplayName_id__presets_: presetDisplayName(id, presets, locale) }));
  }

  async function setDefaultPreset(id: string) {
    const preset = presets.find((item) => item.id === id && !item.broken);
    if (!preset) return;
    try {
      await desktopRequest("settings.update", { ns: "agent-presets", patch: { default: id } });
      setNextPreset("");
      await loadRuntimeDetails();
      setNotice(t("notice.presetDefault", locale, { presetDisplayName_id__presets_: presetDisplayName(id, presets, locale) }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function readPreset(id: string) {
    try {
      const result = await desktopRequest("agentPreset.read", { agentPreset: id });
      setPresetView({ id: result.agentPreset, content: result.content });
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function copyPreset() {
    if (!presetCopy || !presetAuthorable) return;
    const id = presetCopy.id.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setNotice(t("notice.presetIdInvalid", locale));
      return;
    }
    if (presets.some((preset) => preset.id === id)) {
      setNotice(t("notice.presetIdTaken", locale));
      return;
    }
    try {
      await desktopRequest("agentPreset.copy", {
        from: presetCopy.from,
        agentPreset: id,
        ...(presetCopy.name.trim() ? { name: presetCopy.name.trim() } : {}),
      });
      setPresetCopy(null);
      await loadRuntimeDetails();
      await openPresetDocument(id);
      setNotice(t("notice.presetCopied", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function openPresetDocument(id: string) {
    try {
      const result = await desktopRequest("agentPreset.openDocument", { agentPreset: id });
      setNotice(result.opened ? t("notice.presetFolderOpened", locale) : t("notice.presetFolderPath", locale, { path: result.path }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function openSubagent(address: DshSubagentAddress) {
    const requestId = ++subagentRequestRef.current;
    setSelectedSubagentId(address.childSessionId);
    setSubagentSession(null);
    setSubagentLoadError(null);
    setSubagentLoadingId(address.childSessionId);
    try {
      const result = await desktopRequest("subagent.history", { ...address });
      if (requestId !== subagentRequestRef.current) return;
      setSubagentSession({ address, history: result.events });
    } catch (error) {
      if (requestId !== subagentRequestRef.current) return;
      const message = errorText(error, locale);
      setSubagentLoadError(message);
      setErrorNotice(message);
    } finally {
      if (requestId === subagentRequestRef.current) setSubagentLoadingId(null);
    }
  }

  /** 打开任意深度的子 Agent：直接父由树行携带，父会话存活时用官方地址。 */
  function openSubagentEntry(_entry: ChildSubagentEntry, parentSessionId: string, treeKey: string) {
    const childSessionId = subagentTreeChildId(treeKey) ?? _entry.id;
    setActiveUtilityPanel("subagent");
    setSubagentPanelOpen(true);
    void openSubagent({
      parentSessionId,
      childSessionId,
      mode: _entry.mode,
    });
    setNotice(t("notice.openingSubagent", locale, { name: subagentDisplayName(_entry, 0, locale) }));
  }

  /** Workflow 成员卡：childId 即子 session，作为 one-shot 子代理打开执行抽屉。 */
  function openWorkflowChild(childId: string, label: string) {
    const parentSessionId = activeSessionRef.current;
    if (!parentSessionId) {
      setErrorNotice(t("notice.workflowMemberNoSession", locale));
      return;
    }
    setActiveUtilityPanel("subagent");
    setSubagentPanelOpen(true);
    void openSubagent({
      parentSessionId,
      childSessionId: childId,
      mode: "one-shot",
    });
    setNotice(t("notice.openingWorkflowMember", locale, { label: label }));
  }

  async function promptSubagent() {
    if (!subagentSession || !subagentComposer.trim() || subagentSession.address.mode !== "continuable") return;
    try {
      await desktopRequest("subagent.prompt", {
        ...subagentSession.address,
        content: [{ type: "text", text: subagentComposer.trim() }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setSubagentComposer("");
      setNotice(t("notice.subagentSent", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function interruptSubagent(address: DshSubagentAddress) {
    if (address.mode !== "continuable") return;
    try {
      await desktopRequest("subagent.interrupt", { ...address });
      setNotice(t("notice.subagentInterruptRequested", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function syncGoalDraft(nextGoal: DshGoalProjection["goal"] | null) {
    setGoalDraft(nextGoal?.objective ?? "");
    setGoalMaxRoundsDraft(nextGoal ? String(nextGoal.maxGoalRounds) : "");
  }

  function openGoalPanel() {
    if (!activeSessionId) return;
    syncGoalDraft(activeGoal);
    setGoalPanelOpen(true);
  }

  async function createGoal() {
    if (!activeSessionId || !goalDraft.trim() || goalPanelBusy) return;
    const maxGoalRounds = goalMaxRoundsDraft.trim() ? Number(goalMaxRoundsDraft) : undefined;
    if (maxGoalRounds !== undefined && (!Number.isSafeInteger(maxGoalRounds) || maxGoalRounds < 1)) {
      setErrorNotice(t("notice.goalRoundsInvalid", locale));
      return;
    }
    setGoalPanelBusy(true);
    try {
      await desktopRequest("goal.create", { sessionId: activeSessionId, objective: goalDraft.trim(), ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) });
      setGoalDraft("");
      setGoalMaxRoundsDraft("");
      await loadSurface("goal");
      setGoalPanelOpen(false);
      setNotice(t("notice.goalCreated", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      setGoalPanelBusy(false);
    }
  }

  async function mutateGoal(action: GoalAction) {
    if (!activeSessionId || !activeGoal || goalPanelBusy) return;
    const ref: GoalRef = { id: activeGoal.id, revision: activeGoal.revision };
    setGoalPanelBusy(true);
    try {
      if (action === "edit") {
        const maxGoalRounds = Number(goalMaxRoundsDraft);
        if (!goalDraft.trim()) {
          setErrorNotice(t("notice.goalObjectiveEmpty", locale));
          return;
        }
        if (!Number.isSafeInteger(maxGoalRounds) || maxGoalRounds < 1) {
          setErrorNotice(t("notice.goalRoundsInvalid", locale));
          return;
        }
        await desktopRequest("goal.edit", { sessionId: activeSessionId, ref, objective: goalDraft.trim(), maxGoalRounds });
      } else {
        await desktopRequest(`goal.${action}`, { sessionId: activeSessionId, ref });
      }
      await loadSurface("goal");
      if (action === "clear") {
        syncGoalDraft(null);
        setGoalPanelOpen(false);
      } else if (action === "edit") {
        setGoalDraft("");
        setGoalMaxRoundsDraft("");
      }
      setNotice(t("notice.goalMutated", locale, { action: action === "clear" ? t("notice.goalActionCleared", locale) : t("notice.goalActionUpdated", locale) }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      setGoalPanelBusy(false);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    const { ns } = settingsDraft;
    try {
      const patch = parseJsonObject(settingsDraft.value, locale);
      const ops = settingsOps(settingsDraft.original, patch, [], settingsDraft.secrets);
      if (ops.length === 0) {
        setSettingsDraft(null);
        return;
      }
      await desktopRequest("settings.mutate", {
        ns,
        ops,
        expectedRevision: settingsDraft.revision,
      });
      setSettingsDraft(null);
      await refreshAfterSettingsWrite(ns);
      setNotice(t("notice.namespaceUpdated", locale, { ns }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  /** Save a Schema-driven form diff through the official mutate path. */
  async function saveSettingsOps(ns: string, ops: SchemaPathOp[], revision: number, draft: SettingsDraft) {
    if (ops.length === 0) {
      setSettingsDraft(null);
      return;
    }
    setSettingsSaving(true);
    try {
      await desktopRequest("settings.mutate", {
        ns,
        ops,
        expectedRevision: revision,
      });
      if (settingsDraft?.ns === ns) setSettingsDraft(null);
      await refreshAfterSettingsWrite(ns);
      setNotice(t("notice.namespaceUpdated", locale, { ns }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      setSettingsSaving(false);
    }
  }

  /** 保存子代理模型路由：白名单写入官方命名空间，说明写入 Deeptop 路由命名空间。 */
  async function saveSubagentRouting(next: SubagentRoutingSave) {
    const policyNamespace = settings?.namespaces.find((item) => item.ns === SUBAGENT_MODEL_SELECTION_NS);
    const routingNamespace = settings?.namespaces.find((item) => item.ns === SUBAGENT_ROUTING_NS);
    if (!policyNamespace) {
      setErrorNotice(t("subagentRouting.unavailable", locale));
      return;
    }
    const ops = subagentRoutingOps(readSubagentRouting(policyNamespace, routingNamespace), next);
    if (ops.policy.length === 0 && ops.routing.length === 0) return;
    if (ops.routing.length > 0 && !routingNamespace) {
      setErrorNotice(t("subagentRouting.unavailable", locale));
      return;
    }
    setSettingsSaving(true);
    try {
      if (ops.policy.length > 0) {
        await desktopRequest("settings.mutate", { ns: SUBAGENT_MODEL_SELECTION_NS, ops: ops.policy, expectedRevision: policyNamespace.revision });
      }
      if (ops.routing.length > 0 && routingNamespace) {
        await desktopRequest("settings.mutate", { ns: SUBAGENT_ROUTING_NS, ops: ops.routing, expectedRevision: routingNamespace.revision });
      }
      await refreshSettings();
      setNotice(t("subagentRouting.saved", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      setSettingsSaving(false);
    }
  }

  /** Rebuild the draft namespace from the latest settings view for the form. */
  function settingsSchemaNamespace(draft: SettingsDraft, view: DshSettingsDescription | null): DshSettingsNamespace {
    const latest = view?.namespaces.find((item) => item.ns === draft.ns);
    return latest ?? {
      ns: draft.ns,
      schema: draft.schema,
      value: draft.original,
      user: draft.original,
      applies: "restart",
      secrets: draft.secrets.map((path) => ({ path, set: false })),
      revision: draft.revision,
    };
  }

  async function openSession(session: DshSessionSummary, allowAutoRepair = true): Promise<boolean> {
    if (!desktop) return false;
    const loadRequest = ++sessionLoadRequestRef.current;
    const previousSessionId = activeSessionRef.current;
    if (previousSessionId && previousSessionId !== session.sessionId) imageAttachmentCacheRef.current.removeSession(previousSessionId);
    activeSessionRef.current = session.sessionId;
    contextProjectionRef.current = false;
    setCorruptSession(null);
    setPresetMigration(null);
    setPresetMigrationSelection("");
    setSessionIndicators((current) => ({ ...current, [session.sessionId]: "idle" }));
    setActiveSessionId(session.sessionId);
    // Existing sessions follow the Host workspace account. cwd only chooses the
    // working directory when creating a session; it does not imply membership.
    setWorkspace(workspacePathForSession(session.sessionId, workspacesRef.current));
    historyRef.current = [];
    setHistory([]);
    setHistoryHasMore(false);
    clearDashboardHistory();
    setSessionStats(emptySessionStats());
    historyLoadingOlderRef.current = false;
    setHistoryLoadingOlder(false);
    setTranscriptFollowing(true);
    setTodos(null);
    setTrajectoryOpen(false);
    setSessionDashboardOpen(false);
    setQueue([]);
    setQueueEditingId(null);
    setQueueEditingText("");
    setAttachments([]);
    setGoal(undefined);
    goalBarStateRef.current = emptyGoalBarState();
    setGoalBarCollapsed(true);
    setGoalPanelOpen(false);
    setGoalDraft("");
    setGoalMaxRoundsDraft("");
    subagentRequestRef.current += 1;
    setSubagents(null);
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadingId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
    setActiveUtilityPanel(null);
    setSubagentCatalogs({});
    setSubagentBranchExpanded({});
    setSubagentBranchErrors({});
    setPresetView(null);
    setModels(null);
    setDraftModelSelection(null);
    setDraftPermission(null);
    setPermissionSelect(null);
    setLoading(true);
    let historyVersion: HistoryLatestLoad | undefined;
    try {
      const cachedHistory = historyPageCache.get(session.sessionId);
      historyVersion = cachedHistory ? undefined : historyPageCache.beginLatestLoad(session.sessionId);
      const historyRequest = cachedHistory
        ? Promise.resolve({
          events: cachedHistory.entries,
          hasMore: cachedHistory.hasMore,
          ...(cachedHistory.projections ? { projections: cachedHistory.projections } : {}),
        })
        : desktopRequest("session.history", {
          sessionId: session.sessionId,
          maxMessages: HISTORY_PAGE_SIZE,
        }, undefined, { waitForReconnect: true });
      // Keep the expensive model catalog request concurrent, but do not make the
      // transcript wait for it. The conversation is usable as soon as history is ready.
      const modelsRequest = desktopRequest("session.models", { sessionId: session.sessionId }, undefined, { waitForReconnect: true })
        .then((value) => ({ value }), (error) => ({ error }));
      const historyResult = await historyRequest;
      const cacheHistory = historyVersion !== undefined && historyPageCache.isLatestCurrent(session.sessionId, historyVersion);
      if (cacheHistory) {
        historyPageCache.put(session.sessionId, undefined, historyResult.events, historyResult.hasMore, historyResult.projections);
      }
      if (historyVersion !== undefined) historyPageCache.endLatestLoad(session.sessionId, historyVersion);
      if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
      // session.history and its cache already contain compacted display entries.
      const loadedHistory = historyResult.events;
      // Mux events can arrive after the Host history cut while this request is
      // in flight. Merge rather than replace so those post-cut events survive.
      const mergedHistory = mergeDisplayHistory(loadedHistory, historyRef.current);
      historyRef.current = mergedHistory;
      setHistory(mergedHistory);
      setSessionIndicators((current) => ({
        ...current,
        [session.sessionId]: sessionIndicatorForHistory(historyResult.events) ?? "idle",
      }));
      setHistoryHasMore(historyResult.hasMore);
      // Cache the Host projection baseline as well as newer live projections,
      // so subsequent chunk flushes can recompute stats from one authority.
      for (const [key, value] of Object.entries(historyResult.projections?.values ?? {})) {
        sessionProjectionCache.put(session.sessionId, key, value, historyResult.projections?.asOfSeq ?? 0);
      }
      // 会话切换隔离：历史折叠水位（asOfSeq）之上的实时投影由缓存补齐，
      // 缓存按会话隔离，只允许目标会话自己的条目进入当前视图。
      const mergedProjections = overlayProjections(
        historyResult.projections?.values,
        historyResult.projections?.asOfSeq,
        sessionProjectionCache.snapshot(session.sessionId),
      );
      const projectionValues = mergedProjections.values;
      const loadedStats = readSessionStats(mergedHistory, { values: projectionValues });
      contextProjectionRef.current = Boolean(recordValue(projectionValues.contextPressure));
      setSessionStats(loadedStats);
      const projectedImageLimits = imageLimitsFromProjection(projectionValues?.imageLimits);
      setGoal((projectionValues?.goal as DshGoalProjection | null | undefined) ?? null);
      setPermissionSelect((projectionValues?.permissions as DshPermissionSelect | null | undefined) ?? null);
      setPlan((projectionValues?.plan as DshPlanProjection | null | undefined) ?? null);
      const historicalTodos = todosFromHistory(historyResult.events);
      const projectedTodos = projectionValues && Object.prototype.hasOwnProperty.call(projectionValues, "todos")
        ? todoProjection(projectionValues.todos)
        : undefined;
      const mergedTodos = projectedTodos === undefined
        ? historicalTodos
        : projectedTodos === null
          ? null
          : applyTodoSnapshot(historicalTodos, projectedTodos) ?? historicalTodos;
      setTodos(mergedTodos ?? null);
      const modelsResponse = await modelsRequest;
      if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
      if ("error" in modelsResponse) throw modelsResponse.error;
      const modelsResult = modelsResponse.value;
      setSessionStats((current) => ({ ...current, contextLimit: modelsResult.contextWindow ?? current.contextLimit }));
      setModels({ ...modelsResult, ...(projectedImageLimits ? { imageLimits: projectedImageLimits } : {}) });
      if (modelsResult.routable) setNotice(t("notice.sessionOpened", locale));
      else setErrorNotice(t("notice.modelRouteUnavailable", locale));
      // 默认视图至少给一个完整轮次：最新一页落在轮次中间时，后台把这一轮的输入补进来。
      void fillNewestRound(session.sessionId, historyResult.hasMore).catch(() => {
        // 补齐失败不影响会话可用性；用户仍可手动「读取更早消息」。
      });
      return true;
    } catch (error) {
      if (historyVersion !== undefined) historyPageCache.endLatestLoad(session.sessionId, historyVersion);
      if (allowAutoRepair && isSessionLogCorruption(error)) {
        // 崩溃损坏了会话日志（末尾写入不完整）：自动修复一次后重试打开。
        try {
          const repair = await repairCorruptSession(session.sessionId);
          // Do not let a finished repair mutate or reopen a session the user has left.
          if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
          if (repair.repaired) {
            historyPageCache.removeSession(session.sessionId);
            sessionProjectionCache.removeSession(session.sessionId);
            const dropped = [repair.droppedTorn > 0 ? t("notice.logDroppedTorn", locale, { count: repair.droppedTorn }) : null, repair.droppedSeqGap > 0 ? t("notice.logDroppedSeqGap", locale, { count: repair.droppedSeqGap }) : null].filter(Boolean).join("、");
            setNotice(t("notice.logAutoRepaired", locale, { recovered: repair.recoveredEvents, dropped: dropped ? t("notice.logDroppedSuffix", locale, { dropped }) : "" }));
          } else {
            setNotice(t("notice.logRepairedReopen", locale));
          }
        } catch (repairError) {
          if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
          setCorruptSession(session);
          setErrorNotice(t("notice.logAutoRepairFailed", locale, { repairError: errorText(repairError, locale) }));
          return false;
        }
        // 重试一次；loadRequest 守卫保证此次的 loading 状态由重试自身管理。
        return openSession(session, false);
      }
      if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
      if (isSessionLogCorruption(error)) {
        setCorruptSession(session);
      } else {
        const missing = missingAgentPresetInfo(error);
        if (missing) {
          let roster = presets;
          try {
            const rosterResult = await desktopRequest("agentPreset.list");
            roster = rosterResult.presets;
            setPresets(rosterResult.presets);
            setPresetAuthorable(rosterResult.authorable);
            setPresetHasDocument(rosterResult.hasDocument);
          } catch {
            // The resume error still identifies the missing preset; without a fresh roster
            // the dialog deliberately offers no replacement rather than guessing.
          }
          if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
          const availablePresetIds = roster
            .filter((preset) => !preset.broken && preset.id !== missing.missingPreset)
            .map((preset) => preset.id);
          setPresetMigration({ session, missingPreset: missing.missingPreset, availablePresetIds });
          setPresetMigrationSelection(availablePresetIds[0] ?? "");
          setErrorNotice(t("notice.presetMissing", locale, { preset: missing.missingPreset }));
        } else {
          setErrorNotice(errorText(error, locale));
        }
      }
      return false;
    } finally {
      if (loadRequest === sessionLoadRequestRef.current) setLoading(false);
    }
  }

  openSessionRef.current = (session) => openSession(session);

  // 手动修复当前会话的损坏日志并重新打开（自动修复失败时的兜底）。
  async function repairActiveSession() {
    const target = corruptSession ?? activeSession ?? null;
    if (!target || repairingSession) return;
    setRepairingSession(true);
    try {
      const repair = await repairCorruptSession(target.sessionId);
      if (repair.repaired) {
        historyPageCache.removeSession(target.sessionId);
        sessionProjectionCache.removeSession(target.sessionId);
        const dropped = [repair.droppedTorn > 0 ? t("notice.logDroppedTorn", locale, { count: repair.droppedTorn }) : null, repair.droppedSeqGap > 0 ? t("notice.logDroppedSeqGap", locale, { count: repair.droppedSeqGap }) : null].filter(Boolean).join("、");
        setNotice(t("notice.logRepaired", locale, { recovered: repair.recoveredEvents, dropped: dropped ? t("notice.logDroppedSuffix", locale, { dropped }) : "" }));
      } else {
        setNotice(t("notice.logReadableReopen", locale));
      }
      setCorruptSession(null);
      void openSessionRef.current(target);
    } catch (error) {
      setErrorNotice(t("notice.logRepairFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setRepairingSession(false);
    }
  }

  async function openNotificationSession(sessionId: string) {
    if (!runtimeAvailableRef.current || openingNotificationSessionsRef.current.has(sessionId)) return;
    openingNotificationSessionsRef.current.add(sessionId);
    try {
      let session = sessionsRef.current.find((item) => item.sessionId === sessionId);
      if (!session) {
        const loaded = await loadSessions(false);
        session = loaded?.find((item) => item.sessionId === sessionId);
      }
      if (!session) {
        await acknowledgePendingOpenSession(sessionId);
        setNotice(t("notice.notificationSessionGone", locale));
        return;
      }
      const opened = await openSessionRef.current(session);
      if (opened) await acknowledgePendingOpenSession(sessionId);
    } finally {
      openingNotificationSessionsRef.current.delete(sessionId);
    }
  }

  const pendingOpenSessionFlushRef = useRef<Promise<void> | null>(null);
  async function flushPendingOpenSessions() {
    if (pendingOpenSessionFlushRef.current) return pendingOpenSessionFlushRef.current;
    const flush = (async () => {
      const pendingSessionIds = await listPendingOpenSessions();
      for (const sessionId of pendingSessionIds) {
        await openNotificationSession(sessionId);
      }
    })();
    pendingOpenSessionFlushRef.current = flush;
    try {
      await flush;
    } finally {
      if (pendingOpenSessionFlushRef.current === flush) pendingOpenSessionFlushRef.current = null;
    }
  }

  async function refreshSessionStats(sessionId = activeSessionRef.current) {
    if (!desktop || !sessionId) return;
    try {
      const result = await desktopRequest("session.history", {
        sessionId,
        maxMessages: 100,
      }, undefined, { waitForReconnect: true });
      if (activeSessionRef.current !== sessionId) return;
      for (const [key, value] of Object.entries(result.projections?.values ?? {})) {
        sessionProjectionCache.put(sessionId, key, value, result.projections?.asOfSeq ?? 0);
      }
      const mergedProjections = overlayProjections(
        result.projections?.values,
        result.projections?.asOfSeq,
        sessionProjectionCache.snapshot(sessionId),
      );
      const projectedImageLimits = imageLimitsFromProjection(mergedProjections.values.imageLimits);
      if (projectedImageLimits) setModels((current) => current ? { ...current, imageLimits: projectedImageLimits } : current);
      if (recordValue(mergedProjections.values.contextPressure)) contextProjectionRef.current = true;
      const statsHistory = mergeDisplayHistory(result.events, historyRef.current);
      const nextStats = readSessionStats(statsHistory, { values: mergedProjections.values });
      setSessionStats((current) => ({
        ...current,
        ...nextStats,
        contextTokens: nextStats.contextTokensAvailable ? nextStats.contextTokens : current.contextTokens,
        contextTokensAvailable: current.contextTokensAvailable || nextStats.contextTokensAvailable,
        contextLimit: nextStats.contextLimit > 0 ? nextStats.contextLimit : current.contextLimit,
      }));
    } catch {
      // Live projection events remain the primary refresh path; a late history read is best effort.
    }
  }

  /**
   * 打开会话后补齐「最近一轮」：最新一页常常落在这一轮中间，窗口里没有任何一轮的
   * 输入行，默认视图就只能看到输出和过程，看不到用户输入。这里继续向前翻页，直到
   * 窗口里出现一轮输入（`turn/start` 或真实用户提示）为止。
   *
   * 与「读取更早消息」的区别：这里只要求窗口**包含**一轮输入（补齐当前这一轮），
   * 不会为了对齐上一轮输入而截断；两者互斥，手动翻页优先。
   */
  async function fillNewestRound(sessionId: string, hasMoreFromLatestPage: boolean): Promise<void> {
    const loadRequest = sessionLoadRequestRef.current;
    const stillOwnsView = () => sessionLoadRequestRef.current === loadRequest && activeSessionRef.current === sessionId;
    let hasMore = hasMoreFromLatestPage;
    for (let page = 0; page < HISTORY_ROUND_FILL_PAGE_LIMIT && hasMore; page += 1) {
      // 手动翻页（读取更早消息 / 轮次跳转）一旦开始就让它接管，避免两边同时改写窗口。
      if (!stillOwnsView() || historyLoadingOlderRef.current) return;
      if (!needsNewestRoundFill(historyRef.current, hasMore)) return;
      const beforeSeq = displayHistoryStartSeq(historyRef.current);
      if (beforeSeq === undefined) return;
      const cached = historyPageCache.get(sessionId, beforeSeq);
      let pageEntries: DshHistoryEntry[];
      if (cached) {
        pageEntries = cached.entries;
        hasMore = cached.hasMore;
      } else {
        if (!historyPageCache.markLoading(sessionId, beforeSeq)) return;
        try {
          const result = await desktopRequest("session.history", {
            sessionId,
            beforeSeq,
            maxMessages: HISTORY_PAGE_SIZE,
          }, undefined, { waitForReconnect: true });
          pageEntries = result.events;
          hasMore = result.hasMore === true;
          historyPageCache.put(sessionId, beforeSeq, pageEntries, hasMore);
        } finally {
          historyPageCache.unmarkLoading(sessionId, beforeSeq);
        }
      }
      if (!stillOwnsView() || historyLoadingOlderRef.current) return;
      const merged = mergeDisplayHistory(historyRef.current, pageEntries);
      historyRef.current = merged;
      setHistory(merged);
      setHistoryHasMore(hasMore);
      // 不占用 historyLoadingOlderRef：跟随滚动的 effect 据此保持钉在最新输出上。
    }
  }

  /**
   * 「读取更早消息」按轮补齐：一直向前翻到承载「上一轮输入」的那一行，再从这里
   * 截断窗口。固定页数会把某一轮从中间切开，读到的开头永远不是输入；按轮补齐后
   * 每次点击都从上一轮的输入开始，翻过头的内容留在页缓存里供后续复用。
   */
  async function loadOlderHistory() {
    const sessionId = activeSessionId;
    const loadRequest = sessionLoadRequestRef.current;
    const beforeSeq = displayHistoryStartSeq(history);
    if (!sessionId || sessionId !== activeSessionRef.current || beforeSeq === undefined || !historyHasMore || historyLoadingOlderRef.current) return;
    const owner = { sessionId, generation: loadRequest };
    const stillOwnsView = () => ownsHistoryView(owner, activeSessionRef.current, sessionLoadRequestRef.current);
    const scroll = transcriptScroll.current;
    const previousHeight = scroll?.scrollHeight ?? 0;
    const previousTop = scroll?.scrollTop ?? 0;
    const prepend = (entries: DshHistoryEntry[], hasMore: boolean) => {
      if (!stillOwnsView()) return;
      const merged = mergeDisplayHistory(historyRef.current, entries);
      historyRef.current = merged;
      setHistory(merged);
      setHistoryHasMore(hasMore);
      requestAnimationFrame(() => {
        if (!stillOwnsView()) return;
        const nextScroll = transcriptScroll.current;
        if (!nextScroll) return;
        nextScroll.scrollTop = nextScroll.scrollHeight - previousHeight + previousTop;
      });
    };
    historyLoadingOlderRef.current = true;
    setHistoryLoadingOlder(true);
    try {
      let loaded: DshHistoryEntry[] = [];
      let hasMore = true;
      let cursor = beforeSeq;
      for (let page = 0; page < HISTORY_OLDER_PAGE_LIMIT && hasMore; page += 1) {
        // 细粒度分页缓存：同一段历史已拉取过（回看后前进）则直接复用，不重复请求。
        const cached = historyPageCache.get(sessionId, cursor);
        let pageEntries: DshHistoryEntry[];
        if (cached) {
          pageEntries = cached.entries;
          hasMore = cached.hasMore;
        } else {
          // 同一页正在被并发请求（例如轮次跳转翻页）时先放弃，下一次点击继续。
          if (!historyPageCache.markLoading(sessionId, cursor)) break;
          try {
            const result = await desktopRequest("session.history", {
              sessionId,
              beforeSeq: cursor,
              maxMessages: HISTORY_PAGE_SIZE,
            });
            pageEntries = result.events;
            hasMore = result.hasMore === true;
            historyPageCache.put(sessionId, cursor, pageEntries, hasMore);
          } finally {
            historyPageCache.unmarkLoading(sessionId, cursor);
          }
        }
        if (!stillOwnsView()) return;
        loaded = mergeDisplayHistory(loaded, pageEntries);
        // 最近的一轮输入就是「上一轮的输入」：从这里截断，多翻的部分只留在缓存里。
        const boundary = latestRoundInputIndex(loaded);
        if (boundary >= 0) {
          loaded = loaded.slice(boundary);
          break;
        }
        if (!hasMore) break;
        const nextCursor = displayHistoryStartSeq(loaded);
        if (nextCursor === undefined || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      if (loaded.length > 0) prepend(loaded, hasMore);
    } catch (error) {
      if (stillOwnsView()) setErrorNotice(errorText(error, locale));
    } finally {
      if (stillOwnsView()) {
        historyLoadingOlderRef.current = false;
        setHistoryLoadingOlder(false);
      }
    }
  }

  // ── 轮次导航（turn rail） ────────────────────────────────────────────────
  // 会话切换时拉取整场轮次大纲；成功后按会话隔离状态。
  useEffect(() => {
    if (!desktop || activeSessionId === null) {
      if (turnOutlineSessionId !== null) {
        turnOutlineRequestRef.current += 1;
        setTurnOutline([]);
        setTurnOutlineSessionId(null);
        setTurnBusy(null);
        setNavigatedTurn(null);
      }
      return;
    }
    if (turnOutlineSessionId === activeSessionId) return;
    const request = turnOutlineRequestRef.current + 1;
    turnOutlineRequestRef.current = request;
    const controller = new AbortController();
    void desktopRequest("session.turnOutline", { sessionId: activeSessionId }, controller.signal, { waitForReconnect: true })
      .then((value) => {
        if (request !== turnOutlineRequestRef.current) return;
        setTurnOutline(Array.isArray(value?.entries) ? value.entries : []);
        setTurnOutlineSessionId(activeSessionId);
      })
      .catch((error) => {
        if (request === turnOutlineRequestRef.current && !controller.signal.aborted) {
          // 大纲不可用（profile 未挂单元/会话缺失）时静默降级：仅隐藏 rail。
          setTurnOutline([]);
          setTurnOutlineSessionId(activeSessionId);
        }
      });
    return () => { controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, turnOutlineSessionId]);

  // 已加载窗口内派生 loaded 轮次 + 合并大纲 → rail 阶梯。
  const railItems = useMemo(() => {
    if (turnOutlineSessionId !== activeSessionId) return EMPTY_RAIL_ITEMS;
    return mergeTurnRailItems(loadedTurnFacts(history), turnOutline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, turnOutline, turnOutlineSessionId, activeSessionId]);

  // active：最新跳转目标优先；否则已加载窗口内的最大轮次。
  const railActiveTurn = useMemo(() => {
    if (navigatedTurn !== null && railItems.some((item) => item.turn === navigatedTurn)) return navigatedTurn;
    let max = 0;
    for (const item of railItems) if (item.turn > max) max = item.turn;
    return max === 0 ? null : max;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railItems, navigatedTurn]);

  // 滚动 transcript 到包含某 seq 的首条消息行。优先精确匹配行的 event
  // seq；否则找覆盖该 seq 的折叠行（data-seq-from ≤ seq ≤ data-seq）；
  // 仍无则落到首个不早于该 seq 的行（turn/start 等无独立行的 seq 落到
  // 本轮首条可见消息）。翻页后 React 提交可能晚于首帧，因此有界地逐帧
  // 重查（约 10 帧），目标行一出现即滚到。
  const scrollTranscriptToSeq = useCallback((seq: number) => {
    const locate = (scroller: HTMLElement) => {
      const exact = scroller.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
      if (exact) {
        exact.scrollIntoView({ block: "start" });
        return true;
      }
      let covering: HTMLElement | null = null;
      let next: HTMLElement | null = null;
      let nextSeq = Number.POSITIVE_INFINITY;
      for (const row of scroller.querySelectorAll<HTMLElement>("[data-seq]")) {
        const rowSeq = row.dataset.seq === undefined ? NaN : Number(row.dataset.seq);
        const from = row.dataset.seqFrom === undefined ? rowSeq : Number(row.dataset.seqFrom);
        if (!Number.isFinite(rowSeq)) continue;
        if (from <= seq && seq <= rowSeq) {
          covering = row;
          break;
        }
        if (rowSeq >= seq && rowSeq < nextSeq) {
          next = row;
          nextSeq = rowSeq;
        }
      }
      const target = covering ?? next;
      if (target) {
        target.scrollIntoView({ block: "start" });
        return true;
      }
      return false;
    };
    const retry = (scroller: HTMLElement, framesLeft: number) => {
      if (locate(scroller) || framesLeft <= 0) return;
      requestAnimationFrame(() => {
        const next = transcriptScroll.current;
        if (next) retry(next, framesLeft - 1);
      });
    };
    const scroller = transcriptScroll.current;
    if (scroller) retry(scroller, 10);
  }, []);

  // 把历史翻页到覆盖目标 seq（unloaded 轮次跳转）：逐页拉取直到窗口
  // 起点不晚于目标 seq 或没有更早页；页面缓存避免重复请求。
  const loadHistoryThroughSeq = useCallback(async (targetSeq: number): Promise<boolean> => {
    const sessionId = activeSessionId;
    if (!sessionId || sessionId !== activeSessionRef.current) return false;
    const startSeq = displayHistoryStartSeq(historyRef.current);
    if (startSeq !== undefined && startSeq <= targetSeq) return true;
    if (!historyHasMore) return false;
    try {
      while (true) {
        const currentStart = displayHistoryStartSeq(historyRef.current);
        if (currentStart !== undefined && currentStart <= targetSeq) return true;
        const beforeSeq = currentStart;
        if (beforeSeq === undefined) return false;
        const cached = historyPageCache.get(sessionId, beforeSeq);
        let pageEntries: DshHistoryEntry[];
        let pageHasMore: boolean;
        if (cached) {
          pageEntries = cached.entries;
          pageHasMore = cached.hasMore;
        } else {
          const result = await desktopRequest("session.history", {
            sessionId,
            beforeSeq,
            maxMessages: HISTORY_PAGE_SIZE,
          }, undefined, { waitForReconnect: true });
          pageEntries = result.events;
          pageHasMore = result.hasMore === true;
          historyPageCache.put(sessionId, beforeSeq, pageEntries, pageHasMore);
        }
        const merged = mergeDisplayHistory(historyRef.current, pageEntries);
        historyRef.current = merged;
        setHistory(merged);
        setHistoryHasMore(pageHasMore);
        if (!pageHasMore) {
          const start = displayHistoryStartSeq(merged);
          return start !== undefined && start <= targetSeq;
        }
      }
    } finally {
      setTurnBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, historyHasMore]);

  // rail 点击：loaded → 滚动到锚点；unloaded → 先翻页到其 seq 再滚动。
  const handleTurnNavigate = useCallback((item: TurnRailItem) => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    setNavigatedTurn(item.turn);
    if (item.anchor.kind === "loaded") {
      scrollTranscriptToSeq(item.anchor.seq);
      return;
    }
    setTurnBusy(item.turn);
    void loadHistoryThroughSeq(item.anchor.seq)
      .then((covered) => {
        if (covered) scrollTranscriptToSeq(item.anchor.seq);
        else setErrorNotice(t("chat.turnNavigation.loadFailed", locale));
      })
      .finally(() => setTurnBusy(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadHistoryThroughSeq, scrollTranscriptToSeq]);

  async function handleExternalLaunch(request: ExternalLaunchRequest) {
    const path = request.cwd.trim();
    if (!path) throw new Error(t("err.launchWithoutWorkdir", locale));
    const known = workspacesRef.current.find((item) => sameWorkspacePath(item.path, path));
    if (known) {
      await chooseWorkspaceRef.current(known.path);
    } else {
      const result = await desktopRequest("workspace.create", { path });
      workspaceSelectionInitializedRef.current = true;
      setWorkspace(result.workspace.path);
      updateWorkspaces((current) => current.some((item) => item.workspaceId === result.workspace.workspaceId)
        ? current.map((item) => item.workspaceId === result.workspace.workspaceId ? result.workspace : item)
        : [result.workspace, ...current]);
      await syncConversationToWorkspaceRef.current(result.workspace.path, result.workspace);
    }
    setNotice(t("notice.launchedFromPath", locale, { path: path }));
  }

  async function flushPendingExternalLaunches() {
    if (externalLaunchFlushRef.current) return externalLaunchFlushRef.current;
    const flush = (async () => {
      const nativeRequests = await listPendingExternalLaunches();
      let requests = [...externalLaunchQueueRef.current, ...nativeRequests];
      externalLaunchQueueRef.current = [];
      const attempted = new Set<string>();
      for (const request of requests) {
        const key = externalLaunchKey(request);
        if (attempted.has(key)) continue;
        attempted.add(key);
        try {
          await handleExternalLaunch(request);
          await acknowledgePendingExternalLaunch(request.paths);
        } catch (error) {
          if (!externalLaunchQueueRef.current.some((item) => externalLaunchKey(item) === key)) externalLaunchQueueRef.current.push(request);
          setErrorNotice(t("notice.contextMenuLaunchFailed", locale, { error: errorText(error, locale) }));
        }
      }
    })();
    externalLaunchFlushRef.current = flush;
    try {
      await flush;
    } finally {
      if (externalLaunchFlushRef.current === flush) externalLaunchFlushRef.current = null;
    }
  }

  function queueExternalLaunch(request: ExternalLaunchRequest) {
    const key = externalLaunchKey(request);
    if (externalLaunchQueueRef.current.some((item) => externalLaunchKey(item) === key)) return;
    externalLaunchQueueRef.current.push(request);
    if (externalLaunchBootedRef.current && runtimeAvailableRef.current) void flushPendingExternalLaunches();
  }

  async function loadContextMenuStatus() {
    if (!desktop) return;
    try {
      setContextMenuStatus(await getWindowsContextMenuStatus());
    } catch (error) {
      setContextMenuStatus({ supported: false, enabled: false, managed: false, message: errorText(error, locale) });
    }
  }

  async function setContextMenuEnabled(enabled: boolean) {
    if (contextMenuUpdating) return;
    setContextMenuUpdating(true);
    try {
      const next = await setWindowsContextMenuEnabled(enabled);
      setContextMenuStatus(next);
      setNotice(next.message);
    } catch (error) {
      setErrorNotice(t("notice.contextMenuUpdateFailed", locale, { error: errorText(error, locale) }));
      await loadContextMenuStatus();
    } finally {
      setContextMenuUpdating(false);
    }
  }

  async function boot() {
    if (!desktop) {
      setNotice(t("notice.browserPreview", locale));
      return;
    }
    try {
      setStartupLogs([]);
      const nextStatus = await withTimeout(checkDsh(), 10_000, t("notice.dshCheckTimeout", locale));
      runtimeAvailableRef.current = nextStatus.runtimeAvailable;
      seedBridgeLinkStatus(nextStatus);
      setStatus(nextStatus);
      setNotice(nextStatus.message);
      await loadContextMenuStatus();
      if (nextStatus.runtimeAvailable) {
        const loadedSessions = await loadSessions(true);
        await loadRuntimeDetails(loadedSessions);
        externalLaunchBootedRef.current = true;
        await flushPendingOpenSessions();
        await flushPendingExternalLaunches();
      }
    } catch (error) {
      const message = errorText(error, locale);
      runtimeAvailableRef.current = false;
      setStatus((current) => ({ ...current, runtimeAvailable: false, runtimeStarting: false, message }));
      setErrorNotice(message);
    }
  }

  function routeWorkspaceBridgeEvent(event: DshBridgeEvent): boolean {
    if (event.channel !== "host") return false;
    const payload = event.frame.payload;
    if (payload.type === "host/workspace-changed") {
      const changed = workspaceFromHostEvent(payload.workspace);
      if (!changed) return true;
      workspaceRequestRef.current += 1;
      const current = workspacesRef.current;
      const next = upsertWorkspaceProjection(current, changed);
      const activeSessionId = activeSessionRef.current;
      const previousActivePath = activeSessionId ? workspacePathForSession(activeSessionId, current) : "";
      const nextActivePath = activeSessionId ? workspacePathForSession(activeSessionId, next) : "";
      commitWorkspaces(next);
      if (activeSessionId && previousActivePath !== nextActivePath) setWorkspace(nextActivePath);
      return true;
    }
    if (payload.type === "host/workspace-removed") {
      if (typeof payload.workspaceId !== "string") return true;
      workspaceRequestRef.current += 1;
      const current = workspacesRef.current;
      const next = current.filter((workspaceItem) => workspaceItem.workspaceId !== payload.workspaceId);
      const activeSessionId = activeSessionRef.current;
      const previousActivePath = activeSessionId ? workspacePathForSession(activeSessionId, current) : "";
      const nextActivePath = activeSessionId ? workspacePathForSession(activeSessionId, next) : "";
      commitWorkspaces(next);
      setPinnedWorkspaceIds((pinnedIds) => pinnedIds.filter((workspaceId) => workspaceId !== payload.workspaceId));
      if (activeSessionId && previousActivePath !== nextActivePath) setWorkspace(nextActivePath);
      return true;
    }
    if (payload.type === "host/workspace-order-changed") {
      if (!Array.isArray(payload.workspaceIds) || !payload.workspaceIds.every((workspaceId) => typeof workspaceId === "string")) return true;
      workspaceRequestRef.current += 1;
      commitWorkspaces(reorderWorkspaceProjections(workspacesRef.current, payload.workspaceIds));
      return true;
    }
    if (payload.type === "host/archived-sessions-changed") {
      workspaceRequestRef.current += 1;
    }
    return false;
  }

  const routedBridgeEvent = (event: DshBridgeEvent) => {
    if (routeWorkspaceBridgeEvent(event)) return;
    routeBridgeEvent(event, {
    activeSessionRef,
    historyRef,
    contextProjectionRef,
    selectedSubagentRef,
    subagentRequestRef,
    setTodos,
    setHistory,
    setSessionStats,
    setModels,
    setSessions,
    setSubagentSession,
    setQueue,
    setSessionJobs,
    setPermissionSelect,
    setPlan,
    setPendingApprovals,
    setPendingQuestions,
    setPetCompletions,
    setQuestionAnswersBySession,
    setQuestionCustomAnswersBySession,
    setSessionIndicators,
    setLoading,
    setSubagents,
    setArchivedSessionIds,
    setSelectedSubagentId,
    setSubagentLoadingId,
    setSubagentPanelOpen,
    setGoal,
    setNotice,
    locale,
    loadSubagents,
    refreshSessionStats,
    startNewSession,
    onSessionRemoved: (sessionId) => {
      imageAttachmentCacheRef.current.removeSession(sessionId);
      for (const requestId of [...petCompletionPreviewRequestsRef.current]) {
        if (requestId.includes(`:${sessionId}:`)) petCompletionPreviewRequestsRef.current.delete(requestId);
      }
    },
    promoteSessionOnMessage,
    });
  };

  useEffect(() => {
    if (!desktop) return;
    const cleanups: Array<UnlistenFn> = [];
    let disposed = false;
    trackAsyncCleanup(cleanups, listenToRuntimeStatus((nextStatus) => {
      if (disposed) return;
      const wasAvailable = runtimeAvailableRef.current;
      runtimeAvailableRef.current = nextStatus.runtimeAvailable;
      seedBridgeLinkStatus(nextStatus);
      setStatus(nextStatus);
      setNotice(nextStatus.message);
      if (nextStatus.runtimeAvailable) {
        // Came back from an observed down period (DSH crashed or was stopped):
        // the active session may be stuck mid-turn with a frozen transcript and
        // the sidebar may show stale "running" rows. Reconcile both.
        const recovered = runtimeDownRef.current;
        const reopenSessionId = recovered ? downActiveSessionRef.current : null;
        runtimeDownRef.current = false;
        downActiveSessionRef.current = null;
        void (async () => {
          const loadedSessions = await loadSessions(true);
          await loadRuntimeDetails(loadedSessions);
          // The active session id can remain unchanged across a runtime restart,
          // so its Skill projection effect will not necessarily run again.
          await loadCurrentSessionSkills(activeSessionRef.current);
          if (recovered) {
            setLoading(false);
            if (loadedSessions) {
              setSessionIndicators((current) => reconcileSessionIndicators(current, loadedSessions));
            }
            const reopenItem = reopenSessionId
              ? loadedSessions?.find((item) => item.sessionId === reopenSessionId)
              : undefined;
            if (reopenItem) await openSession(reopenItem);
          }
          await flushPendingOpenSessions();
          externalLaunchBootedRef.current = true;
          await flushPendingExternalLaunches();
        })().catch((error) => setErrorNotice(errorText(error, locale)));
      } else if (wasAvailable) {
        // Transitioned from available to unavailable: DSH crashed or was stopped.
        // Its durable history and projection watermarks may have changed before recovery.
        historyPageCache.clear();
        sessionProjectionCache.clear();
        // Remember we must recover, and snapshot the active session so it can be
        // reopened once DSH returns.
        runtimeDownRef.current = true;
        downActiveSessionRef.current = activeSessionRef.current;
      }
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToDiagnostic((message) => {
      if (disposed) return;
      setErrorNotice(message);
      setStatus((current) => current.runtimeAvailable ? current : { ...current, message });
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToRuntimeLog((log) => {
      if (disposed) return;
      setStartupLogs((current) => [...current, log].slice(-160));
      setAppLogs((current) => [...current, log].slice(-2000));
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToNotificationClick((sessionId) => {
      if (disposed) return;
      void openNotificationSession(sessionId).catch((error) => setErrorNotice(errorText(error, locale)));
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToTraySessionOpen((sessionId) => {
      if (disposed) return;
      void openNotificationSession(sessionId).catch((error) => setErrorNotice(errorText(error, locale)));
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToTrayNewChat(() => {
      if (disposed) return;
      startNewSession();
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToSingleInstance(() => {
      if (disposed) return;
      setNotice(t("notice.switchedRunning", locale));
    }), () => disposed);
    trackAsyncCleanup(cleanups, listenToExternalLaunch((request) => {
      if (disposed) return;
      queueExternalLaunch(request);
    }), () => disposed);
    trackAsyncCleanup(cleanups, desktopClientRuntime.remote.on("commands/change", () => {
      if (!disposed) void loadCommands();
    }), () => disposed);
    trackAsyncCleanup(cleanups, desktopClientRuntime.start((event) => {
      if (!disposed) routedBridgeEvent(event);
    }), () => disposed);
    void boot();
    return () => {
      disposed = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      clearQueuedSessionEvents();
    };
  }, [desktop]);

  useEffect(() => {
    if (!transcriptFollowing || historyLoadingOlderRef.current) return;
    transcriptEnd.current?.scrollIntoView({ behavior: "auto" });
  }, [history, loading, transcriptFollowing]);

  async function syncConversationToWorkspace(
    workspacePath: string,
    knownWorkspace?: DshWorkspace | null,
    selectionRequest?: number,
  ) {
    if (!desktop) return;
    let workspaceItem = knownWorkspace;
    // Registered menu items carry their authoritative snapshot. Ungrouped is an
    // absence claim, so refresh it before choosing a conversation; new/external
    // workspace flows also omit a snapshot and use this baseline read.
    if (workspaceItem === undefined || (!workspacePath && workspaceItem === null)) {
      workspaceItem = workspacesRef.current.find((item) => sameWorkspacePath(item.path, workspacePath)) ?? null;
      try {
        const refreshed = await desktopRequest("workspace.list");
        if (!isWorkspaceSelectionCurrent(selectionRequest, workspaceSelectionRequestRef.current)) return;
        commitWorkspaces(refreshed.items);
        if (refreshed.archivedSessionIds) setArchivedSessionIds(new Set(refreshed.archivedSessionIds));
        workspaceItem = workspacePath
          ? refreshed.items.find((item) => sameWorkspacePath(item.path, workspacePath)) ?? workspaceItem
          : null;
      } catch {
        // Keep the current projection when the Host baseline is temporarily unavailable.
      }
    }
    if (!isWorkspaceSelectionCurrent(selectionRequest, workspaceSelectionRequestRef.current)) return;
    const first = firstSessionForWorkspace(
      workspacePath,
      workspaceItem,
      visibleSessions,
      indexWorkspacesBySessionId(workspacesRef.current),
    );
    if (first) {
      if (activeSessionRef.current !== first.sessionId) await openSession(first);
    } else {
      startNewSession(false);
    }
  }

  async function addWorkspace() {
    if (!desktop) {
      setNotice(t("notice.pickDirectoryDesktopOnly", locale));
      return;
    }
    try {
      const picked = await pickWorkspace();
      if (!picked) return;
      workspaceSelectionInitializedRef.current = true;
      setWorkspace(picked);
      setWorkspaceMenuOpen(false);
      setNotice(t("notice.workspaceApplied", locale));
      try {
        const result = await desktopRequest("workspace.create", { path: picked });
        setWorkspace(result.workspace.path);
        updateWorkspaces((current) => current.some((item) => item.workspaceId === result.workspace.workspaceId)
          ? current.map((item) => item.workspaceId === result.workspace.workspaceId ? result.workspace : item)
          : [result.workspace, ...current]);
        const repair = await attachUnregisteredSessions(result.workspace);
        let selected = result.workspace;
        if (repair.attached > 0) {
          const refreshed = await desktopRequest("workspace.list");
          commitWorkspaces(refreshed.items);
          if (refreshed.archivedSessionIds) setArchivedSessionIds(new Set(refreshed.archivedSessionIds));
          selected = refreshed.items.find((item) => item.workspaceId === result.workspace.workspaceId) ?? selected;
        }
        if (repair.rejected > 0) {
          // 目录刚经原生对话框选择并创建成功，拒绝说明既有会话的 cwd 归属无法确认。
          setErrorNotice(repair.attached > 0
            ? t("notice.repairUnconfirmedPartial", locale, { attached: repair.attached, rejected: repair.rejected, reason: repair.reason ?? "" })
            : t("notice.repairUnconfirmed", locale, { rejected: repair.rejected, reason: repair.reason ?? "" }));
        } else if (repair.attached > 0) setNotice(t("notice.repairAttachedSameDir", locale, { count: repair.attached }));
        // 保持对话页面与工作区选择同步：打开新工作区的第一个会话，没有会话则显示新会话页面。
        await syncConversationToWorkspace(result.workspace.path, selected);
      } catch {
        // A session can use a directory even when workspace registration is unavailable.
      }
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  chooseWorkspaceRef.current = chooseWorkspace;
  syncConversationToWorkspaceRef.current = syncConversationToWorkspace;

  async function chooseWorkspace(path: string) {
    const selectionRequest = ++workspaceSelectionRequestRef.current;
    workspaceSelectionInitializedRef.current = true;
    setWorkspace(path);
    setWorkspaceMenuOpen(false);
    setNotice(path ? t("notice.workspaceApplied", locale) : t("notice.workspaceRuntimeDir", locale));
    const selected = workspacesRef.current.find((item) => sameWorkspacePath(item.path, path)) ?? null;
    // The already-loaded projection is sufficient to open the first session.
    // Do not delay navigation for legacy membership repair.
    await syncConversationToWorkspace(path, selected, selectionRequest);
    if (!selected || !isWorkspaceSelectionCurrent(selectionRequest, workspaceSelectionRequestRef.current)) return;
    try {
      const repair = await attachUnregisteredSessions(selected);
      if (!isWorkspaceSelectionCurrent(selectionRequest, workspaceSelectionRequestRef.current)) return;
      if (repair.rejected > 0) {
        setErrorNotice(repair.attached > 0
          ? t("notice.repairFailedPartial", locale, { attached: repair.attached, rejected: repair.rejected, reason: repair.reason ?? "" })
          : t("notice.repairFailed", locale, { rejected: repair.rejected, reason: repair.reason ?? "" }));
      }
      if (repair.attached > 0) {
        const refreshed = await desktopRequest("workspace.list");
        if (!isWorkspaceSelectionCurrent(selectionRequest, workspaceSelectionRequestRef.current)) return;
        commitWorkspaces(refreshed.items);
        if (refreshed.archivedSessionIds) setArchivedSessionIds(new Set(refreshed.archivedSessionIds));
        if (repair.rejected === 0) setNotice(t("notice.repairAttachedSameDir", locale, { count: repair.attached }));
        // The workspace may have appeared empty until this legacy repair. Open
        // its first recovered session unless the user has already started one.
        if (!activeSessionRef.current) {
          const refreshedWorkspace = refreshed.items.find((item) => item.workspaceId === selected.workspaceId) ?? selected;
          await syncConversationToWorkspace(path, refreshedWorkspace, selectionRequest);
        }
      }
    } catch (error) {
      if (selectionRequest === workspaceSelectionRequestRef.current) setErrorNotice(errorText(error, locale));
    }
  }

  async function repairWorkspaceMembership(
    workspaceItems: DshWorkspace[],
    sessionItems: DshSessionSummary[],
    allWorkspaceItems = workspaceItems,
  ): Promise<WorkspaceRepairResult> {
    const registeredSessionIds = new Set(allWorkspaceItems.flatMap((item) => item.sessionIds));
    const candidates = workspaceItems.flatMap((item) => sessionItems
      .filter((session) => Boolean(session.cwd) && sameWorkspacePath(session.cwd, item.path) && !registeredSessionIds.has(session.sessionId))
      .map((session) => ({ item, session })));
    if (candidates.length === 0) return { attached: 0, rejected: 0 };
    // The official attach operation performs canonical-path validation; this is only a candidate hint.
    const results = await Promise.allSettled(candidates.map(({ item, session }) => desktopRequest("workspace.attachSession", {
      workspaceId: item.workspaceId,
      sessionId: session.sessionId,
    })));
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    return {
      attached: results.length - rejected.length,
      rejected: rejected.length,
      ...(rejected.length === 0 ? {} : { reason: errorText(rejected[0]!.reason, locale) }),
    };
  }

  async function attachUnregisteredSessions(item: DshWorkspace): Promise<WorkspaceRepairResult> {
    const current = workspacesRef.current;
    const allWorkspaceItems = current.some((workspaceItem) => workspaceItem.workspaceId === item.workspaceId)
      ? current
      : [...current, item];
    return repairWorkspaceMembership([item], sessionsRef.current, allWorkspaceItems);
  }

  // 置顶工作区：置顶后固定显示在侧栏工作区列表最上方，保持置顶顺序。
  function togglePinWorkspace(item: DshWorkspace) {
    setPinnedWorkspaceIds((current) => current.includes(item.workspaceId)
      ? current.filter((workspaceId) => workspaceId !== item.workspaceId)
      : [...current, item.workspaceId]);
  }

  async function renameWorkspace(item: DshWorkspace) {
    const title = await requestPrompt(t("dialog.workspaceRename.title", locale), item.title, t("dialog.workspaceRename.description", locale));
    if (!title?.trim() || title.trim() === item.title) return;
    try {
      const result = await desktopRequest("workspace.rename", {
        workspaceId: item.workspaceId,
        title: title.trim(),
      });
      updateWorkspaces((current) => current.map((workspaceItem) => workspaceItem.workspaceId === item.workspaceId
        ? { ...result.workspace, pinnedSessionIds: result.workspace.pinnedSessionIds ?? workspaceItem.pinnedSessionIds }
        : workspaceItem));
      setNotice(t("notice.workspaceRenamed", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function removePreset(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset || preset.trust !== "user") return;
    if (!await requestConfirm(t("dialog.deletePreset", locale, { preset: presetDisplayName(id, presets, locale) }))) return;
    try {
      await desktopRequest("agentPreset.remove", { agentPreset: id });
      if (nextPreset === id) setNextPreset("");
      setPresetView((current) => current?.id === id ? null : current);
      await loadRuntimeDetails();
      setNotice(t("notice.presetDeleted", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function deleteWorkspace(item: DshWorkspace) {
    if (!await requestConfirm(t("dialog.deleteWorkspace", locale, { workspace: item.title || projectName(item.path, locale) }))) return;
    try {
      await desktopRequest("workspace.delete", { workspaceId: item.workspaceId });
      updateWorkspaces((current) => current.filter((workspaceItem) => workspaceItem.workspaceId !== item.workspaceId));
      setPinnedWorkspaceIds((current) => current.filter((workspaceId) => workspaceId !== item.workspaceId));
      if (workspace === item.path) setWorkspace("");
      setNotice(t("notice.workspaceRemoved", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function performMoveSessionBefore(sessionId: string, beforeSessionId: string, announce = true) {
    if (sessionId === beforeSessionId) return;
    const targetWorkspace = workspacesRef.current.find((item) => item.sessionIds.includes(beforeSessionId));
    if (!targetWorkspace) {
      setNotice(t("notice.ungroupedSortBlocked", locale));
      return;
    }
    const workspaceVersion = ++workspaceRequestRef.current;
    try {
      const attachedSessionIds = new Set(targetWorkspace.sessionIds);
      for (const candidateSessionId of [beforeSessionId, sessionId]) {
        if (attachedSessionIds.has(candidateSessionId)) continue;
        await desktopRequest("workspace.attachSession", {
          workspaceId: targetWorkspace.workspaceId,
          sessionId: candidateSessionId,
        });
        attachedSessionIds.add(candidateSessionId);
      }
      await desktopRequest("workspace.insertSessionBefore", {
        workspaceId: targetWorkspace.workspaceId,
        sessionId,
        beforeSessionId,
      });

      // Apply the committed order immediately. The drag preview must not wait
      // for the broad runtime refresh below, otherwise the row can snap back
      // to the stale workspace projection after the pointer is released.
      const nextSessionIds = targetWorkspace.sessionIds.filter((candidate) => candidate !== sessionId);
      const targetIndex = nextSessionIds.indexOf(beforeSessionId);
      if (targetIndex >= 0) nextSessionIds.splice(targetIndex, 0, sessionId);
      const nextWorkspaces = workspacesRef.current.map((item) => item.workspaceId === targetWorkspace.workspaceId
        ? { ...item, sessionIds: nextSessionIds }
        : { ...item, sessionIds: item.sessionIds.filter((candidate) => candidate !== sessionId) });
      commitWorkspaces(nextWorkspaces);

      // Read back only the authoritative workspace projection. A broad runtime
      // refresh is slower and can briefly restore a stale sessionIds array.
      const refreshed = await desktopRequest("workspace.list");
      if (workspaceVersion !== workspaceRequestRef.current) return;
      commitWorkspaces(refreshed.items);
      if (refreshed.archivedSessionIds) setArchivedSessionIds(new Set(refreshed.archivedSessionIds));
      if (announce) setNotice(t("notice.sessionOrderUpdated", locale));
    } catch (error) {
      if (announce) setErrorNotice(errorText(error, locale));
    }
  }

  async function performToggleSessionPin(session: DshSessionSummary) {
    if (!desktop) return;
    const currentWorkspace = workspacesRef.current.find((item) => item.sessionIds.includes(session.sessionId));
    if (!currentWorkspace) {
      setNotice(t("notice.ungroupedPinBlocked", locale));
      return;
    }
    const pinned = new Set(currentWorkspace.pinnedSessionIds ?? []);
    const nextPinned = !pinned.has(session.sessionId);
    try {
      const result = await desktopRequest("workspace.setSessionPinned", {
        workspaceId: currentWorkspace.workspaceId,
        sessionId: session.sessionId,
        pinned: nextPinned,
      });
      const nextWorkspaces = workspacesRef.current.map((item) => item.workspaceId === result.workspaceId
        ? { ...item, pinnedSessionIds: result.pinnedSessionIds }
        : item);
      commitWorkspaces(nextWorkspaces);
      setNotice(nextPinned ? t("notice.sessionPinned", locale) : t("notice.sessionUnpinned", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function toggleSessionPin(session: DshSessionSummary) {
    const mutation = workspaceMutationQueueRef.current
      .catch(() => undefined)
      .then(() => performToggleSessionPin(session));
    workspaceMutationQueueRef.current = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  function moveSessionBefore(sessionId: string, beforeSessionId: string, announce = true) {
    const mutation = workspaceMutationQueueRef.current
      .catch(() => undefined)
      .then(() => performMoveSessionBefore(sessionId, beforeSessionId, announce));
    workspaceMutationQueueRef.current = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  function promoteSessionOnMessage(sessionId: string) {
    if (!desktop) return;
    const currentWorkspace = workspacesRef.current.find((item) => item.sessionIds.includes(sessionId));
    if (!currentWorkspace || currentWorkspace.sessionIds[0] === sessionId) return;
    void moveSessionBefore(sessionId, currentWorkspace.sessionIds[0], false);
  }

  function startNewSession(cancelWorkspaceSelection = true) {
    const previousSessionId = activeSessionRef.current;
    if (previousSessionId) imageAttachmentCacheRef.current.removeSession(previousSessionId);
    activeSessionRef.current = null;
    contextProjectionRef.current = false;
    if (cancelWorkspaceSelection) workspaceSelectionRequestRef.current += 1;
    sessionLoadRequestRef.current += 1;
    setLoading(false);
    historyLoadingOlderRef.current = false;
    setActiveSessionId(null);
    historyRef.current = [];
    setHistory([]);
    setHistoryHasMore(false);
    clearDashboardHistory();
    setHistoryLoadingOlder(false);
    setTranscriptFollowing(true);
    setTodos(null);
    setTrajectoryOpen(false);
    setSessionDashboardOpen(false);
    setComposer("");
    setAttachments([]);
    setModels(null);
    setDraftModelSelection(null);
    setDraftPermission(null);
    setSessionStats(emptySessionStats());
    setCommands([]);
    setPermissionSelect(null);
    setPlan(null);
    setQueue([]);
    setQueueEditingId(null);
    setQueueEditingText("");
    setGoal(undefined);
    goalBarStateRef.current = emptyGoalBarState();
    setGoalBarCollapsed(true);
    setGoalPanelOpen(false);
    setGoalDraft("");
    setGoalMaxRoundsDraft("");
    subagentRequestRef.current += 1;
    setSubagents(null);
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadingId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
    setActiveUtilityPanel(null);
    setSubagentCatalogs({});
    setSubagentBranchExpanded({});
    setSubagentBranchErrors({});
    setPresetMenuOpen(false);
    setNotice(t("notice.createOnMessage", locale));
  }

  async function ensureSession() {
    if (activeSessionRef.current) return activeSessionRef.current;
    if (creatingSessionRef.current) return creatingSessionRef.current;
    const creation = (async () => {
    const presetId = nextPreset || presets.find((preset) => preset.isDefault)?.id;
    const selectedWorkspace = workspaces.find((item) => sameWorkspacePath(item.path, workspace));
    const requestedModel = draftModelSelection ?? defaultModelSelection;
    const requestedPermission = draftPermission ?? defaultPermission;
    const hasHostPermissionNamespace = settings?.namespaces.some((item) => item.ns === "permission") ?? false;
    const created = await desktopRequest("session.create", {
      ...(selectedWorkspace ? { workspaceId: selectedWorkspace.workspaceId } : workspace ? { cwd: workspace } : {}),
      ...(presetId ? { agentPreset: presetId } : {}),
    });
    activeSessionRef.current = created.sessionId;
    setActiveSessionId(created.sessionId);
    if (requestedModel) {
      await desktopRequest("session.selectModel", {
        sessionId: created.sessionId,
        provider: requestedModel.provider,
        model: requestedModel.model,
        ...(requestedModel.reasoningEffort === undefined ? {} : { reasoningEffort: requestedModel.reasoningEffort }),
      });
    }
    // Profiles without the official permission namespace still get the desktop
    // fallback applied to the new session. A Host-owned namespace applies its
    // value during session creation, so it remains the source of truth there.
    if (requestedPermission && (!hasHostPermissionNamespace || draftPermission !== null)) {
      await executeCommandLine(created.sessionId, `/permission ${requestedPermission}`);
    }
    // session.create also emits host/session-added. Do not prepend an optimistic
    // row here: the event and the next list refresh are the source of truth and
    // otherwise the same newly-created session can appear twice.
    // The host session API may accept workspaceId without updating the desktop
    // workspace registry, so make the membership write explicit before loading
    // the projections used by the sidebar.
    if (selectedWorkspace) {
      const attached = await desktopRequest("workspace.attachSession", {
        workspaceId: selectedWorkspace.workspaceId,
        sessionId: created.sessionId,
      });
      updateWorkspaces((current) => current.map((item) =>
        item.workspaceId === attached.workspace.workspaceId ? attached.workspace : item,
      ));
    }
    const nextSessions = await loadSessions();
    await loadRuntimeDetails(nextSessions ?? []);
    setDraftModelSelection(null);
    setDraftPermission(null);
    setNextPreset("");
    setPresetMenuOpen(false);
    const nextModels = await desktopRequest("session.models", { sessionId: created.sessionId });
    const historyResult = await desktopRequest("session.history", {
      sessionId: created.sessionId,
      maxMessages: 1,
    });
    const projectedImageLimits = imageLimitsFromProjection(historyResult.projections?.values?.imageLimits);
    setModels({ ...nextModels, ...(projectedImageLimits ? { imageLimits: projectedImageLimits } : {}) });
    if (nextModels.contextWindow !== undefined) setSessionStats((current) => ({ ...current, contextLimit: nextModels.contextWindow! }));
    if (!nextModels.routable) {
      setErrorNotice(t("notice.modelUnavailable", locale));
    }
    return created.sessionId;
    })();
    creatingSessionRef.current = creation;
    try {
      return await creation;
    } finally {
      if (creatingSessionRef.current === creation) creatingSessionRef.current = null;
    }
  }

  async function executeCommandLine(sessionId: string, line: string) {
    const execution = await desktopRemoteInvoke("commands/execute", {
      agentId: sessionId,
      line,
      submittedAttachments: [],
    });
    if (!execution) {
      setErrorNotice(t("notice.unknownCommand", locale, { line: line }));
      return undefined;
    }
    if (execution.result.kind === "error") setErrorNotice(execution.result.text);
    return execution;
  }

  async function sendPrompt() {
    const text = composer.trim();
    if ((!text && attachments.length === 0) || loading || !status.runtimeAvailable) return;
    if (activeSessionId && models && !models.routable) {
      setErrorNotice(t("notice.modelUnavailable", locale));
      return;
    }
    if (attachments.length > 0) {
      if (!selectedModelSupportsImages) {
        setErrorNotice(t("notice.imagesNotSupported", locale));
        return;
      }
    }
    setLoading(true);
    // An idle session has no turn to steer, so the preferred mode applies only
    // while one is running; the notices and the payload share this resolution.
    const submitMode = resolveSubmitMode(promptMode, activeRunning);
    setNotice(submitMode === "steer" ? t("notice.steering", locale) : t("notice.sending", locale));
    try {
      const sessionId = await ensureSession();
      const admissionModels = await desktopRequest("session.models", { sessionId });
      setModels((current) => current?.imageLimits ? { ...admissionModels, imageLimits: current.imageLimits } : admissionModels);
      if (!admissionModels.routable) {
        setErrorNotice(t("notice.modelUnavailable", locale));
        return;
      }
      const commandName = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(text)?.[1].toLocaleLowerCase();
      if (!attachments.length && commandName && commands.some((command) => command.name === commandName)) {
        setNotice(t("notice.executingCommand", locale, { commandName: commandName }));
        const execution = await executeCommandLine(sessionId, text);
        if (!execution || execution.result.kind === "error") return;
        setComposer("");
        if (commandName === "export") {
          await exportSessionZip(sessionId);
        } else {
          setNotice(execution.result.text || t("notice.commandExecuted", locale, { command: commandName }));
        }
        return;
      }
      const promptPayload: DshSessionPromptPayload = {
        sessionId,
        mode: submitMode,
        content: promptContentParts(text, attachments),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      await desktopRequest("session.prompt", { ...promptPayload });
      setComposer("");
      setAttachments([]);
      void refreshSessionStats(sessionId);
      setNotice(submitMode === "steer" ? t("notice.steered", locale) : t("notice.sent", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      setLoading(false);
    }
  }

  async function cancelSession() {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    try {
      await desktopRequest("session.cancel", { sessionId });
      setNotice(t("notice.stopRequested", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function handleComposerAction() {
    void sendPrompt();
  }

  function addPathToComposer(path: string) {
    const textarea = composerRef.current;
    const selectionStart = textarea?.selectionStart ?? composer.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const inserted = insertComposerText(composer, path, selectionStart, selectionEnd);
    setComposer(inserted.value);
    setComposerMenuDismissed(true);
    window.requestAnimationFrame(() => {
      const nextTextarea = composerRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
    });
    setNotice(t("notice.pathAddedToComposer", locale));
  }

  function updateSendShortcut(shortcut: SendShortcut) {
    setSendShortcut(shortcut);
    try {
      localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, shortcut);
    } catch {
      // The native webview may disable storage in a restricted preview.
    }
  }

  async function forkSession(sessionId: string = activeSessionId ?? "", atSeq?: number) {
    if (!sessionId) return;
    try {
      const result = await desktopRequest("session.fork", {
        sessionId,
        ...(atSeq === undefined ? {} : { atSeq }),
      });
      const nextSessions = await loadSessions();
      const forked = nextSessions?.find((session) => session.sessionId === result.sessionId);
      if (forked) await openSession(forked);
      else setNotice(t("notice.forkCreated", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function migrateMissingPreset() {
    if (!presetMigration || !presetMigrationSelection || presetMigrationRunning) return;
    const replacement = presets.find((preset) => preset.id === presetMigrationSelection && !preset.broken);
    if (!replacement) {
      setErrorNotice(t("notice.chooseAvailablePreset", locale));
      return;
    }
    const confirmed = await requestConfirm(
      t("dialog.presetMigration.confirmFull", locale, { preset: presetMigration.missingPreset, replacement: presetDisplayName(replacement.id, presets, locale), id: replacement.id }),
    );
    if (!confirmed) return;
    setPresetMigrationRunning(true);
    try {
      const result = await desktopRequest("session.fork", {
        sessionId: presetMigration.session.sessionId,
        agentPreset: replacement.id,
      });
      const nextSessions = await loadSessions();
      const migrated = nextSessions?.find((session) => session.sessionId === result.sessionId);
      setPresetMigration(null);
      if (migrated) {
        await openSession(migrated, false);
        setNotice(t("notice.migratedCopy", locale, { preset: presetDisplayName(replacement.id, presets, locale) }));
      } else {
        setNotice(t("notice.presetMigratedShort", locale));
      }
    } catch (error) {
      setErrorNotice(t("notice.presetMigrationFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setPresetMigrationRunning(false);
    }
  }

  async function loadHistoryForRetry(sessionId: string, targetSeq: number) {
    const pages: DshHistoryEntry[] = [];
    let beforeSeq: number | undefined;
    let targetFound = false;
    for (let page = 0; page < 100; page += 1) {
      const result = await desktopRequest("session.history", {
        sessionId,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: 100,
      });
      pages.unshift(...result.events);
      if (result.events.some((entry) => entry.event.seq === targetSeq)) targetFound = true;
      const hasPreviousTurn = pages.some((entry) => entry.event.type === "turn/end" && entry.event.seq < targetSeq);
      if (targetFound && hasPreviousTurn) return pages;
      if (!result.hasMore || result.events.length === 0) break;
      const firstSeq = result.events[0]?.event.seq;
      if (firstSeq === undefined || (beforeSeq !== undefined && firstSeq >= beforeSeq)) break;
      beforeSeq = firstSeq;
    }
    return pages;
  }

  async function retryMessage(targetSeq: number) {
    const sessionId = activeSessionRef.current;
    if (!sessionId || activeRunning || loading || retryingMessageRef.current !== null) return;
    if (!await requestConfirm(t("dialog.retry.confirm", locale))) return;
    retryingMessageRef.current = targetSeq;
    retryingSessionRef.current = sessionId;
    setRetryingMessageSeq(targetSeq);
    setLoading(true);
    setNotice(t("notice.creatingRetryBranch", locale));
    try {
      const entries = await loadHistoryForRetry(sessionId, targetSeq);
      const target = entries.find((entry) => entry.event.seq === targetSeq)?.event;
      if (!target || target.type !== "user/message" || isInjectedMessage(target)) {
        throw new Error(t("err.retryNoMessage", locale));
      }
      const sourceParts = retryPromptSourceParts(target.data.content, locale);
      if (sourceParts.length === 0) throw new Error(t("err.retryNoPrompt", locale));

      const hydratedContent: DshPromptContentPart[] = await Promise.all(sourceParts.map(async (part) => {
        if (part.type === "text" || part.data) return part.type === "image" ? {
          type: "image" as const,
          mediaType: part.mediaType,
          data: part.data!,
          ...(part.name ? { name: part.name } : {}),
        } : part;
        const attachment = await desktopRequest("session.attachment", {
          sessionId,
          attachmentId: part.attachmentId!,
        });
        if (attachment.attachment.mediaType !== part.mediaType) throw new Error(t("err.mediaMismatch", locale));
        return {
          type: "image" as const,
          mediaType: part.mediaType,
          data: attachment.data,
          ...(part.name || attachment.attachment.name ? { name: part.name || attachment.attachment.name } : {}),
        };
      }));
      if (activeSessionRef.current !== sessionId) throw new Error(t("err.retrySessionSwitched", locale));
      const boundary = retryBoundarySeq(entries, targetSeq);
      let retrySessionId: string;
      if (boundary !== undefined) {
        const fork = await desktopRequest("session.fork", {
          sessionId,
          atSeq: boundary,
        });
        retrySessionId = fork.sessionId;
      } else {
        const sourceSession = sessions.find((session) => session.sessionId === sessionId);
        const selectedWorkspace = workspaces.find((item) => item.sessionIds.includes(sessionId));
        const created = await desktopRequest("session.create", {
          ...(selectedWorkspace ? { workspaceId: selectedWorkspace.workspaceId } : sourceSession?.cwd ? { cwd: sourceSession.cwd } : workspace ? { cwd: workspace } : {}),
          ...(sourceSession?.agentPreset ? { agentPreset: sourceSession.agentPreset } : {}),
        });
        retrySessionId = created.sessionId;
        if (selectedWorkspace) {
          await desktopRequest("workspace.attachSession", {
            workspaceId: selectedWorkspace.workspaceId,
            sessionId: retrySessionId,
          });
        }
        if (models?.current) {
          await desktopRequest("session.selectModel", {
            sessionId: retrySessionId,
            provider: models.current.provider,
            model: models.current.model,
            ...(models.current.reasoningEffort === undefined ? {} : { reasoningEffort: models.current.reasoningEffort }),
          });
        }
      }
      const sourceSession = sessions.find((session) => session.sessionId === sessionId);
      if (activeSessionRef.current !== sessionId) throw new Error(t("err.retrySessionSwitched", locale));
      const nextSessions = await loadSessions().catch(() => undefined);
      const forked = nextSessions?.find((session) => session.sessionId === retrySessionId) ?? {
        sessionId: retrySessionId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        ...(sourceSession?.cwd || workspace ? { cwd: sourceSession?.cwd ?? workspace } : {}),
        ...(sourceSession?.agentPreset ? { agentPreset: sourceSession.agentPreset } : {}),
      } satisfies DshSessionSummary;
      if (activeSessionRef.current !== sessionId) throw new Error(t("err.retrySessionSwitched", locale));
      await openSession(forked);
      if (activeSessionRef.current !== retrySessionId) throw new Error(t("err.retrySessionSwitchedFinal", locale));
      await desktopRequest("session.prompt", {
        sessionId: retrySessionId,
        mode: "queue",
        content: hydratedContent,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setLoading(false);
      setNotice(t("notice.retryStarted", locale));
      void refreshSessionStats(retrySessionId);
    } catch (error) {
      if (activeSessionRef.current === sessionId) {
        setErrorNotice(errorText(error, locale));
        setLoading(false);
      }
    } finally {
      retryingMessageRef.current = null;
      retryingSessionRef.current = null;
      setRetryingMessageSeq(null);
    }
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(t("notice.messageCopied", locale));
    } catch (error) {
      setErrorNotice(t("notice.copyFailed", locale, { error: errorText(error, locale) }));
    }
  }

  async function copySelection(text: string) {
    try {
      await writeClipboard(text);
      setNotice(t("notice.selectionCopied", locale));
    } catch (error) {
      setErrorNotice(t("notice.copyFailed", locale, { error: errorText(error, locale) }));
    }
  }

  async function archiveSessions(targets: readonly DshSessionSummary[]) {
    const sessionsToArchive = [...new Map(targets.map((session) => [session.sessionId, session])).values()];
    if (sessionsToArchive.length === 0 || archiveMutationPendingRef.current) return;
    archiveMutationPendingRef.current = true;
    setArchiveMutationPending(true);
    try {
      const results = await Promise.allSettled(sessionsToArchive.map((session) => desktopRequest("workspace.archiveSession", { sessionId: session.sessionId })));
      const archived = results.flatMap((result, index) => result.status === "fulfilled" ? [sessionsToArchive[index]] : []);
      if (archived.length > 0) {
        setArchivedSessionIds((current) => new Set([...current, ...archived.map((session) => session.sessionId)]));
        if (archived.some((session) => session.sessionId === activeSessionRef.current)) startNewSession();
      }
      setArchiveTargets(null);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) setErrorNotice(t("notice.sessionArchivePartial", locale, { archived: archived.length, total: sessionsToArchive.length, error: errorText(failed.reason, locale) }));
      else setNotice(t(sessionsToArchive.length === 1 ? "notice.sessionArchived" : "notice.sessionsArchived", locale, { count: archived.length }));
      if (archived.length > 0) void loadSessions().catch((error) => {
        setErrorNotice(t("notice.archiveRefreshFailed", locale, { error: errorText(error, locale) }));
      });
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      archiveMutationPendingRef.current = false;
      setArchiveMutationPending(false);
    }
  }

  async function restoreSession(session: DshSessionSummary) {
    try {
      const result = await desktopRequest("workspace.restoreSession", { sessionId: session.sessionId });
      setArchivedSessionIds(new Set(result.archivedSessionIds));
      await loadSessions();
      setNotice(t("notice.sessionRestored", locale));
    } catch (error) { setErrorNotice(errorText(error, locale)); }
  }

  async function deleteArchivedSessions(targets: readonly DshSessionSummary[]) {
    const sessionsToDelete = [...new Map(targets.map((session) => [session.sessionId, session])).values()];
    if (sessionsToDelete.length === 0 || archiveMutationPendingRef.current) return;
    archiveMutationPendingRef.current = true;
    setArchiveMutationPending(true);
    try {
      const results = await Promise.allSettled(sessionsToDelete.map((session) => desktopRequest("workspace.deleteArchivedSession", { sessionId: session.sessionId })));
      const deleted = results.flatMap((result, index) => result.status === "fulfilled" && result.value.deleted ? [sessionsToDelete[index]] : []);
      if (deleted.length > 0) {
        const deletedIds = new Set(deleted.map((session) => session.sessionId));
        setArchivedSessionIds((current) => new Set([...current].filter((sessionId) => !deletedIds.has(sessionId))));
        setSessions((current) => current.filter((session) => !deletedIds.has(session.sessionId)));
        for (const { sessionId } of deleted) {
          sessionProjectionCache.removeSession(sessionId);
          historyPageCache.removeSession(sessionId);
        }
        if (deleted.some((session) => session.sessionId === activeSessionRef.current)) startNewSession();
      }
      setDeleteArchivedTargets(null);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed || deleted.length !== sessionsToDelete.length) {
        setErrorNotice(t("notice.archivedDeletePartial", locale, { deleted: deleted.length, total: sessionsToDelete.length, error: failed ? errorText(failed.reason, locale) : t("notice.sessionMissing", locale) }));
      } else {
        setNotice(t(sessionsToDelete.length === 1 ? "notice.archivedDeleted" : "notice.archivedDeletedMultiple", locale, { count: deleted.length }));
      }
      if (deleted.length > 0) void loadSessions().catch((error) => {
        setErrorNotice(t("notice.archiveRefreshFailed", locale, { error: errorText(error, locale) }));
      });
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      archiveMutationPendingRef.current = false;
      setArchiveMutationPending(false);
    }
  }

  function requestSessionAction(action: SessionAction, session: DshSessionSummary) {
    setSessionContextMenu(null);
    if (action === "pin") { void toggleSessionPin(session); return; }
    if (action === "archive") { setArchiveTargets([session]); return; }
    if (action === "fork") { void forkSession(session.sessionId); return; }
    if (action === "export") { void exportSession(session.sessionId); return; }
    if (action === "exportZip") { void exportSessionZip(session.sessionId); return; }
    setRenameValue(displayTitle(session, locale));
    setRenameTarget(session);
  }

  async function renameSession() {
    const session = renameTarget;
    const title = renameValue.trim();
    if (!session || !title) return;
    try {
      await desktopRequest("session.rename", { sessionId: session.sessionId, title });
      setRenameTarget(null);
      setRenameValue("");
      await loadSessions();
      setNotice(t("notice.sessionRenamed", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  /**
   * 把该模型缺失的思考档位声明写进它的路由设置并刷新目录。声明本身不改变
   * 请求——只有选定某个档位才会发送 `reasoning_effort`。
   */
  async function declareModelReasoningEfforts(): Promise<boolean> {
    const selection = composerModels?.current;
    const declaration = reasoningDeclaration;
    if (!selection || !declaration) return false;
    const ops = declareModelReasoningEffortsOps(
      declaration.provider.settingsPath,
      providerModels(declaration.provider, declaration.namespace),
      selection.model,
      { ...MODEL_REASONING_EFFORT_PRESET },
    );
    try {
      if (ops.length > 0) {
        await desktopRequest("settings.mutate", { ns: declaration.namespace.ns, ops, expectedRevision: declaration.namespace.revision });
      }
      await loadRuntimeDetails();
      return true;
    } catch (error) {
      setErrorNotice(errorText(error, locale));
      return false;
    }
  }

  // 思考程度由滑条提交：提交后保留模型菜单，便于在滑动条上连续微调档位。
  // 未声明档位的模型先落地本地声明，用户只需要拖动这一次。
  async function changeReasoningEffort(reasoningEffort?: string) {
    const declaring = reasoningEffort !== undefined && reasoningDeclaration !== undefined && selectedReasoningEffort !== reasoningEffort;
    if (declaring && !await declareModelReasoningEfforts()) return;
    const declarationNotice = declaring
      ? t("notice.reasoningDeclared", locale, { model: selectedModel?.name ?? composerModels?.current.model ?? "" })
      : t("notice.reasoningUpdated", locale);
    if (!activeSessionId || !models) {
      if (!activeSessionId && pendingModelSelection) {
        setDraftModelSelection({ ...pendingModelSelection, reasoningEffort });
      }
      if (declaring) setNotice(declarationNotice);
      return;
    }
    if (selectedReasoningEffort === reasoningEffort) return;
    try {
      await desktopRequest("session.selectModel", {
        sessionId: activeSessionId,
        provider: models.current.provider,
        model: models.current.model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      });
      setModels((current) => current ? { ...current, current: { ...current.current, reasoningEffort } } : current);
      setNotice(declarationNotice);
    } catch (error) { setErrorNotice(errorText(error, locale)); }
  }

  async function changeModel(value: string) {
    if (!value) return;
    const [provider, model] = value.split("\u0000");
    if (!activeSessionId) {
      const selected = composerModels?.groups.find((group) => group.id === provider)?.models.find((entry) => entry.id === model);
      if (selected) setDraftModelSelection({ provider, model, reasoningEffort: selected.reasoning?.defaultEffort });
      setModelMenuOpen(false);
      setModelMenuPane("root");
      setNotice(t("notice.nextSessionModel", locale));
      return;
    }
    if (models?.current.provider === provider && models.current.model === model) {
      setModelMenuOpen(false);
      setModelMenuPane("root");
      return;
    }
    try {
      await desktopRequest("session.selectModel", { sessionId: activeSessionId, provider, model });
      const selectedContextWindow = models?.groups.find((group) => group.id === provider)?.models.find((entry) => entry.id === model)?.contextWindow;
      setModels((current) => current ? { ...current, current: { ...current.current, provider, model, reasoningEffort: undefined }, contextWindow: selectedContextWindow } : current);
      contextProjectionRef.current = false;
       setSessionStats((current) => ({ ...current, contextTokens: 0, contextTokensAvailable: false, contextLimit: selectedContextWindow ?? 0 }));
      setModelMenuOpen(false);
      setModelMenuPane("root");
      setNotice(t("notice.modelSwitched", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function terminateConflictingDsh() {
    const conflict = status.processConflict;
    if (!desktop || !conflict || dshConflictBusy) return;
    setDshConflictBusy(true);
    try {
      await terminateDshProcesses(conflict.processes.map((process) => process.pid));
      setStatus((current) => ({ ...current, processConflict: null, message: t("notice.restartingDsh", locale) }));
      await restartRuntime();
    } catch (error) {
      setErrorNotice(t("notice.terminateFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setDshConflictBusy(false);
    }
  }

  function dismissDshConflict() {
    setStatus((current) => ({ ...current, processConflict: null }));
  }

  async function restartRuntime() {
    if (!desktop) return;
    setStartupLogs([]);
    setPluginInventory(null);
    setExcludedPlugins([]);
    setNotice(t("notice.restarting", locale));
    try {
      const nextStatus = await refreshDsh();
      setStatus(nextStatus);
      if (nextStatus.runtimeAvailable) {
        await loadRuntimeDetails();
        setNotice(t("notice.restartedPluginsRefreshed", locale));
      }
    } catch (error) {
      const message = errorText(error, locale);
      setStatus((current) => ({ ...current, runtimeAvailable: false, runtimeStarting: false, message }));
      setErrorNotice(message);
    }
  }

  async function saveAndRestartPlugins() {
    if (!pluginConfigDirty) return restartRuntime();
    const saved = await savePluginConfig();
    if (saved) await restartRuntime();
  }

  function updatePluginConfig(id: string, patch: Partial<Pick<DshPluginConfigEntry, "id" | "name">>) {
    setPluginConfigDraft((current) => current.map((plugin) => plugin.id === id ? { ...plugin, ...patch } : plugin));
  }

  async function loadRuntimeLogs() {
    if (!desktop) return;
    try {
      const logs = await withTimeout(getRuntimeLogs(), 5_000, t("notice.logsReadTimeout", locale));
      setAppLogs(logs.slice(-2000));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function exportLogs() {
    if (!desktop) {
      setErrorNotice(t("notice.logExportDesktopOnly", locale));
      return;
    }
    setLogExporting(true);
    try {
      const content = await exportRuntimeLogs();
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const savedPath = await saveExportFile(`deeptop-logs-${stamp}.log`, new TextEncoder().encode(content));
      if (savedPath) {
        setLogExportPath(savedPath);
        setNotice(t("notice.logExported", locale, { savedPath: savedPath }));
      }
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    } finally {
      setLogExporting(false);
    }
  }

  async function openLogsDirectoryHandle() {
    if (!desktop) {
      setErrorNotice(t("notice.openLogsDesktopOnly", locale));
      return;
    }
    try {
      await openLogsDirectory();
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function runCommand(line: string) {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    try {
      setNotice(t("notice.executingLine", locale, { command: line.trim().split(/\s+/)[0] }));
      const execution = await executeCommandLine(sessionId, line);
      if (activeSessionRef.current !== sessionId) {
        if (execution?.result.kind === "success" && execution.result.text) setNotice(t("notice.commandResultSwitched", locale, { result: execution.result.text }));
        return;
      }
      if (execution?.result.kind === "success" && execution.result.text) setNotice(execution.result.text);
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function insertCommand(line: string) {
    setComposer(line);
    setShowInspector(false);
    setNotice(t("notice.commandInserted", locale));
  }

  async function setDefaultModel(selection: ModelSelection) {
    const group = hostModels?.groups.find((item) => item.id === selection.provider);
    const model = group?.models.find((item) => item.id === selection.model);
    if (!model) {
      setErrorNotice(t("notice.modelUnavailableRefresh", locale));
      return;
    }
    const next = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    } satisfies ModelSelection;
    try {
      const namespace = settings?.namespaces.find((item) => item.ns === "agent-default-model");
      if (namespace) {
        const nestedModel = valueAtPath(namespace.value, ["model"]);
        const modelPath = nestedModel && typeof nestedModel === "object" && !Array.isArray(nestedModel) ? ["model"] : [];
        const reasoningPath = [...modelPath, "reasoningEffort"];
        const currentReasoning = valueAtPath(namespace.value, reasoningPath);
        const ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> = [
          { op: "set", path: [...modelPath, "provider"], value: next.provider },
          { op: "set", path: [...modelPath, "model"], value: next.model },
        ];
        if (typeof currentReasoning === "string") {
          ops.push(next.reasoningEffort
            ? { op: "set", path: reasoningPath, value: next.reasoningEffort }
            : { op: "unset", path: reasoningPath });
        }
        await desktopRequest("settings.mutate", { ns: namespace.ns, ops, expectedRevision: namespace.revision });
        await refreshSettings();
      } else {
        writeStoredDefaultModel(next);
        setStoredDefaultModel(next);
      }
      setDraftModelSelection(next);
      setNotice(t("notice.modelDefault", locale, { model: model.name }));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function persistDefaultPermission(value: string) {
    try {
      const namespace = settings?.namespaces.find((item) => item.ns === "permission");
      if (!namespace) {
        if (isDefaultPermission(value)) {
          writeStoredDefaultPermission(value);
          setStoredDefaultPermission(value);
        } else {
          throw new Error(t("err.permissionNamespaceMissing", locale));
        }
      } else {
        await desktopRequest("settings.update", { ns: "permission", patch: { defaultPreset: value } });
        await refreshSettings();
      }
      setNotice(t("notice.permissionDefaultUpdated", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  async function setDefaultPermission(value: string) {
    // Values outside the local trio are still writable when the official
    // schema exposes them as defaultPreset choices (deployment presets).
    if (!isDefaultPermission(value) && !permissionOptions.some((option) => option.value === value)) return;
    const next = value as DefaultPermission;
    if (next === "danger-full-access") {
      setPendingDefaultPermission(next);
      return;
    }
    await persistDefaultPermission(next);
  }

  async function confirmDefaultPermission() {
    const value = pendingDefaultPermission;
    if (!value) return;
    setPendingDefaultPermission(null);
    await persistDefaultPermission(value);
  }

  async function applyPermissionPreset(value: string) {
    if (!activeSessionRef.current) {
      if (isDefaultPermission(value)) setDraftPermission(value);
      return;
    }
    await runCommand(`/permission ${value}`);
  }

  async function setPermissionPreset(value: string) {
    const normalized = value.trim().toLowerCase().replace(/_/g, "-");
    if (!normalized || normalized === "custom") return;
    if (!activeSessionRef.current) {
      if (!isDefaultPermission(normalized)) return;
      if (normalized === "danger-full-access") {
        setPendingPermissionValue(normalized);
        return;
      }
      await applyPermissionPreset(normalized);
      return;
    }
    if (normalized === "danger-full-access") {
      setPendingPermissionValue("danger-full-access");
      return;
    }
    await applyPermissionPreset(normalized);
  }

  async function confirmPermissionPreset() {
    const value = pendingPermissionValue;
    if (!value) return;
    setPendingPermissionValue(null);
    await applyPermissionPreset(value);
  }

  async function togglePlan() {
    await runCommand(plan?.active ? "/plan off" : "/plan");
  }

  async function exitPlanMode() {
    await runCommand("/plan off");
  }

  async function respondPlanReview(review: PlanReviewQuestion, label: string) {
    if (!question) return;
    const request = question;
    if (!claimRespond(request.rpcId)) return;
    try {
      await desktopRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        answer: {
          answer: { answers: [{ id: review.item.id, selected: [label] }] },
        },
      });
      setPendingQuestions((current) => {
        if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
      setQuestionAnswersBySession((current) => {
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
      setQuestionCustomAnswersBySession((current) => {
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
    } catch (error) {
      releaseRespondClaim(request.rpcId);
      setErrorNotice(errorText(error, locale));
    }
  }

  async function exportSession(sessionId = activeSessionRef.current) {
    if (!sessionId) return;
    setNotice(t("notice.exportingSession", locale));
    try {
      let exported: DshHistoryEntry[] = [];
      let beforeSeq: number | undefined;
      let hasMore = true;
      while (hasMore) {
        const result = await desktopRequest("session.history", {
          sessionId,
          maxMessages: 100,
          display: false,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
        });
        const known = new Set(exported.map((entry) => entry.event.seq));
        exported = [...result.events.filter((entry) => !known.has(entry.event.seq)), ...exported];
        const nextBeforeSeq = result.events.reduce<number | undefined>((minimum, entry) => minimum === undefined ? entry.event.seq : Math.min(minimum, entry.event.seq), undefined);
        hasMore = result.hasMore && nextBeforeSeq !== undefined && nextBeforeSeq !== beforeSeq;
        beforeSeq = nextBeforeSeq;
      }
      const session = sessions.find((item) => item.sessionId === sessionId);
      const content = JSON.stringify({ exportedAt: new Date().toISOString(), session, events: exported }, null, 2);
      const fileName = `dsh-${sessionId.slice(0, 8)}.json`;
      if (!desktop) {
        setErrorNotice(t("notice.exportDesktopOnly", locale));
        return;
      }
      const savedPath = await saveExportFile(fileName, new TextEncoder().encode(content));
      if (savedPath === null) {
        setNotice(t("notice.exportCancelled", locale));
        return;
      }
      if (activeSessionRef.current !== sessionId) {
        setNotice(t("notice.exportedSwitched", locale, { exported: exported.length, savedPath: savedPath }));
      } else {
        setNotice(t("notice.exportedEvents", locale, { exported: exported.length }));
      }
    } catch (error) {
      setErrorNotice(t("notice.exportFailed", locale, { error: errorText(error, locale) }));
    }
  }

  async function exportSessionZip(sessionId = activeSessionRef.current) {
    if (!sessionId) return;
    if (!capabilityFeatures.sessionExport) {
      setErrorNotice(t("notice.zipExportUnavailable", locale));
      return;
    }
    setNotice(t("notice.generatingZip", locale));
    try {
      const result = await desktopRequest("session.exportZip", {
        sessionId,
        includeDescendants: true,
      }, undefined, { timeoutMs: 90_000 });
      if (!desktop) {
        setErrorNotice(t("notice.zipExportDesktopOnly", locale));
        return;
      }
      // Bridge 已把官方 Host 的 ZIP 流写入临时文件；原生另存为对话框把它
      // 转移到用户选择的位置。取消时 Tauri 侧清理临时文件并返回 null。
      const savedPath = await moveExportTempFile(result.filename, result.tempPath);
      if (savedPath === null) {
        setNotice(t("notice.zipExportCancelled", locale));
        return;
      }
      if (activeSessionRef.current !== sessionId) {
        setNotice(t("notice.zipExportedSwitched", locale, { result: result.size, savedPath: savedPath }));
      } else {
        setNotice(t("notice.zipExported", locale, { result: result.size }));
      }
    } catch (error) {
      setErrorNotice(t("notice.zipExportFailed", locale, { error: errorText(error, locale) }));
    }
  }

  async function openSessionPath(path: string) {
    const session = sessionsRef.current.find((item) => item.sessionId === activeSessionRef.current);
    if (!session) return;
    try {
      await desktopRequest("host.openPath", { path: sessionPath(session.cwd, path) });
      setNotice(t("notice.openedInSystem", locale));
    } catch (error) {
      setErrorNotice(t("notice.openFailed", locale, { error: errorText(error, locale) }));
      throw error;
    }
  }

  /**
   * 交付卡片的原生动作：默认应用打开复用 Host 的 `host.openPath`，
   * 文件管理器定位走原生命令。阶段状态写在卡片上，失败保留为可重试的状态
   * 而不是弹提示；作用域取发起时正在查看的会话，不跟随之后切换的会话。
   */
  async function actOnPresentedFile(path: string, action: PresentedAction) {
    const session = sessionsRef.current.find((item) => item.sessionId === activeSessionRef.current);
    const key = presentedPhaseKey(session?.sessionId ?? null, path);
    setPresentedPhases((current) => ({ ...current, [key]: action === "open" ? "opening" : "revealing" }));
    try {
      const target = sessionPath(session?.cwd ?? workspace, path);
      if (action === "open") await desktopRequest("host.openPath", { path: target });
      else await revealInExplorer(target);
      setPresentedPhases((current) => ({ ...current, [key]: action === "open" ? "opened" : "revealed" }));
    } catch {
      setPresentedPhases((current) => ({ ...current, [key]: action === "open" ? "error" : "revealError" }));
    }
  }

  async function openMessageUrl(url: string) {
    try {
      await openConnectionUrl(url);
      setNotice(t("notice.connectionOpened", locale));
    } catch (error) {
      setErrorNotice(t("notice.connectionOpenFailed", locale, { error: errorText(error, locale) }));
      throw error;
    }
  }

  async function addComposerFiles(files: FileList | File[]) {
    const candidates = Array.from(files).filter((file) => Boolean(imageMediaType(file)));
    if (candidates.length === 0) {
      setErrorNotice(t("notice.imagesOnly", locale));
      return;
    }
    try {
      const limits = models?.imageLimits;
      const next = await Promise.all(candidates.map((file) => readImageFile(file, limits, locale)));
      setAttachments((current) => {
        const limitError = imageBatchLimitError(current, next, limits, locale);
        if (limitError) throw new Error(limitError);
        return [...current, ...next];
      });
      setNotice(t("notice.imagesAdded", locale));
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addComposerFiles(files);
  }

  /** 在输入框光标处插入拖入文件的 @路径引用，与文件候选的插入行为一致。 */
  function insertDroppedReferences(paths: string[]) {
    const insertion = paths.map((path) => composerReferenceText(path, workspaceRef.current)).filter(Boolean).join(" ");
    if (!insertion) return;
    const textarea = composerRef.current;
    const value = textarea?.value ?? "";
    const selectionStart = textarea?.selectionStart ?? value.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const inserted = insertComposerText(value, insertion, selectionStart, selectionEnd);
    setComposer(inserted.value);
    setComposerMenuDismissed(true);
    window.requestAnimationFrame(() => {
      const nextTextarea = composerRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
    });
  }

  /** 处理原生拖放到输入框的系统路径：图片走附件管线，其余文件插入路径引用。 */
  async function acceptDroppedPaths(paths: string[]) {
    if (paths.length === 0) return;
    const limits = modelsRef.current?.imageLimits;
    const imagePaths = paths.filter((path) => Boolean(droppedImageMediaType(path)));
    const referencePaths = paths.filter((path) => !droppedImageMediaType(path));
    const errors: string[] = [];
    let addedImages = 0;
    let referencedPaths = 0;

    if (imagePaths.length > 0) {
      // 与 readImageFile 的本地默认上限保持一致；Rust 侧另有 64 MB 硬上限。
      const maxBytes = limits?.maxImageBytes ?? 12 * 1024 * 1024;
      const results = await Promise.allSettled(imagePaths.map((path) => readDroppedImage(path, maxBytes)));
      const loaded: ComposerAttachment[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          loaded.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: result.value.name,
            mediaType: result.value.mediaType,
            data: result.value.data,
          });
        } else {
          errors.push(errorText(result.reason, locale));
        }
      }
      if (loaded.length > 0) {
        const limitError = imageBatchLimitError(attachmentsRef.current, loaded, limits, locale);
        if (limitError) {
          errors.push(limitError);
        } else {
          setAttachments((current) => [...current, ...loaded]);
          addedImages = loaded.length;
        }
      }
    }

    if (referencePaths.length > 0) {
      insertDroppedReferences(referencePaths);
      referencedPaths = referencePaths.length;
    }

    const notices: string[] = [];
    if (addedImages > 0) notices.push(t("notice.imagesAddedCount", locale, { count: addedImages }));
    if (referencedPaths > 0) notices.push(t("notice.referencedPathsCount", locale, { count: referencedPaths }));
    if (errors.length > 0) setErrorNotice([...new Set(errors)].join("；"));
    else if (notices.length > 0) setNotice(notices.join("，"));
  }

  async function searchSessions() {
    const query = search.trim();
    if (!query) {
      setRemoteSearchResults(null);
      return;
    }
    const requestId = ++searchRequestRef.current;
    try {
      const result = await desktopRequest("session.search", { query });
      if (requestId !== searchRequestRef.current) return;
      setRemoteSearchResults(result.items.map((item) => ({ sessionId: item.sessionId, snippet: item.snippet ?? "" })));
    } catch (error) {
      if (requestId === searchRequestRef.current) setErrorNotice(errorText(error, locale));
    }
  }

  // 同一 rpcId 只允许发出一次 client-response：主窗口弹窗与桌宠快捷卡
  // 都可能对同一审批/问题作答，先同步认领再发送，避免双窗口竞态下
  // 同一 rpcId 收到两个响应（甚至 allow 与 reject 并存）。失败时释放认领以便重试。
  const respondedRpcIdsRef = useRef(new BoundedClaimSet());
  function claimRespond(rpcId: string) {
    return respondedRpcIdsRef.current.claim(rpcId);
  }
  function releaseRespondClaim(rpcId: string) {
    respondedRpcIdsRef.current.release(rpcId);
  }

  async function respondToApproval(outcome: "allowed-once" | "rejected") {
    if (!approval) return;
    const request = approval;
    if (!claimRespond(request.rpcId)) return;
    try {
      await desktopRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        answer: { outcome },
      });
      setPendingApprovals((current) => {
        if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
    } catch (error) {
      releaseRespondClaim(request.rpcId);
      setErrorNotice(errorText(error, locale));
    }
  }

  function toggleQuestionAnswer(questionId: string, value: string, multiSelect: boolean | undefined) {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    setQuestionAnswersBySession((current) => {
      const answers = current[sessionId] ?? {};
      const previous = answers[questionId] ?? [];
      return {
        ...current,
        [sessionId]: {
          ...answers,
          [questionId]: !multiSelect
            ? [value]
            : previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value],
        },
      };
    });
    if (!multiSelect) {
      setQuestionCustomAnswersBySession((current) => ({
        ...current,
        [sessionId]: { ...current[sessionId], [questionId]: "" },
      }));
    }
  }

  async function respondToQuestion() {
    if (!question) return;
    const request = question;
    const answers = questionAnswersBySession[request.sessionId] ?? {};
    const customAnswers = questionCustomAnswersBySession[request.sessionId] ?? {};
    const answerItems = questionAnswerItems(request.questions, answers, customAnswers);
    if (answerItems.some((item) => item.selected.length === 0 && !item.custom)) return;
    const answer = { answers: answerItems };
    if (!claimRespond(request.rpcId)) return;
    try {
      await desktopRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        answer: { answer },
      });
      setPendingQuestions((current) => {
        if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
      setQuestionAnswersBySession((current) => {
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
      setQuestionCustomAnswersBySession((current) => {
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
    } catch (error) {
      releaseRespondClaim(request.rpcId);
      setErrorNotice(errorText(error, locale));
    }
  }

  async function cancelQuestion() {
    if (!question) return;
    const request = question;
    if (!claimRespond(request.rpcId)) return;
    try {
      await desktopRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        answer: {},
      });
      setPendingQuestions((current) => {
        if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
      setQuestionAnswersBySession((current) => {
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
      setQuestionCustomAnswersBySession((current) => {
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
    } catch (error) {
      releaseRespondClaim(request.rpcId);
      setErrorNotice(errorText(error, locale));
    }
  }

  // @deeptop-pets:start app-action-handlers
  async function respondToPetApprovalRequest(request: PendingApproval, outcome: "allowed-once" | "rejected") {
    if (!claimRespond(request.rpcId)) {
      throw new Error(t("err.alreadyHandled", locale));
    }
    try {
      await desktopRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        answer: { outcome },
      });
    } catch (error) {
      releaseRespondClaim(request.rpcId);
      throw error;
    }
    setPendingApprovals((current) => {
      if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
      const next = { ...current };
      delete next[request.sessionId];
      return next;
    });
  }

  async function respondToPetQuestionRequest(
    request: PendingQuestion,
    answers: Record<string, string[]>,
    customAnswers: Record<string, string>,
  ) {
    const answer = {
      answers: questionAnswerItems(request.questions, answers, customAnswers),
    };
    if (!claimRespond(request.rpcId)) {
      throw new Error(t("err.alreadyHandled", locale));
    }
    try {
      await desktopRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        answer: { answer },
      });
    } catch (error) {
      releaseRespondClaim(request.rpcId);
      throw error;
    }
    setPendingQuestions((current) => {
      if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
      const next = { ...current };
      delete next[request.sessionId];
      return next;
    });
    setQuestionAnswersBySession((current) => {
      const next = { ...current };
      delete next[request.sessionId];
      return next;
    });
    setQuestionCustomAnswersBySession((current) => {
      const next = { ...current };
      delete next[request.sessionId];
      return next;
    });
  }

  async function sendPetReply(sessionId: string, text: string) {
    const message = text.trim();
    if (!message) throw new Error(t("err.petReplyEmpty", locale));
    const session = sessionsRef.current.find((item) => item.sessionId === sessionId);
    if (!session) throw new Error(t("err.petSessionGone", locale));
    const sessionModels = await desktopRequest("session.models", { sessionId });
    if (!sessionModels.routable) throw new Error(t("err.petNoRoute", locale));
    const promptPayload: DshSessionPromptPayload = {
      sessionId,
      mode: "queue",
      content: promptContentParts(message, []),
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    await desktopRequest("session.prompt", { ...promptPayload });
    setSessionIndicators((current) => ({ ...current, [sessionId]: "running" }));
    setNotice(t("notice.petReplySent", locale, { session: displayTitle(session, locale) }));
  }

  async function handlePetAction(action: PetAction) {
    try {
      if (action.kind === "open") {
        await openNotificationSession(action.sessionId);
        return;
      }
      if (action.kind === "reply") {
        await sendPetReply(action.sessionId, action.text ?? "");
        return;
      }
      if (action.kind === "approval-allow" || action.kind === "approval-reject") {
        const request = pendingApprovalsRef.current[action.sessionId];
        if (!request) throw new Error(t("err.petApprovalInvalid", locale));
        await respondToPetApprovalRequest(request, action.kind === "approval-allow" ? "allowed-once" : "rejected");
        return;
      }
      const request = pendingQuestionsRef.current[action.sessionId];
      if (!request) throw new Error(t("err.petQuestionInvalid", locale));
      if (request.questions.length !== 1 || !request.questions[0]) {
        await openNotificationSession(action.sessionId);
        return;
      }
      const questionId = request.questions[0].id;
      const text = action.text?.trim() ?? "";
      await respondToPetQuestionRequest(
        request,
        action.selectedOption ? { [questionId]: [text] } : {},
        action.selectedOption ? {} : { [questionId]: text },
      );
    } catch (error) {
      setErrorNotice(t("notice.petActionFailed", locale, { error: errorText(error, locale) }));
    }
  }
  // @deeptop-pets:end app-action-handlers

  async function removeQueueItem(itemId: string) {
    if (!activeSessionId) return;
    try {
      await desktopRequest("session.updateQueue", { sessionId: activeSessionId, itemId, action: { kind: "remove" } });
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function beginQueueEdit(item: DshQueueItem) {
    setQueueEditingId(item.id);
    setQueueEditingText(textFromContent(item.message.content));
  }

  async function saveQueueEdit(itemId: string) {
    if (!activeSessionId) return;
    const text = queueEditingText.trim();
    if (!text) {
      setErrorNotice(t("notice.queueEmpty", locale));
      return;
    }
    try {
      await desktopRequest("session.updateQueue", {
        sessionId: activeSessionId,
        itemId,
        action: { kind: "edit", content: [{ type: "text", text }] },
      });
      setQueueEditingId(null);
      setQueueEditingText("");
    } catch (error) {
      setErrorNotice(errorText(error, locale));
    }
  }

  function chooseComposerCandidate(candidate: ComposerCandidate) {
    if (!composerTrigger) return;
    setComposer(insertComposerCandidate(composer, composerTrigger, candidate));
    setComposerCandidateIndex(0);
    setComposerMenuDismissed(false);
  }

  function openSettingsNamespace(namespace: DshSettingsNamespace | undefined) {
    if (!namespace) {
      setErrorNotice(t("notice.namespaceUnavailable", locale));
      return;
    }
    setSettingsDraft({
      ns: namespace.ns,
      value: jsonText(namespace.user ?? {}),
      original: namespace.user ?? {},
      revision: namespace.revision,
      secrets: namespace.secrets.map((secret) => secret.path),
      schema: namespace.schema,
    });
  }

  function closeSettings() {
    surfaceRequestRef.current += 1;
    surfaceAbortRef.current?.abort(new Error("设置页面已关闭"));
    surfaceAbortRef.current = null;
    // The hook owns the renderer/Host cancellation handshake. An uncertain
    // install remains recoverable and is reopened with its Retry/Dismiss actions.
    toolSettings.close(new Error("设置页面已关闭"));
    setSkillInstallOpen(false);
    updateCheckRequestRef.current += 1;
    updateDownloadRequestRef.current += 1;
    updateDownloadReleaseRef.current = null;
    void cancelUpdateCheck().catch(() => undefined);
    void cancelUpdateDownload().catch(() => undefined);
    setUpdateDownloadState({ status: "idle" });
    setShowInspector(false);
    setSettingsDraft(null);
    setPresetCopy(null);
    setPresetView(null);
  }

  async function checkForAppUpdates() {
    if (!desktop || updateState.status === "checking") return;
    const requestId = ++updateCheckRequestRef.current;
    updateDownloadRequestRef.current += 1;
    updateDownloadReleaseRef.current = null;
    setUpdateDownloadState({ status: "idle" });
    setUpdateState({ status: "checking", channel: updateChannel });
    try {
      const result = await checkForUpdates(updateChannel);
      if (requestId !== updateCheckRequestRef.current) return;
      setUpdateState(updateCheckStateFromResult(result));
    } catch (error) {
      if (requestId !== updateCheckRequestRef.current) return;
      if (String(error).includes("更新检查已取消")) {
        setUpdateState({ status: "idle", channel: updateChannel });
        return;
      }
      setUpdateState({ status: "error", channel: updateChannel, message: updateCheckErrorMessage(error, locale) });
    }
  }

  function changeUpdateChannel(channel: UpdateChannel) {
    updateCheckRequestRef.current += 1;
    updateDownloadRequestRef.current += 1;
    setUpdateChannel(channel);
    updateDownloadReleaseRef.current = null;
    setUpdateState({ status: "idle", channel });
    setUpdateDownloadState({ status: "idle" });
    void cancelUpdateCheck().catch(() => undefined);
    void cancelUpdateDownload().catch(() => undefined);
  }

  function cancelAppUpdateCheck() {
    updateCheckRequestRef.current += 1;
    setUpdateState({ status: "idle", channel: updateChannel });
    void cancelUpdateCheck().catch((error) => setErrorNotice(errorText(error, locale)));
  }

  async function downloadAppUpdate() {
    if (!desktop || updateState.status !== "available" || updateDownloadState.status === "downloading") return;
    const requestId = ++updateDownloadRequestRef.current;
    updateDownloadReleaseRef.current = updateState.releaseTag;
    setUpdateDownloadState({ status: "downloading", releaseTag: updateState.releaseTag, assetName: updateState.assetName, downloadedBytes: 0, totalBytes: updateState.assetSize, percent: 0 });
    try {
      await downloadUpdate(updateChannel, updateState.releaseTag);
    } catch (error) {
      if (requestId !== updateDownloadRequestRef.current) return;
      if (String(error).includes("更新下载已取消")) {
        setUpdateDownloadState({ status: "cancelled" });
        return;
      }
      setUpdateDownloadState({ status: "error", message: updateCheckErrorMessage(error, locale) });
    }
  }

  function cancelAppUpdateDownload() {
    updateDownloadRequestRef.current += 1;
    updateDownloadReleaseRef.current = null;
    setUpdateDownloadState({ status: "cancelled" });
    void cancelUpdateDownload().catch((error) => setErrorNotice(errorText(error, locale)));
  }

  function launchAppUpdate() {
    if (updateDownloadState.status !== "ready" && !(updateDownloadState.status === "error" && updateDownloadState.canInstall)) return;
    setUpdateDownloadState({ status: "launching" });
    void launchUpdateInstaller().catch((error) => {
      setUpdateDownloadState({ status: "error", message: errorText(error, locale), canInstall: true });
    });
  }

  function openProjectPage() {
    void openExternalUrl(DEEPTOP_PROJECT_URL).catch((error) => setErrorNotice(errorText(error, locale)));
  }

  function openLatestRelease() {
    if (updateState.status !== "available") return;
    void openExternalUrl(updateState.releaseUrl).catch((error) => setErrorNotice(errorText(error, locale)));
  }

  function openModelsDevPricing() {
    void openConnectionUrl(modelPricingSourceUrl).catch((error) => setErrorNotice(errorText(error, locale)));
  }

  /**
   * Select a settings section on behalf of plugin code. A plugin may name a
   * built-in section or another panel's id; anything else is ignored so the
   * content column never ends up with no matching section.
   */
  function selectPluginSection(id: string) {
    const accepted = acceptedSettingsSectionId(id);
    if (accepted) setSettingsSection(accepted);
  }

  function openSettings() {
    if (showInspector) {
      closeSettings();
      return;
    }
    setSettingsSection("appearance");
    setShowInspector(true);
    setSkillInstallOpen(toolSettings.skillInstallOperation !== null);
    void loadSurface("settings");
  }

  if (desktop && !status.runtimeAvailable) {
    return (
      <>
        <StartupSplash
          status={status}
          logs={startupLogs}
          onOpenNodejsDownload={() => void openNodejsDownload().catch((error) => setErrorNotice(errorText(error, locale)))}
          onRetry={() => void restartRuntime()}
          windowMaximized={windowMaximized}
          onDrag={(event) => void startWindowDrag(event)}
          onMinimize={() => void minimizeWindow()}
          onToggleMaximize={() => void toggleWindowMaximize()}
          onClose={() => void closeWindow()}
        />
        {popupRequest?.kind === "close-behavior" && <WindowCloseBehaviorDialog locale={locale} onClose={() => settlePopup(null)} onSelect={(behavior) => settlePopup(behavior)} />}
        {status.processConflict && <DshConflictDialog locale={locale} conflict={status.processConflict} busy={dshConflictBusy} onClose={dismissDshConflict} onTerminate={() => void terminateConflictingDsh()} />}
      </>
    );
  }

  const utilityPanel = conversationPageActive ? <UtilityDockShelf
    locale={locale}
    active={activeUtilityPanel}
    onSelect={selectUtilityPanel}
    taskCount={activeJobs.length || undefined}
    todoCount={todoVisible ? `${todoCounts.completed}/${todos?.length ?? 0}` : undefined}
    deliverableCount={deliverablesVisible ? deliverables?.files.length : undefined}
    subagentCount={childSubagents.length || undefined}
    tasks={activeJobs.length > 0 ? <TaskPanel locale={locale} jobs={activeJobs} collapsed={false} now={jobNow} outputEnabled={capabilityFeatures.tasks} onLoadOutput={loadTaskOutput} embedded onToggle={() => setActiveUtilityPanel(null)} /> : <UtilityPanelEmptyState icon={<ListTodo />} title={t("utility.tasksEmptyTitle", locale)} description={t("utility.tasksEmpty", locale)} />}
    todo={todoVisible ? <TodoPanel
      locale={locale}
      todos={todos ?? []}
      collapsed={false}
      counts={todoCounts}
      now={jobNow}
      turnStartedAt={turnTiming.startedAt}
      turnFinishedAt={turnTiming.finishedAt}
      embedded
      onToggle={() => setActiveUtilityPanel(null)}
    /> : <UtilityPanelEmptyState icon={<CheckSquare />} title={t("utility.todoEmptyTitle", locale)} description={t("utility.todoEmpty", locale)} />}
    deliverables={deliverablesVisible && deliverables ? <DeliverablesPanel
      locale={locale}
      item={deliverables}
      activeSession={activeSession ?? null}
      collapsed={false}
      embedded
      onToggle={() => setActiveUtilityPanel(null)}
      onOpenSessionPath={openSessionPath}
      onOpenFile={openSessionFile}
      onPresentedAction={(path, action) => void actOnPresentedFile(path, action)}
      presentedHost={presentedHostInfo}
      presentedPhaseOf={(path) => presentedPhases[presentedPhaseKey(activeSessionId, path)]}
    /> : <UtilityPanelEmptyState icon={<PackageOpen />} title={t("utility.deliverablesEmptyTitle", locale)} description={t("utility.deliverablesEmpty", locale)} />}
    subagent={childSubagents.length > 0 ? <div className="subagent-workbench">
      <SubagentDock
        locale={locale}
        rootSessionId={activeSessionId ?? ""}
        entries={childSubagents}
        selectedId={selectedSubagentId}
        catalogs={subagentCatalogs}
        expandedBranches={subagentBranchExpanded}
        loadingErrors={subagentBranchErrors}
        onOpen={openSubagentEntry}
        onToggleBranch={toggleSubagentBranch}
      />
      <SubagentPanel
        locale={locale}
        panelOpen={subagentPanelOpen}
        selectedId={selectedSubagentId}
        selectedIndex={selectedSubagentIndex}
        selectedEntry={selectedSubagent}
        loadingId={subagentLoadingId}
        loadError={subagentLoadError}
        session={subagentSession}
        transcript={subagentTranscript}
        composer={subagentComposer}
        onClose={() => setSubagentPanelOpen(false)}
        onComposerChange={setSubagentComposer}
        onPrompt={promptSubagent}
        onInterrupt={interruptSubagent}
      />
    </div> : <UtilityPanelEmptyState icon={<Bot />} title={t("utility.subagentEmptyTitle", locale)} description={t("utility.subagentEmpty", locale)} />}
  /> : null;

  return (
    <main className={`app-shell${hasAnyBackground(appearance.backgrounds) ? " has-custom-background" : ""}`} style={appearanceStyle}>
      <WindowChrome
        locale={locale}
        windowMaximized={windowMaximized}
        settingsOpen={showInspector}
        onDrag={(event) => void startWindowDrag(event)}
        onMinimize={() => void minimizeWindow()}
        onToggleMaximize={() => void toggleWindowMaximize()}
        onClose={() => void closeWindow()}
        onOpenSettings={openSettings}
        onAddWorkspace={() => void addWorkspace()}
        onChooseRuntimeWorkspace={() => chooseWorkspace("")}
        onRestartRuntime={() => void restartRuntime()}
        onEditCommand={(command) => { if (desktop) document.execCommand(command); }}
      />

      <div
        className={`workspace-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
        style={{
          "--sidebar-width": `${sidebarWidth}px`,
          // 图标条常驻右栏左缘，右栏宽度下限就是它；拖拽面板时再展开成更宽的落点条。
          "--dock-rail-strip-width": `${DOCK_RAIL_STRIP_WIDTH}px`,
          "--dock-rail-width": `${!conversationPageActive ? 0 : dockLayout.root ? (dockSettings.railWidth ?? DOCK_RAIL_DEFAULT_WIDTH) : (dockDrag ? DOCK_RAIL_STRIP_WIDTH + DOCK_RAIL_EMPTY_WIDTH : DOCK_RAIL_STRIP_WIDTH)}px`,
        } as CSSProperties}
      >
        <SessionSidebar
          locale={locale}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => {
            setWorkspaceMenuOpen(false);
            setSessionContextMenu(null);
            setSidebarCollapsed((collapsed) => !collapsed);
          }}
          search={search}
          onSearchChange={setSearch}
          onSearch={() => void searchSessions()}
          onClearSearch={() => setSearch("")}
          onNewSession={startNewSession}
          settingsOpen={showInspector}
          onOpenSettings={openSettings}
          onAddWorkspace={() => void addWorkspace()}
          visibleSessions={visibleSessions}
          archivedSessions={archivedSessions}
          activeSessionView={activeSessionView}
          onRestoreSession={restoreSession}
          onArchiveSessions={setArchiveTargets}
          onDeleteArchivedSessions={setDeleteArchivedTargets}
          selectedWorkspaceGroup={selectedWorkspaceGroup}
          pinnedWorkspaceIds={pinnedWorkspaceIds}
          onTogglePinWorkspace={togglePinWorkspace}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          unpinnedSectionOpen={unpinnedSectionOpen}
          onUnpinnedSectionChange={setUnpinnedSectionOpen}
          sessionContextMenu={sessionContextMenu}
          onRequestSessionAction={requestSessionAction}
          uiLocale={locale}
          uiHost={uiHostActions}
          uiRuntime={uiRuntime}
          workspace={workspace}
          workspaces={workspaces}
          workspaceMenuOpen={workspaceMenuOpen}
          onToggleWorkspaceMenu={() => setWorkspaceMenuOpen((value) => !value)}
          onChooseWorkspace={chooseWorkspace}
          workspacePickerMenuRef={workspacePickerMenuRef}
          activeSessionId={activeSessionId}
          sessionIndicators={sessionIndicators}
          pendingSessionIds={pendingSessionIds}
          searchResultById={searchResultById}
          workspaceBySessionId={workspaceBySessionId}
          dragOverSessionId={dragOverSessionId}
          draggedSessionRef={draggedSessionRef}
          onOpenSession={openSession}
          onToggleSessionPin={toggleSessionPin}
          onMoveSessionBefore={moveSessionBefore}
          onDragOverSessionChange={(sessionId) => setDragOverSessionId(sessionId)}
          onSessionDragEnd={() => setDragOverSessionId(null)}
          onSessionContextMenu={(session, x, y) => setSessionContextMenu({ session, x, y })}
          onDismissSessionContextMenu={() => setSessionContextMenu(null)}
        />

        <div
          className="sidebar-resizer"
          role="separator"
          aria-label={t("layout.resizeSidebarAria", locale)}
          aria-valuemin={300}
          aria-valuemax={440}
          aria-valuenow={sidebarWidth}
          // 收起时侧栏没有可拖动宽度，分隔线也不再是一个可用的辅助功能节点。
          aria-hidden={sidebarCollapsed || undefined}
          onPointerDown={(event) => {
            event.preventDefault();
            sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
            document.body.classList.add("sidebar-resizing");
          }}
        />

        <section className={`conversation-panel${conversationPageActive ? "" : " page-non-conversation"}`}>
          <ConversationHeader
            locale={locale}
            activeSession={activeSession}
            presets={presets}
            runtimeDirectory={status.runtimeDirectory}
            notice={notice}
            noticeIsError={noticeIsError}
            queueCount={conversationPageActive ? queue.length : 0}
            activeGoal={visibleGoal}
            goalRoundsStarted={goalRoundsStarted}
            goalCollapsed={goalBarCollapsed}
            goalBusy={goalPanelBusy}
            conversationPageActive={conversationPageActive}
            trajectoryOpen={trajectoryOpen}
            sessionDashboardOpen={sessionDashboardOpen}
            onOpenGoal={openGoalPanel}
            onToggleGoalCollapsed={() => setGoalBarCollapsed((collapsed) => !collapsed)}
            onToggleGoalPhase={() => void mutateGoal(visibleGoal?.phase === "active" ? "pause" : "resume")}
            onToggleTrajectory={() => { setSessionDashboardOpen(false); setTrajectoryOpen((open) => !open); }}
            onToggleSessionDashboard={() => { setTrajectoryOpen(false); setSessionDashboardOpen((open) => !open); }}
          />

          <div className={`conversation-transcript-stage${conversationPageActive ? "" : " page-non-conversation"}`}>
            {corruptSession && corruptSession.sessionId === activeSessionId && (
              <div className="session-repair-banner" role="alert">
                <div className="session-repair-banner-text">
                  {t("repair.banner", locale)}
                </div>
                <button type="button" className="session-repair-button" disabled={repairingSession} onClick={() => void repairActiveSession()}>
                  {repairingSession ? t("repair.repairing", locale) : t("repair.repairAndReopen", locale)}
                </button>
              </div>
            )}
            {!sessionDashboardOpen && <ConversationTranscript
              locale={locale}
              scrollRef={transcriptScroll}
              endRef={transcriptEnd}
              history={history}
              transcript={transcript}
              activeSession={activeSession ?? null}
              activeSessionId={activeSessionId}
              activeRunning={activeRunning}
              loading={loading}
              workingIndicator={appearance.workingIndicator}
              historyHasMore={historyHasMore}
              historyLoadingOlder={historyLoadingOlder}
              transcriptFollowing={transcriptFollowing}
              trajectoryOpen={trajectoryOpen}
              loopLive={transcriptLoopLive}
              workspace={workspace}
              runtimeDirectory={status.runtimeDirectory}
              modelName={models?.current.model ?? defaultModelName}
              presets={presets}
              uiRuntime={uiRuntime}
              uiHost={uiHostActions}
              nextPreset={nextPreset}
              presetMenuOpen={presetMenuOpen}
              onLoadOlder={loadOlderHistory}
              onLoadImageAttachment={loadImageAttachment}
              onFollowingChange={setTranscriptFollowing}
              onJumpToLatest={() => setTranscriptFollowing(true)}
              onTogglePresetMenu={() => setPresetMenuOpen((open) => !open)}
              onStagePreset={stagePresetForNextSession}
              onCopyMessage={copyMessage}
              onCopySelection={copySelection}
               onRetryMessage={retryMessage}
               retryingMessageSeq={retryingMessageSeq}
              onForkSession={forkSession}
               onOpenUrl={openMessageUrl}
               onOpenWorkflowMember={openWorkflowChild}
                             onOpenSessionPath={openSessionFile}
              turnItems={railItems}
              turnActiveTurn={railActiveTurn}
              turnBusyTurn={turnBusy}
              onTurnNavigate={handleTurnNavigate}
            />}
            <SessionDashboard
              entries={dashboardEntries}
              sessionStats={dashboardSessionStats}
              session={activeSession ?? null}
              active={sessionDashboardOpen}
              loading={dashboardLoading}
              loadError={dashboardHistoryError}
              running={activeRunning}
              elapsedMs={dashboardRunningMs}
              provider={models?.current.provider}
              model={models?.current.model}
              locale={locale}
              onRetryLoad={() => { void loadDashboardHistory(); }}
              onOpenPricingSource={openModelsDevPricing}
            />

          </div>

          <InteractionPanel
            locale={locale}
            approval={approval}
            question={question}
            answers={questionAnswers}
            customAnswers={questionCustomAnswers}
            onApproval={respondToApproval}
            onToggleAnswer={toggleQuestionAnswer}
            onCustomAnswerChange={(questionId, value) => {
              const sessionId = activeSessionRef.current;
              if (!sessionId) return;
              setQuestionCustomAnswersBySession((current) => ({
                ...current,
                [sessionId]: { ...current[sessionId], [questionId]: value },



              }));
            }}
            onCancelQuestion={cancelQuestion}
            onSubmitQuestion={respondToQuestion}
            onPlanReview={respondPlanReview}
          />

          <QueueDock
            locale={locale}
            items={queue}
            editingId={queueEditingId}
            editingText={queueEditingText}
            onEditingTextChange={setQueueEditingText}
            onSave={saveQueueEdit}
            onCancelEdit={() => setQueueEditingId(null)}
            onBeginEdit={beginQueueEdit}
            onRemove={removeQueueItem}
          />

          {/* ask-user 浮层：plan-review 走上面的内联,普通 ask-user
             坐在发送框正上方、居中,conversation 不会被它顶上去;
             收起时是一颗小药丸,仍在同一锚点。 */}
          {question && !planReviewOf(question.questions) && (
            <FloatingQuestionCard
              locale={locale}
              question={question}
              answers={questionAnswers}
              customAnswers={questionCustomAnswers}
              onToggleAnswer={toggleQuestionAnswer}
              onCustomAnswerChange={(questionId, value) => {
                const sessionId = activeSessionRef.current;
                if (!sessionId) return;
                setQuestionCustomAnswersBySession((current) => ({
                  ...current,
                  [sessionId]: { ...current[sessionId], [questionId]: value },
                }));
              }}
              onCancel={cancelQuestion}
              onCopyQuestion={copySelection}
              onSubmit={respondToQuestion}
            />
          )}

          <ComposerShell
            runtimeAvailable={status.runtimeAvailable}
            activeRunning={activeRunning}
            activeSessionId={activeSessionId}
            defaultModelName={defaultModelName}
            loading={loading}
            composer={composer}
            attachments={attachments}
            promptMode={promptMode}
            candidates={composerCandidates}
            triggerKind={composerTrigger?.kind}
            candidatesDismissed={composerMenuDismissed}
            activeCandidateIndex={activeComposerCandidateIndex}
            models={composerModels}
            modelMenuRef={modelMenuRef}
             composerRef={composerRef}
            selectedModelValue={selectedModelValue}
            selectedModelLabel={selectedModel?.label}
            selectedReasoning={selectedReasoning}
            selectedReasoningEffort={selectedReasoningEffort}
            selectedReasoningLabel={selectedReasoningLabel}
            reasoningChoices={reasoningChoices}
            modelMenuOpen={modelMenuOpen}
            modelMenuPane={modelMenuPane}
            sessionStats={sessionStats}
            sessionRunningMs={sessionRunningMs}
            onOpenSessionDashboard={() => { setTrajectoryOpen(false); setSessionDashboardOpen(true); }}
             sendShortcut={sendShortcut}
             dropActive={composerDropActive}
             plan={plan}
             utilityPanel={utilityPanel}
             onExitPlan={exitPlanMode}
             locale={locale}
            onComposerChange={(value) => {
              setComposer(value);
              setComposerMenuDismissed(false);
            }}
            onPaste={handleComposerPaste}
            onAddFiles={addComposerFiles}
            onRemoveAttachment={(attachmentId) => setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
            permissions={composerPermissions}
            onSetPermission={setPermissionPreset}
            onSetPromptMode={setPromptMode}
            onChooseCandidate={chooseComposerCandidate}
            onSetCandidateIndex={setComposerCandidateIndex}
            onDismissCandidates={() => setComposerMenuDismissed(true)}
            onAction={handleComposerAction}
             onCancel={() => void cancelSession()}
            onToggleModelMenu={() => {
              if (modelMenuOpen) {
                setModelMenuOpen(false);
                setModelMenuPane("root");
              } else {
                setModelMenuPane("root");
                setModelMenuOpen(true);
              }
            }}
            onSetModelPane={setModelMenuPane}
            onChangeModel={changeModel}
            onChangeReasoningEffort={changeReasoningEffort}
          />
           </section>

        {/* 面板入口：图标条常驻在右栏左缘，展开的卡片仍是浮动卡片（未停靠时才渲染），
            因此它得留在右栏外层——右栏本身是 overflow:hidden 的圆角卡片。 */}
        <div
          className={`left-dock-shelf${conversationPageActive ? "" : " hidden-page"}${dockDrag?.target?.paneId === "" ? " drop-active" : ""}`}
          aria-label={t("layout.workspaceToolsAria", locale)}
        >
          <TerminalDock
            locale={locale}
            workspace={workspace}
            collapsed={!terminalOpen}
            onToggle={() => setTerminalOpen((open) => !open)}
            onError={setErrorNotice}
          />
          <WorkspaceFilesPanel
            locale={locale}
            workspace={workspace}
            collapsed={filesCollapsed}
            onToggle={() => setFilesOpen((open) => !open)}
            onAddPathToComposer={addPathToComposer}
            onError={setErrorNotice}
          />
          <GitDock
            locale={locale}
            workspace={workspace}
            collapsed={!gitOpen}
            onToggle={() => setGitOpen((open) => !open)}
            onError={setErrorNotice}
          />
        </div>

        <DockRail
          locale={locale}
          visible={conversationPageActive}
          onTabLeaveRail={handleDockTabsLeaveRail}
          renderTabBody={(tab) => (
            <DockTabBody
              key={tab.id}
              tab={tab}
              workspace={activeSession?.cwd ?? workspace}
              locale={locale}
              onError={setErrorNotice}
            />
          )}
        />
      </div>

         {showInspector && (
          <div className="inspector-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="inspector-title">
            <button className="inspector-backdrop" onClick={closeSettings} aria-label={t("settings.closeAria", locale)} />
            <aside className="inspector-panel" ref={inspectorPanelRef} tabIndex={-1}>
            <div className="inspector-header"><strong id="inspector-title">{t("settings.title", locale)}</strong><button onClick={closeSettings} title={t("settings.closeAria", locale)}><X aria-hidden="true" /></button></div>
            {surfaceLoading && <div className="surface-loading">{t("settings.loadingSurface", locale)}</div>}

            <div className="settings-layout">
                <nav className="settings-navigation" aria-label={t("settings.navAria", locale)}>
                  <div className="settings-navigation-title">DSH {t("settings.title", locale)}</div>
                  <div className={`settings-navigation-group${settingsSection === "appearance" ? " expanded" : ""}`}>
                    <button className="settings-navigation-group-toggle" aria-expanded={settingsSection === "appearance"} onClick={() => { setSettingsSection("appearance"); setAppearanceSection("theme"); }}>
                      <strong>{t("settings.appearance", locale)}</strong><span className="settings-navigation-chevron" aria-hidden="true"><ChevronDown /></span>
                    </button>
                    {settingsSection === "appearance" && <div className="settings-navigation-subnav" role="tablist" aria-label={t("settings.appearance", locale)}>
                      {(["theme", "background", "typography", "css"] as AppearanceSection[]).map((item) => <button key={item} className={`settings-navigation-subitem${appearanceSection === item ? " selected" : ""}`} onClick={() => setAppearanceSection(item)}>{item === "theme" ? t("settings.theme", locale) : item === "background" ? t("settings.background", locale) : item === "typography" ? t("settings.typography", locale) : t("settings.css", locale)}</button>)}
                    </div>}
                  </div>
                  {/* @deeptop-pets:start app-settings-nav */}
                  <button className={(settingsSection as string) === "pets" ? "selected" : ""} onClick={() => setSettingsSection("pets" as SettingsSection)}>
                    <strong>{t("settings.pets", locale)}</strong><small>{t("settings.pets.hint", locale)}</small>
                  </button>
                  {/* @deeptop-pets:end app-settings-nav */}
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={(event) => setSettingsSection(event.currentTarget.textContent?.includes("Dock") ? "dock" : "general")}>
                     <strong data-legacy-general="true">{t("settings.general", locale)}</strong><small>{t("settings.general.hint", locale)}</small>
                   </button>{/*
                   </button>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={(event) => setSettingsSection(event.currentTarget.textContent?.includes("Dock") ? "dock" : "general")}>
                     <strong data-legacy-general="true">通用</strong><small>会话与 Host</small>
                   </button>
                   </button>
                   </button>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={(event) => setSettingsSection(event.currentTarget.textContent?.includes("Dock") ? "dock" : "general")}>
                     <strong data-legacy-general="true">通用</strong><small>会话与 Host</small>
                  </button>
                  */}
                   <button className={settingsSection === "dock" ? "selected" : ""} onClick={() => setSettingsSection("dock")}>
                     <strong>{t("settings.dock", locale)}</strong><small>{t("settings.dock.hint", locale)}</small>
                   </button>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={(event) => setSettingsSection(event.currentTarget.textContent?.includes("Dock") ? "dock" : "general")}>
                     <strong data-legacy-general="true">{t("settings.general", locale)}</strong><small>{t("settings.general.hint", locale)}</small>
                   </button>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={() => setSettingsSection("general")}>
                     <strong>{t("settings.general", locale)}</strong><small>{t("settings.general.hint", locale)}</small>
                   </button>
                   <button className={settingsSection === "logs" ? "selected" : ""} onClick={() => { setSettingsSection("logs"); void loadRuntimeLogs(); }}>
                    <strong>{t("settings.logs", locale)}</strong><small>{t("settings.logs.hint", locale)}</small>
                  </button>
                  <button className={settingsSection === "keyboard" ? "selected" : ""} onClick={() => setSettingsSection("keyboard")}>
                     <strong>{t("settings.keyboard", locale)}</strong><small>{t("settings.keyboard.hint", locale)}</small>
                   </button>
                   <button className={settingsSection === "models" ? "selected" : ""} onClick={() => setSettingsSection("models")}>
                    <strong>{t("settings.models", locale)}</strong><small>{t("settings.models.hint", locale)}</small>
                  </button>
                  <button className={settingsSection === "presets" ? "selected" : ""} onClick={() => setSettingsSection("presets")}>
                    <strong>{t("settings.presets", locale)}</strong><small>{t("settings.presets.hint", locale)}</small>
                  </button>
                  <button className={settingsSection === "tools" ? "selected" : ""} onClick={() => { setSettingsSection("tools"); if (!toolSettings.description && capabilityFeatures.tools) void toolSettings.load(); }}>
                     <strong>{t("settings.tools", locale)}</strong><small>{t("settings.tools.hint", locale)}</small>
                   </button>
                   <button className={settingsSection === "plugins" ? "selected" : ""} onClick={() => setSettingsSection("plugins")}>
                    <strong>{t("settings.plugins", locale)}</strong><small>{t("settings.plugins.hint", locale)}</small>
                  </button>
                  {/* 插件贡献的设置分区：导航项与内容面板同源，均由 deeptop-ui-registry 声明。 */}
                  <SettingsPluginSectionNav runtime={uiRuntime} activeSectionId={settingsSection} locale={locale} onSelectSection={selectPluginSection} />
                <button className={settingsSection === "about" ? "selected" : ""} onClick={() => setSettingsSection("about")}>
                     <strong>{t("settings.about", locale)}</strong><small>{t("settings.about.hint", locale)}</small>
                   </button>
                 </nav>

                <section className="settings-main">
                   {settingsSection === "dock" && <SettingsDockPanel locale={locale} settings={dockSettings} loaded={dockSettingsLoaded} updating={dockSettingsUpdating} dockedTabs={Object.keys(dockLayout.tabs).length} onUpdate={updateDockSettingsWithNotice} onResetLayout={() => resetDockLayout()} />}
                  {/* @deeptop-pets:start app-settings-panel */}
                  {(settingsSection as string) === "pets" && <SettingsPetPanel
                    locale={locale}
                    desktop={desktop}
                    settings={petSystem.settings}
                    entries={petSystem.entries}
                    selectedPet={petSystem.selectedPet}
                    directory={petSystem.library.directory}
                    warnings={petSystem.library.warnings}
                    loaded={petSystem.loaded && petSystem.libraryLoaded}
                    busy={petSystem.busy}
                    previewBundle={petSystem.previewBundle}
                    previewLoading={petSystem.previewLoading}
                    previewError={petSystem.previewError}
                    careState={petSystem.careState}
                    careError={petSystem.careError}
                    onUpdate={petSystem.updateSettings}
                    onSelect={petSystem.selectPet}
                    onImport={petSystem.importBundle}
                    onExport={petSystem.exportSelected}
                    onRemove={petSystem.removeSelected}
                    onOpenDirectory={petSystem.openDirectory}
                  />}
                  {/* @deeptop-pets:end app-settings-panel */}
                  {settingsSection === "about" && <SettingsAboutPanel
                     locale={locale}
                     version={DEEPTOP_VERSION}
                     desktop={desktop}
                     updateChannel={updateChannel}
                      updateState={updateState}
                      downloadState={updateDownloadState}
                     onCheckForUpdates={() => void checkForAppUpdates()}
                     onChannelChange={changeUpdateChannel}
                      onCancelUpdateCheck={cancelAppUpdateCheck}
                      onDownloadUpdate={() => void downloadAppUpdate()}
                      onCancelDownload={cancelAppUpdateDownload}
                      onLaunchInstaller={launchAppUpdate}
                     onOpenProject={openProjectPage}
                     onOpenRelease={openLatestRelease}
                   />}

                   {settingsSection === "appearance" && <SettingsAppearancePanel
                    appearance={appearance}
                    themeMode={themeMode}
                    appTheme={appTheme}
                    themesDir={themeFilesInfo?.themesDir ?? null}
                    themePathError={themePathError}
                    themePathLoading={themePathLoading}
                    themeIds={themeIds}
                    fontPreset={appearanceFontPreset}
                    codeFontPreset={appearanceCodeFontPreset}
                    fontPresets={appearanceFontPresets}
                    codeFontPresets={appearanceCodeFontPresets}
                    section={appearanceSection}
                     onSectionChange={setAppearanceSection}
                     onUpdate={updateAppearance}
                     onUpdateBackground={updateBackground}
                     onBackgroundFile={handleBackgroundFile}
                     onClearBackground={clearBackground}
                     onImport={importAppearanceConfig}
                     onExport={exportAppearanceConfig}
                    onThemeChange={changeThemeMode}
                    onAppThemeChange={setAppTheme}
                    onPickThemeCss={handlePickThemeCss}
                    onReloadThemeCss={reloadThemeCss}
                    onOpenThemesDirectory={openThemesDirectory}
                    onRescanThemes={rescanThemes}

                    onThemeFile={handleThemeFile}
                    onResetSection={resetAppearanceSection}
                  />}


                  {settingsSection === "general" && <SettingsGeneralPanel
                    settings={settings}
                    presets={presets}
                    hostModels={hostModels}
                    defaultModel={defaultModelSelection}
                    defaultPermission={defaultPermission}
                    permissionOptions={permissionOptions}
                    locale={locale}
                    onLocaleChange={changeLocale}
                    workspace={workspace}
                    runtimeDirectory={status.runtimeDirectory}
                    sidebarWidth={sidebarWidth}
                    pluginSettings={pluginSettings}
                     contextMenuStatus={contextMenuStatus}
                     contextMenuUpdating={contextMenuUpdating}
                     windowBehavior={windowBehavior}
                     windowBehaviorSupported={desktop}
                     windowBehaviorUpdating={windowBehaviorUpdating}
                     onSetContextMenuEnabled={setContextMenuEnabled}
                     onUpdateWindowBehavior={updateWindowBehavior}
                    onOpenDocument={() => desktopRequest("settings.openDocument").then(() => setNotice(t("notice.configOpened", locale))).catch((error) => setErrorNotice(errorText(error, locale)))}
                    onSetDefaultPreset={setDefaultPreset}
                    onSetDefaultModel={setDefaultModel}
                    onSetDefaultPermission={setDefaultPermission}
                    onAddWorkspace={addWorkspace}
                    onResetSidebar={() => setSidebarWidth(320)}
                    onOpenNamespace={openSettingsNamespace}
                    networkProxy={networkProxy}
                    networkEffective={networkEffective}
                    networkProxyUpdating={networkProxyUpdating}
                    onUpdateNetworkProxy={updateNetworkProxy}
                  />}

                  {settingsSection === "keyboard" && <SettingsKeyboardPanel
                     locale={locale}
                     sendShortcut={sendShortcut}
                     onSendShortcutChange={updateSendShortcut}
                   />}

                   {settingsSection === "logs" && <SettingsLogsPanel
                     locale={locale}
                     logs={appLogs}
                     exportPath={logExportPath}
                     exporting={logExporting}
                     onRefresh={() => void loadRuntimeLogs()}
                     onExport={() => void exportLogs()}
                     onOpenLogsDirectory={() => void openLogsDirectoryHandle()}
                   />}

                   {settingsSection === "presets" && <SettingsPresetPanel
                    locale={locale}
                    presets={presets}
                    writable={settings?.writable}
                    authorable={presetAuthorable}
                    onSetDefault={setDefaultPreset}
                    onRead={readPreset}
                    onOpenDocument={openPresetDocument}
                    onBeginCopy={(id) => setPresetCopy({ from: id, id: "", name: "" })}
                    onRemove={removePreset}
                  />}

                  {settingsSection === "models" && <SettingsModelsPanel
                    locale={locale}
                    providers={providers}
                    settings={settings}
                    hostModels={hostModels}
                    providerSettings={providerSettings}
                    subagentRouting={{ current: subagentRoutingCurrent, saving: settingsSaving, onSave: saveSubagentRouting }}
                    onOpenNamespace={openSettingsNamespace}
                  />}

                  {settingsSection === "tools" && <SettingsToolsPanel
                     locale={locale}
                     available={capabilityFeatures.tools}
                     description={toolSettings.description}
                     mcpDraft={toolSettings.mcpDraft}
                     loading={toolSettings.loading}
                      loadError={toolSettings.loadError}
                     mcpSaving={toolSettings.mcpSaving}
                     skillRemoving={toolSettings.skillRemoving}
                     skillInstallOperation={toolSettings.skillInstallOperation}
                     lastSkillInstall={toolSettings.lastSkillInstall}
                     onRefresh={toolSettings.load}
                     onOpenSkillDirectory={toolSettings.openSkillDirectory}
                     onBeginSkillInstall={() => setSkillInstallOpen(true)}
                     onRemoveSkill={toolSettings.removeSkill}
                     onMcpDraftChange={toolSettings.setMcpDraft}
                     onResetMcpDraft={toolSettings.resetMcpDraft}
                     onSaveMcp={toolSettings.saveMcp}
                   />}

                   {settingsSection === "plugins" && <SettingsPluginsPanel
                    locale={locale}
                    inventory={pluginInventory}
                     excludedPlugins={excludedPlugins}
                    uiRuntime={uiRuntime}
                    visiblePlugins={visiblePlugins}
                    search={pluginSearch}
                    expandedPlugin={expandedPlugin}
                    pluginSettings={pluginSettings}
                    settings={settings}
                    pluginConfig={pluginConfig}
                     pluginConfigDraft={pluginConfigDraft}
                     pluginConfigDirty={pluginConfigDirty}
                     pluginConfigSaving={pluginConfigSaving}
                     onSearchChange={setPluginSearch}
                     onAddPlugin={() => setPluginInstallOpen(true)}
                     onUpdatePlugin={updatePluginConfig}
                     onToggleConfigPlugin={togglePluginConfig}
                     onRemovePlugin={removePluginConfig}
                     onCancelPluginConfig={cancelPluginConfig}
                     onSavePluginConfig={() => void savePluginConfig()}
                     onSaveAndRestart={() => void saveAndRestartPlugins()}
                     onRestart={() => void restartRuntime()}
                    onTogglePlugin={(entryId) => setExpandedPlugin((current) => current === entryId ? null : entryId)}
                    onOpenNamespace={openSettingsNamespace}
                  />}

                  {isPluginSectionId(settingsSection) && <SettingsPluginSectionPanel
                    runtime={uiRuntime}
                    activeSectionId={settingsSection}
                    context={{ session: null, activeSessionId, sessionGeneration: uiRuntime.sessionGeneration, settings: { activeSectionId: settingsSection, selectSection: selectPluginSection }, locale, host: uiHostActions }}
                    onActionError={setErrorNotice}
                  />}
                </section>
                {/* settings JSON popup is rendered below the settings sheet */}
                 {settingsDraft && !isSchemaEnvelope(settingsDraft.schema) && <PopupDialog locale={locale} title={t("dialog.jsonEdit.title", locale, { ns: settingsDraft.ns })} eyebrow="公开设置 / JSON" description={t("dialog.jsonEdit.description", locale)} className="popup-json-dialog" onClose={() => setSettingsDraft(null)} footer={<><button type="button" onClick={() => setSettingsDraft(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm" onClick={() => void saveSettings()}>{t("dialog.jsonEdit.save", locale)}</button></>}><textarea className="surface-code-input popup-code-input" value={settingsDraft.value} onChange={(event) => setSettingsDraft({ ...settingsDraft, value: event.target.value })} autoFocus aria-label={`${settingsDraft.ns} JSON`} /></PopupDialog>}
                {settingsDraft && isSchemaEnvelope(settingsDraft.schema) && <PopupDialog locale={locale} title={t("dialog.schemaEdit.title", locale, { ns: settingsDraft.ns })} eyebrow="公开设置 / Schema 表单" description={t("dialog.schemaEdit.description", locale)} className="popup-schema-dialog" onClose={() => setSettingsDraft(null)}>
                  <SchemaFormPanel
                    locale={locale}
                    namespace={settingsSchemaNamespace(settingsDraft, settings)}
                    onSave={(ops, revision) => void saveSettingsOps(settingsDraft.ns, ops, revision, settingsDraft)}
                    onCancel={() => setSettingsDraft(null)}
                    saving={settingsSaving}
                  />
                </PopupDialog>}
                {presetCopy && <PopupDialog locale={locale} title={t("dialog.presetCopy.title", locale, { from: presetCopy.from })} eyebrow="AGENT PRESET / 新建" description={t("dialog.presetCopy.description", locale)} className="popup-form-dialog" onClose={() => setPresetCopy(null)} footer={<><button type="button" onClick={() => setPresetCopy(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm" disabled={!presetCopy.id.trim()} onClick={() => void copyPreset()}>{t("dialog.presetCopy.create", locale)}</button></>}><label className="popup-field"><span>Preset id</span><input placeholder="例如：researcher-local" value={presetCopy.id} onChange={(event) => setPresetCopy({ ...presetCopy, id: event.target.value })} autoFocus /></label><label className="popup-field"><span>{t("dialog.presetCopy.displayName", locale)} <em>{t("dialog.presetCopy.optional", locale)}</em></span><input placeholder="例如：本地研究助手" value={presetCopy.name} onChange={(event) => setPresetCopy({ ...presetCopy, name: event.target.value })} /></label></PopupDialog>}
                {presetView && <PopupDialog locale={locale} title={`${presetView.id} / agent.cordis.yml`} eyebrow="AGENT PRESET / 预览" description={t("dialog.presetView.description", locale)} className="popup-preview-dialog" onClose={() => setPresetView(null)} footer={<button type="button" className="confirm" onClick={() => setPresetView(null)}>{t("common.done", locale)}</button>}><pre className="surface-code popup-code-preview">{presetView.content}</pre></PopupDialog>}
              </div>
            </aside>
          </div>
        )}
      {conversationPageActive && goalPanelOpen && activeSessionId && <PopupDialog
          locale={locale}
          title={activeGoal ? t("dialog.goal.manage", locale) : t("dialog.goal.create", locale)}
          eyebrow="DSH / GOAL"
          description={activeGoal ? t("dialog.goal.manageHint", locale) : t("dialog.goal.createHint", locale)}
          className="popup-goal-dialog"
          onClose={() => { if (!goalPanelBusy) setGoalPanelOpen(false); }}
          footer={<button type="button" disabled={goalPanelBusy} onClick={() => setGoalPanelOpen(false)}>{t("common.close", locale)}</button>}
        >
          <GoalSurfacePanel
            locale={locale}
            activeGoal={visibleGoal}
            roundsStarted={goalRoundsStarted}
            draft={goalDraft}
            maxRoundsDraft={goalMaxRoundsDraft}
            busy={goalPanelBusy}
            onDraftChange={setGoalDraft}
            onMaxRoundsChange={setGoalMaxRoundsDraft}
            onMutate={mutateGoal}
            onCreate={createGoal}
          />
        </PopupDialog>}
        {skillInstallOpen && <SkillInstallDialog
          locale={locale}
          operation={toolSettings.skillInstallOperation}
          onClose={() => { if (!toolSettings.skillInstallOperation || toolSettings.skillInstallOperation.uncertain) setSkillInstallOpen(false); }}
          onCancelInstall={toolSettings.cancelSkillInstall}
          onRetryInstall={toolSettings.retrySkillInstall}
          onDismissInstall={() => { toolSettings.dismissSkillInstall(); setSkillInstallOpen(false); }}
          onInstall={toolSettings.installSkill}
        />}
        {pluginInstallOpen && <PluginInstallDialog
         locale={locale}
         existingIds={pluginConfigDraft.map((plugin) => plugin.id)}
         pickingEntry={pluginPickingEntry}
         onClose={() => setPluginInstallOpen(false)}
         onPickEntry={pickPluginEntryForInstall}
         onSubmit={addPlugin}
       />}
       {presetMigration && <PopupDialog
         locale={locale}
         title={t("dialog.presetMigration.title", locale)}
         eyebrow="会话恢复 / 需要确认"
         description={t("dialog.presetMigration.description", locale, { session: presetMigration.session.sessionId, preset: presetMigration.missingPreset })}
         className="popup-form-dialog"
         role="alertdialog"
         onClose={() => { if (!presetMigrationRunning) setPresetMigration(null); }}
         footer={<><button type="button" disabled={presetMigrationRunning} onClick={() => setPresetMigration(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm" disabled={presetMigrationRunning || !presetMigrationSelection} onClick={() => void migrateMissingPreset()}>{presetMigrationRunning ? t("dialog.presetMigration.creating", locale) : t("dialog.presetMigration.confirm", locale)}</button></>}
       >
         <p>{t("dialog.presetMigration.copyHint", locale)}</p>
         <p>{t("dialog.presetMigration.diffHint", locale)}</p>
         <label className="popup-field"><span>{t("dialog.presetMigration.choose", locale)}</span><select value={presetMigrationSelection} onChange={(event) => setPresetMigrationSelection(event.target.value)} disabled={presetMigrationRunning}><option value="" disabled>{t("dialog.presetMigration.pleaseSelect", locale)}</option>{presets.filter((preset) => !preset.broken && preset.id !== presetMigration?.missingPreset).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets, locale)}（{preset.id}）</option>)}</select></label>
         {presetMigration.availablePresetIds.length > 0 && <small>{t("dialog.presetMigration.available", locale, { presets: presetMigration.availablePresetIds.join("、") })}</small>}
       </PopupDialog>}
       {popupRequest?.kind === "confirm" && <PopupDialog
        locale={locale}
        title={t("dialog.confirm.title", locale)}
        eyebrow="DSH / 确认操作"
        description={t("dialog.confirm.description", locale)}
        className="popup-confirm-dialog"
        role="alertdialog"
        onClose={() => settlePopup(false)}
        footer={<><button type="button" onClick={() => settlePopup(false)}>{t("common.cancel", locale)}</button><button type="button" className="confirm" onClick={() => settlePopup(true)}>{t("common.confirm", locale)}</button></>}
      >
        <p className="popup-confirm-message">{popupRequest.message}</p>
      </PopupDialog>}
      {popupRequest?.kind === "close-behavior" && <WindowCloseBehaviorDialog locale={locale} onClose={() => settlePopup(null)} onSelect={(behavior) => settlePopup(behavior)} />}
       {popupRequest?.kind === "prompt" && <PopupDialog
        title={popupRequest.title}
        eyebrow="DSH / 输入"
        description={popupRequest.description}
        className="popup-prompt-dialog"
        onClose={() => settlePopup(null)}
        footer={<><button type="button" onClick={() => settlePopup(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm" onClick={() => settlePopup(popupValue)}>{t("dialog.prompt.ok", locale)}</button></>}
      >
        <form className="popup-prompt-form" onSubmit={(event) => { event.preventDefault(); settlePopup(popupValue); }}>
          <input className="popup-prompt-input" value={popupValue} onChange={(event) => setPopupValue(event.target.value)} autoFocus aria-label={popupRequest.title} />
        </form>
      </PopupDialog>}
      {pendingDefaultPermission && <PopupDialog
        locale={locale}
        title={t("dialog.permissionDefault.title", locale)}
        eyebrow="DSH / 默认设置"
        description={t("dialog.permissionDefault.description", locale)}
        className="popup-permission-dialog"
        onClose={() => setPendingDefaultPermission(null)}
        footer={<><button type="button" onClick={() => setPendingDefaultPermission(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm danger-button" onClick={() => void confirmDefaultPermission()}>{t("dialog.permissionDefault.confirm", locale)}</button></>}
      >
        <div className="permission-confirm-content">
          <div className="permission-confirm-mark" aria-hidden="true">!</div>
          <div><strong>{t("dialog.permissionDefault.warning", locale)}</strong><p>{t("dialog.permissionDefault.warningHint", locale)}</p></div>
        </div>
      </PopupDialog>}
      {pendingPermissionValue && <PopupDialog
        locale={locale}
        title={t("dialog.permissionSwitch.title", locale)}
        eyebrow="DSH / 权限变更"
        description={t("dialog.permissionSwitch.description", locale)}
        className="popup-permission-dialog"
        onClose={() => setPendingPermissionValue(null)}
        footer={<><button type="button" onClick={() => setPendingPermissionValue(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm danger-button" onClick={() => void confirmPermissionPreset()}>{t("dialog.permissionSwitch.confirm", locale)}</button></>}
      >
        <div className="permission-confirm-content">
          <div className="permission-confirm-mark" aria-hidden="true">!</div>
          <div>
            <strong>{t("dialog.permissionSwitch.warning", locale)}</strong>
            <p>{t("dialog.permissionSwitch.warningHint", locale)}</p>
          </div>
        </div>
      </PopupDialog>}
      {archiveTargets && <PopupDialog
        locale={locale}
        title={t(archiveTargets.length === 1 ? "dialog.archive.title" : "dialog.archiveMultiple.title", locale)}
        description={archiveTargets.length === 1 ? t("dialog.archive.description", locale, { session: displayTitle(archiveTargets[0], locale) }) : t("dialog.archiveMultiple.description", locale, { count: archiveTargets.length })}
        descriptionInBody
        className="popup-confirm-dialog"
        role="alertdialog"
        onClose={() => { if (!archiveMutationPending) setArchiveTargets(null); }}
        footer={<><button type="button" disabled={archiveMutationPending} onClick={() => setArchiveTargets(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm danger-button" disabled={archiveMutationPending} onClick={() => void archiveSessions(archiveTargets)}>{t("dialog.archive.confirm", locale)}</button></>}
      >{null}</PopupDialog>}
      {deleteArchivedTargets && <PopupDialog
        locale={locale}
        title={t(deleteArchivedTargets.length === 1 ? "dialog.deleteArchived.title" : "dialog.deleteArchivedMultiple.title", locale)}
        description={deleteArchivedTargets.length === 1 ? t("dialog.deleteArchived.description", locale, { session: displayTitle(deleteArchivedTargets[0], locale) }) : t("dialog.deleteArchivedMultiple.description", locale, { count: deleteArchivedTargets.length })}
        descriptionInBody
        className="popup-confirm-dialog"
        role="alertdialog"
        onClose={() => { if (!archiveMutationPending) setDeleteArchivedTargets(null); }}
        footer={<><button type="button" disabled={archiveMutationPending} onClick={() => setDeleteArchivedTargets(null)}>{t("common.cancel", locale)}</button><button type="button" className="confirm danger-button" disabled={archiveMutationPending} onClick={() => void deleteArchivedSessions(deleteArchivedTargets)}>{t("dialog.deleteArchived.confirm", locale)}</button></>}
      >{null}</PopupDialog>}
      {renameTarget && <div className="confirm-backdrop" onMouseDown={() => setRenameTarget(null)}><form className="confirm-dialog rename-dialog" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void renameSession(); }} onMouseDown={(event) => event.stopPropagation()}><strong>{t("dialog.rename.title", locale)}</strong><p>{t("dialog.rename.description", locale, { session: displayTitle(renameTarget, locale) })}</p><input className="rename-dialog-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus aria-label={t("dialog.rename.inputAria", locale)} /><div className="surface-dialog-actions"><button type="button" onClick={() => setRenameTarget(null)}>{t("common.cancel", locale)}</button><button className="confirm" type="submit" disabled={!renameValue.trim()}>{t("common.save", locale)}</button></div></form></div>}
     </main>
  );
}

export function App() {
  return (
    <DockSettingsProvider>
      <AppContent />
    </DockSettingsProvider>
  );
}

export default App;
