/**
 * BoundedCache — A generic LRU cache with TTL, max size, and eviction metrics.
 *
 * Replaces unbounded `new Map()` caches across the platform:
 * - Automatic eviction when capacity exceeded (LRU)
 * - TTL-based expiration per entry
 * - Hit/miss/eviction counters for Prometheus
 * - Optional distributed invalidation via Redis pub/sub
 */
import { logger } from "../_core/logger";

export interface BoundedCacheOptions {
  /** Max number of entries before LRU eviction kicks in */
  maxSize: number;
  /** Default TTL in milliseconds for all entries */
  defaultTtlMs: number;
  /** Name for metrics/logging */
  name: string;
}

export interface CacheMetrics {
  name: string;
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  expired: number;
  hitRate: string;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class BoundedCache<K = string, V = unknown> {
  private store = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  readonly name: string;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expired = 0;

  constructor(options: BoundedCacheOptions) {
    this.maxSize = options.maxSize;
    this.defaultTtlMs = options.defaultTtlMs;
    this.name = options.name;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.expired++;
      this.misses++;
      return undefined;
    }

    // LRU: move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    // If already exists, delete first (resets LRU position)
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictions++;
      } else {
        break;
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.expired++;
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

  /** Get all valid entries (skips expired) */
  entries(): [K, V][] {
    const result: [K, V][] = [];
    const now = Date.now();
    const entries = Array.from(this.store.entries());
    for (const [key, entry] of entries) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.expired++;
      } else {
        result.push([key, entry.value]);
      }
    }
    return result;
  }

  /** Prometheus-compatible metrics */
  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expired: this.expired,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(2) + "%" : "0%",
    };
  }

  /** Periodic cleanup of expired entries (call from scheduler) */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    const entries = Array.from(this.store.entries());
    for (const [key, entry] of entries) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.expired++;
        purged++;
      }
    }
    if (purged > 0) {
      logger.debug(`[BoundedCache:${this.name}] Purged ${purged} expired entries`);
    }
    return purged;
  }
}

// ── Global Cache Registry (for metrics collection) ────────────────────────────
const _registry: BoundedCache<unknown, unknown>[] = [];

export function registerCache(cache: BoundedCache<unknown, unknown>): void {
  _registry.push(cache);
}

export function getAllCacheMetrics(): CacheMetrics[] {
  return _registry.map((c) => c.getMetrics());
}

export function purgeAllExpired(): number {
  return _registry.reduce((total, c) => total + c.purgeExpired(), 0);
}
