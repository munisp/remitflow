/**
 * Prometheus Cache Metrics Endpoint
 *
 * Exposes hit/miss/eviction/expired counters for all BoundedCache instances.
 * Integrates with the existing Prometheus /metrics endpoint.
 *
 * Metrics exported:
 *   remitflow_cache_hits_total{cache="..."}
 *   remitflow_cache_misses_total{cache="..."}
 *   remitflow_cache_evictions_total{cache="..."}
 *   remitflow_cache_expired_total{cache="..."}
 *   remitflow_cache_size{cache="..."}
 *   remitflow_cache_max_size{cache="..."}
 *   remitflow_cache_hit_rate{cache="..."}
 */
import { getAllCacheMetrics, purgeAllExpired, CacheMetrics } from "./boundedCache";
import { walletCache } from "../services/walletCache";

/**
 * Generate Prometheus-formatted text for all cache metrics.
 */
export function generateCachePrometheusMetrics(): string {
  const lines: string[] = [];

  // BoundedCache instances
  const caches = getAllCacheMetrics();

  // Also include walletCache (its own LRU implementation)
  const walletStats = walletCache.getStats();
  caches.push({
    name: "wallet-lru",
    size: walletStats.size,
    maxSize: walletStats.maxEntries,
    hits: walletStats.hits,
    misses: walletStats.misses,
    evictions: walletStats.evictions,
    expired: 0,
    hitRate: walletStats.hitRate,
  });

  // HELP + TYPE headers
  lines.push("# HELP remitflow_cache_hits_total Total cache hits");
  lines.push("# TYPE remitflow_cache_hits_total counter");
  for (const c of caches) {
    lines.push(`remitflow_cache_hits_total{cache="${c.name}"} ${c.hits}`);
  }

  lines.push("# HELP remitflow_cache_misses_total Total cache misses");
  lines.push("# TYPE remitflow_cache_misses_total counter");
  for (const c of caches) {
    lines.push(`remitflow_cache_misses_total{cache="${c.name}"} ${c.misses}`);
  }

  lines.push("# HELP remitflow_cache_evictions_total Total LRU evictions");
  lines.push("# TYPE remitflow_cache_evictions_total counter");
  for (const c of caches) {
    lines.push(`remitflow_cache_evictions_total{cache="${c.name}"} ${c.evictions}`);
  }

  lines.push("# HELP remitflow_cache_expired_total Total TTL expirations");
  lines.push("# TYPE remitflow_cache_expired_total counter");
  for (const c of caches) {
    lines.push(`remitflow_cache_expired_total{cache="${c.name}"} ${c.expired}`);
  }

  lines.push("# HELP remitflow_cache_size Current cache size");
  lines.push("# TYPE remitflow_cache_size gauge");
  for (const c of caches) {
    lines.push(`remitflow_cache_size{cache="${c.name}"} ${c.size}`);
  }

  lines.push("# HELP remitflow_cache_max_size Max cache capacity");
  lines.push("# TYPE remitflow_cache_max_size gauge");
  for (const c of caches) {
    lines.push(`remitflow_cache_max_size{cache="${c.name}"} ${c.maxSize}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Get cache metrics as JSON (for internal dashboard / tRPC endpoint).
 */
export function getCacheMetricsJson(): CacheMetrics[] {
  const caches = getAllCacheMetrics();

  const walletStats = walletCache.getStats();
  caches.push({
    name: "wallet-lru",
    size: walletStats.size,
    maxSize: walletStats.maxEntries,
    hits: walletStats.hits,
    misses: walletStats.misses,
    evictions: walletStats.evictions,
    expired: 0,
    hitRate: walletStats.hitRate,
  });

  return caches;
}

/**
 * Periodic expired entry cleanup — call from scheduler every 5 minutes.
 */
export function runCacheGC(): { purged: number; caches: number } {
  const purged = purgeAllExpired();
  return { purged, caches: getAllCacheMetrics().length };
}
