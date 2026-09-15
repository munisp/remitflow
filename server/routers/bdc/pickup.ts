/**
 * BDC Pickup Router — SPEC-wave12 §4.8 / G9 (owner: B7)
 *
 * Third-party cash pickup authorizations: a verified customer may authorize a
 * named agent (relative/driver/etc.) to collect cash on their behalf. The
 * agent's ID number is stored secretBox-encrypted (the same `encryptField`
 * helper used for bdc_customers.bvn_enc — server/_core/secretBox.ts) and is
 * verified at release time with a constant-time comparison.
 *
 * Conventions (verified against server/routers/bdc/vault.ts):
 *  - auditedProcedure for teller ops, auditedAdminProcedure for managerial ops.
 *  - TOTP step-up via requireTotpStepUp on every mutation.
 *  - Single-winner guarded status flips (UPDATE ... WHERE status=:prev
 *    RETURNING — 0 rows → CONFLICT); multi-statement mutations run in
 *    db.transaction.
 *  - claimIdempotency BEFORE state changes; releaseIdempotencyClaim on any
 *    failure so a failed execution never burns the client's key.
 *  - Money comparisons in integer cents via toCents (./_shared).
 *
 * Rescreen-block note: B3 owns `assertCustomerNotRescreenBlocked` in
 * ./_shared.ts, but it is NOT present at this branch's base — the check is
 * therefore inlined here with identical PRECONDITION_FAILED semantics
 * (latest bdc_rescreening_results row with blocked=true blocks). When the
 * shared helper lands it can replace the inline query without behavior change.
 */
import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  bdcCustomers,
  bdcPickupAuthorizations,
  bdcRescreeningResults,
  bdcTransactions,
} from "../../../drizzle/schema";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { claimIdempotency, storeIdempotency, releaseIdempotencyClaim } from "../../middleware/coreAtomicity";
import { encryptField, decryptField } from "../../_core/secretBox";
import { logger } from "../../_core/logger";
import { getBdcProfile, toCents } from "./_shared";

// ─── Local helpers ────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable (fail-closed)" });
  }
  return db;
}

/** Resolve the caller's tenant — every BDC query is tenant-scoped (SPEC §0.9). */
async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (!tenant.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC pickup operations." });
  }
  return tenant.tenantId;
}

const PICKUP_STATUSES = ["pending", "used", "expired", "revoked"] as const;
const AGENT_ID_TYPES = ["nin", "bvn", "passport", "drivers_license", "voters_card"] as const;

/**
 * Inline equivalent of B3's `assertCustomerNotRescreenBlocked` (not yet
 * present in ./_shared.ts at this branch time — see file header). Throws
 * PRECONDITION_FAILED when the customer's LATEST rescreening result is
 * blocked; never blocks on 'error' verdicts (blocked=false there).
 */
async function assertCustomerNotRescreenBlockedInline(
  db: any,
  tenantId: number,
  customerId: number,
): Promise<void> {
  const rows = await db
    .select({ blocked: bdcRescreeningResults.blocked })
    .from(bdcRescreeningResults)
    .where(
      and(
        eq(bdcRescreeningResults.tenantId, tenantId),
        eq(bdcRescreeningResults.customerId, customerId),
      ),
    )
    .orderBy(desc(bdcRescreeningResults.createdAt), desc(bdcRescreeningResults.id))
    .limit(1);
  if (rows[0]?.blocked) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Customer blocked by sanctions rescreening — MLRO review required",
    });
  }
}

/**
 * Constant-time comparison of a presented agent ID number against the stored
 * secretBox-encrypted value. Both sides are SHA-256 hashed first so the
 * timingSafeEqual length check does not leak the ID length, and decryption
 * failures are treated as a mismatch (stateless fail — nothing is incremented
 * or recorded against the agent).
 */
function agentIdMatches(storedEnc: string, presented: string): boolean {
  let stored: string;
  try {
    stored = decryptField(storedEnc);
  } catch {
    return false; // corrupt ciphertext / missing key — honest mismatch
  }
  const a = crypto.createHash("sha256").update(stored.trim(), "utf8").digest();
  const b = crypto.createHash("sha256").update(presented.trim(), "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/** Load a tenant-scoped authorization row or throw NOT_FOUND. */
async function loadAuthorization(db: any, tenantId: number, authorizationId: number) {
  const [row] = await db
    .select()
    .from(bdcPickupAuthorizations)
    .where(
      and(
        eq(bdcPickupAuthorizations.id, authorizationId),
        eq(bdcPickupAuthorizations.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Pickup authorization ${authorizationId} not found` });
  }
  return row;
}

// ─── Scheduler sweep (ORCH registers in the bdcScheduler pattern) ────────────

/**
 * Mark all past-due authorizations 'expired' via a single guarded UPDATE
 * (only rows still 'pending' flip — the status guard makes re-runs safe).
 * Returns the number of rows expired.
 */
export async function sweepExpiredPickupAuthorizations(): Promise<number> {
  const db = await requireDb();
  const flipped = await db
    .update(bdcPickupAuthorizations)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(bdcPickupAuthorizations.status, "pending"),
        lt(bdcPickupAuthorizations.expiresAt, new Date()),
      ),
    )
    .returning({ id: bdcPickupAuthorizations.id });
  if (flipped.length > 0) {
    logger.info({ expired: flipped.length }, "[BDC pickup] expired stale authorizations");
  }
  return flipped.length;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcPickupRouter = router({
  /**
   * Customer authorizes a named third-party agent to collect cash (teller +
   * TOTP). Customer must be KYC-verified and not rescreen-blocked. The agent
   * ID number is secretBox-encrypted at rest (same helper as bvn_enc).
   */
  authorizePickup: auditedProcedure
    .input(z.object({
      customerId: z.number().int().positive(),
      agentFullName: z.string().min(2).max(255),
      agentIdType: z.enum(AGENT_ID_TYPES),
      agentIdNumber: z.string().min(4).max(64),
      relationship: z.string().min(2).max(64),
      maxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "maxAmount must be a major-unit amount").optional(),
      expiresInHours: z.number().int().min(1).max(72).default(24),
      idempotencyKey: z.string().min(8).max(96),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC agent pickup authorization");

      const [customer] = await db
        .select()
        .from(bdcCustomers)
        .where(and(eq(bdcCustomers.id, input.customerId), eq(bdcCustomers.tenantId, tenantId)))
        .limit(1);
      if (!customer) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Customer ${input.customerId} not found for this tenant` });
      }
      if (customer.kycStatus !== "verified") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Customer ${input.customerId} is not KYC-verified (status: ${customer.kycStatus ?? "unknown"})`,
        });
      }
      await assertCustomerNotRescreenBlockedInline(db, tenantId, input.customerId);

      const claimKey = `bdc:pickup:${tenantId}:${input.idempotencyKey}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      try {
        const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
        const [row] = await db
          .insert(bdcPickupAuthorizations)
          .values({
            tenantId,
            customerId: input.customerId,
            agentFullName: input.agentFullName,
            agentIdType: input.agentIdType,
            agentIdNumberEnc: encryptField(input.agentIdNumber),
            relationship: input.relationship,
            status: "pending",
            maxAmount: input.maxAmount ?? null,
            expiresAt,
            createdBy: ctx.user.id,
            idempotencyKey: input.idempotencyKey,
          })
          .returning();

        const result = {
          authorizationId: row.id,
          status: row.status,
          expiresAt: row.expiresAt,
          customerId: row.customerId,
          agentFullName: row.agentFullName,
          agentIdType: row.agentIdType,
          relationship: row.relationship,
          maxAmount: row.maxAmount,
        };
        storeIdempotency(claimKey, result);

        await createAuditLog({
          userId: ctx.user.id,
          action: "BDC_PICKUP_AUTHORIZED",
          targetType: "bdc_pickup_authorizations",
          targetId: row.id,
          description: `Pickup authorization ${row.id} created for customer ${input.customerId}, agent ${input.agentFullName} (${input.agentIdType})`,
          metadata: {
            tenantId,
            customerId: input.customerId,
            agentFullName: input.agentFullName,
            agentIdType: input.agentIdType,
            relationship: input.relationship,
            maxAmount: input.maxAmount ?? null,
            expiresAt: expiresAt.toISOString(),
          },
        });

        return result;
      } catch (err) {
        await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),

  /** Tenant-scoped list with customer/status filters; id-cursor pagination. */
  listAuthorizations: auditedProcedure
    .input(z.object({
      customerId: z.number().int().positive().optional(),
      status: z.enum(PICKUP_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const conditions = [eq(bdcPickupAuthorizations.tenantId, tenantId)];
      if (input.customerId) conditions.push(eq(bdcPickupAuthorizations.customerId, input.customerId));
      if (input.status) conditions.push(eq(bdcPickupAuthorizations.status, input.status));
      if (input.cursor) conditions.push(lt(bdcPickupAuthorizations.id, input.cursor));

      const rows = await db
        .select({
          id: bdcPickupAuthorizations.id,
          customerId: bdcPickupAuthorizations.customerId,
          txnId: bdcPickupAuthorizations.txnId,
          agentFullName: bdcPickupAuthorizations.agentFullName,
          agentIdType: bdcPickupAuthorizations.agentIdType,
          // agentIdNumberEnc is intentionally never returned by list/get APIs.
          relationship: bdcPickupAuthorizations.relationship,
          status: bdcPickupAuthorizations.status,
          maxAmount: bdcPickupAuthorizations.maxAmount,
          expiresAt: bdcPickupAuthorizations.expiresAt,
          usedAt: bdcPickupAuthorizations.usedAt,
          usedBy: bdcPickupAuthorizations.usedBy,
          createdBy: bdcPickupAuthorizations.createdBy,
          createdAt: bdcPickupAuthorizations.createdAt,
        })
        .from(bdcPickupAuthorizations)
        .where(and(...conditions))
        .orderBy(desc(bdcPickupAuthorizations.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    }),

  /** Managerial revoke (admin + TOTP): guarded single-winner pending→revoked. */
  revokeAuthorization: auditedAdminProcedure
    .input(z.object({
      authorizationId: z.number().int().positive(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC pickup authorization revoke");

      const existing = await loadAuthorization(db, tenantId, input.authorizationId);

      const flipped = await db
        .update(bdcPickupAuthorizations)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(
          and(
            eq(bdcPickupAuthorizations.id, input.authorizationId),
            eq(bdcPickupAuthorizations.tenantId, tenantId),
            eq(bdcPickupAuthorizations.status, "pending"),
          ),
        )
        .returning({ id: bdcPickupAuthorizations.id });
      if (flipped.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Authorization ${input.authorizationId} is not pending (current status '${existing.status}') — cannot revoke`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_PICKUP_REVOKED",
        targetType: "bdc_pickup_authorizations",
        targetId: input.authorizationId,
        description: `Pickup authorization ${input.authorizationId} revoked`,
        metadata: { tenantId, previousStatus: existing.status },
      });

      return { authorizationId: input.authorizationId, status: "revoked" as const };
    }),

  /**
   * Teller releases cash to the authorized agent (TOTP). Verifies the
   * authorization is pending + unexpired, the customer matches the
   * transaction, the amount is within max_amount, and the presented agent ID
   * matches the encrypted value (constant-time). Dual control: the maker of
   * the transaction may not execute its agent pickup. The pending→used flip
   * and the payment_leg jsonb annotation happen in ONE db.transaction.
   */
  executeAgentPickup: auditedProcedure
    .input(z.object({
      authorizationId: z.number().int().positive(),
      transactionId: z.number().int().positive(),
      agentIdNumber: z.string().min(4).max(64),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC agent pickup");

      const auth = await loadAuthorization(db, tenantId, input.authorizationId);
      if (auth.status !== "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Authorization ${input.authorizationId} is not pending (current status '${auth.status}')`,
        });
      }
      if (auth.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Authorization ${input.authorizationId} expired at ${auth.expiresAt.toISOString()} — a new authorization is required`,
        });
      }

      const [txn] = await db
        .select()
        .from(bdcTransactions)
        .where(and(eq(bdcTransactions.id, input.transactionId), eq(bdcTransactions.tenantId, tenantId)))
        .limit(1);
      if (!txn) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Transaction ${input.transactionId} not found for this tenant` });
      }
      if (txn.customerId !== auth.customerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Authorization ${input.authorizationId} belongs to customer ${auth.customerId}, not the customer on transaction ${input.transactionId}`,
        });
      }
      // Amount cap: compared against the FX amount (major units) in integer
      // cents — exact, no float rounding.
      if (auth.maxAmount !== null && toCents(txn.fxAmount) > toCents(auth.maxAmount)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Transaction amount ${txn.fxAmount} exceeds the authorization max of ${auth.maxAmount}`,
        });
      }
      if (!agentIdMatches(auth.agentIdNumberEnc, input.agentIdNumber)) {
        // Stateless fail: nothing is recorded or incremented against the agent.
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Presented agent ID does not match the authorization" });
      }
      // Dual control (maker ≠ checker): the teller who initiated the trade
      // cannot also release its cash to a third-party agent — a second user
      // must execute the pickup.
      if (txn.makerId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Dual-control violation: the maker of this transaction cannot execute its agent pickup — a second user must release the cash",
        });
      }

      // Deterministic tenant-prefixed claim: an authorization can only ever be
      // executed once, so the authorization id IS the natural idempotency key.
      const claimKey = `bdc:pickup-exec:${tenantId}:${input.authorizationId}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      try {
        const result = await db.transaction(async (tx: any) => {
          // Guarded single-winner flip pending→used (0 rows → CONFLICT).
          const flipped = await tx
            .update(bdcPickupAuthorizations)
            .set({
              status: "used",
              usedAt: new Date(),
              usedBy: ctx.user.id,
              txnId: input.transactionId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(bdcPickupAuthorizations.id, input.authorizationId),
                eq(bdcPickupAuthorizations.tenantId, tenantId),
                eq(bdcPickupAuthorizations.status, "pending"),
              ),
            )
            .returning({ id: bdcPickupAuthorizations.id });
          if (flipped.length === 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Authorization ${input.authorizationId} was already consumed by a concurrent execution`,
            });
          }

          // Annotate the transaction's payment_leg jsonb with the releasing
          // agent's details (jsonb — no schema change). The encrypted ID
          // number is never copied here.
          const pickupAgent = {
            name: auth.agentFullName,
            idType: auth.agentIdType,
            relationship: auth.relationship,
            authorizationId: auth.id,
            releasedByUserId: ctx.user.id,
          };
          await tx
            .update(bdcTransactions)
            .set({
              paymentLeg: sql`jsonb_set(coalesce(${bdcTransactions.paymentLeg}, '{}'::jsonb), '{pickupAgent}', ${JSON.stringify(pickupAgent)}::jsonb, true)`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(bdcTransactions.id, input.transactionId),
                eq(bdcTransactions.tenantId, tenantId),
              ),
            );

          return {
            authorizationId: auth.id,
            transactionId: input.transactionId,
            status: "used" as const,
            usedAt: new Date().toISOString(),
            usedBy: ctx.user.id,
            pickupAgent: { name: auth.agentFullName, idType: auth.agentIdType, relationship: auth.relationship },
          };
        });

        storeIdempotency(claimKey, result);

        await createAuditLog({
          userId: ctx.user.id,
          action: "BDC_PICKUP_EXECUTED",
          targetType: "bdc_pickup_authorizations",
          targetId: auth.id,
          description: `Agent ${auth.agentFullName} collected cash for transaction ${input.transactionId} (authorization ${auth.id})`,
          metadata: {
            tenantId,
            authorizationId: auth.id,
            transactionId: input.transactionId,
            customerId: auth.customerId,
            agentFullName: auth.agentFullName,
            agentIdType: auth.agentIdType,
            relationship: auth.relationship,
          },
        });

        return result;
      } catch (err) {
        // Failed execution must not permanently burn the idempotency claim.
        await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),
});
