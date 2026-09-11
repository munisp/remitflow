/**
 * W10-C1 / SPEC-wave10 — Vendor Bills router (AP core).
 *
 * Status machine (SPEC vocab, exact):
 *   captured → pending_approval → approved | rejected
 *   approved → scheduled → paying → paid | failed
 *   any → cancelled (pre-paying only)
 *
 * Guarantees:
 *   - Tenant-scoped everywhere (vendor_bills.tenant_id on every read/write).
 *   - idempotency_key UNIQUE + replay-safe: a replayed create returns the
 *     ORIGINAL record with replayed:true, never a duplicate.
 *   - TOTP step-up (canonical Wave-7 C2 pattern) on every money-moving or
 *     approval mutation: submitForApproval, schedule, executePayment,
 *     approve/reject.
 *   - executePayment: guarded wallet debit + platform-fee float credit in
 *     one db.transaction (mirrors lib/transferEngine.ts:556-662 + W9-Q4);
 *     TigerBeetle two-phase hold; Mojaloop FSP payout (fail closed when the
 *     switch is unreachable — status failed + reason, NEVER a fake ref);
 *     paying→paid ONLY on rail COMMITTED confirmation.
 *   - Speed tier via quoteSpeedTiers + speedTierFee; fee credited to the
 *     platform float (TIGERBEETLE_PLATFORM_USER_ID, default "0"); a failed
 *     fee leg aborts the whole payment.
 *   - Kafka `remitflow.vendor-bills` event on EVERY transition.
 *   - Feature gate: assertFeatureEligible({ minKycTier: 2, minPlan: "growth",
 *     featureName: "vendor_bills" }) on every procedure.
 *   - Auth: session first, Keycloak bearer fallback (alternative path).
 */
import { router, publicProcedure } from "../_core/trpc.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db.js";
import {
  approvalPolicies,
  approvalRequests,
  billDocuments,
  tenantUsers,
  users,
  vendorBills,
  vendors,
  type User,
  type VendorBill,
} from "../../drizzle/schema.js";
import { assertFeatureEligible } from "../_core/featureGuard.js";
import { quoteSpeedTiers, speedTierFee, type SpeedTier } from "../_core/speedTiers.js";
import { PLATFORM_SYSTEM_USER_ID, createPendingTransfer, postPendingTransfer, toMinorUnits, voidPendingTransfer } from "../_core/tigerBeetle.js";
import { pendingTransferIdFor, resolveTbTransferAccounts } from "../_core/transferPipeline.js";
import { publishEvent } from "../middleware/kafka.js";
import { logger } from "../_core/logger.js";
import { resolveTenantContext } from "../tenantMiddleware.js";
import { runWithTenantContext } from "../_core/tenantGuc.js";
import {
  decideStep,
  evaluateAndCreateRequest,
  getLatestRequestForEntity,
  getRequestWithSteps,
} from "../services/approvalEngine.js";

const TOPIC = "remitflow.vendor-bills";
const AP_APPROVAL_TIMEOUT_MS = Number(process.env.AP_APPROVAL_TIMEOUT_MS ?? 72 * 60 * 60 * 1000);

// ─── Auth: session first, Keycloak bearer fallback ────────────────────────────
/**
 * Alternative auth path (SPEC-wave10 C1): session auth remains primary; when
 * no session user exists, a Keycloak business-portal bearer token is verified
 * (authenticateBearer throws UNAVAILABLE when the verifier is unconfigured —
 * fail closed) and mapped to a local user. Tenant context is then resolved
 * exactly like the platform's tenantGucMiddleware (fail closed on error).
 */
const authedProcedure = publicProcedure.use(async (opts) => {
  const { ctx, next } = opts;
  let user: User | null = ctx.user ?? null;

  if (!user) {
    const authHeader = (ctx.req?.headers as Record<string, string | string[] | undefined> | undefined)?.authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (headerValue && headerValue.startsWith("Bearer ")) {
      const token = headerValue.slice("Bearer ".length).trim();
      if (token) {
        const { authenticateBearer } = await import("../_core/keycloakOidc.js");
        const userId = await authenticateBearer(token); // throws UNAVAILABLE when unconfigured
        if (userId != null) {
          const db = await getDb();
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
          const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
          user = row ?? null;
        }
      }
    }
  }

  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please log in (session or bearer token required)" });
  }

  let tenantId: number | null;
  try {
    const tenant = await resolveTenantContext(user.id);
    tenantId = tenant.tenantId;
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Tenant context resolution failed — request refused (fail-closed)",
      cause: err,
    });
  }

  return runWithTenantContext(
    { tenantId: tenantId == null ? null : String(tenantId), userId: String(user.id) },
    () => next({ ctx: { ...ctx, user: user as User, vendorBillTenantId: tenantId } }),
  );
});

type AuthedCtx = { user: User; vendorBillTenantId: number | null };

/** Vendor bills are tenant-scoped everywhere — no tenant context, no access. */
function requireTenant(ctx: AuthedCtx): number {
  if (ctx.vendorBillTenantId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No tenant context for this account — vendor bills are tenant-scoped",
    });
  }
  return ctx.vendorBillTenantId;
}

async function gate(ctx: AuthedCtx): Promise<void> {
  await assertFeatureEligible(ctx as never, { minKycTier: 2, minPlan: "growth", featureName: "vendor_bills" });
}

/** Canonical Wave-7 C2 TOTP step-up — fail closed on lookup errors. */
async function totpStepUp(userId: number, totpCode: string | undefined, actionLabel: string): Promise<void> {
  const { getTotpEnrollment, verifyTOTP } = await import("../totp.js");
  const enrollment = await getTotpEnrollment(userId);
  if (!enrollment.dbAvailable) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `2FA verification unavailable — ${actionLabel} blocked` });
  }
  if (enrollment.enabled && enrollment.secret) {
    if (!totpCode) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
    }
    const valid = await verifyTOTP(totpCode, enrollment.secret);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
    }
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

function emitBillEvent(eventType: string, key: string, payload: Record<string, unknown>): void {
  publishEvent(TOPIC, key, {
    eventType,
    ...payload,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), eventType }, "[VendorBills] Kafka event failed"),
  );
}

async function getTenantBill(billId: number, tenantId: number): Promise<VendorBill> {
  const db = await requireDb();
  const [bill] = await db
    .select()
    .from(vendorBills)
    .where(and(eq(vendorBills.id, billId), eq(vendorBills.tenantId, tenantId)))
    .limit(1);
  if (!bill) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor bill not found" });
  return bill;
}

interface MojaloopPayee {
  payeeFspId: string;
  payeeMsisdn: string;
}

/** Resolve the vendor's payout rail + payee details. Fail closed when incomplete. */
function resolvePayout(payoutMethod: unknown): { rail: string; mojaloop?: MojaloopPayee } {
  const pm = (payoutMethod ?? {}) as Record<string, unknown>;
  // M5 (audit): canonical keys are {rail, payeeFspId, payeeMsisdn}; rows
  // written before the vendors.ts contract was aligned used {type, fspId,
  // msisdn}. Dual-read — never break existing data.
  const rail = typeof pm.rail === "string" && pm.rail
    ? pm.rail
    : typeof pm.type === "string" && pm.type ? pm.type : "bank";
  if (rail === "mojaloop") {
    const payeeFspId = typeof pm.payeeFspId === "string" ? pm.payeeFspId
      : typeof pm.fspId === "string" ? pm.fspId : "";
    const payeeMsisdn = typeof pm.payeeMsisdn === "string" ? pm.payeeMsisdn
      : typeof pm.payeeId === "string" ? pm.payeeId
      : typeof pm.msisdn === "string" ? pm.msisdn : "";
    if (!payeeFspId || !payeeMsisdn) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Vendor mojaloop payout method is incomplete (payeeFspId/payeeMsisdn) — payment blocked",
      });
    }
    return { rail, mojaloop: { payeeFspId, payeeMsisdn } };
  }
  return { rail };
}

const totpInput = z.string().regex(/^\d{6}$/).optional();

// ─── Vendor Bills Router ──────────────────────────────────────────────────────
export const vendorBillsRouter = router({
  /** Create a bill (manual/api). Idempotent via idempotency_key. */
  create: authedProcedure
    .input(
      z.object({
        vendorId: z.number().int().positive(),
        amount: z.number().positive().max(100_000_000),
        currency: z.string().length(3),
        dueDate: z.string().datetime().optional(),
        billNumber: z.string().max(128).optional(),
        description: z.string().max(2000).optional(),
        idempotencyKey: z.string().min(8).max(128).optional(),
        source: z.enum(["manual", "api"]).default("manual"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gate(ctx as unknown as AuthedCtx);
      const tenantId = requireTenant(ctx as unknown as AuthedCtx);
      const db = await requireDb();

      // Vendor must belong to this tenant.
      const [vendor] = await db
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, tenantId)))
        .limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });

      // Replay-safe idempotency: return the ORIGINAL record for a replayed key.
      if (input.idempotencyKey) {
        const [existing] = await db
          .select()
          .from(vendorBills)
          .where(and(eq(vendorBills.idempotencyKey, input.idempotencyKey), eq(vendorBills.tenantId, tenantId)))
          .limit(1);
        if (existing) return { bill: existing, replayed: true };
      }

      let bill: VendorBill | undefined;
      try {
        const [row] = await db
          .insert(vendorBills)
          .values({
            tenantId,
            vendorId: input.vendorId,
            billNumber: input.billNumber ?? null,
            description: input.description ?? null,
            amount: input.amount.toFixed(4),
            currency: input.currency,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            status: "captured",
            source: input.source,
            idempotencyKey: input.idempotencyKey ?? null,
            createdBy: ctx.user.id,
          })
          .returning();
        bill = row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code;
        if (input.idempotencyKey && (code === "23505" || msg.includes("vendor_bills_idem_uidx") || msg.includes("duplicate key"))) {
          // Concurrent insert won the race — replay-safe return of the original.
          const [existing] = await db
            .select()
            .from(vendorBills)
            .where(and(eq(vendorBills.idempotencyKey, input.idempotencyKey), eq(vendorBills.tenantId, tenantId)))
            .limit(1);
          if (existing) return { bill: existing, replayed: true };
        }
        throw err;
      }
      if (!bill) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bill creation failed" });

      emitBillEvent("vendor_bill.created", `vendor-bill:${bill.id}:created`, {
        billId: bill.id,
        tenantId,
        vendorId: bill.vendorId,
        amount: input.amount,
        currency: input.currency,
        status: "captured",
        source: input.source,
        createdBy: ctx.user.id,
      });
      return { bill, replayed: false };
    }),

  /** List bills (tenant-scoped) with optional filters. */
  list: authedProcedure
    .input(
      z.object({
        status: z.enum(["captured", "pending_approval", "approved", "rejected", "scheduled", "paying", "paid", "failed", "cancelled"]).optional(),
        vendorId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      await gate(ctx as unknown as AuthedCtx);
      const tenantId = requireTenant(ctx as unknown as AuthedCtx);
      const db = await requireDb();
      const conditions = [eq(vendorBills.tenantId, tenantId)];
      if (input.status) conditions.push(eq(vendorBills.status, input.status));
      if (input.vendorId) conditions.push(eq(vendorBills.vendorId, input.vendorId));
      const rows = await db
        .select()
        .from(vendorBills)
        .where(and(...conditions))
        .orderBy(desc(vendorBills.id))
        .limit(input.limit)
        .offset(input.offset);
      return { bills: rows, count: rows.length };
    }),

  /** Get one bill with documents and its latest approval request. */
  get: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await gate(ctx as unknown as AuthedCtx);
      const tenantId = requireTenant(ctx as unknown as AuthedCtx);
      const db = await requireDb();
      const bill = await getTenantBill(input.id, tenantId);
      const documents = await db.select().from(billDocuments).where(eq(billDocuments.billId, bill.id));
      const approval = await getLatestRequestForEntity("vendor_bill", String(bill.id), tenantId);
      return { bill, documents, approvalRequest: approval };
    }),

  /** Upload a supporting document and enqueue OCR extraction (C3 pipeline). */
  uploadDocument: authedProcedure
    .input(
      z.object({
        billId: z.number().int().positive(),
        storageKey: z.string().min(1).max(512),
        mime: z.string().min(3).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gate(ctx as unknown as AuthedCtx);
      const tenantId = requireTenant(ctx as unknown as AuthedCtx);
      const db = await requireDb();
      const bill = await getTenantBill(input.billId, tenantId);
      if (bill.status !== "captured" && bill.status !== "pending_approval") {
        throw new TRPCError({ code: "CONFLICT", message: `Cannot attach documents to a bill in status ${bill.status}` });
      }

      const [doc] = await db
        .insert(billDocuments)
        .values({ billId: bill.id, storageKey: input.storageKey, mime: input.mime, uploadedBy: ctx.user.id })
        .returning();

      // Enqueue OCR via the bill-capture pipeline (C3 owns that module). OCR
      // is enrichment, not a money path: if the module/queue is unavailable
      // we warn and report ocrEnqueued:false — the document is still stored.
      let ocrEnqueued = false;
      try {
        const mod = (await import("./billCapture.js")) as { enqueueOcrJob?: (billId: number, storageKey: string) => Promise<unknown> };
        if (typeof mod.enqueueOcrJob === "function") {
          await mod.enqueueOcrJob(bill.id, input.storageKey);
          ocrEnqueued = true;
        }
      } catch (err) {
        logger.warn(
          { billId: bill.id, err: err instanceof Error ? err.message : String(err) },
          "[VendorBills] OCR enqueue unavailable (bill-capture pipeline not deployed) — document stored without OCR",
        );
      }

      emitBillEvent("vendor_bill.document_uploaded", `vendor-bill:${bill.id}:doc:${doc.id}`, {
        billId: bill.id,
        tenantId,
        documentId: doc.id,
        mime: input.mime,
        ocrEnqueued,
        uploadedBy: ctx.user.id,
      });
      return { document: doc, ocrEnqueued };
    }),

  /** Submit a captured bill for approval (creates request + sequential steps). */
  submitForApproval: authedProcedure
    .input(z.object({ billId: z.number().int().positive(), totpCode: totpInput }))
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      await totpStepUp(ctx.user.id, input.totpCode, "bill approval submission");
      const db = await requireDb();
      const bill = await getTenantBill(input.billId, tenantId);
      if (bill.status !== "captured") {
        throw new TRPCError({ code: "CONFLICT", message: `Bill is ${bill.status} — only captured bills can be submitted for approval` });
      }

      let requestId = 0;
      try {
        await db.transaction(async (tx: any) => {
          // Guarded flip: captured → pending_approval (single winner).
          const flip = (await tx.execute(sql`
            UPDATE vendor_bills SET status = 'pending_approval', updated_at = NOW()
            WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'captured'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (flip.length === 0) throw new Error("BILL_RACE_LOST");

          // Policy evaluation + request/steps in the SAME transaction (BLOCK throws → rollback).
          const created = await evaluateAndCreateRequest(
            {
              tenantId,
              entityType: "vendor_bill",
              entityId: String(bill.id),
              amount: Number(bill.amount),
              currency: bill.currency,
              createdBy: ctx.user.id,
            },
            tx,
          );
          requestId = created.requestId;
          await tx.execute(sql`
            UPDATE vendor_bills SET approval_request_id = ${requestId}, updated_at = NOW()
            WHERE id = ${bill.id}
          `);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "BILL_RACE_LOST") {
          throw new TRPCError({ code: "CONFLICT", message: "Bill status changed concurrently — submission aborted" });
        }
        throw err; // PRECONDITION_FAILED BLOCK from the engine propagates
      }

      // Best-effort approval-expiry orchestration (Temporal). Failure to start
      // does not block submission — the request simply has no auto-expiry.
      try {
        const { startApApprovalExpiry } = await import("../temporal/apApprovalWorkflow.js");
        await startApApprovalExpiry(requestId, AP_APPROVAL_TIMEOUT_MS);
      } catch (err) {
        logger.warn(
          { requestId, err: err instanceof Error ? err.message : String(err) },
          "[VendorBills] approval-expiry workflow unavailable — request will not auto-expire",
        );
      }

      emitBillEvent("vendor_bill.pending_approval", `vendor-bill:${bill.id}:pending_approval`, {
        billId: bill.id,
        tenantId,
        approvalRequestId: requestId,
        amount: Number(bill.amount),
        currency: bill.currency,
        submittedBy: ctx.user.id,
      });
      return { billId: bill.id, status: "pending_approval", approvalRequestId: requestId };
    }),

  /** Schedule an approved bill for payment at a future time. */
  schedule: authedProcedure
    .input(
      z.object({
        billId: z.number().int().positive(),
        scheduledAt: z.string().datetime(),
        speedTier: z.enum(["standard", "same_day", "instant"]).optional(),
        totpCode: totpInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      // Step-up: scheduling authorizes FUTURE money movement.
      await totpStepUp(ctx.user.id, input.totpCode, "bill payment scheduling");
      const db = await requireDb();
      const bill = await getTenantBill(input.billId, tenantId);
      if (bill.status !== "approved") {
        throw new TRPCError({ code: "CONFLICT", message: `Bill is ${bill.status} — only approved bills can be scheduled` });
      }

      // M5 (audit): tenant-scope the vendor read — a bill must never resolve a
      // payout rail from another tenant's vendor record (fail closed).
      const [vendor] = await db.select().from(vendors)
        .where(and(eq(vendors.id, bill.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
      const rail = resolvePayout(vendor.payoutMethod).rail;
      const tier = input.speedTier ?? (bill.speedTier as SpeedTier["tier"]) ?? "standard";
      // Validate the tier is real for this rail (throws → fail closed).
      speedTierFee(Number(bill.amount), rail, tier);

      const rows = (await db.execute(sql`
        UPDATE vendor_bills
        SET status = 'scheduled', scheduled_at = ${new Date(input.scheduledAt)}, speed_tier = ${tier}, payment_rail = ${rail}, updated_at = NOW()
        WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'approved'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Bill status changed concurrently — scheduling aborted" });
      }

      emitBillEvent("vendor_bill.scheduled", `vendor-bill:${bill.id}:scheduled`, {
        billId: bill.id,
        tenantId,
        scheduledAt: input.scheduledAt,
        speedTier: tier,
        rail,
        scheduledBy: ctx.user.id,
      });
      return { billId: bill.id, status: "scheduled", scheduledAt: input.scheduledAt, speedTier: tier, rail };
    }),

  /** Quote the available speed tiers + fees for a bill's rail. */
  quotePayment: authedProcedure
    .input(z.object({ billId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      const db = await requireDb();
      const bill = await getTenantBill(input.billId, tenantId);
      // M5 (audit): tenant-scope the vendor read (fail closed).
      const [vendor] = await db.select().from(vendors)
        .where(and(eq(vendors.id, bill.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
      const payout = resolvePayout(vendor.payoutMethod);
      const amount = Number(bill.amount);
      const tiers = quoteSpeedTiers(amount, bill.currency, payout.rail).map((t) => ({
        ...t,
        fee: Math.min(amount * t.feePct, t.feeCap),
      }));
      return { billId: bill.id, rail: payout.rail, amount, currency: bill.currency, tiers };
    }),

  /**
   * Execute payment for an approved/scheduled bill.
   * Flow (fail closed at every step):
   *   1. TOTP step-up.
   *   2. Resolve rail + speed-tier fee; unsupported rail/tier → PRECONDITION_FAILED
   *      BEFORE any money movement.
   *   3. TigerBeetle two-phase hold (user wallet → platform float pool).
   *   4. db.transaction: guarded bill flip → paying, guarded wallet debit of
   *      amount+fee, platform-fee float credit (W9-Q4, abort on failure),
   *      enum-safe transaction rows. Any throw → TB hold voided.
   *   5. Rail payout (Mojaloop FSP client). COMMITTED → post hold + paid with
   *      the REAL transfer ref. Definitive ABORTED (switch-provided only) →
   *      void hold + full wallet refund + failed+reason. UNCERTAIN outcome
   *      (network/timeout/circuit — the switch may have committed) → reconcile
   *      once via getTransferStatus; still unknown → park in `paying` with
   *      recon metadata for the settlement sweeper, NEVER a blind refund.
   *      NEVER a fabricated reference.
   */
  executePayment: authedProcedure
    .input(
      z.object({
        billId: z.number().int().positive(),
        speedTier: z.enum(["standard", "same_day", "instant"]).optional(),
        totpCode: totpInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      await totpStepUp(ctx.user.id, input.totpCode, "bill payment execution");
      const db = await requireDb();
      const bill = await getTenantBill(input.billId, tenantId);

      if (bill.status !== "approved" && bill.status !== "scheduled") {
        throw new TRPCError({ code: "CONFLICT", message: `Bill is ${bill.status} — only approved or scheduled bills can be paid` });
      }
      if (bill.status === "scheduled" && bill.scheduledAt && bill.scheduledAt.getTime() > Date.now()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Bill is scheduled for ${bill.scheduledAt.toISOString()} — not yet due` });
      }

      const [vendor] = await db
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, bill.vendorId), eq(vendors.tenantId, tenantId)))
        .limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });

      const payout = resolvePayout(vendor.payoutMethod);
      if (payout.rail !== "mojaloop") {
        // Fail closed: no payout client exists in this execution path for
        // stablecoin/bank rails yet — refuse BEFORE any money movement.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Payout rail "${payout.rail}" is not available for vendor bill payment — no confirmed rail client configured`,
        });
      }

      const amount = Number(bill.amount);
      const tier: SpeedTier["tier"] = input.speedTier ?? (bill.speedTier as SpeedTier["tier"]) ?? "standard";
      let fee: number;
      try {
        fee = speedTierFee(amount, payout.rail, tier);
      } catch (err) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: err instanceof Error ? err.message : "Speed tier unavailable for this rail",
        });
      }
      const total = amount + fee;

      // ── Step 3: TigerBeetle hold (wallet → float pool, two-phase) ─────────
      const holdRef = `vbill-${bill.id}-hold`;
      const holdId = pendingTransferIdFor(holdRef);
      try {
        const accounts = await resolveTbTransferAccounts(ctx.user.id, bill.currency);
        await createPendingTransfer({
          id: holdId,
          fromAccountId: accounts.debitAccountId,
          toAccountId: accounts.creditAccountId,
          amount: toMinorUnits(total.toFixed(2)),
          currency: bill.currency,
          code: 5, // vendor-bill payment hold
          timeoutSeconds: 3600,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ billId: bill.id, err: msg }, "[VendorBills] FAIL-CLOSED: TigerBeetle hold failed — payment aborted, nothing moved");
        if (msg.includes("Insufficient") || /"result":\s*(54|55)\b/.test(msg)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient funds for this payment (including concurrent pending holds)" });
        }
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Ledger hold unavailable — payment blocked: ${msg}` });
      }

      // ── Step 4: atomic flip + debit + fee credit (db.transaction) ─────────
      const paymentRef = `VBILL-${bill.id}`;
      try {
        await db.transaction(async (tx: any) => {
          // Guarded status flip approved|scheduled → paying.
          const flip = (await tx.execute(sql`
            UPDATE vendor_bills
            SET status = 'paying', payment_rail = ${payout.rail}, speed_tier = ${tier}, updated_at = NOW()
            WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status IN ('approved', 'scheduled')
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (flip.length === 0) throw new Error("BILL_RACE_LOST");

          // Guarded wallet debit of amount + fee (row-count checked).
          const debitRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = CAST(balance AS NUMERIC) - ${total.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${ctx.user.id}
              AND currency = ${bill.currency}
              AND status = 'active'
              AND CAST(balance AS NUMERIC) >= ${total.toFixed(2)}
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (debitRows.length === 0) throw new Error("INSUFFICIENT_BALANCE");

          // W9-Q4 platform-fee credit leg — guarded, abort on failure.
          if (fee > 0) {
            const floatWalletRows = (await tx.execute(sql`
              SELECT id FROM wallets
              WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID}
                AND currency = ${bill.currency}
                AND status = 'active'
              LIMIT 1
            `)) as unknown as Array<{ id: number }>;
            const floatWalletId = floatWalletRows[0]?.id;
            if (!floatWalletId) {
              throw new Error(`PLATFORM_FEE_CREDIT_FAILED: platform float wallet not provisioned for ${bill.currency}`);
            }
            const feeCreditRows = (await tx.execute(sql`
              UPDATE wallets
              SET balance = CAST(balance AS DECIMAL(18,4)) + ${fee.toFixed(4)}, "updatedAt" = NOW(), version = version + 1
              WHERE id = ${floatWalletId}
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (feeCreditRows.length === 0) {
              throw new Error("PLATFORM_FEE_CREDIT_FAILED: float wallet credit matched 0 rows");
            }
          }

          // Enum-safe transaction rows (tx_type: bill + fee; status: processing).
          await tx.execute(sql`
            INSERT INTO transactions ("userId", type, status, "fromCurrency", "fromAmount", fee, reference, description, metadata, "createdAt", "updatedAt")
            VALUES (${ctx.user.id}, 'bill', 'processing', ${bill.currency}, ${amount.toFixed(2)}, ${fee.toFixed(2)}, ${paymentRef}, ${`vendor bill #${bill.id} payment to vendor #${bill.vendorId}`}, ${JSON.stringify({ kind: "vendor_bill_payment", billId: bill.id, vendorId: bill.vendorId, rail: payout.rail, speedTier: tier })}, NOW(), NOW())
          `);
          if (fee > 0) {
            await tx.execute(sql`
              INSERT INTO transactions ("userId", type, status, "fromCurrency", "fromAmount", fee, reference, description, metadata, "createdAt", "updatedAt")
              VALUES (${ctx.user.id}, 'fee', 'completed', ${bill.currency}, ${fee.toFixed(2)}, ${fee.toFixed(2)}, ${`${paymentRef}-fee`}, ${`platform fee for ${paymentRef}`}, ${JSON.stringify({ kind: "platform fee", billId: bill.id, creditedTo: "platform_float", platformUserId: PLATFORM_SYSTEM_USER_ID, speedTier: tier })}, NOW(), NOW())
            `);
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Compensate the TB hold — the db.transaction rolled everything back.
        try {
          await voidPendingTransfer(pendingTransferIdFor(`${holdRef}-void`), holdId, bill.currency);
        } catch (voidErr) {
          logger.error(
            { billId: bill.id, holdRef, err: voidErr instanceof Error ? voidErr.message : String(voidErr) },
            "[VendorBills] CRITICAL: TB hold void failed after debit abort — hold will time out; MANUAL RECONCILIATION REQUIRED",
          );
        }
        if (msg === "INSUFFICIENT_BALANCE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient wallet balance" });
        }
        if (msg === "BILL_RACE_LOST") {
          throw new TRPCError({ code: "CONFLICT", message: "Bill status changed concurrently — payment aborted, no funds moved" });
        }
        if (msg.startsWith("PLATFORM_FEE_CREDIT_FAILED")) {
          logger.warn({ billId: bill.id, fee, currency: bill.currency, platformUserId: PLATFORM_SYSTEM_USER_ID, err: msg },
            "[VendorBills] Platform fee credit leg failed — payment aborted atomically, payer NOT debited");
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Platform fee settlement unavailable — payment blocked" });
        }
        logger.error({ billId: bill.id, err: msg }, "[VendorBills] Payment persistence failed atomically — no funds moved");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payment failed — no funds moved" });
      }

      emitBillEvent("vendor_bill.paying", `vendor-bill:${bill.id}:paying`, {
        billId: bill.id,
        tenantId,
        amount,
        fee,
        total,
        currency: bill.currency,
        rail: payout.rail,
        speedTier: tier,
        executedBy: ctx.user.id,
      });

      // ── Step 5: Mojaloop payout (fail closed — never a fake ref) ──────────
      let railTransferId: string | null = null;
      let railConfirmed = false;
      let railFailureReason: string | null = null;
      // H3 (audit): an UNCERTAIN rail outcome (network/timeout/circuit/5xx —
      // the switch may have committed) is NEVER refunded/voided blindly. It is
      // reconciled once via getTransferStatus; if still unknown the bill is
      // parked in `paying` for the settlement sweeper.
      let railUncertain = false;
      let railUncertainDetail: string | null = null;
      try {
        const { requestQuote, initiateTransfer, buildIlpPacket, getTransferStatus } = await import("../mojaloop.service.js");
        const payerMsisdn = ctx.user.phone ?? ctx.user.openId;
        let ilpPacket: string | undefined;
        let condition: string | undefined;
        try {
          const quote = await requestQuote({
            payerMsisdn,
            payeeMsisdn: payout.mojaloop!.payeeMsisdn,
            payerFspId: "remitflow-fsp",
            payeeFspId: payout.mojaloop!.payeeFspId,
            amount: amount.toFixed(2),
            currency: bill.currency,
            note: `vendor bill #${bill.id}`,
          });
          ilpPacket = quote.ilpPacket;
          condition = quote.condition;
        } catch (quoteErr) {
          logger.warn({ billId: bill.id, err: quoteErr instanceof Error ? quoteErr.message : String(quoteErr) },
            "[VendorBills] Mojaloop quote failed — building ILP packet locally before transfer attempt");
        }
        if (!ilpPacket || !condition) {
          const built = buildIlpPacket({
            amount: amount.toFixed(2),
            currency: bill.currency,
            destinationFspId: payout.mojaloop!.payeeFspId,
            destinationAccount: payout.mojaloop!.payeeMsisdn,
          });
          ilpPacket = built.ilpPacket;
          condition = built.condition;
        }
        const result = await initiateTransfer({
          payerFspId: "remitflow-fsp",
          payeeFspId: payout.mojaloop!.payeeFspId,
          amount: amount.toFixed(2),
          currency: bill.currency,
          ilpPacket,
          condition,
          expirationSeconds: 60,
        });
        railTransferId = result.transferId; // REAL rail reference (client-generated id — identifies, never confirms)
        if (result.transferState === "COMMITTED") {
          railConfirmed = true;
        } else if (result.transferState === "ABORTED") {
          // Definitive abort — only ever a switch-provided state/error.
          railFailureReason = `mojaloop transfer aborted by switch${
            result.errorInformation ? `: ${result.errorInformation.errorCode} ${result.errorInformation.errorDescription}` : ""
          }`;
        } else {
          // UNCERTAIN / RECEIVED / RESERVED — outcome unknown or async. H3:
          // reconcile ONCE against the switch before deciding.
          let reconState = "query_failed";
          try {
            const recon = await getTransferStatus(result.transferId);
            reconState = recon.transferState;
            if (recon.transferState === "COMMITTED") {
              railConfirmed = true;
            } else if (recon.transferState === "ABORTED") {
              railFailureReason = `mojaloop transfer aborted by switch (reconciled)${
                recon.errorInformation ? `: ${recon.errorInformation.errorCode} ${recon.errorInformation.errorDescription}` : ""
              }`;
            }
          } catch { /* reconciliation query itself failed — stays uncertain */ }
          if (!railConfirmed && !railFailureReason) {
            railUncertain = true;
            railUncertainDetail = `mojaloop outcome uncertain (initial state ${result.transferState}, reconciliation ${reconState}) — parked pending settlement-sweeper reconciliation; hold and debit left intact`;
          }
        }
      } catch (err) {
        // Throws are PRE-SEND only (packet build / FSPIOP signing); network
        // failures around the POST come back as UNCERTAIN, never thrown.
        railFailureReason = `mojaloop payout failed before submission: ${err instanceof Error ? err.message : String(err)}`;
      }

      // True when the rail COMMITTED — funds genuinely disbursed to the vendor
      // regardless of what our local ledger does afterwards.
      let disbursedByRail = false;
      if (railConfirmed && railTransferId) {
        // Post the TB hold (settle wallet → float pool) and mark paid.
        try {
          await postPendingTransfer(pendingTransferIdFor(`${holdRef}-post`), holdId, toMinorUnits(total.toFixed(2)), bill.currency);
        } catch (postErr) {
          // The rail CONFIRMED but the ledger post failed — the vendor WAS
          // paid. Do NOT refund and do NOT void: the debit must stand and the
          // discrepancy is a manual-reconciliation item with the real rail ref.
          disbursedByRail = true;
          logger.error({ billId: bill.id, railTransferId, err: postErr instanceof Error ? postErr.message : String(postErr) },
            "[VendorBills] CRITICAL: rail COMMITTED but TigerBeetle post failed — funds disbursed, debit stands, MANUAL RECONCILIATION REQUIRED");
          railConfirmed = false;
          railFailureReason = `rail confirmed payout (ref ${railTransferId}) but ledger settlement failed — funds disbursed, manual reconciliation required`;
        }
      }

      if (railConfirmed && railTransferId) {
        await db.transaction(async (tx: any) => {
          const paidRows = (await tx.execute(sql`
            UPDATE vendor_bills
            SET status = 'paid', paid_at = NOW(), payment_ref = ${railTransferId}, updated_at = NOW()
            WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'paying'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (paidRows.length === 0) throw new Error("PAID_FLIP_FAILED");
          await tx.execute(sql`
            UPDATE transactions SET status = 'completed', "updatedAt" = NOW()
            WHERE reference = ${paymentRef} AND type = 'bill' AND status = 'processing'
          `);
        });
        emitBillEvent("vendor_bill.paid", `vendor-bill:${bill.id}:paid`, {
          billId: bill.id,
          tenantId,
          amount,
          fee,
          currency: bill.currency,
          rail: payout.rail,
          speedTier: tier,
          paymentRef: railTransferId,
          paidAt: new Date().toISOString(),
        });
        return { billId: bill.id, status: "paid", paymentRef: railTransferId, amount, fee, total, speedTier: tier, rail: payout.rail };
      }

      // ── H3 (audit): UNCERTAIN outcome — park honestly, NEVER refund/void ───
      // The switch may have committed. Refunding here could double-spend; the
      // bill stays `paying` with reconciliation metadata and the payout
      // settlement sweeper resolves it against the rail.
      if (railUncertain && railTransferId) {
        const reconMeta = {
          railUncertain: true,
          transferId: railTransferId,
          payerUserId: ctx.user.id,
          fee,
          detail: railUncertainDetail,
          detectedAt: new Date().toISOString(),
        };
        await db.execute(sql`
          UPDATE vendor_bills
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(reconMeta)}::jsonb,
              updated_at = NOW()
          WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'paying'
        `).catch((e: unknown) =>
          logger.error({ billId: bill.id, err: e instanceof Error ? e.message : String(e) },
            "[VendorBills] CRITICAL: could not persist rail-uncertain reconciliation metadata — MANUAL RECONCILIATION REQUIRED"),
        );
        logger.error(
          { billId: bill.id, transferId: railTransferId, detail: railUncertainDetail },
          "[VendorBills] CRITICAL: rail outcome UNCERTAIN — bill parked in paying, TB hold + wallet debit left intact, NO refund issued; settlement sweeper will reconcile",
        );
        emitBillEvent("vendor_bill.payment_uncertain", `vendor-bill:${bill.id}:uncertain`, {
          billId: bill.id,
          tenantId,
          amount,
          fee,
          currency: bill.currency,
          rail: payout.rail,
          transferId: railTransferId,
          detail: railUncertainDetail,
        });
        return {
          billId: bill.id,
          status: "paying",
          paymentState: "uncertain_pending_reconciliation",
          transferId: railTransferId,
          detail: railUncertainDetail,
          amount, fee, total, speedTier: tier, rail: payout.rail,
        };
      }

      // ── Failure path: void hold + full refund + honest failed status ───────
      const reason = railFailureReason ?? "payout failed without a rail confirmation";
      if (disbursedByRail) {
        // Rail committed but ledger settlement failed: funds ARE with the
        // vendor. Refunding or voiding here would double-spend. Mark failed
        // with the reconciliation reason and keep the debit + hold intact.
        await db.execute(sql`
          UPDATE vendor_bills
          SET status = 'failed', failure_reason = ${reason}, payment_ref = ${railTransferId}, updated_at = NOW()
          WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'paying'
        `).catch((e: unknown) =>
          logger.error({ billId: bill.id, err: e instanceof Error ? e.message : String(e) },
            "[VendorBills] CRITICAL: could not mark disbursed bill failed — MANUAL RECONCILIATION REQUIRED"),
        );
        emitBillEvent("vendor_bill.failed", `vendor-bill:${bill.id}:failed`, {
          billId: bill.id,
          tenantId,
          amount,
          fee,
          currency: bill.currency,
          rail: payout.rail,
          reason,
          refundOk: false,
          disbursedByRail: true,
          paymentRef: railTransferId,
        });
        return { billId: bill.id, status: "failed", failureReason: reason, refundOk: false, disbursedByRail: true, paymentRef: railTransferId, amount, fee, total, speedTier: tier, rail: payout.rail };
      }
      try {
        await voidPendingTransfer(pendingTransferIdFor(`${holdRef}-void`), holdId, bill.currency);
      } catch (voidErr) {
        logger.error({ billId: bill.id, holdRef, err: voidErr instanceof Error ? voidErr.message : String(voidErr) },
          "[VendorBills] CRITICAL: TB hold void failed on payout failure — hold will time out; MANUAL RECONCILIATION REQUIRED");
      }
      let refundOk = true;
      try {
        await db.transaction(async (tx: any) => {
          // Refund amount + fee to the payer (guarded wallet must exist).
          const refundRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = CAST(balance AS NUMERIC) + ${total.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${ctx.user.id} AND currency = ${bill.currency} AND status = 'active'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (refundRows.length === 0) throw new Error("REFUND_WALLET_UNAVAILABLE");
          // Reverse the platform-fee leg (guarded — we credited it above).
          if (fee > 0) {
            const floatDebit = (await tx.execute(sql`
              UPDATE wallets
              SET balance = CAST(balance AS DECIMAL(18,4)) - ${fee.toFixed(4)}, "updatedAt" = NOW(), version = version + 1
              WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID}
                AND currency = ${bill.currency}
                AND status = 'active'
                AND CAST(balance AS DECIMAL(18,4)) >= ${fee.toFixed(4)}
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (floatDebit.length === 0) throw new Error("FLOAT_FEE_REVERSAL_FAILED");
          }
          const failRows = (await tx.execute(sql`
            UPDATE vendor_bills
            SET status = 'failed', failure_reason = ${reason}, updated_at = NOW()
            WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'paying'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (failRows.length === 0) throw new Error("FAILED_FLIP_FAILED");
          await tx.execute(sql`
            UPDATE transactions SET status = 'failed', "updatedAt" = NOW()
            WHERE reference = ${paymentRef} AND type = 'bill' AND status = 'processing'
          `);
          if (fee > 0) {
            await tx.execute(sql`
              UPDATE transactions SET status = 'reversed', "updatedAt" = NOW()
              WHERE reference = ${`${paymentRef}-fee`} AND type = 'fee' AND status = 'completed'
            `);
          }
        });
      } catch (refundErr) {
        refundOk = false;
        logger.error(
          { billId: bill.id, err: refundErr instanceof Error ? refundErr.message : String(refundErr), total, currency: bill.currency },
          "[VendorBills] CRITICAL: wallet refund failed after payout failure — MANUAL RECONCILIATION REQUIRED",
        );
        // Honest status even here: mark failed with the refund failure noted.
        await db.execute(sql`
          UPDATE vendor_bills
          SET status = 'failed', failure_reason = ${`${reason}; wallet refund FAILED — manual reconciliation required`}, updated_at = NOW()
          WHERE id = ${bill.id} AND tenant_id = ${tenantId} AND status = 'paying'
        `).catch((e: unknown) =>
          logger.error({ billId: bill.id, err: e instanceof Error ? e.message : String(e) },
            "[VendorBills] CRITICAL: could not even mark bill failed — MANUAL RECONCILIATION REQUIRED"),
        );
      }

      emitBillEvent("vendor_bill.failed", `vendor-bill:${bill.id}:failed`, {
        billId: bill.id,
        tenantId,
        amount,
        fee,
        currency: bill.currency,
        rail: payout.rail,
        reason,
        refundOk,
      });
      return { billId: bill.id, status: "failed", failureReason: reason, refundOk, amount, fee, total, speedTier: tier, rail: payout.rail };
    }),

  /** Cancel a bill — pre-paying statuses only. */
  cancel: authedProcedure
    .input(z.object({ billId: z.number().int().positive(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      const db = await requireDb();
      const bill = await getTenantBill(input.billId, tenantId);

      let cancelledApprovalRequest = false;
      await db.transaction(async (tx: any) => {
        const rows = (await tx.execute(sql`
          UPDATE vendor_bills
          SET status = 'cancelled',
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancelReason', ${input.reason ?? null}),
              updated_at = NOW()
          WHERE id = ${bill.id} AND tenant_id = ${tenantId}
            AND status IN ('captured', 'pending_approval', 'approved', 'scheduled')
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (rows.length === 0) throw new Error("CANCEL_RACE_LOST");

        // A pending approval request for this bill is rejected by the cancel.
        if (bill.approvalRequestId) {
          const reqRows = (await tx.execute(sql`
            UPDATE approval_requests
            SET status = 'rejected', decided_by = ${ctx.user.id}, decided_at = NOW(), updated_at = NOW()
            WHERE id = ${bill.approvalRequestId} AND tenant_id = ${tenantId} AND status = 'pending'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          cancelledApprovalRequest = reqRows.length > 0;
        }
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "CANCEL_RACE_LOST") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Bill is ${bill.status} — only pre-paying bills (captured/pending_approval/approved/scheduled) can be cancelled`,
          });
        }
        throw err;
      });

      emitBillEvent("vendor_bill.cancelled", `vendor-bill:${bill.id}:cancelled`, {
        billId: bill.id,
        tenantId,
        previousStatus: bill.status,
        reason: input.reason ?? null,
        cancelledApprovalRequest,
        cancelledBy: ctx.user.id,
      });
      return { billId: bill.id, status: "cancelled", cancelledApprovalRequest };
    }),
});

// ─── Approval Policies & Requests Router ──────────────────────────────────────
/** Policy management requires platform admin or a tenant admin/owner role. */
async function requirePolicyAdmin(ctx: AuthedCtx, tenantId: number): Promise<void> {
  if (ctx.user.role === "admin") return;
  const db = await requireDb();
  const [membership] = await db
    .select({ role: tenantUsers.role })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, ctx.user.id)))
    .limit(1);
  const role = membership?.role ?? "member";
  if (role !== "admin" && role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Approval policy management requires a tenant admin/owner role" });
  }
}

export const approvalPoliciesRouter = router({
  /** Create an approval policy (tenant-scoped). */
  createPolicy: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        scope: z.enum(["vendor_bill"]).default("vendor_bill"),
        minAmount: z.number().min(0).max(1_000_000_000).default(0),
        currency: z.string().length(3).optional(),
        requiredApprovals: z.number().int().min(1).max(10).default(1),
        approverUserIds: z.array(z.number().int().positive()).min(1).max(50),
        approverRoles: z.array(z.enum(["admin", "user", "partner"])).max(10).optional(),
        allowSelfApproval: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      await requirePolicyAdmin(actx, tenantId);
      const db = await requireDb();

      const [policy] = await db
        .insert(approvalPolicies)
        .values({
          tenantId,
          name: input.name,
          scope: input.scope,
          minAmount: input.minAmount.toFixed(4),
          currency: input.currency ?? null,
          requiredApprovals: input.requiredApprovals,
          approverUserIds: input.approverUserIds,
          approverRoles: input.approverRoles ?? [],
          allowSelfApproval: input.allowSelfApproval,
          active: true,
          createdBy: ctx.user.id,
        })
        .returning();

      emitBillEvent("approval.policy.created", `approval-policy:${policy.id}:created`, {
        policyId: policy.id,
        tenantId,
        name: input.name,
        scope: input.scope,
        minAmount: input.minAmount,
        requiredApprovals: input.requiredApprovals,
        createdBy: ctx.user.id,
      });
      return { policy };
    }),

  /** List approval policies (tenant-scoped). */
  listPolicies: authedProcedure
    .input(z.object({ activeOnly: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      const db = await requireDb();
      const conditions = [eq(approvalPolicies.tenantId, tenantId)];
      if (input.activeOnly) conditions.push(eq(approvalPolicies.active, true));
      const rows = await db
        .select()
        .from(approvalPolicies)
        .where(and(...conditions))
        .orderBy(desc(approvalPolicies.id));
      return { policies: rows };
    }),

  /** Activate/deactivate a policy (tenant-scoped, admin). */
  setPolicyActive: authedProcedure
    .input(z.object({ policyId: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      await requirePolicyAdmin(actx, tenantId);
      const db = await requireDb();
      const [updated] = await db
        .update(approvalPolicies)
        .set({ active: input.active, updatedAt: new Date() })
        .where(and(eq(approvalPolicies.id, input.policyId), eq(approvalPolicies.tenantId, tenantId)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Approval policy not found" });
      emitBillEvent("approval.policy.updated", `approval-policy:${input.policyId}:${input.active ? "activated" : "deactivated"}`, {
        policyId: input.policyId,
        tenantId,
        active: input.active,
        updatedBy: ctx.user.id,
      });
      return { policy: updated };
    }),

  /** List approval requests (tenant-scoped). */
  listRequests: authedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      const db = await requireDb();
      const conditions = [eq(approvalRequests.tenantId, tenantId)];
      if (input.status) conditions.push(eq(approvalRequests.status, input.status));
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(and(...conditions))
        .orderBy(desc(approvalRequests.id))
        .limit(input.limit)
        .offset(input.offset);
      return { requests: rows };
    }),

  /** Get one approval request with its steps (tenant-scoped). */
  getRequest: authedProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      const result = await getRequestWithSteps(input.requestId, tenantId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
      return result;
    }),

  /** Approve the current step (TOTP step-up + designated approver + Permify). */
  approve: authedProcedure
    .input(z.object({ requestId: z.number().int().positive(), comment: z.string().max(1000).optional(), totpCode: totpInput }))
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      await totpStepUp(ctx.user.id, input.totpCode, "approval decision");
      return decideStep({
        requestId: input.requestId,
        tenantId,
        approverUserId: ctx.user.id,
        decision: "approved",
        comment: input.comment,
      });
    }),

  /** Reject the current step (TOTP step-up + designated approver + Permify). */
  reject: authedProcedure
    .input(z.object({ requestId: z.number().int().positive(), comment: z.string().max(1000).optional(), totpCode: totpInput }))
    .mutation(async ({ ctx, input }) => {
      const actx = ctx as unknown as AuthedCtx;
      await gate(actx);
      const tenantId = requireTenant(actx);
      await totpStepUp(ctx.user.id, input.totpCode, "approval decision");
      return decideStep({
        requestId: input.requestId,
        tenantId,
        approverUserId: ctx.user.id,
        decision: "rejected",
        comment: input.comment,
      });
    }),
});
