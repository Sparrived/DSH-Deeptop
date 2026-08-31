// React binding for the desktop UI runtime (docs/DEEPTOP_UI_RUNTIME.md §14.3):
// App calls one hook, receives the runtime for SlotOutlet hosts, and feeds the
// current session view back so slot contexts stay serializable and fresh.

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  bridgeRequest,
  checkDsh,
  listenToBridgeEvent,
  listenToRuntimeStatus,
  resolveUiPluginBundle,
  type DshBridgeEvent,
} from "../lib/desktop";
import { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import { bundledUiClientModules } from "../lib/desktop-ui-runtime/bundled-modules";
import { UiRuntimeHostLifecycle } from "../lib/desktop-ui-runtime/host-lifecycle";

let sharedRuntime: DesktopUiRuntime | null = null;
const STATUS_RETRY_INITIAL_MS = 250;
const STATUS_RETRY_MAX_MS = 5_000;

function getOrCreateRuntime(enabled = true): DesktopUiRuntime {
  if (!sharedRuntime) {
    sharedRuntime = new DesktopUiRuntime({
      enabled,
      request: <T,>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) => bridgeRequest<T>(method, payload, signal),
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
  const enabled = options.enabled ?? true;
  const runtimeRef = useRef<DesktopUiRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = getOrCreateRuntime(enabled);
  const runtime = runtimeRef.current;

  useLayoutEffect(() => {
    void runtime.setEnabled(enabled).catch((error) => console.error("UI Runtime enablement failed", error));
  }, [runtime, enabled]);

  useEffect(() => {
    if (!enabled) return () => undefined;

    let disposed = false;
    let statusRevision = 0;
    let statusUnlisten: (() => void) | null = null;
    let statusRegistration: Promise<() => void> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = STATUS_RETRY_INITIAL_MS;
    const lifecycle = new UiRuntimeHostLifecycle(runtime, {
      onError: (error) => console.error("UI Runtime Host lifecycle failed", error),
    });
    const onStatus = (status: Parameters<Parameters<typeof listenToRuntimeStatus>[0]>[0]) => {
      statusRevision += 1;
      if (!disposed) lifecycle.statusChanged(status.runtimeAvailable);
    };
    const scheduleStatusListenerRetry = () => {
      if (disposed || statusUnlisten || statusRegistration || retryTimer) return;
      const delay = retryDelay;
      retryDelay = Math.min(STATUS_RETRY_MAX_MS, retryDelay * 2);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        registerStatusListener();
      }, delay);
    };
    const registerStatusListener = () => {
      if (disposed || statusUnlisten || statusRegistration) return;
      const registration = listenToRuntimeStatus(onStatus);
      statusRegistration = registration;
      void registration.then(
        (unlisten) => {
          statusRegistration = null;
          if (disposed) {
            unlisten();
            return;
          }
          statusUnlisten = unlisten;
          retryDelay = STATUS_RETRY_INITIAL_MS;
          // The native event stream has no replay. Register it first, then
          // seed from the authoritative snapshot only when no newer event was
          // observed after this query began.
          const revisionAtQueryStart = statusRevision;
          void checkDsh().then(
            (status) => {
              if (!disposed && statusRevision === revisionAtQueryStart) {
                lifecycle.statusChanged(status.runtimeAvailable);
              }
            },
            (error) => {
              if (!disposed) console.error("UI Runtime initial Host status failed", error);
            },
          ).finally(() => {
            if (!disposed) lifecycle.start();
          });
        },
        (error) => {
          statusRegistration = null;
          if (disposed) return;
          console.error("UI Runtime status listener failed", error);
          lifecycle.start();
          scheduleStatusListenerRetry();
        },
      );
    };

    registerStatusListener();
    return () => {
      disposed = true;
      lifecycle.dispose();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      statusUnlisten?.();
      statusUnlisten = null;
      // A pending registration's success handler observes disposed and
      // immediately releases the just-created native listener.
    };
  }, [runtime, enabled]);

  return runtime;
}
