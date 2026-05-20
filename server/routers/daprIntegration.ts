/**
 * RemitFlow — Dapr Integration Router
 *
 * Bridges the Dapr sidecar into the tRPC layer:
 *  - Pub/sub event publishing
 *  - State store get/set
 *  - Service-to-service invocation
 *  - Health/sidecar status
 *
 * Dapr sidecar HTTP API: http://localhost:3500
 * Default pubsub component: remitflow-pubsub
 * Default state store: remitflow-statestore
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createAuditLog } from "../audit.service";

const DAPR_SIDECAR_URL = process.env.DAPR_HTTP_ENDPOINT || "http://localhost:3500";
const DEFAULT_PUBSUB = "remitflow-pubsub";
const DEFAULT_STATESTORE = "remitflow-statestore";

async function daprFetch(path: string, options?: RequestInit): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${DAPR_SIDECAR_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Dapr returned ${res.status}: ${text}` };
    }
    const data = res.status !== 204 ? await res.json().catch(() => null) : null;
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Dapr sidecar not available" };
  }
}

export const daprIntegrationRouter = router({
  /**
   * Check Dapr sidecar health
   */
  health: protectedProcedure.query(async () => {
    const result = await daprFetch("/v1.0/healthz");
    const metaResult = await daprFetch("/v1.0/metadata");
    return {
      available: result.ok,
      sidecarUrl: DAPR_SIDECAR_URL,
      metadata: metaResult.data || null,
      error: result.error || null,
    };
  }),

  /**
   * Publish an event to a Dapr pub/sub topic
   */
  publish: protectedProcedure
    .input(z.object({
      topic: z.string().min(1).max(200),
      data: z.record(z.string(), z.unknown()),
      pubsubName: z.string().default(DEFAULT_PUBSUB),
      metadata: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await daprFetch(
        `/v1.0/publish/${input.pubsubName}/${input.topic}`,
        {
          method: "POST",
          body: JSON.stringify(input.data),
        }
      );

      await createAuditLog({
        userId: ctx.user.id,
        action: "dapr.publish",
        targetType: "dapr_topic",
        description: JSON.stringify({ topic: input.topic, pubsubName: input.pubsubName, available: result.ok }),
      });

      return {
        success: result.ok,
        topic: input.topic,
        pubsubName: input.pubsubName,
        available: result.ok,
        error: result.error || null,
      };
    }),

  /**
   * Get a value from Dapr state store
   */
  getState: protectedProcedure
    .input(z.object({
      key: z.string().min(1).max(200),
      statestore: z.string().default(DEFAULT_STATESTORE),
    }))
    .query(async ({ input }) => {
      const result = await daprFetch(`/v1.0/state/${input.statestore}/${encodeURIComponent(input.key)}`);
      return {
        key: input.key,
        value: result.data,
        available: result.ok,
        error: result.error || null,
      };
    }),

  /**
   * Set a value in Dapr state store
   */
  setState: protectedProcedure
    .input(z.object({
      key: z.string().min(1).max(200),
      value: z.unknown(),
      statestore: z.string().default(DEFAULT_STATESTORE),
      ttlInSeconds: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const body = [{
        key: input.key,
        value: input.value,
        metadata: input.ttlInSeconds ? { ttlInSeconds: String(input.ttlInSeconds) } : undefined,
      }];
      const result = await daprFetch(
        `/v1.0/state/${input.statestore}`,
        { method: "POST", body: JSON.stringify(body) }
      );

      await createAuditLog({
        userId: ctx.user.id,
        action: "dapr.setState",
        targetType: "dapr_state",
        description: JSON.stringify({ key: input.key, statestore: input.statestore, available: result.ok }),
      });

      return { success: result.ok, key: input.key, available: result.ok, error: result.error || null };
    }),

  /**
   * Invoke a method on another Dapr-enabled service
   */
  invokeMethod: protectedProcedure
    .input(z.object({
      appId: z.string().min(1).max(100),
      method: z.string().min(1).max(200),
      data: z.record(z.string(), z.unknown()).optional(),
      httpVerb: z.enum(["GET", "POST", "PUT", "DELETE"]).default("POST"),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await daprFetch(
        `/v1.0/invoke/${input.appId}/method/${input.method}`,
        {
          method: input.httpVerb,
          body: input.data ? JSON.stringify(input.data) : undefined,
        }
      );

      await createAuditLog({
        userId: ctx.user.id,
        action: "dapr.invokeMethod",
        targetType: "dapr_service",
        description: JSON.stringify({ appId: input.appId, method: input.method, available: result.ok }),
      });

      return {
        success: result.ok,
        appId: input.appId,
        method: input.method,
        response: result.data,
        available: result.ok,
        error: result.error || null,
      };
    }),

  /**
   * List configured Dapr components
   */
  listComponents: protectedProcedure.query(async () => {
    const result = await daprFetch("/v1.0/metadata");
    if (!result.ok) {
      return {
        available: false,
        components: [
          { name: DEFAULT_PUBSUB, type: "pubsub.kafka", version: "v1" },
          { name: DEFAULT_STATESTORE, type: "state.redis", version: "v1" },
          { name: "remitflow-bindings", type: "bindings.kafka", version: "v1" },
        ],
        error: result.error,
      };
    }
    return {
      available: true,
      components: result.data?.components || [],
      appId: result.data?.id,
      activeActorsCount: result.data?.actors?.length || 0,
    };
  }),
});
