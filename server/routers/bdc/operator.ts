/**
 * BDC operator registry router (B1) — SPEC §3.2.
 *
 * Procedures:
 *   getProfile           profile + computed nopCap (shareholdersFunds × nopLimitPct/100)
 *   upsertProfile        admin + TOTP; tier change blocked when active branches
 *                        would violate the target tier's rules
 *   registerBranch       admin; 1km geofence + Tier-2 ≤5 branches in ONE stateCode
 *                        + Tier-2 single-state enforcement (profile.tier)
 *   updateBranchStatus   admin + TOTP; cannot close with non-zero inventory
 *   listBranches         filters: status / stateCode
 *   registerFranchisee   admin; Tier-1 ONLY; ≤5 per stateCode; 1km geofence
 *                        (airportExempt flag bypasses, reason logged in _shared)
 *   approveFranchisee    admin + TOTP; guarded pending→active (W13 F-12)
 *   suspendFranchisee    admin + TOTP; guarded active→suspended (W13 F-12)
 *   provisionVault       admin + TOTP; bdc_vaults insert (W13 F-12 — no prior writer)
 *   provisionDrawer      admin + TOTP; bdc_teller_drawers insert (W13 F-12)
 *   listFranchisees      filters: status / stateCode
 *
 * Conventions: auditedAdminProcedure/auditedProcedure from server/_core/trpc.ts
 * (tenant GUC + OTel enrichment + Rust audit log built into the chain),
 * resolveTenantContext for the caller's tenant (fail closed), zod on every
 * input, varchar status vocabularies validated in the app layer.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { auditedAdminProcedure, auditedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { claimIdempotency, storeIdempotency, releaseIdempotencyClaim } from "../../middleware/coreAtomicity";
import { logger } from "../../_core/logger";
import {
  bdcBranches,
  bdcFranchisees,
  bdcOperatorProfiles,
  bdcVaults,
  bdcTellerDrawers,
  type BdcOperatorProfile,
} from "../../../drizzle/schema";
import { assertBranchActive, assertTenantActive, checkGeofence, getBdcProfile, toCents } from "./_shared";

/** True for a Postgres unique-violation error (pg sqlstate 23505). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate key value violates unique constraint/.test(e?.message ?? "");
}

// ─── Local helpers (mirror server/routers/accountingSync.ts conventions) ──────

/** Resolve the caller's session tenant; fail closed when unresolvable. */
async function requireTenantId(userId: number): Promise<number> {
  const session = await resolveTenantContext(userId);
  if (session.tenantId == null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant context for the current session — BDC operations require a tenant",
    });
  }
  return session.tenantId;
}

/** Fail-closed DB handle (SPEC §0.3 — dependency outage denies the operation). */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "UNAVAILABLE", message: "Database unavailable — request refused (fail-closed)" });
  }
  return db;
}

const tierEnum = z.enum(["tier_1", "tier_2"]);
const licenseStatusEnum = z.enum(["pending", "aip", "provisional", "active", "suspended"]);
const branchStatusEnum = z.enum(["pending", "active", "suspended", "closed"]);
const franchiseeStatusEnum = z.enum(["pending", "active", "suspended", "closed"]);
const totpCodeSchema = z.string().regex(/^\d{6}$/, "TOTP code must be 6 digits").optional();
/** numeric(18,2) money input as a string with ≤2dp (stored verbatim). */
const moneySchema = z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Expected a numeric(18,2) amount");

const TIER2_MAX_BRANCHES_PER_STATE = 5;
const TIER1_MAX_FRANCHISEES_PER_STATE = 5;

/**
 * Tier-2 rule check against a set of branch rows + a candidate stateCode.
 * Returns a human-readable violation, or null when compliant.
 * Rules: single stateCode across the whole branch network; ≤5 branches in that state.
 */
function tier2Violation(
  existing: Array<{ stateCode: string | null; status: string | null }>,
  candidateStateCode: string,
): string | null {
  const live = existing.filter((b) => b.status !== "closed");
  const states = new Set(live.map((b) => b.stateCode).filter((s): s is string => !!s));
  states.add(candidateStateCode);
  if (states.size > 1) {
    return `Tier-2 operators are restricted to a single stateCode (network already spans ${[...states].join(", ")})`;
  }
  const inState = live.filter((b) => b.stateCode === candidateStateCode).length;
  if (inState >= TIER2_MAX_BRANCHES_PER_STATE) {
    return `Tier-2 operators may register at most ${TIER2_MAX_BRANCHES_PER_STATE} branches in one stateCode (${candidateStateCode})`;
  }
  return null;
}

export const operatorRouter = router({
  // ── Profile ──────────────────────────────────────────────────────────────
  getProfile: auditedProcedure.query(async ({ ctx }) => {
    const tenantId = await requireTenantId(ctx.user.id);
    const db = await requireDb();
    const profile = await getBdcProfile(db, tenantId);
    // Computed prudential cap: nopCap = shareholdersFunds × nopLimitPct/100
    // (integer-cent math on the numeric(18,2) columns).
    const fundsCents = toCents(profile.shareholdersFunds);
    const nopCapCents = Math.trunc((fundsCents * profile.nopLimitPct) / 100);
    const borrowingCapCents = Math.trunc((fundsCents * profile.borrowingLimitPct) / 100);
    return {
      ...profile,
      computed: {
        nopCap: (nopCapCents / 100).toFixed(2),
        nopCapCents,
        borrowingCap: (borrowingCapCents / 100).toFixed(2),
        borrowingCapCents,
      },
    };
  }),

  upsertProfile: auditedAdminProcedure
    .input(
      z.object({
        tier: tierEnum.optional(),
        licenseNo: z.string().max(64).optional(),
        stateCode: z.string().max(8).optional(),
        shareholdersFunds: moneySchema.optional(),
        nopLimitPct: z.number().int().min(0).max(100).optional(),
        borrowingLimitPct: z.number().int().min(0).max(100).optional(),
        weeklyNfemEntitlementUsd: moneySchema.optional(),
        licenseStatus: licenseStatusEnum.optional(),
        paDeadlineAt: z.coerce.date().optional(),
        totpCode: totpCodeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC operator profile update");
      const db = await requireDb();
      // W13: profile config is blocked once a tenant offboarding has COMPLETED.
      await assertTenantActive(db, tenantId);

      const existing = await db
        .select()
        .from(bdcOperatorProfiles)
        .where(eq(bdcOperatorProfiles.tenantId, tenantId))
        .limit(1);
      const current = existing[0] as BdcOperatorProfile | undefined;

      // Tier change guard: the new tier must not be violated by ACTIVE branches.
      if (current && input.tier && input.tier !== current.tier && input.tier === "tier_2") {
        const activeBranches = (await db
          .select({ stateCode: bdcBranches.stateCode, status: bdcBranches.status })
          .from(bdcBranches)
          .where(and(eq(bdcBranches.tenantId, tenantId), eq(bdcBranches.status, "active")))) as Array<{
          stateCode: string | null;
          status: string | null;
        }>;
        // "No active branches violating tier rules": every active branch must
        // share one stateCode and no state may exceed the ≤5 cap.
        const states = new Set(activeBranches.map((b) => b.stateCode).filter((s): s is string => !!s));
        if (states.size > 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot downgrade to tier_2: active branches span multiple stateCodes (${[...states].join(", ")})`,
          });
        }
        for (const state of states) {
          const n = activeBranches.filter((b) => b.stateCode === state).length;
          if (n > TIER2_MAX_BRANCHES_PER_STATE) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Cannot downgrade to tier_2: ${n} active branches in ${state} exceed the ${TIER2_MAX_BRANCHES_PER_STATE}-branch cap`,
            });
          }
        }
      }

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.tier !== undefined) values.tier = input.tier;
      if (input.licenseNo !== undefined) values.licenseNo = input.licenseNo;
      if (input.stateCode !== undefined) values.stateCode = input.stateCode;
      if (input.shareholdersFunds !== undefined) values.shareholdersFunds = input.shareholdersFunds;
      if (input.nopLimitPct !== undefined) values.nopLimitPct = input.nopLimitPct;
      if (input.borrowingLimitPct !== undefined) values.borrowingLimitPct = input.borrowingLimitPct;
      if (input.weeklyNfemEntitlementUsd !== undefined)
        values.weeklyNfemEntitlementUsd = input.weeklyNfemEntitlementUsd;
      if (input.licenseStatus !== undefined) values.licenseStatus = input.licenseStatus;
      if (input.paDeadlineAt !== undefined) values.paDeadlineAt = input.paDeadlineAt;

      if (current) {
        const updated = await db
          .update(bdcOperatorProfiles)
          .set(values)
          .where(eq(bdcOperatorProfiles.tenantId, tenantId))
          .returning();
        return updated[0];
      }
      const inserted = await db
        .insert(bdcOperatorProfiles)
        .values({ tenantId, ...values })
        .returning();
      return inserted[0];
    }),

  // ── Branches ─────────────────────────────────────────────────────────────
  registerBranch: auditedAdminProcedure
    .input(
      z.object({
        code: z.string().min(1).max(16),
        name: z.string().min(1).max(128),
        address: z.string().optional(),
        stateCode: z.string().min(1).max(8),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        isHeadOffice: z.boolean().default(false),
        /** Optional client idempotency key — stops double-registration (W13). */
        idempotencyKey: z.string().min(8).max(64).optional(),
        totpCode: totpCodeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      // Registry mutation — canonical step-up (F15), same pattern as updateBranchStatus.
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC branch registration");
      const db = await requireDb();

      // W13: tenant-prefixed idempotency claim (Redis SET NX PX, same pattern
      // as sales.ts) — a retried double-submit replays the stored result
      // instead of inserting twice.
      const claimKey = input.idempotencyKey ? `BDC-REG-BRANCH-${tenantId}-${input.idempotencyKey}` : null;
      if (claimKey) {
        const claim = await claimIdempotency(claimKey);
        if (claim.cached) return claim.result;
      }

      try {
        const profile = await getBdcProfile(db, tenantId);

        // 1km geofence vs existing branches AND franchisees.
        const geo = await checkGeofence(db, tenantId, input.lat, input.lng);
        if (!geo.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Branch violates the 1km separation rule: ${geo.conflicts
              .map((c) => `${c.kind} ${c.name} at ${c.distanceMeters}m`)
              .join("; ")}`,
          });
        }

        // Tier-2 prudential rules (single stateCode + ≤5 branches in that state).
        if (profile.tier === "tier_2") {
          const existing = (await db
            .select({ stateCode: bdcBranches.stateCode, status: bdcBranches.status })
            .from(bdcBranches)
            .where(eq(bdcBranches.tenantId, tenantId))) as Array<{
            stateCode: string | null;
            status: string | null;
          }>;
          const violation = tier2Violation(existing, input.stateCode);
          if (violation) throw new TRPCError({ code: "BAD_REQUEST", message: violation });
        }

        let inserted;
        try {
          inserted = await db
            .insert(bdcBranches)
            .values({
              tenantId,
              code: input.code,
              name: input.name,
              address: input.address ?? null,
              stateCode: input.stateCode,
              lat: input.lat.toFixed(7),
              lng: input.lng.toFixed(7),
              isHeadOffice: input.isHeadOffice,
              status: "pending",
            })
            .returning();
        } catch (err) {
          // bdc_branches_tenant_code_uidx (tenant_id, code) — honest conflict.
          if (isUniqueViolation(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Branch code '${input.code}' is already registered for this tenant`,
            });
          }
          throw err;
        }
        const result = inserted[0];
        if (claimKey) storeIdempotency(claimKey, result);
        return result;
      } catch (err) {
        if (claimKey) await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),

  updateBranchStatus: auditedAdminProcedure
    .input(
      z.object({
        branchId: z.number().int().positive(),
        status: z.enum(["active", "suspended", "closed"]),
        totpCode: totpCodeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC branch status change");
      const db = await requireDb();

      // Cannot close a branch holding non-zero vault/drawer inventory.
      if (input.status === "closed") {
        const rows = (await db.execute(sql`
          SELECT COALESCE(SUM(i.note_count), 0)::bigint AS notes
          FROM bdc_denomination_inventory i
          WHERE i.tenant_id = ${tenantId}
            AND i.note_count > 0
            AND (
              (i.location_type = 'vault' AND i.location_id IN (
                SELECT id FROM bdc_vaults WHERE tenant_id = ${tenantId} AND branch_id = ${input.branchId}
              ))
              OR
              (i.location_type = 'drawer' AND i.location_id IN (
                SELECT id FROM bdc_teller_drawers WHERE tenant_id = ${tenantId} AND branch_id = ${input.branchId}
              ))
            )
        `)) as unknown as Array<{ notes: string | number }>;
        const notes = Number(rows[0]?.notes ?? 0);
        if (notes > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot close branch ${input.branchId}: ${notes} note(s) remain in vault/drawer inventory — transfer stock first`,
          });
        }
      }

      // Guarded single-winner update, tenant-scoped.
      const updated = await db
        .update(bdcBranches)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(bdcBranches.id, input.branchId), eq(bdcBranches.tenantId, tenantId)))
        .returning();
      if (updated.length !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Branch ${input.branchId} not found for this tenant` });
      }
      return updated[0];
    }),

  listBranches: auditedProcedure
    .input(
      z.object({
        status: branchStatusEnum.optional(),
        stateCode: z.string().max(8).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      const conditions = [eq(bdcBranches.tenantId, tenantId)];
      if (input.status) conditions.push(eq(bdcBranches.status, input.status));
      if (input.stateCode) conditions.push(eq(bdcBranches.stateCode, input.stateCode));
      return db
        .select()
        .from(bdcBranches)
        .where(and(...conditions))
        .orderBy(bdcBranches.id);
    }),

  // ── Franchisees (Tier-1 operators only) ──────────────────────────────────
  registerFranchisee: auditedAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        licenseRef: z.string().max(64).optional(),
        stateCode: z.string().min(1).max(8),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        royaltyBps: z.number().int().min(0).max(10000).default(0),
        /** CBN airport-location exemption from the 1km rule (reason logged). */
        airportExempt: z.boolean().default(false),
        /** Optional client idempotency key — stops double-registration (W13). */
        idempotencyKey: z.string().min(8).max(64).optional(),
        totpCode: totpCodeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      // Registry mutation — canonical step-up (F15).
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC franchisee registration");
      const db = await requireDb();

      // W13: tenant-prefixed idempotency claim (Redis SET NX PX, same pattern
      // as sales.ts) — a retried double-submit replays the stored result
      // instead of inserting twice.
      const claimKey = input.idempotencyKey ? `BDC-REG-FRANCHISEE-${tenantId}-${input.idempotencyKey}` : null;
      if (claimKey) {
        const claim = await claimIdempotency(claimKey);
        if (claim.cached) return claim.result;
      }

      try {
        const profile = await getBdcProfile(db, tenantId);

        if (profile.tier !== "tier_1") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only Tier-1 BDC operators may register franchisees",
          });
        }

        // ≤5 franchisees per stateCode (non-closed).
        const inState = (await db
          .select({ id: bdcFranchisees.id })
          .from(bdcFranchisees)
          .where(
            and(
              eq(bdcFranchisees.tenantId, tenantId),
              eq(bdcFranchisees.stateCode, input.stateCode),
              ne(bdcFranchisees.status, "closed"),
            ),
          )) as Array<{ id: number }>;
        if (inState.length >= TIER1_MAX_FRANCHISEES_PER_STATE) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `At most ${TIER1_MAX_FRANCHISEES_PER_STATE} franchisees per stateCode (${input.stateCode})`,
          });
        }

        // 1km geofence vs branches AND franchisees (airport exemption bypasses,
        // with the reason logged inside checkGeofence).
        const geo = await checkGeofence(db, tenantId, input.lat, input.lng, {
          airportExempt: input.airportExempt,
        });
        if (!geo.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Franchisee violates the 1km separation rule: ${geo.conflicts
              .map((c) => `${c.kind} ${c.name} at ${c.distanceMeters}m`)
              .join("; ")}`,
          });
        }
        if (input.airportExempt) {
          logger.warn(
            { tenantId, name: input.name, stateCode: input.stateCode },
            "[BDC] franchisee registered under airport geofence exemption",
          );
        }

        const inserted = await db
          .insert(bdcFranchisees)
          .values({
            tenantId,
            name: input.name,
            licenseRef: input.licenseRef ?? null,
            stateCode: input.stateCode,
            lat: input.lat.toFixed(7),
            lng: input.lng.toFixed(7),
            royaltyBps: input.royaltyBps,
            status: "pending",
          })
          .returning();
        const result = inserted[0];
        if (claimKey) storeIdempotency(claimKey, result);
        return result;
      } catch (err) {
        if (claimKey) await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),

  /**
   * approveFranchisee (admin + TOTP) — W13 (F-12): franchisees were
   * register-only with no activation path. Guarded single-winner
   * pending→active, tenant-scoped, audited.
   */
  approveFranchisee: auditedAdminProcedure
    .input(z.object({ franchiseeId: z.number().int().positive(), totpCode: totpCodeSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC franchisee approval");
      const db = await requireDb();

      const updated = await db
        .update(bdcFranchisees)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(
          eq(bdcFranchisees.id, input.franchiseeId),
          eq(bdcFranchisees.tenantId, tenantId),
          eq(bdcFranchisees.status, "pending"),
        ))
        .returning();
      if (updated.length !== 1) {
        const [existing] = await db
          .select({ status: bdcFranchisees.status })
          .from(bdcFranchisees)
          .where(and(eq(bdcFranchisees.id, input.franchiseeId), eq(bdcFranchisees.tenantId, tenantId)))
          .limit(1);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Franchisee ${input.franchiseeId} not found for this tenant` });
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: `Franchisee ${input.franchiseeId} cannot be approved from status '${existing.status}' (only pending)`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_FRANCHISEE_APPROVED",
        targetType: "bdc_franchisees",
        targetId: input.franchiseeId,
        description: `Franchisee ${input.franchiseeId} approved (pending → active)`,
        metadata: { tenantId, franchiseeId: input.franchiseeId },
      });
      return updated[0];
    }),

  /**
   * suspendFranchisee (admin + TOTP) — guarded single-winner active→suspended,
   * tenant-scoped, audited.
   */
  suspendFranchisee: auditedAdminProcedure
    .input(z.object({
      franchiseeId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
      totpCode: totpCodeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC franchisee suspension");
      const db = await requireDb();

      const updated = await db
        .update(bdcFranchisees)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(and(
          eq(bdcFranchisees.id, input.franchiseeId),
          eq(bdcFranchisees.tenantId, tenantId),
          eq(bdcFranchisees.status, "active"),
        ))
        .returning();
      if (updated.length !== 1) {
        const [existing] = await db
          .select({ status: bdcFranchisees.status })
          .from(bdcFranchisees)
          .where(and(eq(bdcFranchisees.id, input.franchiseeId), eq(bdcFranchisees.tenantId, tenantId)))
          .limit(1);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Franchisee ${input.franchiseeId} not found for this tenant` });
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: `Franchisee ${input.franchiseeId} cannot be suspended from status '${existing.status}' (only active)`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_FRANCHISEE_SUSPENDED",
        targetType: "bdc_franchisees",
        targetId: input.franchiseeId,
        severity: "warning",
        description: `Franchisee ${input.franchiseeId} suspended${input.reason ? `: ${input.reason}` : ""}`,
        metadata: { tenantId, franchiseeId: input.franchiseeId, reason: input.reason ?? null },
      });
      return updated[0];
    }),

  // ── Vault / drawer provisioning (W13 F-12: bdc_vaults / bdc_teller_drawers
  //    previously had ZERO insert paths, so sales could never run) ──────────

  /**
   * provisionVault (admin + TOTP) — insert a bdc_vaults row for an ACTIVE
   * branch. Idempotent via the natural key (tenant, branch, name): a repeat
   * call returns the existing vault with created=false (checked inside the
   * transaction so concurrent provisions single-win).
   */
  provisionVault: auditedAdminProcedure
    .input(z.object({
      branchId: z.number().int().positive(),
      name: z.string().min(1).max(64),
      vaultType: z.enum(["branch_vault", "head_vault"]).default("branch_vault"),
      totpCode: totpCodeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC vault provisioning");
      const db = await requireDb();
      // Branch must exist, belong to the tenant, and be active.
      await assertBranchActive(db, tenantId, input.branchId);

      const outcome = await db.transaction(async (tx: any) => {
        const [existing] = await tx
          .select()
          .from(bdcVaults)
          .where(and(
            eq(bdcVaults.tenantId, tenantId),
            eq(bdcVaults.branchId, input.branchId),
            eq(bdcVaults.name, input.name),
          ))
          .limit(1);
        if (existing) return { vault: existing, created: false };
        const [inserted] = await tx
          .insert(bdcVaults)
          .values({
            tenantId,
            branchId: input.branchId,
            name: input.name,
            vaultType: input.vaultType,
            status: "active",
          })
          .returning();
        return { vault: inserted, created: true };
      });

      if (outcome.created) {
        await createAuditLog({
          userId: ctx.user.id,
          action: "BDC_VAULT_PROVISIONED",
          targetType: "bdc_vaults",
          targetId: outcome.vault.id,
          description: `Vault '${input.name}' provisioned at branch ${input.branchId}`,
          metadata: { tenantId, branchId: input.branchId, vaultType: input.vaultType },
        });
      }
      return outcome;
    }),

  /**
   * provisionDrawer (admin + TOTP) — insert a bdc_teller_drawers row (the
   * teller's cash till) at an ACTIVE branch. Idempotent via the natural key
   * (tenant, branch, holderUserId): one drawer per holder per branch; a repeat
   * call returns the existing drawer with created=false.
   */
  provisionDrawer: auditedAdminProcedure
    .input(z.object({
      branchId: z.number().int().positive(),
      holderUserId: z.number().int().positive(),
      totpCode: totpCodeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC teller drawer provisioning");
      const db = await requireDb();
      // Branch must exist, belong to the tenant, and be active.
      await assertBranchActive(db, tenantId, input.branchId);

      const outcome = await db.transaction(async (tx: any) => {
        const [existing] = await tx
          .select()
          .from(bdcTellerDrawers)
          .where(and(
            eq(bdcTellerDrawers.tenantId, tenantId),
            eq(bdcTellerDrawers.branchId, input.branchId),
            eq(bdcTellerDrawers.holderUserId, input.holderUserId),
          ))
          .limit(1);
        if (existing) return { drawer: existing, created: false };
        const [inserted] = await tx
          .insert(bdcTellerDrawers)
          .values({
            tenantId,
            branchId: input.branchId,
            holderUserId: input.holderUserId,
            status: "active",
          })
          .returning();
        return { drawer: inserted, created: true };
      });

      if (outcome.created) {
        await createAuditLog({
          userId: ctx.user.id,
          action: "BDC_DRAWER_PROVISIONED",
          targetType: "bdc_teller_drawers",
          targetId: outcome.drawer.id,
          description: `Teller drawer provisioned at branch ${input.branchId} for holder user ${input.holderUserId}`,
          metadata: { tenantId, branchId: input.branchId, holderUserId: input.holderUserId },
        });
      }
      return outcome;
    }),

  listFranchisees: auditedProcedure
    .input(
      z.object({
        status: franchiseeStatusEnum.optional(),
        stateCode: z.string().max(8).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      const conditions = [eq(bdcFranchisees.tenantId, tenantId)];
      if (input.status) conditions.push(eq(bdcFranchisees.status, input.status));
      if (input.stateCode) conditions.push(eq(bdcFranchisees.stateCode, input.stateCode));
      return db
        .select()
        .from(bdcFranchisees)
        .where(and(...conditions))
        .orderBy(bdcFranchisees.id);
    }),
});
