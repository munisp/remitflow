/**
 * boundedCache.ts — A memory-bounded LRU cache with optional TTL support.
 * Prevents unbounded memory growth by evicting the least-recently-used entry
 * when the cache exceeds its configured maximum size.
 */

interface BoundedCacheOptions {
  maxSize: number;
  defaultTtlMs?: number;
  name?: string;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
  lastAccessed: number;
}

/**
 * A bounded LRU cache with optional per-entry TTL.
 */
export class BoundedCache<K, V> {
  private readonly maxSize: number;
  private readonly defaultTtlMs: number | null;
  readonly name: string;
  private readonly store = new Map<K, CacheEntry<V>>();

  constructor(options: BoundedCacheOptions) {
    this.maxSize = options.maxSize;
    this.defaultTtlMs = options.defaultTtlMs ?? null;
    this.name = options.name ?? "bounded-cache";
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Check TTL expiry
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Update last accessed for LRU tracking
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    // Evict LRU entry if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evictLru();
    }

    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: effectiveTtl !== null ? Date.now() + effectiveTtl : null,
      lastAccessed: Date.now(),
    });
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private evictLru(): void {
    let lruKey: K | undefined;
    let lruTime = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey !== undefined) {
      this.store.delete(lruKey);
    }
  }

  /** Purge all expired entries. */
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }
}

// ── Global Cache Registry ─────────────────────────────────────────────────────

const cacheRegistry: BoundedCache<unknown, unknown>[] = [];

/**
 * Register a cache instance for global management (e.g., purge all expired entries).
 */
export function registerCache(cache: BoundedCache<unknown, unknown>): void {
  cacheRegistry.push(cache);
}

/**
 * Purge expired entries from all registered caches.
 * Returns the total number of entries purged.
 */
export function purgeAllExpiredCaches(): number {
  return cacheRegistry.reduce((total, cache) => total + cache.purgeExpired(), 0);
}

/**
 * Get stats for all registered caches.
 */
export function getCacheStats(): Array<{ name: string; size: number }> {
  return cacheRegistry.map((c) => ({ name: c.name, size: c.size }));
}
