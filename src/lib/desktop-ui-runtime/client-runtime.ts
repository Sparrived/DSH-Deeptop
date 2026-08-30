// Desktop UI runtime orchestrator (docs/DEEPTOP_UI_RUNTIME.md §11). Discovers
// plugins over the restricted ui.plugin.* routes, drives their lifecycle,
// feeds the shared SlotRegistry, dispatches declared events, and survives DSH
// restarts with generation-guarded state. The host app stays fully functional
// when every step here fails.

import {
  UI_RUNTIME_SDK_VERSION,
  normalizeUiPluginDescriptor,
  type DshDeclarativeContribution,
  type DshUiPluginDescriptor,
  type SessionUiContext,
} from "../../app/ui-plugin-model.ts";
import type { UiHostActions, UiLocale } from "./types.ts";
import {
  CapabilityDeniedError,
  PluginEventScope,
  createScopedRemote,
  createScopedStorage,
  type RuntimeRequestSender,
} from "./capability-client.ts";
import { errorMessageOf } from "./plugin-error.ts";
import { ClientPluginRunner, LifecycleError, PluginScope } from "./plugin-runner.ts";
import type { BundledClientModuleFactory, ModuleImporter, UiBundleResolver } from "./module-loader.ts";
import { loadBundledClientModule, loadProtocolClientModule } from "./module-loader.ts";
import { SlotRegistry } from "./slot-registry.ts";
import type {
  ClientPluginState,
  DeeptopClientContext,
  DeeptopClientModule,
  DeactivateReason,
} from "./types.ts";

export type UiRuntimeStatus = "disabled" | "loading" | "ready" | "partial" | "failed";

export interface UiRuntimeDiagnostic {
  pluginId: string;
  message: string;
}

export interface UiRuntimePluginView {
  pluginId: string;
  version: string;
  displayName?: string;
  state: ClientPluginState;
  /** Declared slots, as registered in the host manifest. */
  slots: string[];
  /** Whether a client module is declared (bundled or external bundle). */
  hasClientModule: boolean;
  /** Declared remote capabilities (namespace → allowed methods). */
  remotes: Array<{ namespace: string; methods: string[] }>;
  /** Declared scoped-storage namespace, when any. */
  storage?: string;
}

/** Serializable snapshot of the runtime catalog for settings surfaces. */
export interface UiRuntimeCatalogSnapshot {
  status: UiRuntimeStatus;
  enabled: boolean;
  plugins: UiRuntimePluginView[];
  diagnostics: UiRuntimeDiagnostic[];
}

/** One bridge event frame as forwarded by the Rust side (`{type:'event'}` messages). */
export interface BridgeEventFrameInput {
  channel?: unknown;
  frame?: { rpcId?: unknown; payload?: unknown };
}

export interface DesktopUiRuntimeOptions {
  /** Restricted transport: desktop.ts bridgeRequest wrapped for testability. */
  request<T = unknown>(method: string, payload?: Record<string, unknown>): Promise<T>;
  /** Subscribe to raw bridge event frames; returns an unlisten function (sync or async). */
  listen(handler: (frame: BridgeEventFrameInput) => void): () => void;
  /** Build-time bundled client modules keyed by entryId (Phase 1 static table). */
  bundledModules?: Record<string, BundledClientModuleFactory>;
  /**
   * Phase 2 controlled resource protocol: ask the desktop process to verify
   * and preload an external plugin bundle. Absent → external bundles refuse
   * to load with a clear diagnostic instead of failing silently.
   */
  resolveBundle?: UiBundleResolver;
  /** Dynamic import seam (tests stub this; production uses native import()). */
  importModule?: ModuleImporter;
  enabled?: boolean;
  /** Current host locale and the host UI facade are refreshed as React state changes. */
  locale?: UiLocale;
  hostActions?: UiHostActions;
  log?(message: string): void;
}

interface ActiveEntry {
  descriptor: DshUiPluginDescriptor;
  runner: ClientPluginRunner;
  events: PluginEventScope;
  declarativeDisposers: Array<() => void>;
}

export class DesktopUiRuntime {
  readonly slots = new SlotRegistry();

  private readonly options: DesktopUiRuntimeOptions;
  private readonly entries = new Map<string, ActiveEntry>();
  private readonly sessionListeners = new Set<(session: SessionUiContext | null) => void>();
  private readonly catalogListeners = new Set<() => void>();
  private unlisten: (() => void) | null = null;
  // StrictMode mounts effects twice; every lifecycle call serializes so
  // start→stop→start interleavings settle deterministically.
  private lifecycleTail: Promise<void> = Promise.resolve();

  status: UiRuntimeStatus = "loading";
  diagnostics: UiRuntimeDiagnostic[] = [];
  sessionContext: SessionUiContext | null = null;
  sessionGeneration = 0;
  private sessionInitialized = false;
  private locale: UiLocale = "zh";
  private hostActions: UiHostActions = { prompt: async () => null, notify: () => undefined };

  constructor(options: DesktopUiRuntimeOptions) {
    this.options = options;
    this.locale = options.locale ?? "zh";
    this.hostActions = options.hostActions ?? this.hostActions;
  }

  setHostContext(locale: UiLocale, hostActions: UiHostActions): void {
    this.locale = locale;
    this.hostActions = hostActions;
    this.slots.notifyAll();
    this.notifyCatalogListeners();
  }

  get enabled(): boolean {
    return this.options.enabled ?? true;
  }

  get pluginViews(): UiRuntimePluginView[] {
    return [...this.entries.values()].map((entry) => this.buildPluginView(entry));
  }

  private buildPluginView(entry: ActiveEntry): UiRuntimePluginView {
    const { descriptor, runner } = entry;
    return {
      pluginId: descriptor.pluginId,
      version: descriptor.version,
      ...(descriptor.displayName ? { displayName: descriptor.displayName } : {}),
      state: runner.state,
      slots: [...descriptor.slots],
      hasClientModule: Boolean(descriptor.client),
      remotes: descriptor.capabilities.remotes.map((remote) => ({ namespace: remote.namespace, methods: [...remote.methods] })),
      ...(descriptor.capabilities.storage ? { storage: descriptor.capabilities.storage } : {}),
    };
  }

  /** Serializable catalog snapshot; safe to store in React state. */
  catalogSnapshot(): UiRuntimeCatalogSnapshot {
    return {
      status: this.status,
      enabled: this.enabled,
      plugins: this.pluginViews,
      diagnostics: [...this.diagnostics],
    };
  }

  /** Subscribe to catalog mutations (refresh/stop/host-restart); returns an unlisten function. */
  onCatalogChange(listener: () => void): () => void {
    this.catalogListeners.add(listener);
    return () => {
      this.catalogListeners.delete(listener);
    };
  }

  private notifyCatalogListeners(): void {
    for (const listener of [...this.catalogListeners]) listener();
  }

  /** Begin listening and discover once. Reusable after stop() (StrictMode-safe). */
  async start(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) return;
      this.unlisten?.();
      this.unlisten = this.options.listen((frame) => this.dispatchEvent(frame));
      await this.refreshLocked();
    });
  }

  /**
   * Deactivate everything and detach listeners. The instance stays reusable;
   * a later start() re-discovers from scratch.
   */
  async stop(): Promise<void> {
    return this.enqueue(async () => {
      await this.removeAll("runtime-disposed");
      this.unlisten?.();
      this.unlisten = null;
      this.status = this.enabled ? "loading" : "disabled";
      this.notifyCatalogListeners();
    });
  }

  /** Re-read the catalog and reconcile running plugins toward it. */
  async refresh(): Promise<void> {
    return this.enqueue(() => this.refreshLocked());
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.lifecycleTail.then(operation);
    this.lifecycleTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async refreshLocked(): Promise<void> {
    if (!this.enabled) return;
    this.status = "loading";
    let rawItems: unknown;
    try {
      const response = await this.options.request<{ items: unknown[] }>("ui.plugin.list", {});
      rawItems = response.items;
    } catch (error) {
      this.diagnostics = [{ pluginId: "*", message: `ui.plugin.list 失败：${errorMessageOf(error)}` }];
      this.status = "failed";
      return;
    }
    if (!Array.isArray(rawItems)) {
      this.diagnostics = [{ pluginId: "*", message: "ui.plugin.list 响应缺少 items 数组" }];
      this.status = "failed";
      return;
    }

    const descriptors: DshUiPluginDescriptor[] = [];
    const skipped: UiRuntimeDiagnostic[] = [];
    for (const item of rawItems) {
      const { descriptor, diagnostic } = normalizeUiPluginDescriptor(item);
      if (descriptor) descriptors.push(descriptor);
      else if (diagnostic) skipped.push({ pluginId: "?", message: diagnostic });
    }

    const nextIds = new Set(descriptors.map((descriptor) => descriptor.pluginId));
    const problems: UiRuntimeDiagnostic[] = [...skipped];

    // Remove plugins that disappeared from the host registry.
    for (const [pluginId] of [...this.entries]) {
      if (!nextIds.has(pluginId)) await this.removeEntry(pluginId, "plugin-removed");
    }
    // Reconcile changed declarations: version/capability diffs re-activate cleanly.
    for (const descriptor of descriptors) {
      const existing = this.entries.get(descriptor.pluginId);
      if (existing && JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor)) {
        await this.removeEntry(descriptor.pluginId, "plugin-removed");
      }
    }    let failures = 0;
    for (const descriptor of descriptors) {
      if (descriptor.status === "disabled") continue;
      try {
        await this.ensureEntry(descriptor);
      } catch (error) {
        failures += 1;
        problems.push({
          pluginId: descriptor.pluginId,
          message: `${errorMessageOf(error)}（已停用该插件的动态部分，主应用不受影响）`,
        });
      }
    }

    this.diagnostics = problems;
    this.status = failures > 0 ? "partial" : "ready";
    this.notifyCatalogListeners();
  }

  /**
   * DSH restarted: drop every old-generation client state first, then let the
   * caller refresh once the host reports ready again (docs §11.2).
   */
  async handleHostRestart(): Promise<void> {
    return this.enqueue(async () => {
      await this.removeAll("host-restarted");
      this.sessionGeneration += 1;
      this.sessionInitialized = false;
       this.sessionContext = null;
      this.status = "loading";
      this.notifyCatalogListeners();
    });
  }

  /** Feed the latest serializable session view; notifies imperative subscribers. */
  updateSession(context: SessionUiContext | null): void {
    if (this.sessionInitialized && this.sessionContext?.sessionId === context?.sessionId) {
      this.sessionContext = context;
      this.slots.notifyAll();
      return;
    }
    this.sessionInitialized = true;
    this.sessionGeneration += 1;
    this.sessionContext = context;
    for (const listener of [...this.sessionListeners]) listener(context);
    this.slots.notifyAll();
  }

  onSessionChange(listener: (session: SessionUiContext | null) => void): () => void {
    this.sessionListeners.add(listener);
    listener(this.sessionContext);
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  /** Invoke one host-declared action from a native renderer (SlotOutlet). */
  async invokeDeclarative(
    pluginId: string,
    contribution: DshDeclarativeContribution,
    context: { sessionId?: string | null; args?: Record<string, unknown> },
  ): Promise<unknown> {
    if (!contribution.invoke) throw new CapabilityDeniedError(`contribution "${contribution.id}" declares no invoke target`);
    const response = await this.options.request<{ value: unknown }>("ui.plugin.invoke", {
      pluginId,
      namespace: contribution.invoke.namespace,
      method: contribution.invoke.method,
      args: {
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        ...(context.args ?? {}),
      },
    });
    return response.value;
  }

  private async ensureEntry(descriptor: DshUiPluginDescriptor): Promise<void> {
    // Host-declared contributions render even while the client half fails, so
    // they attach before any module code runs.
    if (this.entries.has(descriptor.pluginId)) return;
    const events = new PluginEventScope(descriptor.pluginId, () => descriptor.capabilities.events ?? []);
    const runner = new ClientPluginRunner({
      descriptor,
      runtimeSdkVersion: UI_RUNTIME_SDK_VERSION,
      loadModule: (moduleDescriptor) => this.loadModule(moduleDescriptor),
      buildContext: (moduleDescriptor, scope) => this.buildContext(moduleDescriptor, scope, events),
    });
    const declarativeDisposers: Array<() => void> = [];
    for (const contribution of descriptor.contributions) {
      const dispose = this.slots.registerDeclarative({
        pluginId: descriptor.pluginId,
        allowedSlots: descriptor.slots,
        contribution,
      });
      declarativeDisposers.push(dispose);
    }
    const entry: ActiveEntry = { descriptor, runner, events, declarativeDisposers };
    this.entries.set(descriptor.pluginId, entry);
    if (!descriptor.client) return;
    try {
      await runner.activate();
    } catch (error) {
      // Keep the entry (declarative UI stays live) but surface the failure.
      this.log(`ui plugin ${descriptor.pluginId}: ${errorMessageOf(error)}`);
      throw error;
    }
  }

  private async removeAll(reason: DeactivateReason): Promise<void> {
    for (const [pluginId] of [...this.entries]) {
      await this.removeEntry(pluginId, reason);
    }
  }

  private async removeEntry(pluginId: string, reason: DeactivateReason): Promise<void> {
    const entry = this.entries.get(pluginId);
    if (!entry) return;
    this.entries.delete(pluginId);
    try {
      await entry.runner.deactivate(reason);
    } catch (error) {
      this.log(`ui plugin ${pluginId}: deactivate failed: ${errorMessageOf(error)}`);
    } finally {
      entry.events.dispose();
      for (const dispose of entry.declarativeDisposers.splice(0).reverse()) dispose();
      this.slots.unregisterPlugin(pluginId);
    }
  }

  private async loadModule(descriptor: DshUiPluginDescriptor): Promise<DeeptopClientModule> {
    if (!descriptor.client) throw new LifecycleError("load-failed", "plugin has no client module");
    const source = {
      entryId: descriptor.client.entryId,
      sdkVersion: descriptor.client.sdkVersion,
      runtimeSdkVersion: UI_RUNTIME_SDK_VERSION,
    };
    // Bundled modules win (§9.2): they ship with the app and need no protocol.
    const bundled = this.options.bundledModules?.[descriptor.client.entryId];
    if (bundled) {
      return loadBundledClientModule(source, this.options.bundledModules ?? {});
    }
    const resolveBundle = this.options.resolveBundle;
    if (!resolveBundle) {
      throw new LifecycleError(
        "load-failed",
        `client module "${descriptor.client.entryId}" is not bundled and the controlled resource protocol is unavailable in this context`,
      );
    }
    return loadProtocolClientModule(
      { ...source, pluginId: descriptor.pluginId },
      resolveBundle,
      this.options.importModule,
    );
  }

  private buildContext(
    descriptor: DshUiPluginDescriptor,
    scope: PluginScope,
    events: PluginEventScope,
  ): DeeptopClientContext {
    // Live reads of runtime state; declared before the context object so the
    // getters below never touch a temporal-dead-zone binding.
    const runtimeRef: DesktopUiRuntime = this;
    const send: RuntimeRequestSender = {
      request: <T>(method: string, payload: Record<string, unknown>) => this.options.request<T>(method, payload),
    };
    const controller = new AbortController();
    scope.add(() => controller.abort());
    return {
      plugin: {
        id: descriptor.pluginId,
        version: descriptor.version,
        descriptor,
      },
      ui: {
        register: (slot, contribution) => scope.add(this.slots.register(descriptor.pluginId, descriptor.slots, slot, contribution)),
      },
      get locale() {
        return runtimeRef.locale;
      },
      get host() {
        return runtimeRef.hostActions;
      },
      remote: createScopedRemote(descriptor.pluginId, descriptor.capabilities, send),
      events: {
        on: (event, handler) => {
          const detachFromDispatcher = events.on(event, handler);
          return scope.add(detachFromDispatcher);
        },
      },
      storage: createScopedStorage(descriptor.pluginId, send),
      session: {
        get current() {
          return runtimeRef.sessionContext;
        },
        get generation() {
          return runtimeRef.sessionGeneration;
        },
        onChange: (handler) => scope.add(this.onSessionChange(handler)),
      },
      logger: {
        info: (message) => this.log(`[${descriptor.pluginId}] ${message}`),
        warn: (message) => this.log(`[${descriptor.pluginId}] ${message}`),
        error: (message) => this.log(`[${descriptor.pluginId}] ${message}`),
      },
      signal: controller.signal,
    };
  }

  private dispatchEvent(frame: BridgeEventFrameInput): void {
    const payload = frame.frame?.payload;
    if (typeof payload !== "object" || payload === null) return;
    const eventName = (payload as { event?: unknown }).event;
    if (typeof eventName !== "string") return;
    for (const entry of this.entries.values()) entry.events.dispatch(eventName, payload);
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}
