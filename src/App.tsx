import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { StartupSplash } from "./components/StartupSplash";
import { ConversationTranscript } from "./components/ConversationTranscript";
import { ConversationHeader } from "./components/ConversationHeader";
import { ComposerShell } from "./components/ComposerShell";
import { InteractionPanel } from "./components/InteractionPanel";
import { GoalSurfacePanel } from "./components/GoalSurfacePanel";
import { PresetSurfacePanel } from "./components/PresetSurfacePanel";
import { RuntimeSurfacePanel } from "./components/RuntimeSurfacePanel";
import { SettingsAppearancePanel } from "./components/SettingsAppearancePanel";
import { SettingsGeneralPanel } from "./components/SettingsGeneralPanel";
import { SettingsModelsPanel } from "./components/SettingsModelsPanel";
import { SettingsPluginsPanel } from "./components/SettingsPluginsPanel";
import { SettingsPresetPanel } from "./components/SettingsPresetPanel";
import { QueueDock } from "./components/QueueDock";
import { SessionSidebar } from "./components/SessionSidebar";
import { SkillsSurfacePanel } from "./components/SkillsSurfacePanel";
import { SubagentPanel } from "./components/SubagentPanel";
import { SubagentsSurfacePanel } from "./components/SubagentsSurfacePanel";
import { TodoPanel } from "./components/TodoPanel";
import { WindowChrome } from "./components/WindowChrome";
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
  type DshPluginInventoryEntry,
  type DshPluginInventorySnapshot,
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
  sessionPath,
  presetDisplayName,
  sessionIsVisible,
} from "./app/model";
import {
  type PromptMode,
  type ModelMenuPane,
  type SessionAction,
  type WorkspaceViewMode,
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

const demoStatus: DshStatus = {
  dshHome: "",
  runtimeDirectory: "",
  packageName: "@deepseek-ai/dsh@latest",
  runtimeAvailable: false,
  runtimeStarting: false,
  message: "浏览器预览模式",
};

function App() {
  const desktop = isTauri();
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
  const [notice, setNotice] = useState("准备连接 DSH");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteSearchResults, setRemoteSearchResults] = useState<SessionSearchResult[] | null>(null);
  const [models, setModels] = useState<DshSessionModels | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPane, setModelMenuPane] = useState<ModelMenuPane>("root");
  const [sessionStats, setSessionStats] = useState<SessionStats>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, firstTokenMs: 0, messages: 0 });
  const [presets, setPresets] = useState<DshPreset[]>([]);
  const [presetAuthorable, setPresetAuthorable] = useState(false);
  const [presetHasDocument, setPresetHasDocument] = useState(false);
  const [nextPreset, setNextPreset] = useState("");
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<DshWorkspace[]>([]);
  const [workspaceViewMode, setWorkspaceViewMode] = useState<WorkspaceViewMode>(() => {
    try {
      return localStorage.getItem("deeptop.workspace-view") === "flat" ? "flat" : "grouped";
    } catch {
      return "grouped";
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("deeptop.sidebar-width"));
      return Number.isFinite(saved) ? Math.min(440, Math.max(220, saved)) : 274;
    } catch {
      return 274;
    }
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem("deeptop.theme");
      return saved === "light" || saved === "dark" ? saved : "system";
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
  const [surfaceTab, setSurfaceTab] = useState<SurfaceTab>("runtime");
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
  const [renaming, setRenaming] = useState(false);
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
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const transcriptScroll = useRef<HTMLDivElement | null>(null);
  const appearanceFileInputRef = useRef<HTMLInputElement | null>(null);
  const draggedSessionRef = useRef<string | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const historyLoadingOlderRef = useRef(false);
  const [transcriptFollowing, setTranscriptFollowing] = useState(true);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const selectedSubagentRef = useRef<string | null>(null);
  const subagentRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const creatingSessionRef = useRef<Promise<string> | null>(null);
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
  const questionAnswers = activeSessionId ? questionAnswersBySession[activeSessionId] ?? {} : {};
  const questionCustomAnswers = activeSessionId ? questionCustomAnswersBySession[activeSessionId] ?? {} : {};

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
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
    if (!showInspector) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setShowInspector(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showInspector]);

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
      if (!(event.target instanceof Element) || !event.target.closest(".session-context-menu, .session-row-trigger")) {
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
  const workspaceBySessionId = useMemo(() => {
    const result = new Map<string, DshWorkspace>();
    workspaces.forEach((item) => item.sessionIds.forEach((sessionId) => result.set(sessionId, item)));
    return result;
  }, [workspaces]);
  const workspaceGroups = useMemo(() => {
    const groupedIds = new Set<string>();
    const groups = workspaces.map((item) => {
      const groupSessions = item.sessionIds
        .map((sessionId) => sessionById.get(sessionId))
        .filter((session): session is DshSessionSummary => session !== undefined && visibleSessions.some((item) => item.sessionId === session.sessionId));
      groupSessions.forEach((session) => groupedIds.add(session.sessionId));
      return { workspace: item, sessions: groupSessions };
    });
    return {
      groups,
      ungrouped: visibleSessions.filter((session) => !groupedIds.has(session.sessionId)),
    };
  }, [sessionById, visibleSessions, workspaces]);
  const modelOptions = useMemo(() => {
    if (!models) return [];
    return models.groups.flatMap((group) => group.models.map((model) => ({
      value: `${group.id}\u0000${model.id}`,
      label: `${group.name} / ${model.name}`,
      name: model.name,
      description: model.description,
      provider: group.id,
      model: model.id,
      reasoning: model.reasoning,
    })));
  }, [models]);
  const selectedModelValue = models ? `${models.current.provider}\u0000${models.current.model}` : "";
  const selectedModel = modelOptions.find((option) => option.value === selectedModelValue);
  const selectedReasoning = selectedModel?.reasoning;
  const selectedReasoningEffort = models?.current.reasoningEffort ?? selectedReasoning?.defaultEffort;
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
      return skills
        .filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(composerTrigger.query))
        .slice(0, 8)
        .map((skill) => ({
          kind: "skill",
          id: skill.name,
          label: `/${skill.name}`,
          detail: skill.description,
          insertText: `/${skill.name}`,
        }));
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
  }, [childSubagents, composerTrigger, skills]);
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
      localStorage.setItem("deeptop.workspace-view", workspaceViewMode);
    } catch {
      // The native webview may disable storage in a restricted preview.
    }
  }, [workspaceViewMode]);

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
      setSidebarWidth(Math.min(440, Math.max(220, resize.startWidth + event.clientX - resize.startX)));
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
    return result.items;
  }

  async function loadRuntimeDetails() {
    if (!desktop) return;
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
    if (workspaceResult.status === "fulfilled") {
      setWorkspaces(workspaceResult.value.items);
      setArchivedSessionIds(new Set((workspaceResult.value.archivedSessionIds ?? []).filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0)));
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

  useEffect(() => {
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
    setSkills([]);
    void loadSubagents();
    if (activeSessionId) {
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
    setSurfaceTab(tab);
    setSurfaceLoading(true);
    try {
      if (tab === "skills" && activeSessionId) {
        const result = await bridgeRequest<{ skills: DshSkill[] }>("skill.list", { sessionId: activeSessionId });
        setSkills(result.skills);
      }
      if (tab === "subagents" && activeSessionId) {
        setSubagents(await bridgeRequest<DshSubagentCatalog>("subagent.list", { parentSessionId: activeSessionId }));
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
    activeSessionRef.current = session.sessionId;
    setSessionIndicators((current) => ({ ...current, [session.sessionId]: "idle" }));
    setActiveSessionId(session.sessionId);
    setWorkspace(session.cwd ?? "");
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
    setLoading(true);
    try {
      const [historyResult, modelsResult] = await Promise.all([
        bridgeRequest<{ events: DshHistoryEntry[]; hasMore: boolean; projections?: { values: Record<string, unknown> } }>("session.history", {
          sessionId: session.sessionId,
          maxMessages: 100,
        }),
        bridgeRequest<DshSessionModels>("session.models", { sessionId: session.sessionId }),
      ]);
      setHistory(historyResult.events);
      setHistoryHasMore(historyResult.hasMore);
      const loadedStats = readSessionStats(historyResult.events, historyResult.projections);
      setSessionStats({ ...loadedStats, contextLimit: modelsResult.contextWindow ?? loadedStats.contextLimit });
      setGoal((historyResult.projections?.values.goal as DshGoalProjection | null | undefined) ?? null);
      const projectionValues = historyResult.projections?.values;
      const projectedTodos = projectionValues && Object.prototype.hasOwnProperty.call(projectionValues, "todos")
        ? todoProjection(projectionValues.todos)
        : undefined;
      setTodos(projectedTodos !== undefined ? projectedTodos : todosFromHistory(historyResult.events) ?? null);
      setModels(modelsResult);
      setNotice(modelsResult.routable ? "会话已打开" : "当前模型路由不可用");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setLoading(false);
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
        await loadSessions(true);
        await loadRuntimeDetails();
      }
    } catch (error) {
      const message = errorText(error);
      setStatus((current) => ({ ...current, runtimeAvailable: false, runtimeStarting: false, message }));
      setNotice(message);
    }
  }

  const routedBridgeEvent = (event: DshBridgeEvent) => routeBridgeEvent(event, {
    activeSessionRef,
    selectedSubagentRef,
    subagentRequestRef,
    setTodos,
    setHistory,
    setSessionStats,
    setSessions,
    setSubagentSession,
    setQueue,
    setSessionJobs,
    setPendingApprovals,
    setPendingQuestions,
    setQuestionAnswersBySession,
    setQuestionCustomAnswersBySession,
    setSessionIndicators,
    setSubagents,
    setArchivedSessionIds,
    setSelectedSubagentId,
    setSubagentLoadingId,
    setSubagentPanelOpen,
    setGoal,
    setNotice,
    loadSubagents,
    startNewSession,
  });

  useEffect(() => {
    if (!desktop) return;
    const cleanups: Array<UnlistenFn | undefined> = [];
    void listenToRuntimeStatus((nextStatus) => {
      setStatus(nextStatus);
      setNotice(nextStatus.message);
      if (nextStatus.runtimeAvailable) {
        void loadSessions(true).catch((error) => setNotice(errorText(error)));
        void loadRuntimeDetails().catch((error) => setNotice(errorText(error)));
      }
    }).then((unlisten) => { cleanups.push(unlisten); });
    void listenToDiagnostic((message) => {
      setNotice(message);
      setStatus((current) => current.runtimeAvailable ? current : { ...current, message });
    }).then((unlisten) => { cleanups.push(unlisten); });
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
      setWorkspace(picked);
      setWorkspaceMenuOpen(false);
      setNotice("新会话将使用此工作目录");
      try {
        await bridgeRequest("workspace.create", { path: picked });
        await loadRuntimeDetails();
      } catch {
        // A session can use a directory even when workspace registration is unavailable.
      }
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function chooseWorkspace(path: string) {
    setWorkspace(path);
    setWorkspaceMenuOpen(false);
    setNotice(path ? "新会话将使用此工作目录" : "新会话将使用 DSH 运行目录");
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

  async function moveWorkspace(item: DshWorkspace, direction: "up" | "down") {
    const index = workspaces.findIndex((workspaceItem) => workspaceItem.workspaceId === item.workspaceId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 2;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index >= workspaces.length - 1) return;
    try {
      await bridgeRequest("workspace.insertBefore", {
        workspaceId: item.workspaceId,
        ...(workspaces[targetIndex] ? { beforeWorkspaceId: workspaces[targetIndex].workspaceId } : {}),
      });
      await loadRuntimeDetails();
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function moveSessionBefore(sessionId: string, beforeSessionId: string) {
    if (sessionId === beforeSessionId) return;
    const targetWorkspace = workspaceBySessionId.get(beforeSessionId);
    if (!targetWorkspace) {
      setNotice("未分组会话不能参与工作区排序");
      return;
    }
    try {
      await bridgeRequest("workspace.insertSessionBefore", {
        workspaceId: targetWorkspace.workspaceId,
        sessionId,
        beforeSessionId,
      });
      await loadRuntimeDetails();
      setNotice("会话顺序已更新");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function startNewSession() {
    activeSessionRef.current = null;
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
    setSessionStats({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, firstTokenMs: 0, messages: 0 });
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
    setSurfaceTab("runtime");
    setNotice("输入消息后创建会话");
  }

  async function ensureSession() {
    if (activeSessionRef.current) return activeSessionRef.current;
    if (creatingSessionRef.current) return creatingSessionRef.current;
    const creation = (async () => {
    const presetId = nextPreset || presets.find((preset) => preset.isDefault)?.id;
    const created = await bridgeRequest<{ sessionId: string; agentPreset?: string }>("session.create", {
      ...(workspace ? { cwd: workspace } : {}),
      ...(presetId ? { agentPreset: presetId } : {}),
    });
    // session.create also emits host/session-added. Do not prepend an optimistic
    // row here: the event and the next list refresh are the source of truth and
    // otherwise the same newly-created session can appear twice.
    await loadSessions();
    activeSessionRef.current = created.sessionId;
    setActiveSessionId(created.sessionId);
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

  async function sendPrompt() {
    const text = composer.trim();
    if ((!text && attachments.length === 0) || loading || !status.runtimeAvailable) return;
    setLoading(true);
    setNotice(promptMode === "steer" ? "正在插入当前回合" : "正在发送");
    try {
      const sessionId = await ensureSession();
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
    if (activeRunning) {
      void cancelSession();
    } else {
      void sendPrompt();
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

  function requestSessionAction(action: SessionAction, session: DshSessionSummary) {
    setSessionContextMenu(null);
    if (action === "archive") { setConfirmAction({ action, session }); return; }
    if (action === "fork") { void forkSession(session.sessionId); return; }
    setRenameValue(displayTitle(session));
    if (session.sessionId === activeSessionId) setRenaming(true);
    else void openSession(session).then(() => setRenaming(true));
  }

  async function renameSession() {
    if (!activeSessionId || !renameValue.trim()) return;
    try {
      await bridgeRequest("session.rename", { sessionId: activeSessionId, title: renameValue.trim() });
      setRenaming(false);
      setNotice("会话已重命名");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function changeReasoningEffort(reasoningEffort?: string) {
    if (!activeSessionId || !models) return;
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
    if (!activeSessionId || !value) return;
    const [provider, model] = value.split("\u0000");
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

  function openSettings() {
    if (showInspector && surfaceTab === "settings") {
      setShowInspector(false);
      return;
    }
    setSettingsSection("appearance");
    setSurfaceTab("settings");
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
        status={status}
        workspace={workspace}
        activeSessionCwd={activeSession?.cwd}
        windowMaximized={windowMaximized}
        settingsOpen={showInspector && surfaceTab === "settings"}
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
          status={status}
          search={search}
          onSearchChange={setSearch}
          onSearch={() => void searchSessions()}
          onClearSearch={() => setSearch("")}
          onNewSession={startNewSession}
          onAddWorkspace={() => void addWorkspace()}
          visibleSessions={visibleSessions}
          workspaceViewMode={workspaceViewMode}
          onWorkspaceViewModeChange={setWorkspaceViewMode}
          workspaceGroups={workspaceGroups}
          collapsedWorkspaces={collapsedWorkspaces}
          onToggleWorkspace={toggleWorkspace}
          onMoveWorkspace={moveWorkspace}
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
          searchResultById={searchResultById}
          workspaceBySessionId={workspaceBySessionId}
          dragOverSessionId={dragOverSessionId}
          draggedSessionRef={draggedSessionRef}
          onOpenSession={openSession}
          onMoveSessionBefore={moveSessionBefore}
          onDragOverSessionChange={(sessionId) => setDragOverSessionId(sessionId)}
          onSessionContextMenu={(session, x, y) => setSessionContextMenu({ session, x, y })}
        />

        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整会话侧栏宽度"
          aria-valuemin={220}
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
            renaming={renaming}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onRenameSubmit={renameSession}
            onStartRename={() => { if (activeSession) { setRenameValue(displayTitle(activeSession)); setRenaming(true); } }}
            onToggleJobs={() => { setJobsOpen((open) => !open); setJobNow(Date.now()); }}
            onToggleTrajectory={() => setTrajectoryOpen((open) => !open)}
            onExport={exportSession}
            onFork={forkSession}
          />

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
            modelName={models?.current.model ?? "默认模型"}
            presets={presets}
            nextPreset={nextPreset}
            presetMenuOpen={presetMenuOpen}
            onLoadOlder={loadOlderHistory}
            onFollowingChange={setTranscriptFollowing}
            onJumpToLatest={() => setTranscriptFollowing(true)}
            onTogglePresetMenu={() => setPresetMenuOpen((open) => !open)}
            onStagePreset={stagePresetForNextSession}
            onCopyMessage={copyMessage}
            onForkSession={forkSession}
            onOpenSessionPath={openSessionPath}
          />

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
            hasActiveSession={Boolean(activeSession)}
            loading={loading}
            composer={composer}
            attachments={attachments}
            promptMode={promptMode}
            candidates={composerCandidates}
            triggerKind={composerTrigger?.kind}
            candidatesDismissed={composerMenuDismissed}
            activeCandidateIndex={activeComposerCandidateIndex}
            models={models}
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
            workspaceLabel={presetDisplayName(activeSession?.agentPreset, presets) + " · " + (workspace || status.runtimeDirectory || "运行目录")}
            onComposerChange={(value) => {
              setComposer(value);
              setComposerMenuDismissed(false);
            }}
            onPaste={handleComposerPaste}
            onAddFiles={addComposerFiles}
            onRemoveAttachment={(attachmentId) => setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
            onSetPromptMode={setPromptMode}
            onChooseCandidate={chooseComposerCandidate}
            onSetCandidateIndex={setComposerCandidateIndex}
            onDismissCandidates={() => setComposerMenuDismissed(true)}
            onAction={handleComposerAction}
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

        {showInspector && (
          <div className="inspector-modal" role="dialog" aria-modal="true" aria-labelledby="inspector-title">
            <button className="inspector-backdrop" onClick={() => setShowInspector(false)} aria-label={surfaceTab === "settings" ? "关闭设置" : "关闭运行台"} />
            <aside className="inspector-panel">
            <div className="inspector-header"><strong id="inspector-title">{surfaceTab === "settings" ? "设置" : "DSH 运行台"}</strong><button onClick={() => setShowInspector(false)} title={surfaceTab === "settings" ? "关闭设置" : "关闭运行台"}>×</button></div>
            <nav className="surface-tabs" aria-label="DSH 功能面板">
              {(["runtime", "presets", "skills", "subagents", "goal", "settings"] as SurfaceTab[]).map((tab) => (
                <button className={surfaceTab === tab ? "selected" : ""} key={tab} onClick={() => void loadSurface(tab)} disabled={["skills", "subagents", "goal"].includes(tab) && !activeSessionId}>
                  {{ runtime: "运行时", presets: "Preset", skills: "Skills", subagents: "Subagent", goal: "Goal", settings: "设置" }[tab]}
                </button>
              ))}
            </nav>
            {surfaceLoading && <div className="surface-loading">正在读取 DSH 状态…</div>}

            {surfaceTab === "runtime" && <RuntimeSurfacePanel
              status={status}
              runtimeDetails={runtimeDetails}
              sessionStats={sessionStats}
              workspaceCount={workspaces.length}
              onAddWorkspace={addWorkspace}
            />}

            {surfaceTab === "presets" && <PresetSurfacePanel
              presets={presets}
              writable={settings?.writable}
              authorable={presetAuthorable}
              copy={presetCopy}
              view={presetView}
              onSetDefault={setDefaultPreset}
              onRead={readPreset}
              onOpenDocument={openPresetDocument}
              onBeginCopy={(id) => setPresetCopy({ from: id, id: "", name: "" })}
              onCopyChange={(patch) => setPresetCopy((current) => current ? { ...current, ...patch } : current)}
              onCopy={copyPreset}
              onCancelCopy={() => setPresetCopy(null)}
              onCloseView={() => setPresetView(null)}
              onRemove={removePreset}
            />}

            {surfaceTab === "skills" && <SkillsSurfacePanel
              skills={skills}
              onInsert={(skillName) => {
                setComposer(`/${skillName} `);
                setShowInspector(false);
              }}
            />}

            {surfaceTab === "subagents" && <SubagentsSurfacePanel
              subagents={subagents}
              session={subagentSession}
              composer={subagentComposer}
              onOpen={(entry) => openSubagent({ parentSessionId: activeSessionId!, childSessionId: entry.id, mode: entry.mode })}
              onCloseSession={() => setSubagentSession(null)}
              onComposerChange={setSubagentComposer}
              onPrompt={promptSubagent}
              onInterrupt={interruptSubagent}
            />}

            {surfaceTab === "goal" && <GoalSurfacePanel
              activeGoal={activeGoal}
              draft={goalDraft}
              onDraftChange={setGoalDraft}
              onMutate={mutateGoal}
              onCreate={createGoal}
            />}

            {surfaceTab === "settings" && (
              <div className="settings-layout">
                <nav className="settings-navigation" aria-label="设置分区">
                  <div className="settings-navigation-title">DSH 设置</div>
                  <button className={settingsSection === "appearance" ? "selected" : ""} onClick={() => setSettingsSection("appearance")}>
                    <strong>外观</strong><small>字体与背景</small>
                  </button>
                  <button className={settingsSection === "general" ? "selected" : ""} onClick={() => setSettingsSection("general")}>
                    <strong>通用</strong><small>会话与 Host</small>
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
                    fontPreset={appearanceFontPreset}
                    codeFontPreset={appearanceCodeFontPreset}
                    fontPresets={appearanceFontPresets}
                    codeFontPresets={appearanceCodeFontPresets}
                    fileInputRef={appearanceFileInputRef}
                    onUpdate={updateAppearance}
                    onBackgroundFile={handleBackgroundFile}
                    onThemeFile={handleThemeFile}
                    onReset={resetAppearance}
                  />}

                  {settingsSection === "general" && <SettingsGeneralPanel
                    settings={settings}
                    presets={presets}
                    workspace={workspace}
                    runtimeDirectory={status.runtimeDirectory}
                    sidebarWidth={sidebarWidth}
                    themeMode={themeMode}
                    pluginSettings={pluginSettings}
                    onOpenDocument={() => bridgeRequest("settings.openDocument").then(() => setNotice("已打开 DSH 配置文件")).catch((error) => setNotice(errorText(error)))}
                    onSetDefaultPreset={setDefaultPreset}
                    onAddWorkspace={addWorkspace}
                    onResetSidebar={() => setSidebarWidth(274)}
                    onThemeChange={setThemeMode}
                    onOpenNamespace={openSettingsNamespace}
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
                {settingsDraft && <div className="settings-json-panel"><div className="settings-json-heading"><strong>编辑 {settingsDraft.ns}</strong><button onClick={() => setSettingsDraft(null)} title="关闭编辑器" aria-label="关闭编辑器">×</button></div><p>仅修改公开字段；密钥和其他 Host 专属字段不会被覆盖。</p><textarea className="surface-code-input" value={settingsDraft.value} onChange={(event) => setSettingsDraft({ ...settingsDraft, value: event.target.value })} /><div className="surface-dialog-actions"><button onClick={() => setSettingsDraft(null)}>取消</button><button className="confirm" onClick={() => void saveSettings()}>保存</button></div></div>}
                {presetCopy && <div className="surface-dialog"><strong>复制 {presetCopy.from}</strong><input placeholder="新 Preset id" value={presetCopy.id} onChange={(event) => setPresetCopy({ ...presetCopy, id: event.target.value })} /><input placeholder="显示名称（可选）" value={presetCopy.name} onChange={(event) => setPresetCopy({ ...presetCopy, name: event.target.value })} /><div className="surface-dialog-actions"><button onClick={() => setPresetCopy(null)}>取消</button><button className="confirm" disabled={!presetCopy.id.trim()} onClick={() => void copyPreset()}>创建</button></div></div>}
                {presetView && <div className="surface-dialog"><strong>{presetView.id} / agent.cordis.yml</strong><pre className="surface-code">{presetView.content}</pre><button onClick={() => setPresetView(null)}>关闭</button></div>}
              </div>
            )}
            </aside>
          </div>
        )}
      {confirmAction && <div className="confirm-backdrop" onMouseDown={() => setConfirmAction(null)}><div className="confirm-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><strong>归档会话？</strong><p>“{displayTitle(confirmAction.session)}”将从会话列表中隐藏，历史记录会保留；当前桌面端不会显示归档会话。</p><div className="surface-dialog-actions"><button onClick={() => setConfirmAction(null)}>取消</button><button className="confirm danger-button" onClick={() => void archiveSession(confirmAction.session)}>确认归档</button></div></div></div>}
      </div>
    </main>
  );
}

export default App;
