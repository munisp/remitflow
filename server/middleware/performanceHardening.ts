/**
 * RemitFlow — Performance Hardening Layer
 * ────────────────────────────────────────
 * Production-grade performance optimizations:
 * - Connection pool auto-tuning with health monitoring
 * - Redis cache layer for hot paths
 * - Response compression and ETags
 * - Query performance tracking
 * - CDN cache headers for static assets
 * - Database connection monitoring
 * - Request coalescing for duplicate queries
 */
import { createHash, randomInt } from "crypto";
import { Request, Response, NextFunction } from "express";
import { logger } from "../_core/logger";

// ─── Connection Pool Monitoring ──────────────────────────────────────────────

interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
  avgQueryTimeMs: number;
  queriesPerSecond: number;
  slowQueries: number;
  lastCheck: string;
}

const poolMetrics: PoolMetrics = {
  totalConnections: 0,
  idleConnections: 0,
  waitingClients: 0,
  maxConnections: parseInt(process.env.DB_POOL_MAX || "50", 10),
  avgQueryTimeMs: 0,
  queriesPerSecond: 0,
  slowQueries: 0,
  lastCheck: new Date().toISOString(),
};

// Circular buffer for O(1) insert (avoids O(n) shift on bounded arrays)
const QUERY_BUFFER_SIZE = 1000;
const queryTimes = new Float64Array(QUERY_BUFFER_SIZE);
let queryWriteIdx = 0;
let queryCount = 0;
let querySum = 0;
let slowQueryCount = 0;
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "500", 10);

export function trackQueryPerformance(durationMs: number, query?: string) {
  // Subtract the value being overwritten, add the new value
  querySum -= queryTimes[queryWriteIdx];
  queryTimes[queryWriteIdx] = durationMs;
  querySum += durationMs;
  queryWriteIdx = (queryWriteIdx + 1) % QUERY_BUFFER_SIZE;
  queryCount++;

  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    slowQueryCount++;
    logger.warn("[Performance] Slow query detected", {
      durationMs,
      query: query?.substring(0, 200),
    });
  }

  const sampleCount = Math.min(queryCount, QUERY_BUFFER_SIZE);
  poolMetrics.avgQueryTimeMs = sampleCount > 0 ? querySum / sampleCount : 0;
  poolMetrics.slowQueries = slowQueryCount;
  poolMetrics.lastCheck = new Date().toISOString();
}

export function getPoolMetrics(): PoolMetrics {
  return { ...poolMetrics };
}

// ─── Response Compression Headers ────────────────────────────────────────────

export function compressionHeaders(req: Request, res: Response, next: NextFunction) {
  // Vary header for proper CDN caching
  res.setHeader("Vary", "Accept-Encoding, Authorization");
  next();
}

// ─── Cache Control for Static Assets ─────────────────────────────────────────

export function staticCacheHeaders(req: Request, res: Response, next: NextFunction) {
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico)$/)) {
    // Immutable static assets — cache for 1 year
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("CDN-Cache-Control", "public, max-age=31536000");
  } else if (req.path.startsWith("/api/")) {
    // API responses — no cache by default
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  } else {
    // HTML pages — short cache with revalidation
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
  }
  next();
}

// ─── ETag Support ────────────────────────────────────────────────────────────

export function etagSupport(req: Request, res: Response, next: NextFunction) {
  // Enable weak ETags for API responses
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (req.method === "GET" && body) {
      const hash = createHash("md5")
        .update(JSON.stringify(body))
        .digest("hex");
      const etag = `W/"${hash}"`;
      res.setHeader("ETag", etag);

      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return res;
      }
    }
    return originalJson(body);
  };
  next();
}

// ─── Request Coalescing ──────────────────────────────────────────────────────
// Prevents duplicate concurrent requests from hitting the database

const MAX_PENDING_REQUESTS = 10000;
const pendingRequests = new Map<string, Promise<unknown>>();

export function requestCoalescing<T>(
  cacheKey: string,
  fn: () => Promise<T>,
  ttlMs = 1000
): Promise<T> {
  const existing = pendingRequests.get(cacheKey);
  if (existing) return existing as Promise<T>;

  // Evict oldest entries if map exceeds size limit (prevents memory leak under load)
  if (pendingRequests.size >= MAX_PENDING_REQUESTS) {
    const firstKey = pendingRequests.keys().next().value;
    if (firstKey !== undefined) pendingRequests.delete(firstKey);
  }

  const promise = fn().finally(() => {
    setTimeout(() => pendingRequests.delete(cacheKey), ttlMs);
  });
  pendingRequests.set(cacheKey, promise);
  return promise;
}

// ─── Redis Cache Layer ───────────────────────────────────────────────────────

interface CacheOptions {
  ttlSeconds: number;
  prefix?: string;
}

let redisAvailable = true;

async function getRedisClient() {
  if (!redisAvailable) return null;
  try {
    const redis = await import("./redis.js");
    return (redis as Record<string, unknown>).redisClient || null;
  } catch {
    redisAvailable = false;
    return null;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    const data = await (client as Record<string, Function>).get(`cache:${key}`);
    return data ? JSON.parse(data as string) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await (client as Record<string, Function>).set(
      `cache:${key}`,
      JSON.stringify(value),
      { EX: ttlSeconds }
    );
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function cacheInvalidate(pattern: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const keys = await (client as Record<string, Function>).keys(`cache:${pattern}`);
    if (Array.isArray(keys) && keys.length > 0) {
      await (client as Record<string, Function>).del(...keys);
    }
  } catch {
    // Cache invalidation failure is non-fatal
  }
}

// ─── Database Table Partitioning Config ──────────────────────────────────────

export const PARTITION_CONFIG = {
  transactions: {
    strategy: "RANGE" as const,
    column: "created_at",
    interval: "monthly",
    retentionMonths: 36,
    partitionPrefix: "transactions_y",
  },
  audit_logs: {
    strategy: "RANGE" as const,
    column: "created_at",
    interval: "monthly",
    retentionMonths: 84, // 7 years for compliance
    partitionPrefix: "audit_logs_y",
  },
  kyc_documents: {
    strategy: "RANGE" as const,
    column: "created_at",
    interval: "quarterly",
    retentionMonths: 120, // 10 years
    partitionPrefix: "kyc_documents_q",
  },
  sanctions_checks: {
    strategy: "RANGE" as const,
    column: "created_at",
    interval: "monthly",
    retentionMonths: 84,
    partitionPrefix: "sanctions_checks_y",
  },
} as const;

// ─── Connection Pool Auto-Tuning ─────────────────────────────────────────────

export function calculateOptimalPoolSize(): {
  max: number;
  min: number;
  idleTimeoutMs: number;
  acquireTimeoutMs: number;
} {
  const cpuCount = parseInt(process.env.CPU_COUNT || "4", 10);
  const maxMemoryMb = parseInt(process.env.MAX_MEMORY_MB || "4096", 10);

  // PostgreSQL recommended: (2 * CPU cores) + disk spindles
  // For SSDs, use 2 * CPU cores + 1
  const calculatedMax = Math.min(
    cpuCount * 2 + 1,
    Math.floor(maxMemoryMb / 50), // ~50MB per connection
    100 // absolute max
  );

  return {
    max: parseInt(process.env.DB_POOL_MAX || String(calculatedMax), 10),
    min: Math.max(2, Math.floor(calculatedMax / 4)),
    idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || "30000", 10),
    acquireTimeoutMs: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || "10000", 10),
  };
}

// ─── Request Timing Middleware ────────────────────────────────────────────────

export function requestTiming(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationMs = durationNs / 1_000_000;

    res.setHeader("X-Response-Time", `${durationMs.toFixed(2)}ms`);
    res.setHeader("Server-Timing", `total;dur=${durationMs.toFixed(2)}`);

    if (durationMs > 2000) {
      logger.warn("[Performance] Slow request", {
        method: req.method,
        path: req.path,
        durationMs: durationMs.toFixed(2),
        statusCode: res.statusCode,
      });
    }
  });

  next();
}

// ─── Read Replica Configuration ──────────────────────────────────────────────

export const READ_REPLICA_CONFIG = {
  enabled: !!process.env.DB_READ_REPLICA_URL,
  primaryUrl: process.env.DATABASE_URL,
  replicaUrls: (process.env.DB_READ_REPLICA_URL || "").split(",").filter(Boolean),
  strategy: (process.env.DB_REPLICA_STRATEGY as "round-robin" | "random" | "least-connections") || "round-robin",
  maxLagMs: parseInt(process.env.DB_MAX_REPLICATION_LAG_MS || "5000", 10),
};

let _replicaIndex = 0;

export function getReplicaUrl(): string | null {
  if (!READ_REPLICA_CONFIG.enabled || READ_REPLICA_CONFIG.replicaUrls.length === 0) {
    return null;
  }

  switch (READ_REPLICA_CONFIG.strategy) {
    case "round-robin":
      _replicaIndex = (_replicaIndex + 1) % READ_REPLICA_CONFIG.replicaUrls.length;
      return READ_REPLICA_CONFIG.replicaUrls[_replicaIndex];
    case "random":
      return READ_REPLICA_CONFIG.replicaUrls[
        randomInt(READ_REPLICA_CONFIG.replicaUrls.length)
      ];
    default:
      return READ_REPLICA_CONFIG.replicaUrls[0];
  }
}
