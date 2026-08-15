import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { StartupSplash } from "./components/StartupSplash";
import { ConversationTranscript } from "./components/ConversationTranscript";
import { ConversationHeader } from "./components/ConversationHeader";
import { ComposerShell } from "./components/ComposerShell";
import { InteractionPanel } from "./components/InteractionPanel";
import { SettingsAppearancePanel } from "./components/SettingsAppearancePanel";
import { SettingsGeneralPanel } from "./components/SettingsGeneralPanel";
import { SettingsKeyboardPanel } from "./components/SettingsKeyboardPanel";
import { SettingsModelsPanel } from "./components/SettingsModelsPanel";
import { SettingsPluginsPanel } from "./components/SettingsPluginsPanel";
import { SettingsPresetPanel } from "./components/SettingsPresetPanel";
import { QueueDock } from "./components/QueueDock";
import { SessionSidebar } from "./components/SessionSidebar";
import { SubagentPanel } from "./components/SubagentPanel";
import { TodoPanel } from "./components/TodoPanel";
import { WindowChrome } from "./components/WindowChrome";
import { PopupDialog } from "./components/PopupDialog";
import { useProviderSettings } from "./app/useProviderSettings";
import { useWindowControls } from "./app/useWindowControls";
import { routeBridgeEvent } from "./app/bridge-event-handler";
import {
  bridgeRequest,
  checkDsh,
  isTauri,
  listenToDiagnostic,
  listenToRuntimeStatus,
  pickWorkspace,
  refreshDsh,
  type DshBridgeEvent,
  type DshGoalProjection,
  type DshHistoryEntry,
  type DshJob,
  type DshCommandDescriptor,
  type DshCommandExecution,
  type DshMessageAnnotationItem,
  type DshMessageAnnotationResult,
  type DshMessageFeedbackItem,
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
  type DshSessionModels,
  type DshSessionSummary,
  type DshStatus,
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
  imageMediaType,
  readImageFile,
  formatDate,
  displayTitle,
  textFromContent,
  readSessionStats,
  recordValue,
  formatTokens,
  contextForm,
  contextSummary,
  todoProjection,
  todosFromHistory,
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
  sessionIsVisible,
  isInjectedMessage,
  retryBoundarySeq,
  retryPromptSourceParts,
} from "./app/model";
import {
  type PromptMode,
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
  useAppearanceSettings,
} from "./app/useAppearanceSettings";
import { SEND_SHORTCUT_STORAGE_KEY, readSendShortcut } from "./app/keyboard-shortcut";
import { readStoredDefaultModel, readStoredDefaultPermission, writeStoredDefaultModel, writeStoredDefaultPermission, type DefaultPermission } from "./app/session-defaults";

const demoStatus: DshStatus = {
  dshHome: "",
  runtimeDirectory: "",
  packageName: "@deepseek-ai/dsh@latest",
  runtimeAvailable: false,
  runtimeStarting: false,
  message: "浏览器预览模式",
};

type FeedbackOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; current?: DshMessageFeedbackItem | null } };

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

function App() {
  const desktop = isTauri();
  applyFrontendVisualResetOnce();
  const [status, setStatus] = useState<DshStatus>(() => desktop
    ? { ...demoStatus, runtimeStarting: true, message: "正在启动 DSH..." }
    : demoStatus);
  const [sessions, setSessions] = useState<DshSessionSummary[]>([]);
  const [archivedSessionIds, setArchivedSessionIds] = useState<Set<string>>(new Set());
  const [sessionIndicators, setSessionIndicators] = useState<Record<string, "idle" | "running" | "completed" | "error">>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<DshHistoryEntry[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [todoCollapsed, setTodoCollapsed] = useState(false);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [composerCandidateIndex, setComposerCandidateIndex] = useState(0);
  const [composerMenuDismissed, setComposerMenuDismissed] = useState(false);
  const [promptMode, setPromptMode] = useState<PromptMode>("queue");
  const [sendShortcut, setSendShortcut] = useState(readSendShortcut);
  const [notice, setNotice] = useState("准备连接 DSH");
  const [loading, setLoading] = useState(false);
  const [retryingMessageSeq, setRetryingMessageSeq] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [remoteSearchResults, setRemoteSearchResults] = useState<SessionSearchResult[] | null>(null);
  const [models, setModels] = useState<DshSessionModels | null>(null);
  const [draftModelSelection, setDraftModelSelection] = useState<ModelSelection | null>(null);
  const [storedDefaultModel, setStoredDefaultModel] = useState<ModelSelection | null>(readStoredDefaultModel);
  const [storedDefaultPermission, setStoredDefaultPermission] = useState<DefaultPermission | null>(readStoredDefaultPermission);
  const [commands, setCommands] = useState<DshCommandDescriptor[]>([]);
  const [feedback, setFeedback] = useState<Record<string, DshMessageFeedbackItem>>({});
  const [annotations, setAnnotations] = useState<Record<string, DshMessageAnnotationItem>>({});
  const [permissionSelect, setPermissionSelect] = useState<DshPermissionSelect | null>(null);
  const [pendingPermissionValue, setPendingPermissionValue] = useState<string | null>(null);
  const [pendingDefaultPermission, setPendingDefaultPermission] = useState<DefaultPermission | null>(null);
  const [plan, setPlan] = useState<DshPlanProjection | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPane, setModelMenuPane] = useState<ModelMenuPane>("root");
  const [sessionStats, setSessionStats] = useState<SessionStats>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, firstTokenMs: 0, messages: 0 });
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
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({});
  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runtimeDetails, setRuntimeDetails] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<DshProvider[]>([]);
  const [hostModels, setHostModels] = useState<DshHostModelCatalog | null>(null);
  const [pluginInventory, setPluginInventory] = useState<DshPluginInventoryEntry[] | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [pluginSearch, setPluginSearch] = useState("");
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [skills, setSkills] = useState<DshSkill[]>([]);
  const [subagents, setSubagents] = useState<DshSubagentCatalog | null>(null);
  const [subagentPanelOpen, setSubagentPanelOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [subagentLoadingId, setSubagentLoadingId] = useState<string | null>(null);
  const [subagentLoadError, setSubagentLoadError] = useState<string | null>(null);
  const [subagentSession, setSubagentSession] = useState<SubagentSession | null>(null);
  const [subagentComposer, setSubagentComposer] = useState("");
  const [settings, setSettings] = useState<DshSettingsDescription | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [goal, setGoal] = useState<DshGoalProjection | null | undefined>(undefined);
  const [goalDraft, setGoalDraft] = useState("");
  const [presetView, setPresetView] = useState<{ id: string; content: string } | null>(null);
  const [presetCopy, setPresetCopy] = useState<{ from: string; id: string; name: string } | null>(null);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DshSessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [queue, setQueue] = useState<DshQueueItem[]>([]);
  const [queueEditingId, setQueueEditingId] = useState<string | null>(null);
  const [queueEditingText, setQueueEditingText] = useState("");
  const [sessionJobs, setSessionJobs] = useState<Record<string, DshJob[]>>({});
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobNow, setJobNow] = useState(() => Date.now());
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, PendingApproval>>({});
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, PendingQuestion>>({});
  const [questionAnswersBySession, setQuestionAnswersBySession] = useState<Record<string, Record<string, string[]>>>({});
  const [questionCustomAnswersBySession, setQuestionCustomAnswersBySession] = useState<Record<string, Record<string, string>>>({});
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenu | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: SessionAction; session: DshSessionSummary } | null>(null);
  const [deleteArchivedTarget, setDeleteArchivedTarget] = useState<DshSessionSummary | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const transcriptScroll = useRef<HTMLDivElement | null>(null);
  const appearanceFileInputRef = useRef<HTMLInputElement | null>(null);
  const draggedSessionRef = useRef<string | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const historyLoadingOlderRef = useRef(false);
  const [transcriptFollowing, setTranscriptFollowing] = useState(true);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
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
  const {
    windowMaximized,
    startWindowDrag,
    toggleWindowMaximize,
    minimizeWindow,
    closeWindow,
  } = useWindowControls({ desktop, onError: setNotice });
  const {
    appearance,
    appearanceStyle,
    appearanceFontPreset,
    appearanceCodeFontPreset,
    appearanceFontPresets,
    appearanceCodeFontPresets,
    updateAppearance,
    handleBackgroundFile,
    handleThemeFile,
    resetAppearance,
  } = useAppearanceSettings({ onNotice: setNotice });
  const providerSettings = useProviderSettings({
    desktop,
    settings,
    providers,
    onNotice: setNotice,
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
    selectedSubagentRef.current = selectedSubagentId;
  }, [selectedSubagentId]);

  useEffect(() => {
    setModelMenuOpen(false);
    setModelMenuPane("root");
    setPresetMenuOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    setJobsOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (!jobsOpen || !activeJobs.some((job) => job.status === "running" || job.status === "stopping")) return;
    const timer = window.setInterval(() => setJobNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeJobs, jobsOpen]);

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
    if (!subagentPanelOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSubagentPanelOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [subagentPanelOpen]);

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
  const todoCounts = useMemo(() => ({
    completed: todos?.filter((item) => item.status === "completed").length ?? 0,
    inProgress: todos?.filter((item) => item.status === "in_progress").length ?? 0,
    pending: todos?.filter((item) => item.status === "pending").length ?? 0,
  }), [todos]);
  const todoVisible = todos !== null && todos.length > 0;
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
  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => sameWorkspacePath(item.path, workspace)) ?? null,
    [workspace, workspaces],
  );
  const selectedWorkspaceSessions = useMemo(() => {
    const visibleById = new Map(visibleSessions.map((session) => [session.sessionId, session]));
    if (selectedWorkspace) {
      return selectedWorkspace.sessionIds
        .map((sessionId) => visibleById.get(sessionId))
        .filter((session): session is DshSessionSummary => session !== undefined);
    }
    return visibleSessions.filter((session) => !workspaceBySessionId.has(session.sessionId));
  }, [selectedWorkspace, visibleSessions, workspaceBySessionId]);
  const selectedWorkspaceGroup = useMemo(() => ({
    workspace: selectedWorkspace,
    workspaceId: selectedWorkspace?.workspaceId ?? "__ungrouped__",
    sessions: selectedWorkspaceSessions,
  }), [selectedWorkspace, selectedWorkspaceSessions]);
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
    const isAvailable = (selection: ModelSelection) => !hostModels
      || hostModels.groups.some((group) => group.id === selection.provider && group.models.some((model) => model.id === selection.model));
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
    return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : storedDefaultPermission;
  }, [settings, storedDefaultPermission]);
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
  const selectedModelSupportsImages = composerModels?.groups
    .find((group) => group.id === composerModels.current.provider)
    ?.models.find((model) => model.id === composerModels.current.model)
    ?.inputModalities?.includes("image") ?? false;
  const modelOptions = useMemo(() => {
    if (!composerModels) return [];
    return composerModels.groups.flatMap((group) => group.models.map((model) => ({
      value: `${group.id}\u0000${model.id}`,
      label: `${group.name} / ${model.name}`,
      name: model.name,
      description: model.description,
      provider: group.id,
      model: model.id,
      reasoning: model.reasoning,
    })));
  }, [composerModels]);
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
  const subagentEntries = subagents?.entries ?? [];
  const childSubagents = subagentEntries.filter((entry): entry is ChildSubagentEntry => entry.kind === "child");
  const composerTrigger = useMemo(() => detectComposerTrigger(composer), [composer]);
  const composerCandidates = useMemo<ComposerCandidate[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "skill") {
      const commandCandidates = commands
        .filter((command) => `${command.name} ${command.description}`.toLocaleLowerCase().includes(composerTrigger.query))
        .slice(0, 8)
        .map((command) => ({
          kind: "command" as const,
          id: command.name,
          label: `/${command.name}`,
          detail: command.description,
          insertText: `/${command.name}`,
        }));
      const skillCandidates = skills
        .filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(composerTrigger.query))
        .slice(0, 8)
        .map((skill) => ({
          kind: "skill" as const,
          id: skill.name,
          label: `/${skill.name}`,
          detail: skill.description,
          insertText: `/${skill.name}`,
        }));
      return [...commandCandidates, ...skillCandidates].slice(0, 8);
    }
    return childSubagents
      .filter((entry) => `${entry.label ?? ""} ${entry.id}`.toLocaleLowerCase().includes(composerTrigger.query))
      .slice(0, 8)
      .map((entry) => {
        const label = entry.label?.trim() || entry.id;
        return {
          kind: "subagent",
          id: entry.id,
          label: `@${label}`,
          detail: `${subagentModeLabel(entry.mode)} · ${subagentActivityLabel(entry.activity)}`,
          insertText: `@${label}`,
        };
      });
  }, [childSubagents, commands, composerTrigger, skills]);
  const activeComposerCandidateIndex = composerCandidates.length === 0
    ? 0
    : Math.min(composerCandidateIndex, composerCandidates.length - 1);
  const selectedSubagentIndex = childSubagents.findIndex((entry) => entry.id === selectedSubagentId);
  const selectedSubagent = selectedSubagentIndex >= 0 ? childSubagents[selectedSubagentIndex] : undefined;
  const providerNamespaces = useMemo(() => new Set(providers.map((provider) => provider.settingsNs)), [providers]);
  const pluginSettings = useMemo(() => (settings?.namespaces ?? []).filter((namespace) => !providerNamespaces.has(namespace.ns) && !["locale", "permission", "ui-conversation", "ui-theme", "ui-onboarding"].includes(namespace.ns)), [providerNamespaces, settings]);
  const visiblePlugins = useMemo(() => {
    const query = pluginSearch.trim().toLocaleLowerCase();
    return (pluginInventory ?? []).filter((plugin) => !query || `${plugin.entryId} ${plugin.moduleName}`.toLocaleLowerCase().includes(query));
  }, [pluginInventory, pluginSearch]);

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
    const [hostResult, presetResult, workspaceResult, settingsResult, providerResult, modelResult, pluginResult] = await Promise.allSettled([
      bridgeRequest<Record<string, unknown>>("host.describe"),
      bridgeRequest<DshPresetRoster>("agentPreset.list"),
      bridgeRequest<{ items: DshWorkspace[]; archivedSessionIds?: string[] }>("workspace.list"),
      bridgeRequest<DshSettingsDescription>("settings.describe"),
      bridgeRequest<{ providers: DshProvider[] }>("llm.providers"),
      bridgeRequest<DshHostModelCatalog>("llm.models"),
      bridgeRequest<DshPluginInventorySnapshot>("plugin.list"),
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
    if (pluginResult.status === "fulfilled") setPluginInventory(pluginResult.value.entries);
  }

  async function loadSubagents(parentSessionId = activeSessionRef.current) {
    if (!desktop || !parentSessionId) return;
    try {
      setSubagents(await bridgeRequest<DshSubagentCatalog>("subagent.list", { parentSessionId }));
    } catch (error) {
      setNotice(errorText(error));
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

  async function loadFeedback(sessionId = activeSessionRef.current) {
    if (!desktop || !sessionId) {
      setFeedback({});
      return;
    }
    try {
      const result = await desktopClientRuntime.remote.invoke<{
        ok: true;
        value: { items: DshMessageFeedbackItem[] };
      } | { ok: false; error: { code: string } }>("messageFeedback", "list", { sessionId });
      if (activeSessionRef.current !== sessionId) return;
      if (!result.ok) throw new Error(result.error.code);
      setFeedback(Object.fromEntries(result.value.items.map((item) => [item.messageId, item])));
    } catch {
      if (activeSessionRef.current !== sessionId) return;
      setFeedback({});
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
    setSkills([]);
    setCommands([]);
    setFeedback({});
    setAnnotations({});
    setPermissionSelect(null);
    setPlan(null);
    void loadSubagents();
    if (activeSessionId) {
      void loadCommands(activeSessionId);
      void loadFeedback(activeSessionId);
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
        await Promise.all([loadCommands(activeSessionId), loadFeedback(activeSessionId), loadAnnotations(activeSessionId)]);
      }
      if (tab === "goal" && activeSessionId) {
        const historyResult = await bridgeRequest<{ events: DshHistoryEntry[]; projections?: { values: Record<string, unknown> } }>("session.history", { sessionId: activeSessionId, maxMessages: 100 });
        setGoal((historyResult.projections?.values.goal as DshGoalProjection | null | undefined) ?? null);
      }
      if (tab === "settings") {
        const [settingsResult, pluginResult] = await Promise.allSettled([
          bridgeRequest<DshSettingsDescription>("settings.describe"),
          bridgeRequest<DshPluginInventorySnapshot>("plugin.list"),
        ]);
        if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
        if (pluginResult.status === "fulfilled") setPluginInventory(pluginResult.value.entries);
      }
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice(errorText(error));
    }
  }

  async function readPreset(id: string) {
    try {
      const result = await bridgeRequest<{ agentPreset: string; content: string }>("agentPreset.read", { agentPreset: id });
      setPresetView({ id: result.agentPreset, content: result.content });
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice(errorText(error));
    }
  }

  async function openPresetDocument(id: string) {
    try {
      const result = await bridgeRequest<{ opened: true } | { opened: false; path: string }>("agentPreset.openDocument", { agentPreset: id });
      setNotice(result.opened ? "已打开 Preset 文件夹" : `Preset 文件夹：${result.path}`);
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice(message);
    } finally {
      if (requestId === subagentRequestRef.current) setSubagentLoadingId(null);
    }
  }

  function toggleSubagent(entry: ChildSubagentEntry, index: number) {
    if (subagentPanelOpen && selectedSubagentId === entry.id) {
      setSubagentPanelOpen(false);
      return;
    }
    setSubagentPanelOpen(true);
    void openSubagent({
      parentSessionId: activeSessionId!,
      childSessionId: entry.id,
      mode: entry.mode,
    });
    setNotice(`正在打开 ${subagentDisplayName(entry, index)}`);
  }

  async function promptSubagent() {
    if (!subagentSession || !subagentComposer.trim() || subagentSession.address.mode !== "continuable") return;
    try {
      await bridgeRequest("subagent.prompt", {
        ...subagentSession.address,
        content: [{ type: "text", text: subagentComposer.trim() }],
      });
      setSubagentComposer("");
      setNotice("已发送给子 Agent");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function interruptSubagent(address: DshSubagentAddress) {
    if (address.mode !== "continuable") return;
    try {
      await bridgeRequest("subagent.interrupt", { ...address });
      setNotice("已请求停止子 Agent");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function createGoal() {
    if (!activeSessionId || !goalDraft.trim()) return;
    try {
      await bridgeRequest("goal.create", { sessionId: activeSessionId, objective: goalDraft.trim() });
      setGoalDraft("");
      await loadSurface("goal");
      setNotice("Goal 已创建");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function mutateGoal(action: "edit" | "pause" | "resume" | "complete" | "clear") {
    if (!activeSessionId || !activeGoal) return;
    const ref: GoalRef = { id: activeGoal.id, revision: activeGoal.revision };
    try {
      if (action === "edit") {
        if (!goalDraft.trim()) return;
        await bridgeRequest("goal.edit", { sessionId: activeSessionId, ref, objective: goalDraft.trim() });
        setGoalDraft("");
      } else {
        await bridgeRequest(`goal.${action}`, { sessionId: activeSessionId, ref });
      }
      await loadSurface("goal");
      setNotice(`Goal 已${action === "clear" ? "清除" : "更新"}`);
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice(errorText(error));
    }
  }

  async function openSession(session: DshSessionSummary) {
    if (!desktop) return;
    const loadRequest = ++sessionLoadRequestRef.current;
    activeSessionRef.current = session.sessionId;
    contextProjectionRef.current = false;
    setSessionIndicators((current) => ({ ...current, [session.sessionId]: "idle" }));
    setActiveSessionId(session.sessionId);
    setWorkspace(workspaces.find((item) => item.sessionIds.includes(session.sessionId))?.path ?? session.cwd ?? "");
    setHistory([]);
    setHistoryHasMore(false);
    setHistoryLoadingOlder(false);
    setTranscriptFollowing(true);
    setTodos(null);
    setTrajectoryOpen(false);
    setQueue([]);
    setQueueEditingId(null);
    setQueueEditingText("");
    setAttachments([]);
    setGoal(undefined);
    subagentRequestRef.current += 1;
    setSubagents(null);
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadingId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
    setPresetView(null);
    setModels(null);
    setDraftModelSelection(null);
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
      if (loadRequest !== sessionLoadRequestRef.current || activeSessionRef.current !== session.sessionId) return;
      setHistory(historyResult.events);
      setHistoryHasMore(historyResult.hasMore);
      const loadedStats = readSessionStats(historyResult.events, historyResult.projections);
      contextProjectionRef.current = Boolean(recordValue(historyResult.projections?.values.contextPressure));
      setSessionStats({ ...loadedStats, contextLimit: modelsResult.contextWindow ?? loadedStats.contextLimit });
      const projectionValues = historyResult.projections?.values;
      setGoal((projectionValues?.goal as DshGoalProjection | null | undefined) ?? null);
      setPermissionSelect((projectionValues?.permissions as DshPermissionSelect | null | undefined) ?? null);
      setPlan((projectionValues?.plan as DshPlanProjection | null | undefined) ?? null);
      const projectedTodos = projectionValues && Object.prototype.hasOwnProperty.call(projectionValues, "todos")
        ? todoProjection(projectionValues.todos)
        : undefined;
      setTodos(projectedTodos !== undefined ? projectedTodos : todosFromHistory(historyResult.events) ?? null);
      setModels(modelsResult);
      setNotice(modelsResult.routable ? "会话已打开" : "当前模型路由不可用");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      if (loadRequest === sessionLoadRequestRef.current) setLoading(false);
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
      const nextStats = readSessionStats(result.events, result.projections);
      setSessionStats((current) => ({
        ...current,
        ...nextStats,
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
      setNotice(errorText(error));
    } finally {
      historyLoadingOlderRef.current = false;
      setHistoryLoadingOlder(false);
    }
  }

  async function boot() {
    if (!desktop) {
      setNotice("浏览器预览模式");
      return;
    }
    try {
      const nextStatus = await checkDsh();
      setStatus(nextStatus);
      setNotice(nextStatus.message);
      if (nextStatus.runtimeAvailable) {
        const loadedSessions = await loadSessions(true);
        await loadRuntimeDetails(loadedSessions);
      }
    } catch (error) {
      const message = errorText(error);
      setStatus((current) => ({ ...current, runtimeAvailable: false, runtimeStarting: false, message }));
      setNotice(message);
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
      setStatus(nextStatus);
      setNotice(nextStatus.message);
      if (nextStatus.runtimeAvailable) {
        void (async () => {
          const loadedSessions = await loadSessions(true);
          await loadRuntimeDetails(loadedSessions);
        })().catch((error) => setNotice(errorText(error)));
      }
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToDiagnostic((message) => {
      setNotice(message);
      setStatus((current) => current.runtimeAvailable ? current : { ...current, message });
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
      } catch {
        // A session can use a directory even when workspace registration is unavailable.
      }
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function chooseWorkspace(path: string) {
    workspaceSelectionInitializedRef.current = true;
    setWorkspace(path);
    setWorkspaceMenuOpen(false);
    setNotice(path ? "新会话将使用此工作目录" : "新会话将使用 DSH 运行目录");
    const selected = workspaces.find((item) => item.path === path);
    if (!selected) return;
    try {
      const attachedCount = await attachUnregisteredSessions(selected);
      if (attachedCount > 0) {
        await loadRuntimeDetails();
        setNotice(`已将 ${attachedCount} 个同目录会话登记到工作区`);
      }
    } catch (error) {
      setNotice(errorText(error));
    }
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

  async function renameWorkspace(item: DshWorkspace) {
    const title = window.prompt("重命名工作区", item.title);
    if (!title?.trim() || title.trim() === item.title) return;
    try {
      const result = await bridgeRequest<{ workspace: DshWorkspace }>("workspace.rename", {
        workspaceId: item.workspaceId,
        title: title.trim(),
      });
      setWorkspaces((current) => current.map((workspaceItem) => workspaceItem.workspaceId === item.workspaceId ? result.workspace : workspaceItem));
      setNotice("工作区已重命名");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function removePreset(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset || preset.trust !== "user") return;
    if (!window.confirm(`删除 Agent Preset“${presetDisplayName(id, presets)}”？已在其上运行的会话不受影响。`)) return;
    try {
      await bridgeRequest("agentPreset.remove", { agentPreset: id });
      if (nextPreset === id) setNextPreset("");
      setPresetView((current) => current?.id === id ? null : current);
      await loadRuntimeDetails();
      setNotice("Agent Preset 已删除");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function deleteWorkspace(item: DshWorkspace) {
    if (!window.confirm(`删除工作区“${item.title}”？不会删除目录和会话。`)) return;
    try {
      await bridgeRequest("workspace.delete", { workspaceId: item.workspaceId });
      setWorkspaces((current) => current.filter((workspaceItem) => workspaceItem.workspaceId !== item.workspaceId));
      if (workspace === item.path) setWorkspace("");
      setNotice("工作区已移除");
    } catch (error) {
      setNotice(errorText(error));
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
      if (announce) setNotice(errorText(error));
    }
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
    setComposer("");
    setAttachments([]);
    setModels(null);
    setDraftModelSelection(null);
    setSessionStats({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, firstTokenMs: 0, messages: 0 });
    setCommands([]);
    setFeedback({});
    setAnnotations({});
    setPermissionSelect(null);
    setPlan(null);
    setQueue([]);
    setQueueEditingId(null);
    setQueueEditingText("");
    setGoal(undefined);
    subagentRequestRef.current += 1;
    setSubagents(null);
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadingId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
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
    if (defaultPermission && !settings?.namespaces.some((item) => item.ns === "permission")) {
      await executeCommandLine(created.sessionId, `/permission ${defaultPermission}`);
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
    setNextPreset("");
    setPresetMenuOpen(false);
    void bridgeRequest<DshSessionModels>("session.models", { sessionId: created.sessionId })
      .then((nextModels) => {
        setModels(nextModels);
        if (nextModels.contextWindow !== undefined) setSessionStats((current) => ({ ...current, contextLimit: nextModels.contextWindow! }));
      })
      .catch(() => undefined);
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
    const execution = await desktopClientRuntime.remote.invoke<DshCommandExecution | undefined>("commands", "execute", { agentId: sessionId, line });
    if (!execution) {
      setNotice(`未知命令：${line}`);
      return undefined;
    }
    if (execution.result.kind === "error") setNotice(execution.result.text);
    return execution;
  }

  async function sendPrompt() {
    const text = composer.trim();
    if ((!text && attachments.length === 0) || loading || !status.runtimeAvailable) return;
    if (attachments.length > 0) {
      if (!selectedModelSupportsImages) {
        setNotice("当前模型不支持图片输入，请切换到支持图片的模型后再发送");
        return;
      }
    }
    setLoading(true);
    setNotice(promptMode === "steer" ? "正在插入当前回合" : "正在发送");
    try {
      const sessionId = await ensureSession();
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
      await bridgeRequest("session.prompt", {
        sessionId,
        mode: promptMode,
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...attachments.map((attachment) => ({ type: "image", mediaType: attachment.mediaType, data: attachment.data, name: attachment.name })),
        ],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setComposer("");
      setAttachments([]);
      void refreshSessionStats(sessionId);
      setNotice(promptMode === "steer" ? "已插入当前回合" : "已发送");
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice(errorText(error));
    }
  }

  function handleComposerAction() {
    void sendPrompt();
  }

  function updateSendShortcut(shortcut: string) {
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
      setNotice(errorText(error));
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
    if (!window.confirm("将清除此消息之后的会话内容，并从这条提示词重新请求。原会话会保留为分支；已执行的文件或外部操作不会回滚。继续吗？")) return;
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

      const hydratedContent = await Promise.all(sourceParts.map(async (part) => {
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
        setNotice(errorText(error));
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
      setNotice(`复制失败：${errorText(error)}`);
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
    } catch (error) { setNotice(errorText(error)); }
  }

  async function restoreSession(session: DshSessionSummary) {
    try {
      const result = await bridgeRequest<{ archivedSessionIds: string[] }>("workspace.restoreSession", { sessionId: session.sessionId });
      setArchivedSessionIds(new Set(result.archivedSessionIds));
      await loadSessions();
      setNotice("会话已恢复");
    } catch (error) { setNotice(errorText(error)); }
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
    } catch (error) { setNotice(errorText(error)); }
  }

  function requestSessionAction(action: SessionAction, session: DshSessionSummary) {
    setSessionContextMenu(null);
    if (action === "archive") { setConfirmAction({ action, session }); return; }
    if (action === "fork") { void forkSession(session.sessionId); return; }
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
      setNotice(errorText(error));
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
    } catch (error) { setNotice(errorText(error)); }
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
      if (selectedContextWindow !== undefined) setSessionStats((current) => ({ ...current, contextLimit: selectedContextWindow }));
      setModelMenuOpen(false);
      setModelMenuPane("root");
      setNotice("模型已切换");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function restartRuntime() {
    if (!desktop) return;
    setNotice("正在重新启动 DSH");
    try {
      const nextStatus = await refreshDsh();
      setStatus(nextStatus);
    } catch (error) {
      const message = errorText(error);
      setStatus((current) => ({ ...current, runtimeAvailable: false, runtimeStarting: false, message }));
      setNotice(message);
    }
  }

  async function putFeedback(messageId: string, rating: "positive" | "negative", note?: string) {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    const current = feedback[messageId];
    const result = await desktopClientRuntime.remote.invoke<FeedbackOperationResult<DshMessageFeedbackItem>>("messageFeedback", "put", {
      sessionId,
      messageId,
      rating,
      ...(note === undefined ? {} : { note }),
      ifVersion: current?.version ?? null,
    });
    if (!result.ok) {
      if (result.error.code === "version-conflict") {
        setFeedback((items) => {
          const next = { ...items };
          if (result.error.current) next[messageId] = result.error.current;
          else delete next[messageId];
          return next;
        });
      }
      throw new Error(`反馈未保存：${result.error.code}`);
    }
    setFeedback((items) => ({ ...items, [messageId]: result.value }));
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
    const draft = window.prompt("消息注记", current?.note ?? "");
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
      setNotice(errorText(error));
    }
  }

  async function deleteFeedback(messageId: string) {
    const sessionId = activeSessionRef.current;
    const current = feedback[messageId];
    if (!sessionId || !current) return;
    const result = await desktopClientRuntime.remote.invoke<FeedbackOperationResult<{ absent: true }>>("messageFeedback", "delete", {
      sessionId,
      messageId,
      ifVersion: current.version,
    });
    if (!result.ok) {
      if (result.error.code === "version-conflict") {
        setFeedback((items) => {
          const next = { ...items };
          if (result.error.current) next[messageId] = result.error.current;
          else delete next[messageId];
          return next;
        });
      }
      throw new Error(`反馈未删除：${result.error.code}`);
    }
    setFeedback((items) => {
      const next = { ...items };
      delete next[messageId];
      return next;
    });
  }

  async function rateMessage(messageId: string, rating: "positive" | "negative") {
    try {
      if (feedback[messageId]?.rating === rating) await deleteFeedback(messageId);
      else await putFeedback(messageId, rating, feedback[messageId]?.note);
      setNotice("反馈已更新");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function editMessageFeedback(messageId: string) {
    const current = feedback[messageId];
    if (!current) {
      setNotice("请先选择赞或踩");
      return;
    }
    const draft = window.prompt("反馈备注", current.note ?? "");
    if (draft === null) return;
    try {
      await putFeedback(messageId, current.rating, draft.trim() || undefined);
      setNotice(draft.trim() ? "反馈备注已更新" : "反馈备注已清除");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function runCommand(line: string) {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    try {
      const execution = await executeCommandLine(sessionId, line);
      if (execution?.result.kind === "success" && execution.result.text) setNotice(execution.result.text);
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice("该模型当前不可用，请刷新模型目录后重试");
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
      setNotice(errorText(error));
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
      setNotice(errorText(error));
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

  async function setPermissionPreset(value: string) {
    if (value === "custom") return;
    if (value === "danger-full-access") {
      setPendingPermissionValue(value);
      return;
    }
    await runCommand(`/permission ${value}`);
  }

  async function confirmPermissionPreset() {
    const value = pendingPermissionValue;
    if (!value) return;
    setPendingPermissionValue(null);
    await runCommand(`/permission ${value}`);
  }

  async function togglePlan() {
    await runCommand(plan?.active ? "/plan off" : "/plan");
  }

  async function exportSession() {
    const sessionId = activeSessionRef.current;
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
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), session, events: exported }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dsh-${sessionId.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出 ${exported.length} 条事件`);
    } catch (error) {
      setNotice(`导出失败：${errorText(error)}`);
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
      const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`已导出 ZIP（${result.size} 字节）`);
    } catch (error) {
      setNotice(`ZIP 导出失败：${errorText(error)}`);
    }
  }

  async function openSessionPath(path: string) {
    const session = sessions.find((item) => item.sessionId === activeSessionRef.current);
    if (!session) return;
    try {
      await bridgeRequest("host.openPath", { path: sessionPath(session.cwd, path) });
      setNotice("已交给系统打开");
    } catch (error) {
      setNotice(`打开失败：${errorText(error)}`);
    }
  }

  async function addComposerFiles(files: FileList | File[]) {
    const candidates = Array.from(files).filter((file) => Boolean(imageMediaType(file)));
    if (candidates.length === 0) {
      setNotice("只支持 PNG、JPEG、WebP 或 GIF 图片");
      return;
    }
    try {
      const next = await Promise.all(candidates.map(readImageFile));
      setAttachments((current) => [...current, ...next].slice(0, 4));
      setNotice("图片已添加");
    } catch (error) {
      setNotice(errorText(error));
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
      if (requestId === searchRequestRef.current) setNotice(errorText(error));
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
      setNotice(errorText(error));
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
  }

  async function respondToQuestion() {
    if (!question) return;
    const request = question;
    const answers = questionAnswersBySession[request.sessionId] ?? {};
    const customAnswers = questionCustomAnswersBySession[request.sessionId] ?? {};
    const answer = {
      answers: request.questions.map((item) => {
        const custom = customAnswers[item.id]?.trim();
        return {
          id: item.id,
          selected: answers[item.id] ?? [],
          ...(custom ? { custom } : {}),
        };
      }),
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
      setNotice(errorText(error));
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
      setNotice(errorText(error));
    }
  }

  async function removeQueueItem(itemId: string) {
    if (!activeSessionId) return;
    try {
      await bridgeRequest("session.updateQueue", { sessionId: activeSessionId, itemId, action: { kind: "remove" } });
    } catch (error) {
      setNotice(errorText(error));
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
      setNotice("排队消息不能为空");
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
      setNotice(errorText(error));
    }
  }

  function chooseComposerCandidate(candidate: ComposerCandidate) {
    if (!composerTrigger) return;
    setComposer(`${composer.slice(0, composerTrigger.start)}${candidate.insertText} `);
    setComposerCandidateIndex(0);
    setComposerMenuDismissed(false);
  }

  function openSettingsNamespace(namespace: DshSettingsNamespace | undefined) {
    if (!namespace) {
      setNotice("该设置命名空间当前不可用");
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
    setShowInspector(false);
    setSettingsDraft(null);
    setPresetCopy(null);
    setPresetView(null);
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
      <StartupSplash
        status={status}
        onRetry={() => void restartRuntime()}
        windowMaximized={windowMaximized}
        onDrag={(event) => void startWindowDrag(event)}
        onMinimize={() => void minimizeWindow()}
        onToggleMaximize={() => void toggleWindowMaximize()}
        onClose={() => void closeWindow()}
      />
    );
  }

  return (
    <main className={`app-shell${appearance.backgroundImage ? " has-custom-background" : ""}`} style={appearanceStyle}>
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

      <div className={`workspace-layout ${todoVisible ? "todo-visible" : ""} ${todoVisible && todoCollapsed ? "todo-collapsed" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
        <SessionSidebar
          search={search}
          onSearchChange={setSearch}
          onSearch={() => void searchSessions()}
          onClearSearch={() => setSearch("")}
          onNewSession={startNewSession}
          settingsOpen={showInspector}
          onOpenSettings={openSettings}
          onAddWorkspace={() => void addWorkspace()}
          visibleSessions={selectedWorkspaceSessions}
          archivedSessions={archivedSessions}
          onRestoreSession={restoreSession}
          onDeleteArchivedSession={setDeleteArchivedTarget}
          workspaceGroup={selectedWorkspaceGroup}
          collapsedWorkspaces={collapsedWorkspaces}
          onToggleWorkspace={toggleWorkspace}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          sessionContextMenu={sessionContextMenu}
          onRequestSessionAction={requestSessionAction}
          workspace={workspace}
          workspaces={workspaces}
          workspaceMenuOpen={workspaceMenuOpen}
          onToggleWorkspaceMenu={() => setWorkspaceMenuOpen((value) => !value)}
          onChooseWorkspace={chooseWorkspace}
          activeSessionId={activeSessionId}
          sessionIndicators={sessionIndicators}
          pendingSessionIds={pendingSessionIds}
          searchResultById={searchResultById}
          workspaceBySessionId={workspaceBySessionId}
          dragOverSessionId={dragOverSessionId}
          draggedSessionRef={draggedSessionRef}
          onOpenSession={openSession}
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
            queueCount={queue.length}
            activeJobs={activeJobs}
            jobsOpen={jobsOpen}
            jobNow={jobNow}
            trajectoryOpen={trajectoryOpen}
            onToggleJobs={() => { setJobsOpen((open) => !open); setJobNow(Date.now()); }}
            onToggleTrajectory={() => setTrajectoryOpen((open) => !open)}
            onExport={exportSession}
            onExportZip={() => exportSessionZip()}
            onFork={forkSession}
          />

          <div className="conversation-transcript-stage">
            <ConversationTranscript
              scrollRef={transcriptScroll}
              endRef={transcriptEnd}
              history={history}
              transcript={transcript}
              activeSession={activeSession ?? null}
              activeSessionId={activeSessionId}
              activeRunning={activeRunning}
              loading={loading}
              historyHasMore={historyHasMore}
              historyLoadingOlder={historyLoadingOlder}
              transcriptFollowing={transcriptFollowing}
              trajectoryOpen={trajectoryOpen}
              workspace={workspace}
              runtimeDirectory={status.runtimeDirectory}
              modelName={models?.current.model ?? defaultModelName}
              presets={presets}
              feedback={feedback}
              annotations={annotations}
              nextPreset={nextPreset}
              presetMenuOpen={presetMenuOpen}
              onLoadOlder={loadOlderHistory}
              onFollowingChange={setTranscriptFollowing}
              onJumpToLatest={() => setTranscriptFollowing(true)}
              onTogglePresetMenu={() => setPresetMenuOpen((open) => !open)}
              onStagePreset={stagePresetForNextSession}
              onCopyMessage={copyMessage}
              onFeedback={rateMessage}
              onEditFeedback={editMessageFeedback}
              onEditAnnotation={editMessageAnnotation}
               onRetryMessage={retryMessage}
               retryingMessageSeq={retryingMessageSeq}
              onForkSession={forkSession}
              onOpenSessionPath={openSessionPath}
            />

            {todoVisible && <TodoPanel todos={todos ?? []} collapsed={todoCollapsed} counts={todoCounts} onToggle={() => setTodoCollapsed((value) => !value)} />}

            <SubagentPanel
              entries={childSubagents}
              panelOpen={subagentPanelOpen}
              selectedId={selectedSubagentId}
              selectedIndex={selectedSubagentIndex}
              selectedEntry={selectedSubagent}
              loadingId={subagentLoadingId}
              loadError={subagentLoadError}
              session={subagentSession}
              transcript={subagentTranscript}
              composer={subagentComposer}
              onToggle={toggleSubagent}
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
            selectedModelValue={selectedModelValue}
            selectedModelName={selectedModel?.name}
            selectedReasoning={selectedReasoning}
            selectedReasoningEffort={selectedReasoningEffort}
            selectedReasoningLabel={selectedReasoningLabel}
            reasoningChoices={reasoningChoices}
            modelMenuOpen={modelMenuOpen}
            modelMenuPane={modelMenuPane}
            sessionStats={sessionStats}
             sendShortcut={sendShortcut}
            onComposerChange={(value) => {
              setComposer(value);
              setComposerMenuDismissed(false);
            }}
            onPaste={handleComposerPaste}
            onAddFiles={addComposerFiles}
            onRemoveAttachment={(attachmentId) => setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
            permissions={permissionSelect}
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

        {showInspector && (
          <div className="inspector-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="inspector-title">
            <button className="inspector-backdrop" onClick={closeSettings} aria-label="关闭设置" />
            <aside className="inspector-panel">
            <div className="inspector-header"><strong id="inspector-title">设置</strong><button onClick={closeSettings} title="关闭设置">×</button></div>
            {surfaceLoading && <div className="surface-loading">正在读取 DSH 状态…</div>}

            <div className="settings-layout">
                <nav className="settings-navigation" aria-label="设置分区">
                  <div className="settings-navigation-title">DSH 设置</div>
                  <button className={settingsSection === "appearance" ? "selected" : ""} onClick={() => setSettingsSection("appearance")}>
                    <strong>外观</strong><small>字体与背景</small>
                  </button>
                  <button className={settingsSection === "general" ? "selected" : ""} onClick={() => setSettingsSection("general")}>
                    <strong>通用</strong><small>会话与 Host</small>
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
                </nav>

                <section className="settings-main">
                  {settingsSection === "appearance" && <SettingsAppearancePanel
                    appearance={appearance}
                    themeMode={themeMode}
                    fontPreset={appearanceFontPreset}
                    codeFontPreset={appearanceCodeFontPreset}
                    fontPresets={appearanceFontPresets}
                    codeFontPresets={appearanceCodeFontPresets}
                    fileInputRef={appearanceFileInputRef}
                    onUpdate={updateAppearance}
                    onThemeChange={setThemeMode}
                    onBackgroundFile={handleBackgroundFile}
                    onThemeFile={handleThemeFile}
                    onReset={resetAppearance}
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
                    onOpenDocument={() => bridgeRequest("settings.openDocument").then(() => setNotice("已打开 DSH 配置文件")).catch((error) => setNotice(errorText(error)))}
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
                    visiblePlugins={visiblePlugins}
                    search={pluginSearch}
                    expandedPlugin={expandedPlugin}
                    pluginSettings={pluginSettings}
                    settings={settings}
                    onSearchChange={setPluginSearch}
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
      </div>
    </main>
  );
}

export default App;
