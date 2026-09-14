/**
 * BDC sales.ts (B2) — over-the-counter buy/sell FX engine (SPEC-bdc §3.4).
 *
 * Funds-flow discipline (SPEC §0.5) on every money path:
 *   1. claimIdempotency (Redis SET NX PX single-winner) BEFORE any money
 *      movement; store unavailable → IdempotencyStoreUnavailableError
 *      propagates (fail closed).
 *   2. Guarded single-winner updates (`UPDATE ... WHERE status=:prev`
 *      → affected rows === 1, else conflict).
 *   3. Inventory + transaction row + TigerBeetle legs + PG ledger mirror in
 *      ONE db.transaction (TB failure → UNAVAILABLE → rollback).
 *   4. requireTotpStepUp on buyFx / sellFx / confirmNairaLeg /
 *      reverseTransaction.
 *   5. Honest states: rows stay 'pending' until confirmNairaLeg settles the
 *      naira leg — never 'completed' on assumption.
 *
 * Money columns are numeric(18,2) major units (orchestrator amendment);
 * all comparisons use integer cents via toCents() from ./_shared.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  bdcCustomers,
  bdcDenominationInventory,
  bdcRateQuotes,
  bdcSofDeclarations,
  bdcTellerDrawers,
  bdcTransactions,
} from "../../../drizzle/schema";
import { and, desc, eq, gt, gte, lt, isNull, or, sql } from "drizzle-orm";
import { claimIdempotency, storeIdempotency } from "../../middleware/coreAtomicity";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { resolveTenantContext } from "../../tenantMiddleware";
import { logger } from "../../_core/logger";
import {
  BDC_PURPOSE_CODES,
  toCents,
  getBdcProfile,
  assertBranchActive,
} from "./_shared";
import {
  postBuyFx,
  postSellFx,
  confirmLeg,
  reversePost,
  mirrorLegsToPg,
  type TbLegRecord,
} from "./_ledger";

// ─── Local helpers ────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function requireTenantId(userId: number): Promise<number> {
  const session = await resolveTenantContext(userId);
  if (session.tenantId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No tenant membership — BDC operations unavailable" });
  }
  return session.tenantId;
}

/** Integer cents → exact "major.minor" string for numeric(18,2) columns. */
function centsToMajor(cents: number | bigint): string {
  const v = BigInt(cents);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

const moneyAmount = z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,2})?$/)]);

const denominationSchema = z.object({
  denomination: moneyAmount, // face value per note, major units
  noteCount: z.number().int().min(1).max(100_000),
});

/** Sum of a denomination breakdown in integer cents. */
function denominationsTotalCents(items: Array<{ denomination: number | string; noteCount: number }>): number {
  return items.reduce((acc, d) => acc + toCents(d.denomination) * d.noteCount, 0);
}

/** Latest published (unexpired) quote for a currency+side — the dealing rate. */
async function currentPublishedRate(
  db: Awaited<ReturnType<typeof requireDb>>,
  tenantId: number,
  currency: string,
  side: "buy" | "sell",
): Promise<string> {
  const now = new Date();
  const [quote] = await db
    .select()
    .from(bdcRateQuotes)
    .where(
      and(
        eq(bdcRateQuotes.tenantId, tenantId),
        eq(bdcRateQuotes.currency, currency),
        eq(bdcRateQuotes.side, side),
        eq(bdcRateQuotes.status, "published"),
        or(isNull(bdcRateQuotes.expiresAt), gt(bdcRateQuotes.expiresAt, now)),
      ),
    )
    .orderBy(desc(bdcRateQuotes.publishedAt))
    .limit(1);
  if (!quote) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No published ${side} rate for ${currency} — dealer must publish a quote first`,
    });
  }
  return quote.rate;
}

/** Caller's active teller drawer at the branch (inventory location). */
async function requireTellerDrawer(
  db: Awaited<ReturnType<typeof requireDb>>,
  tenantId: number,
  branchId: number,
  userId: number,
): Promise<number> {
  const [drawer] = await db
    .select()
    .from(bdcTellerDrawers)
    .where(
      and(
        eq(bdcTellerDrawers.tenantId, tenantId),
        eq(bdcTellerDrawers.branchId, branchId),
        eq(bdcTellerDrawers.holderUserId, userId),
        eq(bdcTellerDrawers.status, "active"),
      ),
    )
    .limit(1);
  if (!drawer) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No active teller drawer for the caller at this branch",
    });
  }
  return drawer.id;
}

/**
 * Version-guarded denomination inventory mutation (atomic single statement;
 * the row lock serializes concurrent tellers and version is bumped for
 * optimistic-concurrency bookkeeping).
 *   direction 'credit' → notes in (buyFx); 'debit' → notes out (sellFx),
 *   guarded by note_count >= n (0 rows → INSUFFICIENT_STOCK).
 */
async function mutateInventory(
  tx: { execute: (q: unknown) => Promise<unknown> },
  params: {
    tenantId: number;
    locationType: "drawer" | "vault";
    locationId: number;
    currency: string;
    items: Array<{ denomination: number | string; noteCount: number }>;
    direction: "credit" | "debit";
  },
): Promise<void> {
  for (const item of params.items) {
    const denomStr = centsToMajor(toCents(item.denomination));
    if (params.direction === "credit") {
      // Race-safe upsert increment.
      const rows = (await tx.execute(sql`
        INSERT INTO bdc_denomination_inventory
          (tenant_id, location_type, location_id, currency, denomination, note_count, version, updated_at)
        VALUES
          (${params.tenantId}, ${params.locationType}, ${params.locationId}, ${params.currency}, ${denomStr}::numeric, ${item.noteCount}, 1, NOW())
        ON CONFLICT (tenant_id, location_type, location_id, currency, denomination)
        DO UPDATE SET note_count = bdc_denomination_inventory.note_count + ${item.noteCount},
                      version = bdc_denomination_inventory.version + 1,
                      updated_at = NOW()
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Inventory increment failed — retry" });
      }
    } else {
      const rows = (await tx.execute(sql`
        UPDATE bdc_denomination_inventory
        SET note_count = note_count - ${item.noteCount},
            version = version + 1,
            updated_at = NOW()
        WHERE tenant_id = ${params.tenantId}
          AND location_type = ${params.locationType}
          AND location_id = ${params.locationId}
          AND currency = ${params.currency}
          AND denomination = ${denomStr}::numeric
          AND note_count >= ${item.noteCount}
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `INSUFFICIENT_STOCK: not enough ${params.currency} ${denomStr} notes in the drawer`,
        });
      }
    }
  }
}

/** Tenant-scoped customer fetch + KYC gate shared by buyFx/sellFx. */
async function requireVerifiedCustomer(
  db: Awaited<ReturnType<typeof requireDb>>,
  tenantId: number,
  customerId: number,
) {
  const [customer] = await db
    .select()
    .from(bdcCustomers)
    .where(and(eq(bdcCustomers.id, customerId), eq(bdcCustomers.tenantId, tenantId)))
    .limit(1);
  if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "BDC customer not found" });
  if (customer.kycStatus !== "verified") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Customer KYC status is '${customer.kycStatus}' — must be 'verified' before dealing`,
    });
  }
  return customer;
}

const SOF_THRESHOLD_CENTS = 1_000_000; // $10,000.00
const CASH_METHOD_CAP_CENTS = 50_000; // $500.00

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcSalesRouter = router({
  /**
   * buyFx — BDC BUYS foreign currency from a walk-in customer (pays naira).
   * Flow: TOTP → profile/branch/customer gates → SoF gate (≥$10k) →
   * claimIdempotency(`BDC-BUY-${key}`) → db.transaction { guarded drawer
   * inventory credits, bdc_transactions 'pending', TB pending legs
   * DR FX_INVENTORY / CR CUSTOMER_PAYABLE + PG mirror } → confirmNairaLeg
   * settles (posts the pending legs).
   */
  buyFx: auditedProcedure
    .input(
      z.object({
        branchId: z.number().int().positive(),
        customerId: z.number().int().positive(),
        currency: z.string().length(3).toUpperCase(),
        fxAmount: moneyAmount,
        denominations: z.array(denominationSchema).min(1),
        paymentMethod: z.enum(["cash", "nip_transfer", "prepaid_card"]),
        paymentReference: z.string().max(96).nullish(),
        idempotencyKey: z.string().min(8).max(64),
        totpCode: z.string().optional(),
        sofSourceDescription: z.string().max(2000).optional(),
        sofDocumentRefs: z.array(z.string().max(255)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC FX purchase");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await assertBranchActive(db, tenantId, input.branchId);
      const customer = await requireVerifiedCustomer(db, tenantId, input.customerId);

      const fxCents = toCents(input.fxAmount);
      if (fxCents <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "fxAmount must be positive" });
      if (input.currency === "NGN") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "currency must be a foreign currency, not NGN" });
      }

      // Denomination breakdown must equal the FX amount handed over.
      if (denominationsTotalCents(input.denominations) !== fxCents) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Denomination breakdown does not sum to fxAmount",
        });
      }

      // Payment-method routing (CBN cash cap: cash only ≤ $500).
      if (input.paymentMethod === "cash" && fxCents > CASH_METHOD_CAP_CENTS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cash settlement is only allowed for FX purchases ≤ $500 — use nip_transfer",
        });
      }
      if (input.paymentMethod === "prepaid_card" && customer.customerType !== "non_resident") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "prepaid_card settlement is only available for non_resident customers",
        });
      }
      if (fxCents > CASH_METHOD_CAP_CENTS && input.paymentMethod !== "nip_transfer" && input.paymentMethod !== "prepaid_card") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "FX purchases above $500 must settle via nip_transfer" });
      }

      // Source-of-funds gate ≥ $10k: approved declaration within 30d required;
      // otherwise register a 'submitted' declaration and block WITHOUT moving money.
      if (fxCents >= SOF_THRESHOLD_CENTS) {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const approved = (await db.execute(sql`
          SELECT id FROM bdc_sof_declarations
          WHERE tenant_id = ${tenantId}
            AND customer_id = ${input.customerId}
            AND status = 'approved'
            AND COALESCE(reviewed_at, created_at) >= ${cutoff}
          LIMIT 1
        `)) as unknown as Array<{ id: number }>;
        if (approved.length === 0) {
          const [declaration] = await db
            .insert(bdcSofDeclarations)
            .values({
              tenantId,
              customerId: input.customerId,
              amountUsd: centsToMajor(fxCents),
              sourceDescription: input.sofSourceDescription ?? null,
              documentRefs: input.sofDocumentRefs ?? [],
              status: "submitted",
            })
            .returning();
          return {
            status: "PENDING_SOF" as const,
            declarationId: declaration.id,
            message: "FX purchases ≥ $10,000 require an approved source-of-funds declaration (submitted for review)",
          };
        }
      }

      const rate = await currentPublishedRate(db, tenantId, input.currency, "buy");
      const rateKobo = BigInt(toCents(rate));
      // naira kobo = fxCents * rateKobo / 100 (round-half-up, integer math).
      const nairaKobo = (BigInt(fxCents) * rateKobo + 50n) / 100n;

      const claimKey = `BDC-BUY-${input.idempotencyKey}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      const drawerId = await requireTellerDrawer(db, tenantId, input.branchId, ctx.user.id);

      const result = await db.transaction(async (tx) => {
        // 1. Guarded drawer inventory credits (FX notes received).
        await mutateInventory(tx, {
          tenantId,
          locationType: "drawer",
          locationId: drawerId,
          currency: input.currency,
          items: input.denominations,
          direction: "credit",
        });

        // 2. Transaction row — honest 'pending' until the naira leg confirms.
        const [txn] = await tx
          .insert(bdcTransactions)
          .values({
            tenantId,
            branchId: input.branchId,
            txnType: "buy_fx",
            currency: input.currency,
            fxAmount: centsToMajor(fxCents),
            nairaAmount: centsToMajor(nairaKobo),
            rate,
            purposeCode: null,
            evidenceRefs: [],
            customerId: input.customerId,
            paymentLeg: { method: input.paymentMethod, reference: input.paymentReference ?? null },
            cashPortion: input.paymentMethod === "cash" ? centsToMajor(nairaKobo) : "0.00",
            idempotencyKey: claimKey,
            tbTransferIds: [],
            status: "pending",
            makerId: ctx.user.id,
          })
          .returning();

        // 3. TigerBeetle two-phase legs (PENDING until confirmNairaLeg).
        const legs = await postBuyFx({
          tenantId,
          idempotencyKey: claimKey,
          currency: input.currency,
          fxMinor: BigInt(fxCents),
          nairaMinor: nairaKobo,
          nairaChannel: input.paymentMethod === "cash" ? "cash" : "bank",
        });
        await tx
          .update(bdcTransactions)
          .set({ tbTransferIds: legs as unknown as Record<string, unknown>[], updatedAt: new Date() })
          .where(eq(bdcTransactions.id, txn.id));

        // 4. PG mirror (ledger_entries) in the SAME transaction.
        await mirrorLegsToPg(tx, legs, {
          reference: claimKey,
          type: "bdc_buy_fx",
          tenantId,
          bdcTransactionId: txn.id,
        });

        return { status: "pending" as const, transactionId: txn.id, tbTransferIds: legs };
      });

      storeIdempotency(claimKey, result);
      return result;
    }),

  /**
   * sellFx — BDC SELLS foreign currency to a customer (receives naira).
   * Rules: purposeCode ∈ BDC_PURPOSE_CODES + evidenceRefs ≥ 1 (repatriation
   * needs a receipt ref); customer verified with a customerType; naira in via
   * nip_transfer (reference mandatory); cashPortion ≤ 25% of fxAmount;
   * balance disbursed via prepaid_card|domiciliary. Same posting discipline
   * (DR CUSTOMER_PAYABLE / CR FX_INVENTORY) with a TRMS-ready paymentLeg.
   */
  sellFx: auditedProcedure
    .input(
      z.object({
        branchId: z.number().int().positive(),
        customerId: z.number().int().positive(),
        currency: z.string().length(3).toUpperCase(),
        fxAmount: moneyAmount,
        purposeCode: z.string().max(32),
        evidenceRefs: z.array(z.string().max(255)).min(1).max(20),
        nipReference: z.string().min(4).max(96),
        cashPortion: moneyAmount.optional(),
        disbursementMethod: z.enum(["prepaid_card", "domiciliary"]),
        disbursementReference: z.string().max(96).nullish(),
        denominations: z.array(denominationSchema).optional(),
        idempotencyKey: z.string().min(8).max(64),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC FX sale");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await assertBranchActive(db, tenantId, input.branchId);
      const customer = await requireVerifiedCustomer(db, tenantId, input.customerId);

      // Eligibility engine: only individuals (a customerType must exist).
      if (!customer.customerType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Customer has no customerType (resident|non_resident) — non-individuals are not eligible for BDC FX sales",
        });
      }

      // Purpose code + documentary evidence (CBN PTA/BTA/... rules).
      if (!(BDC_PURPOSE_CODES as readonly string[]).includes(input.purposeCode)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `purposeCode must be one of ${BDC_PURPOSE_CODES.join(", ")}`,
        });
      }
      if (input.purposeCode === "NONRESIDENT_REPATRIATION") {
        const hasReceipt = input.evidenceRefs.some((r) => /receipt/i.test(r));
        if (!hasReceipt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "NONRESIDENT_REPATRIATION requires the original purchase receipt reference in evidenceRefs",
          });
        }
      }

      const fxCents = toCents(input.fxAmount);
      if (fxCents <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "fxAmount must be positive" });
      if (input.currency === "NGN") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "currency must be a foreign currency, not NGN" });
      }

      // Cash portion cap: ≤ 25% of the FX amount (integer-cents compare).
      const cashCents = input.cashPortion !== undefined ? toCents(input.cashPortion) : 0;
      if (cashCents * 4 > fxCents) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "cashPortion may not exceed 25% of fxAmount — the balance must go to prepaid_card/domiciliary",
        });
      }

      // Physical notes disbursed = cash portion (drawer decrement, guarded).
      const denominations = input.denominations ?? [];
      if (cashCents > 0) {
        if (denominations.length === 0 || denominationsTotalCents(denominations) !== cashCents) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "denominations are required and must sum to cashPortion when a cash portion is disbursed",
          });
        }
      } else if (denominations.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "denominations given but cashPortion is zero" });
      }

      const rate = await currentPublishedRate(db, tenantId, input.currency, "sell");
      const rateKobo = BigInt(toCents(rate));
      const nairaKobo = (BigInt(fxCents) * rateKobo + 50n) / 100n;

      const claimKey = `BDC-SELL-${input.idempotencyKey}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      const drawerId = await requireTellerDrawer(db, tenantId, input.branchId, ctx.user.id);

      const trmsFields = {
        purposeCode: input.purposeCode,
        evidenceRefs: input.evidenceRefs,
        customerType: customer.customerType,
        residency: customer.customerType === "non_resident" ? "non_resident" : "resident",
      };

      const result = await db.transaction(async (tx) => {
        // 1. Guarded drawer inventory debits (FX notes paid out as cash).
        if (denominations.length > 0) {
          await mutateInventory(tx, {
            tenantId,
            locationType: "drawer",
            locationId: drawerId,
            currency: input.currency,
            items: denominations,
            direction: "debit",
          });
        }

        // 2. Transaction row — TRMS-ready paymentLeg payload, honest 'pending'.
        const [txn] = await tx
          .insert(bdcTransactions)
          .values({
            tenantId,
            branchId: input.branchId,
            txnType: "sell_fx",
            currency: input.currency,
            fxAmount: centsToMajor(fxCents),
            nairaAmount: centsToMajor(nairaKobo),
            rate,
            purposeCode: input.purposeCode,
            evidenceRefs: input.evidenceRefs,
            customerId: input.customerId,
            paymentLeg: {
              method: "nip_transfer",
              reference: input.nipReference,
              disbursement: {
                method: input.disbursementMethod,
                reference: input.disbursementReference ?? null,
              },
              trmsFields,
            },
            cashPortion: centsToMajor(cashCents),
            idempotencyKey: claimKey,
            tbTransferIds: [],
            status: "pending",
            makerId: ctx.user.id,
          })
          .returning();

        // 3. TigerBeetle two-phase legs (PENDING until the naira in-leg confirms).
        const legs = await postSellFx({
          tenantId,
          idempotencyKey: claimKey,
          currency: input.currency,
          fxMinor: BigInt(fxCents),
          nairaMinor: nairaKobo,
          nairaChannel: "bank", // naira received via NIP transfer
        });
        await tx
          .update(bdcTransactions)
          .set({ tbTransferIds: legs as unknown as Record<string, unknown>[], updatedAt: new Date() })
          .where(eq(bdcTransactions.id, txn.id));

        // 4. PG mirror in the SAME transaction.
        await mirrorLegsToPg(tx, legs, {
          reference: claimKey,
          type: "bdc_sell_fx",
          tenantId,
          bdcTransactionId: txn.id,
        });

        return { status: "pending" as const, transactionId: txn.id, tbTransferIds: legs };
      });

      storeIdempotency(claimKey, result);
      return result;
    }),

  /**
   * confirmNairaLeg (admin / bank-callback) — settles a pending transaction
   * once the naira leg is confirmed externally. Guarded single-winner flip
   * pending→settled; posts the TB pending legs (two-phase commit) and mirrors
   * the post transfers.
   */
  confirmNairaLeg: auditedAdminProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        confirmationReference: z.string().max(96).optional(),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC naira-leg confirmation");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const claimKey = `BDC-CONFIRM-NAIRA-${input.transactionId}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      const result = await db.transaction(async (tx) => {
        // 1. Guarded single-winner flip pending → settled.
        const flipped = (await tx.execute(sql`
          UPDATE bdc_transactions
          SET status = 'settled', checker_id = ${ctx.user.id}, updated_at = NOW()
          WHERE id = ${input.transactionId} AND tenant_id = ${tenantId} AND status = 'pending'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        // Re-read via drizzle for camelCase mapping (raw RETURNING is snake_case).
        const [txn] = await tx
          .select()
          .from(bdcTransactions)
          .where(and(eq(bdcTransactions.id, input.transactionId), eq(bdcTransactions.tenantId, tenantId)))
          .limit(1);
        if (flipped.length !== 1) {
          if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "BDC transaction not found" });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Transaction is '${txn.status}' — only 'pending' transactions can be naira-confirmed`,
          });
        }

        // 2. Two-phase commit of every pending TB leg.
        const legs = (txn.tbTransferIds ?? []) as unknown as TbLegRecord[];
        const postedLegs: TbLegRecord[] = [];
        for (const leg of legs) {
          postedLegs.push(await confirmLeg(txn.idempotencyKey, leg));
        }

        // 3. Persist leg phases (+ optional confirmation reference).
        const paymentLeg = {
          ...((txn.paymentLeg ?? {}) as Record<string, unknown>),
          ...(input.confirmationReference ? { confirmationReference: input.confirmationReference } : {}),
        };
        await tx
          .update(bdcTransactions)
          .set({ tbTransferIds: postedLegs as unknown as Record<string, unknown>[], paymentLeg, updatedAt: new Date() })
          .where(eq(bdcTransactions.id, txn.id));

        // 4. Mirror the POST_PENDING transfers.
        const postMirrorLegs: TbLegRecord[] = postedLegs
          .filter((l) => l.postTransferId)
          .map((l) => ({ ...l, leg: `${l.leg}-post`, transferId: l.postTransferId! }));
        if (postMirrorLegs.length > 0) {
          await mirrorLegsToPg(tx, postMirrorLegs, {
            reference: txn.idempotencyKey,
            type: `bdc_${txn.txnType}_settle`,
            tenantId,
            bdcTransactionId: txn.id,
          });
        }

        return { status: "settled" as const, transactionId: txn.id, tbTransferIds: postedLegs };
      });

      storeIdempotency(claimKey, result);
      return result;
    }),

  /**
   * reverseTransaction (manager) — maker-checker reversal of a pending/posted
   * transaction: voids pending TB legs, books reversal transfers for posted
   * legs, flips status to 'reversed'. Settled transactions are blocked with a
   * clear error (orchestrator approval path — documented follow-up).
   */
  reverseTransaction: auditedProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        reason: z.string().min(4).max(500),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC transaction reversal");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const [txn] = await db
        .select()
        .from(bdcTransactions)
        .where(and(eq(bdcTransactions.id, input.transactionId), eq(bdcTransactions.tenantId, tenantId)))
        .limit(1);
      if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "BDC transaction not found" });

      // Maker-checker: the reverser must not be the maker.
      if (txn.makerId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Maker-checker violation: the maker cannot reverse their own transaction",
        });
      }
      if (txn.status === "settled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "settled transactions require orchestrator approval (follow-up)",
        });
      }
      if (txn.status !== "pending" && txn.status !== "posted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Transaction is already '${txn.status}' — nothing to reverse`,
        });
      }

      const claimKey = `BDC-REVERSE-${input.transactionId}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      const result = await db.transaction(async (tx) => {
        // 1. Guarded single-winner flip → 'reversed'.
        const flipped = (await tx.execute(sql`
          UPDATE bdc_transactions
          SET status = 'reversed', checker_id = ${ctx.user.id}, updated_at = NOW()
          WHERE id = ${input.transactionId} AND tenant_id = ${tenantId} AND status IN ('pending', 'posted')
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (flipped.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "Transaction status changed concurrently — retry" });
        }

        // 2. Reverse the TB legs (void pending / reverse posted).
        const legs = (txn.tbTransferIds ?? []) as unknown as TbLegRecord[];
        const reversedLegs = await reversePost(txn.idempotencyKey, legs);
        await tx
          .update(bdcTransactions)
          .set({ tbTransferIds: reversedLegs as unknown as Record<string, unknown>[], updatedAt: new Date() })
          .where(eq(bdcTransactions.id, txn.id));

        // 3. Mirror the reversal transfers (void + reversing entries).
        const reversalEntries = reversedLegs.filter((l) => l.phase === "reversal");
        if (reversalEntries.length > 0) {
          await mirrorLegsToPg(tx, reversalEntries, {
            reference: txn.idempotencyKey,
            type: `bdc_${txn.txnType}_reversal`,
            tenantId,
            bdcTransactionId: txn.id,
          });
        }

        logger.info(
          { transactionId: txn.id, reversedBy: ctx.user.id, makerId: txn.makerId, reason: input.reason },
          "[BDC sales] Transaction reversed",
        );
        return { status: "reversed" as const, transactionId: txn.id, tbTransferIds: reversedLegs };
      });

      storeIdempotency(claimKey, result);
      return result;
    }),

  /** getTransaction — tenant-scoped single fetch. */
  getTransaction: auditedProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const [txn] = await db
        .select()
        .from(bdcTransactions)
        .where(and(eq(bdcTransactions.id, input.transactionId), eq(bdcTransactions.tenantId, tenantId)))
        .limit(1);
      if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "BDC transaction not found" });
      return txn;
    }),

  /**
   * listTransactions — filters: branch / type / status / date range.
   * Cursor pagination per repo convention (numeric id cursor, desc order).
   */
  listTransactions: auditedProcedure
    .input(
      z.object({
        branchId: z.number().int().positive().optional(),
        txnType: z.enum(["buy_fx", "sell_fx", "imto_payout", "nfem_purchase", "nfem_return"]).optional(),
        status: z.enum(["pending", "posted", "settled", "failed", "reversed"]).optional(),
        dateFrom: z.coerce.date().optional(),
        dateTo: z.coerce.date().optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const conditions = [eq(bdcTransactions.tenantId, tenantId)];
      if (input.branchId) conditions.push(eq(bdcTransactions.branchId, input.branchId));
      if (input.txnType) conditions.push(eq(bdcTransactions.txnType, input.txnType));
      if (input.status) conditions.push(eq(bdcTransactions.status, input.status));
      if (input.dateFrom) conditions.push(gte(bdcTransactions.createdAt, input.dateFrom));
      if (input.dateTo) conditions.push(lt(bdcTransactions.createdAt, input.dateTo));
      if (input.cursor) conditions.push(lt(bdcTransactions.id, input.cursor));

      const rows = await db
        .select()
        .from(bdcTransactions)
        .where(and(...conditions))
        .orderBy(desc(bdcTransactions.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    }),
});
