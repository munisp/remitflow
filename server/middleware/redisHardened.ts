/**
 * RemitFlow — Redis Production-Grade (single consolidated implementation)
 *
 * THE single Redis client for the platform. redis.ts re-exports a
 * signature-compatible cache facade over this module; fund-flow middleware
 * uses it directly. (redisCluster.ts was deleted in the consolidation.)
 *
 * Connection modes (REDIS_MODE): standalone | sentinel | cluster
 *
 * Failure semantics (uniform across the platform):
 *   - FINANCIAL / INTEGRITY OPS (distributed locks, idempotency, session
 *     invalidation, transfer dedup): FAIL-CLOSED. In production an
 *     unavailable Redis throws; the operation is rejected rather than
 *     proceeding without its integrity guarantee.
 *   - CACHE READS (fx rate cache, profile cache, analytics): best-effort.
 *     A cache miss is returned (null/false) and the caller falls back to the
 *     primary store. This is a deliberate, documented trade-off — cache
 *     unavailability must not take down reads.
 *   - DEV FAIL-OPEN: outside production, lock/rate-limit degradation throws
 *     an explicit degraded-mode error unless ALLOW_REDIS_FAILOPEN=true is
 *     set for local development convenience.
 */

import { Redis, Cluster } from "ioredis";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ALLOW_FAILOPEN = process.env.ALLOW_REDIS_FAILOPEN === "true";
const REDIS_MODE = process.env.REDIS_MODE ?? "standalone"; // standalone | sentinel | cluster
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_SENTINEL_HOSTS = process.env.REDIS_SENTINEL_HOSTS ?? "localhost:26379";
const REDIS_SENTINEL_NAME = process.env.REDIS_SENTINEL_NAME ?? process.env.REDIS_SENTINEL_MASTER ?? "remitflow-master";
const REDIS_SENTINEL_PASSWORD = process.env.REDIS_SENTINEL_PASSWORD || undefined;
const REDIS_CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES ?? "localhost:7000,localhost:7001,localhost:7002";

// Critical operations that MUST have Redis (fail-closed)
const CRITICAL_OPS = new Set([
  "distributed-lock",
  "rate-limit",
  "session-store",
  "idempotency-check",
  "transfer-dedup",
]);

let _redis: Redis | Cluster | null = null;
let _connectionFailed = false;
let _lastError: string | null = null;
let _lastRetryAt = 0;
const RETRY_INTERVAL_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ─── Connection Factory ───────────────────────────────────────────────────────

function createClient(): Redis | Cluster | null {
  try {
    let client: Redis | Cluster;
    switch (REDIS_MODE) {
      case "sentinel": {
        const sentinels = REDIS_SENTINEL_HOSTS.split(",").map(h => {
          const [host, port] = h.trim().split(":");
          return { host, port: parseInt(port || "26379", 10) };
        });
        client = new Redis({
          sentinels,
          name: REDIS_SENTINEL_NAME,
          password: REDIS_PASSWORD,
          sentinelPassword: REDIS_SENTINEL_PASSWORD,
          lazyConnect: false,
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => times > MAX_RECONNECT_ATTEMPTS ? null : Math.min(times * 200, 5000),
          sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
        });
        logger.info({ masterName: REDIS_SENTINEL_NAME, sentinels: sentinels.length }, "[Redis:Sentinel] Connecting via Sentinel");
        break;
      }

      case "cluster": {
        const nodes = REDIS_CLUSTER_NODES.split(",").map(h => {
          const [host, port] = h.trim().split(":");
          return { host, port: parseInt(port || "7000", 10) };
        });
        client = new Cluster(nodes, {
          redisOptions: {
            password: REDIS_PASSWORD,
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
          },
          clusterRetryStrategy: (times) => times > MAX_RECONNECT_ATTEMPTS ? null : Math.min(times * 200, 5000),
          enableOfflineQueue: true,
          scaleReads: "slave",
        });
        logger.info({ nodes: nodes.length }, "[Redis:Cluster] Connecting to Redis Cluster");
        break;
      }

      default: {
        client = new Redis(REDIS_URL, {
          ...(REDIS_PASSWORD && !REDIS_URL.includes("@") ? { password: REDIS_PASSWORD } : {}),
          lazyConnect: false,
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => times > MAX_RECONNECT_ATTEMPTS ? null : Math.min(times * 200, 5000),
        });
        logger.info("[Redis:Standalone] Connecting to Redis");
      }
    }

    client.on("error", (err: Error) => {
      _lastError = err.message;
      if (!_connectionFailed) {
        _connectionFailed = true;
        logger.warn({ errMsg: err.message, mode: REDIS_MODE }, "[Redis] Connection error — degraded");
      }
    });
    client.on("ready", () => {
      _connectionFailed = false;
      _lastError = null;
      logger.info({ mode: REDIS_MODE }, "[Redis] Connection ready");
    });
    client.on("close", () => { _connectionFailed = true; });

    _redis = client;
    return client;
  } catch (err) {
    _connectionFailed = true;
    _lastError = (err as Error).message;
    logger.error({ errMsg: _lastError }, "[Redis] Client init failed:");
    return null;
  }
}

/**
 * Synchronous accessor for modules that need an ioredis handle at call time
 * (cache facade, fund-flow locks). Returns null if the client cannot be
 * created; the actual connection is established asynchronously by ioredis.
 */
export function getRedisClientSync(): Redis | Cluster | null {
  if (_redis) return _redis;
  if (_connectionFailed && Date.now() - _lastRetryAt < RETRY_INTERVAL_MS) return null;
  _lastRetryAt = Date.now();
  return createClient();
}

async function getRedisClient(): Promise<Redis | Cluster | null> {
  return getRedisClientSync();
}

/** redisCluster.ts compatibility: a connection that throws when unavailable. */
export async function getRedisConnection(): Promise<Redis | Cluster> {
  const client = getRedisClientSync();
  if (!client) {
    throw new Error(`[Redis] Connection unavailable (mode=${REDIS_MODE}, lastError=${_lastError ?? "none"})`);
  }
  return client;
}

/** Whether a Redis client currently exists and has not entered a failed state. */
export function isRedisAvailable(): boolean {
  return _redis !== null && !_connectionFailed && (_redis as Redis).status === "ready";
}

/**
 * Whether fund-flow operations fail-hard when Redis is unavailable.
 * Always true in production; opt-in via FUND_FLOW_REDIS_STRICT in development.
 */
export function isFundFlowStrictMode(): boolean {
  if (IS_PRODUCTION) return true;
  return process.env.FUND_FLOW_REDIS_STRICT === "true";
}

/**
 * Degraded-mode guard: throw unless explicitly opted out via
 * ALLOW_REDIS_FAILOPEN=true. Used where a silent "success" would mask a
 * broken integrity guarantee (locks, rate limits).
 */
function assertDegradedAllowed(operation: string): void {
  if (IS_PRODUCTION || !ALLOW_FAILOPEN) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        `[Redis] DEGRADED-MODE ERROR: Cannot perform ${operation} — Redis unavailable ` +
        `(mode=${REDIS_MODE}). Refusing to fabricate success. ` +
        (IS_PRODUCTION
          ? "Fail-closed in production."
          : "Set ALLOW_REDIS_FAILOPEN=true to bypass in local development only."),
    });
  }
  logger.warn(`[Redis] ALLOW_REDIS_FAILOPEN=true — ${operation} proceeding without Redis (dev only, NOT safe for production)`);
}

// ─── Fail-Closed Operations ───────────────────────────────────────────────────

export async function redisGet(key: string, operation?: string): Promise<string | null> {
  const client = await getRedisClient();
  if (!client) {
    if (IS_PRODUCTION && operation && CRITICAL_OPS.has(operation)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Redis] FAIL-CLOSED: Cannot perform ${operation} — Redis unavailable`,
      });
    }
    return null;
  }
  return client.get(key);
}

export async function redisSet(
  key: string,
  value: string,
  ttlSeconds?: number,
  operation?: string,
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    if (IS_PRODUCTION && operation && CRITICAL_OPS.has(operation)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Redis] FAIL-CLOSED: Cannot perform ${operation} — Redis unavailable`,
      });
    }
    return false;
  }
  if (ttlSeconds) {
    await client.setex(key, ttlSeconds, value);
  } else {
    await client.set(key, value);
  }
  return true;
}

// ─── Distributed Lock (Redlock-compatible) ────────────────────────────────────

export async function acquireLock(
  resource: string,
  ttlMs: number = 30000,
): Promise<{ acquired: boolean; token: string }> {
  const client = await getRedisClient();
  const token = `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  if (!client) {
    // Never silently report "acquired" without Redis — that is a fabricated
    // mutual-exclusion guarantee. Production: fail-closed. Dev: explicit
    // degraded-mode error unless ALLOW_REDIS_FAILOPEN=true.
    assertDegradedAllowed(`acquire distributed lock for ${resource}`);
    return { acquired: true, token }; // ALLOW_REDIS_FAILOPEN=true (dev only)
  }

  const result = await client.set(
    `lock:${resource}`,
    token,
    "PX", ttlMs,
    "NX"
  );
  return { acquired: result === "OK", token };
}

export async function releaseLock(resource: string, token: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return true; // best-effort: the lock expires via TTL regardless

  // Lua script for atomic check-and-delete (requires +EVAL on the app ACL user)
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  const result = await (client as Redis).eval(script, 1, `lock:${resource}`, token);
  return result === 1;
}

// ─── Rate Limiting (Sliding Window) ───────────────────────────────────────────

export async function checkRateLimit(
  key: string,
  maxTokens: number,
  refillRate: number,
  windowMs: number = 60000,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = await getRedisClient();
  if (!client) {
    assertDegradedAllowed("check rate limit");
    return { allowed: true, remaining: maxTokens, resetAt: Date.now() + windowMs }; // ALLOW_REDIS_FAILOPEN=true (dev only)
  }

  const now = Date.now();
  const rlKey = `ratelimit:${key}`;

  // Sliding window with Lua for atomicity (requires +EVAL on the app ACL user)
  const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local max_tokens = tonumber(ARGV[3])

    redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
    local count = redis.call("ZCARD", key)

    if count < max_tokens then
      redis.call("ZADD", key, now, now .. ":" .. math.random(1000000))
      redis.call("PEXPIRE", key, window)
      return {1, max_tokens - count - 1}
    else
      return {0, 0}
    end
  `;

  const result = await (client as Redis).eval(script, 1, rlKey, now, windowMs, maxTokens) as number[];
  return {
    allowed: result[0] === 1,
    remaining: result[1] || 0,
    resetAt: now + windowMs,
  };
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function getRedisHealth(): Promise<{
  connected: boolean;
  mode: string;
  failClosed: boolean;
  latencyMs: number;
  lastError: string | null;
  sentinelHosts?: string[];
  masterName?: string;
}> {
  const base = {
    mode: REDIS_MODE,
    failClosed: IS_PRODUCTION,
    lastError: _lastError,
    ...(REDIS_MODE === "sentinel"
      ? { sentinelHosts: REDIS_SENTINEL_HOSTS.split(","), masterName: REDIS_SENTINEL_NAME }
      : {}),
  };
  const client = await getRedisClient();
  if (!client) {
    return { ...base, connected: false, latencyMs: -1 };
  }

  const start = Date.now();
  try {
    await client.ping();
    _connectionFailed = false;
    return { ...base, connected: true, latencyMs: Date.now() - start, lastError: null };
  } catch (err) {
    _connectionFailed = true;
    _lastError = (err as Error).message;
    return { ...base, connected: false, latencyMs: -1 };
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
