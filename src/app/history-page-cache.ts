import type { DshHistoryEntry } from "../lib/desktop";

/**
 * 会话历史分页缓存：按会话隔离、以 (sessionId, beforeSeq) 为键缓存已经
 * 拉取过的历史页，重复翻页（切出再切回、回看后前进）不再重复请求 Bridge。
 *
 * 语义：
 * - `beforeSeq` 缺省表示最新页；数值表示该页之前的最大 seq，页内条目按 seq 升序返回。
 * - 命中整页时直接返回缓存结果；未命中时置 loading 水位，请求失败后清除。
 * - 新会话事件只会使最新页失效，已结束的较早页仍可复用；运行时恢复或日志修复会清除整段会话缓存。
 * - 会话删除时按会话移除；缓存同时限制每会话页数和全局总页数，按最近写入
 *   顺序淘汰旧页，避免长会话或大量会话分页把内存撑爆。
 */
export type HistoryPageKey = string;

export type HistoryPageProjections = {
  asOfSeq?: number;
  values: Record<string, unknown>;
};

export type HistoryPage = {
  entries: DshHistoryEntry[];
  hasMore: boolean;
  projections?: HistoryPageProjections;
};

export type HistoryLatestLoad = {
  version: number;
  token: number;
};

export interface HistoryViewOwner {
  sessionId: string;
  generation: number;
}

/** Reject stale requests across both session switches and A→B→A ABA cycles. */
export function ownsHistoryView(
  owner: HistoryViewOwner,
  activeSessionId: string | null,
  activeGeneration: number,
): boolean {
  return owner.sessionId === activeSessionId && owner.generation === activeGeneration;
}

export function historyPageKey(sessionId: string, beforeSeq?: number): HistoryPageKey {
  return `${sessionId}\u0000${beforeSeq === undefined ? "latest" : beforeSeq}`;
}

export interface HistoryPageCache {
  put(sessionId: string, beforeSeq: number | undefined, entries: DshHistoryEntry[], hasMore: boolean, projections?: HistoryPageProjections): void;
  /** 命中缓存时返回页面及最新页携带的投影，未命中返回 undefined。 */
  get(sessionId: string, beforeSeq?: number): HistoryPage | undefined;
  /** 记录一个已发起的请求；重复翻页命中 loading 时避免并发重复请求。 */
  markLoading(sessionId: string, beforeSeq?: number): boolean;
  unmarkLoading(sessionId: string, beforeSeq?: number): void;
  isLoading(sessionId: string, beforeSeq?: number): boolean;
  /** 开始加载最新页，并返回可用于检测事件竞态的标记。 */
  beginLatestLoad(sessionId: string): HistoryLatestLoad;
  /** 标记仍是当前加载且会话中没有新事件时为 true。 */
  isLatestCurrent(sessionId: string, load: HistoryLatestLoad): boolean;
  /** 结束对应的最新页加载。 */
  endLatestLoad(sessionId: string, load: HistoryLatestLoad): void;
  /** 使最新页失效；已结束的历史页仍能复用。 */
  invalidateLatest(sessionId: string): void;
  removeSession(sessionId: string): void;
  clear(): void;
  /** 当前缓存覆盖的会话数与总页数（诊断用）。 */
  stats(): { sessions: number; pages: number };
}

export function createHistoryPageCache(options?: { maxPagesPerSession?: number; maxTotalPages?: number }): HistoryPageCache {
  const maxPagesPerSession = options?.maxPagesPerSession ?? 20;
  const maxTotalPages = options?.maxTotalPages ?? 256;
  const pages = new Map<HistoryPageKey, HistoryPage>();
  const pageSessions = new Map<HistoryPageKey, string>();
  const sessionOrder = new Map<string, string[]>();
  const pageOrder: string[] = [];
  const loading = new Set<string>();
  const latestVersions = new Map<string, number>();
  const activeLatestLoadTokens = new Map<string, number>();
  let nextLatestLoadToken = 0;

  function key(sessionId: string, beforeSeq?: number): HistoryPageKey {
    return historyPageKey(sessionId, beforeSeq);
  }

  function removePage(pageKey: HistoryPageKey): void {
    if (!pages.delete(pageKey)) return;
    const sessionId = pageSessions.get(pageKey);
    pageSessions.delete(pageKey);
    const globalIndex = pageOrder.indexOf(pageKey);
    if (globalIndex >= 0) pageOrder.splice(globalIndex, 1);
    if (!sessionId) return;
    const order = sessionOrder.get(sessionId);
    if (!order) return;
    const sessionIndex = order.indexOf(pageKey);
    if (sessionIndex >= 0) order.splice(sessionIndex, 1);
    if (order.length === 0) sessionOrder.delete(sessionId);
  }

  function touchSession(sessionId: string, pageKey: string): void {
    const order = sessionOrder.get(sessionId) ?? [];
    const next = [...order.filter((item) => item !== pageKey), pageKey];
    sessionOrder.set(sessionId, next);
    while (next.length > maxPagesPerSession) {
      const evicted = next.shift();
      if (evicted !== undefined) removePage(evicted);
    }
  }

  function touchGlobal(pageKey: string): void {
    const index = pageOrder.indexOf(pageKey);
    if (index >= 0) pageOrder.splice(index, 1);
    pageOrder.push(pageKey);
    while (pageOrder.length > maxTotalPages) {
      const oldest = pageOrder[0];
      if (oldest === undefined) break;
      removePage(oldest);
    }
  }

  return {
    put(sessionId, beforeSeq, entries, hasMore, projections) {
      const pageKey = key(sessionId, beforeSeq);
      pages.set(pageKey, { entries, hasMore, ...(projections ? { projections } : {}) });
      pageSessions.set(pageKey, sessionId);
      touchSession(sessionId, pageKey);
      touchGlobal(pageKey);
    },
    get(sessionId, beforeSeq) {
      return pages.get(key(sessionId, beforeSeq));
    },
    markLoading(sessionId, beforeSeq) {
      const pageKey = key(sessionId, beforeSeq);
      if (loading.has(pageKey)) return false;
      loading.add(pageKey);
      return true;
    },
    unmarkLoading(sessionId, beforeSeq) {
      loading.delete(key(sessionId, beforeSeq));
    },
    isLoading(sessionId, beforeSeq) {
      return loading.has(key(sessionId, beforeSeq));
    },
    beginLatestLoad(sessionId) {
      const latestKey = key(sessionId, undefined);
      const token = ++nextLatestLoadToken;
      activeLatestLoadTokens.set(sessionId, token);
      loading.add(latestKey);
      return { version: latestVersions.get(sessionId) ?? 0, token };
    },
    isLatestCurrent(sessionId, load) {
      return activeLatestLoadTokens.get(sessionId) === load.token
        && (latestVersions.get(sessionId) ?? 0) === load.version;
    },
    endLatestLoad(sessionId, load) {
      if (activeLatestLoadTokens.get(sessionId) !== load.token) return;
      activeLatestLoadTokens.delete(sessionId);
      latestVersions.delete(sessionId);
      loading.delete(key(sessionId, undefined));
    },
    invalidateLatest(sessionId) {
      const latestKey = key(sessionId, undefined);
      if (loading.has(latestKey)) latestVersions.set(sessionId, (latestVersions.get(sessionId) ?? 0) + 1);
      removePage(latestKey);
    },
    removeSession(sessionId) {
      const order = [...(sessionOrder.get(sessionId) ?? [])];
      for (const pageKey of order) removePage(pageKey);
      sessionOrder.delete(sessionId);
      latestVersions.delete(sessionId);
      activeLatestLoadTokens.delete(sessionId);
      for (const pageKey of [...loading]) {
        if (pageKey.startsWith(`${sessionId}\u0000`)) loading.delete(pageKey);
      }
    },
    clear() {
      pages.clear();
      pageSessions.clear();
      sessionOrder.clear();
      pageOrder.length = 0;
      loading.clear();
      latestVersions.clear();
      activeLatestLoadTokens.clear();
      nextLatestLoadToken = 0;
    },
    stats() {
      return { sessions: sessionOrder.size, pages: pages.size };
    },
  };
}

/** 应用级历史分页缓存单例：App 分页加载写入，bridge-event-handler 清理。 */
export const historyPageCache = createHistoryPageCache({ maxPagesPerSession: 24, maxTotalPages: 256 });

/** 语义化页大小的默认值（App 可用同值；独立模块便于测试与文档一致）。 */
export const HISTORY_PAGE_SIZE_DEFAULT = 40;