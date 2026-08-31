// Client plugin lifecycle runner (docs/DEEPTOP_UI_RUNTIME.md §7.1, §11).
// One runner per discovered plugin: discover → check → load → activate →
// active, with idempotent deactivation and automatic scope disposal. Failures
// settle into coded terminal states instead of propagating into the host app.

import { sdkVersionCompatible } from "../../app/ui-plugin-model.ts";
import { PluginLoadError } from "./plugin-error.ts";
import type {
  ClientPluginState,
  DeeptopClientContext,
  DeeptopClientModule,
  DeactivateReason,
  DshUiPluginDescriptor,
} from "./types.ts";

/** Coded failure so callers can classify without parsing messages. */
export class LifecycleError extends Error {
  readonly targetState: Extract<ClientPluginState, "check-failed" | "load-failed" | "activate-failed">;

  constructor(targetState: "check-failed" | "load-failed" | "activate-failed", message: string) {
    super(message);
    this.name = "LifecycleError";
    this.targetState = targetState;
  }
}

/** Collects every resource an activation registered; dispose() unwinds in reverse order. */
export class PluginScope {
  private disposables: Array<() => void> = [];
  private disposed = false;

  /** Track one disposer. The returned handle releases it early and is idempotent. */
  add(dispose: () => void): () => void {
    let active = true;
    const entry = () => {
      if (!active) return;
      active = false;
      const index = this.disposables.indexOf(entry);
      if (index >= 0) this.disposables.splice(index, 1);
      try {
        dispose();
      } catch {
        // A failing plugin cleanup must not block sibling cleanups; the
        // deactivate caller reports the overall outcome.
      }
    };
    if (this.disposed) {
      entry();
      return entry;
    }
    this.disposables.push(entry);
    return entry;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.();
    }
  }
}

export const PLUGIN_ACTIVATE_TIMEOUT_MS = 5_000;
export const PLUGIN_DEACTIVATE_TIMEOUT_MS = 5_000;

class DeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineError";
  }
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(message)), Math.max(0, timeoutMs));
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("plugin lifecycle is disposed"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("plugin lifecycle is disposed"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export interface PluginRunnerDeps {
  descriptor: DshUiPluginDescriptor;
  runtimeSdkVersion: string;
  loadModule(descriptor: DshUiPluginDescriptor): Promise<DeeptopClientModule>;
  buildContext(descriptor: DshUiPluginDescriptor, scope: PluginScope): DeeptopClientContext;
  onStateChange?(state: ClientPluginState): void;
  /** Test seams; production uses the shared bounded lifecycle defaults. */
  activateTimeoutMs?: number;
  deactivateTimeoutMs?: number;
}

/**
 * Drives exactly one plugin through its lifecycle. Activation and deactivation
 * may overlap: deactivation revokes the scope immediately, then waits only a
 * bounded amount of time for an in-flight activation/module cleanup to settle.
 */
export class ClientPluginRunner {
  state: ClientPluginState = "discovered";
  readonly scope = new PluginScope();

  private module: DeeptopClientModule | null = null;
  private loadedModule: DeeptopClientModule | null = null;
  private loadAttemptSettled = false;
  private lateLoadCleanupNeeded = false;
  private lateLoadCleanupReason: DeactivateReason = "incompatible";
  private lateLoadCleanupPromise: Promise<void> | null = null;
  private activationModule: DeeptopClientModule | null = null;
  private activationStarted = false;
  private activationAttemptSettled = false;
  private activationPromise: Promise<void> | null = null;
  private moduleDeactivationPromise: Promise<void> | null = null;
  private lateActivationCleanupNeeded = false;
  private lateActivationCleanupReason: DeactivateReason = "incompatible";
  private lateActivationCleanupPromise: Promise<void> | null = null;
  private deactivationPromise: Promise<void> | null = null;
  private disposeRequested = false;
  private readonly lifecycleController = new AbortController();
  private requestedReason: DeactivateReason | null = null;
  private readonly deps: PluginRunnerDeps;

  constructor(deps: PluginRunnerDeps) {
    this.deps = deps;
  }

  get descriptor(): DshUiPluginDescriptor {
    return this.deps.descriptor;
  }

  async activate(): Promise<void> {
    if (this.disposeRequested || this.state === "disposed") return;
    if (this.activationPromise) return this.activationPromise;
    const run = this.activateOnce();
    this.activationPromise = run;
    return run;
  }

  async deactivate(reason: DeactivateReason): Promise<void> {
    // Capability revocation is synchronous: Session listeners, events, slots,
    // AbortSignals and timers cannot stay live while plugin-owned teardown waits.
    this.disposeRequested = true;
    this.requestedReason = reason;
    if (!this.activationStarted && (!this.loadAttemptSettled || this.loadedModule)) {
      this.requestLateLoadCleanup(reason);
    }
    this.scope.dispose();
    this.lifecycleController.abort(new Error("plugin lifecycle is disposed"));
    if (!this.deactivationPromise) this.deactivationPromise = this.deactivateOnce(reason);
    return this.deactivationPromise;
  }

  private setState(state: ClientPluginState): void {
    this.state = state;
    this.deps.onStateChange?.(state);
  }

  private fail(error: unknown): never {
    const targetState = error instanceof LifecycleError ? error.targetState
      : error instanceof PluginLoadError && (error.code === "check-failed" || error.code === "load-failed") ? error.code
      : "activate-failed";
    this.scope.dispose();
    this.setState(targetState);
    throw error;
  }

  private async activateOnce(): Promise<void> {
    const { descriptor } = this.deps;
    try {
      this.setState("checking");
      if (this.disposeRequested) return;
      if (descriptor.client && !sdkVersionCompatible(descriptor.client.sdkVersion, this.deps.runtimeSdkVersion)) {
        throw new LifecycleError(
          "check-failed",
          `plugin ${descriptor.pluginId} requires SDK ${descriptor.client.sdkVersion}, runtime provides ${this.deps.runtimeSdkVersion}`,
        );
      }
      const activateTimeoutMs = this.deps.activateTimeoutMs ?? PLUGIN_ACTIVATE_TIMEOUT_MS;
      const activationDeadline = Date.now() + activateTimeoutMs;
      this.setState("loading");
      this.loadAttemptSettled = false;
      const loadAttempt = Promise.resolve().then(() => this.deps.loadModule(descriptor));
      void loadAttempt.then(
        (module) => this.loadSettled(module),
        () => this.loadRejected(),
      );
      try {
        this.module = await withDeadline(
          withAbort(loadAttempt, this.lifecycleController.signal),
          activateTimeoutMs,
          `plugin ${this.descriptor.pluginId} load timed out after ${activateTimeoutMs}ms`,
        );
      } catch (error) {
        if (!this.loadAttemptSettled || (this.loadedModule && !this.module)) {
          this.requestLateLoadCleanup(this.requestedReason ?? "incompatible");
        }
        if (error instanceof DeadlineError) {
          throw new LifecycleError("load-failed", error.message);
        }
        throw error;
      }
      if (this.disposeRequested) {
        await this.deactivateModule(this.requestedReason ?? "manual");
        this.finishDisposed();
        return;
      }
      this.setState("activating");
      this.activationStarted = true;
      const module = this.module;
      this.activationModule = module;
      this.activationAttemptSettled = false;
      const activationAttempt = Promise.resolve()
        .then(() => module.activate(this.deps.buildContext(descriptor, this.scope)))
        .then(() => undefined);
      void activationAttempt.then(
        () => this.activationSettled(module),
        () => this.activationSettled(module),
      );
      const remainingActivationMs = Math.max(0, activationDeadline - Date.now());
      try {
        await withDeadline(
          withAbort(activationAttempt, this.lifecycleController.signal),
          remainingActivationMs,
          `plugin ${this.descriptor.pluginId} activate timed out after ${activateTimeoutMs}ms`,
        );
      } catch (error) {
        // A timed-out/failed activate may have already allocated plugin-private
        // resources. Revoke exposed capabilities first, then ask the module to
        // clean itself up without keeping the catalog refresh blocked forever.
        this.scope.dispose();
        const reason = this.requestedReason ?? "incompatible";
        if (!this.activationAttemptSettled) this.requestLateActivationCleanup(module, reason);
        void this.deactivateModule(reason).catch(() => undefined);
        throw error;
      }
      if (this.disposeRequested) {
        await this.deactivateModule(this.requestedReason ?? "manual");
        this.finishDisposed();
        return;
      }
      if (this.state !== "deactivating" && this.state !== "disposed") this.setState("active");
    } catch (error) {
      if (this.disposeRequested) {
        try {
          await this.deactivateModule(this.requestedReason ?? "manual");
        } finally {
          this.finishDisposed();
        }
        return;
      }
      this.fail(error);
    }
  }

  private loadSettled(module: DeeptopClientModule): void {
    if (this.loadAttemptSettled) return;
    this.loadAttemptSettled = true;
    this.loadedModule = module;
    if (this.lateLoadCleanupNeeded) this.startLateLoadCleanup(module);
  }

  private loadRejected(): void {
    this.loadAttemptSettled = true;
    this.lateLoadCleanupNeeded = false;
  }

  private requestLateLoadCleanup(reason: DeactivateReason): void {
    this.lateLoadCleanupNeeded = true;
    this.lateLoadCleanupReason = reason;
    if (this.loadedModule) this.startLateLoadCleanup(this.loadedModule);
  }

  private startLateLoadCleanup(module: DeeptopClientModule): void {
    if (!this.lateLoadCleanupNeeded || this.lateLoadCleanupPromise || !module.deactivate) return;
    this.lateLoadCleanupNeeded = false;
    const timeoutMs = this.deps.deactivateTimeoutMs ?? PLUGIN_DEACTIVATE_TIMEOUT_MS;
    this.lateLoadCleanupPromise = withDeadline(
      Promise.resolve().then(() => module.deactivate?.(this.lateLoadCleanupReason)).then(() => undefined),
      timeoutMs,
      `plugin ${this.descriptor.pluginId} late load cleanup timed out after ${timeoutMs}ms`,
    );
    void this.lateLoadCleanupPromise.catch(() => undefined);
  }

  private activationSettled(module: DeeptopClientModule): void {
    if (this.activationModule !== module || this.activationAttemptSettled) return;
    this.activationAttemptSettled = true;
    if (this.lateActivationCleanupNeeded) this.startLateActivationCleanup(module);
  }

  private requestLateActivationCleanup(module: DeeptopClientModule, reason: DeactivateReason): void {
    this.lateActivationCleanupNeeded = true;
    this.lateActivationCleanupReason = reason;
    if (this.activationAttemptSettled) this.startLateActivationCleanup(module);
  }

  private startLateActivationCleanup(module: DeeptopClientModule): void {
    if (!this.lateActivationCleanupNeeded || this.lateActivationCleanupPromise || !module.deactivate) return;
    this.lateActivationCleanupNeeded = false;
    const timeoutMs = this.deps.deactivateTimeoutMs ?? PLUGIN_DEACTIVATE_TIMEOUT_MS;
    this.lateActivationCleanupPromise = withDeadline(
      Promise.resolve().then(() => module.deactivate?.(this.lateActivationCleanupReason)).then(() => undefined),
      timeoutMs,
      `plugin ${this.descriptor.pluginId} late activate cleanup timed out after ${timeoutMs}ms`,
    );
    // The late attempt is deliberately independent of the original bounded
    // teardown; it must be observed without reopening the disposed scope.
    void this.lateActivationCleanupPromise.catch(() => undefined);
  }

  private finishDisposed(): void {
    this.scope.dispose();
    this.module = null;
    if (this.state !== "disposed") this.setState("disposed");
  }

  private async deactivateModule(reason: DeactivateReason): Promise<void> {
    if (!this.module || !this.activationStarted || !this.module.deactivate) return;
    if (!this.moduleDeactivationPromise) {
      const module = this.module;
      const timeoutMs = this.deps.deactivateTimeoutMs ?? PLUGIN_DEACTIVATE_TIMEOUT_MS;
      this.moduleDeactivationPromise = withDeadline(
        Promise.resolve().then(() => module.deactivate?.(reason)).then(() => undefined),
        timeoutMs,
        `plugin ${this.descriptor.pluginId} deactivate timed out after ${timeoutMs}ms`,
      );
    }
    await this.moduleDeactivationPromise;
  }

  private async deactivateOnce(reason: DeactivateReason): Promise<void> {
    if (this.state === "disposed") return;
    this.setState("deactivating");
    const timeoutMs = this.deps.deactivateTimeoutMs ?? PLUGIN_DEACTIVATE_TIMEOUT_MS;
    const pending = [
      ...(this.activationPromise
        ? [withDeadline(
          this.activationPromise,
          timeoutMs,
          `plugin ${this.descriptor.pluginId} activation did not settle before deactivation`,
        )]
        : []),
      // Start module teardown at the same time as the activation wait. This
      // keeps the complete deactivation window bounded when activate hangs.
      this.deactivateModule(reason),
    ];
    const settled = await Promise.allSettled(pending);
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
    this.finishDisposed();
    if (failure !== undefined) throw failure;
  }
}
