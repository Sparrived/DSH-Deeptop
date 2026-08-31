// Host availability coordinator for the desktop UI runtime.
// Kept independent of React/Tauri so transition races can be tested with Node.

export interface UiRuntimeHostLifecycleRuntime {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  handleHostUnavailable(): Promise<void>;
  handleHostRestart(): Promise<void>;
  refresh(): Promise<boolean>;
}

export interface UiRuntimeHostLifecycleOptions {
  /** The latest native status known before this coordinator is mounted. */
  initialHostAvailable?: boolean;
  onError?(error: unknown): void;
}

/**
 * Coordinates one app-scoped runtime through initial discovery and native Host
 * availability transitions. Down invalidates synchronously in the runtime;
 * every asynchronous continuation checks the availability epoch before it can
 * attach or refresh the Client catalog.
 */
export class UiRuntimeHostLifecycle {
  private disposed = false;
  private hostAvailable: boolean;
  private runtimeStarted = false;
  private runtimeInvalidated = false;
  private retryNeeded = false;
  private epoch = 0;
  private startTask: Promise<void> | null = null;
  private recoveryTask: Promise<void> | null = null;
  private pendingRecovery = false;
  private pendingStartRetry = false;
  private readonly runtime: UiRuntimeHostLifecycleRuntime;
  private readonly onError: (error: unknown) => void;

  constructor(runtime: UiRuntimeHostLifecycleRuntime, options: UiRuntimeHostLifecycleOptions = {}) {
    this.runtime = runtime;
    this.hostAvailable = options.initialHostAvailable ?? true;
    this.retryNeeded = !this.hostAvailable;
    this.onError = options.onError ?? (() => undefined);
  }

  /** Begin initial discovery once the status listener is installed. */
  start(): void {
    if (this.disposed || !this.hostAvailable) return;
    if (this.runtimeInvalidated) {
      // A listener-first status seed can call start() while the ready frame has
      // already begun recovery. Do not advance the epoch in that case: doing so
      // would make the current recovery stale and force a second restart.
      if (this.recoveryTask || this.startTask) {
        // Retain an explicit start request for a failed recovery, but never
        // advance the epoch that the in-flight recovery is validating.
        this.pendingRecovery = true;
        return;
      }
      this.beginRecovery(++this.epoch);
      return;
    }
    if (this.runtimeStarted || this.startTask) return;
    this.beginStart(++this.epoch);
  }

  statusChanged(runtimeAvailable: boolean): void {
    if (this.disposed) return;
    if (!runtimeAvailable) {
      this.hostAvailable = false;
      this.runtimeStarted = false;
      this.retryNeeded = true;
      this.runtimeInvalidated = true;
      this.pendingRecovery = false;
      this.pendingStartRetry = false;
      this.epoch += 1;
      // This method is idempotent. Forward each down frame so a down→up race
      // during recovery also invalidates the newly attached runtime generation.
      void this.runtime.handleHostUnavailable().catch((error) => this.report(error));
      return;
    }

    const wasUnavailable = !this.hostAvailable;
    this.hostAvailable = true;
    if (wasUnavailable) {
      const epoch = ++this.epoch;
      if (this.runtimeInvalidated) this.beginRecovery(epoch);
      else if (!this.runtimeStarted && !this.startTask) this.beginStart(epoch);
      return;
    }
    // Repeated ready frames are common around native process startup. Do not
    // stale an in-flight recovery; a failed recovery can be retried once no
    // task remains.
    if (this.runtimeInvalidated) {
      if (this.recoveryTask || this.startTask) {
        this.pendingRecovery = true;
      } else {
        this.beginRecovery(++this.epoch);
      }
      return;
    }
    if (!this.runtimeStarted) {
      if (this.startTask) {
        this.pendingStartRetry = true;
      } else if (this.retryNeeded) {
        this.beginStart(++this.epoch);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hostAvailable = false;
    this.runtimeStarted = false;
    this.runtimeInvalidated = true;
    this.retryNeeded = true;
    this.pendingRecovery = false;
    this.pendingStartRetry = false;
    this.epoch += 1;
    void this.runtime.stop().catch((error) => this.report(error));
  }

  private beginStart(epoch: number): void {
    if (this.disposed || !this.hostAvailable || this.startTask) return;
    this.pendingStartRetry = false;
    const task = (async () => {
      let ready = false;
      try {
        ready = await this.runtime.start();
        if (!this.isCurrent(epoch)) {
          // The runtime owns its own Host epoch and was synchronously
          // invalidated by statusChanged(false). Do not call shared stop() from
          // this stale coordinator: a later StrictMode owner may already have
          // started a fresh generation on the same app-scoped runtime.
          return;
        }
        this.runtimeStarted = ready;
        this.retryNeeded = !ready;
      } catch (error) {
        this.runtimeStarted = false;
        this.retryNeeded = true;
        this.report(error);
      } finally {
        this.startTask = null;
        const retryStart = this.pendingStartRetry && !this.runtimeStarted;
        this.pendingStartRetry = false;
        if (this.disposed || !this.hostAvailable) return;
        if (this.runtimeInvalidated) {
          this.beginRecovery(this.epoch);
        } else if (epoch !== this.epoch) {
          // A status transition arrived while discovery was pending. Its result
          // is stale, so discover against the current availability epoch.
          this.beginStart(this.epoch);
        } else if (retryStart) {
          this.beginStart(++this.epoch);
        }
      }
    })();
    this.startTask = task;
  }

  private beginRecovery(epoch: number): void {
    if (this.disposed || !this.hostAvailable) return;
    if (this.recoveryTask) {
      this.pendingRecovery = true;
      return;
    }
    if (this.startTask) {
      this.pendingRecovery = true;
      return;
    }
    this.pendingRecovery = false;
    const task = (async () => {
      let ready = false;
      try {
        await this.runtime.handleHostRestart();
        if (!this.isCurrent(epoch)) return;
        ready = await this.runtime.refresh();
        if (!this.isCurrent(epoch)) return;
        this.runtimeStarted = ready;
        this.retryNeeded = !ready;
        if (ready) this.runtimeInvalidated = false;
      } catch (error) {
        this.runtimeStarted = false;
        this.retryNeeded = true;
        this.report(error);
      } finally {
        this.recoveryTask = null;
        const retryRecovery = this.pendingRecovery || epoch !== this.epoch;
        this.pendingRecovery = false;
        if (this.disposed || !this.hostAvailable) return;
        if (this.runtimeInvalidated && retryRecovery) this.beginRecovery(this.epoch);
      }
    })();
    this.recoveryTask = task;
  }

  private isCurrent(epoch: number): boolean {
    return !this.disposed && this.hostAvailable && this.epoch === epoch;
  }

  private report(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Error reporting must not create an unhandled rejection in lifecycle code.
    }
  }
}
