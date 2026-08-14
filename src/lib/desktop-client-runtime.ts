import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  bridgeRequest,
  isDshRemoteEvent,
  listenToBridgeEvent,
  type DshBridgeEvent,
  type DshRemoteEvent,
} from "./desktop";

export type DesktopRemoteEventHandler = (event: DshRemoteEvent) => void;

export interface DesktopClientRuntime {
  readonly isLoopback: true;
  request<T>(method: string, payload?: Record<string, unknown>): Promise<T>;
  remote: {
    invoke<T>(namespace: string, method: string, args?: Record<string, unknown>): Promise<T>;
    on(event: string, handler: DesktopRemoteEventHandler): Promise<UnlistenFn>;
  };
  start(handler: (event: DshBridgeEvent) => void): Promise<UnlistenFn>;
}

export function createDesktopClientRuntime(): DesktopClientRuntime {
  return {
    isLoopback: true,
    request: bridgeRequest,
    remote: {
      async invoke<T>(namespace: string, method: string, args: Record<string, unknown> = {}) {
        const result = await bridgeRequest<{ value: T }>("remote.invoke", { namespace, method, args });
        return result.value;
      },
      async on(event, handler) {
        return listenToBridgeEvent((frame) => {
          if (isDshRemoteEvent(frame) && frame.frame.payload.event === event) {
            handler(frame.frame.payload);
          }
        });
      },
    },
    start: listenToBridgeEvent,
  };
}

export const desktopClientRuntime = createDesktopClientRuntime();
