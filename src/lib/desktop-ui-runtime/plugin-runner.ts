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

  /** Track one disposer. Returns a handle that unregisters it early. */
  add(dispose: () => void): () => void {
    if (this.disposed) return () => undefined;
    const entry = () => {
      try {
        dispose();
      } catch {
        // A failing plugin cleanup must not block sibling cleanups; the
        // deactivate caller reports the overall outcome.
      }
    };
    this.disposables.push(entry);
    return () => {
      const index = this.disposables.indexOf(entry);
      if (index >= 0) this.disposables.splice(index, 1);
    };
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

export interface PluginRunnerDeps {
  descriptor: DshUiPluginDescriptor;
  runtimeSdkVersion: string;
  loadModule(descriptor: DshUiPluginDescriptor): Promise<DeeptopClientModule>;
  buildContext(descriptor: DshUiPluginDescriptor, scope: PluginScope): DeeptopClientContext;
  onStateChange?(state: ClientPluginState): void;
}

/**
 * Drives exactly one plugin through its lifecycle. activate()/deactivate()
 * are safe to call concurrently; transitions serialize on an internal tail.
 */
export class ClientPluginRunner {
  state: ClientPluginState = "discovered";
  readonly scope = new PluginScope();

  private module: DeeptopClientModule | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly deps: PluginRunnerDeps;

  constructor(deps: PluginRunnerDeps) {
    this.deps = deps;
  }

  get descriptor(): DshUiPluginDescriptor {
    return this.deps.descriptor;
  }

  async activate(): Promise<void> {
    const run = this.tail.then(() => this.activateOnce());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async deactivate(reason: DeactivateReason): Promise<void> {
    const run = this.tail.then(() => this.deactivateOnce(reason));
    this.tail = run.then(() => undefined, () => undefined);
    return run;
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
      if (descriptor.client && !sdkVersionCompatible(descriptor.client.sdkVersion, this.deps.runtimeSdkVersion)) {
        throw new LifecycleError(
          "check-failed",
          `plugin ${descriptor.pluginId} requires SDK ${descriptor.client.sdkVersion}, runtime provides ${this.deps.runtimeSdkVersion}`,
        );
      }
      this.setState("loading");
      this.module = await this.deps.loadModule(descriptor);
      this.setState("activating");
      await this.module.activate(this.deps.buildContext(descriptor, this.scope));
      this.setState("active");
    } catch (error) {
      this.fail(error);
    }
  }

  private async deactivateOnce(reason: DeactivateReason): Promise<void> {
    if (this.state === "disposed" || this.state === "deactivating") return;
    this.setState("deactivating");
    const module = this.module;
    try {
      await module?.deactivate?.(reason);
    } finally {
      this.scope.dispose();
      this.module = null;
      this.setState("disposed");
    }
  }
}
