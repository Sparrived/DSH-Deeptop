// Desktop UI runtime orchestrator (docs/DEEPTOP_UI_RUNTIME.md §11). Discovers
// plugins over the restricted ui.plugin.* routes, drives their lifecycle,
// feeds the shared SlotRegistry, dispatches declared events, and survives DSH
// restarts with generation-guarded state. The host app stays fully functional
// when every step here fails.

import { createElement } from "react";
import {
  UI_RUNTIME_SDK_VERSION,
  normalizeUiPluginDescriptor,
  type DshDeclarativeContribution,
  type DshUiPluginDescriptor,
  type SessionUiContext,
} from "../../app/ui-plugin-model.ts";
import type { SlotRenderContext, UiContribution, UiHostActions, UiLocale } from "./types.ts";
import {
  CapabilityDeniedError,
  PluginEventScope,
  createScopedRemote,
  createScopedSettings,
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
  request<T = unknown>(method: string, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
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
  /** Initial master switch; use setEnabled() for a mounted runtime toggle. */
  enabled?: boolean;
  /** Current host locale and the host UI facade are refreshed as React state changes. */
  locale?: UiLocale;
  hostActions?: UiHostActions;
  /** Bound plugin lifecycle deadlines for deterministic tests and Host recovery. */
  activateTimeoutMs?: number;
  deactivateTimeoutMs?: number;
  log?(message: string): void;
}

interface ActiveEntry {
  descriptor: DshUiPluginDescriptor;
  runner: ClientPluginRunner;
  events: PluginEventScope;
  declarativeDisposers: Array<() => void>;
}

function withAbort<T>(operation: Promise<T>, ...signals: Array<AbortSignal | undefined>): Promise<T> {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  const aborted = activeSignals.find((signal) => signal.aborted);
  if (aborted) return Promise.reject(aborted.reason ?? new Error("plugin context is disposed"));
  if (activeSignals.length === 0) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const listeners: Array<[AbortSignal, () => void]> = [];
    const cleanup = () => {
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    };
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    for (const signal of activeSignals) {
      const abort = () => rejectOnce(signal.reason ?? new Error("plugin context is disposed"));
      listeners.push([signal, abort]);
      signal.addEventListener("abort", abort, { once: true });
    }
    operation.then(resolveOnce, rejectOnce);
  });
}

export class DesktopUiRuntime {
  readonly slots = new SlotRegistry();

  private readonly options: DesktopUiRuntimeOptions;
  private enabledState: boolean;
  private readonly entries = new Map<string, ActiveEntry>();
  private readonly sessionListeners = new Set<(session: SessionUiContext | null) => void>();
  private readonly catalogListeners = new Set<() => void>();
  private unlisten: (() => void) | null = null;
  private bridgeListenerToken = 0;
  private hostRequestController = new AbortController();
  private hostEpoch = 0;
  private hostUnavailable = false;
  private hostTeardown: Promise<void> = Promise.resolve();
  // StrictMode mounts effects twice; every lifecycle call serializes so
  // start→stop→start interleavings settle deterministically.
  private lifecycleTail: Promise<void> = Promise.resolve();

  status: UiRuntimeStatus;
  diagnostics: UiRuntimeDiagnostic[] = [];
  sessionContext: SessionUiContext | null = null;
  sessionGeneration = 0;
  private sessionInitialized = false;
  private locale: UiLocale = "zh";
  private hostActions: UiHostActions = { prompt: async () => null, notify: () => undefined };

  constructor(options: DesktopUiRuntimeOptions) {
    this.options = options;
    this.enabledState = options.enabled !== false;
    this.status = this.enabledState ? "loading" : "disabled";
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
    return this.enabledState;
  }

  /** Toggle the master switch; disabling revokes every Host capability synchronously. */
  setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabledState) {
      if (!enabled && this.status !== "disabled") {
        this.status = "disabled";
        this.notifyCatalogListeners();
      }
      return Promise.resolve();
    }
    this.enabledState = enabled;
    if (!enabled) {
      this.status = "disabled";
      this.diagnostics = [];
      this.revokeHostRequests();
      this.hostUnavailable = true;
      this.hostEpoch += 1;
      this.sessionGeneration += 1;
      this.sessionInitialized = true;
      this.detachBridgeListener();
      const teardown = this.scheduleTeardown("runtime-disposed");
      this.notifyCatalogListeners();
      return teardown;
    }
    this.hostUnavailable = false;
    this.status = "loading";
    this.notifyCatalogListeners();
    return Promise.resolve();
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

  private detachBridgeListener(): void {
    this.bridgeListenerToken += 1;
    const unlisten = this.unlisten;
    this.unlisten = null;
    if (!unlisten) return;
    try {
      unlisten();
    } catch (error) {
      // The token above already suppresses the old callback. A transport-level
      // release failure must not prevent synchronous plugin capability revoke.
      this.log(`ui plugin bridge listener cleanup failed: ${errorMessageOf(error)}`);
    }
  }

  private revokeHostRequests(): void {
    this.hostRequestController.abort(new Error("Host runtime is unavailable"));
  }

  private renewHostRequests(): void {
    this.revokeHostRequests();
    this.hostRequestController = new AbortController();
  }

  private attachBridgeListener(epoch: number): void {
    this.detachBridgeListener();
    const token = ++this.bridgeListenerToken;
    this.unlisten = this.options.listen((frame) => {
      if (token !== this.bridgeListenerToken || !this.isCurrentHostEpoch(epoch)) return;
      this.dispatchEvent(frame);
    });
  }

  private isCurrentHostEpoch(epoch: number): boolean {
    return epoch === this.hostEpoch && !this.hostUnavailable;
  }

  private detachEntry(pluginId: string, reason: DeactivateReason): Promise<void> | null {
    const entry = this.entries.get(pluginId);
    if (!entry) return null;
    this.entries.delete(pluginId);
    // Revoke every synchronous capability before awaiting plugin-owned teardown.
    entry.events.dispose();
    for (const dispose of entry.declarativeDisposers.splice(0).reverse()) dispose();
    this.slots.unregisterPlugin(pluginId);
    return entry.runner.deactivate(reason).catch((error) => {
      this.log(`ui plugin ${pluginId}: deactivate failed: ${errorMessageOf(error)}`);
    });
  }

  private scheduleTeardown(reason: DeactivateReason): Promise<void> {
    const previous = this.hostTeardown;
    const pending = [...this.entries.keys()]
      .map((pluginId) => this.detachEntry(pluginId, reason))
      .filter((task): task is Promise<void> => task !== null);
    const next = Promise.all([previous, ...pending]).then(() => undefined);
    this.hostTeardown = next;
    return next;
  }

  private invalidateHost(reason: DeactivateReason): Promise<void> {
    this.revokeHostRequests();
    this.hostUnavailable = true;
    this.hostEpoch += 1;
    this.sessionGeneration += 1;
    this.sessionInitialized = true;
    this.detachBridgeListener();
    this.status = this.enabled ? "loading" : "disabled";
    this.diagnostics = [];
    const teardown = this.scheduleTeardown(reason);
    this.notifyCatalogListeners();
    return teardown;
  }

  /** Begin listening and discover once. Reusable after stop() (StrictMode-safe). */
  async start(): Promise<boolean> {
    if (!this.enabled) {
      this.status = "disabled";
      this.notifyCatalogListeners();
      return false;
    }
    this.renewHostRequests();
    const epoch = ++this.hostEpoch;
    this.hostUnavailable = false;
    this.status = "loading";
    this.notifyCatalogListeners();
    const teardown = this.hostTeardown;
    const run = this.enqueue(async () => {
      await teardown;
      if (!this.enabled || !this.isCurrentHostEpoch(epoch)) return;
      this.attachBridgeListener(epoch);
      await this.refreshLocked(epoch);
    });
    await run;
    const finalStatus = this.catalogSnapshot().status;
    return finalStatus === "ready" || finalStatus === "partial";
  }

  /**
   * Deactivate everything and detach listeners. The instance stays reusable;
   * a later start() re-discovers from scratch.
   */
  async stop(): Promise<void> {
    const epoch = ++this.hostEpoch;
    this.hostUnavailable = true;
    this.revokeHostRequests();
    this.sessionGeneration += 1;
    this.sessionInitialized = true;
    this.detachBridgeListener();
    this.status = this.enabled ? "loading" : "disabled";
    this.diagnostics = [];
    const teardown = this.scheduleTeardown("runtime-disposed");
    this.notifyCatalogListeners();
    return this.enqueue(async () => {
      await teardown;
      if (this.hostEpoch !== epoch) return;
      this.status = this.enabled ? "loading" : "disabled";
      this.notifyCatalogListeners();
    });
  }

  /** Mark the old Host unavailable and revoke its Client capabilities immediately. */
  handleHostUnavailable(): Promise<void> {
    if (!this.hostUnavailable) return this.invalidateHost("host-restarted");
    // Every native down frame invalidates pending restart continuations, even
    // when the previous teardown is still in flight.
    this.revokeHostRequests();
    this.hostEpoch += 1;
    this.sessionGeneration += 1;
    this.sessionInitialized = true;
    this.detachBridgeListener();
    return this.hostTeardown;
  }

  /**
   * Reattach to a recovered Host after old plugin teardown has settled. The
   * invalidation itself happens synchronously so stale subscribers are revoked
   * even if a plugin's async deactivate() is slow or never resolves.
   */
  handleHostRestart(): Promise<void> {
    const teardown = this.hostUnavailable
      ? this.hostTeardown
      : this.invalidateHost("host-restarted");
    const epoch = this.hostEpoch;
    return teardown.then(() => {
      if (!this.enabled || this.hostEpoch !== epoch) return;
      this.hostUnavailable = false;
      this.renewHostRequests();
      this.attachBridgeListener(epoch);
      this.status = "loading";
      this.notifyCatalogListeners();
    });
  }

  /** Re-read the catalog and reconcile running plugins toward it. */
  async refresh(): Promise<boolean> {
    if (!this.enabled) {
      this.status = "disabled";
      this.notifyCatalogListeners();
      return false;
    }
    const epoch = this.hostEpoch;
    const teardown = this.hostTeardown;
    const run = this.enqueue(async () => {
      await teardown;
      if (!this.enabled || !this.isCurrentHostEpoch(epoch)) return;
      await this.refreshLocked(epoch);
    });
    await run;
    const finalStatus = this.catalogSnapshot().status;
    return finalStatus === "ready" || finalStatus === "partial";
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.lifecycleTail.then(operation);
    this.lifecycleTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async refreshLocked(epoch: number): Promise<void> {
    if (!this.enabled || !this.isCurrentHostEpoch(epoch)) return;
    this.status = "loading";
    this.notifyCatalogListeners();
    let rawItems: unknown;
    try {
      const signal = this.hostRequestController.signal;
      const response = await withAbort(this.options.request<{ items: unknown[] }>("ui.plugin.list", {}, signal), signal);
      if (!this.isCurrentHostEpoch(epoch)) return;
      rawItems = response.items;
    } catch (error) {
      if (!this.isCurrentHostEpoch(epoch)) return;
      this.diagnostics = [{ pluginId: "*", message: `ui.plugin.list 失败：${errorMessageOf(error)}` }];
      this.status = "failed";
      this.notifyCatalogListeners();
      return;
    }
    if (!Array.isArray(rawItems)) {
      if (!this.isCurrentHostEpoch(epoch)) return;
      this.diagnostics = [{ pluginId: "*", message: "ui.plugin.list 响应缺少 items 数组" }];
      this.status = "failed";
      this.notifyCatalogListeners();
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
      if (!this.isCurrentHostEpoch(epoch)) return;
      if (!nextIds.has(pluginId)) await this.removeEntry(pluginId, "plugin-removed");
    }
    // Reconcile changed declarations: version/capability diffs re-activate cleanly.
    for (const descriptor of descriptors) {
      if (!this.isCurrentHostEpoch(epoch)) return;
      const existing = this.entries.get(descriptor.pluginId);
      if (existing && JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor)) {
        await this.removeEntry(descriptor.pluginId, "plugin-removed");
      }
    }
    let failures = 0;
    for (const descriptor of descriptors) {
      if (!this.isCurrentHostEpoch(epoch)) return;
      if (descriptor.status === "disabled") continue;
      const existing = this.entries.get(descriptor.pluginId);
      if (existing && ["check-failed", "load-failed", "activate-failed"].includes(existing.runner.state)) {
        await this.removeEntry(descriptor.pluginId, "incompatible");
      }
      try {
        await this.ensureEntry(descriptor, epoch);
      } catch (error) {
        if (!this.isCurrentHostEpoch(epoch)) return;
        failures += 1;
        problems.push({
          pluginId: descriptor.pluginId,
          message: `${errorMessageOf(error)}（已停用该插件的动态部分，主应用不受影响）`,
        });
      }
    }

    if (!this.isCurrentHostEpoch(epoch)) return;
    this.diagnostics = problems;
    this.status = failures > 0 ? "partial" : "ready";
    this.notifyCatalogListeners();
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
    const entry = this.entries.get(pluginId);
    const epoch = this.hostEpoch;
    if (
      this.hostUnavailable
      || !entry
      || !entry.descriptor.contributions.includes(contribution)
      || !this.isCurrentHostEpoch(epoch)
    ) {
      throw new CapabilityDeniedError(`contribution "${contribution.id}" is no longer active`);
    }
    if (!contribution.invoke) throw new CapabilityDeniedError(`contribution "${contribution.id}" declares no invoke target`);
    const signal = this.hostRequestController.signal;
    const response = await withAbort(this.options.request<{ value: unknown }>("ui.plugin.invoke", {
      pluginId,
      namespace: contribution.invoke.namespace,
      method: contribution.invoke.method,
      args: {
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        ...(context.args ?? {}),
      },
    }, signal), signal);
    if (this.entries.get(pluginId) !== entry || !this.isCurrentHostEpoch(epoch)) {
      throw new CapabilityDeniedError(`contribution "${contribution.id}" became stale during invocation`);
    }
    return response.value;
  }

  private async ensureEntry(descriptor: DshUiPluginDescriptor, epoch: number): Promise<void> {
    // Host-declared contributions render even while the client half fails, so
    // they attach before any module code runs.
    if (!this.isCurrentHostEpoch(epoch) || this.entries.has(descriptor.pluginId)) return;
    const events = new PluginEventScope(
      descriptor.pluginId,
      () => descriptor.capabilities.events ?? [],
      (error) => this.log(`ui plugin ${descriptor.pluginId} event handler failed: ${errorMessageOf(error)}`),
    );
    const runner = new ClientPluginRunner({
      descriptor,
      runtimeSdkVersion: UI_RUNTIME_SDK_VERSION,
      loadModule: (moduleDescriptor) => this.loadModule(moduleDescriptor),
      buildContext: (moduleDescriptor, scope) => this.buildContext(moduleDescriptor, scope, events),
      ...(this.options.activateTimeoutMs === undefined ? {} : { activateTimeoutMs: this.options.activateTimeoutMs }),
      ...(this.options.deactivateTimeoutMs === undefined ? {} : { deactivateTimeoutMs: this.options.deactivateTimeoutMs }),
    });
    const declarativeDisposers: Array<() => void> = [];
    try {
      for (const contribution of descriptor.contributions) {
        const dispose = this.slots.registerDeclarative({
          pluginId: descriptor.pluginId,
          allowedSlots: descriptor.slots,
          contribution,
        });
        declarativeDisposers.push(dispose);
      }
    } catch (error) {
      for (const dispose of declarativeDisposers.splice(0).reverse()) dispose();
      events.dispose();
      this.slots.unregisterPlugin(descriptor.pluginId);
      throw error;
    }
    const entry: ActiveEntry = { descriptor, runner, events, declarativeDisposers };
    this.entries.set(descriptor.pluginId, entry);
    if (!this.isCurrentHostEpoch(epoch)) {
      await this.removeEntry(descriptor.pluginId, "host-restarted");
      return;
    }
    if (!descriptor.client) return;
    try {
      await runner.activate();
    } catch (error) {
      if (!this.isCurrentHostEpoch(epoch) || this.entries.get(descriptor.pluginId) !== entry) {
        await this.removeEntry(descriptor.pluginId, "host-restarted");
        return;
      }
      // Keep the entry (declarative UI stays live) but surface the failure.
      this.log(`ui plugin ${descriptor.pluginId}: ${errorMessageOf(error)}`);
      throw error;
    }
    if (!this.isCurrentHostEpoch(epoch) || this.entries.get(descriptor.pluginId) !== entry) {
      await this.removeEntry(descriptor.pluginId, "host-restarted");
    }
  }

  private async removeEntry(pluginId: string, reason: DeactivateReason): Promise<void> {
    const teardown = this.detachEntry(pluginId, reason);
    if (teardown) await teardown;
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
    const controller = new AbortController();
    const send: RuntimeRequestSender = {
      request: <T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal) => {
        const activeSignal = signal ?? controller.signal;
        if (activeSignal.aborted) return Promise.reject(activeSignal.reason ?? new Error("plugin context is disposed"));
        return this.options.request<T>(method, payload, activeSignal);
      },
    };
    const scopedHost = this.scopedHostActions(controller.signal, () => scope.isDisposed);
    scope.add(() => controller.abort(new Error("plugin context is disposed")));
    return {
      plugin: {
        id: descriptor.pluginId,
        version: descriptor.version,
        descriptor,
      },
      ui: {
        register: (slot, contribution) => {
          if (scope.isDisposed) return () => undefined;
          const Render = contribution.render;
          const scopedContribution: UiContribution = {
            ...contribution,
            render: (context) => createElement(Render, { ...context, host: scopedHost }),
          };
          return scope.add(this.slots.register(descriptor.pluginId, descriptor.slots, slot, scopedContribution));
        },
      },
      get locale() {
        return runtimeRef.locale;
      },
      get host() {
        return scopedHost;
      },
      remote: createScopedRemote(descriptor.pluginId, descriptor.capabilities, send, controller.signal),
      events: {
        on: (event, handler) => {
          if (scope.isDisposed) return () => undefined;
          const detachFromDispatcher = events.on(event, handler);
          return scope.add(detachFromDispatcher);
        },
      },
      storage: createScopedStorage(descriptor.pluginId, send, controller.signal),
      settings: createScopedSettings(descriptor.pluginId, descriptor.capabilities, send, controller.signal),
      session: {
        get current() {
          return scope.isDisposed ? null : runtimeRef.sessionContext;
        },
        get generation() {
          return scope.isDisposed ? -1 : runtimeRef.sessionGeneration;
        },
        onChange: (handler) => {
          if (scope.isDisposed) return () => undefined;
          const reportSessionHandlerError = (error: unknown) => {
            try {
              runtimeRef.log(`ui plugin ${descriptor.pluginId} Session handler failed: ${errorMessageOf(error)}`);
            } catch {
              // A diagnostics sink must not prevent sibling Session handlers.
            }
          };
          const safeHandler = (session: SessionUiContext | null) => {
            try {
              Promise.resolve(handler(session)).catch(reportSessionHandlerError);
            } catch (error) {
              reportSessionHandlerError(error);
            }
          };
          return scope.add(this.onSessionChange(safeHandler));
        },
      },
      logger: {
        info: (message) => this.log(`[${descriptor.pluginId}] ${message}`),
        warn: (message) => this.log(`[${descriptor.pluginId}] ${message}`),
        error: (message) => this.log(`[${descriptor.pluginId}] ${message}`),
      },
      signal: controller.signal,
    };
  }

  private scopedHostActions(signal: AbortSignal, isDisposed: () => boolean): UiHostActions {
    return {
      prompt: (request, callerSignal) => {
        if (isDisposed() || signal.aborted) {
          return Promise.reject(signal.reason ?? new Error("plugin context is disposed"));
        }
        // The protected App popup queue may not cancel an already-open native
        // dialog, but do not enqueue one if disposal/cancellation wins before
        // this scheduled host action starts. Its eventual answer is never
        // delivered back into a stale plugin.
        const prompt = Promise.resolve().then(() => {
          const aborted = [callerSignal, signal].find((candidate) => candidate?.aborted);
          if (isDisposed() || aborted) {
            throw aborted?.reason ?? signal.reason ?? new Error("plugin context is disposed");
          }
          return this.hostActions.prompt(request, signal);
        });
        return withAbort(prompt, signal, callerSignal);
      },
      notify: (message, kind) => {
        if (!isDisposed() && !signal.aborted) this.hostActions.notify(message, kind);
      },
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
