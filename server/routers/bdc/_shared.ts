/**
 * BDC _shared.ts — helpers imported by ALL BDC routers (B1 owns this file).
 *
 * Export contract (frozen — other coders code against these signatures):
 *   BDC_PURPOSE_CODES / BdcPurposeCode
 *   toCents(v)                        numeric(18,2) string → integer cents
 *   getBdcProfile(db, tenantId)       first profile row; PRECONDITION_FAILED if none
 *   assertBranchActive(db, tenantId, branchId)
 *   haversineMeters(lat1,lng1,lat2,lng2)
 *   checkGeofence(db, tenantId, lat, lng, opts?)  1000m rule vs branches + franchisees
 *   weekStartUTC(d)                   'YYYY-MM-DD' of Monday 00:00 UTC
 *
 * Money convention (schema amendment, overrides SPEC minor-unit naming):
 * BDC money columns are numeric(18,2) WITHOUT the "Minor" suffix
 * (shareholdersFunds, rate, referenceRate, ...). `toCents` converts a
 * numeric(18,2) value to integer cents for exact arithmetic.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import {
  bdcBranches,
  bdcFranchisees,
  bdcOperatorProfiles,
  type BdcBranch,
  type BdcOperatorProfile,
} from "../../../drizzle/schema";
import { logger } from "../../_core/logger";

/** CBN-recognised retail FX purpose codes (SPEC §3.1). */
export const BDC_PURPOSE_CODES = [
  "PTA",
  "BTA",
  "SCHOOL_FEES",
  "MEDICAL",
  "EXAM_FEES",
  "SUBSCRIPTION",
  "NONRESIDENT_REPATRIATION",
] as const;
export type BdcPurposeCode = (typeof BDC_PURPOSE_CODES)[number];

/** CBN 1km minimum-separation rule between BDC locations. */
export const BDC_GEOFENCE_RADIUS_M = 1000;

/**
 * numeric(18,2) → integer cents, exact via string math (no float rounding).
 * Values with more than 2 fractional digits are truncated (schema columns are
 * always scale-2; truncation is only reachable for ad-hoc inputs).
 */
export function toCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  const centsDigits = (fracPart + "00").slice(0, 2);
  const cents = Number(intPart || "0") * 100 + Number(centsDigits || "0");
  return neg ? -cents : cents;
}

/**
 * First operator profile row for the tenant (tenantId is UNIQUE, so at most
 * one). Both 'active' and 'suspended' licence statuses are acceptable
 * ("suspended-ok": suspension does not erase configuration). Throws
 * PRECONDITION_FAILED when no profile exists.
 */
export async function getBdcProfile(
  db: any,
  tenantId: number,
): Promise<BdcOperatorProfile> {
  const rows = await db
    .select()
    .from(bdcOperatorProfiles)
    .where(eq(bdcOperatorProfiles.tenantId, tenantId))
    .limit(1);
  const profile = rows[0] as BdcOperatorProfile | undefined;
  if (!profile) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "BDC operator profile not configured",
    });
  }
  return profile;
}

/**
 * Throws PRECONDITION_FAILED unless the branch exists, belongs to the tenant,
 * and has status='active'. Returns the branch on success.
 */
export async function assertBranchActive(
  db: any,
  tenantId: number,
  branchId: number,
): Promise<BdcBranch> {
  const rows = await db
    .select()
    .from(bdcBranches)
    .where(eq(bdcBranches.id, branchId))
    .limit(1);
  const branch = rows[0] as BdcBranch | undefined;
  if (!branch || branch.tenantId !== tenantId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Branch ${branchId} not found for this tenant`,
    });
  }
  if (branch.status !== "active") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Branch ${branchId} is not active (status: ${branch.status ?? "unknown"})`,
    });
  }
  return branch;
}

/** Great-circle distance in meters (WGS84 mean radius). */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeofenceConflict {
  kind: "branch" | "franchisee";
  id: number;
  name: string;
  distanceMeters: number;
}

/**
 * CBN 1km separation rule: checks the candidate point against every non-closed
 * branch AND franchisee of the tenant (pending sites also block, preventing
 * parallel-registration races). `airportExempt` bypasses the rule entirely and
 * logs the exemption reason (airport locations are CBN-exempt).
 */
export async function checkGeofence(
  db: any,
  tenantId: number,
  lat: number,
  lng: number,
  opts?: { airportExempt?: boolean },
): Promise<{ ok: boolean; conflicts: GeofenceConflict[] }> {
  if (opts?.airportExempt) {
    logger.warn(
      { tenantId, lat, lng },
      "[BDC] geofence check bypassed via airportExempt flag (airport location exemption)",
    );
    return { ok: true, conflicts: [] };
  }

  const conflicts: GeofenceConflict[] = [];

  const branches = (await db
    .select({
      id: bdcBranches.id,
      name: bdcBranches.name,
      lat: bdcBranches.lat,
      lng: bdcBranches.lng,
    })
    .from(bdcBranches)
    .where(and(eq(bdcBranches.tenantId, tenantId), ne(bdcBranches.status, "closed")))) as Array<{
    id: number;
    name: string | null;
    lat: string | null;
    lng: string | null;
  }>;

  for (const b of branches) {
    if (b.lat === null || b.lng === null) continue;
    const d = haversineMeters(lat, lng, Number(b.lat), Number(b.lng));
    if (d < BDC_GEOFENCE_RADIUS_M) {
      conflicts.push({
        kind: "branch",
        id: b.id,
        name: b.name ?? `branch-${b.id}`,
        distanceMeters: Math.round(d),
      });
    }
  }

  const franchisees = (await db
    .select({
      id: bdcFranchisees.id,
      name: bdcFranchisees.name,
      lat: bdcFranchisees.lat,
      lng: bdcFranchisees.lng,
    })
    .from(bdcFranchisees)
    .where(
      and(eq(bdcFranchisees.tenantId, tenantId), ne(bdcFranchisees.status, "closed")),
    )) as Array<{ id: number; name: string | null; lat: string | null; lng: string | null }>;

  for (const f of franchisees) {
    if (f.lat === null || f.lng === null) continue;
    const d = haversineMeters(lat, lng, Number(f.lat), Number(f.lng));
    if (d < BDC_GEOFENCE_RADIUS_M) {
      conflicts.push({
        kind: "franchisee",
        id: f.id,
        name: f.name ?? `franchisee-${f.id}`,
        distanceMeters: Math.round(d),
      });
    }
  }

  conflicts.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { ok: conflicts.length === 0, conflicts };
}

/** 'YYYY-MM-DD' of the Monday 00:00 UTC of the week containing `d`. */
export function weekStartUTC(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const sinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday),
  );
  return monday.toISOString().slice(0, 10);
}
