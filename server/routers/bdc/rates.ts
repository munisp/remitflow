/**
 * BDC rate governance router (B1) — SPEC §3.3.
 *
 * Procedures:
 *   setBand        dealer/admin + TOTP; upsert the active band per currency
 *                  (previous active bands for the currency are deactivated)
 *   createQuote    dealer; draft quote; |rate − reference| ≤ bandBps of the
 *                  active band else BAD_REQUEST. Reference = latest
 *                  fetchLiveRates rate (server/fx-rates.service.ts); on outage
 *                  → UNAVAILABLE (fail closed, SPEC §0.3)
 *   publishQuote   dealer + TOTP; checkerId = caller; REJECTS caller === makerId
 *                  (maker-checker); expiresAt = +4h default, +15min volatility
 *                  mode when any quote published for the currency in the last
 *                  hour deviated >2× bandBps (documented simple rule)
 *   expireStale    cron-callable admin; bulk-expire published quotes past expiresAt
 *   currentBoard   latest published buy+sell per currency (tenant-wide, with
 *                  branch-specific quotes taking precedence when branchId given)
 *   crossQuote     two-leg quote via naira mid (buy fromCcy leg + sell toCcy
 *                  leg, each returned with its own band/compliance params)
 *
 * Rate semantics: rate/referenceRate are numeric(18,2) naira per 1 FX unit.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { auditedAdminProcedure, auditedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { fetchLiveRates } from "../../fx-rates.service";
import {
  bdcBranches,
  bdcRateBands,
  bdcRateQuotes,
  type BdcRateBand,
  type BdcRateQuote,
} from "../../../drizzle/schema";

// ─── Local helpers ────────────────────────────────────────────────────────────

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

/** Fail-closed DB handle (SPEC §0.3). */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "UNAVAILABLE", message: "Database unavailable — request refused (fail-closed)" });
  }
  return db;
}

const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "ISO 4217 currency code")
  .transform((s) => s.toUpperCase());
const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Expected a positive numeric(18,2) amount");
const totpCodeSchema = z.string().regex(/^\d{6}$/, "TOTP code must be 6 digits").optional();

/**
 * Reference rate (naira per 1 unit of `currency`) from the existing FX rate
 * service. FAIL CLOSED: when every live source is down and fetchLiveRates fell
 * back to its static table (source starts with "static-fallback" and no live
 * gRPC override), we refuse with UNAVAILABLE rather than publish against a
 * fabricated reference (SPEC §0.3/§3.3).
 */
async function referenceNairaPerUnit(currency: string): Promise<{ reference: number; source: string }> {
  const { rates, source } = await fetchLiveRates("USD"); // rates: units per 1 USD
  const liveOverride = source.includes("+grpc");
  if (source.startsWith("static-fallback") && !liveOverride) {
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Live FX reference rate unavailable — quote refused (fail-closed)",
    });
  }
  const ngnPerUsd = rates["NGN"];
  const ccyPerUsd = rates[currency];
  if (ngnPerUsd == null || ccyPerUsd == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unsupported currency for reference rates: ${currency}`,
    });
  }
  return { reference: ngnPerUsd / ccyPerUsd, source };
}

/** Active band for (tenant, currency), most recent first. Null when unset. */
async function activeBand(db: any, tenantId: number, currency: string): Promise<BdcRateBand | null> {
  const rows = (await db
    .select()
    .from(bdcRateBands)
    .where(and(eq(bdcRateBands.tenantId, tenantId), eq(bdcRateBands.currency, currency), eq(bdcRateBands.active, true)))
    .orderBy(desc(bdcRateBands.id))
    .limit(1)) as BdcRateBand[];
  return rows[0] ?? null;
}

/** Deviation of `rate` from `reference` in basis points (float comparison only). */
function deviationBps(rate: number, reference: number): number {
  if (reference === 0) return Number.POSITIVE_INFINITY;
  return (Math.abs(rate - reference) * 10_000) / reference;
}

const DEFAULT_QUOTE_TTL_MS = 4 * 60 * 60 * 1000; // 4h
const VOLATILE_QUOTE_TTL_MS = 15 * 60 * 1000; // 15min
const VOLATILITY_WINDOW_MS = 60 * 60 * 1000; // 1h

export const ratesRouter = router({
  // ── Bands ────────────────────────────────────────────────────────────────
  setBand: auditedAdminProcedure
    .input(
      z.object({
        currency: currencySchema,
        bandBps: z.number().int().min(1).max(10000),
        totpCode: totpCodeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC rate band update");
      const db = await requireDb();

      // Upsert: exactly one active band per (tenant, currency) — deactivate
      // predecessors, insert the new band (app-layer uniqueness per schema note).
      const band = await db.transaction(async (tx: any) => {
        await tx
          .update(bdcRateBands)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(bdcRateBands.tenantId, tenantId),
              eq(bdcRateBands.currency, input.currency),
              eq(bdcRateBands.active, true),
            ),
          );
        const inserted = await tx
          .insert(bdcRateBands)
          .values({
            tenantId,
            currency: input.currency,
            bandBps: input.bandBps,
            active: true,
            setByUserId: ctx.user.id,
          })
          .returning();
        return inserted[0];
      });
      return band;
    }),

  // ── Quotes ───────────────────────────────────────────────────────────────
  createQuote: auditedProcedure
    .input(
      z.object({
        branchId: z.number().int().positive().optional(),
        currency: currencySchema,
        side: z.enum(["buy", "sell"]),
        rate: moneySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();

      // Optional branch scoping: the branch must belong to this tenant.
      if (input.branchId !== undefined) {
        const branch = (await db
          .select({ id: bdcBranches.id })
          .from(bdcBranches)
          .where(and(eq(bdcBranches.id, input.branchId), eq(bdcBranches.tenantId, tenantId)))
          .limit(1)) as Array<{ id: number }>;
        if (!branch[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Branch ${input.branchId} not found for this tenant` });
        }
      }

      const band = await activeBand(db, tenantId, input.currency);
      if (!band) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No active rate band configured for ${input.currency} — set a band before quoting`,
        });
      }

      const { reference, source } = await referenceNairaPerUnit(input.currency);
      const rate = Number(input.rate);
      const devBps = deviationBps(rate, reference);
      if (devBps > band.bandBps) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Rate ${input.rate} deviates ${devBps.toFixed(1)}bps from the ${input.currency} reference (${reference.toFixed(2)}, source: ${source}) — outside the ±${band.bandBps}bps band`,
        });
      }

      const inserted = await db
        .insert(bdcRateQuotes)
        .values({
          tenantId,
          branchId: input.branchId ?? null,
          currency: input.currency,
          side: input.side,
          rate: rate.toFixed(2),
          referenceRate: reference.toFixed(2),
          status: "draft",
          makerId: ctx.user.id,
        })
        .returning();
      return { ...(inserted[0] as BdcRateQuote), referenceSource: source, deviationBps: Math.round(devBps * 10) / 10 };
    }),

  publishQuote: auditedProcedure
    .input(
      z.object({
        quoteId: z.number().int().positive(),
        totpCode: totpCodeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC rate publication");
      const db = await requireDb();

      const rows = (await db
        .select()
        .from(bdcRateQuotes)
        .where(and(eq(bdcRateQuotes.id, input.quoteId), eq(bdcRateQuotes.tenantId, tenantId)))
        .limit(1)) as BdcRateQuote[];
      const quote = rows[0];
      if (!quote) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Quote ${input.quoteId} not found for this tenant` });
      }
      // Maker-checker: the publisher (checker) must not be the maker.
      if (quote.makerId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Maker-checker violation: the quote maker cannot publish their own quote",
        });
      }
      if (quote.status !== "draft") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Quote ${input.quoteId} is not publishable (status: ${quote.status ?? "unknown"})`,
        });
      }

      // Volatility mode (documented simple rule): if any quote PUBLISHED for
      // this currency within the last hour deviated from ITS reference by more
      // than 2× the active band, the market is moving fast — cut the new
      // quote's TTL to 15 minutes. Default TTL is 4 hours.
      let ttlMs = DEFAULT_QUOTE_TTL_MS;
      const band = await activeBand(db, tenantId, quote.currency ?? "");
      if (band) {
        const since = new Date(Date.now() - VOLATILITY_WINDOW_MS);
        const recent = (await db
          .select({
            rate: bdcRateQuotes.rate,
            referenceRate: bdcRateQuotes.referenceRate,
          })
          .from(bdcRateQuotes)
          .where(
            and(
              eq(bdcRateQuotes.tenantId, tenantId),
              eq(bdcRateQuotes.currency, quote.currency ?? ""),
              eq(bdcRateQuotes.status, "published"),
              gte(bdcRateQuotes.publishedAt, since),
            ),
          )) as Array<{ rate: string; referenceRate: string }>;
        const breached = recent.some(
          (q) => deviationBps(Number(q.rate), Number(q.referenceRate)) > 2 * band.bandBps,
        );
        if (breached) ttlMs = VOLATILE_QUOTE_TTL_MS;
      }

      const now = new Date();
      // Guarded single-winner claim (SPEC §0.5b): only flip a row that is
      // still in draft status.
      const updated = await db
        .update(bdcRateQuotes)
        .set({
          status: "published",
          checkerId: ctx.user.id,
          publishedAt: now,
          expiresAt: new Date(now.getTime() + ttlMs),
          updatedAt: now,
        })
        .where(
          and(
            eq(bdcRateQuotes.id, input.quoteId),
            eq(bdcRateQuotes.tenantId, tenantId),
            eq(bdcRateQuotes.status, "draft"),
          ),
        )
        .returning();
      if (updated.length !== 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Quote ${input.quoteId} changed status concurrently — reload and retry`,
        });
      }
      return { ...(updated[0] as BdcRateQuote), volatilityMode: ttlMs === VOLATILE_QUOTE_TTL_MS };
    }),

  expireStale: auditedAdminProcedure.mutation(async ({ ctx }) => {
    const tenantId = await requireTenantId(ctx.user.id);
    const db = await requireDb();
    const now = new Date();
    const expired = await db
      .update(bdcRateQuotes)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(bdcRateQuotes.tenantId, tenantId),
          eq(bdcRateQuotes.status, "published"),
          sql`${bdcRateQuotes.expiresAt} < ${now}`,
        ),
      )
      .returning({ id: bdcRateQuotes.id });
    return { expiredCount: expired.length, expiredIds: expired.map((r: { id: number }) => r.id), at: now };
  }),

  currentBoard: auditedProcedure
    .input(z.object({ branchId: z.number().int().positive().optional() }))
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      const now = new Date();
      // Live published quotes: tenant-wide plus (when requested) branch-specific.
      const scope = input.branchId
        ? or(isNull(bdcRateQuotes.branchId), eq(bdcRateQuotes.branchId, input.branchId))
        : isNull(bdcRateQuotes.branchId);
      const quotes = (await db
        .select()
        .from(bdcRateQuotes)
        .where(
          and(
            eq(bdcRateQuotes.tenantId, tenantId),
            eq(bdcRateQuotes.status, "published"),
            or(isNull(bdcRateQuotes.expiresAt), gt(bdcRateQuotes.expiresAt, now)),
            scope,
          ),
        )
        .orderBy(desc(bdcRateQuotes.publishedAt))) as BdcRateQuote[];

      // Latest per (currency, side); branch-specific quotes win on precedence.
      type BoardCell = BdcRateQuote | null;
      const board = new Map<string, { buy: BoardCell; sell: BoardCell }>();
      for (const q of quotes) {
        const ccy = q.currency ?? "???";
        const cell = board.get(ccy) ?? { buy: null, sell: null };
        const side = q.side === "sell" ? "sell" : "buy";
        const existing = cell[side];
        const qBranchSpecific = q.branchId != null;
        const existingBranchSpecific = existing?.branchId != null;
        const take =
          !existing ||
          (qBranchSpecific && !existingBranchSpecific) ||
          (qBranchSpecific === existingBranchSpecific &&
            (q.publishedAt?.getTime() ?? 0) > (existing.publishedAt?.getTime() ?? 0));
        if (take) cell[side] = q;
        board.set(ccy, cell);
      }
      return [...board.entries()]
        .map(([currency, cell]) => ({ currency, buy: cell.buy, sell: cell.sell }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
    }),

  crossQuote: auditedProcedure
    .input(
      z.object({
        fromCcy: currencySchema,
        toCcy: currencySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      if (input.fromCcy === input.toCcy) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "fromCcy and toCcy must differ" });
      }

      // Two-leg cross via the naira mid (fail-closed reference per SPEC §0.3):
      //   leg 1 — BDC BUYs fromCcy from the customer (customer receives naira)
      //   leg 2 — BDC SELLs toCcy to the customer (customer pays naira)
      // Both legs are returned with their own band/compliance params so the
      // caller can validate each leg against its own active band.
      const [fromRef, toRef, fromBand, toBand] = await Promise.all([
        referenceNairaPerUnit(input.fromCcy),
        referenceNairaPerUnit(input.toCcy),
        activeBand(db, tenantId, input.fromCcy),
        activeBand(db, tenantId, input.toCcy),
      ]);

      // Cross rate: units of toCcy per 1 fromCcy, via naira mid.
      // Rounding rule: round-half-away-from-zero at 6 decimal places
      // (matches the rust-rate-governance contract, SPEC §4.4).
      const raw = fromRef.reference / toRef.reference;
      const scale = 1_000_000;
      const crossRate = (Math.round(Math.abs(raw) * scale + 0.5 - 1e-9) * Math.sign(raw)) / scale;

      return {
        fromCcy: input.fromCcy,
        toCcy: input.toCcy,
        crossRate,
        rounding: "round-half-away-from-zero@6dp",
        referenceSource: fromRef.source,
        legs: [
          {
            side: "buy" as const,
            currency: input.fromCcy,
            nairaPerUnit: Number(fromRef.reference.toFixed(2)),
            bandBps: fromBand?.bandBps ?? null,
            compliance: { requiresActiveBand: true, bandActive: fromBand != null },
          },
          {
            side: "sell" as const,
            currency: input.toCcy,
            nairaPerUnit: Number(toRef.reference.toFixed(2)),
            bandBps: toBand?.bandBps ?? null,
            compliance: { requiresActiveBand: true, bandActive: toBand != null },
          },
        ],
      };
    }),

  /** Dealer desk: list rate bands (active first, then history). */
  listBands: auditedProcedure
    .input(z.object({ includeInactive: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      const rows = await db
        .select()
        .from(bdcRateBands)
        .where(
          input?.includeInactive
            ? eq(bdcRateBands.tenantId, tenantId)
            : and(eq(bdcRateBands.tenantId, tenantId), eq(bdcRateBands.active, true)),
        )
        .orderBy(desc(bdcRateBands.active), desc(bdcRateBands.createdAt))
        .limit(100);
      return { bands: rows };
    }),

  /** Dealer desk: list quotes with optional status/currency filters, id-cursor pagination. */
  listQuotes: auditedProcedure
    .input(z.object({
      status: z.enum(["draft", "published", "expired", "suspended"]).optional(),
      currency: z.string().length(3).optional(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      const rows = await db
        .select()
        .from(bdcRateQuotes)
        .where(and(
          eq(bdcRateQuotes.tenantId, tenantId),
          input.status ? eq(bdcRateQuotes.status, input.status) : undefined,
          input.currency ? eq(bdcRateQuotes.currency, input.currency.toUpperCase()) : undefined,
          input.cursor ? sql`${bdcRateQuotes.id} < ${input.cursor}` : undefined,
        ))
        .orderBy(desc(bdcRateQuotes.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const quotes = hasMore ? rows.slice(0, input.limit) : rows;
      return { quotes, nextCursor: hasMore ? quotes[quotes.length - 1]?.id ?? null : null };
    }),
});
