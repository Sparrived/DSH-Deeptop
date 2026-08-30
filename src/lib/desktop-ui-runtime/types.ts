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

/** Why a plugin was asked to deactivate. */
export type DeactivateReason =
  | "host-restarted"
  | "plugin-removed"
  | "runtime-disposed"
  | "incompatible"
  | "manual";

/** Minimal serializable view passed to every slot component. */
export interface SlotRenderContext {
  /** Target session of the row / menu / header the outlet lives in; null on global slots. */
  session: SessionUiContext | null;
  /** Session currently open in the conversation area. */
  activeSessionId: string | null;
}

/** Component-based contribution registered by an activated client module. */
export interface UiContribution {
  kind: "action" | "badge" | "panel";
  id: string;
  order?: number;
  label?: string;
  title?: string;
  render: ComponentType<SlotRenderContext>;
}

/** One renderable entry inside a slot: either declarative (host-provided) or component-based. */
export interface RegisteredContribution {
  pluginId: string;
  slot: UiRuntimeSlot;
  contributionId: string;
  order?: number;
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
  on(event: string, handler: (payload: unknown) => void): () => void;
}

/** Namespace-scoped JSON storage backed by the host registry service. */
export interface ScopedStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Session view exposed imperatively to activated plugins. */
export interface PluginSessionClient {
  readonly current: SessionUiContext | null;
  readonly generation: number;
  onChange(handler: (session: SessionUiContext | null) => void): () => void;
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
  remote: ScopedRemoteClient;
  events: ScopedEventClient;
  storage: ScopedStorage;
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

export type { DshDeclarativeContribution, DshUiPluginDescriptor, SessionUiContext, UiPluginErrorCodeValue, UiRuntimeSlot };
