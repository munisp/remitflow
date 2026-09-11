/**
 * RemitFlow — Geo Analytics Router (W10 / SPEC-wave10 C6 integration)
 * ───────────────────────────────────────────────────────────────────
 * tRPC bridge between the relational geo tables
 * (`operational_geo_locations` / `operational_geo_corridors`) and the
 * python-geo-analytics service (:8114, GeoLibre-guarded haversine engine).
 *
 * Honesty discipline (mirrors the service):
 *   - FAIL CLOSED: GEO_ANALYTICS_URL / INTERNAL_SERVICE_KEY unset →
 *     UNAVAILABLE on every analytics call. Never fabricate coverage stats.
 *   - Service non-2xx / unreachable → INTERNAL_SERVER_ERROR with the honest
 *     upstream detail; no fallback numbers are ever synthesized.
 *   - The service response (including its `geoEngine` marker and `warnings`)
 *     is returned verbatim so callers can see exactly which engine computed
 *     the result (geolib vs haversine-stdlib).
 *
 * Management mutations (upsertLocation/upsertCorridor) are admin-only and
 * tenant-scoped; corridor endpoints are validated to belong to the tenant.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getDb } from "../db";
import { logger } from "../_core/logger";
import { resolveTenantContext } from "../tenantMiddleware";
import { operationalGeoCorridors, operationalGeoLocations } from "../../drizzle/schema";

// ── Config (fail closed) ──────────────────────────────────────────────────────
const GEO_ANALYTICS_URL = process.env.GEO_ANALYTICS_URL; // python-geo-analytics (:8114)
const SERVICE_TIMEOUT_MS = 30_000;

const LOCATION_TYPES = ["agent", "partner", "branch", "atm", "cash_point"] as const;
const GEO_STATUSES = ["active", "inactive", "suspended"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function requireGeoDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (tenant.tenantId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No tenant context resolved for geo analytics" });
  }
  return tenant.tenantId;
}

function requireAdmin(ctx: { user: { role?: string | null } }): void {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only admins may manage operational geo data" });
  }
}

/** Numeric (9,6) columns come back as strings — the service needs numbers. */
function toServiceAgent(loc: typeof operationalGeoLocations.$inferSelect) {
  const meta = (loc.metadata ?? {}) as Record<string, unknown>;
  const floatUsd = typeof meta.floatUsd === "number" && Number.isFinite(meta.floatUsd) && meta.floatUsd >= 0
    ? meta.floatUsd
    : undefined;
  return {
    id: loc.externalRef,
    lat: Number(loc.latitude),
    lon: Number(loc.longitude),
    ...(floatUsd !== undefined ? { floatUsd } : {}),
    country: loc.countryCode,
  };
}

/** POST to the geo service; fail closed on any upstream problem. */
async function callGeoService(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  if (!GEO_ANALYTICS_URL || !serviceKey) {
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Geo analytics is not configured (GEO_ANALYTICS_URL / INTERNAL_SERVICE_KEY unset) — no coverage data available",
    });
  }
  let resp: Response;
  try {
    resp = await fetch(`${GEO_ANALYTICS_URL.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ errMsg: (err as Error)?.message, path }, "[GeoAnalytics] service unreachable");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Geo analytics service unreachable: ${(err as Error)?.message ?? "unknown"}` });
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    logger.warn({ status: resp.status, path, detail: detail.slice(0, 300) }, "[GeoAnalytics] service rejected request");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Geo analytics service error ${resp.status}: ${detail.slice(0, 200)}` });
  }
  return (await resp.json()) as Record<string, unknown>;
}

/** Load the tenant's active corridors joined to their endpoint coordinates. */
async function loadCorridorsWithEndpoints(tenantId: number) {
  const db = await requireGeoDb();
  const corridors = await db
    .select()
    .from(operationalGeoCorridors)
    .where(and(eq(operationalGeoCorridors.tenantId, tenantId), eq(operationalGeoCorridors.operationalStatus, "active")))
    .orderBy(desc(operationalGeoCorridors.observedAt))
    .limit(500);
  if (corridors.length === 0) return [];

  const endpointIds = [...new Set(corridors.flatMap((c) => [c.originLocationId, c.destinationLocationId]))];
  const locations = await db
    .select()
    .from(operationalGeoLocations)
    .where(and(eq(operationalGeoLocations.tenantId, tenantId), inArray(operationalGeoLocations.id, endpointIds)));
  const byId = new Map(locations.map((l) => [l.id, l]));

  // A corridor whose endpoints are missing is skipped (never invent coords).
  return corridors.flatMap((c) => {
    const origin = byId.get(c.originLocationId);
    const dest = byId.get(c.destinationLocationId);
    if (!origin || !dest) return [];
    return [{
      code: c.corridorCode,
      originLat: Number(origin.latitude),
      originLon: Number(origin.longitude),
      destLat: Number(dest.latitude),
      destLon: Number(dest.longitude),
    }];
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
export const geoAnalyticsRouter = createTRPCRouter({
  /** Register or update an operational geo location (admin only). */
  upsertLocation: protectedProcedure
    .input(z.object({
      locationType: z.enum(LOCATION_TYPES),
      externalRef: z.string().min(1).max(255),
      displayLabel: z.string().min(1).max(255),
      countryCode: z.string().length(2).transform((s) => s.toUpperCase()),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      floatUsd: z.number().nonnegative().max(1e12).optional(),
      operationalStatus: z.enum(GEO_STATUSES).default("active"),
      metadata: z.record(z.unknown()).default({}),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const db = await requireGeoDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const { floatUsd, metadata, ...rest } = input;
      const mergedMetadata = { ...metadata, ...(floatUsd !== undefined ? { floatUsd } : {}) };
      const [row] = await db
        .insert(operationalGeoLocations)
        .values({
          tenantId,
          ...rest,
          latitude: input.latitude.toFixed(6),
          longitude: input.longitude.toFixed(6),
          metadata: mergedMetadata,
        })
        .onConflictDoUpdate({
          target: [
            operationalGeoLocations.tenantId,
            operationalGeoLocations.locationType,
            operationalGeoLocations.externalRef,
          ],
          set: {
            displayLabel: input.displayLabel,
            countryCode: input.countryCode,
            latitude: input.latitude.toFixed(6),
            longitude: input.longitude.toFixed(6),
            operationalStatus: input.operationalStatus,
            metadata: mergedMetadata,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { location: row };
    }),

  /** Register or update a corridor between two of the tenant's locations (admin only). */
  upsertCorridor: protectedProcedure
    .input(z.object({
      corridorCode: z.string().min(1).max(64),
      originLocationId: z.number().int().positive(),
      destinationLocationId: z.number().int().positive(),
      operationalStatus: z.enum(GEO_STATUSES).default("active"),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const db = await requireGeoDb();
      const tenantId = await requireTenantId(ctx.user.id);
      if (input.originLocationId === input.destinationLocationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Origin and destination must differ" });
      }
      // Both endpoints must belong to this tenant (no cross-tenant corridors).
      const endpoints = await db
        .select({ id: operationalGeoLocations.id })
        .from(operationalGeoLocations)
        .where(and(
          eq(operationalGeoLocations.tenantId, tenantId),
          inArray(operationalGeoLocations.id, [input.originLocationId, input.destinationLocationId]),
        ));
      if (endpoints.length !== 2) {
        throw new TRPCError({ code: "NOT_FOUND", message: "One or both corridor endpoints do not exist for this tenant" });
      }
      const [row] = await db
        .insert(operationalGeoCorridors)
        .values({ tenantId, ...input })
        .onConflictDoUpdate({
          target: [operationalGeoCorridors.tenantId, operationalGeoCorridors.corridorCode],
          set: {
            originLocationId: input.originLocationId,
            destinationLocationId: input.destinationLocationId,
            operationalStatus: input.operationalStatus,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { corridor: row };
    }),

  listLocations: protectedProcedure
    .input(z.object({ status: z.enum(GEO_STATUSES).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireGeoDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const conditions = [eq(operationalGeoLocations.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(operationalGeoLocations.operationalStatus, input.status));
      const locations = await db
        .select()
        .from(operationalGeoLocations)
        .where(and(...conditions))
        .orderBy(desc(operationalGeoLocations.observedAt))
        .limit(input?.limit ?? 100);
      return { locations };
    }),

  listCorridors: protectedProcedure
    .input(z.object({ status: z.enum(GEO_STATUSES).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireGeoDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const conditions = [eq(operationalGeoCorridors.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(operationalGeoCorridors.operationalStatus, input.status));
      const corridors = await db
        .select()
        .from(operationalGeoCorridors)
        .where(and(...conditions))
        .orderBy(desc(operationalGeoCorridors.observedAt))
        .limit(input?.limit ?? 100);
      return { corridors };
    }),

  /**
   * Per-corridor agent/float coverage from the geo service. Response is the
   * service's verbatim result (geoEngine marker + warnings included).
   */
  corridorCoverage: protectedProcedure
    .input(z.object({ radiusKm: z.number().positive().max(2000).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireGeoDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const locations = await db
        .select()
        .from(operationalGeoLocations)
        .where(and(eq(operationalGeoLocations.tenantId, tenantId), eq(operationalGeoLocations.operationalStatus, "active")))
        .orderBy(desc(operationalGeoLocations.observedAt))
        .limit(2000);
      const corridors = await loadCorridorsWithEndpoints(tenantId);
      const result = await callGeoService("/corridor-coverage", {
        agents: locations.map(toServiceAgent),
        corridors,
        radiusKm: input?.radiusKm ?? 50,
      });
      return result;
    }),

  /** Grid heatmap of agent float from the geo service (verbatim response). */
  agentHeatmap: protectedProcedure
    .input(z.object({ cellSizeKm: z.number().positive().max(2000).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireGeoDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const locations = await db
        .select()
        .from(operationalGeoLocations)
        .where(and(eq(operationalGeoLocations.tenantId, tenantId), eq(operationalGeoLocations.operationalStatus, "active")))
        .orderBy(desc(operationalGeoLocations.observedAt))
        .limit(2000);
      const result = await callGeoService("/agent-heatmap", {
        agents: locations.map(toServiceAgent),
        cellSizeKm: input?.cellSizeKm ?? 50,
      });
      return result;
    }),
});
