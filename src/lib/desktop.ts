import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import packageInfo from "../../package.json";
import { parseExternalLaunchPayload, type ExternalLaunchRequest } from "./external-launch";
import type { NativeUpdateDownloadProgress, UpdateChannel } from "../app/update-model";
export type { ExternalLaunchRequest } from "./external-launch";
export { missingAgentPresetInfo, type MissingAgentPresetInfo } from "./missing-preset";

export const DSH_PACKAGE = "@deepseek-ai/dsh（内嵌运行时）";
export const DEEPTOP_VERSION = packageInfo.version;
export const DEEPTOP_PROJECT_URL = "https://github.com/Sparrived/DSH-Deeptop";

export type CloseBehavior = "ask" | "hide-to-tray" | "exit";

export interface WindowBehaviorSettings {
  minimizeToTray: boolean;
  closeBehavior: CloseBehavior;
}

export interface DockPosition {
  x: number;
  y: number;
}

export interface DockSettings {
  autoCollapseOnOutsideClick: boolean;
}

export interface DshProcessInfo {
  pid: number;
  name: string;
  commandLine: string;
}

export interface DshProcessConflict {
  dshHome: string;
  processes: DshProcessInfo[];
}

export interface DshStatus {
  dshHome: string;
  runtimeDirectory: string;
  packageName: string;
  runtimeAvailable: boolean;
  runtimeStarting: boolean;
  installing: boolean;
  registryTesting: boolean;
  selectedRegistry?: string | null;
  nodeAvailable: boolean;
  npmAvailable: boolean;
  packageAvailable: boolean;
  message: string;
  processConflict?: DshProcessConflict | null;
}

export type DshRuntimeLogStream =
  | "command"
  | "stdout"
  | "stderr"
  | "diagnostic"
  | "frontend"
  | "console";

export interface DshRuntimeLog {
  /** Epoch milliseconds at which the entry was recorded by the desktop host. */
  time: number;
  phase: string;
  stream: DshRuntimeLogStream;
  text: string;
}

export interface DshRpcError {
  code: string;
  message: string;
  details?: unknown;
}

export type DshRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DshRpcError };

export interface DshRpcResponse<T> {
  rpcId?: string;
  result?: DshRpcResult<T>;
}

export interface DshSessionEvent {
  seq: number;
  time: number;
  type: string;
  data: Record<string, unknown>;
  surfaceOp?: string;
  sourceEventSeqs?: number[];
}

export interface DshHistoryEntry {
  event: DshSessionEvent;
  view?: unknown;
}

export interface DshSessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  projections?: {
    asOfSeq: number;
    values: Record<string, unknown>;
  };
}

export type TraySessionStatus = "idle" | "running" | "unread" | "error";

export interface TraySessionMenuItem {
  sessionId: string;
  title: string;
  context?: string;
  status: TraySessionStatus;
}

export interface TraySessionMenuSnapshot {
  unread: TraySessionMenuItem[];
  recent: TraySessionMenuItem[];
  more: TraySessionMenuItem[];
}

export type TrayPopupAction = "newChat" | "showMain" | "quit";

export type DshInputModality = "text" | "image";
export type DshImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** The prompt content shape accepted by the DSH session.prompt API. */
export type DshPromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: DshImageMediaType; data: string; name?: string };

export interface DshSessionPromptPayload {
  sessionId: string;
  mode: "queue" | "steer";
  content: DshPromptContentPart[];
  clientTimeZone?: string;
}

export interface DshImageAttachmentLimits {
  maxImageBytes: number;
  maxImagesPerMessage: number;
  maxMessageImageBytes: number;
  maxImagePixels: number;
  maxImageDimension: number;
  mediaTypes: string[];
}

export interface DshFileReferenceCandidate {
  path: string;
  kind: "file" | "directory";
}

export interface DshSessionReferenceCandidate {
  sessionId: string;
  label: string;
  cwd?: string;
  createdAt: number;
  mention: string;
}

export interface DshModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  inputModalities?: DshInputModality[];
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>;
    defaultEffort?: string;
  };
}

export interface DshModelGroup {
  id: string;
  name: string;
  models: DshModel[];
}

export interface DshModelCatalog {
  groups: DshModelGroup[];
  failures: Array<{ id: string; name: string; message: string }>;
}

export interface DshSessionModels extends DshModelCatalog {
  current: { provider: string; model: string; reasoningEffort?: string };
  contextWindow?: number;
  routable: boolean;
  imageLimits?: DshImageAttachmentLimits;
}

export interface DshWorkspace {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  /** Session ids pinned within this workspace, in pinning order. */
  pinnedSessionIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DshPreset {
  id: string;
  trust: "system" | "user";
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
}

export interface DshPresetRoster {
  presets: DshPreset[];
  authorable: boolean;
  hasDocument: boolean;
}

export interface DshSkill {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
}

export interface DshSkillInstallResult {
  skillName: string;
  source: string;
  ref: string;
  path: string;
  installPath: string;
  method: "download" | "git";
  registered: boolean;
  visibleInCurrentSession?: boolean;
  warnings: string[];
}

export type DshSubagentEntry =
  | {
    kind: "child";
    id: string;
    mode: "one-shot" | "continuable";
    activity: "running" | "inactive";
    hasChildren: boolean;
    label?: string;
  }
  | {
    kind: "diagnostic";
    id: string;
    reason: "corrupt" | "unsupported" | "unavailable";
  };

export interface DshSubagentCatalog {
  entries: DshSubagentEntry[];
  parentAvailable: boolean;
}

export interface DshSubagentAddress {
  parentSessionId: string;
  childSessionId: string;
  mode: "one-shot" | "continuable";
}

export interface DshGoalProjection {
  goal: {
    id: string;
    revision: number;
    objective: string;
    phase: "active" | "paused" | "blocked" | "complete";
    blockedReason?: { code: string; message: string };
    maxGoalRounds: number;
  };
  roundsStarted: number;
  createdAt: number;
  updatedAt: number;
}

export interface DshSettingsSecret {
  path: string[];
  set: boolean;
}

export interface DshSettingsNamespace {
  ns: string;
  schema: unknown;
  value: unknown;
  base?: unknown;
  user?: unknown;
  applies: "live" | "restart";
  secrets: DshSettingsSecret[];
  revision: number;
}

export interface DshSettingsDescription {
  writable: boolean;
  hasDocument: boolean;
  namespaces: DshSettingsNamespace[];
}

export interface WindowsContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  managed: boolean;
  message: string;
}

export interface DshProvider {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  active: boolean;
  declared?: boolean;
}

export interface DshCredential {
  configured: boolean;
  source?: string;
  writable: boolean;
}

export type DshPluginFiberPhase = "pending" | "loading" | "active" | "failed" | "unloading" | null;

export interface DshPluginCompatibility {
  supported: boolean;
  reason?: string;
}

export interface DshPluginInventoryEntry {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: DshPluginFiberPhase;
  compatibility?: DshPluginCompatibility;
}

export interface DshPluginInventorySnapshot {
  entries: DshPluginInventoryEntry[];
  excluded?: DshPluginInventoryEntry[];
}

export interface DshPluginConfigEntry {
  id: string;
  name: string;
  enabled: boolean;
  system: boolean;
  compatibility: DshPluginCompatibility;
}

export interface DshPluginConfigDescription {
  revision: number;
  path: string;
  plugins: DshPluginConfigEntry[];
  patch: unknown[];
  fingerprint: string;
}

export interface DshPluginConfigMutation extends DshPluginConfigDescription {
  changed: boolean;
  restartRequired: boolean;
}

export interface DshBridgeEvent {
  type: "event";
  channel: "mux" | "host";
  frame: {
    rpcId?: string;
    payload: Record<string, unknown>;
  };
}

export interface DshQuestion {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  intent?: { kind: "plan-review"; approve: string };
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export interface DshQueueItem {
  id: string;
  placement: "queued" | "steering" | "context";
  message: {
    content?: unknown;
  };
}

export interface DshSessionStatsProjection {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
}

export interface DshCommandDescriptor {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface DshCommandExecution {
  commandId: string;
  result: { kind: "success"; text?: string; sourceEventSeq?: number } | { kind: "error"; text: string };
}

export interface DshPermissionSelect {
  options: Array<{ value: string; name: string; description?: string }>;
  currentValue: string;
}

export interface DshPlanProjection {
  active: boolean;
  pending: boolean;
}

export interface DshMessageFeedbackItem {
  messageId: string;
  rating: "positive" | "negative";
  note?: string;
  version: string;
  createdAt: number;
  updatedAt: number;
}

export interface DshMessageAnnotationItem {
  messageId: string;
  note: string;
  version: string;
  createdAt: number;
  updatedAt: number;
}

export type DshMessageAnnotationError =
  | { code: "session-not-found"; sessionId: string }
  | { code: "target-not-found"; sessionId: string; messageId: string }
  | { code: "version-conflict"; current: DshMessageAnnotationItem | null }
  | { code: "note-blank" }
  | { code: "note-too-large"; maxBytes: number; actualBytes: number };

export type DshMessageAnnotationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DshMessageAnnotationError };

export interface DshRemoteEvent {
  type: "host/remote-event";
  event: string;
  args: unknown[];
}

export function isDshRemoteEvent(
  event: DshBridgeEvent,
): event is DshBridgeEvent & { frame: { payload: DshRemoteEvent } } {
  const payload = event.frame.payload;
  return event.channel === "host"
    && payload.type === "host/remote-event"
    && typeof payload.event === "string"
    && Array.isArray(payload.args);
}

export interface DshJob {
  id: string;
  kind: string;
  label: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function sendSystemNotification(title: string, body: string, sessionId?: string) {
  if (!isTauri()) return;
  try {
    await invoke("send_system_notification", { title, body, sessionId });
  } catch {
    // System notifications must not interrupt the approval/question flow.
  }
}

export async function listPendingOpenSessions(): Promise<string[]> {
  if (!isTauri()) return [];
  const pending = await invoke<unknown>("list_pending_open_sessions");
  return Array.isArray(pending)
    ? pending.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.trim().length > 0)
    : [];
}

export async function acknowledgePendingOpenSession(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("acknowledge_pending_open_session", { sessionId });
}

export async function listenToNotificationClick(handler: (sessionId: string) => void): Promise<UnlistenFn> {
  return listen<{ sessionId?: unknown }>("notification-click", (event) => {
    const sessionId = event.payload?.sessionId;
    if (typeof sessionId === "string" && sessionId.trim()) handler(sessionId);
  });
}

export async function updateTraySessionMenu(snapshot: TraySessionMenuSnapshot): Promise<void> {
  if (!isTauri()) return;
  await invoke("update_tray_session_menu", { snapshot });
}

export async function getTrayPopupSnapshot(): Promise<TraySessionMenuSnapshot> {
  if (!isTauri()) return { unread: [], recent: [], more: [] };
  return invoke<TraySessionMenuSnapshot>("get_tray_popup_snapshot");
}

export async function listenToTrayPopupUpdates(
  handler: (snapshot: TraySessionMenuSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<TraySessionMenuSnapshot>("tray-popup-updated", (event) => handler(event.payload));
}

export async function openTrayPopupSession(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_tray_popup_session", { sessionId });
}

export async function runTrayPopupAction(action: TrayPopupAction): Promise<void> {
  if (!isTauri()) return;
  await invoke("run_tray_popup_action", { action });
}

export async function dismissTrayPopup(): Promise<void> {
  if (!isTauri()) return;
  await invoke("dismiss_tray_popup");
}

export async function listenToTraySessionOpen(handler: (sessionId: string) => void): Promise<UnlistenFn> {
  return listen<{ sessionId?: unknown }>("tray-session-open", (event) => {
    const sessionId = event.payload?.sessionId;
    if (typeof sessionId === "string" && sessionId.trim()) handler(sessionId);
  });
}

export async function listenToTrayNewChat(handler: () => void): Promise<UnlistenFn> {
  return listen("tray-new-chat", () => handler());
}

export async function listenToSingleInstance(handler: () => void): Promise<UnlistenFn> {
  return listen("single-instance", () => handler());
}

export async function listenToExternalLaunch(handler: (request: ExternalLaunchRequest) => void): Promise<UnlistenFn> {
  return listen<unknown>("external-launch", (event) => {
    const request = parseExternalLaunchPayload(event.payload);
    if (request) handler(request);
  });
}

export async function listenToWindowCloseRequested(handler: () => void): Promise<UnlistenFn> {
  return listen("window-close-requested", () => handler());
}

export async function listPendingExternalLaunches(): Promise<ExternalLaunchRequest[]> {
  if (!isTauri()) return [];
  const pending = await invoke<unknown>("list_pending_external_launches");
  if (!Array.isArray(pending)) return [];
  return pending.map(parseExternalLaunchPayload).filter((request): request is ExternalLaunchRequest => request !== null);
}

export async function acknowledgePendingExternalLaunch(paths: string[]): Promise<void> {
  if (!isTauri()) return;
  await invoke("acknowledge_pending_external_launch", { paths });
}

export async function getWindowsContextMenuStatus(): Promise<WindowsContextMenuStatus> {
  if (!isTauri()) return { supported: false, enabled: false, managed: false, message: "资源管理器右键菜单仅支持 Windows" };
  return invoke<WindowsContextMenuStatus>("get_windows_context_menu_status");
}

export async function setWindowsContextMenuEnabled(enabled: boolean): Promise<WindowsContextMenuStatus> {
  if (!isTauri()) throw new Error("资源管理器右键菜单仅在 Windows 桌面端可用");
  return invoke<WindowsContextMenuStatus>("set_windows_context_menu_enabled", { enabled });
}

export async function getDockPosition(id: string): Promise<DockPosition | null> {
  if (!isTauri()) return null;
  const position = await invoke<DockPosition | null>("get_dock_position", { id });
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return position;
}

export async function setDockPosition(id: string, position: DockPosition): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_dock_position", { id, position });
}

export async function resetDockPosition(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("reset_dock_position", { id });
}

export async function getDockSettings(): Promise<DockSettings> {
  if (!isTauri()) return { autoCollapseOnOutsideClick: false };
  const settings = await invoke<Partial<DockSettings>>("get_dock_settings");
  return { autoCollapseOnOutsideClick: settings.autoCollapseOnOutsideClick === true };
}

export async function setDockSettings(settings: DockSettings): Promise<DockSettings> {
  if (!isTauri()) return settings;
  return invoke<DockSettings>("set_dock_settings", { settings });
}

export async function getWindowBehaviorSettings(): Promise<WindowBehaviorSettings> {
  if (!isTauri()) return { minimizeToTray: false, closeBehavior: "ask" };
  return invoke<WindowBehaviorSettings>("get_window_behavior_settings");
}

export async function setWindowBehaviorSettings(settings: WindowBehaviorSettings): Promise<WindowBehaviorSettings> {
  if (!isTauri()) throw new Error("窗口行为设置仅在 Deeptop 桌面端可用");
  return invoke<WindowBehaviorSettings>("set_window_behavior_settings", { settings });
}

export async function resolveWindowClose(behavior: Exclude<CloseBehavior, "ask">): Promise<void> {
  if (!isTauri()) return;
  await invoke("resolve_window_close", { behavior });
}

export async function listPendingWindowClose(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("list_pending_window_close");
}

export async function cancelWindowClose(): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_window_close");
}

export class DshApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(error: DshRpcError) {
    super(error.message);
    this.name = "DshApiError";
    this.code = error.code;
    this.details = error.details;
  }
}

export async function bridgeRequest<T>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!isTauri()) {
    throw new Error("Deeptop bridge 只在桌面端可用");
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException("请求已取消", "AbortError");
  const request = invoke<DshRpcResponse<T> | T>("bridge_request", { method, payload });
  const response = signal
    ? await Promise.race([request, new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("请求已取消", "AbortError")), { once: true });
    })])
    : await request;
  if (!response || typeof response !== "object") return response as T;
  if (!("result" in response)) return response as T;
  const rpcResponse = response as DshRpcResponse<T>;
  if (!rpcResponse.result) throw new Error("DSH 返回了空响应");
  if (!rpcResponse.result.ok) throw new DshApiError(rpcResponse.result.error);
  return rpcResponse.result.value;
}

export interface DshSessionRepairResult {
  repaired: boolean;
  recoveredEvents: number;
  droppedTorn: number;
  /** Committed records dropped to resolve overlapping seq branches (concurrent writers). */
  droppedSeqGap: number;
}

/** Repair a session log that DSH refuses to open after a crash. */
export async function repairCorruptSession(sessionId: string): Promise<DshSessionRepairResult> {
  return bridgeRequest<DshSessionRepairResult>("session.repairCorrupt", { sessionId });
}

/** Whether an error is the session-log corruption class DSH reports after a crash. */
export function isSessionLogCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /corrupt Zstandard session log|corrupt session log|torn JSONL|failed validation/.test(message);
}

export async function pickWorkspace(): Promise<string | null> {
  const result = await bridgeRequest<{ path: string | null }>("host.pickDirectory");
  return result.path;
}

export async function checkDsh(): Promise<DshStatus> {
  return invoke<DshStatus>("check_dsh");
}

export async function terminateDshProcesses(pids: number[]): Promise<void> {
  if (!isTauri()) return;
  await invoke("terminate_dsh_processes", { pids });
}

export async function refreshDsh(): Promise<DshStatus> {
  return invoke<DshStatus>("refresh_dsh");
}

export interface NativeUpdateResult {
  currentVersion: string;
  channel: UpdateChannel;
  latestVersion: string | null;
  releaseTag: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  assetName: string | null;
  assetSize: number | null;
  sha256: string | null;
  installSupported: boolean;
  updateAvailable: boolean;
}

/** Query the selected GitHub release channel through the native host. */
export async function checkForUpdates(channel: UpdateChannel): Promise<NativeUpdateResult> {
  if (!isTauri()) {
    return {
      currentVersion: packageInfo.version,
      channel,
      latestVersion: null,
      releaseTag: null,
      releaseName: null,
      releaseUrl: null,
      assetName: null,
      assetSize: null,
      sha256: null,
      installSupported: false,
      updateAvailable: false,
    };
  }
  return invoke<NativeUpdateResult>("check_for_updates", { args: { channel } });
}

/** Cancel the in-flight native update request; the network request is aborted by Rust. */
export async function cancelUpdateCheck(): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_update_check");
}

export async function downloadUpdate(channel: UpdateChannel, releaseTag: string): Promise<void> {
  if (!isTauri()) throw new Error("更新下载只在 Deeptop 桌面端执行");
  await invoke("download_update", { args: { channel, releaseTag } });
}

export async function cancelUpdateDownload(): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_update_download");
}

export async function launchUpdateInstaller(): Promise<void> {
  if (!isTauri()) throw new Error("更新安装只在 Deeptop 桌面端执行");
  await invoke("launch_update_installer");
}

export async function listenToUpdateProgress(handler: (progress: NativeUpdateDownloadProgress) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<NativeUpdateDownloadProgress>("app-update-progress", (event) => handler(event.payload));
}

/** Open a project or release page with the OS default browser via the native host. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri()) throw new Error("外部链接只在桌面端通过系统打开");
  await invoke("open_project_url", { url });
}

/** Open an http(s) connection through the operating system's default application. */
export async function openConnectionUrl(url: string): Promise<void> {
  if (!isTauri()) throw new Error("连接只在桌面端通过系统打开");
  await invoke("open_connection_url", { url });
}

export async function openNodejsDownload(): Promise<void> {
  if (!isTauri()) throw new Error("Node.js 下载页只在 Deeptop 桌面端通过系统打开");
  await invoke("open_nodejs_download");
}

/**
 * 弹出原生“另存为”对话框，把字节内容直接写入用户选择的位置（不经过 WebView
 * 的下载确认弹窗）。返回保存后的完整路径；用户取消或处于浏览器预览模式时返回 null。
 */
export async function saveExportFile(defaultName: string, data: Uint8Array): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("save_export_file", { defaultName, data });
}

export async function listenToBridgeEvent(handler: (event: DshBridgeEvent) => void): Promise<UnlistenFn> {
  return listen<DshBridgeEvent>("deeptop-bridge-event", (event) => handler(event.payload));
}

export async function listenToRuntimeStatus(handler: (status: DshStatus) => void): Promise<UnlistenFn> {
  return listen<DshStatus>("dsh-runtime-status", (event) => handler(event.payload));
}

export async function listenToDiagnostic(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("dsh-diagnostic", (event) => handler(event.payload));
}

export async function listenToRuntimeLog(handler: (log: DshRuntimeLog) => void): Promise<UnlistenFn> {
  return listen<DshRuntimeLog>("dsh-runtime-log", (event) => handler(event.payload));
}

/** Fetch the desktop host's buffered runtime log (survives frontend reloads). */
export async function getRuntimeLogs(): Promise<DshRuntimeLog[]> {
  if (!isTauri()) return [];
  const logs = await invoke<unknown>("get_runtime_logs");
  return Array.isArray(logs) ? (logs as DshRuntimeLog[]) : [];
}

/** Forward a frontend-originated event (window error, unhandled rejection or console.error) with its stack trace into the desktop log store. */
export async function logFrontendEvent(stream: "error" | "console", text: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("log_frontend_event", { stream, text });
  } catch {
    // Logging must never interrupt the app.
  }
}

/** Return the formatted buffered runtime log content for export. */
export async function exportRuntimeLogs(): Promise<string> {
  return invoke<string>("export_runtime_logs");
}

/** Reveal the persistent log directory in the OS file manager. */
export async function openLogsDirectory(): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_logs_directory");
}

/** One entry in the workspace file board. */
export interface WorkspaceFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export type WorkspaceGitFileStatus = "staged" | "changed" | "staged-changed" | "untracked" | "conflicted";

export interface WorkspaceGitFile {
  path: string;
  status: WorkspaceGitFileStatus;
  code: string;
  indexStatus: string;
  worktreeStatus: string;
  isRenamed: boolean;
}

export interface WorkspaceGitStatus {
  isRepository: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  changed: number;
  untracked: number;
  conflicted: number;
  files: WorkspaceGitFile[];
}

export interface WorkspaceGitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
}

export interface WorkspaceGitGraphLine {
  graph: string;
  hash: string;
  shortHash: string;
  timestamp: number;
  refs: string[];
  subject: string;
}

export interface WorkspaceGitFileStat {
  path: string;
  additions: number;
  deletions: number;
}

export interface WorkspaceGitCommitDetail {
  hash: string;
  subject: string;
  author: string;
  email: string;
  timestamp: number;
  body: string;
  files: WorkspaceGitFileStat[];
}

export interface WorkspaceGitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
  shortOid: string;
}

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  text: string;
}

export interface TerminalOption {
  id: string;
  name: string;
  description: string;
}

export interface TerminalSessionInfo {
  sessionId: string;
  terminalId: string;
}

export interface TerminalOutput {
  sessionId: string;
  stream: "pty" | "system";
  text: string;
  exited: boolean;
  exitCode?: number | null;
}

/** Detect the shell sessions available for an embedded terminal. */
export async function listTerminals(): Promise<TerminalOption[]> {
  if (!isTauri()) return [];
  const terminals = await invoke<unknown>("list_terminals");
  return Array.isArray(terminals) ? (terminals as TerminalOption[]) : [];
}

/** Start an embedded terminal session in the selected workspace. */
export async function startTerminal(workspace: string, terminalId: string): Promise<TerminalSessionInfo> {
  if (!isTauri()) throw new Error("终端只在桌面端可用");
  return invoke<TerminalSessionInfo>("start_terminal", { workspace, terminalId });
}

/** Send raw input (including a newline) to an embedded terminal session. */
export async function writeTerminal(sessionId: string, input: string): Promise<void> {
  if (!isTauri()) throw new Error("终端只在桌面端可用");
  await invoke("write_terminal", { sessionId, input });
}

/** Resize an embedded terminal session to match the rendered viewport. */
export async function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  if (!isTauri()) throw new Error("终端只在桌面端可用");
  await invoke("resize_terminal", { sessionId, cols, rows });
}

/** Stop an embedded terminal session. */
export async function closeTerminal(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("close_terminal", { sessionId });
}

export async function listenToTerminalOutput(handler: (output: TerminalOutput) => void): Promise<UnlistenFn> {
  return listen<TerminalOutput>("terminal-output", (event) => handler(event.payload));
}

/** List the entries under a workspace directory (folders first, then by name). */
export async function listWorkspaceFiles(dir: string): Promise<WorkspaceFileEntry[]> {
  if (!isTauri()) return [];
  const entries = await invoke<unknown>("list_workspace_files", { dir });
  return Array.isArray(entries) ? (entries as WorkspaceFileEntry[]) : [];
}

/** Read the current project's branch and per-file Git working tree status. */
export async function getWorkspaceGitStatus(dir: string): Promise<WorkspaceGitStatus> {
  if (!isTauri()) {
    return { isRepository: false, root: null, branch: null, upstream: null, ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicted: 0, files: [] };
  }
  return invoke<WorkspaceGitStatus>("get_workspace_git_status", { dir });
}

/** Read the unified diff of a single file (working tree or staged index). */
export async function getGitFileDiff(dir: string, path: string, staged: boolean): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("git_file_diff", { dir, path, staged });
}

/** Stage the given repository-relative paths. */
export async function stageGitPaths(dir: string, paths: string[]): Promise<void> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  await invoke("git_stage_paths", { dir, paths });
}

/** Unstage the given repository-relative paths. */
export async function unstageGitPaths(dir: string, paths: string[]): Promise<void> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  await invoke("git_unstage_paths", { dir, paths });
}

/** Discard all local changes of the given paths (worktree + index, deletes untracked files). */
export async function discardGitPaths(dir: string, paths: string[]): Promise<void> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  await invoke("git_discard_paths", { dir, paths });
}

/** Stage every change in the repository (git add -A). */
export async function stageAllGit(dir: string): Promise<void> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  await invoke("git_stage_all", { dir });
}

/** Unstage every change in the repository (git reset). */
export async function unstageAllGit(dir: string): Promise<void> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  await invoke("git_unstage_all", { dir });
}

/** Commit the staged changes with the given message. */
export async function commitGit(dir: string, message: string): Promise<GitCommandResult> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<GitCommandResult>("git_commit", { dir, message });
}

/** List recent commit history. */
export async function listGitLog(dir: string, limit = 50): Promise<WorkspaceGitCommit[]> {
  if (!isTauri()) return [];
  const result = await invoke<unknown>("git_log", { dir, limit });
  return Array.isArray(result) ? (result as WorkspaceGitCommit[]) : [];
}

/** List commit tree lines (graph prefix + hash + refs). `rev` filters to one
 * branch/ref (null = all branches); `simplify` keeps only decorated commits. */
export async function listGitGraph(
  dir: string,
  limit = 100,
  rev: string | null = null,
  simplify = false,
): Promise<WorkspaceGitGraphLine[]> {
  if (!isTauri()) return [];
  const result = await invoke<unknown>("git_graph", { dir, limit, rev, simplify });
  return Array.isArray(result) ? (result as WorkspaceGitGraphLine[]) : [];
}

/** Read the unified diff of a single file inside a specific commit. */
export async function getGitCommitFileDiff(dir: string, hash: string, path: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("git_commit_file_diff", { dir, hash, path });
}

/** Read a single commit's message and per-file change stats. */
export async function getGitCommitDetail(dir: string, hash: string): Promise<WorkspaceGitCommitDetail> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<WorkspaceGitCommitDetail>("git_commit_detail", { dir, hash });
}

/** List local and remote branches. */
export async function listGitBranches(dir: string): Promise<WorkspaceGitBranch[]> {
  if (!isTauri()) return [];
  const result = await invoke<unknown>("git_branches", { dir });
  return Array.isArray(result) ? (result as WorkspaceGitBranch[]) : [];
}

/** Switch to an existing branch. */
export async function checkoutGitBranch(dir: string, name: string): Promise<GitCommandResult> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<GitCommandResult>("git_checkout_branch", { dir, name });
}

/** Create a branch from HEAD and switch to it. */
export async function createGitBranch(dir: string, name: string): Promise<GitCommandResult> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<GitCommandResult>("git_create_branch", { dir, name });
}

/** Force-delete a local branch (current branch is guarded). */
export async function deleteGitBranch(dir: string, name: string): Promise<GitCommandResult> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<GitCommandResult>("git_delete_branch", { dir, name });
}

/** Pull from the current branch's upstream. */
export async function pullGit(dir: string): Promise<GitCommandResult> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<GitCommandResult>("git_pull", { dir });
}

/** Push the current branch (sets up upstream tracking on first push). */
export async function pushGit(dir: string): Promise<GitCommandResult> {
  if (!isTauri()) throw new Error("Git 管理只在桌面端可用");
  return invoke<GitCommandResult>("git_push", { dir });
}

/** Open a file or folder in VSCode (falls back to the OS default opener). */
export async function openInVscode(path: string): Promise<void> {
  await invoke("open_in_vscode", { path });
}

/** Write text through the native system clipboard. */
export async function writeClipboard(text: string): Promise<void> {
  if (!isTauri()) throw new Error("系统剪贴板只在桌面端可用");
  await invoke("write_clipboard", { text });
}

/** Reveal a path in the OS file manager. */
export async function revealInExplorer(path: string): Promise<void> {
  await invoke("reveal_in_explorer", { path });
}

/** Check through the native host whether a path resolves to a regular file. */
export async function isFilePath(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("is_file_path", { path });
}

/** Permanently delete a file or folder (recursively for folders). */
export async function deleteWorkspacePath(path: string): Promise<void> {
  await invoke("delete_workspace_path", { path });
}

/** Create a new folder under a parent directory; returns its full path. */
export async function createWorkspaceFolder(parent: string, name: string): Promise<string> {
  return invoke<string>("create_workspace_folder", { parent, name });
}

/** Locations of the default external dark-theme CSS files (seeded under the DSH home). */
export interface ThemeFilesInfo {
  themesDir: string;
  monokaiPro: string;
  oneDark: string;
}

/** Content of a theme CSS file read from disk. */
export interface ThemeCssContent {
  path: string;
  content: string;
}

/**
 * Ensure the DSH home themes directory exists with the default theme files.
 * Returns the default theme paths (used as the default "theme CSS path");
 * falls back to null in the browser preview where no native layer is available.
 */
export async function ensureThemeFiles(): Promise<ThemeFilesInfo | null> {
  if (!isTauri()) return null;
  return invoke<ThemeFilesInfo>("ensure_theme_files");
}

/** Read a theme CSS file by its absolute path. */
export async function readThemeCss(path: string): Promise<ThemeCssContent> {
  return invoke<ThemeCssContent>("read_theme_css", { path });
}

/** Open the native file picker for a theme CSS file; returns null when cancelled. */
export async function pickThemeCss(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("pick_theme_css");
}

/** Open the native file picker for a desktop plugin entry file; returns null when cancelled. */
export async function pickPluginEntry(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("pick_plugin_entry");
}

/** Reveal the themes directory in the OS file manager. */
export async function openThemesDirectory(): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_themes_directory");
}
