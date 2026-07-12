/**
 * RemitFlow — Health Check Router
 * ─────────────────────────────────
 * tRPC router exposing platform health endpoints.
 *
 * Endpoints:
 *   - health.platform    — Full platform health with all integrations
 *   - health.integration — Single integration health check
 *   - health.ping        — Simple liveness probe
 */
import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../trpc";
import { getPlatformHealth } from "../integrations/health";

export const healthRouter = router({
  // ─── Liveness Probe ──────────────────────────────────────────────────────
  ping: publicProcedure.query(() => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  })),

  // ─── Platform Health ─────────────────────────────────────────────────────
  platform: adminProcedure.query(async () => {
    return getPlatformHealth();
  }),

  // ─── Integration Health ───────────────────────────────────────────────────
  integration: adminProcedure
    .input(z.object({
      name: z.enum([
        "PostgreSQL", "Redis", "Keycloak", "Permify", "Dapr",
        "Temporal", "TigerBeetle", "APISIX", "Fluvio", "Lakehouse", "OpenAppSec"
      ]),
    }))
    .query(async ({ input }) => {
      const health = await getPlatformHealth();
      const integration = health.integrations.find(i => i.name === input.name);
      if (!integration) return { status: "unknown", name: input.name };
      return integration;
    }),
});
