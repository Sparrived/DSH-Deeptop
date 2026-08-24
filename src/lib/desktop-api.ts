import {
  desktopClientRuntime,
} from "./desktop-client-runtime";
import { bridgeRequest } from "./desktop";
import {
  isBridgeUnavailableError,
  remoteContracts,
  type BridgeMethodName,
  type BridgeMethodPayload,
  type BridgeMethodValue,
  type RemoteMethodArgs,
  type RemoteMethodName,
  type RemoteMethodValue,
  type BridgeRequestOptions,
} from "./bridge-contracts";
import { waitForBridgeAvailable } from "./bridge-link";

/**
 * 契约驱动的桌面桥调用入口（运行时层）。
 * 类型来自 `bridge-contracts.ts` 的统一登记；超时由 `bridgeRequest` 落实，
 * 断线重连等待由 `bridge-link` 落实。
 */

export type DesktopRequestOptions = BridgeRequestOptions & {
  /** 桥不可用（DSH 重启/未就绪）时，等待运行时恢复后重试一次。 */
  waitForReconnect?: boolean;
};

/**
 * 按契约登记发起桌面桥请求：载荷与返回值类型由登记推断，
 * 调用点不再手写 `bridgeRequest<T>(...)` 的泛型。
 *
 * `waitForReconnect` 统一了断线重连语义：桥侧失败属于 `bridge-unavailable`
 * （DSH 重启、未就绪或进程退出）时，等待运行时恢复（有界等待）后重试一次；
 * 其他错误（业务失败、取消、超时）原样返回，不吞错。
 */
export async function desktopRequest<M extends BridgeMethodName>(
  method: M,
  payload?: BridgeMethodPayload<M>,
  signal?: AbortSignal,
  options?: DesktopRequestOptions,
): Promise<BridgeMethodValue<M>> {
  const request = () => bridgeRequest(
    method,
    (payload ?? {}) as unknown as Record<string, unknown>,
    signal,
    options,
  );
  if (!options?.waitForReconnect) return request();
  try {
    return await request();
  } catch (error) {
    if (!isBridgeUnavailableError(error)) throw error;
    await waitForBridgeAvailable(signal);
    return request();
  }
}

/** 按官方 Remote 契约调用 Typert Remote 方法（如 commands.list/execute）。 */
export async function desktopRemoteInvoke<K extends RemoteMethodName>(
  key: K,
  args: RemoteMethodArgs<K>,
  signal?: AbortSignal,
  options?: DesktopRequestOptions,
): Promise<RemoteMethodValue<K>> {
  const contract = remoteContracts[key];
  const request = () => desktopClientRuntime.remote.invoke<RemoteMethodValue<K>>(
    contract.namespace,
    contract.method,
    args as unknown as Record<string, unknown>,
    signal,
    options,
  );
  if (!options?.waitForReconnect) return request();
  try {
    return await request();
  } catch (error) {
    if (!isBridgeUnavailableError(error)) throw error;
    await waitForBridgeAvailable(signal);
    return request();
  }
}
