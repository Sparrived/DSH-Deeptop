/**
 * 通用 Session Projection 缓存。
 *
 * 保存每个会话最近一次收到的各 key Projection 值，按会话完全隔离；
 * 主要用于会话切换时把“切换前已到达、但历史恢复还没折叠”的实时投影
 * 补齐到新打开的会话视图，同时保证其它会话的事件永远不会污染当前 UI。
 * 纯模块，不依赖 React/Tauri，可在 Node 中直接测试。
 */

export interface ProjectionCacheEntry {
  key: string;
  value: unknown;
  /** 产生该投影的会话事件 seq；未知时为 0。 */
  seq: number;
  /** 收到时间（毫秒）；用于同 seq 时的写入顺序。 */
  receivedAt: number;
}

export const PROJECTION_CACHE_MAX_SESSIONS = 32;

export class SessionProjectionCache {
  private readonly sessions = new Map<string, Map<string, ProjectionCacheEntry>>();
  /** 最近写入顺序（用于 LRU 淘汰）。 */
  private readonly recency: string[] = [];
  private evictions = 0;

  get size(): number {
    return this.sessions.size;
  }

  get evictedSessions(): number {
    return this.evictions;
  }

  put(sessionId: string, key: string, value: unknown, seq = 0, receivedAt = Date.now()): void {
    if (!sessionId || !key) return;
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      this.touch(sessionId);
      this.sessions.set(sessionId, new Map());
    }
    const map = this.sessions.get(sessionId)!;
    const before = map.get(key);
    if (before && before.seq > seq) return; // 只有更新的 seq 才能覆盖（同 seq 时后写入者胜）。
    map.set(key, { key, value, seq, receivedAt });
  }

  get(sessionId: string, key: string): ProjectionCacheEntry | undefined {
    return this.sessions.get(sessionId)?.get(key);
  }

  /** 返回某会话的投影条目列表（按 key 名排序，便于确定性测试/合并）。 */
  snapshot(sessionId: string): ProjectionCacheEntry[] {
    const map = this.sessions.get(sessionId);
    if (!map) return [];
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** 返回比 `asOfSeq` 更新的投影条目；`asOfSeq` 缺省时返回全部。 */
  newerThan(sessionId: string, asOfSeq: number | undefined): ProjectionCacheEntry[] {
    return this.snapshot(sessionId).filter((entry) => asOfSeq === undefined || entry.seq > asOfSeq);
  }

  removeSession(sessionId: string): void {
    const removed = this.sessions.delete(sessionId);
    if (!removed) return;
    const index = this.recency.indexOf(sessionId);
    if (index >= 0) this.recency.splice(index, 1);
  }

  clear(): void {
    this.sessions.clear();
    this.recency.length = 0;
  }

  private touch(sessionId: string): void {
    const index = this.recency.indexOf(sessionId);
    if (index >= 0) this.recency.splice(index, 1);
    this.recency.push(sessionId);
    while (this.recency.length > PROJECTION_CACHE_MAX_SESSIONS) {
      const oldest = this.recency.shift();
      if (oldest !== undefined && this.sessions.delete(oldest)) this.evictions += 1;
    }
  }
}

/**
 * 把缓存投影叠加到历史恢复的投影值之上：缓存 seq 高于历史折叠水位
 * （asOfSeq）的条目才是实时补齐项。历史没有投影水位时，已知 seq 的缓存
 * 条目直接补齐；未知 seq 的条目只在历史缺少该 key 时填充，避免覆盖权威值。
 * 返回叠加后的 values 与被覆盖的 key。
 */
export function overlayProjections(
  historyValues: Record<string, unknown> | undefined,
  asOfSeq: number | undefined,
  cacheEntries: ProjectionCacheEntry[],
): { values: Record<string, unknown>; overlaid: string[] } {
  const values: Record<string, unknown> = historyValues ? { ...historyValues } : {};
  const overlaid: string[] = [];
  for (const entry of cacheEntries) {
    const hasHistoryValue = historyValues !== undefined && Object.prototype.hasOwnProperty.call(historyValues, entry.key);
    if (asOfSeq !== undefined) {
      if (entry.seq <= asOfSeq) continue;
      values[entry.key] = entry.value;
      overlaid.push(entry.key);
      continue;
    }
    if (entry.seq > 0 || !hasHistoryValue) {
      values[entry.key] = entry.value;
      overlaid.push(entry.key);
    }
  }
  return { values, overlaid };
}

/** 应用级投影缓存单例：bridge-event-handler 写入，App 打开会话时叠加读取。 */
export const sessionProjectionCache = new SessionProjectionCache();
