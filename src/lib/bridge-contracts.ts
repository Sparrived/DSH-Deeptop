import type {
  DshCapabilityKey,
  DshCommandDescriptor,
  DshCommandExecution,
  DshCredential,
  DshFileReferenceCandidate,
  DshHistoryEntry,
  DshMessageAnnotationItem,
  DshMessageAnnotationResult,
  DshPluginConfigDescription,
  DshPluginConfigMutation,
  DshPluginInventorySnapshot,
  DshPresetRoster,
  DshProvider,
  DshSessionModels,
  DshSessionPromptPayload,
  DshSessionReferenceCandidate,
  DshSessionRepairResult,
  DshSessionSummary,
  DshSettingsDescription,
  DshNetworkProxy,
  DshNetworkProxyResult,
  DshNetworkProxySnapshot,
  DshSkill,
  DshSkillInstallResult,
  DshSubagentCatalog,
  DshWorkspace,
} from "./desktop";
import type { DiscoveredModel, DshHostModelCatalog } from "../app/model-types";
import type { DshUiPluginDescriptor } from "../app/ui-plugin-model";

/** 每个契约条目：载荷/返回值形状 + 依赖的能力键。 */
export interface BridgeMethodContract {
  payload: unknown;
  value: unknown;
  requires: DshCapabilityKey;
}

/**
 * 官方 Remote/桌面桥能力的统一契约登记。
 *
 * 每个条目声明一件事：方法名、载荷形状、返回值形状，以及该能力依赖的
 * Host 服务（`requires`）。调用方通过 `desktop-api.ts` 的 `desktopRequest`
 * 取得与登记一致的载荷/返回值类型推断，不再在 `App.tsx` 等调用点手写结果
 * 类型；能力探测（`desktop.capabilities`）与 `requires` 对应，缺失时由类型化
 * 错误码（`*-unavailable` / `bridge-unavailable`）驱动统一的降级路径。
 *
 * 本模块保持纯数据与类型推导（仅 `import type`），可在 Node 测试中直接导入。
 */

export interface DshSessionHistoryResult {
  events: DshHistoryEntry[];
  hasMore: boolean;
  projections?: {
    asOfSeq?: number;
    values: Record<string, unknown>;
  };
}

export type DshSessionExportResult = {
  base64: string;
  contentType: string;
  filename: string;
  size: number;
};

export interface DshAttachmentResult {
  attachment: { mediaType: string; name?: string };
  data: string;
}

export interface DshRemoteInvokeContract<A = Record<string, unknown>, V = unknown> {
  namespace: string;
  method: string;
  requires: DshCapabilityKey;
  args: A;
  value: V;
}

const session = {
  "session.list": {
    requires: "sessions",
    payload: {} as { cwd?: string; includeArchived?: boolean },
    value: {} as { items: DshSessionSummary[] },
  },
  "session.search": {
    requires: "sessions",
    payload: {} as { query: string },
    value: {} as { items: Array<{ sessionId: string; snippet?: string }>; hasMore?: boolean },
  },
  "session.create": {
    requires: "sessions",
    payload: {} as { workspaceId?: string; cwd?: string; agentPreset?: string },
    value: {} as { sessionId: string; agentPreset?: string },
  },
  "session.history": {
    requires: "sessions",
    payload: {} as { sessionId: string; maxMessages?: number; beforeSeq?: number },
    value: {} as DshSessionHistoryResult,
  },
  "session.models": {
    requires: "sessions",
    payload: {} as { sessionId: string },
    value: {} as DshSessionModels,
  },
  "session.selectModel": {
    requires: "sessions",
    payload: {} as { sessionId: string; provider: string; model: string; reasoningEffort?: string },
    value: {} as unknown,
  },
  "session.rename": {
    requires: "sessions",
    payload: {} as { sessionId: string; title: string },
    value: {} as unknown,
  },
  "session.fork": {
    requires: "sessions",
    payload: {} as { sessionId: string; atSeq?: number; agentPreset?: string },
    value: {} as { sessionId: string },
  },
  "session.prompt": {
    requires: "sessions",
    payload: {} as DshSessionPromptPayload,
    value: {} as { accepted: boolean },
  },
  "session.attachment": {
    requires: "sessions",
    payload: {} as { sessionId: string; attachmentId: string },
    value: {} as DshAttachmentResult,
  },
  "session.cancel": {
    requires: "sessions",
    payload: {} as { sessionId: string },
    value: {} as unknown,
  },
  "session.exportZip": {
    requires: "sessionExport",
    payload: {} as { sessionId: string; includeDescendants?: boolean },
    value: {} as DshSessionExportResult,
  },
  "session.updateQueue": {
    requires: "sessions",
    payload: {} as { sessionId: string; itemId: string; action: Record<string, unknown> },
    value: {} as unknown,
  },
  "session.repairCorrupt": {
    requires: "sessions",
    payload: {} as { sessionId: string },
    value: {} as DshSessionRepairResult,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const workspace = {
  "workspace.list": {
    requires: "workspace",
    payload: {} as Record<string, never>,
    value: {} as { items: DshWorkspace[]; archivedSessionIds?: string[] },
  },
  "workspace.create": {
    requires: "workspace",
    payload: {} as { path: string },
    value: {} as { workspace: DshWorkspace },
  },
  "workspace.attachSession": {
    requires: "workspace",
    payload: {} as { workspaceId: string; sessionId: string },
    value: {} as { workspace: DshWorkspace },
  },
  "workspace.rename": {
    requires: "workspace",
    payload: {} as { workspaceId: string; title: string },
    value: {} as { workspace: DshWorkspace },
  },
  "workspace.delete": {
    requires: "workspace",
    payload: {} as { workspaceId: string },
    value: {} as unknown,
  },
  "workspace.insertSessionBefore": {
    requires: "workspace",
    payload: {} as { workspaceId: string; sessionId: string; beforeSessionId: string },
    value: {} as unknown,
  },
  "workspace.archiveSession": {
    requires: "workspace",
    payload: {} as { sessionId: string },
    value: {} as unknown,
  },
  "workspace.restoreSession": {
    requires: "workspace",
    payload: {} as { sessionId: string },
    value: {} as { archivedSessionIds: string[] },
  },
  "workspace.deleteArchivedSession": {
    requires: "workspace",
    payload: {} as { sessionId: string },
    value: {} as { deleted: boolean; archivedSessionIds: string[] },
  },
  "workspace.setSessionPinned": {
    requires: "workspace",
    payload: {} as { workspaceId: string; sessionId: string; pinned: boolean },
    value: {} as { workspaceId: string; pinnedSessionIds: string[] },
  },
} as const satisfies Record<string, BridgeMethodContract>;

const references = {
  "reference.files": {
    requires: "references",
    payload: {} as { sessionId: string; query?: string },
    value: {} as { items: DshFileReferenceCandidate[] },
  },
  "reference.sessions": {
    requires: "references",
    payload: {} as { sessionId: string; query?: string },
    value: {} as { items: DshSessionReferenceCandidate[] },
  },
} as const satisfies Record<string, BridgeMethodContract>;

const annotations = {
  "messageAnnotations.list": {
    requires: "annotations",
    payload: {} as { sessionId: string },
    value: {} as DshMessageAnnotationResult<{ items: DshMessageAnnotationItem[] }>,
  },
  "messageAnnotations.put": {
    requires: "annotations",
    payload: {} as { sessionId: string; messageId: string; note: string; ifVersion: string | null },
    value: {} as DshMessageAnnotationResult<DshMessageAnnotationItem>,
  },
  "messageAnnotations.delete": {
    requires: "annotations",
    payload: {} as { sessionId: string; messageId: string; ifVersion: string },
    value: {} as DshMessageAnnotationResult<{ absent: true }>,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const agents = {
  "subagent.list": {
    requires: "subagents",
    payload: {} as { parentSessionId: string },
    value: {} as DshSubagentCatalog,
  },
  "subagent.history": {
    requires: "subagents",
    payload: {} as { parentSessionId: string; childSessionId: string; mode?: string },
    value: {} as { events: DshHistoryEntry[] },
  },
  "subagent.prompt": {
    requires: "subagents",
    payload: {} as { parentSessionId: string; childSessionId: string; mode: string; content: DshSessionPromptPayload["content"]; clientTimeZone?: string },
    value: {} as unknown,
  },
  "subagent.interrupt": {
    requires: "subagents",
    payload: {} as { parentSessionId: string; childSessionId: string; mode: string },
    value: {} as unknown,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const skills = {
  "skill.list": {
    requires: "skills",
    payload: {} as { sessionId: string },
    value: {} as { skills: DshSkill[] },
  },
  "skill.install": {
    requires: "skills",
    payload: {} as { source: string; ref?: string; name?: string; method?: string },
    value: {} as DshSkillInstallResult,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const presets = {
  "agentPreset.list": {
    requires: "agentPresets",
    payload: {} as Record<string, never>,
    value: {} as DshPresetRoster,
  },
  "agentPreset.select": {
    requires: "agentPresets",
    payload: {} as { agentPreset: string },
    value: {} as unknown,
  },
  "agentPreset.read": {
    requires: "agentPresets",
    payload: {} as { agentPreset: string },
    value: {} as { agentPreset: string; content: string },
  },
  "agentPreset.copy": {
    requires: "agentPresets",
    payload: {} as { from: string; agentPreset: string; name?: string },
    value: {} as unknown,
  },
  "agentPreset.openDocument": {
    requires: "agentPresets",
    payload: {} as { agentPreset: string },
    value: {} as { opened: true } | { opened: false; path: string },
  },
  "agentPreset.remove": {
    requires: "agentPresets",
    payload: {} as { agentPreset: string },
    value: {} as unknown,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const goals = {
  "goal.create": {
    requires: "goals",
    payload: {} as { sessionId: string; objective: string; maxGoalRounds?: number },
    value: {} as unknown,
  },
  "goal.edit": {
    requires: "goals",
    payload: {} as { sessionId: string; ref: { id: string; revision: number }; objective: string; maxGoalRounds: number },
    value: {} as unknown,
  },
  "goal.pause": {
    requires: "goals",
    payload: {} as { sessionId: string; ref: { id: string; revision: number } },
    value: {} as unknown,
  },
  "goal.resume": {
    requires: "goals",
    payload: {} as { sessionId: string; ref: { id: string; revision: number } },
    value: {} as unknown,
  },
  "goal.complete": {
    requires: "goals",
    payload: {} as { sessionId: string; ref: { id: string; revision: number } },
    value: {} as unknown,
  },
  "goal.clear": {
    requires: "goals",
    payload: {} as { sessionId: string; ref: { id: string; revision: number } },
    value: {} as unknown,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const settings = {
  "settings.describe": {
    requires: "settings",
    payload: {} as Record<string, never>,
    value: {} as DshSettingsDescription,
  },
  "settings.update": {
    requires: "settings",
    payload: {} as { ns: string; patch: Record<string, unknown>; expectedRevision?: number },
    value: {} as unknown,
  },
  "settings.replace": {
    requires: "settings",
    payload: {} as { ns: string; value: unknown; expectedRevision?: number },
    value: {} as unknown,
  },
  "settings.mutate": {
    requires: "settings",
    payload: {} as { ns: string; ops: Array<{ op: string; path: string[]; value?: unknown }>; expectedRevision?: number },
    value: {} as unknown,
  },
  "settings.openDocument": {
    requires: "settings",
    payload: {} as Record<string, never>,
    value: {} as unknown,
  },
  "credentials.describe": {
    requires: "credentials",
    payload: {} as { refs: string[] },
    value: {} as { credentials: Record<string, DshCredential> },
  },
  "credentials.set": {
    requires: "credentials",
    payload: {} as { ref: string; value: string },
    value: {} as unknown,
  },
  "credentials.unset": {
    requires: "credentials",
    payload: {} as { ref: string },
    value: {} as unknown,
  },
  "network.getProxy": {
    requires: "settings",
    payload: {} as Record<string, never>,
    value: {} as DshNetworkProxySnapshot,
  },
  "network.setProxy": {
    requires: "settings",
    payload: {} as { proxy: DshNetworkProxy },
    value: {} as DshNetworkProxyResult,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const llm = {
  "llm.providers": {
    requires: "llm",
    payload: {} as Record<string, never>,
    value: {} as { providers: DshProvider[] },
  },
  "llm.models": {
    requires: "llm",
    payload: {} as Record<string, never>,
    value: {} as DshHostModelCatalog,
  },
  "llm.discoverModels": {
    requires: "llm",
    payload: {} as { provider?: string; settingsNs?: string; baseURL?: string; api?: string; apiKey?: string },
    value: {} as { models: DiscoveredModel[] },
  },
} as const satisfies Record<string, BridgeMethodContract>;

const host = {
  "host.describe": {
    requires: "sessions",
    payload: {} as Record<string, never>,
    value: {} as Record<string, unknown>,
  },
  "host.pickDirectory": {
    requires: "workspace",
    payload: {} as Record<string, never>,
    value: {} as { path: string | null },
  },
  "host.openPath": {
    requires: "sessions",
    payload: {} as { path: string },
    value: {} as unknown,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const desktop = {
  "respond": {
    requires: "sessions",
    payload: {} as {
      type: "client-response";
      rpcId: string;
      result: {
        ok: boolean;
        value?: Record<string, unknown>;
        error?: { code: string; message: string; details?: unknown };
      };
    },
    value: {} as unknown,
  },
} as const satisfies Record<string, BridgeMethodContract>;

const plugins = {
  "plugin.list": {
    requires: "plugins",
    payload: {} as Record<string, never>,
    value: {} as DshPluginInventorySnapshot,
  },  "plugin.config.describe": {
    requires: "plugins",
    payload: {} as Record<string, never>,
    value: {} as DshPluginConfigDescription,
  },
  "plugin.config.mutate": {
    requires: "plugins",
    payload: {} as { expectedRevision: number; plugins: Array<{ id: string; name: string; enabled: boolean }> },
    value: {} as DshPluginConfigMutation,
  },
} as const satisfies Record<string, BridgeMethodContract>;

/**
 * UI 插件运行时（docs/DEEPTOP_UI_RUNTIME.md）受限路由契约。
 * `ui.plugin.bundle` 是宿主专用：仅 Tauri 进程解析受控资源时调用，
 * 返回本地 bundle 路径，绝不转发给 WebView。
 */
const ui = {
  "ui.plugin.list": {
    requires: "uiPlugins",
    payload: {} as Record<string, never>,
    value: {} as { items: DshUiPluginDescriptor[] },
  },
  "ui.plugin.module": {
    requires: "uiPlugins",
    payload: {} as { pluginId: string },
    value: {} as {
      pluginId: string;
      entryId: string;
      format: "esm";
      sdkVersion: string;
      integrity?: string;
    },
  },
  "ui.plugin.bundle": {
    requires: "uiPlugins",
    payload: {} as { pluginId: string },
    value: {} as { pluginId: string; entryPath: string; format: "esm"; integrity?: string },
  },
  "ui.plugin.invoke": {
    requires: "uiPlugins",
    payload: {} as { pluginId: string; namespace: string; method: string; args: unknown },
    value: {} as { value: unknown },
  },
  "ui.plugin.storage.get": {
    requires: "uiPlugins",
    payload: {} as { pluginId: string; key: string },
    value: {} as { value: unknown },
  },
  "ui.plugin.storage.set": {
    requires: "uiPlugins",
    payload: {} as { pluginId: string; key: string; value: unknown },
    value: {} as { stored: boolean },
  },
  "ui.plugin.storage.delete": {
    requires: "uiPlugins",
    payload: {} as { pluginId: string; key: string },
    value: {} as { deleted: boolean },
  },
} as const satisfies Record<string, BridgeMethodContract>;

export const bridgeContracts = {
  ...session,
  ...workspace,
  ...references,
  ...annotations,
  ...agents,
  ...skills,
  ...presets,
  ...goals,
  ...settings,
  ...llm,
  ...host,
  ...desktop,
  ...plugins,
  ...ui,
} as const;

export type BridgeMethodName = keyof typeof bridgeContracts;
export type BridgeMethodPayload<M extends BridgeMethodName> = (typeof bridgeContracts)[M]["payload"];
export type BridgeMethodValue<M extends BridgeMethodName> = (typeof bridgeContracts)[M]["value"];

/**
 * 官方 Remote 命名空间（经 `typertGateway` 转发的 Host Remote 方法）契约。
 * 与 bridge 契约登记共用 `requires` 能力键，能力探测与降级语义一致。
 */
export const remoteContracts = {
  "commands/list": {
    namespace: "commands",
    method: "list",
    requires: "commands",
    args: {} as { agentId: string },
    value: {} as DshCommandDescriptor[],
  },
  "commands/execute": {
    namespace: "commands",
    method: "execute",
    requires: "commands",
    args: {} as { agentId: string; line: string; images: unknown[] },
    value: {} as DshCommandExecution | undefined,
  },
} as const satisfies Record<string, DshRemoteInvokeContract>;

export type RemoteMethodName = keyof typeof remoteContracts;
export type RemoteMethodArgs<K extends RemoteMethodName> = (typeof remoteContracts)[K]["args"];
export type RemoteMethodValue<K extends RemoteMethodName> = (typeof remoteContracts)[K]["value"];

/** 从任意错误中提取稳定的错误码；非 DshApiError 返回 undefined。 */
export function bridgeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

/** DSH 桥未就绪类错误（进程退出、重启窗口、未启动）。 */
export function isBridgeUnavailableError(error: unknown): boolean {
  return bridgeErrorCode(error) === "bridge-unavailable";
}

/** 能力缺失/服务不可用类错误：`*-unavailable` 与桥未就绪（`bridge-unavailable`）。 */
export function isCapabilityUnavailable(error: unknown): boolean {
  const code = bridgeErrorCode(error);
  if (code === undefined) return false;
  return code === "bridge-unavailable" || /-unavailable$/.test(code);
}

/** 契约要求的能力键；用于探测与降级对照。 */
export function capabilityRequiredBy(method: BridgeMethodName): DshCapabilityKey {
  return bridgeContracts[method].requires;
}

export type { BridgeRequestOptions } from "./desktop";
