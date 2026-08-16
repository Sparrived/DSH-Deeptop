import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const DSH_PACKAGE = "@deepseek-ai/dsh@latest";

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
}

export type DshRuntimeLogStream = "command" | "stdout" | "stderr" | "diagnostic";

export interface DshRuntimeLog {
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

export type DshInputModality = "text" | "image";

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
}

export interface DshWorkspace {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
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

export interface DshPluginInventoryEntry {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: DshPluginFiberPhase;
}

export interface DshPluginInventorySnapshot {
  entries: DshPluginInventoryEntry[];
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
  intent?: string;
  options?: Array<{ label: string; description?: string; recommended?: boolean }>;
  multiSelect?: boolean;
  custom?: boolean;
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

export async function listenToSingleInstance(handler: () => void): Promise<UnlistenFn> {
  return listen("single-instance", () => handler());
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

export async function bridgeRequest<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) {
    throw new Error("Deeptop bridge 只在桌面端可用");
  }
  const response = await invoke<DshRpcResponse<T> | T>("bridge_request", { method, payload });
  if (!response || typeof response !== "object") return response as T;
  if (!("result" in response)) return response as T;
  const rpcResponse = response as DshRpcResponse<T>;
  if (!rpcResponse.result) throw new Error("DSH 返回了空响应");
  if (!rpcResponse.result.ok) throw new DshApiError(rpcResponse.result.error);
  return rpcResponse.result.value;
}

export async function pickWorkspace(): Promise<string | null> {
  const result = await bridgeRequest<{ path: string | null }>("host.pickDirectory");
  return result.path;
}

export async function checkDsh(): Promise<DshStatus> {
  return invoke<DshStatus>("check_dsh");
}

export async function refreshDsh(): Promise<DshStatus> {
  return invoke<DshStatus>("refresh_dsh");
}

export async function openNodejsDownload(): Promise<void> {
  if (!isTauri()) {
    window.open("https://nodejs.org/en/download", "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("open_nodejs_download");
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
