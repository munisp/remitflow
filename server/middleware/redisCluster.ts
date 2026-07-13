/**
 * redisCluster.ts — Redis Sentinel/Cluster Connection Manager
 *
 * Provides a singleton Redis connection that:
 *   1. Connects to Redis Sentinel in production (HA with automatic failover)
 *   2. Falls back to standalone Redis for development
 *   3. Exposes health checks for circuit breaking
 *   4. NEVER falls back to in-memory for fund operations (fail-hard)
 *
 * Environment Variables:
 *   REDIS_SENTINEL_HOSTS  — comma-separated sentinel host:port list (e.g. "sentinel1:26379,sentinel2:26379")
 *   REDIS_SENTINEL_MASTER — master group name (default: "remitflow-master")
 *   REDIS_SENTINEL_PASSWORD — sentinel auth password (optional)
 *   REDIS_PASSWORD — Redis instance password (optional)
 *   REDIS_URL — standalone Redis URL (fallback when sentinels not configured)
 *   REDIS_CLUSTER_NODES — comma-separated cluster nodes for Redis Cluster mode
 *   FUND_FLOW_REDIS_STRICT — "true" to reject fund ops if Redis unavailable (default: "true" in production)
 */

import { logger } from "../_core/logger.js";

let redisInstance: RedisClient | null = null;
let connectionAttempts = 0;
let lastConnectionError: string | null = null;
let isConnected = false;

interface RedisClient {
  set(key: string, value: string, mode: string, duration: number, flag?: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit(): Promise<string>;
  ping(): Promise<string>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  status?: string;
}

export interface RedisHealthStatus {
  connected: boolean;
  mode: "sentinel" | "cluster" | "standalone" | "disconnected";
  sentinelHosts?: string[];
  masterName?: string;
  connectionAttempts: number;
  lastError: string | null;
  latencyMs?: number;
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEALTH_CHECK_TIMEOUT_MS = 2000;

/**
 * Get or create the Redis connection.
 * Tries Sentinel → Cluster → Standalone in order of preference.
 */
export async function getRedisConnection(): Promise<RedisClient> {
  if (redisInstance && isConnected) return redisInstance;

  const { default: Redis } = await import("ioredis");

  // Priority 1: Redis Sentinel (production HA)
  const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS;
  if (sentinelHosts) {
    const sentinels = sentinelHosts.split(",").map((h) => {
      const [host, port] = h.trim().split(":");
      return { host, port: parseInt(port || "26379", 10) };
    });
    const masterName = process.env.REDIS_SENTINEL_MASTER || "remitflow-master";

    try {
      const client = new Redis({
        sentinels,
        name: masterName,
        password: process.env.REDIS_PASSWORD || undefined,
        sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > MAX_RECONNECT_ATTEMPTS) return null;
          return Math.min(times * RECONNECT_DELAY_MS, 10_000);
        },
        connectTimeout: 5000,
        lazyConnect: false,
        enableReadyCheck: true,
        enableOfflineQueue: false,
      });

      client.on("connect", () => {
        isConnected = true;
        connectionAttempts = 0;
        logger.info({ mode: "sentinel", masterName }, "[Redis] Connected to Sentinel master");
      });

      client.on("error", (err: Error) => {
        lastConnectionError = err.message;
        logger.error({ err: err.message, mode: "sentinel" }, "[Redis] Connection error");
      });

      client.on("close", () => {
        isConnected = false;
        logger.warn("[Redis] Connection closed");
      });

      // Verify connection
      await client.ping();
      redisInstance = client as unknown as RedisClient;
      isConnected = true;
      logger.info({ sentinels: sentinels.length, masterName }, "[Redis] Sentinel connection established");
      return redisInstance;
    } catch (err) {
      connectionAttempts++;
      lastConnectionError = err instanceof Error ? err.message : String(err);
      logger.error({ err: lastConnectionError }, "[Redis] Sentinel connection failed");
    }
  }

  // Priority 2: Redis Cluster
  const clusterNodes = process.env.REDIS_CLUSTER_NODES;
  if (clusterNodes) {
    const nodes = clusterNodes.split(",").map((h) => {
      const [host, port] = h.trim().split(":");
      return { host, port: parseInt(port || "6379", 10) };
    });

    try {
      const cluster = new Redis.Cluster(nodes, {
        redisOptions: {
          password: process.env.REDIS_PASSWORD || undefined,
          connectTimeout: 5000,
        },
        clusterRetryStrategy: (times: number) => {
          if (times > MAX_RECONNECT_ATTEMPTS) return null;
          return Math.min(times * RECONNECT_DELAY_MS, 10_000);
        },
        enableOfflineQueue: false,
      });

      cluster.on("connect", () => {
        isConnected = true;
        connectionAttempts = 0;
      });

      cluster.on("error", (err: Error) => {
        lastConnectionError = err.message;
        isConnected = false;
      });

      await (cluster as unknown as RedisClient).ping();
      redisInstance = cluster as unknown as RedisClient;
      isConnected = true;
      logger.info({ nodes: nodes.length }, "[Redis] Cluster connection established");
      return redisInstance;
    } catch (err) {
      connectionAttempts++;
      lastConnectionError = err instanceof Error ? err.message : String(err);
      logger.error({ err: lastConnectionError }, "[Redis] Cluster connection failed");
    }
  }

  // Priority 3: Standalone Redis
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        retryStrategy: (times: number) => {
          if (times > MAX_RECONNECT_ATTEMPTS) return null;
          return Math.min(times * RECONNECT_DELAY_MS, 10_000);
        },
        enableOfflineQueue: false,
        lazyConnect: false,
      });

      client.on("connect", () => { isConnected = true; connectionAttempts = 0; });
      client.on("error", (err: Error) => { lastConnectionError = err.message; });
      client.on("close", () => { isConnected = false; });

      await client.ping();
      redisInstance = client as unknown as RedisClient;
      isConnected = true;
      logger.info("[Redis] Standalone connection established");
      return redisInstance;
    } catch (err) {
      connectionAttempts++;
      lastConnectionError = err instanceof Error ? err.message : String(err);
      logger.error({ err: lastConnectionError }, "[Redis] Standalone connection failed");
    }
  }

  throw new Error(`[Redis] All connection methods exhausted (sentinel: ${!!sentinelHosts}, cluster: ${!!clusterNodes}, standalone: ${!!redisUrl})`);
}

/**
 * Check if Redis is currently available.
 * Does NOT attempt reconnection — just returns current state.
 */
export function isRedisAvailable(): boolean {
  return isConnected && redisInstance !== null;
}

/**
 * Whether fund flow operations should fail-hard when Redis is unavailable.
 * In production, this is always true. In development, configurable via FUND_FLOW_REDIS_STRICT.
 */
export function isFundFlowStrictMode(): boolean {
  const env = process.env.NODE_ENV;
  if (env === "production") return true;
  return process.env.FUND_FLOW_REDIS_STRICT === "true";
}

/**
 * Get Redis health status for monitoring.
 */
export async function getRedisHealth(): Promise<RedisHealthStatus> {
  const mode = process.env.REDIS_SENTINEL_HOSTS
    ? "sentinel"
    : process.env.REDIS_CLUSTER_NODES
      ? "cluster"
      : process.env.REDIS_URL
        ? "standalone"
        : "disconnected";

  let latencyMs: number | undefined;
  if (redisInstance && isConnected) {
    try {
      const start = performance.now();
      await redisInstance.ping();
      latencyMs = Math.round(performance.now() - start);
    } catch {
      isConnected = false;
    }
  }

  return {
    connected: isConnected,
    mode: isConnected ? mode : "disconnected",
    sentinelHosts: process.env.REDIS_SENTINEL_HOSTS?.split(","),
    masterName: process.env.REDIS_SENTINEL_MASTER,
    connectionAttempts,
    lastError: lastConnectionError,
    latencyMs,
  };
}

/**
 * Gracefully disconnect Redis.
 */
export async function disconnectRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      // Already disconnected
    }
    redisInstance = null;
    isConnected = false;
  }
}
