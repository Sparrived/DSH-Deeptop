// Pure data model for the Deeptop desktop UI plugin runtime (docs/DEEPTOP_UI_RUNTIME.md).
// No React, Tauri, or bridge imports: everything here is serializable protocol
// data and deterministic helpers shared by the client runtime and its tests.
//
// Slot names are duplicated in cordis/ui-registry/manifest.mjs (host side);
// keep the two lists identical when extending them.

export const UI_RUNTIME_SLOTS = [
  "session.sidebar.header",
  "session.context-menu",
  "session.row.leading",
  "session.row.trailing",
  "conversation.header.actions",
  "conversation.message.actions",
  "inspector.tabs",
  "settings.sections",
  "composer.actions",
] as const;

export type UiRuntimeSlot = (typeof UI_RUNTIME_SLOTS)[number];

export const UI_RUNTIME_SCHEMA_VERSION = 1;

/** Client SDK version of this build's UI runtime; plugins declare compatibility against it. */
export const UI_RUNTIME_SDK_VERSION = "1.0.0";

export type UiPluginStatus =
  | "available"
  | "disabled"
  | "incompatible"
  | "load-failed"
  | "activate-failed"
  | "host-unavailable";

/** Stable error codes emitted by the desktop bridge for ui.plugin.* routes. */
export const UiPluginErrorCode = {
  pluginNotFound: "ui-plugin-not-found",
  pluginDisabled: "ui-plugin-disabled",
  capabilityDenied: "ui-capability-denied",
  remoteMethodNotDeclared: "ui-remote-method-not-declared",
  remoteInvalidArgs: "ui-remote-invalid-args",
  hostUnavailable: "ui-host-unavailable",
  invalidRequest: "ui-invalid-request",
  manifestInvalid: "ui-manifest-invalid",
  moduleUnavailable: "ui-module-unavailable",
  storageLimitExceeded: "ui-storage-limit-exceeded",
  storageInvalidKey: "ui-storage-invalid-key",
  settingsInvalidRequest: "ui-settings-invalid-request",
} as const;

export type UiPluginErrorCodeValue = (typeof UiPluginErrorCode)[keyof typeof UiPluginErrorCode];

export interface DshUiPluginRemoteCapability {
  namespace: string;
  methods: string[];
}

export interface DshUiPluginCapabilities {
  remotes: DshUiPluginRemoteCapability[];
  events?: string[];
  storage?: string;
  /**
   * Settings namespaces this plugin may read and write through the scoped
   * settings routes. Declaring one is the ceiling, not a grant: the plugin
   * still has to name the namespace on every call, and the host refuses any
   * namespace missing from this list.
   */
  settings?: string[];
}

/** Declarative contribution registered by a host-only Cordis plugin; rendered by native generic renderers. */
export interface DshDeclarativeContribution {
  kind: "action" | "badge";
  id: string;
  slot: UiRuntimeSlot;
  label: string;
  order?: number;
  invoke?: { namespace: string; method: string };
}

/** One item of the `ui.plugin.list` response. */
export interface DshUiPluginDescriptor {
  pluginId: string;
  version: string;
  displayName?: string;
  status: UiPluginStatus;
  client?: {
    entryId: string;
    format: "esm";
    sdkVersion: string;
    integrity?: string;
  };
  slots: string[];
  capabilities: DshUiPluginCapabilities;
  contributions: DshDeclarativeContribution[];
  diagnostic?: string;
}

/** Minimal, serializable session view handed to slot contributions. */
export interface SessionUiContext {
  sessionId: string;
  title: string;
  cwd?: string;
  running: boolean;
  blank: boolean;
  agentPreset?: string;
}

/**
 * Validate one raw `ui.plugin.list` item into a typed descriptor. Returns the
 * descriptor plus a diagnostic when rejected, so the Inspector can show why a
 * plugin was skipped instead of failing the whole catalog.
 */
export function normalizeUiPluginDescriptor(raw: unknown): { descriptor: DshUiPluginDescriptor | null; diagnostic?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { descriptor: null, diagnostic: "清单项不是对象" };
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.pluginId !== "string" || record.pluginId.trim() === "") {
    return { descriptor: null, diagnostic: "缺少 pluginId" };
  }
  if (typeof record.version !== "string") {
    return { descriptor: null, diagnostic: `${record.pluginId}: 缺少版本号` };
  }
  const slots = Array.isArray(record.slots) ? record.slots.filter((slot): slot is UiRuntimeSlot => typeof slot === "string" && isUiRuntimeSlot(slot)) : [];
  if (slots.length === 0) {
    // Without a known slot neither client modules nor declarative items could render.
    return { descriptor: null, diagnostic: `${record.pluginId}: 没有已知 Slot` };
  }
  const status = typeof record.status === "string" ? record.status : "available";
  const capabilities = readCapabilities(record.capabilities);
  const contributions = readContributions(record.contributions);
  const descriptor: DshUiPluginDescriptor = {
    pluginId: record.pluginId,
    version: record.version,
    ...(typeof record.displayName === "string" ? { displayName: record.displayName } : {}),
    status: isUiPluginStatus(status) ? status : "available",
    ...(hasClientBlock(record)
      ? {
          client: {
            entryId: String((record.client as Record<string, unknown>).entryId ?? ""),
            format: "esm",
            sdkVersion: String((record.client as Record<string, unknown>).sdkVersion ?? "^0.0.0"),
          },
        }
      : {}),
    slots,
    capabilities,
    contributions,
    ...(typeof record.diagnostic === "string" ? { diagnostic: record.diagnostic } : {}),
  };
  if (descriptor.client && descriptor.client.entryId === "") {
    return { descriptor: null, diagnostic: `${descriptor.pluginId}: client.entryId 为空` };
  }
  return { descriptor };
}

function hasClientBlock(record: Record<string, unknown>): boolean {
  return typeof record.client === "object" && record.client !== null && !Array.isArray(record.client);
}

function readCapabilities(raw: unknown): DshUiPluginCapabilities {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { remotes: [] };
  const record = raw as Record<string, unknown>;
  const remotes = Array.isArray(record.remotes)
    ? record.remotes
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
        .flatMap((item) => {
          if (typeof item.namespace !== "string" || !Array.isArray(item.methods)) return [];
          return [{
            namespace: item.namespace,
            methods: item.methods.filter((method): method is string => typeof method === "string"),
          }];
        })
    : [];
  const settings = Array.isArray(record.settings)
    ? record.settings.filter((ns): ns is string => typeof ns === "string" && ns.trim() !== "")
    : [];
  return {
    remotes,
    ...(Array.isArray(record.events) ? { events: record.events.filter((event): event is string => typeof event === "string") } : {}),
    ...(typeof record.storage === "string" ? { storage: record.storage } : {}),
    ...(settings.length > 0 ? { settings } : {}),
  };
}

function readContributions(raw: unknown): DshDeclarativeContribution[] {
  if (!Array.isArray(raw)) return [];
  const result: DshDeclarativeContribution[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const slot = typeof record.slot === "string" && isUiRuntimeSlot(record.slot) ? record.slot : null;
    if ((record.kind !== "action" && record.kind !== "badge")
      || typeof record.id !== "string"
      || typeof record.label !== "string"
      || slot === null) {
      continue;
    }
    const invoke = (typeof record.invoke === "object" && record.invoke !== null && !Array.isArray(record.invoke)
      && typeof (record.invoke as Record<string, unknown>).namespace === "string"
      && typeof (record.invoke as Record<string, unknown>).method === "string")
      ? {
          namespace: String((record.invoke as Record<string, unknown>).namespace),
          method: String((record.invoke as Record<string, unknown>).method),
        }
      : undefined;
    if (record.kind === "action" && !invoke) continue;
    const order = typeof record.order === "number" && Number.isFinite(record.order) ? record.order : undefined;
    result.push({
      kind: record.kind,
      id: record.id,
      slot,
      label: record.label,
      ...(order !== undefined ? { order } : {}),
      ...(invoke ? { invoke } : {}),
    });
  }
  return result;
}

export function isUiRuntimeSlot(value: string): value is UiRuntimeSlot {
  return (UI_RUNTIME_SLOTS as readonly string[]).includes(value);
}

function isUiPluginStatus(value: string): value is UiPluginStatus {
  return ["available", "disabled", "incompatible", "load-failed", "activate-failed", "host-unavailable"].includes(value);
}

/**
 * Check one manifest SDK range (`^1.0.0`, `~1.2.3`, or exact) against this
 * build's runtime version. Major mismatch always fails; `~` pins the minor.
 */
export function sdkVersionCompatible(range: string, runtimeVersion: string): boolean {
  const rangeMatch = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  const runtimeMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(runtimeVersion.trim());
  if (!rangeMatch || !runtimeMatch) return false;
  const [, operator = "", rangeMajor, rangeMinor] = rangeMatch;
  const [, runtimeMajor, runtimeMinor] = runtimeMatch;
  if (Number(rangeMajor) !== Number(runtimeMajor)) return false;
  if (operator === "~" && Number(rangeMinor) !== Number(runtimeMinor)) return false;
  return true;
}

/** Stable contribution ordering: explicit order first, then pluginId, then contribution id. */
export function compareContributionOrder(
  left: Pick<DshDeclarativeContribution, "order" | "id"> & { pluginId: string },
  right: Pick<DshDeclarativeContribution, "order" | "id"> & { pluginId: string },
): number {
  const leftOrder = left.order ?? 0;
  const rightOrder = right.order ?? 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.pluginId !== right.pluginId) return left.pluginId < right.pluginId ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** Project one session summary into the minimal slot context; never leaks internal objects. */
export function toSessionUiContext(summary: {
  sessionId: string;
  running: boolean;
  blank: boolean;
  cwd?: string;
  agentPreset?: string;
}, title: string): SessionUiContext {
  return {
    sessionId: summary.sessionId,
    title,
    ...(summary.cwd ? { cwd: summary.cwd } : {}),
    running: summary.running,
    blank: summary.blank,
    ...(summary.agentPreset ? { agentPreset: summary.agentPreset } : {}),
  };
}
