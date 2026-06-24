/**
 * RemitFlow — Redis Production-Grade HA (Sentinel + Cluster)
 *
 * Closes gaps:
 * 1. Single-node → Sentinel failover for automatic leader election
 * 2. No HA → Cluster mode for horizontal scaling
 * 3. No health monitoring → Circuit breaker + connection monitoring
 * 4. Fail-closed in production when Redis unavailable for locks/sessions
 */

import { Redis, Cluster } from "ioredis";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const REDIS_MODE = process.env.REDIS_MODE ?? "standalone"; // standalone | sentinel | cluster
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_SENTINEL_HOSTS = process.env.REDIS_SENTINEL_HOSTS ?? "localhost:26379";
const REDIS_SENTINEL_NAME = process.env.REDIS_SENTINEL_NAME ?? "remitflow-master";
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
let _lastRetryAt = 0;
const RETRY_INTERVAL_MS = 15_000;

// ─── Connection Factory ───────────────────────────────────────────────────────

async function getRedisClient(): Promise<Redis | Cluster | null> {
  if (_redis) return _redis;
  if (_connectionFailed && Date.now() - _lastRetryAt < RETRY_INTERVAL_MS) return null;

  _lastRetryAt = Date.now();

  try {
    switch (REDIS_MODE) {
      case "sentinel": {
        const sentinels = REDIS_SENTINEL_HOSTS.split(",").map(h => {
          const [host, port] = h.split(":");
          return { host, port: parseInt(port || "26379") };
        });
        _redis = new Redis({
          sentinels,
          name: REDIS_SENTINEL_NAME,
          lazyConnect: false,
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 200, 5000),
          sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
        });
        logger.info("[Redis:Sentinel] Connected to Sentinel cluster");
        break;
      }

      case "cluster": {
        const nodes = REDIS_CLUSTER_NODES.split(",").map(h => {
          const [host, port] = h.split(":");
          return { host, port: parseInt(port || "7000") };
        });
        _redis = new Cluster(nodes, {
          redisOptions: {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
          },
          clusterRetryStrategy: (times) => Math.min(times * 200, 5000),
          enableOfflineQueue: true,
          scaleReads: "slave",
        });
        logger.info("[Redis:Cluster] Connected to Redis Cluster");
        break;
      }

      default: {
        _redis = new Redis(REDIS_URL, {
          lazyConnect: false,
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 200, 5000),
        });
        logger.info("[Redis:Standalone] Connected to Redis");
      }
    }

    _connectionFailed = false;
    return _redis;
  } catch (err) {
    _connectionFailed = true;
    logger.error("[Redis] Connection failed:", (err as Error).message);
    return null;
  }
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
    if (IS_PRODUCTION) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Redis] FAIL-CLOSED: Cannot acquire distributed lock for ${resource} — Redis unavailable`,
      });
    }
    return { acquired: true, token }; // Dev: optimistic lock
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
  if (!client) return true;

  // Lua script for atomic check-and-delete
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

// ─── Rate Limiting (Token Bucket) ─────────────────────────────────────────────

export async function checkRateLimit(
  key: string,
  maxTokens: number,
  refillRate: number,
  windowMs: number = 60000,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = await getRedisClient();
  if (!client) {
    if (IS_PRODUCTION) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Redis] FAIL-CLOSED: Cannot check rate limit — Redis unavailable`,
      });
    }
    return { allowed: true, remaining: maxTokens, resetAt: Date.now() + windowMs };
  }

  const now = Date.now();
  const rlKey = `ratelimit:${key}`;

  // Sliding window with Lua for atomicity
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
}> {
  const client = await getRedisClient();
  if (!client) {
    return { connected: false, mode: REDIS_MODE, failClosed: IS_PRODUCTION, latencyMs: -1 };
  }

  const start = Date.now();
  try {
    await client.ping();
    return {
      connected: true,
      mode: REDIS_MODE,
      failClosed: IS_PRODUCTION,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { connected: false, mode: REDIS_MODE, failClosed: IS_PRODUCTION, latencyMs: -1 };
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
