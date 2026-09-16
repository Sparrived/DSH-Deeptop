// Client-side contracts for the Deeptop desktop UI plugin runtime
// (docs/DEEPTOP_UI_RUNTIME.md §7). Types only — no runtime code, per the
// repository layout convention shared with DSH packages.

import type { ComponentType } from "react";
import type {
  DshDeclarativeContribution,
  DshUiPluginDescriptor,
  SessionUiContext,
  UiPluginErrorCodeValue,
  UiRuntimeSlot,
} from "../../app/ui-plugin-model.ts";
import type { UiLocale } from "../../app/i18n.ts";
import type { SchemaPathOp } from "../../app/schema-form-model.ts";
// Wire shape of one settings namespace; a type-only import so the UI runtime
// still carries no transport code.
import type { DshSettingsNamespace } from "../desktop.ts";

/** Data for one message-level UI contribution. */
export interface MessageUiContext {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  seq?: number;
}

/** Host-owned UI primitives exposed to trusted and controlled client modules. */
export interface UiPromptRequest {
  title: string;
  value?: string;
  description?: string;
}

export type UiNoticeKind = "info" | "error";

export interface UiHostActions {
  prompt(request: UiPromptRequest, signal?: AbortSignal): Promise<string | null>;
  notify(message: string, kind?: UiNoticeKind): void;
}

/** Why a plugin was asked to deactivate. */
export type DeactivateReason =
  | "host-restarted"
  | "plugin-removed"
  | "runtime-disposed"
  | "incompatible"
  | "manual";

/**
 * Settings-section facts supplied only to `settings.sections` contributions.
 *
 * One contribution renders twice — as a nav entry and, when selected, as the
 * content panel — so the section id is the shared identity between the two
 * render sites.
 */
export interface SettingsSectionContext {
  /** Section id currently shown in the content column; null when none has been selected. */
  activeSectionId: string | null;
  /** Select one settings section, whether built-in or plugin-contributed. */
  selectSection: (id: string) => void;
}

/** Slot data and the narrow host UI facade passed to every contribution. */
export interface SlotRenderContext {
  /** Target session of the row / menu / header the outlet lives in; null on global slots. */
  session: SessionUiContext | null;
  /** Session currently open in the conversation area. */
  activeSessionId: string | null;
  /** Generation of the current session context; stale async writes must not commit. */
  sessionGeneration: number;
  /** Message target for conversation.message.actions; absent on other slots. */
  message?: MessageUiContext;
  /** Settings-section selection; absent on every slot but `settings.sections`. */
  settings?: SettingsSectionContext;
  /** Locale and native prompt/notice operations supplied by the host surface. */
  locale: UiLocale;
  host: UiHostActions;
}

/**
 * A contribution label: either a fixed string or a function of the live locale.
 *
 * `activate()` runs once, so a label captured from `context.locale` at that
 * moment freezes across language switches and the nav keeps the old language.
 * A plugin whose label is translated therefore supplies a function and the host
 * resolves it while rendering.
 */
export type ContributionLabel = string | ((locale: UiLocale) => string);

/** Component-based contribution registered by an activated client module. */
export interface UiContribution {
  kind: "action" | "badge" | "panel";
  id: string;
  order?: number;
  label?: ContributionLabel;
  title?: string;
  render: ComponentType<SlotRenderContext>;
}

/** One renderable entry inside a slot: either declarative (host-provided) or component-based. */
export interface RegisteredContribution {
  pluginId: string;
  slot: UiRuntimeSlot;
  contributionId: string;
  kind?: UiContribution["kind"];
  order?: number;
  /** Registrant-supplied nav label, resolved against the live locale by the settings nav. */
  label?: ContributionLabel;
  title?: string;
  declarative: DshDeclarativeContribution | null;
  render?: ComponentType<SlotRenderContext>;
}

/** Scoped remote access limited to the plugin's declared namespaces/methods. */
export interface ScopedRemoteClient {
  /** Invoke within the single declared namespace; rejects when several are declared. */
  invoke<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
  /** Invoke within one explicitly named declared namespace. */
  invokeIn<T = unknown>(namespace: string, method: string, args?: Record<string, unknown>): Promise<T>;
}

/** Scoped event subscription limited to the plugin's declared event names. */
export interface ScopedEventClient {
  on(event: string, handler: (payload: unknown) => void | Promise<void>): () => void;
}

/** Namespace-scoped JSON storage backed by the host registry service. */
export interface ScopedStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Settings access limited to the namespaces the manifest declared.
 *
 * A plugin that ships a settings panel describes one of its own namespaces,
 * renders the returned schema, and writes path-addressed ops back — the same
 * generic form path the desktop app uses for built-in namespaces. Secrets
 * never arrive: the host route reads under `redactSecrets`.
 */
export interface ScopedSettings {
  /** Namespaces this plugin declared; empty when it declared none. */
  readonly namespaces: readonly string[];
  describe(namespace: string): Promise<DshSettingsNamespace>;
  mutate(namespace: string, ops: SchemaPathOp[], expectedRevision?: number): Promise<DshSettingsNamespace>;
}

/** Session view exposed imperatively to activated plugins. */
export interface PluginSessionClient {
  readonly current: SessionUiContext | null;
  readonly generation: number;
  onChange(handler: (session: SessionUiContext | null) => void | Promise<void>): () => void;
}

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Everything an activated client module may touch. No raw Tauri invoke,
 * window, or unscoped remote access is reachable through this context.
 */
export interface DeeptopClientContext {
  plugin: {
    id: string;
    version: string;
    descriptor: Readonly<DshUiPluginDescriptor>;
  };
  ui: {
    register(slot: UiRuntimeSlot, contribution: UiContribution): () => void;
  };
  locale: UiLocale;
  host: UiHostActions;
  remote: ScopedRemoteClient;
  events: ScopedEventClient;
  storage: ScopedStorage;
  /** Settings namespaces this plugin declared; calling with any other is denied. */
  settings: ScopedSettings;
  session: PluginSessionClient;
  logger: PluginLogger;
  signal: AbortSignal;
}

/** The module exports a desktop UI client plugin must provide. */
export interface DeeptopClientModule {
  activate(context: DeeptopClientContext): void | Promise<void>;
  deactivate?(reason?: DeactivateReason): void | Promise<void>;
}

/** Lifecycle states per docs/DEEPTOP_UI_RUNTIME.md §7.1. */
export type ClientPluginState =
  | "discovered"
  | "checking"
  | "loading"
  | "activating"
  | "active"
  | "deactivating"
  | "disposed"
  | "check-failed"
  | "load-failed"
  | "activate-failed";

export type { DshDeclarativeContribution, DshUiPluginDescriptor, SessionUiContext, UiLocale, UiPluginErrorCodeValue, UiRuntimeSlot };
