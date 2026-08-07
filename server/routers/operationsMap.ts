import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditedAdminProcedure, router } from "../_core/trpc";
import { requireDb } from "../db";
import { resolveTenantContext } from "../tenantMiddleware";

const locationTypeSchema = z.enum(["agent", "partner", "corridor_origin", "corridor_destination", "fraud_incident"]);
const locationStatusSchema = z.enum(["active", "degraded", "inactive", "investigating"]);
const corridorStatusSchema = z.enum(["active", "degraded", "suspended", "investigating"]);

async function withTenantDb<T>(userId: number, operation: (db: any, tenantId: number) => Promise<T>): Promise<T> {
  const tenant = await resolveTenantContext(userId);
  const tenantId = tenant.tenantId;
  if (tenantId == null) throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required." });
  const db = await requireDb();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${String(tenantId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${String(userId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'false', true)`);
    return operation(tx, tenantId);
  });
}

function rows<T>(result: unknown): T[] {
  return (result as { rows?: T[] })?.rows ?? (result as T[]);
}

export const operationsMapRouter = router({
  overview: auditedAdminProcedure
    .input(z.object({
      includeIncidents: z.boolean().default(false),
      statuses: z.array(locationStatusSchema).max(4).optional(),
    }).optional())
    .query(async ({ input, ctx }) => withTenantDb(ctx.user.id, async (db, tenantId) => {
      const statuses = input?.statuses?.length ? input.statuses : null;
      const locations = rows<{
        id: number; location_type: string; external_ref: string; display_label: string;
        country_code: string; latitude: string; longitude: string; operational_status: string;
        metadata: Record<string, unknown>; observed_at: Date;
      }>(await db.execute(sql`
        SELECT id, location_type, external_ref, display_label, country_code, latitude, longitude,
               operational_status, metadata, observed_at
        FROM operational_geo_locations
        WHERE tenant_id = ${tenantId}
          AND (${input?.includeIncidents ?? false} OR location_type <> 'fraud_incident')
          AND (${statuses}::text[] IS NULL OR operational_status = ANY(${statuses}::text[]))
        ORDER BY observed_at DESC, id DESC
        LIMIT 1000
      `));
      const corridors = rows<{
        id: number; corridor_code: string; operational_status: string;
        p95_completion_seconds: number | null; failure_rate_bps: number | null; observed_at: Date;
        origin_latitude: string; origin_longitude: string; origin_label: string;
        destination_latitude: string; destination_longitude: string; destination_label: string;
      }>(await db.execute(sql`
        SELECT c.id, c.corridor_code, c.operational_status, c.p95_completion_seconds, c.failure_rate_bps, c.observed_at,
               origin.latitude AS origin_latitude, origin.longitude AS origin_longitude, origin.display_label AS origin_label,
               destination.latitude AS destination_latitude, destination.longitude AS destination_longitude, destination.display_label AS destination_label
        FROM operational_geo_corridors c
        INNER JOIN operational_geo_locations origin ON origin.id = c.origin_location_id
        INNER JOIN operational_geo_locations destination ON destination.id = c.destination_location_id
        WHERE c.tenant_id = ${tenantId}
        ORDER BY c.observed_at DESC, c.corridor_code ASC
        LIMIT 500
      `));

      return {
        generatedAt: new Date().toISOString(),
        locations: locations.map((location) => ({
          ...location,
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
        })),
        corridors: corridors.map((corridor) => ({
          ...corridor,
          origin: { latitude: Number(corridor.origin_latitude), longitude: Number(corridor.origin_longitude), label: corridor.origin_label },
          destination: { latitude: Number(corridor.destination_latitude), longitude: Number(corridor.destination_longitude), label: corridor.destination_label },
        })),
      };
    })),

  upsertLocation: auditedAdminProcedure
    .input(z.object({
      locationType: locationTypeSchema,
      externalRef: z.string().trim().min(1).max(255),
      displayLabel: z.string().trim().min(1).max(255),
      countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
      latitude: z.number().gte(-90).lte(90),
      longitude: z.number().gte(-180).lte(180),
      operationalStatus: locationStatusSchema.default("active"),
      metadata: z.record(z.string(), z.unknown()).default({}),
      observedAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => withTenantDb(ctx.user.id, async (db, tenantId) => {
      const [location] = rows<{ id: number }>(await db.execute(sql`
        INSERT INTO operational_geo_locations (
          tenant_id, location_type, external_ref, display_label, country_code,
          latitude, longitude, operational_status, metadata, observed_at, updated_at
        ) VALUES (
          ${tenantId}, ${input.locationType}, ${input.externalRef}, ${input.displayLabel}, ${input.countryCode},
          ${input.latitude}, ${input.longitude}, ${input.operationalStatus}, ${JSON.stringify(input.metadata)}::jsonb,
          COALESCE(${input.observedAt ?? null}::timestamptz, NOW()), NOW()
        )
        ON CONFLICT (tenant_id, location_type, external_ref)
        DO UPDATE SET display_label = EXCLUDED.display_label, country_code = EXCLUDED.country_code,
          latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
          operational_status = EXCLUDED.operational_status, metadata = EXCLUDED.metadata,
          observed_at = EXCLUDED.observed_at, updated_at = NOW()
        RETURNING id
      `));
      return { id: location.id };
    })),

  upsertCorridor: auditedAdminProcedure
    .input(z.object({
      corridorCode: z.string().trim().min(3).max(64),
      originLocationId: z.number().int().positive(),
      destinationLocationId: z.number().int().positive(),
      operationalStatus: corridorStatusSchema.default("active"),
      p95CompletionSeconds: z.number().int().nonnegative().nullable().optional(),
      failureRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
      observedAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => withTenantDb(ctx.user.id, async (db, tenantId) => {
      const locations = rows<{ id: number }>(await db.execute(sql`
        SELECT id FROM operational_geo_locations
        WHERE tenant_id = ${tenantId} AND id IN (${input.originLocationId}, ${input.destinationLocationId})
        FOR SHARE
      `));
      if (locations.length !== 2) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Both corridor locations must belong to the active tenant." });
      }
      const [corridor] = rows<{ id: number }>(await db.execute(sql`
        INSERT INTO operational_geo_corridors (
          tenant_id, corridor_code, origin_location_id, destination_location_id,
          operational_status, p95_completion_seconds, failure_rate_bps, observed_at, updated_at
        ) VALUES (
          ${tenantId}, ${input.corridorCode}, ${input.originLocationId}, ${input.destinationLocationId},
          ${input.operationalStatus}, ${input.p95CompletionSeconds ?? null}, ${input.failureRateBps ?? null},
          COALESCE(${input.observedAt ?? null}::timestamptz, NOW()), NOW()
        )
        ON CONFLICT (tenant_id, corridor_code)
        DO UPDATE SET origin_location_id = EXCLUDED.origin_location_id,
          destination_location_id = EXCLUDED.destination_location_id,
          operational_status = EXCLUDED.operational_status,
          p95_completion_seconds = EXCLUDED.p95_completion_seconds,
          failure_rate_bps = EXCLUDED.failure_rate_bps,
          observed_at = EXCLUDED.observed_at, updated_at = NOW()
        RETURNING id
      `));
      return { id: corridor.id };
    })),
});
