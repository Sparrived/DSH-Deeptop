// Scoped capability clients (docs/DEEPTOP_UI_RUNTIME.md §7.7–7.9). Every call
// routes through the restricted ui.plugin.* bridge routes; the client enforces
// declared namespaces up front so misuse fails locally before any wire traffic.

import { UiPluginErrorCode } from "../../app/ui-plugin-model.ts";
import type { DshUiPluginCapabilities } from "../../app/ui-plugin-model.ts";
import type { ScopedRemoteClient, ScopedStorage } from "./types.ts";

export interface RuntimeRequestSender {
  request<T>(method: string, payload: Record<string, unknown>): Promise<T>;
}

export class CapabilityDeniedError extends Error {
  code = UiPluginErrorCode.capabilityDenied;

  constructor(message: string) {
    super(message);
    this.name = "CapabilityDeniedError";
  }
}

/** Build the plugin-scoped remote facade over `ui.plugin.invoke`. */
export function createScopedRemote(
  pluginId: string,
  capabilities: DshUiPluginCapabilities,
  send: RuntimeRequestSender,
): ScopedRemoteClient {
  const declared = capabilities.remotes;
  const invokeIn = async <T>(namespace: string, method: string, args?: Record<string, unknown>): Promise<T> => {
    const remote = declared.find((item) => item.namespace === namespace);
    if (!remote) {
      throw new CapabilityDeniedError(`plugin ${pluginId} does not declare remote namespace "${namespace}"`);
    }
    if (!remote.methods.includes(method)) {
      throw new CapabilityDeniedError(`plugin ${pluginId} does not declare method "${namespace}.${method}"`);
    }
    const response = await send.request<{ value: T }>("ui.plugin.invoke", {
      pluginId,
      namespace,
      method,
      args: args ?? {},
    });
    return response.value;
  };
  return {
    invoke<T>(method: string, args?: Record<string, unknown>) {
      if (declared.length !== 1) {
        return Promise.reject(new CapabilityDeniedError(
          declared.length === 0
            ? `plugin ${pluginId} declares no remote namespaces`
            : `plugin ${pluginId} declares several remotes; use invokeIn(namespace, ...)`,
        ));
      }
      return invokeIn<T>(declared[0].namespace, method, args);
    },
    invokeIn,
  };
}

/** Build the plugin-scoped storage facade over `ui.plugin.storage.*`. Enforcement is host-side: the bridge rejects plugins whose manifest declares no storage namespace. */
export function createScopedStorage(
  pluginId: string,
  send: RuntimeRequestSender,
): ScopedStorage {
  return {
    async get<T>(key: string) {
      const response = await send.request<{ value: T | null }>("ui.plugin.storage.get", { pluginId, key });
      return response.value;
    },
    async set(key: string, value: unknown) {
      await send.request("ui.plugin.storage.set", { pluginId, key, value });
    },
    async delete(key: string) {
      await send.request("ui.plugin.storage.delete", { pluginId, key });
    },
  };
}

/**
 * Per-plugin event dispatcher: only manifest-declared events are delivered,
 * and disposal detaches every handler so a deactivated plugin stops receiving
 * frames even if the runtime still dispatches globally.
 */
export class PluginEventScope {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly pluginId: string;
  private readonly declaredEvents: () => readonly string[];

  constructor(pluginId: string, declaredEvents: () => readonly string[]) {
    this.pluginId = pluginId;
    this.declaredEvents = declaredEvents;
  }

  on(event: string, handler: (payload: unknown) => void): () => void {
    if (!this.declaredEvents().includes(event)) {
      throw new CapabilityDeniedError(`plugin ${this.pluginId} does not declare event "${event}"`);
    }
    let bucket = this.handlers.get(event);
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(event, bucket);
    }
    bucket.add(handler);
    return () => {
      const current = this.handlers.get(event);
      current?.delete(handler);
      if (current && current.size === 0) this.handlers.delete(event);
    };
  }

  /** Deliver one bridge frame payload; returns true when some handler consumed it. */
  dispatch(event: string, payload: unknown): boolean {
    const bucket = this.handlers.get(event);
    if (!bucket || bucket.size === 0) return false;
    for (const handler of [...bucket]) handler(payload);
    return true;
  }

  dispose(): void {
    this.handlers.clear();
  }

  get isEmpty(): boolean {
    return this.handlers.size === 0;
  }
}
