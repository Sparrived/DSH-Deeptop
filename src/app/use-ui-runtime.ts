// React binding for the desktop UI runtime (docs/DEEPTOP_UI_RUNTIME.md §14.3):
// App calls one hook, receives the runtime for SlotOutlet hosts, and feeds the
// current session view back so slot contexts stay serializable and fresh.

import { useEffect, useRef } from "react";
import {
  bridgeRequest,
  listenToBridgeEvent,
  listenToRuntimeStatus,
  resolveUiPluginBundle,
  type DshBridgeEvent,
} from "../lib/desktop";
import { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import { bundledUiClientModules } from "../lib/desktop-ui-runtime/bundled-modules";

let sharedRuntime: DesktopUiRuntime | null = null;

function getOrCreateRuntime(): DesktopUiRuntime {
  if (!sharedRuntime) {
    sharedRuntime = new DesktopUiRuntime({
      request: <T,>(method: string, payload: Record<string, unknown> = {}) => bridgeRequest<T>(method, payload),
      listen: (handler) => {
        // Tauri's listen resolves asynchronously; hand the runtime a synchronous unlisten.
        const unlistened = listenToBridgeEvent((event: DshBridgeEvent) => {
          if (event.type === "event") handler(event);
        });
        return () => {
          void unlistened.then((unlisten) => unlisten(), () => undefined);
        };
      },
      bundledModules: bundledUiClientModules,
      // Phase 2: external bundles load through the Tauri controlled resource
      // protocol (path fence + integrity enforced in the desktop process).
      resolveBundle: (pluginId) => resolveUiPluginBundle(pluginId),
    });
  }
  return sharedRuntime;
}

export interface UseDesktopUiRuntimeOptions {
  /** Master switch; false keeps every plugin unloaded and slots empty. */
  enabled?: boolean;
}

/**
 * Owns the app-scoped UI runtime lifecycle: discovery on mount, re-discovery
 * after DSH restarts (runtimeAvailable false→true), teardown on unmount.
 */
export function useDesktopUiRuntime(options: UseDesktopUiRuntimeOptions = {}): DesktopUiRuntime {
  const runtimeRef = useRef<DesktopUiRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = getOrCreateRuntime();
  const runtime = runtimeRef.current;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    let wasHostAvailable = true;
    let disposed = false;
    void runtime.start();
    const unlistenStatus = listenToRuntimeStatus((status) => {
      if (!status.runtimeAvailable) {
        wasHostAvailable = false;
        return;
      }
      if (wasHostAvailable || disposed) return;
      // Host came back: drop old-generation plugin state, then rediscover.
      wasHostAvailable = true;
      void runtime.handleHostRestart().then(() => runtime.refresh());
    });
    return () => {
      disposed = true;
      void unlistenStatus.then((unlisten) => unlisten());
      void runtime.stop();
    };
  }, [runtime, enabled]);

  return runtime;
}
