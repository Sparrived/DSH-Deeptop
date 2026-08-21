import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { StartupSplash } from "./components/StartupSplash";
import { ConversationTranscript } from "./components/ConversationTranscript";
import { ConversationHeader } from "./components/ConversationHeader";
import { TokenUsageDashboard } from "./components/TokenUsageDashboard";
import { ComposerShell } from "./components/ComposerShell";
import { InteractionPanel } from "./components/InteractionPanel";
import { SettingsAboutPanel } from "./components/SettingsAboutPanel";
import { SettingsAppearancePanel } from "./components/SettingsAppearancePanel";
import { SettingsGeneralPanel } from "./components/SettingsGeneralPanel";
import { SettingsDockPanel } from "./components/SettingsDockPanel";
import { SettingsKeyboardPanel } from "./components/SettingsKeyboardPanel";
import { SettingsLogsPanel } from "./components/SettingsLogsPanel";
import { SettingsModelsPanel } from "./components/SettingsModelsPanel";
import { SettingsPluginsPanel } from "./components/SettingsPluginsPanel";
import { SettingsPresetPanel } from "./components/SettingsPresetPanel";
import { QueueDock } from "./components/QueueDock";
import { SessionSidebar, type WorkspaceGroup } from "./components/SessionSidebar";
import { SubagentDock } from "./components/SubagentDock";
import { SubagentPanel } from "./components/SubagentPanel";
import { TaskPanel, TodoPanel } from "./components/TodoPanel";
import { WorkspaceFilesPanel } from "./components/WorkspaceFilesPanel";
import { TerminalDock } from "./components/TerminalDock";
import { DeliverablesPanel } from "./components/DeliverablesPanel";
import { CurrentGoalBar } from "./components/CurrentGoalBar";
import { GoalSurfacePanel, type GoalAction } from "./components/GoalSurfacePanel";
import { UtilityDockShelf } from "./components/UtilityDockShelf";
import { WindowChrome } from "./components/WindowChrome";
import { DockSettingsProvider, useDockSettings } from "./app/dock-settings";
import { PopupDialog } from "./components/PopupDialog";
import { PluginInstallDialog, type PluginInstallDraft } from "./components/PluginInstallDialog";
import { useProviderSettings } from "./app/useProviderSettings";
import { useWindowControls } from "./app/useWindowControls";
import { normalizeWindowBehavior } from "./app/window-behavior";
import { routeBridgeEvent } from "./app/bridge-event-handler";
import {
  bridgeRequest,
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
  pickPluginEntry,
  pickWorkspace,
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
  type DshCommandDescriptor,
  type DshCommandExecution,
  type DshMessageAnnotationItem,
  type DshMessageAnnotationResult,
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
  type ExternalLaunchRequest,
  type WindowsContextMenuStatus,
  type DshSubagentAddress,
  type DshSubagentCatalog,
  type DshWorkspace,
} from "./lib/desktop";
import { desktopClientRuntime } from "./lib/desktop-client-runtime";
import {
  subagentDisplayName,
  subagentActivityLabel,
  subagentModeLabel,
  detectComposerTrigger,
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
import {
  backgroundZones,
  defaultAppearance,
  defaultBackgroundConfig,
  defaultBackgrounds,
  hasAnyBackground,
  useAppearanceSettings,
} from "./app/useAppearanceSettings";
import { SEND_SHORTCUT_STORAGE_KEY, readSendShortcut, type SendShortcut } from "./app/keyboard-shortcut";
import { defaultWorkingIndicator, normalizeWorkingIndicator } from "./app/working-indicator";
import { externalLaunchKey } from "./lib/external-launch";
import { DEFAULT_PERMISSION_OPTIONS, isDefaultPermission, readStoredDefaultModel, readStoredDefaultPermission, writeStoredDefaultModel, writeStoredDefaultPermission, type DefaultPermission } from "./app/session-defaults";
import { reconcileSessionIndicators } from "./app/session-runtime-state";
import { buildTraySessionMenu } from "./app/tray-model";
import { updateCheckStateFromResult, updateCheckErrorMessage, updateDownloadStateFromEvent, type UpdateChannel, type UpdateCheckState, type UpdateDownloadState } from "./app/update-model";

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
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (behavior: Exclude<CloseBehavior, "ask">) => void;
}) {
  return <PopupDialog
    title="关闭 Deeptop"
    eyebrow="DSH / 窗口行为"
    description="这是第一次关闭窗口，请选择之后关闭按钮的默认行为。你仍可在设置的“通用”中修改。"
    className="popup-close-behavior-dialog"
    role="alertdialog"
    onClose={onClose}
    footer={<><button type="button" onClick={onClose}>取消</button><button type="button" onClick={() => onSelect("hide-to-tray")}>后台运行</button><button type="button" className="confirm" onClick={() => onSelect("exit")}>退出程序</button></>}
  >
    <div className="close-behavior-options"><div className="close-behavior-option"><strong>后台运行</strong><span>隐藏窗口到系统托盘，DSH 任务继续运行。</span></div><div className="close-behavior-option"><strong>退出程序</strong><span>关闭 Deeptop 和后台运行中的 DSH。</span></div></div>
  </PopupDialog>;
}

function DshConflictDialog({
  conflict,
  busy,
  onClose,
  onTerminate,
}: {
  conflict: NonNullable<DshStatus["processConflict"]>;
  busy: boolean;
  onClose: () => void;
  onTerminate: () => void;
}) {
  return <PopupDialog
    title="检测到同一 DSH_HOME 正被其他 DSH 使用"
    eyebrow="DSH / 进程冲突"
    description={`检测到同一 DSH_HOME 正被其他 DSH 使用：${conflict.dshHome}。为避免 Session 日志和配置同时写入，Deeptop 暂时不会启动新的 DSH。`}
    className="popup-dsh-conflict-dialog"
    role="alertdialog"
    onClose={onClose}
    footer={<><button type="button" disabled={busy} onClick={onClose}>暂不处理</button><button type="button" className="confirm danger-button" disabled={busy} onClick={onTerminate}>{busy ? "正在终止…" : "终止旧 DSH 并继续启动"}</button></>}
  >
    <div className="dsh-conflict-process-list">{conflict.processes.map((process) => <div className="dsh-conflict-process" key={process.pid}><strong>PID {process.pid}</strong><code>{process.commandLine}</code></div>)}</div>
    <p className="popup-warning-copy">仅终止上面列出的 DSH 进程，不会终止其他 Node.js 进程。终止后 Deeptop 会重新启动自己的 DSH。</p>
  </PopupDialog>;
}

const FRONTEND_VISUAL_RESET_VERSION = "workbench-v2";
let frontendVisualResetChecked = false;

function sameWorkspacePath(left?: string, right?: string) {
  if (!left || !right) return false;
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").toLocaleLowerCase();
  return normalize(left) === normalize(right);
}

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

function appearanceSectionLabel(section: AppearanceConfigSection) {
  return section === "theme" ? "主题" : section === "background" ? "背景工作台" : section === "typography" ? "文字" : "CSS 主题";
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
  const [sessionIndicators, setSessionIndicators] = useState<Record<string, "idle" | "running" | "completed" | "error">>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<DshHistoryEntry[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [tokenUsageOpen, setTokenUsageOpen] = useState(false);
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
  const [annotations, setAnnotations] = useState<Record<string, DshMessageAnnotationItem>>({});
  const [permissionSelect, setPermissionSelect] = useState<DshPermissionSelect | null>(null);
  const [pendingPermissionValue, setPendingPermissionValue] = useState<DefaultPermission | null>(null);
  const [pendingDefaultPermission, setPendingDefaultPermission] = useState<DefaultPermission | null>(null);
  const [plan, setPlan] = useState<DshPlanProjection | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPane, setModelMenuPane] = useState<ModelMenuPane>("root");
  const [sessionStats, setSessionStats] = useState<SessionStats>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, messages: 0 });
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem("deeptop.theme");
      return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    } catch {
      return "system";
    }
  });
  // 工作区侧栏视图偏好：置顶顺序与收起状态，未记录的项默认收起。
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>(() => readWorkspaceViewPreferences().collapsedWorkspaces);
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
  const [showInspector, setShowInspector] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appearanceSection, setAppearanceSection] = useState<AppearanceSection>("theme");
  const [pluginSearch, setPluginSearch] = useState("");
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [skills, setSkills] = useState<DshSkill[]>([]);
  const [subagents, setSubagents] = useState<DshSubagentCatalog | null>(null);
  const [subagentPanelOpen, setSubagentPanelOpen] = useState(false);
  // 左侧子 Agent dock 默认收起：展开时显示书签列表，选中后进入执行抽屉。
  const [subagentDockOpen, setSubagentDockOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [subagentLoadingId, setSubagentLoadingId] = useState<string | null>(null);
  const [subagentLoadError, setSubagentLoadError] = useState<string | null>(null);
  const [subagentSession, setSubagentSession] = useState<SubagentSession | null>(null);
  const [subagentComposer, setSubagentComposer] = useState("");
  const [settings, setSettings] = useState<DshSettingsDescription | null>(null);
  const [contextMenuStatus, setContextMenuStatus] = useState<WindowsContextMenuStatus | null>(null);
  const [contextMenuUpdating, setContextMenuUpdating] = useState(false);
  const [windowBehavior, setWindowBehavior] = useState<WindowBehaviorSettings>({ minimizeToTray: false, closeBehavior: "ask" });
  const [windowBehaviorUpdating, setWindowBehaviorUpdating] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [goal, setGoal] = useState<DshGoalProjection | null | undefined>(undefined);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalMaxRoundsDraft, setGoalMaxRoundsDraft] = useState("");
  const [goalPanelOpen, setGoalPanelOpen] = useState(false);
  const [goalPanelBusy, setGoalPanelBusy] = useState(false);
  const [goalBarCollapsed, setGoalBarCollapsed] = useState(false);
  const [presetView, setPresetView] = useState<{ id: string; content: string } | null>(null);
  const [presetCopy, setPresetCopy] = useState<{ from: string; id: string; name: string } | null>(null);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
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
  const [openPanel, setOpenPanel] = useState<"tasks" | "todo" | "deliverables" | null>(null);
  const [jobNow, setJobNow] = useState(() => Date.now());
  const [filesOpen, setFilesOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, PendingApproval>>({});
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, PendingQuestion>>({});
  const [questionAnswersBySession, setQuestionAnswersBySession] = useState<Record<string, Record<string, string[]>>>({});
  const [questionCustomAnswersBySession, setQuestionCustomAnswersBySession] = useState<Record<string, Record<string, string>>>({});
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenu | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: SessionAction; session: DshSessionSummary } | null>(null);
  const [deleteArchivedTarget, setDeleteArchivedTarget] = useState<DshSessionSummary | null>(null);
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
  const [transcriptFollowing, setTranscriptFollowing] = useState(true);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionsRef = useRef<DshSessionSummary[]>(sessions);
  sessionsRef.current = sessions;
  const openSessionRef = useRef<(session: DshSessionSummary) => Promise<boolean>>(() => Promise.resolve(false));
  const chooseWorkspaceRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());
  const syncConversationToWorkspaceRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());
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
  const selectedSubagentRef = useRef<string | null>(null);
  const subagentRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const workspaceMutationQueueRef = useRef(Promise.resolve());
  const workspacesRef = useRef<DshWorkspace[]>(workspaces);
  workspacesRef.current = workspaces;
  const creatingSessionRef = useRef<Promise<string> | null>(null);
  const sessionLoadRequestRef = useRef(0);
  const retryingMessageRef = useRef<number | null>(null);
  const retryingSessionRef = useRef<string | null>(null);
  const imageAttachmentCacheRef = useRef(new Map<string, Promise<string>>());
  const externalLaunchQueueRef = useRef<ExternalLaunchRequest[]>([]);
  const externalLaunchFlushRef = useRef<Promise<void> | null>(null);
  const externalLaunchBootedRef = useRef(false);

  const loadImageAttachment = useCallback((attachmentId: string) => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return Promise.reject(new Error("当前没有打开的会话"));
    const key = `${sessionId}:${attachmentId}`;
    const cached = imageAttachmentCacheRef.current.get(key);
    if (cached) return cached;
    const request = bridgeRequest<{ attachment: { mediaType: string }; data: string }>("session.attachment", {
      sessionId,
      attachmentId,
    }).then((result) => `data:${result.attachment.mediaType};base64,${result.data}`);
    imageAttachmentCacheRef.current.set(key, request);
    void request.catch(() => {
      if (imageAttachmentCacheRef.current.get(key) === request) imageAttachmentCacheRef.current.delete(key);
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

  function requestPrompt(title: string, value = "", description?: string) {
    return new Promise<string | null>((resolve) => {
      enqueuePopupRequest({ kind: "prompt", title, value, description, resolve });
    });
  }

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
      setErrorNotice(`关闭窗口失败：${errorText(error)}`);
    } finally {
      closeRequestPendingRef.current = false;
    }
  }

  async function updateWindowBehavior(patch: Partial<WindowBehaviorSettings>) {
    const next = { ...windowBehavior, ...patch };
    setWindowBehaviorUpdating(true);
    try {
      setWindowBehavior(await setWindowBehaviorSettings(next));
      setNotice("窗口行为设置已保存");
    } catch (error) {
      setErrorNotice(`窗口行为设置保存失败：${errorText(error)}`);
    } finally {
      setWindowBehaviorUpdating(false);
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
    updateAppearance,
    updateBackground,
    clearBackground,
    handleBackgroundFile,
    handleThemeFile,
    setAppTheme,
    handlePickThemeCss,
    reloadThemeCss,
    openThemesDirectory,
    resetAppearance,
  } = useAppearanceSettings({ onNotice: setNotice, onError: setErrorNotice });
  const { settings: dockSettings, loaded: dockSettingsLoaded, updateSettings: updateDockSettings } = useDockSettings();
  const [dockSettingsUpdating, setDockSettingsUpdating] = useState(false);

  async function updateDockSettingsWithNotice(patch: Partial<import("./lib/desktop").DockSettings>) {
    setDockSettingsUpdating(true);
    try {
      await updateDockSettings(patch);
      setNotice("Dock 设置已保存");
    } catch (error) {
      setErrorNotice(`Dock 设置保存失败：${errorText(error)}`);
    } finally {
      setDockSettingsUpdating(false);
    }
  }

  function downloadAppearanceConfig(section: AppearanceConfigSection, data: Record<string, unknown>) {
    const envelope: AppearanceConfigEnvelope = { kind: "deeptop-appearance-config", version: 1, section, exportedAt: new Date().toISOString(), data };
    const content = JSON.stringify(envelope, null, 2);
    const fileName = `deeptop-appearance-${section}.json`;
    if (!desktop) {
      setErrorNotice("配置导出只在 Deeptop 桌面端可用");
      return;
    }
    void saveExportFile(fileName, new TextEncoder().encode(content)).then((savedPath) => {
      if (savedPath) setNotice(`已导出${appearanceSectionLabel(section)}配置`);
    }).catch((error) => setErrorNotice(`导出失败：${errorText(error)}`));
  }

  function exportAppearanceConfig() {
    const section = appearanceSection;
    const data = section === "theme" ? { themeMode, appTheme, themeCssPath: appearance.themeCssPath } : section === "background" ? { backgrounds: appearance.backgrounds } : section === "typography" ? { fontFamily: appearance.fontFamily, codeFontFamily: appearance.codeFontFamily, messageFontSize: appearance.messageFontSize, messageLineHeight: appearance.messageLineHeight, workingIndicator: appearance.workingIndicator } : { customCss: appearance.customCss, customCssName: appearance.customCssName, customCssEnabled: appearance.customCssEnabled };
    downloadAppearanceConfig(section, data);
  }

  function normalizeImportedBackgrounds(value: unknown) {
    if (!value || typeof value !== "object") throw new Error("背景配置格式无效");
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
    if (file.size > 8_000_000) { setErrorNotice("配置文件过大，请选择 8 MB 以内的 JSON 文件"); return; }
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppearanceConfigEnvelope>;
      if (parsed.kind !== "deeptop-appearance-config" || parsed.version !== 1 || parsed.section !== appearanceSection || !parsed.data || typeof parsed.data !== "object") throw new Error(`这不是当前“${appearanceSectionLabel(appearanceSection)}”子页面的配置文件`);
      const data = parsed.data as Record<string, unknown>;
      if (appearanceSection === "theme") {
        const nextMode = data.themeMode === "light" || data.themeMode === "dark" || data.themeMode === "system" ? data.themeMode : null;
        const nextTheme = data.appTheme === "one-dark" || data.appTheme === "monokai-pro" || data.appTheme === "custom" ? data.appTheme : null;
        const nextPath = typeof data.themeCssPath === "string" && data.themeCssPath.length <= 2000 ? data.themeCssPath : "";
        if (!nextMode || !nextTheme) throw new Error("主题配置中的明暗模式或配色方案无效");
        setThemeMode(nextMode);
        setAppTheme(nextTheme);
        updateAppearance({ themeCssPath: nextPath });
      } else if (appearanceSection === "background") {
        updateAppearance({ backgrounds: normalizeImportedBackgrounds(data.backgrounds) });
      } else if (appearanceSection === "typography") {
        const fontFamily = typeof data.fontFamily === "string" && data.fontFamily.trim() ? data.fontFamily.slice(0, 500) : defaultAppearance.fontFamily;
        const codeFontFamily = typeof data.codeFontFamily === "string" && data.codeFontFamily.trim() ? data.codeFontFamily.slice(0, 500) : defaultAppearance.codeFontFamily;
        const messageFontSize = Number(data.messageFontSize);
        const messageLineHeight = Number(data.messageLineHeight);
        updateAppearance({ fontFamily, codeFontFamily, messageFontSize: Number.isFinite(messageFontSize) ? Math.min(18, Math.max(14, messageFontSize)) : defaultAppearance.messageFontSize, messageLineHeight: Number.isFinite(messageLineHeight) ? Math.min(2.2, Math.max(1.35, messageLineHeight)) : defaultAppearance.messageLineHeight, workingIndicator: normalizeWorkingIndicator(data.workingIndicator) });
      } else {
        const customCss = typeof data.customCss === "string" && data.customCss.length <= 500_000 ? data.customCss : "";
        updateAppearance({ customCss, customCssName: typeof data.customCssName === "string" ? data.customCssName.slice(0, 200) : "", customCssEnabled: data.customCssEnabled === true && Boolean(customCss) });
      }
      setNotice(`已应用${appearanceSectionLabel(appearanceSection)}配置：${file.name}`);
    } catch (error) { setErrorNotice(`导入失败：${errorText(error)}`); }
  }
  function resetAppearanceSection() {
    if (appearanceSection === "theme") {
      setThemeMode("system");
      setAppTheme("monokai-pro");
      updateAppearance({ themeCssPath: themeFilesInfo?.monokaiPro ?? appearance.themeCssPath });
    } else if (appearanceSection === "background") {
      updateAppearance({ backgrounds: defaultBackgrounds() });
    } else if (appearanceSection === "typography") {
      updateAppearance({ fontFamily: defaultAppearance.fontFamily, codeFontFamily: defaultAppearance.codeFontFamily, messageFontSize: defaultAppearance.messageFontSize, messageLineHeight: defaultAppearance.messageLineHeight, workingIndicator: { ...defaultWorkingIndicator, texts: [...defaultWorkingIndicator.texts] } });
    } else {
      updateAppearance({ customCss: "", customCssName: "", customCssEnabled: false });
    }
    setNotice(`已恢复${appearanceSectionLabel(appearanceSection)}默认`);
  }

  const providerSettings = useProviderSettings({
    desktop,
    settings,
    providers,
    onNotice: setNotice,
    onError: setErrorNotice,
    onConfirm: requestConfirm,
    loadRuntimeDetails,
  });
  const activeSession = sessions.find((session) => session.sessionId === activeSessionId);
  const activeRunning = Boolean(activeSession?.running);
  const activeJobs = activeSessionId ? sessionJobs[activeSessionId] ?? [] : [];
  const approval = activeSessionId ? pendingApprovals[activeSessionId] ?? null : null;
  const question = activeSessionId ? pendingQuestions[activeSessionId] ?? null : null;
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
    void getWindowBehaviorSettings().then(normalizeWindowBehavior).then(setWindowBehavior).catch((error) => setErrorNotice(`读取窗口行为设置失败：${errorText(error)}`));
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
    let unlisten: UnlistenFn | undefined;
    void listenToUpdateProgress((progress) => {
      const expectedRelease = updateDownloadReleaseRef.current;
      if (progress.releaseTag && (!expectedRelease || progress.releaseTag !== expectedRelease)) return;
      if (!progress.releaseTag && (progress.phase === "failed" || progress.phase === "cancelled") && !expectedRelease) return;
      setUpdateDownloadState(updateDownloadStateFromEvent(progress));
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
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
    writeWorkspaceViewPreferences({ pinnedWorkspaceIds, collapsedWorkspaces });
  }, [collapsedWorkspaces, pinnedWorkspaceIds]);

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

  useEffect(() => {
    if (!showInspector && !settingsDraft && !presetCopy && !presetView) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
  }, [presetCopy, presetView, settingsDraft, showInspector]);

  useEffect(() => {
    if (!subagentPanelOpen && !subagentDockOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSubagentPanelOpen(false);
        setSubagentDockOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [subagentPanelOpen, subagentDockOpen]);

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

  const transcript = useMemo(() => transcriptFromHistory(history), [history]);
  const subagentTranscript = useMemo(() => subagentSession ? transcriptFromHistory(subagentSession.history) : [], [subagentSession]);
  const turnTiming = useMemo(() => turnTimingFromHistory(history), [history]);
  // 会话运行时间：首个事件到最后一个事件（会话运行中则以当前时间延伸，随 jobNow 每秒刷新）。
  const sessionRunningMs = useMemo(
    () => sessionElapsedMs(history, activeRunning ? jobNow : undefined),
    [history, jobNow, activeRunning],
  );

  useEffect(() => {
    const hasLiveJob = activeJobs.some((job) => job.status === "running" || job.status === "stopping");
    const hasLiveTodo = todos?.some((item) => item.status === "in_progress" && item.startedAt !== undefined) ?? false;
    const hasLiveTurn = turnTiming.startedAt !== undefined && turnTiming.finishedAt === undefined;
    if (!hasLiveJob && !hasLiveTodo && !hasLiveTurn) return;
    const timer = window.setInterval(() => setJobNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeJobs, todos, turnTiming]);

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
  // Only one right-side panel (任务 / 任务清单 / 生成文件) is expanded at a time.
  const jobsCollapsed = openPanel !== "tasks";
  const todoCollapsed = openPanel !== "todo";
  const deliverablesCollapsed = openPanel !== "deliverables";
  const filesCollapsed = !filesOpen;
  function togglePanel(panel: "tasks" | "todo" | "deliverables") {
    setOpenPanel((current) => current === panel ? null : panel);
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
  const workspaceBySessionId = useMemo(() => {
    const result = new Map<string, DshWorkspace>();
    workspaces.forEach((item) => item.sessionIds.forEach((sessionId) => result.set(sessionId, item)));
    return result;
  }, [workspaces]);
  const trayWorkspaceTitles = useMemo(() => new Map(
    [...workspaceBySessionId].map(([sessionId, workspaceItem]) => [sessionId, workspaceItem.title]),
  ), [workspaceBySessionId]);
  const traySessionMenu = useMemo(() => buildTraySessionMenu(sessions, {
    archivedSessionIds,
    indicators: sessionIndicators,
    pendingSessionIds,
    activeSessionId,
    workspaceTitles: trayWorkspaceTitles,
  }), [activeSessionId, archivedSessionIds, pendingSessionIds, sessionIndicators, sessions, trayWorkspaceTitles]);

  useEffect(() => {
    if (!desktop) return;
    void updateTraySessionMenu(traySessionMenu).catch((error) => {
      setErrorNotice(`更新系统托盘失败：${errorText(error)}`);
    });
  }, [desktop, setErrorNotice, traySessionMenu]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => sameWorkspacePath(item.path, workspace)) ?? null,
    [workspace, workspaces],
  );
  const sessionsByWorkspace = useMemo(() => {
    const visibleById = new Map(visibleSessions.map((session) => [session.sessionId, session]));
    return new Map(workspaces.map((item) => {
      const pinnedSessionIds = new Set(item.pinnedSessionIds ?? []);
      const sessions = item.sessionIds
        .map((sessionId) => visibleById.get(sessionId))
        .filter((session): session is DshSessionSummary => session !== undefined)
        .sort((left, right) => Number(pinnedSessionIds.has(right.sessionId)) - Number(pinnedSessionIds.has(left.sessionId)));
      return [item.workspaceId, sessions] as const;
    }));
  }, [visibleSessions, workspaces]);
  // 侧栏分组：置顶的工作区固定显示在最上方（按置顶顺序），其次显示当前选中的工作区；
  // 未选择工作区时显示未分组会话。
  const workspaceGroups = useMemo<WorkspaceGroup[]>(() => {
    const groups: WorkspaceGroup[] = [];
    const pinnedSet = new Set(pinnedWorkspaceIds);
    for (const workspaceId of pinnedWorkspaceIds) {
      const item = workspaces.find((candidate) => candidate.workspaceId === workspaceId);
      if (!item) continue;
      groups.push({ workspace: item, workspaceId: item.workspaceId, sessions: sessionsByWorkspace.get(item.workspaceId) ?? [] });
    }
    if (selectedWorkspace && !pinnedSet.has(selectedWorkspace.workspaceId)) {
      groups.push({ workspace: selectedWorkspace, workspaceId: selectedWorkspace.workspaceId, sessions: sessionsByWorkspace.get(selectedWorkspace.workspaceId) ?? [] });
    }
    if (!selectedWorkspace) {
      groups.push({ workspace: null, workspaceId: "__ungrouped__", sessions: visibleSessions.filter((session) => !workspaceBySessionId.has(session.sessionId)) });
    }
    return groups;
  }, [pinnedWorkspaceIds, selectedWorkspace, sessionsByWorkspace, visibleSessions, workspaceBySessionId, workspaces]);
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
  const newSessionPermissionSelect = useMemo<DshPermissionSelect | null>(() => {
    const currentValue = draftPermission ?? defaultPermission;
    return currentValue
      ? { options: DEFAULT_PERMISSION_OPTIONS, currentValue }
      : null;
  }, [defaultPermission, draftPermission]);
  const composerPermissions = activeSessionId ? permissionSelect : newSessionPermissionSelect;
  const defaultModelName = useMemo(() => {
    if (!defaultModelSelection) return "默认模型";
    return hostModels?.groups.find((group) => group.id === defaultModelSelection.provider)?.models.find((model) => model.id === defaultModelSelection.model)?.name ?? defaultModelSelection.model;
  }, [defaultModelSelection, hostModels]);
  const pendingModelSelection = draftModelSelection ?? defaultModelSelection;
  const composerModels = !activeSessionId && hostModels && pendingModelSelection
    ? {
      ...hostModels,
      current: pendingModelSelection,
      contextWindow: hostModels.groups.find((group) => group.id === pendingModelSelection.provider)?.models.find((model) => model.id === pendingModelSelection.model)?.contextWindow,
      routable: true,
    } satisfies DshSessionModels
    : models;
  const composerModelGroups = composerModels ? modelPickerGroups(composerModels) : [];
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
  const selectedReasoningLabel = selectedReasoning === undefined
    ? undefined
    : selectedReasoningEffort === undefined
      ? "默认"
      : selectedReasoning.efforts.find((effort) => effort.id === selectedReasoningEffort)?.name ?? selectedReasoningEffort;
  const reasoningChoices: Array<{ key: string; id?: string; name: string; description?: string }> = selectedReasoning === undefined
    ? []
    : [
      ...(selectedReasoning.defaultEffort === undefined ? [{ key: "provider-default", name: "默认" }] : []),
      ...selectedReasoning.efforts.map((effort) => ({ key: `effort:${effort.id}`, id: effort.id, name: effort.name, description: effort.description })),
    ];

  const activeGoal = goal && typeof goal === "object" ? goal.goal : null;
  const goalRoundsStarted = goal && typeof goal === "object" ? goal.roundsStarted : 0;
  useEffect(() => {
    if (activeGoal?.phase === "complete") {
      setGoalBarCollapsed(true);
    } else {
      setGoalBarCollapsed(false);
    }
  }, [activeGoal?.id, activeGoal?.phase]);
  const subagentEntries = subagents?.entries ?? [];
  const childSubagents = subagentEntries.filter((entry): entry is ChildSubagentEntry => entry.kind === "child");
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
          return { kind: "subagent" as const, id: entry.id, label: `@${label}`, detail: `${subagentModeLabel(entry.mode)} · ${subagentActivityLabel(entry.activity)}`, insertText: `@${label}` };
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
    if (!activeSessionId || !trigger || trigger.kind !== "reference") {
      setReferenceCandidates([]);
      controller.abort();
      return () => controller.abort();
    }
    const query = trigger.query;
    const request = <T,>(method: string) => bridgeRequest<{ items: T[] }>(method, { sessionId: activeSessionId, query }, controller.signal);
    const fileRequest = request<DshFileReferenceCandidate>("reference.files");
    const sessionRequest = trigger.quoted ? Promise.resolve({ items: [] as DshSessionReferenceCandidate[] }) : request<DshSessionReferenceCandidate>("reference.sessions");
    void Promise.allSettled([fileRequest, sessionRequest]).then(([files, sessions]) => {
      if (controller.signal.aborted || requestId !== referenceRequestRef.current) return;
      const fileItems = files.status === "fulfilled" && Array.isArray(files.value?.items) ? files.value.items : [];
      const sessionItems = sessions.status === "fulfilled" && Array.isArray(sessions.value?.items) ? sessions.value.items : [];
      setReferenceCandidates(referenceComposerCandidates(fileItems, sessionItems, trigger.quoted === true));
    });
    return () => { controller.abort(); };
  }, [activeSessionId, composerTrigger]);
  const activeComposerCandidateIndex = composerCandidates.length === 0
    ? 0
    : Math.min(composerCandidateIndex, composerCandidates.length - 1);
  const selectedSubagentIndex = childSubagents.findIndex((entry) => entry.id === selectedSubagentId);
  const selectedSubagent = selectedSubagentIndex >= 0 ? childSubagents[selectedSubagentIndex] : undefined;
  const providerNamespaces = useMemo(() => new Set(providers.map((provider) => provider.settingsNs)), [providers]);
  const pluginSettings = useMemo(() => (settings?.namespaces ?? []).filter((namespace) => !providerNamespaces.has(namespace.ns) && !["locale", "permission", "ui-conversation", "ui-theme", "ui-onboarding"].includes(namespace.ns)), [providerNamespaces, settings]);
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
    const result = await bridgeRequest<DshPluginConfigDescription>("plugin.config.describe");
    applyPluginConfig(result);
  }

  function addPlugin(draft: PluginInstallDraft): string | null {
    if (!desktop) return "添加插件只在 Tauri 桌面端可用。";
    setPluginConfigDraft((current) => [...current, {
      id: draft.id,
      name: draft.name,
      enabled: true,
      system: false,
      compatibility: { supported: true },
    }]);
    setPluginInstallOpen(false);
    setNotice(`已添加插件：${draft.id}，保存列表后即可应用`);
    return null;
  }

  async function pickPluginEntryForInstall(): Promise<string | null> {
    if (!desktop) return null;
    setPluginPickingEntry(true);
    try {
      return await pickPluginEntry();
    } catch (error) {
      setErrorNotice(errorText(error));
      return null;
    } finally {
      setPluginPickingEntry(false);
    }
  }

  async function savePluginConfig(): Promise<boolean> {
    if (!pluginConfig || !settings?.writable || pluginConfigSaving) return false;
    setPluginConfigSaving(true);
    try {
      const result = await bridgeRequest<DshPluginConfigMutation>("plugin.config.mutate", {
        expectedRevision: pluginConfig.revision,
        plugins: pluginConfigDraft.map(({ id, name, enabled }) => ({ id, name, enabled })),
      });
      applyPluginConfig(result);
      setNotice("插件列表已保存，重启 Deeptop 后生效");
      return true;
    } catch (error) {
      setErrorNotice(errorText(error));
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
    const [sessionResult, workspaceResult] = await Promise.allSettled([
      bridgeRequest<{ items: DshSessionSummary[] }>("session.list"),
      bridgeRequest<{ archivedSessionIds?: string[] }>("workspace.list"),
    ]);
    if (sessionResult.status !== "fulfilled") throw sessionResult.reason;
    const result = sessionResult.value;
    const archivedIds = workspaceResult.status === "fulfilled"
      ? new Set((workspaceResult.value.archivedSessionIds ?? []).filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0))
      : archivedSessionIds;
    const unique = [...new Map(result.items.filter((session) => session.sessionId).map((session) => [session.sessionId, session])).values()];
    setArchivedSessionIds(archivedIds);
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
    const [hostResult, presetResult, workspaceResult, settingsResult, providerResult, modelResult, pluginResult, pluginConfigResult] = await Promise.allSettled([
      bridgeRequest<Record<string, unknown>>("host.describe"),
      bridgeRequest<DshPresetRoster>("agentPreset.list"),
      bridgeRequest<{ items: DshWorkspace[]; archivedSessionIds?: string[] }>("workspace.list"),
      bridgeRequest<DshSettingsDescription>("settings.describe"),
      bridgeRequest<{ providers: DshProvider[] }>("llm.providers"),
      bridgeRequest<DshHostModelCatalog>("llm.models"),
      bridgeRequest<DshPluginInventorySnapshot>("plugin.list"),
      bridgeRequest<DshPluginConfigDescription>("plugin.config.describe"),
    ]);
    if (hostResult.status === "fulfilled") setRuntimeDetails(hostResult.value);
    if (presetResult.status === "fulfilled") {
      setPresets(presetResult.value.presets);
      setPresetAuthorable(presetResult.value.authorable);
      setPresetHasDocument(presetResult.value.hasDocument);
    }
    if (workspaceResult.status === "fulfilled" && workspaceVersion === workspaceRequestRef.current) {
      let workspaceItems = workspaceResult.value.items;
      let archivedIds = new Set((workspaceResult.value.archivedSessionIds ?? []).filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0));
      const attachedCount = await repairWorkspaceMembership(workspaceItems, sessionItems);
      if (attachedCount > 0) {
        try {
          const refreshed = await bridgeRequest<{ items: DshWorkspace[]; archivedSessionIds?: string[] }>("workspace.list");
          workspaceItems = refreshed.items;
          archivedIds = new Set((refreshed.archivedSessionIds ?? []).filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0));
        } catch {
          // The attach writes are durable; the next refresh will pick up the new projection.
        }
      }
      if (workspaceVersion === workspaceRequestRef.current) {
        if (attachedCount > 0) setNotice(`已将 ${attachedCount} 个历史会话登记到对应工作区`);
        setWorkspaces(workspaceItems);
        setArchivedSessionIds(archivedIds);
        if (!workspaceSelectionInitializedRef.current && activeSessionRef.current) {
          setWorkspace(workspaceItems.find((item) => item.sessionIds.includes(activeSessionRef.current!))?.path ?? "");
          workspaceSelectionInitializedRef.current = true;
        }
      }
    }
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    if (providerResult.status === "fulfilled") setProviders(providerResult.value.providers);
    if (modelResult.status === "fulfilled") setHostModels(modelResult.value);
    if (pluginResult.status === "fulfilled") {
      setPluginInventory(pluginResult.value.entries);
      setExcludedPlugins(pluginResult.value.excluded ?? []);
    }
    if (pluginConfigResult.status === "fulfilled") applyPluginConfig(pluginConfigResult.value);
  }

  async function loadSubagents(parentSessionId = activeSessionRef.current) {
    if (!desktop || !parentSessionId) return;
    try {
      setSubagents(await bridgeRequest<DshSubagentCatalog>("subagent.list", { parentSessionId }));
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function loadCommands(sessionId = activeSessionRef.current) {
    if (!desktop || !sessionId) {
      setCommands([]);
      return;
    }
    try {
      const result = await desktopClientRuntime.remote.invoke<DshCommandDescriptor[]>("commands", "list", { agentId: sessionId });
      if (activeSessionRef.current !== sessionId) return;
      setCommands(Array.isArray(result) ? [...result] : []);
    } catch {
      if (activeSessionRef.current !== sessionId) return;
      setCommands([]);
    }
  }

  async function loadAnnotations(sessionId = activeSessionRef.current) {
    if (!desktop || !sessionId) {
      setAnnotations({});
      return;
    }
    try {
      const result = await bridgeRequest<DshMessageAnnotationResult<{ items: DshMessageAnnotationItem[] }>>("messageAnnotations.list", { sessionId });
      if (activeSessionRef.current !== sessionId) return;
      if (!result.ok) throw new Error(result.error.code);
      setAnnotations(Object.fromEntries(result.value.items.map((item) => [item.messageId, item])));
    } catch {
      if (activeSessionRef.current !== sessionId) return;
      setAnnotations({});
    }
  }

  useEffect(() => {
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
    setSubagentDockOpen(false);
    setSkills([]);
    setCommands([]);
    setAnnotations({});
    setPermissionSelect(null);
    setPlan(null);
    void loadSubagents();
    if (activeSessionId) {
      void loadCommands(activeSessionId);
      void loadAnnotations(activeSessionId);
      void bridgeRequest<{ skills: DshSkill[] }>("skill.list", { sessionId: activeSessionId })
        .then((result) => setSkills(result.skills))
        .catch(() => undefined);
    }
  }, [activeSessionId]);

  useEffect(() => {
    setComposerCandidateIndex(0);
    setComposerMenuDismissed(false);
  }, [composerTrigger?.kind, composerTrigger?.query]);

  async function loadSurface(tab: SurfaceTab) {
    if (!desktop || !activeSessionId && ["skills", "subagents", "goal"].includes(tab)) return;
    setSurfaceLoading(true);
    try {
      if (tab === "skills" && activeSessionId) {
        const result = await bridgeRequest<{ skills: DshSkill[] }>("skill.list", { sessionId: activeSessionId });
        setSkills(result.skills);
      }
      if (tab === "subagents" && activeSessionId) {
        setSubagents(await bridgeRequest<DshSubagentCatalog>("subagent.list", { parentSessionId: activeSessionId }));
      }
      if (tab === "runtime" && activeSessionId) {
        await Promise.all([loadCommands(activeSessionId), loadAnnotations(activeSessionId)]);
      }
      if (tab === "goal" && activeSessionId) {
        const historyResult = await bridgeRequest<{ events: DshHistoryEntry[]; projections?: { values: Record<string, unknown> } }>("session.history", { sessionId: activeSessionId, maxMessages: 100 });
        setGoal((historyResult.projections?.values.goal as DshGoalProjection | null | undefined) ?? null);
      }
      if (tab === "settings") {
        const [settingsResult, pluginResult, pluginConfigResult] = await Promise.allSettled([
          bridgeRequest<DshSettingsDescription>("settings.describe"),
          bridgeRequest<DshPluginInventorySnapshot>("plugin.list"),
          bridgeRequest<DshPluginConfigDescription>("plugin.config.describe"),
        ]);
        if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
        if (pluginResult.status === "fulfilled") {
          setPluginInventory(pluginResult.value.entries);
          setExcludedPlugins(pluginResult.value.excluded ?? []);
        }
        if (pluginConfigResult.status === "fulfilled") applyPluginConfig(pluginConfigResult.value);
      }
    } catch (error) {
      setErrorNotice(errorText(error));
    } finally {
      setSurfaceLoading(false);
    }
  }

  async function refreshSettings() {
    const result = await bridgeRequest<DshSettingsDescription>("settings.describe");
    setSettings(result);
    return result;
  }

  function stagePresetForNextSession(id: string) {
    const preset = presets.find((item) => item.id === id && !item.broken);
    if (!preset) return;
    setNextPreset(id);
    setPresetMenuOpen(false);
    setNotice(`下一个会话将使用 ${presetDisplayName(id, presets)}`);
  }

  async function setDefaultPreset(id: string) {
    const preset = presets.find((item) => item.id === id && !item.broken);
    if (!preset) return;
    try {
      await bridgeRequest("settings.update", { ns: "agent-presets", patch: { default: id } });
      setNextPreset("");
      await loadRuntimeDetails();
      setNotice(`${presetDisplayName(id, presets)} 已设为新会话默认值`);
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function readPreset(id: string) {
    try {
      const result = await bridgeRequest<{ agentPreset: string; content: string }>("agentPreset.read", { agentPreset: id });
      setPresetView({ id: result.agentPreset, content: result.content });
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function copyPreset() {
    if (!presetCopy || !presetAuthorable) return;
    const id = presetCopy.id.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setNotice("Preset id 只能使用小写字母、数字与连字符，且以字母或数字开头");
      return;
    }
    if (presets.some((preset) => preset.id === id)) {
      setNotice("该 Preset id 已被占用");
      return;
    }
    try {
      await bridgeRequest("agentPreset.copy", {
        from: presetCopy.from,
        agentPreset: id,
        ...(presetCopy.name.trim() ? { name: presetCopy.name.trim() } : {}),
      });
      setPresetCopy(null);
      await loadRuntimeDetails();
      await openPresetDocument(id);
      setNotice("Agent Preset 已复制");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function openPresetDocument(id: string) {
    try {
      const result = await bridgeRequest<{ opened: true } | { opened: false; path: string }>("agentPreset.openDocument", { agentPreset: id });
      setNotice(result.opened ? "已打开 Preset 文件夹" : `Preset 文件夹：${result.path}`);
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function openSubagent(address: DshSubagentAddress) {
    const requestId = ++subagentRequestRef.current;
    setSelectedSubagentId(address.childSessionId);
    setSubagentSession(null);
    setSubagentLoadError(null);
    setSubagentLoadingId(address.childSessionId);
    try {
      const result = await bridgeRequest<{ events: DshHistoryEntry[] }>("subagent.history", { ...address });
      if (requestId !== subagentRequestRef.current) return;
      setSubagentSession({ address, history: result.events });
    } catch (error) {
      if (requestId !== subagentRequestRef.current) return;
      const message = errorText(error);
      setSubagentLoadError(message);
      setErrorNotice(message);
    } finally {
      if (requestId === subagentRequestRef.current) setSubagentLoadingId(null);
    }
  }

  function toggleSubagent(entry: ChildSubagentEntry, index: number) {
    if (subagentPanelOpen && selectedSubagentId === entry.id) {
      setSubagentPanelOpen(false);
      return;
    }
    // Drawer 打开时保留右侧 Dock，方便继续切换其他子 Agent。
    setSubagentDockOpen(true);
    setSubagentPanelOpen(true);
    void openSubagent({
      parentSessionId: activeSessionId!,
      childSessionId: entry.id,
      mode: entry.mode,
    });
    setNotice(`正在打开 ${subagentDisplayName(entry, index)}`);
  }

  function toggleSubagentDock() {
    setSubagentPanelOpen(false);
    setSubagentDockOpen((open) => !open);
  }

  async function promptSubagent() {
    if (!subagentSession || !subagentComposer.trim() || subagentSession.address.mode !== "continuable") return;
    try {
      await bridgeRequest("subagent.prompt", {
        ...subagentSession.address,
        content: [{ type: "text", text: subagentComposer.trim() }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setSubagentComposer("");
      setNotice("已发送给子 Agent");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function interruptSubagent(address: DshSubagentAddress) {
    if (address.mode !== "continuable") return;
    try {
      await bridgeRequest("subagent.interrupt", { ...address });
      setNotice("已请求停止子 Agent");
    } catch (error) {
      setErrorNotice(errorText(error));
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
      setErrorNotice("最大回合数必须是大于 0 的整数");
      return;
    }
    setGoalPanelBusy(true);
    try {
      await bridgeRequest("goal.create", { sessionId: activeSessionId, objective: goalDraft.trim(), ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) });
      setGoalDraft("");
      setGoalMaxRoundsDraft("");
      await loadSurface("goal");
      setGoalPanelOpen(false);
      setNotice("Goal 已创建");
    } catch (error) {
      setErrorNotice(errorText(error));
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
          setErrorNotice("Goal 目标不能为空");
          return;
        }
        if (!Number.isSafeInteger(maxGoalRounds) || maxGoalRounds < 1) {
          setErrorNotice("最大回合数必须是大于 0 的整数");
          return;
        }
        await bridgeRequest("goal.edit", { sessionId: activeSessionId, ref, objective: goalDraft.trim(), maxGoalRounds });
      } else {
        await bridgeRequest(`goal.${action}`, { sessionId: activeSessionId, ref });
      }
      await loadSurface("goal");
      if (action === "clear") {
        syncGoalDraft(null);
        setGoalPanelOpen(false);
      } else if (action === "edit") {
        setGoalDraft("");
        setGoalMaxRoundsDraft("");
      }
      setNotice(`Goal 已${action === "clear" ? "清除" : "更新"}`);
    } catch (error) {
      setErrorNotice(errorText(error));
    } finally {
      setGoalPanelBusy(false);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    try {
      const patch = parseJsonObject(settingsDraft.value);
      const ops = settingsOps(settingsDraft.original, patch, [], settingsDraft.secrets);
      if (ops.length === 0) {
        setSettingsDraft(null);
        return;
      }
      await bridgeRequest("settings.mutate", {
        ns: settingsDraft.ns,
        ops,
        expectedRevision: settingsDraft.revision,
      });
      setSettingsDraft(null);
      await refreshSettings();
      setNotice(`${settingsDraft.ns} 已更新`);
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function openSession(session: DshSessionSummary, allowAutoRepair = true): Promise<boolean> {
    if (!desktop) return false;
    const loadRequest = ++sessionLoadRequestRef.current;
    activeSessionRef.current = session.sessionId;
    contextProjectionRef.current = false;
    setCorruptSession(null);
    setPresetMigration(null);
    setPresetMigrationSelection("");
    setSessionIndicators((current) => ({ ...current, [session.sessionId]: "idle" }));
    setActiveSessionId(session.sessionId);
    setWorkspace(workspaces.find((item) => item.sessionIds.includes(session.sessionId))?.path ?? session.cwd ?? "");
    setHistory([]);
    setHistoryHasMore(false);
    setHistoryLoadingOlder(false);
    setTranscriptFollowing(true);
    setTodos(null);
    setTrajectoryOpen(false);
    setTokenUsageOpen(false);
    setQueue([]);
    setQueueEditingId(null);
    setQueueEditingText("");
    setAttachments([]);
    setGoal(undefined);
    setGoalBarCollapsed(false);
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
    setSubagentDockOpen(false);
    setPresetView(null);
    setModels(null);
    setDraftModelSelection(null);
    setDraftPermission(null);
    setPermissionSelect(null);
    setAnnotations({});
    setLoading(true);
    try {
      const [historyResult, modelsResult] = await Promise.all([
        bridgeRequest<{ events: DshHistoryEntry[]; hasMore: boolean; projections?: { values: Record<string, unknown> } }>("session.history", {
          sessionId: session.sessionId,
          maxMessages: 100,
        }),
        bridgeRequest<DshSessionModels>("session.models", { sessionId: session.sessionId }),
      ]);
      if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return false;
      setHistory(historyResult.events);
      setHistoryHasMore(historyResult.hasMore);
      const loadedStats = readSessionStats(historyResult.events, historyResult.projections);
      contextProjectionRef.current = Boolean(recordValue(historyResult.projections?.values.contextPressure));
      setSessionStats({ ...loadedStats, contextLimit: modelsResult.contextWindow ?? loadedStats.contextLimit });
      const projectionValues = historyResult.projections?.values;
      const projectedImageLimits = imageLimitsFromProjection(projectionValues?.imageLimits);
      setModels({ ...modelsResult, ...(projectedImageLimits ? { imageLimits: projectedImageLimits } : {}) });
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
      if (modelsResult.routable) setNotice("会话已打开");
      else setErrorNotice("当前模型路由不可用");
      return true;
    } catch (error) {
      if (allowAutoRepair && isSessionLogCorruption(error)) {
        // 崩溃损坏了会话日志（末尾写入不完整）：自动修复一次后重试打开。
        try {
          const repair = await repairCorruptSession(session.sessionId);
          if (repair.repaired) {
            const dropped = [repair.droppedTorn > 0 ? `${repair.droppedTorn} 条未完成记录` : null, repair.droppedSeqGap > 0 ? `${repair.droppedSeqGap} 条重叠记录` : null].filter(Boolean).join("、");
            setNotice(`已自动修复崩溃损坏的会话日志（保留 ${repair.recoveredEvents} 条已提交记录${dropped ? `，丢弃 ${dropped}` : ""}）`);
          } else {
            setNotice("会话日志已恢复可读，正在重新打开");
          }
        } catch (repairError) {
          setCorruptSession(session);
          setErrorNotice(`自动修复会话日志失败：${errorText(repairError)}`);
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
            const rosterResult = await bridgeRequest<DshPresetRoster>("agentPreset.list");
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
          setErrorNotice(`会话依赖的 Agent Preset “${missing.missingPreset}”已不存在。请选择替代 Preset，以迁移副本后继续。原会话不会被修改。`);
        } else {
          setErrorNotice(errorText(error));
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
        const dropped = [repair.droppedTorn > 0 ? `${repair.droppedTorn} 条未完成记录` : null, repair.droppedSeqGap > 0 ? `${repair.droppedSeqGap} 条重叠记录` : null].filter(Boolean).join("、");
        setNotice(`已修复会话日志（保留 ${repair.recoveredEvents} 条已提交记录${dropped ? `，丢弃 ${dropped}` : ""}）`);
      } else {
        setNotice("会话日志当前可读，正在重新打开");
      }
      setCorruptSession(null);
      void openSessionRef.current(target);
    } catch (error) {
      setErrorNotice(`修复会话日志失败：${errorText(error)}`);
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
        setNotice("通知对应的会话已不存在");
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
      const result = await bridgeRequest<{ events: DshHistoryEntry[]; projections?: { values: Record<string, unknown> } }>("session.history", {
        sessionId,
        maxMessages: 100,
      });
      if (activeSessionRef.current !== sessionId) return;
      const projectedImageLimits = imageLimitsFromProjection(result.projections?.values?.imageLimits);
      if (projectedImageLimits) setModels((current) => current ? { ...current, imageLimits: projectedImageLimits } : current);
      if (recordValue(result.projections?.values.contextPressure)) contextProjectionRef.current = true;
       const nextStats = readSessionStats(result.events, result.projections);
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

  async function loadOlderHistory() {
    const sessionId = activeSessionRef.current;
    const beforeSeq = history[0]?.event.seq;
    if (!sessionId || beforeSeq === undefined || !historyHasMore || historyLoadingOlderRef.current) return;
    const scroll = transcriptScroll.current;
    const previousHeight = scroll?.scrollHeight ?? 0;
    const previousTop = scroll?.scrollTop ?? 0;
    historyLoadingOlderRef.current = true;
    setHistoryLoadingOlder(true);
    try {
      const result = await bridgeRequest<{ events: DshHistoryEntry[]; hasMore: boolean }>("session.history", {
        sessionId,
        beforeSeq,
        maxMessages: 100,
      });
      setHistory((current) => {
        const known = new Set(current.map((entry) => entry.event.seq));
        return [...result.events.filter((entry) => !known.has(entry.event.seq)), ...current];
      });
      setHistoryHasMore(result.hasMore);
      requestAnimationFrame(() => {
        const nextScroll = transcriptScroll.current;
        if (!nextScroll) return;
        nextScroll.scrollTop = nextScroll.scrollHeight - previousHeight + previousTop;
      });
    } catch (error) {
      setErrorNotice(errorText(error));
    } finally {
      historyLoadingOlderRef.current = false;
      setHistoryLoadingOlder(false);
    }
  }

  async function handleExternalLaunch(request: ExternalLaunchRequest) {
    const path = request.cwd.trim();
    if (!path) throw new Error("右键启动没有提供有效工作目录");
    const known = workspacesRef.current.find((item) => sameWorkspacePath(item.path, path));
    if (known) {
      await chooseWorkspaceRef.current(known.path);
    } else {
      const result = await bridgeRequest<{ workspace: DshWorkspace }>("workspace.create", { path });
      workspaceSelectionInitializedRef.current = true;
      setWorkspace(result.workspace.path);
      setWorkspaces((current) => current.some((item) => item.workspaceId === result.workspace.workspaceId)
        ? current.map((item) => item.workspaceId === result.workspace.workspaceId ? result.workspace : item)
        : [result.workspace, ...current]);
      await syncConversationToWorkspaceRef.current(result.workspace.path);
    }
    setNotice(`已从路径启动 Deeptop：${path}`);
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
          setErrorNotice(`右键启动失败：${errorText(error)}`);
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
      setContextMenuStatus({ supported: false, enabled: false, managed: false, message: errorText(error) });
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
      setErrorNotice(`更新右键启动设置失败：${errorText(error)}`);
      await loadContextMenuStatus();
    } finally {
      setContextMenuUpdating(false);
    }
  }

  async function boot() {
    if (!desktop) {
      setNotice("浏览器预览模式");
      return;
    }
    try {
      setStartupLogs([]);
      const nextStatus = await withTimeout(checkDsh(), 10_000, "DSH 检查超时，请重试");
      runtimeAvailableRef.current = nextStatus.runtimeAvailable;
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
      const message = errorText(error);
      runtimeAvailableRef.current = false;
      setStatus((current) => ({ ...current, runtimeAvailable: false, runtimeStarting: false, message }));
      setErrorNotice(message);
    }
  }

  const routedBridgeEvent = (event: DshBridgeEvent) => routeBridgeEvent(event, {
    activeSessionRef,
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
    loadSubagents,
    refreshSessionStats,
    startNewSession,
    promoteSessionOnMessage,
  });

  useEffect(() => {
    if (!desktop) return;
    const cleanups: Array<UnlistenFn | undefined> = [];
    void listenToRuntimeStatus((nextStatus) => {
      const wasAvailable = runtimeAvailableRef.current;
      runtimeAvailableRef.current = nextStatus.runtimeAvailable;
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
        })().catch((error) => setErrorNotice(errorText(error)));
      } else if (wasAvailable) {
        // Transitioned from available to unavailable: DSH crashed or was stopped.
        // Remember we must recover, and snapshot the active session so it can be
        // reopened once DSH returns.
        runtimeDownRef.current = true;
        downActiveSessionRef.current = activeSessionRef.current;
      }
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToDiagnostic((message) => {
      setErrorNotice(message);
      setStatus((current) => current.runtimeAvailable ? current : { ...current, message });
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToRuntimeLog((log) => {
      setStartupLogs((current) => [...current, log].slice(-160));
      setAppLogs((current) => [...current, log].slice(-2000));
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToNotificationClick((sessionId) => {
      void openNotificationSession(sessionId).catch((error) => setErrorNotice(errorText(error)));
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToTraySessionOpen((sessionId) => {
      void openNotificationSession(sessionId).catch((error) => setErrorNotice(errorText(error)));
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToTrayNewChat(() => {
      startNewSession();
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToSingleInstance(() => {
      setNotice("已切换到正在运行的 Deeptop");
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToExternalLaunch((request) => {
      queueExternalLaunch(request);
    }).then((unlisten) => { cleanups.push(unlisten); });
    void desktopClientRuntime.remote.on("commands/change", () => { void loadCommands(); }).then((unlisten) => { cleanups.push(unlisten); });
    void desktopClientRuntime.start(routedBridgeEvent).then((unlisten) => { cleanups.push(unlisten); });
    void boot();
    return () => { cleanups.forEach((cleanup) => cleanup?.()); };
  }, [desktop]);

  useEffect(() => {
    if (!transcriptFollowing || historyLoadingOlderRef.current) return;
    transcriptEnd.current?.scrollIntoView({ behavior: "auto" });
  }, [history, loading, transcriptFollowing]);

  function firstConversationForWorkspace(workspacePath: string, workspaceItem: DshWorkspace | null): DshSessionSummary | null {
    // Mirrors the sidebar workspace grouping so the conversation page always opens a
    // session that the sidebar can highlight for the newly selected workspace.
    const visibleById = new Map(visibleSessions.map((session) => [session.sessionId, session]));
    if (workspaceItem) {
      for (const sessionId of workspaceItem.sessionIds) {
        const session = visibleById.get(sessionId);
        if (session) return session;
      }
      return null;
    }
    if (!workspacePath) {
      // 未分组：不属于任何工作区的第一个会话。
      return visibleSessions.find((session) => !workspaceBySessionId.has(session.sessionId)) ?? null;
    }
    return null;
  }

  async function syncConversationToWorkspace(workspacePath: string) {
    if (!desktop) return;
    // Read the authoritative workspace projection so sessions attached during
    // add/choose are included when selecting the first conversation.
    let workspaceItem = workspaces.find((item) => sameWorkspacePath(item.path, workspacePath)) ?? null;
    if (workspacePath) {
      try {
        const refreshed = await bridgeRequest<{ items: DshWorkspace[] }>("workspace.list");
        workspaceItem = refreshed.items.find((item) => sameWorkspacePath(item.path, workspacePath)) ?? workspaceItem;
      } catch {
        // Fall back to the local projection.
      }
    }
    const first = firstConversationForWorkspace(workspacePath, workspaceItem);
    if (first) {
      if (activeSessionRef.current !== first.sessionId) await openSession(first);
    } else {
      startNewSession();
    }
  }

  async function addWorkspace() {
    if (!desktop) {
      setNotice("请在 Tauri 桌面端选择本地目录");
      return;
    }
    try {
      const picked = await pickWorkspace();
      if (!picked) return;
      workspaceSelectionInitializedRef.current = true;
      setWorkspace(picked);
      setWorkspaceMenuOpen(false);
      setNotice("新会话将使用此工作目录");
      try {
        const result = await bridgeRequest<{ workspace: DshWorkspace }>("workspace.create", { path: picked });
        setWorkspace(result.workspace.path);
        setWorkspaces((current) => current.some((item) => item.workspaceId === result.workspace.workspaceId)
          ? current.map((item) => item.workspaceId === result.workspace.workspaceId ? result.workspace : item)
          : [result.workspace, ...current]);
        const attachedCount = await attachUnregisteredSessions(result.workspace);
        await loadRuntimeDetails();
        if (attachedCount > 0) setNotice(`已将 ${attachedCount} 个同目录会话登记到工作区`);
        // 保持对话页面与工作区选择同步：打开新工作区的第一个会话，没有会话则显示新会话页面。
        await syncConversationToWorkspace(result.workspace.path);
      } catch {
        // A session can use a directory even when workspace registration is unavailable.
      }
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  chooseWorkspaceRef.current = chooseWorkspace;
  syncConversationToWorkspaceRef.current = syncConversationToWorkspace;

  async function chooseWorkspace(path: string) {
    workspaceSelectionInitializedRef.current = true;
    setWorkspace(path);
    setWorkspaceMenuOpen(false);
    setNotice(path ? "新会话将使用此工作目录" : "新会话将使用 DSH 运行目录");
    const selected = workspaces.find((item) => item.path === path);
    if (selected) {
      try {
        const attachedCount = await attachUnregisteredSessions(selected);
        if (attachedCount > 0) {
          await loadRuntimeDetails();
          setNotice(`已将 ${attachedCount} 个同目录会话登记到工作区`);
        }
      } catch (error) {
        setErrorNotice(errorText(error));
      }
    }
    // 保持对话页面与工作区选择同步：打开新工作区的第一个会话，没有会话则显示新会话页面。
    await syncConversationToWorkspace(path);
  }

  async function repairWorkspaceMembership(
    workspaceItems: DshWorkspace[],
    sessionItems: DshSessionSummary[],
    allWorkspaceItems = workspaceItems,
  ) {
    const registeredSessionIds = new Set(allWorkspaceItems.flatMap((item) => item.sessionIds));
    const candidates = workspaceItems.flatMap((item) => sessionItems
      .filter((session) => Boolean(session.cwd) && sameWorkspacePath(session.cwd, item.path) && !registeredSessionIds.has(session.sessionId))
      .map((session) => ({ item, session })));
    if (candidates.length === 0) return 0;
    // The official attach operation performs canonical-path validation; this is only a candidate hint.
    const results = await Promise.allSettled(candidates.map(({ item, session }) => bridgeRequest("workspace.attachSession", {
      workspaceId: item.workspaceId,
      sessionId: session.sessionId,
    })));
    return results.filter((result) => result.status === "fulfilled").length;
  }

  async function attachUnregisteredSessions(item: DshWorkspace) {
    return repairWorkspaceMembership([item], sessions, [...workspaces, item]);
  }

  function toggleWorkspace(workspaceId: string) {
    setCollapsedWorkspaces((current) => ({ ...current, [workspaceId]: !current[workspaceId] }));
  }

  // 置顶工作区：置顶后固定显示在侧栏最上方，保持置顶顺序。
  function togglePinWorkspace(item: DshWorkspace) {
    setPinnedWorkspaceIds((current) => current.includes(item.workspaceId)
      ? current.filter((workspaceId) => workspaceId !== item.workspaceId)
      : [...current, item.workspaceId]);
  }

  async function renameWorkspace(item: DshWorkspace) {
    const title = await requestPrompt("重命名工作区", item.title, "修改工作区在侧边栏中的显示名称。");
    if (!title?.trim() || title.trim() === item.title) return;
    try {
      const result = await bridgeRequest<{ workspace: DshWorkspace }>("workspace.rename", {
        workspaceId: item.workspaceId,
        title: title.trim(),
      });
      setWorkspaces((current) => current.map((workspaceItem) => workspaceItem.workspaceId === item.workspaceId
        ? { ...result.workspace, pinnedSessionIds: result.workspace.pinnedSessionIds ?? workspaceItem.pinnedSessionIds }
        : workspaceItem));
      setNotice("工作区已重命名");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function removePreset(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset || preset.trust !== "user") return;
    if (!await requestConfirm(`删除 Agent Preset“${presetDisplayName(id, presets)}”？已在其上运行的会话不受影响。`)) return;
    try {
      await bridgeRequest("agentPreset.remove", { agentPreset: id });
      if (nextPreset === id) setNextPreset("");
      setPresetView((current) => current?.id === id ? null : current);
      await loadRuntimeDetails();
      setNotice("Agent Preset 已删除");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function deleteWorkspace(item: DshWorkspace) {
    if (!await requestConfirm(`删除工作区“${item.title || projectName(item.path)}”？不会删除目录和会话。`)) return;
    try {
      await bridgeRequest("workspace.delete", { workspaceId: item.workspaceId });
      setWorkspaces((current) => current.filter((workspaceItem) => workspaceItem.workspaceId !== item.workspaceId));
      setPinnedWorkspaceIds((current) => current.filter((workspaceId) => workspaceId !== item.workspaceId));
      setCollapsedWorkspaces((current) => {
        const next = { ...current };
        delete next[item.workspaceId];
        return next;
      });
      if (workspace === item.path) setWorkspace("");
      setNotice("工作区已移除");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function performMoveSessionBefore(sessionId: string, beforeSessionId: string, announce = true) {
    if (sessionId === beforeSessionId) return;
    const targetWorkspace = workspacesRef.current.find((item) => item.sessionIds.includes(beforeSessionId));
    if (!targetWorkspace) {
      setNotice("未分组会话不能参与工作区排序");
      return;
    }
    const workspaceVersion = ++workspaceRequestRef.current;
    try {
      const attachedSessionIds = new Set(targetWorkspace.sessionIds);
      for (const candidateSessionId of [beforeSessionId, sessionId]) {
        if (attachedSessionIds.has(candidateSessionId)) continue;
        await bridgeRequest("workspace.attachSession", {
          workspaceId: targetWorkspace.workspaceId,
          sessionId: candidateSessionId,
        });
        attachedSessionIds.add(candidateSessionId);
      }
      await bridgeRequest("workspace.insertSessionBefore", {
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
      workspacesRef.current = nextWorkspaces;
      setWorkspaces(nextWorkspaces);

      // Read back only the authoritative workspace projection. A broad runtime
      // refresh is slower and can briefly restore a stale sessionIds array.
      const refreshed = await bridgeRequest<{ items: DshWorkspace[]; archivedSessionIds?: string[] }>("workspace.list");
      if (workspaceVersion !== workspaceRequestRef.current) return;
      workspacesRef.current = refreshed.items;
      setWorkspaces(refreshed.items);
      if (refreshed.archivedSessionIds) setArchivedSessionIds(new Set(refreshed.archivedSessionIds));
      if (announce) setNotice("会话顺序已更新");
    } catch (error) {
      if (announce) setErrorNotice(errorText(error));
    }
  }

  async function performToggleSessionPin(session: DshSessionSummary) {
    if (!desktop) return;
    const currentWorkspace = workspacesRef.current.find((item) => item.sessionIds.includes(session.sessionId));
    if (!currentWorkspace) {
      setNotice("未分组会话不能置顶");
      return;
    }
    const pinned = new Set(currentWorkspace.pinnedSessionIds ?? []);
    const nextPinned = !pinned.has(session.sessionId);
    try {
      const result = await bridgeRequest<{ workspaceId: string; pinnedSessionIds: string[] }>("workspace.setSessionPinned", {
        workspaceId: currentWorkspace.workspaceId,
        sessionId: session.sessionId,
        pinned: nextPinned,
      });
      const nextWorkspaces = workspacesRef.current.map((item) => item.workspaceId === result.workspaceId
        ? { ...item, pinnedSessionIds: result.pinnedSessionIds }
        : item);
      workspacesRef.current = nextWorkspaces;
      setWorkspaces(nextWorkspaces);
      setNotice(nextPinned ? "会话已置顶" : "会话已取消置顶");
    } catch (error) {
      setErrorNotice(errorText(error));
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

  function startNewSession() {
    activeSessionRef.current = null;
    contextProjectionRef.current = false;
    setActiveSessionId(null);
    setHistory([]);
    setHistoryHasMore(false);
    setHistoryLoadingOlder(false);
    setTranscriptFollowing(true);
    setTodos(null);
    setTrajectoryOpen(false);
    setTokenUsageOpen(false);
    setComposer("");
    setAttachments([]);
    setModels(null);
    setDraftModelSelection(null);
    setDraftPermission(null);
    setSessionStats({ inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, messages: 0 });
    setCommands([]);
    setAnnotations({});
    setPermissionSelect(null);
    setPlan(null);
    setQueue([]);
    setQueueEditingId(null);
    setQueueEditingText("");
    setGoal(undefined);
    setGoalBarCollapsed(false);
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
    setSubagentDockOpen(false);
    setPresetMenuOpen(false);
    setNotice("输入消息后创建会话");
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
    const created = await bridgeRequest<{ sessionId: string; agentPreset?: string }>("session.create", {
      ...(selectedWorkspace ? { workspaceId: selectedWorkspace.workspaceId } : workspace ? { cwd: workspace } : {}),
      ...(presetId ? { agentPreset: presetId } : {}),
    });
    activeSessionRef.current = created.sessionId;
    setActiveSessionId(created.sessionId);
    if (requestedModel) {
      await bridgeRequest("session.selectModel", {
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
      const attached = await bridgeRequest<{ workspace: DshWorkspace }>("workspace.attachSession", {
        workspaceId: selectedWorkspace.workspaceId,
        sessionId: created.sessionId,
      });
      setWorkspaces((current) => current.map((item) =>
        item.workspaceId === attached.workspace.workspaceId ? attached.workspace : item,
      ));
    }
    const nextSessions = await loadSessions();
    await loadRuntimeDetails(nextSessions ?? []);
    setDraftModelSelection(null);
    setDraftPermission(null);
    setNextPreset("");
    setPresetMenuOpen(false);
    const nextModels = await bridgeRequest<DshSessionModels>("session.models", { sessionId: created.sessionId });
    const historyResult = await bridgeRequest<{ projections?: { values: Record<string, unknown> } }>("session.history", {
      sessionId: created.sessionId,
      maxMessages: 1,
    });
    const projectedImageLimits = imageLimitsFromProjection(historyResult.projections?.values?.imageLimits);
    setModels({ ...nextModels, ...(projectedImageLimits ? { imageLimits: projectedImageLimits } : {}) });
    if (nextModels.contextWindow !== undefined) setSessionStats((current) => ({ ...current, contextLimit: nextModels.contextWindow! }));
    if (!nextModels.routable) {
      setErrorNotice("当前模型路由不可用，请切换模型或检查 Provider 配置");
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
    const execution = await desktopClientRuntime.remote.invoke<DshCommandExecution | undefined>("commands", "execute", {
      agentId: sessionId,
      line,
      images: [],
    });
    if (!execution) {
      setErrorNotice(`未知命令：${line}`);
      return undefined;
    }
    if (execution.result.kind === "error") setErrorNotice(execution.result.text);
    return execution;
  }

  async function sendPrompt() {
    const text = composer.trim();
    if ((!text && attachments.length === 0) || loading || !status.runtimeAvailable) return;
    if (activeSessionId && models && !models.routable) {
      setErrorNotice("当前模型路由不可用，请切换模型或检查 Provider 配置");
      return;
    }
    if (attachments.length > 0) {
      if (!selectedModelSupportsImages) {
        setErrorNotice("当前模型仅支持文本输入，图片未发送。请切换到支持图片输入的模型后重试");
        return;
      }
    }
    setLoading(true);
    setNotice(promptMode === "steer" ? "正在插入当前回合" : "正在发送");
    try {
      const sessionId = await ensureSession();
      const admissionModels = await bridgeRequest<DshSessionModels>("session.models", { sessionId });
      setModels((current) => current?.imageLimits ? { ...admissionModels, imageLimits: current.imageLimits } : admissionModels);
      if (!admissionModels.routable) {
        setErrorNotice("当前模型路由不可用，请切换模型或检查 Provider 配置");
        return;
      }
      const commandName = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(text)?.[1].toLocaleLowerCase();
      if (!attachments.length && commandName && commands.some((command) => command.name === commandName)) {
        const execution = await executeCommandLine(sessionId, text);
        if (!execution || execution.result.kind === "error") return;
        setComposer("");
        if (commandName === "export") {
          await exportSessionZip(sessionId);
        } else {
          setNotice(execution.result.text || `/${commandName} 已执行`);
        }
        return;
      }
      const promptPayload: DshSessionPromptPayload = {
        sessionId,
        mode: promptMode,
        content: promptContentParts(text, attachments),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      await bridgeRequest("session.prompt", { ...promptPayload });
      setComposer("");
      setAttachments([]);
      void refreshSessionStats(sessionId);
      setNotice(promptMode === "steer" ? "已插入当前回合" : "已发送");
    } catch (error) {
      setErrorNotice(errorText(error));
    } finally {
      setLoading(false);
    }
  }

  async function cancelSession() {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    try {
      await bridgeRequest("session.cancel", { sessionId });
      setNotice("已请求停止当前回合");
    } catch (error) {
      setErrorNotice(errorText(error));
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
    setNotice("文件路径已添加到聊天框");
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
      const result = await bridgeRequest<{ sessionId: string }>("session.fork", {
        sessionId,
        ...(atSeq === undefined ? {} : { atSeq }),
      });
      const nextSessions = await loadSessions();
      const forked = nextSessions?.find((session) => session.sessionId === result.sessionId);
      if (forked) await openSession(forked);
      else setNotice("已创建分叉会话");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function migrateMissingPreset() {
    if (!presetMigration || !presetMigrationSelection || presetMigrationRunning) return;
    const replacement = presets.find((preset) => preset.id === presetMigrationSelection && !preset.broken);
    if (!replacement) {
      setErrorNotice("请选择当前可用的 Agent Preset");
      return;
    }
    const confirmed = await requestConfirm(
      `原会话引用的 Agent Preset “${presetMigration.missingPreset}”已被删除，无法按原配置恢复。将创建一个保留现有历史的新副本，并使用“${presetDisplayName(replacement.id, presets)}”（${replacement.id}）。原会话会保留不变。由于工具、提示词和能力可能不同，历史中的工具调用可能只能以兼容或通用形式显示，后续回复也可能不同。确认迁移并打开副本吗？`,
    );
    if (!confirmed) return;
    setPresetMigrationRunning(true);
    try {
      const result = await bridgeRequest<{ sessionId: string }>("session.fork", {
        sessionId: presetMigration.session.sessionId,
        agentPreset: replacement.id,
      });
      const nextSessions = await loadSessions();
      const migrated = nextSessions?.find((session) => session.sessionId === result.sessionId);
      setPresetMigration(null);
      if (migrated) {
        await openSession(migrated, false);
        setNotice(`已迁移为新会话副本（Preset：${presetDisplayName(replacement.id, presets)}）；原会话仍保留`);
      } else {
        setNotice("已创建迁移副本；原会话仍保留");
      }
    } catch (error) {
      setErrorNotice(`迁移会话失败：${errorText(error)}。原会话未修改。`);
    } finally {
      setPresetMigrationRunning(false);
    }
  }

  async function loadHistoryForRetry(sessionId: string, targetSeq: number) {
    const pages: DshHistoryEntry[] = [];
    let beforeSeq: number | undefined;
    let targetFound = false;
    for (let page = 0; page < 100; page += 1) {
      const result = await bridgeRequest<{ events: DshHistoryEntry[]; hasMore: boolean }>("session.history", {
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
    if (!await requestConfirm("将清除此消息之后的会话内容，并从这条提示词重新请求。原会话会保留为分支；已执行的文件或外部操作不会回滚。继续吗？")) return;
    retryingMessageRef.current = targetSeq;
    retryingSessionRef.current = sessionId;
    setRetryingMessageSeq(targetSeq);
    setLoading(true);
    setNotice("正在创建重试分支");
    try {
      const entries = await loadHistoryForRetry(sessionId, targetSeq);
      const target = entries.find((entry) => entry.event.seq === targetSeq)?.event;
      if (!target || target.type !== "user/message" || isInjectedMessage(target)) {
        throw new Error("找不到可重试的用户消息，请刷新会话后再试");
      }
      const sourceParts = retryPromptSourceParts(target.data.content);
      if (sourceParts.length === 0) throw new Error("这条消息没有可重发的提示词");

      const hydratedContent: DshPromptContentPart[] = await Promise.all(sourceParts.map(async (part) => {
        if (part.type === "text" || part.data) return part.type === "image" ? {
          type: "image" as const,
          mediaType: part.mediaType,
          data: part.data!,
          ...(part.name ? { name: part.name } : {}),
        } : part;
        const attachment = await bridgeRequest<{ attachment: { mediaType: string; name?: string }; data: string }>("session.attachment", {
          sessionId,
          attachmentId: part.attachmentId,
        });
        if (attachment.attachment.mediaType !== part.mediaType) throw new Error("历史图片格式与消息记录不一致");
        return {
          type: "image" as const,
          mediaType: part.mediaType,
          data: attachment.data,
          ...(part.name || attachment.attachment.name ? { name: part.name || attachment.attachment.name } : {}),
        };
      }));
      if (activeSessionRef.current !== sessionId) throw new Error("会话已切换，已取消本次重试");
      const boundary = retryBoundarySeq(entries, targetSeq);
      let retrySessionId: string;
      if (boundary !== undefined) {
        const fork = await bridgeRequest<{ sessionId: string }>("session.fork", {
          sessionId,
          atSeq: boundary,
        });
        retrySessionId = fork.sessionId;
      } else {
        const sourceSession = sessions.find((session) => session.sessionId === sessionId);
        const selectedWorkspace = workspaces.find((item) => item.sessionIds.includes(sessionId));
        const created = await bridgeRequest<{ sessionId: string }>("session.create", {
          ...(selectedWorkspace ? { workspaceId: selectedWorkspace.workspaceId } : sourceSession?.cwd ? { cwd: sourceSession.cwd } : workspace ? { cwd: workspace } : {}),
          ...(sourceSession?.agentPreset ? { agentPreset: sourceSession.agentPreset } : {}),
        });
        retrySessionId = created.sessionId;
        if (selectedWorkspace) {
          await bridgeRequest("workspace.attachSession", {
            workspaceId: selectedWorkspace.workspaceId,
            sessionId: retrySessionId,
          });
        }
        if (models?.current) {
          await bridgeRequest("session.selectModel", {
            sessionId: retrySessionId,
            provider: models.current.provider,
            model: models.current.model,
            ...(models.current.reasoningEffort === undefined ? {} : { reasoningEffort: models.current.reasoningEffort }),
          });
        }
      }
      const sourceSession = sessions.find((session) => session.sessionId === sessionId);
      if (activeSessionRef.current !== sessionId) throw new Error("会话已切换，已取消本次重试");
      const nextSessions = await loadSessions().catch(() => undefined);
      const forked = nextSessions?.find((session) => session.sessionId === retrySessionId) ?? {
        sessionId: retrySessionId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        ...(sourceSession?.cwd || workspace ? { cwd: sourceSession?.cwd ?? workspace } : {}),
        ...(sourceSession?.agentPreset ? { agentPreset: sourceSession.agentPreset } : {}),
      } satisfies DshSessionSummary;
      if (activeSessionRef.current !== sessionId) throw new Error("会话已切换，已取消本次重试");
      await openSession(forked);
      if (activeSessionRef.current !== retrySessionId) throw new Error("会话已切换，已取消本次重试");
      await bridgeRequest("session.prompt", {
        sessionId: retrySessionId,
        mode: "queue",
        content: hydratedContent,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setLoading(false);
      setNotice("已从该消息重新请求");
      void refreshSessionStats(retrySessionId);
    } catch (error) {
      if (activeSessionRef.current === sessionId) {
        setErrorNotice(errorText(error));
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
      setNotice("消息已复制");
    } catch (error) {
      setErrorNotice(`复制失败：${errorText(error)}`);
    }
  }

  async function archiveSession(session: DshSessionSummary) {
    try {
      await bridgeRequest("workspace.archiveSession", { sessionId: session.sessionId });
      setConfirmAction(null);
      setArchivedSessionIds((current) => new Set(current).add(session.sessionId));
      await loadSessions();
      if (session.sessionId === activeSessionRef.current) startNewSession();
      setNotice("会话已归档");
    } catch (error) { setErrorNotice(errorText(error)); }
  }

  async function restoreSession(session: DshSessionSummary) {
    try {
      const result = await bridgeRequest<{ archivedSessionIds: string[] }>("workspace.restoreSession", { sessionId: session.sessionId });
      setArchivedSessionIds(new Set(result.archivedSessionIds));
      await loadSessions();
      setNotice("会话已恢复");
    } catch (error) { setErrorNotice(errorText(error)); }
  }

  async function deleteArchivedSession() {
    const session = deleteArchivedTarget;
    if (!session) return;
    try {
      await bridgeRequest("workspace.deleteArchivedSession", { sessionId: session.sessionId });
      setDeleteArchivedTarget(null);
      await loadSessions();
      if (session.sessionId === activeSessionRef.current) startNewSession();
      setNotice("归档会话已永久删除");
    } catch (error) { setErrorNotice(errorText(error)); }
  }

  function requestSessionAction(action: SessionAction, session: DshSessionSummary) {
    setSessionContextMenu(null);
    if (action === "pin") { void toggleSessionPin(session); return; }
    if (action === "archive") { setConfirmAction({ action, session }); return; }
    if (action === "fork") { void forkSession(session.sessionId); return; }
    if (action === "export") { void exportSession(session.sessionId); return; }
    if (action === "exportZip") { void exportSessionZip(session.sessionId); return; }
    setRenameValue(displayTitle(session));
    setRenameTarget(session);
  }

  async function renameSession() {
    const session = renameTarget;
    const title = renameValue.trim();
    if (!session || !title) return;
    try {
      await bridgeRequest("session.rename", { sessionId: session.sessionId, title });
      setRenameTarget(null);
      setRenameValue("");
      await loadSessions();
      setNotice("会话已重命名");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function changeReasoningEffort(reasoningEffort?: string) {
    if (!activeSessionId || !models) {
      if (!activeSessionId && pendingModelSelection) {
        setDraftModelSelection({ ...pendingModelSelection, reasoningEffort });
        setModelMenuOpen(false);
        setModelMenuPane("root");
      }
      return;
    }
    if (selectedReasoningEffort === reasoningEffort) {
      setModelMenuOpen(false);
      setModelMenuPane("root");
      return;
    }
    try {
      await bridgeRequest("session.selectModel", {
        sessionId: activeSessionId,
        provider: models.current.provider,
        model: models.current.model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      });
      setModels((current) => current ? { ...current, current: { ...current.current, reasoningEffort } } : current);
      setModelMenuOpen(false);
      setModelMenuPane("root");
      setNotice("思考程度已更新");
    } catch (error) { setErrorNotice(errorText(error)); }
  }

  async function changeModel(value: string) {
    if (!value) return;
    const [provider, model] = value.split("\u0000");
    if (!activeSessionId) {
      const selected = composerModels?.groups.find((group) => group.id === provider)?.models.find((entry) => entry.id === model);
      if (selected) setDraftModelSelection({ provider, model, reasoningEffort: selected.reasoning?.defaultEffort });
      setModelMenuOpen(false);
      setModelMenuPane("root");
      setNotice("新会话将使用此模型");
      return;
    }
    if (models?.current.provider === provider && models.current.model === model) {
      setModelMenuOpen(false);
      setModelMenuPane("root");
      return;
    }
    try {
      await bridgeRequest("session.selectModel", { sessionId: activeSessionId, provider, model });
      const selectedContextWindow = models?.groups.find((group) => group.id === provider)?.models.find((entry) => entry.id === model)?.contextWindow;
      setModels((current) => current ? { ...current, current: { ...current.current, provider, model, reasoningEffort: undefined }, contextWindow: selectedContextWindow } : current);
      contextProjectionRef.current = false;
       setSessionStats((current) => ({ ...current, contextTokens: 0, contextTokensAvailable: false, contextLimit: selectedContextWindow ?? 0 }));
      setModelMenuOpen(false);
      setModelMenuPane("root");
      setNotice("模型已切换");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function terminateConflictingDsh() {
    const conflict = status.processConflict;
    if (!desktop || !conflict || dshConflictBusy) return;
    setDshConflictBusy(true);
    try {
      await terminateDshProcesses(conflict.processes.map((process) => process.pid));
      setStatus((current) => ({ ...current, processConflict: null, message: "正在重新启动 Deeptop..." }));
      await restartRuntime();
    } catch (error) {
      setErrorNotice(`终止旧 DSH 失败：${errorText(error)}`);
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
    setNotice("正在重新启动 Deeptop");
    try {
      const nextStatus = await refreshDsh();
      setStatus(nextStatus);
      if (nextStatus.runtimeAvailable) {
        await loadRuntimeDetails();
        setNotice("Deeptop 已重启，插件列表已刷新");
      }
    } catch (error) {
      const message = errorText(error);
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
      const logs = await withTimeout(getRuntimeLogs(), 5_000, "读取运行日志超时，请稍后重试");
      setAppLogs(logs.slice(-2000));
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function exportLogs() {
    if (!desktop) {
      setErrorNotice("导出日志只在 Tauri 桌面端可用");
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
        setNotice(`日志已导出：${savedPath}`);
      }
    } catch (error) {
      setErrorNotice(errorText(error));
    } finally {
      setLogExporting(false);
    }
  }

  async function openLogsDirectoryHandle() {
    if (!desktop) {
      setErrorNotice("打开日志目录只在 Tauri 桌面端可用");
      return;
    }
    try {
      await openLogsDirectory();
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function putAnnotation(messageId: string, note: string) {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    const current = annotations[messageId];
    const result = await bridgeRequest<DshMessageAnnotationResult<DshMessageAnnotationItem>>("messageAnnotations.put", {
      sessionId,
      messageId,
      note,
      ifVersion: current?.version ?? null,
    });
    if (!result.ok) {
      if (result.error.code === "version-conflict") {
        const conflict = result.error.current;
        setAnnotations((items) => {
          const next = { ...items };
          if (conflict) next[messageId] = conflict;
          else delete next[messageId];
          return next;
        });
      }
      throw new Error(`注记未保存：${result.error.code}`);
    }
    setAnnotations((items) => ({ ...items, [messageId]: result.value }));
  }

  async function deleteAnnotation(messageId: string) {
    const sessionId = activeSessionRef.current;
    const current = annotations[messageId];
    if (!sessionId || !current) return;
    const result = await bridgeRequest<DshMessageAnnotationResult<{ absent: true }>>("messageAnnotations.delete", {
      sessionId,
      messageId,
      ifVersion: current.version,
    });
    if (!result.ok) {
      if (result.error.code === "version-conflict") {
        const conflict = result.error.current;
        setAnnotations((items) => {
          const next = { ...items };
          if (conflict) next[messageId] = conflict;
          else delete next[messageId];
          return next;
        });
      }
      throw new Error(`注记未删除：${result.error.code}`);
    }
    setAnnotations((items) => {
      const next = { ...items };
      delete next[messageId];
      return next;
    });
  }

  async function editMessageAnnotation(messageId: string) {
    const current = annotations[messageId];
    const draft = await requestPrompt("消息注记", current?.note ?? "", "为这条消息添加仅自己可见的注记。");
    if (draft === null) return;
    try {
      if (draft.trim()) {
        await putAnnotation(messageId, draft.trim());
        setNotice(current ? "消息注记已更新" : "消息注记已添加");
      } else if (current) {
        await deleteAnnotation(messageId);
        setNotice("消息注记已清除");
      }
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function runCommand(line: string) {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    try {
      const execution = await executeCommandLine(sessionId, line);
      if (execution?.result.kind === "success" && execution.result.text) setNotice(execution.result.text);
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  function insertCommand(line: string) {
    setComposer(line);
    setShowInspector(false);
    setNotice("命令已放入输入框");
  }

  async function setDefaultModel(selection: ModelSelection) {
    const group = hostModels?.groups.find((item) => item.id === selection.provider);
    const model = group?.models.find((item) => item.id === selection.model);
    if (!model) {
      setErrorNotice("该模型当前不可用，请刷新模型目录后重试");
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
        await bridgeRequest("settings.mutate", { ns: namespace.ns, ops, expectedRevision: namespace.revision });
        await refreshSettings();
      } else {
        writeStoredDefaultModel(next);
        setStoredDefaultModel(next);
      }
      setDraftModelSelection(next);
      setNotice(`${model.name} 已设为新会话默认模型`);
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function persistDefaultPermission(value: DefaultPermission) {
    try {
      const namespace = settings?.namespaces.find((item) => item.ns === "permission");
      if (!namespace) {
        writeStoredDefaultPermission(value);
        setStoredDefaultPermission(value);
      } else {
        await bridgeRequest("settings.update", { ns: "permission", patch: { defaultPreset: value } });
        await refreshSettings();
      }
      setNotice("新会话默认权限已更新");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  async function setDefaultPermission(value: string) {
    if (value !== "read-only" && value !== "workspace-write" && value !== "danger-full-access") return;
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

  async function exportSession(sessionId = activeSessionRef.current) {
    if (!sessionId) return;
    setNotice("正在导出会话");
    try {
      let exported: DshHistoryEntry[] = [];
      let beforeSeq: number | undefined;
      let hasMore = true;
      while (hasMore) {
        const result = await bridgeRequest<{ events: DshHistoryEntry[]; hasMore: boolean }>("session.history", {
          sessionId,
          maxMessages: 100,
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
        setErrorNotice("会话导出只在 Deeptop 桌面端可用");
        return;
      }
      const savedPath = await saveExportFile(fileName, new TextEncoder().encode(content));
      if (savedPath) setNotice(`已导出 ${exported.length} 条事件`);
    } catch (error) {
      setErrorNotice(`导出失败：${errorText(error)}`);
    }
  }

  async function exportSessionZip(sessionId = activeSessionRef.current) {
    if (!sessionId) return;
    setNotice("正在生成会话 ZIP");
    try {
      const result = await bridgeRequest<{ base64: string; contentType: string; filename: string; size: number }>("session.exportZip", {
        sessionId,
        includeDescendants: true,
      });
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      if (!desktop) {
        setErrorNotice("会话 ZIP 导出只在 Deeptop 桌面端可用");
        return;
      }
      const savedPath = await saveExportFile(result.filename, bytes);
      if (savedPath) setNotice(`已导出 ZIP（${result.size} 字节）`);
    } catch (error) {
      setErrorNotice(`ZIP 导出失败：${errorText(error)}`);
    }
  }

  async function openSessionPath(path: string) {
    const session = sessionsRef.current.find((item) => item.sessionId === activeSessionRef.current);
    if (!session) return;
    try {
      await bridgeRequest("host.openPath", { path: sessionPath(session.cwd, path) });
      setNotice("已交给系统打开");
    } catch (error) {
      setErrorNotice(`打开失败：${errorText(error)}`);
      throw error;
    }
  }

  async function openMessageUrl(url: string) {
    try {
      await openConnectionUrl(url);
      setNotice("已交给系统打开连接");
    } catch (error) {
      setErrorNotice(`打开连接失败：${errorText(error)}`);
      throw error;
    }
  }

  async function addComposerFiles(files: FileList | File[]) {
    const candidates = Array.from(files).filter((file) => Boolean(imageMediaType(file)));
    if (candidates.length === 0) {
      setErrorNotice("只支持 PNG、JPEG、WebP 或 GIF 图片");
      return;
    }
    try {
      const limits = models?.imageLimits;
      const next = await Promise.all(candidates.map((file) => readImageFile(file, limits)));
      setAttachments((current) => {
        const limitError = imageBatchLimitError(current, next, limits);
        if (limitError) throw new Error(limitError);
        return [...current, ...next];
      });
      setNotice("图片已添加");
    } catch (error) {
      setErrorNotice(errorText(error));
    }
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addComposerFiles(files);
  }

  async function searchSessions() {
    const query = search.trim();
    if (!query) {
      setRemoteSearchResults(null);
      return;
    }
    const requestId = ++searchRequestRef.current;
    try {
      const result = await bridgeRequest<{ items: Array<{ sessionId: string; snippet?: string }>; hasMore?: boolean }>("session.search", { query });
      if (requestId !== searchRequestRef.current) return;
      setRemoteSearchResults(result.items.map((item) => ({ sessionId: item.sessionId, snippet: item.snippet ?? "" })));
    } catch (error) {
      if (requestId === searchRequestRef.current) setErrorNotice(errorText(error));
    }
  }

  async function respondToApproval(outcome: "allowed-once" | "rejected") {
    if (!approval) return;
    const request = approval;
    try {
      await bridgeRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: { sessionId: request.sessionId, approvalId: request.approvalId, outcome },
        },
      });
      setPendingApprovals((current) => {
        if (current[request.sessionId]?.rpcId !== request.rpcId) return current;
        const next = { ...current };
        delete next[request.sessionId];
        return next;
      });
    } catch (error) {
      setErrorNotice(errorText(error));
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
    const answer = {
      answers: questionAnswerItems(request.questions, answers, customAnswers),
    };
    try {
      await bridgeRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { sessionId: request.sessionId, answer } },
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
      setErrorNotice(errorText(error));
    }
  }

  async function cancelQuestion() {
    if (!question) return;
    const request = question;
    try {
      await bridgeRequest("respond", {
        type: "client-response",
        rpcId: request.rpcId,
        result: {
          ok: false,
          error: { code: "cancelled", message: "用户取消了问题", details: {} },
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
      setErrorNotice(errorText(error));
    }
  }

  async function removeQueueItem(itemId: string) {
    if (!activeSessionId) return;
    try {
      await bridgeRequest("session.updateQueue", { sessionId: activeSessionId, itemId, action: { kind: "remove" } });
    } catch (error) {
      setErrorNotice(errorText(error));
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
      setErrorNotice("排队消息不能为空");
      return;
    }
    try {
      await bridgeRequest("session.updateQueue", {
        sessionId: activeSessionId,
        itemId,
        action: { kind: "edit", content: [{ type: "text", text }] },
      });
      setQueueEditingId(null);
      setQueueEditingText("");
    } catch (error) {
      setErrorNotice(errorText(error));
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
      setErrorNotice("该设置命名空间当前不可用");
      return;
    }
    setSettingsDraft({
      ns: namespace.ns,
      value: jsonText(namespace.user ?? {}),
      original: namespace.user ?? {},
      revision: namespace.revision,
      secrets: namespace.secrets.map((secret) => secret.path),
    });
  }

  function closeSettings() {
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
      setUpdateState({ status: "error", channel: updateChannel, message: updateCheckErrorMessage(error) });
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
    void cancelUpdateCheck().catch((error) => setErrorNotice(errorText(error)));
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
      setUpdateDownloadState({ status: "error", message: updateCheckErrorMessage(error) });
    }
  }

  function cancelAppUpdateDownload() {
    updateDownloadRequestRef.current += 1;
    updateDownloadReleaseRef.current = null;
    setUpdateDownloadState({ status: "cancelled" });
    void cancelUpdateDownload().catch((error) => setErrorNotice(errorText(error)));
  }

  function launchAppUpdate() {
    if (updateDownloadState.status !== "ready" && !(updateDownloadState.status === "error" && updateDownloadState.canInstall)) return;
    setUpdateDownloadState({ status: "launching" });
    void launchUpdateInstaller().catch((error) => {
      setUpdateDownloadState({ status: "error", message: errorText(error), canInstall: true });
    });
  }

  function openProjectPage() {
    void openExternalUrl(DEEPTOP_PROJECT_URL).catch((error) => setErrorNotice(errorText(error)));
  }

  function openLatestRelease() {
    if (updateState.status !== "available") return;
    void openExternalUrl(updateState.releaseUrl).catch((error) => setErrorNotice(errorText(error)));
  }

  function openModelsDevPricing() {
    void openConnectionUrl(modelPricingSourceUrl).catch((error) => setErrorNotice(errorText(error)));
  }

  function openSettings() {
    if (showInspector) {
      closeSettings();
      return;
    }
    setSettingsSection("appearance");
    setShowInspector(true);
    void loadSurface("settings");
  }

  if (desktop && !status.runtimeAvailable) {
    return (
      <>
        <StartupSplash
          status={status}
          logs={startupLogs}
          onOpenNodejsDownload={() => void openNodejsDownload().catch((error) => setErrorNotice(errorText(error)))}
          onRetry={() => void restartRuntime()}
          windowMaximized={windowMaximized}
          onDrag={(event) => void startWindowDrag(event)}
          onMinimize={() => void minimizeWindow()}
          onToggleMaximize={() => void toggleWindowMaximize()}
          onClose={() => void closeWindow()}
        />
        {popupRequest?.kind === "close-behavior" && <WindowCloseBehaviorDialog onClose={() => settlePopup(null)} onSelect={(behavior) => settlePopup(behavior)} />}
        {status.processConflict && <DshConflictDialog conflict={status.processConflict} busy={dshConflictBusy} onClose={dismissDshConflict} onTerminate={() => void terminateConflictingDsh()} />}
      </>
    );
  }

  return (
    <main className={`app-shell${hasAnyBackground(appearance.backgrounds) ? " has-custom-background" : ""}`} style={appearanceStyle}>
      <WindowChrome
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

      <div className={`workspace-layout ${todoVisible ? "todo-visible" : ""} ${todoVisible && todoCollapsed ? "todo-collapsed" : ""} ${activeJobs.length > 0 ? "tasks-visible" : ""} ${activeJobs.length > 0 && jobsCollapsed ? "tasks-collapsed" : ""} ${deliverablesVisible ? "deliverables-visible" : ""} ${deliverablesVisible && deliverablesCollapsed ? "deliverables-collapsed" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
        <SessionSidebar
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
          onRestoreSession={restoreSession}
          onDeleteArchivedSession={setDeleteArchivedTarget}
          workspaceGroups={workspaceGroups}
          collapsedWorkspaces={collapsedWorkspaces}
          onToggleWorkspace={toggleWorkspace}
          pinnedWorkspaceIds={pinnedWorkspaceIds}
          onTogglePinWorkspace={togglePinWorkspace}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          sessionContextMenu={sessionContextMenu}
          onRequestSessionAction={requestSessionAction}
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
        />

        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整会话侧栏宽度"
          aria-valuemin={300}
          aria-valuemax={440}
          aria-valuenow={sidebarWidth}
          onPointerDown={(event) => {
            event.preventDefault();
            sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
            document.body.classList.add("sidebar-resizing");
          }}
        />

        <section className="conversation-panel">
          <ConversationHeader
            activeSession={activeSession}
            presets={presets}
            runtimeDirectory={status.runtimeDirectory}
            notice={notice}
            noticeIsError={noticeIsError}
            queueCount={queue.length}
            trajectoryOpen={trajectoryOpen}
            tokenUsageOpen={tokenUsageOpen}
            onToggleTrajectory={() => { setTokenUsageOpen(false); setTrajectoryOpen((open) => !open); }}
            onToggleTokenUsage={() => { setTrajectoryOpen(false); setTokenUsageOpen((open) => !open); }}
          />

          <div className={`conversation-transcript-stage${activeGoal ? " has-current-goal" : ""}${goalBarCollapsed ? " current-goal-collapsed" : ""}`}>
            <CurrentGoalBar
              activeGoal={activeGoal}
              roundsStarted={goalRoundsStarted}
              collapsed={goalBarCollapsed}
              onOpen={openGoalPanel}
              onToggleCollapsed={() => setGoalBarCollapsed((collapsed) => !collapsed)}
            />
            {corruptSession && corruptSession.sessionId === activeSessionId && (
              <div className="session-repair-banner" role="alert">
                <div className="session-repair-banner-text">
                  该会话日志在 Deeptop 上次崩溃时受损，DSH 无法读取。可尝试修复：保留已提交的历史记录，丢弃崩溃时未写完的内容。
                </div>
                <button type="button" className="session-repair-button" disabled={repairingSession} onClick={() => void repairActiveSession()}>
                  {repairingSession ? "正在修复…" : "修复并重新打开"}
                </button>
              </div>
            )}
            {!tokenUsageOpen && <ConversationTranscript
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
              workspace={workspace}
              runtimeDirectory={status.runtimeDirectory}
              modelName={models?.current.model ?? defaultModelName}
              presets={presets}
              annotations={annotations}
              nextPreset={nextPreset}
              presetMenuOpen={presetMenuOpen}
              onLoadOlder={loadOlderHistory}
              onLoadImageAttachment={loadImageAttachment}
              onFollowingChange={setTranscriptFollowing}
              onJumpToLatest={() => setTranscriptFollowing(true)}
              onTogglePresetMenu={() => setPresetMenuOpen((open) => !open)}
              onStagePreset={stagePresetForNextSession}
              onCopyMessage={copyMessage}
              onEditAnnotation={editMessageAnnotation}
               onRetryMessage={retryMessage}
               retryingMessageSeq={retryingMessageSeq}
              onForkSession={forkSession}
               onOpenUrl={openMessageUrl}
                             onOpenSessionPath={openSessionPath}
            />}
            <TokenUsageDashboard
              entries={history}
              sessionStats={sessionStats}
              active={tokenUsageOpen}
              provider={models?.current.provider}
              model={models?.current.model}
              onOpenPricingSource={openModelsDevPricing}
            />

            <div className="left-dock-shelf" aria-label="工作区工具">
              <TerminalDock
                workspace={workspace}
                collapsed={!terminalOpen}
                onToggle={() => setTerminalOpen((open) => !open)}
                onError={setErrorNotice}
              />
              <WorkspaceFilesPanel
                workspace={workspace}
                collapsed={filesCollapsed}
                onToggle={() => setFilesOpen((open) => !open)}
                 onAddPathToComposer={addPathToComposer}
                onError={setErrorNotice}
              />
            </div>

              <UtilityDockShelf
               tasks={activeJobs.length > 0 ? <TaskPanel jobs={activeJobs} collapsed={jobsCollapsed} now={jobNow} onToggle={() => togglePanel("tasks")} /> : null}
               todo={todoVisible ? <TodoPanel
                 todos={todos ?? []}
                 collapsed={todoCollapsed}
                 counts={todoCounts}
                 now={jobNow}
                 turnStartedAt={turnTiming.startedAt}
                 turnFinishedAt={turnTiming.finishedAt}
                 onToggle={() => togglePanel("todo")}
               /> : null}
                subagent={<SubagentDock
                  entries={childSubagents}
                  dockOpen={subagentDockOpen}
                  selectedId={selectedSubagentId}
                  onToggleDock={toggleSubagentDock}
                  onToggle={toggleSubagent}
                />}
                deliverables={deliverablesVisible && deliverables ? <DeliverablesPanel
                 item={deliverables}
                 activeSession={activeSession ?? null}
                 collapsed={deliverablesCollapsed}
                 onToggle={() => togglePanel("deliverables")}
                 onOpenSessionPath={openSessionPath}
               /> : null}
             />

             <SubagentPanel
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
          </div>

          <InteractionPanel
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
          />

          <QueueDock
            items={queue}
            editingId={queueEditingId}
            editingText={queueEditingText}
            onEditingTextChange={setQueueEditingText}
            onSave={saveQueueEdit}
            onCancelEdit={() => setQueueEditingId(null)}
            onBeginEdit={beginQueueEdit}
            onRemove={removeQueueItem}
          />

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
            selectedModelName={selectedModel?.name}
            selectedReasoning={selectedReasoning}
            selectedReasoningEffort={selectedReasoningEffort}
            selectedReasoningLabel={selectedReasoningLabel}
            reasoningChoices={reasoningChoices}
            modelMenuOpen={modelMenuOpen}
            modelMenuPane={modelMenuPane}
            sessionStats={sessionStats}
            sessionRunningMs={sessionRunningMs}
             sendShortcut={sendShortcut}
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
         </div>

         {showInspector && (
          <div className="inspector-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="inspector-title">
            <button className="inspector-backdrop" onClick={closeSettings} aria-label="关闭设置" />
            <aside className="inspector-panel">
            <div className="inspector-header"><strong id="inspector-title">设置</strong><button onClick={closeSettings} title="关闭设置">×</button></div>
            {surfaceLoading && <div className="surface-loading">正在读取 DSH 状态…</div>}

            <div className="settings-layout">
                <nav className="settings-navigation" aria-label="设置分区">
                  <div className="settings-navigation-title">DSH 设置</div>
                  <div className={`settings-navigation-group${settingsSection === "appearance" ? " expanded" : ""}`}>
                    <button className="settings-navigation-group-toggle" aria-expanded={settingsSection === "appearance"} onClick={() => { setSettingsSection("appearance"); setAppearanceSection("theme"); }}>
                      <strong>外观</strong><span className="settings-navigation-chevron">⌄</span>
                    </button>
                    {settingsSection === "appearance" && <div className="settings-navigation-subnav" role="tablist" aria-label="外观子页面">
                      {(["theme", "background", "typography", "css"] as AppearanceSection[]).map((item) => <button key={item} className={`settings-navigation-subitem${appearanceSection === item ? " selected" : ""}`} onClick={() => setAppearanceSection(item)}>{item === "theme" ? "主题" : item === "background" ? "背景工作台" : item === "typography" ? "文字" : "CSS 主题"}</button>)}
                    </div>}
                  </div>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={(event) => setSettingsSection(event.currentTarget.textContent?.includes("Dock") ? "dock" : "general")}>
                     <strong data-legacy-general="true">通用</strong><small>会话与 Host</small>
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
                     <strong>Dock</strong><small>展开框交互与位置</small>
                   </button>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={(event) => setSettingsSection(event.currentTarget.textContent?.includes("Dock") ? "dock" : "general")}>
                     <strong data-legacy-general="true">通用</strong><small>会话与 Host</small>
                   </button>
                   <button className={settingsSection === "general" ? "selected" : ""} onClick={() => setSettingsSection("general")}>
                     <strong>通用</strong><small>会话与 Host</small>
                   </button>
                   <button className={settingsSection === "logs" ? "selected" : ""} onClick={() => { setSettingsSection("logs"); void loadRuntimeLogs(); }}>
                    <strong>日志</strong><small>堆栈与运行日志</small>
                  </button>
                  <button className={settingsSection === "keyboard" ? "selected" : ""} onClick={() => setSettingsSection("keyboard")}>
                     <strong>按键</strong><small>消息快捷键</small>
                   </button>
                   <button className={settingsSection === "models" ? "selected" : ""} onClick={() => setSettingsSection("models")}>
                    <strong>模型</strong><small>Provider 与模型目录</small>
                  </button>
                  <button className={settingsSection === "presets" ? "selected" : ""} onClick={() => setSettingsSection("presets")}>
                    <strong>Agent Preset</strong><small>会话 Agent 组装</small>
                  </button>
                  <button className={settingsSection === "plugins" ? "selected" : ""} onClick={() => setSettingsSection("plugins")}>
                    <strong>插件</strong><small>运行中的 Cordis 插件</small>
                  </button>
                <button className={settingsSection === "about" ? "selected" : ""} onClick={() => setSettingsSection("about")}>
                     <strong>关于</strong><small>版本与更新检查</small>
                   </button>
                 </nav>

                <section className="settings-main">
                   {settingsSection === "dock" && <SettingsDockPanel settings={dockSettings} loaded={dockSettingsLoaded} updating={dockSettingsUpdating} onUpdate={updateDockSettingsWithNotice} />}
                  {settingsSection === "about" && <SettingsAboutPanel
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
                    onThemeChange={setThemeMode}
                    onAppThemeChange={setAppTheme}
                    onPickThemeCss={handlePickThemeCss}
                    onReloadThemeCss={reloadThemeCss}
                    onOpenThemesDirectory={openThemesDirectory}

                    onThemeFile={handleThemeFile}
                    onResetSection={resetAppearanceSection}
                  />}


                  {settingsSection === "general" && <SettingsGeneralPanel
                    settings={settings}
                    presets={presets}
                    hostModels={hostModels}
                    defaultModel={defaultModelSelection}
                    defaultPermission={defaultPermission}
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
                    onOpenDocument={() => bridgeRequest("settings.openDocument").then(() => setNotice("已打开 DSH 配置文件")).catch((error) => setErrorNotice(errorText(error)))}
                    onSetDefaultPreset={setDefaultPreset}
                    onSetDefaultModel={setDefaultModel}
                    onSetDefaultPermission={setDefaultPermission}
                    onAddWorkspace={addWorkspace}
                    onResetSidebar={() => setSidebarWidth(320)}
                    onOpenNamespace={openSettingsNamespace}
                  />}

                  {settingsSection === "keyboard" && <SettingsKeyboardPanel
                     sendShortcut={sendShortcut}
                     onSendShortcutChange={updateSendShortcut}
                   />}

                   {settingsSection === "logs" && <SettingsLogsPanel
                     logs={appLogs}
                     exportPath={logExportPath}
                     exporting={logExporting}
                     onRefresh={() => void loadRuntimeLogs()}
                     onExport={() => void exportLogs()}
                     onOpenLogsDirectory={() => void openLogsDirectoryHandle()}
                   />}

                   {settingsSection === "presets" && <SettingsPresetPanel
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
                    providers={providers}
                    settings={settings}
                    hostModels={hostModels}
                    providerSettings={providerSettings}
                    onOpenNamespace={openSettingsNamespace}
                  />}

                  {settingsSection === "plugins" && <SettingsPluginsPanel
                    inventory={pluginInventory}
                     excludedPlugins={excludedPlugins}
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
                </section>
                {/* settings JSON popup is rendered below the settings sheet */}
                 {settingsDraft && <PopupDialog title={`编辑 ${settingsDraft.ns}`} eyebrow="公开设置 / JSON" description="仅修改公开字段；密钥和其他 Host 专属字段不会被覆盖。" className="popup-json-dialog" onClose={() => setSettingsDraft(null)} footer={<><button type="button" onClick={() => setSettingsDraft(null)}>取消</button><button type="button" className="confirm" onClick={() => void saveSettings()}>保存设置</button></>}><textarea className="surface-code-input popup-code-input" value={settingsDraft.value} onChange={(event) => setSettingsDraft({ ...settingsDraft, value: event.target.value })} autoFocus aria-label={`${settingsDraft.ns} JSON`} /></PopupDialog>}
                {presetCopy && <PopupDialog title={`复制 ${presetCopy.from}`} eyebrow="AGENT PRESET / 新建" description="从现有 Preset 创建一份用户组合，创建后可继续在本地文件中编辑。" className="popup-form-dialog" onClose={() => setPresetCopy(null)} footer={<><button type="button" onClick={() => setPresetCopy(null)}>取消</button><button type="button" className="confirm" disabled={!presetCopy.id.trim()} onClick={() => void copyPreset()}>创建 Preset</button></>}><label className="popup-field"><span>Preset id</span><input placeholder="例如：researcher-local" value={presetCopy.id} onChange={(event) => setPresetCopy({ ...presetCopy, id: event.target.value })} autoFocus /></label><label className="popup-field"><span>显示名称 <em>可选</em></span><input placeholder="例如：本地研究助手" value={presetCopy.name} onChange={(event) => setPresetCopy({ ...presetCopy, name: event.target.value })} /></label></PopupDialog>}
                {presetView && <PopupDialog title={`${presetView.id} / agent.cordis.yml`} eyebrow="AGENT PRESET / 预览" description="查看该 Preset 的组合内容。" className="popup-preview-dialog" onClose={() => setPresetView(null)} footer={<button type="button" className="confirm" onClick={() => setPresetView(null)}>完成</button>}><pre className="surface-code popup-code-preview">{presetView.content}</pre></PopupDialog>}
              </div>
            </aside>
          </div>
        )}
      {goalPanelOpen && activeSessionId && <PopupDialog
          title={activeGoal ? "管理当前 Goal" : "创建当前 Goal"}
          eyebrow="DSH / GOAL"
          description={activeGoal ? "查看持续目标的执行状态，调整预算，或控制下一步是否继续自动推进。" : "为当前会话创建一个可跨回合持续推进的目标。"}
          className="popup-goal-dialog"
          onClose={() => { if (!goalPanelBusy) setGoalPanelOpen(false); }}
          footer={<button type="button" disabled={goalPanelBusy} onClick={() => setGoalPanelOpen(false)}>关闭</button>}
        >
          <GoalSurfacePanel
            activeGoal={activeGoal}
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
        {pluginInstallOpen && <PluginInstallDialog
         existingIds={pluginConfigDraft.map((plugin) => plugin.id)}
         pickingEntry={pluginPickingEntry}
         onClose={() => setPluginInstallOpen(false)}
         onPickEntry={pickPluginEntryForInstall}
         onSubmit={addPlugin}
       />}
       {presetMigration && <PopupDialog
         title="迁移到可用的 Agent Preset"
         eyebrow="会话恢复 / 需要确认"
         description={`会话“${presetMigration.session.sessionId}”无法恢复，因为它引用的 Preset “${presetMigration.missingPreset}”已不存在。`}
         className="popup-form-dialog"
         role="alertdialog"
         onClose={() => { if (!presetMigrationRunning) setPresetMigration(null); }}
         footer={<><button type="button" disabled={presetMigrationRunning} onClick={() => setPresetMigration(null)}>取消</button><button type="button" className="confirm" disabled={presetMigrationRunning || !presetMigrationSelection} onClick={() => void migrateMissingPreset()}>{presetMigrationRunning ? "正在创建副本…" : "确认迁移并打开副本"}</button></>}
       >
         <p>迁移会创建一个新的会话副本，保留原会话和已有历史；不会修改、覆盖或删除原会话。</p>
         <p>不同 Preset 可能带来不同的工具、系统提示词和能力。历史中的工具调用可能只能以兼容或通用形式显示，迁移后的后续回复也可能不同。</p>
         <label className="popup-field"><span>选择替代 Preset</span><select value={presetMigrationSelection} onChange={(event) => setPresetMigrationSelection(event.target.value)} disabled={presetMigrationRunning}><option value="" disabled>请选择</option>{presets.filter((preset) => !preset.broken && preset.id !== presetMigration?.missingPreset).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets)}（{preset.id}）</option>)}</select></label>
         {presetMigration.availablePresetIds.length > 0 && <small>检测到可用选项：{presetMigration.availablePresetIds.join("、")}</small>}
       </PopupDialog>}
       {popupRequest?.kind === "confirm" && <PopupDialog
        title="请确认操作"
        eyebrow="DSH / 确认操作"
        description="请确认是否继续执行此操作。"
        className="popup-confirm-dialog"
        role="alertdialog"
        onClose={() => settlePopup(false)}
        footer={<><button type="button" onClick={() => settlePopup(false)}>取消</button><button type="button" className="confirm" onClick={() => settlePopup(true)}>确认</button></>}
      >
        <p className="popup-confirm-message">{popupRequest.message}</p>
      </PopupDialog>}
      {popupRequest?.kind === "close-behavior" && <WindowCloseBehaviorDialog onClose={() => settlePopup(null)} onSelect={(behavior) => settlePopup(behavior)} />}
       {popupRequest?.kind === "prompt" && <PopupDialog
        title={popupRequest.title}
        eyebrow="DSH / 输入"
        description={popupRequest.description}
        className="popup-prompt-dialog"
        onClose={() => settlePopup(null)}
        footer={<><button type="button" onClick={() => settlePopup(null)}>取消</button><button type="button" className="confirm" onClick={() => settlePopup(popupValue)}>确定</button></>}
      >
        <form className="popup-prompt-form" onSubmit={(event) => { event.preventDefault(); settlePopup(popupValue); }}>
          <input className="popup-prompt-input" value={popupValue} onChange={(event) => setPopupValue(event.target.value)} autoFocus aria-label={popupRequest.title} />
        </form>
      </PopupDialog>}
      {pendingDefaultPermission && <PopupDialog
        title="确认新会话默认权限"
        eyebrow="DSH / 默认设置"
        description="完全访问会让之后创建的会话拥有不受限制的操作权限。"
        className="popup-permission-dialog"
        onClose={() => setPendingDefaultPermission(null)}
        footer={<><button type="button" onClick={() => setPendingDefaultPermission(null)}>取消</button><button type="button" className="confirm danger-button" onClick={() => void confirmDefaultPermission()}>确认设为默认</button></>}
      >
        <div className="permission-confirm-content">
          <div className="permission-confirm-mark" aria-hidden="true">!</div>
          <div><strong>仅在你信任之后创建会话所处的工作区时使用。</strong><p>当前已经打开的会话不会改变；这个默认值只会影响之后创建的新会话。</p></div>
        </div>
      </PopupDialog>}
      {pendingPermissionValue && <PopupDialog
        title="确认修改权限"
        eyebrow="DSH / 权限变更"
        description="即将把当前会话切换到危险权限模式。"
        className="popup-permission-dialog"
        onClose={() => setPendingPermissionValue(null)}
        footer={<><button type="button" onClick={() => setPendingPermissionValue(null)}>取消</button><button type="button" className="confirm danger-button" onClick={() => void confirmPermissionPreset()}>确认切换</button></>}
      >
        <div className="permission-confirm-content">
          <div className="permission-confirm-mark" aria-hidden="true">!</div>
          <div>
            <strong>危险权限会允许 DSH 在当前工作区执行不受限制的操作。</strong>
            <p>仅在你明确了解风险并信任当前工作区时继续。你可以随时从权限菜单切换回更受限的模式。</p>
          </div>
        </div>
      </PopupDialog>}
      {confirmAction && <div className="confirm-backdrop" onMouseDown={() => setConfirmAction(null)}><div className="confirm-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><strong>归档会话？</strong><p>“{displayTitle(confirmAction.session)}”将从会话列表中隐藏，历史记录会保留；可在归档页查看、恢复或永久删除。</p><div className="surface-dialog-actions"><button onClick={() => setConfirmAction(null)}>取消</button><button className="confirm danger-button" onClick={() => void archiveSession(confirmAction.session)}>确认归档</button></div></div></div>}
      {deleteArchivedTarget && <div className="confirm-backdrop" onMouseDown={() => setDeleteArchivedTarget(null)}><div className="confirm-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><strong>永久删除归档会话？</strong><p>“{displayTitle(deleteArchivedTarget)}”的历史记录将被永久删除，无法恢复。</p><div className="surface-dialog-actions"><button onClick={() => setDeleteArchivedTarget(null)}>取消</button><button className="confirm danger-button" onClick={() => void deleteArchivedSession()}>永久删除</button></div></div></div>}
      {renameTarget && <div className="confirm-backdrop" onMouseDown={() => setRenameTarget(null)}><form className="confirm-dialog rename-dialog" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void renameSession(); }} onMouseDown={(event) => event.stopPropagation()}><strong>重命名会话</strong><p>修改“{displayTitle(renameTarget)}”在左侧会话列表中的显示名称。</p><input className="rename-dialog-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus aria-label="会话名称" /><div className="surface-dialog-actions"><button type="button" onClick={() => setRenameTarget(null)}>取消</button><button className="confirm" type="submit" disabled={!renameValue.trim()}>保存</button></div></form></div>}
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
