/** Minimal shape so the cache can be unit-tested without a browser. */
export interface Closable {
  width: number;
  height: number;
  close(): void;
}

interface Entry<T extends Closable> {
  value: T;
  bytes: number;
  used: number;
}

export interface CacheStats {
  bytes: number;
  external: number;
  total: number;
  budget: number;
  entries: number;
  evictions: number;
  peakTotal: number;
}

/**
 * LRU of decoded bitmaps under a byte budget (DESIGN 7.2). Evicting always calls close().
 * Pinned keys (visible pages) are never evicted. `external` counts bytes held outside the cache
 * (e.g. live display canvases) so the budget covers the true footprint.
 */
export class PageCache<T extends Closable = ImageBitmap> {
  private map = new Map<string, Entry<T>>();
  private pinned = new Set<string>();
  private tick = 0;
  private bytes = 0;
  private external = 0;
  private evictions = 0;
  private peak = 0;

  constructor(private budget: number) {}

  setBudget(b: number): void {
    this.budget = b;
    this.evict();
  }

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (e) e.used = ++this.tick;
    return e?.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: T): void {
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.bytes;
      if (old.value !== value) old.value.close();
    }
    const bytes = value.width * value.height * 4;
    this.map.set(key, { value, bytes, used: ++this.tick });
    this.bytes += bytes;
    this.evict();
    this.peak = Math.max(this.peak, this.bytes + this.external);
  }

  /** Keys that must survive eviction. */
  pin(keys: Iterable<string>): void {
    this.pinned = new Set(keys);
  }

  setExternal(bytes: number): void {
    this.external = bytes;
    this.evict();
    this.peak = Math.max(this.peak, this.bytes + this.external);
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.bytes -= e.bytes;
    e.value.close();
  }

  /** Drop everything that is not pinned (visibilitychange -> hidden). */
  dropUnpinned(): void {
    for (const k of [...this.map.keys()]) if (!this.pinned.has(k)) this.delete(k);
  }

  clear(): void {
    this.pinned.clear();
    for (const k of [...this.map.keys()]) this.delete(k);
  }

  private evict(): void {
    if (this.bytes + this.external <= this.budget) return;
    const candidates = [...this.map.entries()]
      .filter(([k]) => !this.pinned.has(k))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [k] of candidates) {
      if (this.bytes + this.external <= this.budget) break;
      this.delete(k);
      this.evictions++;
    }
  }

  stats(): CacheStats {
    return {
      bytes: this.bytes,
      external: this.external,
      total: this.bytes + this.external,
      budget: this.budget,
      entries: this.map.size,
      evictions: this.evictions,
      peakTotal: this.peak,
    };
  }
}
