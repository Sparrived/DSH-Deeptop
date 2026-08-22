import {
  bridgeLinkReduce,
  initialBridgeLinkSnapshot,
  BRIDGE_RECONNECT_WAIT_MS,
  type BridgeLinkSnapshot,
} from "../app/bridge-link-model";
import { DshApiError, isTauri, listenToRuntimeStatus } from "./desktop";

/**
 * DSH 桥链路的运行时胶水：订阅运行时状态，维护在场可用的能力快照，
 * 并为 `waitForReconnect` 提供“等到运行时恢复”的有界等待。
 */

let snapshot: BridgeLinkSnapshot = initialBridgeLinkSnapshot();
const changeListeners = new Set<() => void>();
let subscribed = false;

export function bridgeLinkSnapshot(): BridgeLinkSnapshot {
  return snapshot;
}

/** 从 App 的就绪/启动路径同步一次运行时状态（接收 DshStatus 事件和启动检查结果）。 */
export function seedBridgeLinkStatus(status: { runtimeAvailable: boolean; message: string }): void {
  const next = bridgeLinkReduce(snapshot, {
    type: "status",
    available: status.runtimeAvailable,
    message: status.message,
  });
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of changeListeners) listener();
}

export function subscribeBridgeLink(listener: () => void): () => void {
  ensureSubscribed();
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function ensureSubscribed() {
  if (subscribed || !isTauri()) return;
  subscribed = true;
  void listenToRuntimeStatus((status) => {
    seedBridgeLinkStatus(status);
  }).catch(() => {
    // 订阅失败时保持未订阅状态；后续 waitForBridgeAvailable 会再次尝试。
    subscribed = false;
  });
}

/**
 * 等待 DSH 运行时重新可用（有界，默认 30s）。
 * 已在可用状态立即返回；超时抛出 `bridge-timeout`；外部 signal 中止则透传中止原因。
 */
export async function waitForBridgeAvailable(
  signal?: AbortSignal,
  timeoutMs = BRIDGE_RECONNECT_WAIT_MS,
): Promise<void> {
  if (!isTauri()) return;
  ensureSubscribed();
  if (snapshot.phase === "available") return;
  if (signal?.aborted) throw signal.reason ?? new DOMException("请求已取消", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new DshApiError({
        code: "bridge-timeout",
        message: "等待 DSH 运行时恢复超时，请重新启动 Deeptop 后再试",
      }));
    }, timeoutMs);
    const abortListener = () => {
      cleanup();
      reject(signal!.reason ?? new DOMException("请求已取消", "AbortError"));
    };
    const changeListener = () => {
      if (snapshot.phase !== "available") return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortListener);
      changeListeners.delete(changeListener);
    };
    signal?.addEventListener("abort", abortListener, { once: true });
    changeListeners.add(changeListener);
  });
}
