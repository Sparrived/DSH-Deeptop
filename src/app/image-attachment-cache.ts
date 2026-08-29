/**
 * Bounded in-memory cache for attachment data URLs used by the transcript.
 * Image payloads are large, so the cache is capped by both entry count and
 * approximate UTF-16 string size rather than retaining every viewed image.
 */
export const IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES = 24;
export const IMAGE_ATTACHMENT_CACHE_MAX_CHARS = 16_000_000;

type CacheEntry = {
  value: Promise<string>;
  chars: number;
};

export class ImageAttachmentCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalChars = 0;

  get size(): number {
    return this.entries.size;
  }

  get chars(): number {
    return this.totalChars;
  }

  get(key: string): Promise<string> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Promise<string>, chars = 0): void {
    const previous = this.entries.get(key);
    if (previous) this.totalChars -= previous.chars;
    this.entries.delete(key);
    const entry = { value, chars };
    this.entries.set(key, entry);
    this.totalChars += entry.chars;
    this.trim();
  }

  updateSize(key: string, value: Promise<string>, chars: number): void {
    const entry = this.entries.get(key);
    if (!entry || entry.value !== value) return;
    this.totalChars += chars - entry.chars;
    entry.chars = chars;
    this.trim();
  }

  delete(key: string, value?: Promise<string>): void {
    const entry = this.entries.get(key);
    if (!entry || (value && entry.value !== value)) return;
    this.entries.delete(key);
    this.totalChars -= entry.chars;
  }

  removeSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalChars = 0;
  }

  private trim(): void {
    while (this.entries.size > IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES || this.totalChars > IMAGE_ATTACHMENT_CACHE_MAX_CHARS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}
