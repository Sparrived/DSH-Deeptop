export const DEFAULT_CLAIM_SET_MAX_SIZE = 256;

/**
 * Tracks recently claimed request ids so concurrent desktop surfaces cannot
 * answer the same RPC twice. Old successful ids are evicted at a fixed bound;
 * failed requests can be released immediately for retry.
 */
export class BoundedClaimSet {
  private readonly claims = new Set<string>();
  private readonly maxSize: number;

  constructor(maxSize = DEFAULT_CLAIM_SET_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.claims.size;
  }

  claim(id: string): boolean {
    if (!id || this.claims.has(id)) return false;
    this.claims.add(id);
    while (this.claims.size > Math.max(1, this.maxSize)) {
      const oldest = this.claims.values().next().value;
      if (oldest === undefined) break;
      this.claims.delete(oldest);
    }
    return true;
  }

  release(id: string): void {
    this.claims.delete(id);
  }

  has(id: string): boolean {
    return this.claims.has(id);
  }
}
