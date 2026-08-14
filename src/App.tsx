import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { MarkdownContent } from "./lib/markdown";
import { TrajectoryView } from "./lib/trajectory";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  bridgeRequest,
  checkDsh,
  DshApiError,
  isTauri,
  listenToBridgeEvent,
  listenToDiagnostic,
  listenToRuntimeStatus,
  pickWorkspace,
  refreshDsh,
  type DshBridgeEvent,
  type DshGoalProjection,
  type DshHistoryEntry,
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
  type DshSessionEvent,
  type DshSessionModels,
  type DshSessionSummary,
  type DshStatus,
  type DshSubagentAddress,
  type DshSubagentCatalog,
  type DshWorkspace,
} from "./lib/desktop";

const demoStatus: DshStatus = {
  dshHome: "",
  runtimeDirectory: "",
  packageName: "@deepseek-ai/dsh@latest",
  runtimeAvailable: false,
  runtimeStarting: false,
  message: "浏览器预览模式",
};

type PromptMode = "queue" | "steer";
type ModelMenuPane = "root" | "model" | "effort";
type WindowMenu = "project" | "edit";
type SessionAction = "rename" | "fork" | "delete";
type SessionContextMenu = { session: DshSessionSummary; x: number; y: number };

type PendingApproval = {
  rpcId: string;
  sessionId: string;
  approvalId: string;
  toolName: string;
  reason?: string;
};

type PendingQuestion = {
  rpcId: string;
  sessionId: string;
  questions: DshQuestion[];
};

type TranscriptItem = {
  key: string;
  kind: "user" | "assistant" | "tool" | "system";
  label: string;
  text: string;
  time?: number;
  toolName?: string;
  toolCallId?: string;
  toolState?: "call" | "result";
  toolResultText?: string;
  toolResultTime?: number;
  toolResultError?: boolean;
  source?: string;
  contextRole?: "inject" | "recall";
  contextForm?: "instructions" | "catalog" | "snapshot" | "notice" | "relay" | "recall" | null;
  contextSummary?: string;
  injected?: boolean;
};

type SurfaceTab = "runtime" | "presets" | "skills" | "subagents" | "goal" | "settings";
type SettingsSection = "general" | "models" | "plugins";

type SettingsDraft = {
  ns: string;
  value: string;
  revision: number;
  original: unknown;
  secrets: string[][];
};

type GoalRef = { id: string; revision: number };

type DshHostModelCatalog = Pick<DshSessionModels, "groups" | "failures">;

type SessionStats = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  contextLimit: number;
  cacheHitRate: number;
  firstTokenMs: number;
  messages: number;
};

type ChildSubagentEntry = Extract<DshSubagentCatalog["entries"][number], { kind: "child" }>;

function projectName(path: string | undefined) {
  if (!path) return "未选择工作目录";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function subagentDisplayName(entry: ChildSubagentEntry, index: number) {
  return entry.label?.trim() || `子 Agent ${String(index + 1).padStart(2, "0")}`;
}

function subagentActivityLabel(activity: ChildSubagentEntry["activity"]) {
  return activity === "running" ? "运行中" : "已停止";
}

function subagentModeLabel(mode: ChildSubagentEntry["mode"]) {
  return mode === "continuable" ? "可继续" : "一次性";
}

function shortSubagentId(id: string) {
  return id.length > 24 ? `${id.slice(0, 10)}...${id.slice(-8)}` : id;
}

function formatClock(time?: number) {
  if (!time) return "";
  return new Date(time).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(time: number) {
  return new Date(time).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function displayTitle(session: DshSessionSummary) {
  const title = session.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title;
  return session.blank ? "新会话" : projectName(session.cwd) || session.sessionId;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (typeof block !== "object" || block === null) return "";
    const value = block as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") return value.text;
    if (value.type === "reasoning" && typeof value.text === "string") return value.text;
    if (value.type === "image") return "[图片]";
    if (value.type === "tool-call") return "";
    if (value.type === "tool-result") return textFromContent(value.content);
    return "";
  }).filter(Boolean).join("\n");
}

function eventContent(event: DshSessionEvent) {
  const data = event.data ?? {};
  if (event.type === "user/message") return textFromContent(data.content);
  if (event.type === "assistant/message" || event.type === "tool/result") {
    const message = data.message;
    if (message && typeof message === "object") {
      return textFromContent((message as Record<string, unknown>).content);
    }
    return textFromContent(data.content);
  }
  return "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readSessionStats(entries: DshHistoryEntry[], projections?: { values: Record<string, unknown> }): SessionStats {
  const values = projections?.values ?? {};
  const usage = (values.usage ?? values.tokenUsage ?? values.tokens) as Record<string, unknown> | undefined;
  let inputTokens = numberValue(usage?.inputTokens ?? usage?.input_tokens ?? values.inputTokens ?? values.input_tokens) ?? 0;
  let outputTokens = numberValue(usage?.outputTokens ?? usage?.output_tokens ?? values.outputTokens ?? values.output_tokens) ?? 0;
  const totalTokens = numberValue(usage?.totalTokens ?? usage?.total_tokens ?? values.totalTokens ?? values.total_tokens) ?? inputTokens + outputTokens;
  const contextTokens = numberValue(usage?.contextTokens ?? usage?.context_tokens ?? values.contextTokens ?? values.context_tokens) ?? totalTokens;
  const contextLimit = numberValue(usage?.contextLimit ?? usage?.context_limit ?? values.contextLimit ?? values.context_limit) ?? 0;
  const cacheRead = numberValue(usage?.cacheRead ?? usage?.cache_read ?? usage?.cachedInputTokens ?? values.cacheRead ?? values.cache_read) ?? 0;
  const cacheTotal = numberValue(usage?.cacheTotal ?? usage?.cache_total ?? values.cacheTotal ?? values.cache_total) ?? inputTokens;
  let firstTokenMs = numberValue(usage?.firstTokenMs ?? usage?.first_token_ms ?? usage?.ttft ?? values.firstTokenMs ?? values.first_token_ms ?? values.ttft) ?? 0;
  for (const { event } of entries) {
    const eventUsage = (event.data.usage ?? event.data.tokenUsage) as Record<string, unknown> | undefined;
    if (eventUsage) {
      const eventInput = numberValue(eventUsage.inputTokens ?? eventUsage.input_tokens);
      const eventOutput = numberValue(eventUsage.outputTokens ?? eventUsage.output_tokens);
      const eventFirstToken = numberValue(eventUsage.firstTokenMs ?? eventUsage.first_token_ms ?? eventUsage.ttft);
      if (eventFirstToken !== undefined) firstTokenMs = eventFirstToken;
      if (eventInput !== undefined) inputTokens = Math.max(inputTokens, eventInput);
      if (eventOutput !== undefined) outputTokens = Math.max(outputTokens, eventOutput);
    }
  }
  return { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens, contextTokens, contextLimit, cacheHitRate: cacheTotal > 0 ? Math.min(100, (cacheRead / cacheTotal) * 100) : 0, firstTokenMs, messages: entries.filter(({ event }) => event.type === "user/message" || event.type === "assistant/message").length };
}

function formatTokens(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

function contextPercent(stats: SessionStats) {
  if (!stats.contextLimit) return 0;
  return Math.min(100, Math.max(0, (stats.contextTokens / stats.contextLimit) * 100));
}

function eventToolName(event: DshSessionEvent) {
  const name = event.data?.name;
  return typeof name === "string" ? name : "tool";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function eventToolCallId(event: DshSessionEvent) {
  const data = event.data ?? {};
  const message = recordValue(data.message);
  const source = recordValue(message?.source);
  const content = Array.isArray(message?.content) ? recordValue(message.content[0]) : undefined;
  const callId = event.type === "tool/call"
    ? data.callId
    : source?.callId ?? content?.toolCallId;
  return typeof callId === "string" && callId ? callId : undefined;
}

function sourceLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = recordValue(value);
  if (!record) return undefined;
  for (const key of ["name", "title", "label", "path", "uri", "file", "document"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim();
  }
  return undefined;
}

function messageSource(event: DshSessionEvent): unknown {
  const data = event.data ?? {};
  if (data.source !== undefined) return data.source;
  return recordValue(data.message)?.source;
}

function sourceListLabel(value: unknown, key: string, field: string): string | undefined {
  const record = recordValue(value);
  const values = record?.[key];
  if (!Array.isArray(values)) return undefined;
  const labels = values.map((item) => sourceLabel(recordValue(item)?.[field])).filter((item): item is string => Boolean(item));
  return labels.length > 0 ? [...new Set(labels)].join(", ") : undefined;
}

function contextProvenance(source: unknown): { role: "inject" | "recall"; label?: string } {
  const record = recordValue(source);
  const kind = sourceLabel(record?.kind);
  if (!kind) return { role: "inject" };
  if (kind === "session-reference") return { role: "recall", label: sourceListLabel(source, "references", "label") ?? kind };
  if (kind === "agent-instructions") return { role: "inject", label: sourceListLabel(source, "changes", "path") ?? kind };
  if (kind === "plugin") return { role: "inject", label: sourceLabel(record?.plugin) ?? kind };
  if (kind === "skill-invocation") return { role: "inject", label: sourceLabel(record?.name) ?? kind };
  return { role: "inject", label: kind };
}

function contextForm(source: unknown): TranscriptItem["contextForm"] {
  const form = sourceLabel(recordValue(source)?.form);
  return form && ["instructions", "catalog", "snapshot", "notice", "relay", "recall"].includes(form)
    ? form as NonNullable<TranscriptItem["contextForm"]>
    : null;
}

function contextSummary(source: unknown, form: TranscriptItem["contextForm"]): string | undefined {
  if (form !== "notice") return undefined;
  return sourceLabel(recordValue(source)?.summary);
}

function isInjectedMessage(event: DshSessionEvent) {
  const source = messageSource(event);
  const kind = sourceLabel(recordValue(source)?.kind);
  // Web UI treats the durable source as the authority: only kind=user is a
  // human-authored prompt; injected context and unknown producer kinds remain context rows.
  return source !== undefined && kind !== "user";
}

function eventToolText(event: DshSessionEvent) {
  const data = event.data ?? {};
  if (event.type === "tool/call") {
    const args = data.arguments;
    if (typeof args === "string") return args;
    if (args !== undefined) return JSON.stringify(args, null, 2);
  }
  return eventContent(event) || (data.isError ? "工具返回错误" : "工具已完成");
}

function eventToolResultError(event: DshSessionEvent) {
  if (event.type !== "tool/result") return false;
  const data = event.data ?? {};
  const nested = [recordValue(data.result), recordValue(data.output), recordValue(data.value)].filter((value): value is Record<string, unknown> => Boolean(value));
  const candidates = [data, ...nested];
  return candidates.some((value) => {
    const status = String(value.status ?? value.state ?? "").toLowerCase();
    return value.isError === true
      || value.ok === false
      || value.success === false
      || value.error !== undefined
      || value.exception !== undefined
      || ["error", "failed", "failure", "cancelled", "canceled", "rejected"].includes(status);
  });
}

function transcriptFromHistory(entries: DshHistoryEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const entry of entries) {
    const event = entry.event;
    if ((event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result")
      && event.surfaceOp !== undefined && event.surfaceOp !== "append") continue;
    if (event.type === "user/message") {
      const text = eventContent(event);
      if (text) {
        const injected = isInjectedMessage(event);
        const source = injected ? messageSource(event) : undefined;
        const provenance = injected ? contextProvenance(source) : undefined;
        const form = injected ? contextForm(source) : undefined;
        items.push({
          key: `event-${event.seq}`,
          kind: injected ? "system" : "user",
          label: injected ? (provenance?.role === "recall" ? "跨会话召回" : "上下文注入") : "你",
          text,
          time: event.time,
          source: provenance?.label,
          contextRole: provenance?.role,
          contextForm: form,
          contextSummary: contextSummary(source, form),
          injected,
        });
      }
      continue;
    }
    if (event.type === "assistant/message") {
      const text = eventContent(event);
      if (text) items.push({ key: `event-${event.seq}`, kind: "assistant", label: "DSH", text, time: event.time });
      continue;
    }
    if (event.type === "tool/call" || event.type === "tool/result") {
      items.push({
        key: `event-${event.seq}`,
        kind: "tool",
        label: eventToolName(event),
        text: eventToolText(event),
        time: event.time,
        toolName: eventToolName(event),
        toolCallId: eventToolCallId(event),
        toolState: event.type === "tool/call" ? "call" : "result",
        toolResultError: eventToolResultError(event),
      });
      continue;
    }
    if (event.type === "turn/end") {
      const reason = event.data?.reason;
      const reasonKind = reason && typeof reason === "object"
        ? (reason as Record<string, unknown>).kind
        : undefined;
      if (reasonKind && reasonKind !== "completed") {
        items.push({ key: `event-${event.seq}`, kind: "system", label: "回合结束", text: String(reasonKind), time: event.time });
      }
      continue;
    }
    if (event.type === "compaction/summary") {
      items.push({ key: `event-${event.seq}`, kind: "system", label: "上下文", text: "已整理对话上下文", time: event.time });
    }
  }
  // Pair by the runtime call id; completion order is not guaranteed for parallel tools.
  const paired: TranscriptItem[] = [];
  const pendingCalls = new Map<string, number>();
  const pendingCallsWithoutId: number[] = [];
  const pendingResults = new Map<string, TranscriptItem>();
  const pendingResultsWithoutId: TranscriptItem[] = [];
  for (const item of items) {
    if (item.kind !== "tool") {
      paired.push(item);
      continue;
    }
    if (item.toolState === "call") {
      const result = item.toolCallId
        ? pendingResults.get(item.toolCallId)
        : pendingResultsWithoutId.shift();
      if (result) {
        if (item.toolCallId) pendingResults.delete(item.toolCallId);
        paired.push({ ...item, toolResultText: result.text, toolResultTime: result.time, toolResultError: result.toolResultError });
      } else {
        if (item.toolCallId) pendingCalls.set(item.toolCallId, paired.length);
        else pendingCallsWithoutId.push(paired.length);
        paired.push(item);
      }
      continue;
    }
    const callIndex = item.toolCallId
      ? pendingCalls.get(item.toolCallId)
      : pendingCallsWithoutId.shift();
    if (callIndex !== undefined) {
      if (item.toolCallId) pendingCalls.delete(item.toolCallId);
      const call = paired[callIndex];
      paired[callIndex] = { ...call, toolResultText: item.text, toolResultTime: item.time, toolResultError: item.toolResultError };
    } else if (item.toolCallId) {
      pendingResults.set(item.toolCallId, item);
    } else {
      pendingResultsWithoutId.push(item);
    }
  }
  return paired;
}

function errorText(error: unknown) {
  if (error instanceof DshApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function jsonText(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("设置内容必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function settingsOps(
  original: unknown,
  next: unknown,
  path: string[],
  secrets: string[][],
): Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> {
  const secretAt = secrets.some((secret) => secret.length === path.length && secret.every((part, index) => part === path[index]));
  if (secretAt) return [];
  if (sameJson(original, next)) return [];
  if (typeof original === "object" && original !== null && !Array.isArray(original)
    && typeof next === "object" && next !== null && !Array.isArray(next)) {
    const oldObject = original as Record<string, unknown>;
    const newObject = next as Record<string, unknown>;
    const keys = new Set([...Object.keys(oldObject), ...Object.keys(newObject)]);
    return [...keys].flatMap((key) => {
      const childPath = [...path, key];
      const secretDescendant = secrets.some((secret) => secret.slice(0, childPath.length).every((part, index) => part === childPath[index]));
      if (!(key in newObject)) return secretDescendant ? [] : [{ op: "unset", path: childPath }];
      if (!(key in oldObject) && !secretDescendant) return [{ op: "set", path: childPath, value: newObject[key] }];
      return settingsOps(oldObject[key], newObject[key], childPath, secrets);
    });
  }
  return path.length > 0 ? [{ op: "set", path, value: next }] : [];
}

function runtimeLabel(status: DshStatus) {
  if (status.runtimeStarting) return "启动中";
  if (status.runtimeAvailable) return "已连接";
  return "未连接";
}

function pluginDisplayName(moduleName: string) {
  return (moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName)
    .replace(/^cordis:/, "")
    .replace(/^cordis-plugin-/, "")
    .replace(/^dsh-(?:host-|client-)?/, "");
}

function pluginPhaseLabel(phase: DshPluginInventoryEntry["fiberPhase"]) {
  if (phase === "pending") return "等待加载";
  if (phase === "loading") return "加载中";
  if (phase === "active") return "运行中";
  if (phase === "failed") return "加载失败";
  if (phase === "unloading") return "卸载中";
  return "未观测";
}

function isWindowChromeControl(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest("button, input, select, textarea, a, .window-menu, .window-actions"));
}

function sessionIsVisible(session: DshSessionSummary, workspace: string, query: string) {
  // Subagent sessions are shown through the Subagent surface instead.
  if (session.blank || session.origin === "subagent" || session.parentSessionId) return false;
  if (workspace && session.cwd !== workspace) return false;
  if (!query) return true;
  const haystack = `${displayTitle(session)} ${session.cwd ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function App() {
  const desktop = isTauri();
  const [status, setStatus] = useState<DshStatus>(demoStatus);
  const [sessions, setSessions] = useState<DshSessionSummary[]>([]);
  const [sessionIndicators, setSessionIndicators] = useState<Record<string, "idle" | "running" | "completed" | "error">>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<DshHistoryEntry[]>([]);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [composer, setComposer] = useState("");
  const [promptMode, setPromptMode] = useState<PromptMode>("queue");
  const [notice, setNotice] = useState("准备连接 DSH");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteSearchIds, setRemoteSearchIds] = useState<string[] | null>(null);
  const [models, setModels] = useState<DshSessionModels | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPane, setModelMenuPane] = useState<ModelMenuPane>("root");
  const [sessionStats, setSessionStats] = useState<SessionStats>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, firstTokenMs: 0, messages: 0 });
  const [presets, setPresets] = useState<DshPreset[]>([]);
  const [presetAuthorable, setPresetAuthorable] = useState(false);
  const [presetHasDocument, setPresetHasDocument] = useState(false);
  const [nextPreset, setNextPreset] = useState("");
  const [workspaces, setWorkspaces] = useState<DshWorkspace[]>([]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runtimeDetails, setRuntimeDetails] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<DshProvider[]>([]);
  const [hostModels, setHostModels] = useState<DshHostModelCatalog | null>(null);
  const [pluginInventory, setPluginInventory] = useState<DshPluginInventoryEntry[] | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [windowMenu, setWindowMenu] = useState<WindowMenu | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [surfaceTab, setSurfaceTab] = useState<SurfaceTab>("runtime");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [skills, setSkills] = useState<DshSkill[]>([]);
  const [subagents, setSubagents] = useState<DshSubagentCatalog | null>(null);
  const [subagentPanelOpen, setSubagentPanelOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [subagentLoadingId, setSubagentLoadingId] = useState<string | null>(null);
  const [subagentLoadError, setSubagentLoadError] = useState<string | null>(null);
  const [subagentSession, setSubagentSession] = useState<{ address: DshSubagentAddress; history: DshHistoryEntry[] } | null>(null);
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
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string[]>>({});
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenu | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: SessionAction; session: DshSessionSummary } | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const selectedSubagentRef = useRef<string | null>(null);
  const subagentRequestRef = useRef(0);
  const creatingSessionRef = useRef<Promise<string> | null>(null);
  const activeSession = sessions.find((session) => session.sessionId === activeSessionId);
  const activeRunning = Boolean(activeSession?.running);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    selectedSubagentRef.current = selectedSubagentId;
  }, [selectedSubagentId]);

  useEffect(() => {
    setModelMenuOpen(false);
    setModelMenuPane("root");
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
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void appWindow.isMaximized().then(setWindowMaximized).catch(() => undefined);
    void appWindow.onResized(() => {
      void appWindow.isMaximized().then(setWindowMaximized).catch(() => undefined);
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, [desktop]);

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

  useEffect(() => {
    if (!windowMenu) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".window-menu")) {
        setWindowMenu(null);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setWindowMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [windowMenu]);

  const transcript = useMemo(() => transcriptFromHistory(history), [history]);
  const subagentTranscript = useMemo(() => subagentSession ? transcriptFromHistory(subagentSession.history) : [], [subagentSession]);
  const visibleSessions = useMemo(() => {
    const remoteIds = remoteSearchIds ? new Set(remoteSearchIds) : undefined;
    return sessions.filter((session) => {
      if (!sessionIsVisible(session, workspace, remoteSearchIds ? "" : search)) return false;
      return remoteIds ? remoteIds.has(session.sessionId) : true;
    });
  }, [remoteSearchIds, search, sessions, workspace]);
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
  const subagentCount = childSubagents.length;
  const selectedSubagentIndex = childSubagents.findIndex((entry) => entry.id === selectedSubagentId);
  const selectedSubagent = selectedSubagentIndex >= 0 ? childSubagents[selectedSubagentIndex] : undefined;
  const providerNamespaces = useMemo(() => new Set(providers.map((provider) => provider.settingsNs)), [providers]);
  const pluginSettings = useMemo(() => (settings?.namespaces ?? []).filter((namespace) => !providerNamespaces.has(namespace.ns) && !["locale", "permission", "ui-conversation", "ui-theme", "ui-onboarding"].includes(namespace.ns)), [providerNamespaces, settings]);
  const visiblePlugins = useMemo(() => {
    const query = pluginSearch.trim().toLocaleLowerCase();
    return (pluginInventory ?? []).filter((plugin) => !query || `${plugin.entryId} ${plugin.moduleName}`.toLocaleLowerCase().includes(query));
  }, [pluginInventory, pluginSearch]);

  async function loadSessions(selectFirst = false): Promise<DshSessionSummary[] | undefined> {
    if (!desktop) return undefined;
    const result = await bridgeRequest<{ items: DshSessionSummary[] }>("session.list");
    const unique = [...new Map(result.items.filter((session) => session.sessionId).map((session) => [session.sessionId, session])).values()];
    setSessions(unique);
    if (selectFirst && !activeSessionRef.current) {
      const next = unique.find((session) => !session.blank);
      if (next) await openSession(next);
    }
    return result.items;
  }

  async function loadRuntimeDetails() {
    if (!desktop) return;
    const [hostResult, presetResult, workspaceResult, settingsResult, providerResult, modelResult, pluginResult] = await Promise.allSettled([
      bridgeRequest<Record<string, unknown>>("host.describe"),
      bridgeRequest<DshPresetRoster>("agentPreset.list"),
      bridgeRequest<{ items: DshWorkspace[] }>("workspace.list"),
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
    if (workspaceResult.status === "fulfilled") setWorkspaces(workspaceResult.value.items);
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
    void loadSubagents();
  }, [activeSessionId]);

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

  async function selectPresetForNextSession(id: string) {
    setNextPreset(id);
    if (!activeSessionId) {
      setNotice(`新会话将使用 ${id}`);
      return;
    }
    const current = activeSession;
    if (!current?.blank) {
      setNotice("会话已经开始，不能切换 Agent Preset");
      return;
    }
    try {
      await bridgeRequest("agentPreset.select", { sessionId: activeSessionId, agentPreset: id });
      setSessions((items) => items.map((item) => item.sessionId === activeSessionId ? { ...item, agentPreset: id } : item));
      setNotice(`已切换到 ${id}`);
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
    if (!presetCopy || !presetCopy.id.trim()) return;
    try {
      await bridgeRequest("agentPreset.copy", {
        from: presetCopy.from,
        agentPreset: presetCopy.id.trim(),
        ...(presetCopy.name.trim() ? { name: presetCopy.name.trim() } : {}),
      });
      setPresetCopy(null);
      await loadRuntimeDetails();
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
    setTrajectoryOpen(false);
    setQueue([]);
    setApproval(null);
    setQuestion(null);
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
        bridgeRequest<{ events: DshHistoryEntry[]; projections?: { values: Record<string, unknown> } }>("session.history", {
          sessionId: session.sessionId,
          maxMessages: 100,
        }),
        bridgeRequest<DshSessionModels>("session.models", { sessionId: session.sessionId }),
      ]);
      setHistory(historyResult.events);
      setSessionStats(readSessionStats(historyResult.events, historyResult.projections));
      setGoal((historyResult.projections?.values.goal as DshGoalProjection | null | undefined) ?? null);
      setModels(modelsResult);
      setNotice(modelsResult.routable ? "会话已打开" : "当前模型路由不可用");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setLoading(false);
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
      setNotice(errorText(error));
    }
  }

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
    void listenToDiagnostic((message) => setNotice(message)).then((unlisten) => { cleanups.push(unlisten); });
    void listenToBridgeEvent(handleBridgeEvent).then((unlisten) => { cleanups.push(unlisten); });
    void boot();
    return () => { cleanups.forEach((cleanup) => cleanup?.()); };
  }, [desktop]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "auto" });
  }, [history, loading]);

  function handleBridgeEvent(event: DshBridgeEvent) {
    const payload = event.frame.payload;
    const type = payload.type;
    if (event.channel === "mux") {
      if (type === "session/event") {
        const sessionId = String(payload.sessionId ?? "");
        const nextEvent = payload.event as DshSessionEvent | undefined;
        if (!nextEvent) return;
        if (sessionId === activeSessionRef.current) {
          setHistory((current) => {
            const next = current.some((entry) => entry.event.seq === nextEvent.seq)
              ? current
              : [...current, { event: nextEvent, view: payload.view }];
            if (next.length !== current.length) setSessionStats(readSessionStats(next));
            return next;
          });
          if (nextEvent.type === "user/message") {
            setSessions((current) => current.map((session) => session.sessionId === sessionId
              ? { ...session, blank: false, updatedAt: nextEvent.time }
              : session));
          }
        }
        if (sessionId === selectedSubagentRef.current) {
          setSubagentSession((current) => {
            if (!current || current.address.childSessionId !== sessionId || current.history.some((entry) => entry.event.seq === nextEvent.seq)) return current;
            return { ...current, history: [...current.history, { event: nextEvent, view: payload.view }] };
          });
        }
        return;
      }
      if (type === "session/projection") {
        const sessionId = String(payload.sessionId ?? "");
        const key = String(payload.key ?? "");
        if (key === "goal" && sessionId === activeSessionRef.current) {
          setGoal((payload.value as DshGoalProjection | null | undefined) ?? null);
          return;
        }
        if (key !== "title") return;
        setSessions((current) => current.map((session) => session.sessionId === sessionId
          ? {
            ...session,
            projections: {
              asOfSeq: Number(payload.seq ?? session.projections?.asOfSeq ?? 0),
              values: { ...session.projections?.values, title: payload.value },
            },
          }
          : session));
        return;
      }
      if (type === "session/queue") {
        if (String(payload.sessionId) === activeSessionRef.current) setQueue((payload.items as DshQueueItem[]) ?? []);
        return;
      }
      if (type === "approval/requested") {
        const sessionId = String(payload.sessionId ?? "");
        if (sessionId !== activeSessionRef.current || !event.frame.rpcId) return;
        setApproval({
          rpcId: event.frame.rpcId,
          sessionId,
          approvalId: String(payload.approvalId ?? ""),
          toolName: String(payload.toolName ?? "tool"),
          reason: typeof payload.reason === "string" ? payload.reason : undefined,
        });
        return;
      }
      if (type === "approval/resolved" && String(payload.sessionId) === activeSessionRef.current) {
        setApproval(null);
        return;
      }
      if (type === "question/requested") {
        const sessionId = String(payload.sessionId ?? "");
        if (sessionId !== activeSessionRef.current || !event.frame.rpcId) return;
        setQuestion({
          rpcId: event.frame.rpcId,
          sessionId,
          questions: (payload.questions as DshQuestion[]) ?? [],
        });
        setQuestionAnswers({});
        return;
      }
      if (type === "question/resolved" && String(payload.sessionId) === activeSessionRef.current) {
        setQuestion(null);
        setQuestionAnswers({});
      }
      return;
    }
    if (type === "host/session-status") {
      const sessionId = String(payload.sessionId ?? "");
      const running = Boolean(payload.running);
      setSessions((current) => current.map((session) => session.sessionId === sessionId ? { ...session, running } : session));
      setSessionIndicators((current) => ({ ...current, [sessionId]: running ? "running" : "completed" }));
      setSubagents((current) => current ? {
        ...current,
        entries: current.entries.map((entry) => entry.kind === "child" && entry.id === sessionId
          ? { ...entry, activity: running ? "running" : "inactive" }
          : entry),
      } : current);
      return;
    }
    if (type === "host/session-added") {
      const sessionId = String(payload.sessionId ?? "");
      setSessions((current) => current.some((session) => session.sessionId === sessionId)
        ? current
        : [...current, {
          sessionId,
          updatedAt: Date.now(),
          running: false,
          blank: Boolean(payload.blank),
          parentSessionId: typeof payload.parentSessionId === "string" ? payload.parentSessionId : undefined,
          origin: payload.origin === "subagent" ? "subagent" : undefined,
          cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
          agentPreset: typeof payload.agentPreset === "string" ? payload.agentPreset : undefined,
        }]);
      if (String(payload.parentSessionId ?? "") === activeSessionRef.current || payload.origin === "subagent") void loadSubagents();
      return;
    }
    if (type === "host/session-removed") {
      const sessionId = String(payload.sessionId ?? "");
      setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
      setSubagents((current) => current ? { ...current, entries: current.entries.filter((entry) => entry.id !== sessionId) } : current);
      if (sessionId === selectedSubagentRef.current) {
        subagentRequestRef.current += 1;
        setSelectedSubagentId(null);
        setSubagentLoadingId(null);
        setSubagentSession(null);
        setSubagentPanelOpen(false);
      }
      if (sessionId === activeSessionRef.current) startNewSession();
      return;
    }
    if (type === "host/agent-error") {
      const sessionId = String(payload.sessionId ?? "");
      setSessionIndicators((current) => ({ ...current, [sessionId]: "error" }));
      if (sessionId === activeSessionRef.current) setNotice(String(payload.message ?? "Agent 运行失败"));
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

  function startNewSession() {
    activeSessionRef.current = null;
    setActiveSessionId(null);
    setHistory([]);
    setTrajectoryOpen(false);
    setComposer("");
    setModels(null);
    setSessionStats({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, contextLimit: 0, cacheHitRate: 0, firstTokenMs: 0, messages: 0 });
    setQueue([]);
    setApproval(null);
    setQuestion(null);
    setGoal(undefined);
    subagentRequestRef.current += 1;
    setSubagents(null);
    setSubagentSession(null);
    setSelectedSubagentId(null);
    setSubagentLoadingId(null);
    setSubagentLoadError(null);
    setSubagentPanelOpen(false);
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
    void bridgeRequest<DshSessionModels>("session.models", { sessionId: created.sessionId })
      .then(setModels)
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
    if (!text || loading || !status.runtimeAvailable) return;
    setLoading(true);
    setNotice(promptMode === "steer" ? "正在插入当前回合" : "正在发送");
    try {
      const sessionId = await ensureSession();
      await bridgeRequest("session.prompt", {
        sessionId,
        mode: promptMode,
        content: [{ type: "text", text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setComposer("");
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

  async function forkSession(sessionId: string = activeSessionId ?? "") {
    if (!sessionId) return;
    try {
      const result = await bridgeRequest<{ sessionId: string }>("session.fork", { sessionId });
      const nextSessions = await loadSessions();
      const forked = nextSessions?.find((session) => session.sessionId === result.sessionId);
      if (forked) await openSession(forked);
      else setNotice("已创建分叉会话");
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function deleteSession(session: DshSessionSummary) {
    try {
      await bridgeRequest("session.delete", { sessionId: session.sessionId });
      setConfirmAction(null);
      await loadSessions();
      if (session.sessionId === activeSessionRef.current) startNewSession();
      setNotice("会话已删除");
    } catch (error) { setNotice(errorText(error)); }
  }

  function requestSessionAction(action: SessionAction, session: DshSessionSummary) {
    setSessionContextMenu(null);
    if (action === "delete") { setConfirmAction({ action, session }); return; }
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
      setModels((current) => current ? { ...current, current: { ...current.current, provider, model, reasoningEffort: undefined } } : current);
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
      setNotice(errorText(error));
    }
  }

  async function searchSessions() {
    const query = search.trim();
    if (!query) {
      setRemoteSearchIds(null);
      return;
    }
    try {
      const result = await bridgeRequest<{ items: Array<{ sessionId: string }> }>("session.search", { query });
      setRemoteSearchIds(result.items.map((item) => item.sessionId));
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function respondToApproval(outcome: "allowed-once" | "rejected") {
    if (!approval) return;
    try {
      await bridgeRequest("respond", {
        type: "client-response",
        rpcId: approval.rpcId,
        result: {
          ok: true,
          value: { sessionId: approval.sessionId, approvalId: approval.approvalId, outcome },
        },
      });
      setApproval(null);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function toggleQuestionAnswer(questionId: string, value: string, multiSelect: boolean | undefined) {
    setQuestionAnswers((current) => {
      const previous = current[questionId] ?? [];
      if (!multiSelect) return { ...current, [questionId]: [value] };
      return {
        ...current,
        [questionId]: previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value],
      };
    });
  }

  async function respondToQuestion() {
    if (!question) return;
    const answer = {
      answers: question.questions.map((item) => ({ id: item.id, selected: questionAnswers[item.id] ?? [] })),
    };
    try {
      await bridgeRequest("respond", {
        type: "client-response",
        rpcId: question.rpcId,
        result: { ok: true, value: { sessionId: question.sessionId, answer } },
      });
      setQuestion(null);
      setQuestionAnswers({});
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function cancelQuestion() {
    if (!question) return;
    try {
      await bridgeRequest("respond", {
        type: "client-response",
        rpcId: question.rpcId,
        result: {
          ok: false,
          error: { code: "cancelled", message: "用户取消了问题", details: {} },
        },
      });
      setQuestion(null);
      setQuestionAnswers({});
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleComposerAction();
    }
  }

  async function startWindowDrag(event: MouseEvent<HTMLElement>) {
    if (!desktop || event.button !== 0 || isWindowChromeControl(event.target)) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function toggleWindowMaximize() {
    if (!desktop) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setWindowMaximized(await appWindow.isMaximized());
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function minimizeWindow() {
    if (!desktop) return;
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function closeWindow() {
    if (!desktop) return;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function runEditCommand(command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll") {
    if (desktop) document.execCommand(command);
    setWindowMenu(null);
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
    setWindowMenu(null);
    setSettingsSection("general");
    setSurfaceTab("settings");
    setShowInspector(true);
    void loadSurface("settings");
  }

  return (
    <main className="app-shell">
      <header
        className="window-bar"
        onMouseDown={(event) => void startWindowDrag(event)}
        onDoubleClick={(event) => { if (!isWindowChromeControl(event.target)) void toggleWindowMaximize(); }}
      >
        <div className="brand-mark">DSH <span>DESKTOP</span></div>
        <nav className="window-menu" aria-label="应用菜单">
          <div className="window-menu-group">
            <button className={`window-menu-button ${windowMenu === "project" ? "selected" : ""}`} onClick={() => setWindowMenu((current) => current === "project" ? null : "project")}>项目</button>
            {windowMenu === "project" && <div className="window-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => { setWindowMenu(null); void addWorkspace(); }}>选择工作目录...</button>
              <button role="menuitem" onClick={() => { setWindowMenu(null); chooseWorkspace(""); }}>使用 DSH 运行目录</button>
              <div className="window-menu-separator" />
              <button role="menuitem" onClick={() => { setWindowMenu(null); void restartRuntime(); }}>重新启动 DSH</button>
              <div className="window-menu-separator" />
              <button role="menuitem" onClick={() => { setWindowMenu(null); void closeWindow(); }}>关闭窗口</button>
            </div>}
          </div>
          <div className="window-menu-group">
            <button className={`window-menu-button ${windowMenu === "edit" ? "selected" : ""}`} onClick={() => setWindowMenu((current) => current === "edit" ? null : "edit")}>编辑</button>
            {windowMenu === "edit" && <div className="window-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runEditCommand("undo")}>撤销</button>
              <button role="menuitem" onClick={() => runEditCommand("redo")}>重做</button>
              <div className="window-menu-separator" />
              <button role="menuitem" onClick={() => runEditCommand("cut")}>剪切</button>
              <button role="menuitem" onClick={() => runEditCommand("copy")}>复制</button>
              <button role="menuitem" onClick={() => runEditCommand("paste")}>粘贴</button>
              <button role="menuitem" onClick={() => runEditCommand("selectAll")}>全选</button>
            </div>}
          </div>
        </nav>
        <div className="window-context" title={workspace || status.runtimeDirectory}>
          <span className="context-dot" />
          <strong>{projectName(workspace || activeSession?.cwd)}</strong>
          <span>{workspace || "DSH 运行目录"}</span>
        </div>
        <div className="window-drag-space" />
        <div className="window-actions">
          <span className={`runtime-state ${status.runtimeAvailable ? "ready" : ""}`}>
            <i /> {runtimeLabel(status)}
          </span>
          <button className={`settings-button ${showInspector && surfaceTab === "settings" ? "selected" : ""}`} onClick={openSettings} title="打开设置" aria-label="打开设置">⚙</button>
          <div className="window-controls" aria-label="窗口控制">
            <button className="window-control minimize" onClick={() => void minimizeWindow()} title="最小化" aria-label="最小化"><span className="window-control-glyph" aria-hidden="true" /></button>
            <button className={`window-control ${windowMaximized ? "restore" : "maximize"}`} onClick={() => void toggleWindowMaximize()} title={windowMaximized ? "还原" : "最大化"} aria-label={windowMaximized ? "还原" : "最大化"}><span className="window-control-glyph" aria-hidden="true" /></button>
            <button className="window-control close" onClick={() => void closeWindow()} title="关闭" aria-label="关闭"><span className="window-control-glyph" aria-hidden="true" /></button>
          </div>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="session-sidebar">
          <div className="sidebar-actions">
            <button className="new-session-button" onClick={startNewSession}>
              <span aria-hidden="true">+</span> 新会话
            </button>
            <button className="small-icon-button" onClick={() => void addWorkspace()} title="添加工作目录" aria-label="添加工作目录">⌂</button>
          </div>
          <div className="search-box">
            <span aria-hidden="true">/</span>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setRemoteSearchIds(null); }}
              onKeyDown={(event) => { if (event.key === "Enter") void searchSessions(); }}
              placeholder="搜索会话"
              aria-label="搜索会话"
            />
            {search && <button onClick={() => { setSearch(""); setRemoteSearchIds(null); }} title="清除搜索">×</button>}
          </div>

          <div className="sidebar-heading">
            <span>会话</span>
            <span>{visibleSessions.length || ""}</span>
          </div>
          <div className="session-list" aria-label="会话列表">
            {visibleSessions.length === 0 ? (
              <div className="sidebar-empty">没有已开始的会话</div>
            ) : visibleSessions.map((session) => (
              <div className={`session-row ${session.sessionId === activeSessionId ? "active" : ""}`} key={session.sessionId} onContextMenu={(event) => { event.preventDefault(); setSessionContextMenu({ session, x: event.clientX, y: event.clientY }); }}>
                <button className="session-row-main" onClick={() => void openSession(session)}>
                  <span className={`session-indicator ${sessionIndicators[session.sessionId] ?? (session.running ? "running" : "")}`} /><span className="session-row-copy"><strong>{displayTitle(session)}</strong><small>{formatDate(session.updatedAt)}{session.cwd ? ` · ${projectName(session.cwd)}` : ""}</small></span>
                </button>
                <button className="session-row-trigger" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setSessionContextMenu({ session, x: rect.right - 160, y: rect.bottom + 4 }); }} aria-label="会话操作" title="会话操作">▸</button>
              </div>
            ))}
          </div>

          {sessionContextMenu && <div className="session-context-menu" style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
            <button role="menuitem" onClick={() => requestSessionAction("rename", sessionContextMenu.session)}>重命名</button>
            <button role="menuitem" onClick={() => requestSessionAction("fork", sessionContextMenu.session)}>分叉会话</button>
            <button className="danger" role="menuitem" onClick={() => requestSessionAction("delete", sessionContextMenu.session)}>删除会话</button>
          </div>}

          <div className="sidebar-bottom">
            <div className="workspace-picker">
              <button className="workspace-line" onClick={() => setWorkspaceMenuOpen((value) => !value)} title={workspace || "选择工作目录"} aria-expanded={workspaceMenuOpen}>
                <span className="line-icon">⌂</span>
                <span><strong>{workspace ? projectName(workspace) : "工作目录"}</strong><small>{workspace || "新会话使用运行目录"}</small></span>
                <span className="line-arrow">⌄</span>
              </button>
              {workspaceMenuOpen && (
                <div className="workspace-menu" role="menu">
                  <button className={!workspace ? "selected" : ""} onClick={() => chooseWorkspace("")} role="menuitem">DSH 运行目录</button>
                  {workspaces.map((item) => (
                    <button key={item.workspaceId} className={workspace === item.path ? "selected" : ""} onClick={() => chooseWorkspace(item.path)} role="menuitem" title={item.path}>
                      <strong>{item.title || projectName(item.path)}</strong><small>{item.path}</small>
                    </button>
                  ))}
                  <button className="workspace-add" onClick={() => void addWorkspace()} role="menuitem">＋ 添加工作目录</button>
                </div>
              )}
            </div>
            <div className="sidebar-footnote"><span className={status.runtimeAvailable ? "online" : ""} />DSH {runtimeLabel(status)}</div>
          </div>
        </aside>

        <section className="conversation-panel">
          <header className="conversation-header">
            <div className="conversation-heading">
              {renaming ? (
                <form onSubmit={(event) => { event.preventDefault(); void renameSession(); }}>
                  <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus aria-label="会话名称" />
                </form>
              ) : (
                <button
                  className="conversation-title"
                  onDoubleClick={() => { if (activeSession) { setRenameValue(displayTitle(activeSession)); setRenaming(true); } }}
                  title={activeSession ? "双击重命名会话" : "输入消息后创建会话"}
                >
                  {activeSession ? displayTitle(activeSession) : "新会话"}
                </button>
              )}
              <span className="conversation-subtitle">{activeSession?.agentPreset ?? "standard"} · {activeSession?.cwd || status.runtimeDirectory || "等待运行目录"}</span>
            </div>
            <div className="conversation-actions">
              {queue.length > 0 && <span className="queue-count">排队 {queue.length}</span>}
              {activeSession && <button className={`header-action trajectory-toggle${trajectoryOpen ? " selected" : ""}`} onClick={() => setTrajectoryOpen((open) => !open)} title="查看当前会话轨迹" aria-pressed={trajectoryOpen}>轨迹</button>}
              {activeSession && <button className="header-action" onClick={() => void forkSession()} title="从当前会话分叉">分叉</button>}
            </div>
          </header>

          <div className="transcript" aria-live={trajectoryOpen ? undefined : "polite"}>
            {trajectoryOpen ? (
              <TrajectoryView entries={history} active={activeRunning || loading} />
            ) : transcript.length === 0 && !loading ? (
              <div className="empty-conversation">
                <div className="empty-mark">DSH</div>
                <h1>{activeSession ? "继续这个会话" : "开始一个会话"}</h1>
                <p>{activeSession ? "历史消息会在这里继续，输入下一条指令即可。" : "消息会在发送时创建 DSH 会话。"}</p>
                <div className="empty-meta"><span>{workspace || status.runtimeDirectory || "运行目录"}</span><span>{models?.current.model ?? "默认模型"}</span></div>
              </div>
            ) : (
              <div className="transcript-inner">
                {transcript.map((item) => (
                  <article className={`message-row ${item.kind}${item.injected ? " context-row" : ""}${item.kind === "tool" ? " tool-row" : ""}`} key={item.key}>
                    {item.kind !== "tool" && <div className="message-gutter"><span>{item.label}</span><time>{formatClock(item.time)}</time></div>}
                    <div className="message-content">
                      {item.kind === "tool" ? (
                        <details className={`tool-entry ${item.toolResultText !== undefined ? "tool-paired" : ""} ${item.toolResultError ? "tool-error" : ""}`}>
                          <summary><span className="tool-state" />{item.toolName}{(item.toolResultText !== undefined || item.toolState === "result") && <em>{item.toolResultError ? "异常" : "已返回"}</em>}</summary>
                          <div className="tool-parts">
                            <div className="tool-part tool-call-part"><pre>{item.text}</pre></div>
                            {item.toolResultText !== undefined && <div className={`tool-part tool-result-part ${item.toolResultError ? "tool-result-error" : ""}`}><span className="tool-part-label">结果 <time>{formatClock(item.toolResultTime)}</time></span><pre>{item.toolResultText}</pre></div>}
                          </div>
                        </details>
                      ) : item.injected ? (
                        <details className="injected-entry">
                          <summary>
                            <span className="injected-state" aria-hidden="true" />
                            <strong>{item.label}</strong>
                            {item.source && <><span className="injected-separator" aria-hidden="true" /><span className="injected-source">{item.source}</span></>}
                            {item.contextSummary && <><span className="injected-separator" aria-hidden="true" /><span className="injected-summary">{item.contextSummary}</span></>}
                          </summary>
                          <div className="injected-body" data-context-form={item.contextForm ?? undefined}>
                            <pre className="message-text">{item.text}</pre>
                          </div>
                        </details>
                      ) : <MarkdownContent text={item.text} />}
                    </div>
                  </article>
                ))}
                {(loading || activeRunning) && <div className="agent-working"><span className="pulse" /><span className="working-label">DSH 正在工作</span></div>}
                <div ref={transcriptEnd} />
              </div>
            )}
          </div>

          {(approval || question) && (
            <section className="interaction-panel">
              {approval && (
                <div className="approval-request">
                  <div><strong>需要确认</strong><span>{approval.toolName}</span><p>{approval.reason || "Agent 请求执行此工具。"}</p></div>
                  <div className="interaction-actions"><button onClick={() => void respondToApproval("rejected")}>拒绝</button><button className="confirm" onClick={() => void respondToApproval("allowed-once")}>允许一次</button></div>
                </div>
              )}
              {question && (
                <div className="question-request">
                  {question.questions.map((item) => (
                    <div className="question-item" key={item.id}>
                      <strong>{item.header || "Agent 的问题"}</strong><p>{item.question}</p>
                      <div className="question-options">
                        {(item.options ?? []).map((option) => {
                          const checked = (questionAnswers[item.id] ?? []).includes(option.label);
                          return <button className={checked ? "checked" : ""} key={option.label} onClick={() => toggleQuestionAnswer(item.id, option.label, item.multiSelect)}><span>{checked ? "✓" : "○"}</span>{option.label}</button>;
                        })}
                      </div>
                      {item.detail && <small>{item.detail}</small>}
                    </div>
                  ))}
                  <div className="interaction-actions"><button onClick={() => void cancelQuestion()}>取消</button><button className="confirm" onClick={() => void respondToQuestion()}>提交回答</button></div>
                </div>
              )}
            </section>
          )}

          {queue.length > 0 && (
            <div className="queue-dock">
              <span className="queue-dock-label">待处理消息</span>
              <div className="queue-dock-items">
                {queue.filter((item) => item.placement !== "context").map((item) => (
                  <div className="queue-dock-item" key={item.id}>
                    <span>{textFromContent(item.message.content) || "未命名消息"}</span>
                    <button onClick={() => void removeQueueItem(item.id)} title="移除排队消息">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <footer className="composer-area">
            <div className="composer-shell">
              <textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={activeRunning ? "输入要排队或插入当前回合的内容" : "输入消息，开始与 DSH 对话"}
                rows={3}
                disabled={!status.runtimeAvailable}
              />
              <div className="composer-controls">
                <div className="composer-left">
                  <button className={`mode-button ${promptMode === "queue" ? "selected" : ""}`} onClick={() => setPromptMode("queue")} title="将消息排入当前会话">排队</button>
                  <button className={`mode-button ${promptMode === "steer" ? "selected" : ""}`} onClick={() => setPromptMode("steer")} title="插入当前回合">插入</button>
                  {activeSession && models && <div className="model-picker" ref={modelMenuRef}>
                    <button
                      className="model-picker-trigger"
                      type="button"
                      aria-label="选择模型与思考程度"
                      aria-haspopup="menu"
                      aria-expanded={modelMenuOpen}
                      title={`${selectedModel?.name ?? "选择模型"}${selectedReasoningLabel ? ` · ${selectedReasoningLabel}` : ""}`}
                      onClick={() => {
                        if (modelMenuOpen) {
                          setModelMenuOpen(false);
                          setModelMenuPane("root");
                        } else {
                          setModelMenuPane("root");
                          setModelMenuOpen(true);
                        }
                      }}
                    >
                      <span className="model-picker-label">{selectedModel?.name ?? "选择模型"}</span>
                      {selectedReasoningLabel && <span className="model-picker-effort">· {selectedReasoningLabel}</span>}
                      <span className={`model-picker-chevron${modelMenuOpen ? " open" : ""}`} aria-hidden="true">v</span>
                    </button>
                    {modelMenuOpen && <div className="model-menu" role="menu" aria-label="模型与思考程度">
                      {modelMenuPane === "root" && <>
                        <button className="model-menu-cell" type="button" role="menuitem" onClick={() => setModelMenuPane("model")}>
                          <span>模型</span>
                          <span className="model-menu-cell-value">{selectedModel?.name ?? "选择模型"}</span>
                          <span className="model-menu-arrow" aria-hidden="true">&gt;</span>
                        </button>
                        {selectedReasoning !== undefined && <button className="model-menu-cell" type="button" role="menuitem" onClick={() => setModelMenuPane("effort")}>
                          <span>思考程度</span>
                          <span className="model-menu-cell-value">{selectedReasoningLabel ?? "默认"}</span>
                          <span className="model-menu-arrow" aria-hidden="true">&gt;</span>
                        </button>}
                      </>}
                      {modelMenuPane === "model" && <>
                        <div className="model-menu-heading">
                          <button type="button" onClick={() => setModelMenuPane("root")} aria-label="返回模型与思考程度">&lt;</button>
                          <strong>模型</strong>
                        </div>
                        <div className="model-menu-list">
                          {models.groups.map((group) => <section className="model-menu-group" key={group.id}>
                            <div className="model-menu-group-title">{group.name}</div>
                            {group.models.map((model) => {
                              const value = `${group.id}\u0000${model.id}`;
                              const selected = value === selectedModelValue;
                              return <button className={`model-menu-option${selected ? " selected" : ""}`} type="button" role="menuitemradio" aria-checked={selected} key={value} onClick={() => void changeModel(value)}>
                                <span className="model-menu-option-copy">
                                  <strong>{model.name}</strong>
                                  {model.description && <small>{model.description}</small>}
                                </span>
                                <span className="model-menu-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                              </button>;
                            })}
                          </section>)}
                          {models.groups.length === 0 && <div className="model-menu-empty">暂无可用模型</div>}
                        </div>
                      </>}
                      {modelMenuPane === "effort" && selectedReasoning !== undefined && <>
                        <div className="model-menu-heading">
                          <button type="button" onClick={() => setModelMenuPane("root")} aria-label="返回模型与思考程度">&lt;</button>
                          <strong>思考程度</strong>
                        </div>
                        <div className="model-menu-list">
                          {reasoningChoices.length === 0 ? <div className="model-menu-empty">当前模型未提供思考程度。</div> : reasoningChoices.map((choice) => {
                            const selected = selectedReasoningEffort === choice.id;
                            return <button className={`model-menu-option${selected ? " selected" : ""}`} type="button" role="menuitemradio" aria-checked={selected} key={choice.key} onClick={() => void changeReasoningEffort(choice.id)}>
                              <span className="model-menu-option-copy">
                                <strong>{choice.name}</strong>
                                {choice.description && <small>{choice.description}</small>}
                              </span>
                              <span className="model-menu-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                            </button>;
                          })}
                        </div>
                      </>}
                    </div>}
                  </div>}
                  <div className="composer-stats" title={`上下文 ${formatTokens(sessionStats.contextTokens)} / ${sessionStats.contextLimit ? formatTokens(sessionStats.contextLimit) : "未知上限"}`}>
                    <span className="context-meter" aria-label="上下文使用量"><i style={{ width: `${contextPercent(sessionStats)}%` }} /></span>
                    <span>上下文 {formatTokens(sessionStats.contextTokens)}{sessionStats.contextLimit ? ` / ${formatTokens(sessionStats.contextLimit)}` : ""}</span>
                    <span title="输入 Token">↓ {formatTokens(sessionStats.inputTokens)}</span>
                    <span title="输出 Token">↑ {formatTokens(sessionStats.outputTokens)}</span>
                    <span title="缓存命中率">缓存 {sessionStats.cacheHitRate ? `${sessionStats.cacheHitRate.toFixed(0)}%` : "—"}</span>
                    <span title="首个 Token 延迟">首 T {sessionStats.firstTokenMs ? `${Math.round(sessionStats.firstTokenMs)}ms` : "—"}</span>
                    <span>{sessionStats.messages} 条消息</span>
                  </div>
                </div>
                <div className="composer-right">
                  <button
                    className={activeRunning ? "stop-button" : "send-button"}
                    onClick={handleComposerAction}
                    disabled={activeRunning ? !activeSessionId : !composer.trim() || loading || !status.runtimeAvailable}
                    title={activeRunning ? "停止当前回合" : "发送消息"}
                  >
                    {activeRunning ? "停止" : "发送"}
                  </button>
                </div>
              </div>
            </div>
            <div className="composer-hint">Ctrl / Cmd + Enter 发送 <span>{activeSession?.agentPreset ?? "standard"} · {workspace || status.runtimeDirectory || "运行目录"}</span></div>
          </footer>
        </section>

        {subagentCount > 0 && (
          <div className={`subagent-layer ${subagentPanelOpen ? "open" : ""}`}>
            {subagentPanelOpen && <button className="subagent-panel-backdrop" type="button" onClick={() => setSubagentPanelOpen(false)} aria-label="关闭 Subagent 执行面板" />}
            <nav className="subagent-rail" aria-label="子 Agent 书签">
              <div className="subagent-rail-label">子 Agent</div>
              {childSubagents.map((entry, index) => {
                const label = subagentDisplayName(entry, index);
                const selected = selectedSubagentId === entry.id;
                return (
                  <button
                    className={`subagent-bookmark ${selected && subagentPanelOpen ? "selected" : ""}`}
                    data-tone={`tone-${index % 4}`}
                    type="button"
                    key={entry.id}
                    onClick={() => toggleSubagent(entry, index)}
                    title={`${selected && subagentPanelOpen ? "关闭" : "打开"} ${label} 的执行情况`}
                    aria-pressed={selected && subagentPanelOpen}
                  >
                    <span className={`subagent-bookmark-status ${entry.activity}`} aria-hidden="true"><i /></span>
                    <span className="subagent-bookmark-copy"><strong>{label}</strong><small>{subagentActivityLabel(entry.activity)} · {subagentModeLabel(entry.mode)}</small></span>
                    <span className="subagent-bookmark-number">{String(index + 1).padStart(2, "0")}</span>
                  </button>
                );
              })}
            </nav>

            {subagentPanelOpen && (
              <aside className="subagent-drawer" aria-label="Subagent 执行情况" aria-live="polite">
                <header className="subagent-drawer-header">
                  <div className="subagent-drawer-heading">
                    <span className={`subagent-drawer-status ${selectedSubagent?.activity ?? "inactive"}`} aria-hidden="true" />
                    <div>
                      <span className="subagent-drawer-kicker">SUBAGENT / {selectedSubagentIndex >= 0 ? String(selectedSubagentIndex + 1).padStart(2, "0") : "--"}</span>
                      <h2>{selectedSubagent ? subagentDisplayName(selectedSubagent, selectedSubagentIndex) : "子 Agent"}</h2>
                      <p>{selectedSubagent ? `${subagentActivityLabel(selectedSubagent.activity)} · ${subagentModeLabel(selectedSubagent.mode)}` : "选择一个子 Agent"}</p>
                    </div>
                  </div>
                  <button className="subagent-drawer-close" type="button" onClick={() => setSubagentPanelOpen(false)} aria-label="关闭 Subagent 执行面板" title="关闭">×</button>
                </header>

                {selectedSubagent && <div className="subagent-drawer-meta"><span><i className={selectedSubagent.activity} />{subagentActivityLabel(selectedSubagent.activity)}</span><span>{subagentModeLabel(selectedSubagent.mode)}</span><code title={selectedSubagent.id}>{shortSubagentId(selectedSubagent.id)}</code></div>}

                <div className="subagent-drawer-body">
                  {subagentLoadingId === selectedSubagentId ? (
                    <div className="subagent-drawer-loading"><span className="subagent-loading-pulse" />正在读取执行记录</div>
                  ) : subagentLoadError ? (
                    <div className="subagent-drawer-empty error"><strong>读取失败</strong><p>{subagentLoadError}</p></div>
                  ) : subagentSession ? (
                    <div className="subagent-history">
                      {subagentTranscript.map((item) => item.kind === "tool" ? (
                        <details className={`subagent-tool-entry ${item.toolResultError ? "error" : ""}`} key={item.key} open={item.toolResultText !== undefined}>
                          <summary><span className="subagent-tool-state" /><strong>{item.toolName}</strong><em>{item.toolResultError ? "异常" : item.toolResultText !== undefined ? "已返回" : "执行中"}</em></summary>
                          <div className="subagent-tool-content"><pre>{item.text}</pre>{item.toolResultText !== undefined && <div className="subagent-tool-result"><span>结果</span><pre>{item.toolResultText}</pre></div>}</div>
                        </details>
                      ) : (
                        <article className={`subagent-message ${item.kind}`} key={item.key}>
                          <div className="subagent-message-meta"><strong>{item.label}</strong><time>{formatClock(item.time)}</time></div>
                          {item.injected ? <pre>{item.text}</pre> : <MarkdownContent text={item.text} />}
                        </article>
                      ))}
                      {subagentTranscript.length === 0 && <div className="subagent-drawer-empty"><strong>暂无执行记录</strong><p>这个子 Agent 还没有可展示的消息。</p></div>}
                    </div>
                  ) : (
                    <div className="subagent-drawer-empty"><strong>选择一个书签</strong><p>打开子 Agent 后，这里会显示它的消息、工具调用和返回结果。</p></div>
                  )}
                </div>

                {subagentSession?.address.mode === "continuable" && <div className="subagent-compose"><input value={subagentComposer} onChange={(event) => setSubagentComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void promptSubagent(); }} placeholder="追问子 Agent" aria-label="追问子 Agent" /><button type="button" onClick={() => void interruptSubagent(subagentSession.address)} title="中断子 Agent">中断</button><button type="button" onClick={() => void promptSubagent()}>发送</button></div>}
              </aside>
            )}
          </div>
        )}

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

            {surfaceTab === "runtime" && (
              <>
                <div className="inspector-section"><span className="inspector-label">DSH</span><strong className="inspector-value">{runtimeLabel(status)}</strong><p>{status.message}</p></div>
                <div className="inspector-section"><span className="inspector-label">Cordis Profile</span><strong className="inspector-value">desktop</strong><p>{status.packageName}</p></div>
                <div className="inspector-section"><span className="inspector-label">运行目录</span><div className="session-stats-inline">上下文 {formatTokens(sessionStats.contextTokens)} · ↓ {formatTokens(sessionStats.inputTokens)} · ↑ {formatTokens(sessionStats.outputTokens)} · 缓存 {sessionStats.cacheHitRate ? `${sessionStats.cacheHitRate.toFixed(0)}%` : "—"} · 首 T {sessionStats.firstTokenMs ? `${Math.round(sessionStats.firstTokenMs)}ms` : "—"}</div><code>{status.runtimeDirectory || "未读取"}</code></div>
                {runtimeDetails && <div className="inspector-section"><span className="inspector-label">宿主路由</span><p>{String(runtimeDetails.provider || "默认 provider")} / {String(runtimeDetails.model || "默认 model")}</p><p>{String(runtimeDetails.attachedSessions ?? 0)} 个活动会话</p></div>}
                <div className="inspector-section"><span className="inspector-label">工作区</span><p>{workspaces.length ? `${workspaces.length} 个已注册工作区` : "尚未注册工作区"}</p><button className="surface-link" onClick={() => void addWorkspace()}>添加目录</button></div>
              </>
            )}

            {surfaceTab === "presets" && (
              <div className="surface-content">
                <div className="surface-intro"><strong>Agent Preset</strong><p>Preset 决定会话挂载哪些 Cordis 插件。新会话才可以切换已组合的 Preset。</p></div>
                <label className="surface-field">新会话默认
                  <select value={nextPreset || presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void selectPresetForNextSession(event.target.value)}>
                    {presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{preset.name || preset.id}</option>)}
                  </select>
                </label>
                <div className="surface-list">{presets.map((preset) => (
                  <div className="surface-row" key={preset.id}>
                    <div><strong>{preset.name || preset.id}</strong><small>{preset.id} · {preset.trust}{preset.isDefault ? " · 默认" : ""}</small>{preset.description && <p>{preset.description}</p>}{preset.broken && <p className="surface-error">{preset.broken}</p>}</div>
                    <div className="surface-row-actions"><button onClick={() => void readPreset(preset.id)} title="查看组合内容">查看</button>{preset.trust === "user" && <button onClick={() => void openPresetDocument(preset.id)} title="打开 Preset 文件夹">打开</button>}<button onClick={() => setPresetCopy({ from: preset.id, id: "", name: "" })} title="复制 Preset">复制</button></div>
                  </div>
                ))}</div>
                {!presetAuthorable && <p className="surface-muted">当前 Profile 未开放用户 Preset 创建。</p>}
                {presetAuthorable && <p className="surface-muted">可复制现有 Preset 创建用户组合；编辑仍由 DSH Host 负责打开本地文件。</p>}
                {presetCopy && <div className="surface-dialog"><strong>复制 {presetCopy.from}</strong><input placeholder="新 Preset id" value={presetCopy.id} onChange={(event) => setPresetCopy({ ...presetCopy, id: event.target.value })} /><input placeholder="显示名称（可选）" value={presetCopy.name} onChange={(event) => setPresetCopy({ ...presetCopy, name: event.target.value })} /><div className="surface-dialog-actions"><button onClick={() => setPresetCopy(null)}>取消</button><button className="confirm" onClick={() => void copyPreset()}>创建</button></div></div>}
                {presetView && <div className="surface-dialog"><strong>{presetView.id} / cordis.patch.yml</strong><pre className="surface-code">{presetView.content}</pre><button onClick={() => setPresetView(null)}>关闭</button></div>}
              </div>
            )}

            {surfaceTab === "skills" && (
              <div className="surface-content"><div className="surface-intro"><strong>Skills</strong><p>当前会话可调用的技能目录，来源于当前 Agent Preset。</p></div><div className="surface-list">{skills.length === 0 ? <p className="surface-muted">当前会话没有可见 Skill。</p> : skills.map((skill) => <div className="surface-row compact" key={skill.name}><div><strong>/{skill.name}</strong><small>{skill.modelInvocable ? "Agent 可调用" : "仅用户可调用"}</small><p>{skill.description}</p>{skill.whenToUse && <p className="surface-muted">{skill.whenToUse}</p>}</div><button onClick={() => { setComposer(`/${skill.name} `); setShowInspector(false); }}>插入</button></div>)}</div></div>
            )}

            {surfaceTab === "subagents" && (
              <div className="surface-content"><div className="surface-intro"><strong>Subagents</strong><p>从当前会话打开子 Agent 的独立历史；可继续子 Agent 支持追问和中断。</p></div><div className="surface-list">{!subagents || subagents.entries.length === 0 ? <p className="surface-muted">当前会话没有子 Agent。</p> : subagents.entries.map((entry) => entry.kind === "diagnostic" ? <div className="surface-row compact" key={entry.id}><div><strong>{entry.id}</strong><small>不可用：{entry.reason}</small></div></div> : <div className="surface-row compact" key={entry.id}><div><strong>{entry.label || entry.id}</strong><small>{entry.mode} · {entry.activity === "running" ? "运行中" : "已停止"}</small></div><button onClick={() => void openSubagent({ parentSessionId: activeSessionId!, childSessionId: entry.id, mode: entry.mode })}>打开</button></div>)}</div>{subagentSession && <div className="subagent-view"><div className="subagent-view-head"><strong>{subagentSession.address.childSessionId}</strong><button onClick={() => setSubagentSession(null)}>关闭</button></div><div className="subagent-history">{transcriptFromHistory(subagentSession.history).map((item) => <div className={`subagent-message ${item.kind}`} key={item.key}><small>{item.label}</small><MarkdownContent text={item.text} /></div>)}</div>{subagentSession.address.mode === "continuable" && <div className="subagent-compose"><input value={subagentComposer} onChange={(event) => setSubagentComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void promptSubagent(); }} placeholder="追问子 Agent" /><button onClick={() => void interruptSubagent(subagentSession.address)} title="中断子 Agent">停</button><button onClick={() => void promptSubagent()}>发送</button></div>}</div>}</div>
            )}

            {surfaceTab === "goal" && (
              <div className="surface-content"><div className="surface-intro"><strong>Goal</strong><p>Goal 是会话级的持续目标，状态由 DSH projection 推送，操作使用 revision 做 CAS。</p></div>{activeGoal ? <div className="goal-panel"><div className="goal-status"><span>{activeGoal.phase}</span><strong>{activeGoal.objective}</strong></div>{activeGoal.blockedReason && <p className="surface-error">{activeGoal.blockedReason.message}</p>}<input value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} placeholder="编辑目标" /><div className="surface-row-actions"><button onClick={() => void mutateGoal("edit")}>保存</button>{activeGoal.phase === "active" && <button onClick={() => void mutateGoal("pause")}>暂停</button>}{activeGoal.phase === "paused" && <button onClick={() => void mutateGoal("resume")}>恢复</button>}<button onClick={() => void mutateGoal("complete")}>完成</button><button onClick={() => void mutateGoal("clear")}>清除</button></div></div> : <div className="goal-panel"><p className="surface-muted">当前会话没有 Goal。</p><input value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createGoal(); }} placeholder="输入目标，例如：完成登录模块" /><button className="confirm" onClick={() => void createGoal()}>创建 Goal</button></div>}</div>
            )}

            {surfaceTab === "settings" && (
              <div className="settings-layout">
                <nav className="settings-navigation" aria-label="设置分区">
                  <div className="settings-navigation-title">DSH 设置</div>
                  <button className={settingsSection === "general" ? "selected" : ""} onClick={() => setSettingsSection("general")}>
                    <strong>通用</strong><small>会话与 Host</small>
                  </button>
                  <button className={settingsSection === "models" ? "selected" : ""} onClick={() => setSettingsSection("models")}>
                    <strong>模型</strong><small>Provider 与模型目录</small>
                  </button>
                  <button className={settingsSection === "plugins" ? "selected" : ""} onClick={() => setSettingsSection("plugins")}>
                    <strong>插件</strong><small>运行中的 Cordis 插件</small>
                  </button>
                </nav>

                <section className="settings-main">
                  {settingsSection === "general" && (
                    <div className="settings-page">
                      <div className="settings-page-header">
                        <div><span className="settings-overline">GENERAL</span><h2>通用</h2><p>管理当前桌面端连接的 DSH Host 与新会话默认值。</p></div>
                        {settings?.hasDocument && <button className="settings-header-action" onClick={() => void bridgeRequest("settings.openDocument").then(() => setNotice("已打开 DSH 配置文件")).catch((error) => setNotice(errorText(error)))}>打开配置文件</button>}
                      </div>

                      <div className="settings-block">
                        <div className="settings-block-heading"><div><h3>会话</h3><p>新会话使用的工作目录和 Agent Preset。</p></div></div>
                        <div className="settings-preference-list">
                          <label className="settings-preference-row"><span><strong>默认 Agent Preset</strong><small>只影响之后创建的新会话</small></span><select value={nextPreset || presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void selectPresetForNextSession(event.target.value)}>{presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{preset.name || preset.id}</option>)}</select></label>
                          <div className="settings-preference-row"><span><strong>工作目录</strong><small>{workspace || status.runtimeDirectory || "使用 DSH 运行目录"}</small></span><button onClick={() => void addWorkspace()}>选择目录</button></div>
                        </div>
                      </div>

                      <div className="settings-block">
                        <div className="settings-block-heading"><div><h3>Host 设置</h3><p>公开字段可由桌面端保存；密钥始终由 DSH Host 保管。</p></div><span className="settings-count">{settings?.namespaces.length ?? "—"}</span></div>
                        <div className="settings-namespace-list">
                          {pluginSettings.length === 0 ? <p className="settings-empty">当前 Host 没有额外的可配置插件设置。</p> : pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? "重启生效" : "实时生效"} · revision {namespace.revision}{namespace.secrets.length ? ` · ${namespace.secrets.filter((secret) => secret.set).length}/${namespace.secrets.length} 个密钥已配置` : ""}</small></div><button disabled={!settings?.writable} onClick={() => openSettingsNamespace(namespace)}>编辑 JSON</button></div>)}
                        </div>
                      </div>
                    </div>
                  )}

                  {settingsSection === "models" && (
                    <div className="settings-page">
                      <div className="settings-page-header"><div><span className="settings-overline">MODELS</span><h2>模型</h2><p>Provider 的连接配置由 DSH 管理，密钥只显示状态，不会回显。</p></div><span className="settings-count">{providers.length} 个 Provider</span></div>
                      <div className="settings-block">
                        <div className="settings-block-heading"><div><h3>Provider</h3><p>点击一行查看配置命名空间和可用模型。</p></div></div>
                        {providers.length === 0 ? <p className="settings-empty">当前没有可配置的 Provider。</p> : <div className="settings-provider-grid">{providers.map((provider) => {
                          const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
                          const secretTotal = namespace?.secrets.length ?? 0;
                          const secretConfigured = namespace?.secrets.filter((secret) => secret.set).length ?? 0;
                          const modelGroups = hostModels?.groups.filter((group) => group.id === provider.provider || group.id.startsWith(`${provider.provider}:`) || group.id.includes(provider.provider)) ?? [];
                          const open = expandedProvider === provider.provider;
                          return <article className={`settings-provider-card ${open ? "open" : ""}`} key={provider.provider}>
                            <button className="settings-provider-header" onClick={() => setExpandedProvider((current) => current === provider.provider ? null : provider.provider)} aria-expanded={open}>
                              <span className="settings-provider-title"><strong>{provider.displayName}</strong><small>{provider.provider}</small></span>
                              <span className="settings-provider-trailing"><i className={provider.active ? "active" : ""} /><span>{provider.active ? "可用" : "未激活"}</span><b aria-hidden="true">⌄</b></span>
                            </button>
                            {open && <div className="settings-provider-details">
                              <div className="settings-provider-meta"><div><span>设置命名空间</span><code>{provider.settingsNs}</code></div><div><span>API 密钥</span><strong className={secretConfigured > 0 ? "configured" : "unconfigured"}>{secretTotal === 0 ? "由 Host 决定" : `${secretConfigured}/${secretTotal} 已配置`}</strong></div></div>
                              {modelGroups.length > 0 && <div className="settings-provider-models"><span className="settings-detail-label">当前模型</span>{modelGroups.flatMap((group) => group.models).slice(0, 8).map((model) => <span className="settings-model-chip" key={`${provider.provider}-${model.id}`}>{model.name}</span>)}</div>}
                              <div className="settings-provider-footer"><small>{provider.declared === false ? "运行中路由" : "可配置路由"}</small><button disabled={!settings?.writable || !namespace} onClick={() => openSettingsNamespace(namespace)}>编辑公开设置</button></div>
                            </div>}
                          </article>;
                        })}</div>}
                      </div>

                      <div className="settings-block">
                        <div className="settings-block-heading"><div><h3>可用模型</h3><p>来自 Host 的模型目录，不直接修改会话历史。</p></div></div>
                        {!hostModels || hostModels.groups.length === 0 ? <p className="settings-empty">模型目录暂不可用。</p> : <div className="settings-model-catalog">{hostModels.groups.map((group) => <div className="settings-model-group" key={group.id}><div><strong>{group.name}</strong><small>{group.id}</small></div><span>{group.models.length} 个模型</span><p>{group.models.map((model) => model.name).join(" · ")}</p></div>)}</div>}
                      </div>
                    </div>
                  )}

                  {settingsSection === "plugins" && (
                    <div className="settings-page">
                      <div className="settings-page-header"><div><span className="settings-overline">PLUGINS</span><h2>插件</h2><p>这是当前 Cordis Loader 的只读快照；插件的启停和装载仍由 DSH Profile 决定。</p></div><span className="settings-count">{pluginInventory?.length ?? "—"} 个插件</span></div>
                      <div className="settings-block">
                        <div className="settings-plugin-toolbar"><div><h3>插件列表</h3><p>展开条目查看 Loader id 和生命周期状态。</p></div><label className="settings-search"><span aria-hidden="true">⌕</span><input type="search" value={pluginSearch} onChange={(event) => setPluginSearch(event.target.value)} placeholder="搜索插件" aria-label="搜索插件" /></label></div>
                        {pluginInventory === null ? <p className="settings-empty">正在读取插件清单…</p> : visiblePlugins.length === 0 ? <p className="settings-empty">{pluginSearch ? "没有匹配的插件。" : "当前没有已加载插件。"}</p> : <div className="settings-plugin-grid">{visiblePlugins.map((plugin) => {
                          const open = expandedPlugin === plugin.entryId;
                          return <article className={`settings-plugin-card ${open ? "open" : ""}`} key={plugin.entryId}>
                            <button className="settings-plugin-header" onClick={() => setExpandedPlugin((current) => current === plugin.entryId ? null : plugin.entryId)} aria-expanded={open}>
                              <span className="settings-plugin-name"><strong title={plugin.moduleName}>{pluginDisplayName(plugin.moduleName)}</strong><small>{plugin.moduleName}</small></span>
                              <span className="settings-plugin-state">{plugin.enabled && <i className={`settings-plugin-dot ${plugin.fiberPhase ?? "unobserved"}`} />}<em className={plugin.enabled ? "enabled" : "disabled"}>{plugin.enabled ? "已启用" : "已禁用"}</em><b aria-hidden="true">⌄</b></span>
                            </button>
                            {open && <div className="settings-plugin-details"><code>{plugin.entryId}</code><dl><div><dt>配置</dt><dd>{plugin.enabled ? "已启用" : "已禁用"}</dd></div>{plugin.enabled && <div><dt>Cordis</dt><dd>{pluginPhaseLabel(plugin.fiberPhase)}</dd></div>}</dl></div>}
                          </article>;
                        })}</div>}
                      </div>
                      <div className="settings-block">
                        <div className="settings-block-heading"><div><h3>插件配置</h3><p>由 Host 暴露的插件设置命名空间。</p></div></div>
                        {pluginSettings.length === 0 ? <p className="settings-empty">当前没有单独的插件设置项。</p> : <div className="settings-namespace-list">{pluginSettings.map((namespace) => <div className="settings-namespace-row" key={namespace.ns}><div><strong>{namespace.ns}</strong><small>{namespace.applies === "restart" ? "重启生效" : "实时生效"} · revision {namespace.revision}</small></div><button disabled={!settings?.writable} onClick={() => openSettingsNamespace(namespace)}>编辑 JSON</button></div>)}</div>}
                      </div>
                    </div>
                  )}
                </section>
                {settingsDraft && <div className="settings-json-panel"><div className="settings-json-heading"><strong>编辑 {settingsDraft.ns}</strong><button onClick={() => setSettingsDraft(null)} title="关闭编辑器" aria-label="关闭编辑器">×</button></div><p>仅修改公开字段；密钥和其他 Host 专属字段不会被覆盖。</p><textarea className="surface-code-input" value={settingsDraft.value} onChange={(event) => setSettingsDraft({ ...settingsDraft, value: event.target.value })} /><div className="surface-dialog-actions"><button onClick={() => setSettingsDraft(null)}>取消</button><button className="confirm" onClick={() => void saveSettings()}>保存</button></div></div>}
              </div>
            )}
            </aside>
          </div>
        )}
      {confirmAction && <div className="confirm-backdrop" onMouseDown={() => setConfirmAction(null)}><div className="confirm-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><strong>删除会话？</strong><p>“{displayTitle(confirmAction.session)}”及其历史记录将被永久删除，此操作无法撤销。</p><div className="surface-dialog-actions"><button onClick={() => setConfirmAction(null)}>取消</button><button className="confirm danger-button" onClick={() => void deleteSession(confirmAction.session)}>确认删除</button></div></div></div>}
      </div>
    </main>
  );
}

export default App;
