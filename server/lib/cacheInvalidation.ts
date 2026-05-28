/**
 * Distributed Cache Invalidation via Redis Pub/Sub
 *
 * When running multiple API pods, local in-memory caches (BoundedCache instances)
 * will drift unless invalidation events are propagated across pods.
 *
 * This module:
 *   1. Subscribes to a Redis pub/sub channel `remitflow:cache:invalidate`
 *   2. When a cache is invalidated locally, publishes the event to all pods
 *   3. On receiving a remote event, clears the corresponding local cache
 *
 * Usage:
 *   import { publishCacheInvalidation } from './cacheInvalidation';
 *   invalidateConfigCache(key);
 *   publishCacheInvalidation('system-config', key);  // propagates to other pods
 */
import Redis from "ioredis";
import { logger } from "../_core/logger";
import { invalidateConfigCache } from "../routers/v97Features";
import { invalidateFlagCache } from "../routers/tenantEnforcement";
import { invalidateTenantCache } from "../tenantMiddleware";

const CHANNEL = "remitflow:cache:invalidate";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

interface InvalidationEvent {
  cacheName: string;
  key?: string;
  podId: string;
  timestamp: number;
}

// Unique pod identifier to avoid processing own messages
const POD_ID = `pod-${process.pid}-${Date.now()}`;

let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let isConnected = false;

/**
 * Initialize the pub/sub connections for distributed invalidation.
 * Call once at server startup.
 */
export async function initCacheInvalidation(): Promise<void> {
  try {
    subscriber = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 3000)),
    });

    publisher = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });

    await Promise.all([subscriber.connect(), publisher.connect()]);

    subscriber.subscribe(CHANNEL, (err) => {
      if (err) {
        logger.warn({ err }, "[CacheInvalidation] Failed to subscribe");
        return;
      }
      isConnected = true;
      logger.info(`[CacheInvalidation] Subscribed to ${CHANNEL} (pod: ${POD_ID})`);
    });

    subscriber.on("message", (_channel: string, message: string) => {
      try {
        const event: InvalidationEvent = JSON.parse(message);
        // Skip own messages
        if (event.podId === POD_ID) return;
        handleRemoteInvalidation(event);
      } catch {
        // Malformed message, ignore
      }
    });

    subscriber.on("error", () => { isConnected = false; });
    publisher.on("error", () => {});
  } catch (err) {
    logger.warn({ err }, "[CacheInvalidation] Init failed — running in single-pod mode");
  }
}

/**
 * Publish a cache invalidation event to all pods.
 * Call this AFTER performing the local invalidation.
 */
export async function publishCacheInvalidation(cacheName: string, key?: string): Promise<void> {
  if (!publisher || !isConnected) return;

  const event: InvalidationEvent = {
    cacheName,
    key,
    podId: POD_ID,
    timestamp: Date.now(),
  };

  try {
    await publisher.publish(CHANNEL, JSON.stringify(event));
  } catch {
    // Non-fatal — local cache is already invalidated
  }
}

/**
 * Handle an invalidation event from another pod.
 */
function handleRemoteInvalidation(event: InvalidationEvent): void {
  switch (event.cacheName) {
    case "system-config":
      invalidateConfigCache(event.key);
      break;
    case "tenant-feature-flags":
      if (event.key) {
        const parts = event.key.split(":");
        const tenantId = parseInt(parts[0], 10);
        const flagKey = parts.slice(1).join(":");
        if (!isNaN(tenantId) && flagKey) {
          invalidateFlagCache(flagKey, tenantId);
        } else {
          invalidateFlagCache();
        }
      } else {
        invalidateFlagCache();
      }
      break;
    case "tenant-context":
      if (event.key) {
        const userId = parseInt(event.key, 10);
        if (!isNaN(userId)) invalidateTenantCache(userId);
      }
      break;
    case "all":
      invalidateConfigCache();
      invalidateFlagCache();
      break;
    default:
      logger.debug(`[CacheInvalidation] Unknown cache: ${event.cacheName}`);
  }
}

/**
 * Graceful shutdown — close pub/sub connections.
 */
export async function shutdownCacheInvalidation(): Promise<void> {
  try {
    if (subscriber) {
      await subscriber.unsubscribe(CHANNEL);
      subscriber.disconnect();
    }
    if (publisher) publisher.disconnect();
    isConnected = false;
    logger.info("[CacheInvalidation] Disconnected");
  } catch {
    // Best-effort cleanup
  }
}

export function isCacheInvalidationConnected(): boolean {
  return isConnected;
}
