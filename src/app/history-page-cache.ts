import type { DshHistoryEntry } from "../lib/desktop";

/**
 * 会话历史分页缓存：按会话隔离、以 (sessionId, beforeSeq) 为键缓存已经
 * 拉取过的历史页，重复翻页（切出再切回、回看后前进）不再重复请求 Bridge。
 *
 * 语义：
 * - 页键为“该页之前的最大 seq”（beforeSeq），页内条目按 seq 升序返回。
 * - 命中整页时直接返回缓存结果；未命中时置 loading 水位，请求失败后清除。
 * - 会话切换/删除时按会话移除；缓存上限采用简单的 FIFO 淘汰（每会话最多
 *   保留 `maxPagesPerSession` 页），避免长会话分页把内存撑爆。
 */
export type HistoryPageKey = string;

export function historyPageKey(sessionId: string, beforeSeq: number): HistoryPageKey {
  return `${sessionId}\u0000${beforeSeq}`;
}

export interface HistoryPageCache {
  put(sessionId: string, beforeSeq: number, entries: DshHistoryEntry[], hasMore: boolean): void;
  /** 命中缓存时返回 { entries, hasMore }，未命中返回 undefined。 */
  get(sessionId: string, beforeSeq: number): { entries: DshHistoryEntry[]; hasMore: boolean } | undefined;
  /** 记录一个已发起的请求；重复翻页命中 loading 时避免并发重复请求。 */
  markLoading(sessionId: string, beforeSeq: number): boolean;
  unmarkLoading(sessionId: string, beforeSeq: number): void;
  isLoading(sessionId: string, beforeSeq: number): boolean;
  removeSession(sessionId: string): void;
  clear(): void;
  /** 最近一次缓存的页大小中位数（诊断用；0 表示无缓存）。 */
  stats(): { sessions: number; pages: number };
}

export function createHistoryPageCache(options?: { maxPagesPerSession?: number }): HistoryPageCache {
  const maxPagesPerSession = options?.maxPagesPerSession ?? 20;
  const pages = new Map<HistoryPageKey, { entries: DshHistoryEntry[]; hasMore: boolean }>();
  const sessionOrder = new Map<string, string[]>();
  const loading = new Set<string>();

  function key(sessionId: string, beforeSeq: number): HistoryPageKey {
    return historyPageKey(sessionId, beforeSeq);
  }

  function touchSession(sessionId: string, pageKey: string) {
    const order = sessionOrder.get(sessionId) ?? [];
    const next = [...order.filter((item) => item !== pageKey), pageKey];
    if (next.length > maxPagesPerSession) {
      const evicted = next.shift();
      if (evicted !== undefined) pages.delete(evicted);
    }
    sessionOrder.set(sessionId, next);
  }

  return {
    put(sessionId, beforeSeq, entries, hasMore) {
      const pageKey = key(sessionId, beforeSeq);
      pages.set(pageKey, { entries, hasMore });
      touchSession(sessionId, pageKey);
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
    removeSession(sessionId) {
      const order = sessionOrder.get(sessionId) ?? [];
      for (const pageKey of order) pages.delete(pageKey);
      sessionOrder.delete(sessionId);
      for (const pageKey of [...loading]) {
        if (pageKey.startsWith(`${sessionId}\u0000`)) loading.delete(pageKey);
      }
    },
    clear() {
      pages.clear();
      sessionOrder.clear();
      loading.clear();
    },
    stats() {
      return { sessions: sessionOrder.size, pages: pages.size };
    },
  };
}

/** 应用级历史分页缓存单例：App 分页加载写入，bridge-event-handler 清理。 */
export const historyPageCache = createHistoryPageCache({ maxPagesPerSession: 24 });

/** 语义化页大小的默认值（App 可用同值；独立模块便于测试与文档一致）。 */
export const HISTORY_PAGE_SIZE_DEFAULT = 40;