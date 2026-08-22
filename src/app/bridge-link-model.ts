/**
 * DSH 桥链路状态的纯模型：跟踪运行时可用性，供断线重连语义使用。
 * 不依赖 Tauri/React，可在 Node 中直接测试。
 */

export type BridgePhase = "unknown" | "available" | "unavailable";

export interface BridgeLinkSnapshot {
  phase: BridgePhase;
  /** 最近一次运行时状态消息（未就绪原因等）。 */
  message: string;
  /** 进入当前相位的时间戳（毫秒）；unknown 时为空。 */
  changedAt?: number;
}

export type BridgeLinkEvent =
  | { type: "status"; available: boolean; message: string }
  | { type: "reset" };

export const initialBridgeLinkSnapshot = (): BridgeLinkSnapshot => ({
  phase: "unknown",
  message: "",
});

export function bridgeLinkReduce(
  snapshot: BridgeLinkSnapshot,
  event: BridgeLinkEvent,
): BridgeLinkSnapshot {
  if (event.type === "reset") return initialBridgeLinkSnapshot();
  const phase: BridgePhase = event.available ? "available" : "unavailable";
  if (snapshot.phase === phase && snapshot.message === event.message) return snapshot;
  return { phase, message: event.message, changedAt: Date.now() };
}

/** 是否可以把一次失败归类为“桥暂时不可用”，从而触发重连等待。 */
export function retryableBridgeFailure(code: string | undefined): boolean {
  return code === "bridge-unavailable";
}

/** 重连等待的有界上限（毫秒）；超过后放弃并抛出桥超时错误。 */
export const BRIDGE_RECONNECT_WAIT_MS = 30_000;
