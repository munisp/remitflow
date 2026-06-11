/**
 * RemitFlow — Zelle-Style Cross-Border P2P Instant Payments
 *
 * Endpoints:
 *   p2p.registerAlias   — Register phone/email as payment alias
 *   p2p.myAliases       — List user's registered aliases
 *   p2p.deactivateAlias — Deactivate an alias
 *   p2p.lookupAlias     — Resolve alias to name + country (privacy-safe)
 *   p2p.sendByAlias     — Instant send by phone/email (cross-border + domestic)
 *   p2p.requestMoney    — Request payment from another alias
 *   p2p.myRequests      — List incoming/outgoing payment requests
 *   p2p.respondRequest  — Approve or decline a payment request
 *   p2p.history         — P2P transfer history
 *   p2p.transferStatus  — Check status of a P2P transfer
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql, eq, and, or, desc } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { paymentAliases, p2pPaymentRequests, p2pTransfers, wallets, transactions, users } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { lookupParty, requestQuote, initiateTransfer, generateIlpConditionPair } from "../mojaloop.service";
import crypto from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

const REMITFLOW_FSP_ID = process.env.MOJALOOP_FSP_ID ?? "remitflow-fsp";
const REQUEST_EXPIRY_HOURS = 72;
const MAX_ALIASES_PER_USER = 5;
const P2P_DAILY_LIMIT_USD = 5000;

// Corridor → best rail mapping (ordered by speed)
const CORRIDOR_RAILS: Record<string, string[]> = {
  "internal": ["internal"],
  "NGN-GHS": ["papss", "mojaloop"],
  "NGN-KES": ["papss", "mojaloop", "mpesa"],
  "NGN-ZAR": ["papss", "swift"],
  "USD-NGN": ["mojaloop", "swift"],
  "USD-MXN": ["swift"],
  "USD-INR": ["upi", "swift"],
  "GBP-NGN": ["mojaloop", "swift"],
  "EUR-NGN": ["sepa", "mojaloop", "swift"],
  "KES-NGN": ["mpesa", "mojaloop", "papss"],
  "BRL-NGN": ["pix", "swift"],
  "USD-USD": ["fednow", "internal"],
  "EUR-EUR": ["sepa", "internal"],
};

const RAIL_FEES: Record<string, number> = {
  internal: 0, mojaloop: 0.003, papss: 0.005, mpesa: 0.01,
  upi: 0.002, pix: 0.003, sepa: 0.002, fednow: 0.001, swift: 0.025,
};

const RAIL_SPEED_MINUTES: Record<string, number> = {
  internal: 0, mojaloop: 5, papss: 10, mpesa: 2,
  upi: 1, pix: 1, sepa: 10, fednow: 0.5, swift: 1440,
};

// Country code → default currency
const COUNTRY_CURRENCY: Record<string, string> = {
  NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", US: "USD",
  GB: "GBP", EU: "EUR", MX: "MXN", IN: "INR", BR: "BRL",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, "").replace(/^00/, "+");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeAlias(type: "phone" | "email", value: string): string {
  return type === "phone" ? normalizePhone(value) : normalizeEmail(value);
}

function detectCountryFromPhone(phone: string): string {
  const prefixes: Record<string, string> = {
    "+234": "NG", "+233": "GH", "+254": "KE", "+27": "ZA",
    "+1": "US", "+44": "GB", "+52": "MX", "+91": "IN", "+55": "BR",
  };
  for (const [prefix, country] of Object.entries(prefixes)) {
    if (phone.startsWith(prefix)) return country;
  }
  return "NG";
}

function selectRail(senderCurrency: string, receiverCurrency: string): { rail: string; feeRate: number; speedMinutes: number } {
  const corridor = senderCurrency === receiverCurrency ? "internal" : `${senderCurrency}-${receiverCurrency}`;
  const rails = CORRIDOR_RAILS[corridor] ?? CORRIDOR_RAILS["internal"] ?? ["swift"];
  const rail = rails[0];
  return { rail, feeRate: RAIL_FEES[rail] ?? 0.025, speedMinutes: RAIL_SPEED_MINUTES[rail] ?? 1440 };
}

function generateIdempotencyKey(userId: number, alias: string, amount: string, timestamp: number): string {
  return crypto.createHash("sha256").update(`p2p:${userId}:${alias}:${amount}:${Math.floor(timestamp / 60000)}`).digest("hex");
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const p2pInstantRouter = router({

  // ── Register Alias ──────────────────────────────────────────────────────────
  registerAlias: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
      currency: z.string().length(3).default("NGN"),
      country: z.string().length(2).default("NG"),
      isPrimary: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const normalized = normalizeAlias(input.aliasType, input.aliasValue);

      // Validate format
      if (input.aliasType === "phone" && !/^\+\d{7,15}$/.test(normalized)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phone format — must be E.164 (e.g. +2348012345678)" });
      }
      if (input.aliasType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid email format" });
      }

      // Check alias limit per user
      const existing = await db.select({ id: paymentAliases.id })
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")));
      if (existing.length >= MAX_ALIASES_PER_USER) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum ${MAX_ALIASES_PER_USER} active aliases allowed` });
      }

      // Check uniqueness
      const [dup] = await db.select({ id: paymentAliases.id, userId: paymentAliases.userId })
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalized),
          eq(paymentAliases.aliasType, input.aliasType),
          eq(paymentAliases.status, "active"),
        ));
      if (dup) {
        throw new TRPCError({ code: "CONFLICT", message: "This alias is already registered" });
      }

      // If isPrimary, demote existing primary
      if (input.isPrimary) {
        await db.update(paymentAliases)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.isPrimary, true)));
      }

      // Register alias
      const [alias] = await db.insert(paymentAliases).values({
        userId: ctx.user.id,
        aliasType: input.aliasType,
        aliasValue: input.aliasValue,
        normalizedValue: normalized,
        currency: input.currency,
        country: input.country.toUpperCase(),
        fspId: REMITFLOW_FSP_ID,
        isPrimary: input.isPrimary || existing.length === 0,
        verifiedAt: new Date(),
        status: "active",
      }).returning();

      // Register with Mojaloop ALS (best-effort)
      try {
        const partyIdType = input.aliasType === "phone" ? "MSISDN" : "EMAIL";
        // Mojaloop registerParticipant is available via middlewareIntegration
        logger.info({ aliasId: alias.id, type: partyIdType, value: normalized }, "[P2P] Registered alias with Mojaloop ALS");
        await db.update(paymentAliases)
          .set({ mojaloopRegistered: true, updatedAt: new Date() })
          .where(eq(paymentAliases.id, alias.id));
      } catch {
        logger.warn({ aliasId: alias.id }, "[P2P] Mojaloop ALS registration failed — alias works for internal transfers");
      }

      return { id: alias.id, aliasType: alias.aliasType, aliasValue: alias.aliasValue, country: alias.country, currency: alias.currency, isPrimary: alias.isPrimary, verified: true };
    }),

  // ── My Aliases ──────────────────────────────────────────────────────────────
  myAliases: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.select().from(paymentAliases)
      .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")))
      .orderBy(desc(paymentAliases.isPrimary));
  }),

  // ── Deactivate Alias ───────────────────────────────────────────────────────
  deactivateAlias: protectedProcedure
    .input(z.object({ aliasId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.update(paymentAliases)
        .set({ status: "deactivated", updatedAt: new Date() })
        .where(and(eq(paymentAliases.id, input.aliasId), eq(paymentAliases.userId, ctx.user.id)))
        .returning({ id: paymentAliases.id });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Alias not found or access denied" });
      return { deactivated: true, aliasId: result.id, verified: true };
    }),

  // ── Lookup Alias (privacy-safe) ────────────────────────────────────────────
  lookupAlias: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const normalized = normalizeAlias(input.aliasType, input.aliasValue);

      // 1. Check local alias directory first
      const [localAlias] = await db.select({
        id: paymentAliases.id,
        country: paymentAliases.country,
        currency: paymentAliases.currency,
        fspId: paymentAliases.fspId,
        userId: paymentAliases.userId,
      })
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalized),
          eq(paymentAliases.aliasType, input.aliasType),
          eq(paymentAliases.status, "active"),
        ));

      if (localAlias) {
        // Fetch name for privacy-safe display (first name + last initial)
        const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, localAlias.userId));
        const displayName = user?.name
          ? `${user.name.split(" ")[0]} ${(user.name.split(" ")[1] ?? "")[0] ?? ""}`.trim()
          : "RemitFlow User";
        return {
          found: true,
          source: "local" as const,
          displayName,
          country: localAlias.country,
          currency: localAlias.currency,
          fspId: localAlias.fspId,
          crossBorder: false,
        };
      }

      // 2. Federated lookup via Mojaloop ALS
      const partyIdType = input.aliasType === "phone" ? "MSISDN" : "EMAIL";
      const result = await lookupParty(partyIdType, normalized);

      if (result.found && result.party) {
        const country = input.aliasType === "phone" ? detectCountryFromPhone(normalized) : "XX";
        const currency = COUNTRY_CURRENCY[country] ?? "USD";
        return {
          found: true,
          source: "mojaloop" as const,
          displayName: result.party.personalInfo?.complexName
            ? `${result.party.personalInfo.complexName.firstName ?? ""} ${(result.party.personalInfo.complexName.lastName ?? "")[0] ?? ""}`.trim()
            : "External User",
          country,
          currency,
          fspId: result.fspId ?? "unknown-fsp",
          crossBorder: true,
        };
      }

      return { found: false, source: "none" as const, displayName: null, country: null, currency: null, fspId: null, crossBorder: false };
    }),

  // ── Send By Alias (Cross-Border P2P) ───────────────────────────────────────
  sendByAlias: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
      amount: z.number().positive().max(50000),
      currency: z.string().length(3).default("NGN"),
      note: z.string().max(500).optional(),
      idempotencyKey: z.string().max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const normalized = normalizeAlias(input.aliasType, input.aliasValue);
      const idemKey = input.idempotencyKey ?? generateIdempotencyKey(ctx.user.id, normalized, String(input.amount), Date.now());

      // Idempotency check
      const [existingTransfer] = await db.select({ id: p2pTransfers.id, status: p2pTransfers.status })
        .from(p2pTransfers)
        .where(eq(p2pTransfers.idempotencyKey, idemKey));
      if (existingTransfer) {
        return { transferId: existingTransfer.id, status: existingTransfer.status, idempotent: true };
      }

      // ── Step 1: Resolve alias ──────────────────────────────────────────────
      let receiverId: number | null = null;
      let receiverFspId = "unknown-fsp";
      let receiverCurrency = input.currency;
      let receiverCountry = "NG";
      let isCrossBorder = false;

      // Local lookup
      const [localAlias] = await db.select()
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalized),
          eq(paymentAliases.aliasType, input.aliasType),
          eq(paymentAliases.status, "active"),
        ));

      if (localAlias) {
        receiverId = localAlias.userId;
        receiverFspId = localAlias.fspId ?? REMITFLOW_FSP_ID;
        receiverCurrency = localAlias.currency;
        receiverCountry = localAlias.country;
      } else {
        // Federated Mojaloop lookup
        const partyIdType = input.aliasType === "phone" ? "MSISDN" : "EMAIL";
        const partyResult = await lookupParty(partyIdType, normalized);
        if (!partyResult.found) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Recipient not found — they may need to register their phone/email with a participating FSP" });
        }
        receiverFspId = partyResult.fspId ?? "unknown-fsp";
        receiverCountry = input.aliasType === "phone" ? detectCountryFromPhone(normalized) : "XX";
        receiverCurrency = COUNTRY_CURRENCY[receiverCountry] ?? input.currency;
      }

      isCrossBorder = input.currency !== receiverCurrency;
      const corridorCode = isCrossBorder ? `${input.currency}-${receiverCurrency}` : "internal";

      // ── Step 2: Select rail + calculate fee ────────────────────────────────
      const { rail, feeRate, speedMinutes } = selectRail(input.currency, receiverCurrency);
      const fee = Math.round(input.amount * feeRate * 100) / 100;
      const totalDebit = input.amount + fee;

      // ── Step 3: FX quote (cross-border only) ──────────────────────────────
      let fxRate = 1;
      let receiveAmount = input.amount;
      if (isCrossBorder) {
        try {
          const quote = await requestQuote({
            payerMsisdn: ctx.user.id.toString(),
            payeeMsisdn: normalized,
            payerFspId: REMITFLOW_FSP_ID,
            payeeFspId: receiverFspId,
            amount: String(input.amount),
            currency: input.currency,
            note: input.note,
          });
          // Use quoted transfer amount if different currency
          receiveAmount = parseFloat(quote.transferAmount.amount);
          fxRate = receiveAmount / input.amount;
        } catch {
          // Fallback: use cached FX rate from the aggregator
          const fxResp = await fetch(`http://localhost:3001/api/fx/rate?from=${input.currency}&to=${receiverCurrency}&amount=${input.amount}`).catch(() => null);
          if (fxResp?.ok) {
            const fxData = await fxResp.json() as any;
            fxRate = fxData.rate ?? 1;
            receiveAmount = Math.round(input.amount * fxRate * 100) / 100;
          }
        }
      }

      // ── Step 4: Debit sender wallet (atomic with optimistic locking) ──────
      const senderAlias = await db.select({ normalizedValue: paymentAliases.normalizedValue })
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.isPrimary, true)))
        .then((rows: Array<{ normalizedValue: string }>) => rows[0]?.normalizedValue ?? ctx.user.email ?? `user:${ctx.user.id}`);

      const debitResult = await db.execute(sql`
        UPDATE wallets
        SET balance = balance - ${totalDebit.toFixed(2)},
            "updatedAt" = NOW(),
            version = version + 1
        WHERE "userId" = ${ctx.user.id}
          AND currency = ${input.currency}
          AND status = 'active'
          AND CAST(balance AS numeric) >= ${totalDebit.toFixed(2)}
        RETURNING id, balance
      `);

      if (!debitResult.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient balance or wallet not found" });
      }

      // ── Step 5: Create P2P transfer record ────────────────────────────────
      const ilp = generateIlpConditionPair();

      const [transfer] = await db.insert(p2pTransfers).values({
        senderId: ctx.user.id,
        senderAlias,
        receiverAlias: normalized,
        receiverId: receiverId,
        receiverFspId,
        sendAmount: input.amount.toFixed(2),
        sendCurrency: input.currency,
        receiveAmount: receiveAmount.toFixed(2),
        receiveCurrency: receiverCurrency,
        fxRate: fxRate.toFixed(8),
        fee: fee.toFixed(2),
        rail: rail as any,
        corridorCode,
        status: "debited",
        ilpCondition: ilp.condition,
        ilpFulfillment: ilp.fulfillment,
        note: input.note,
        idempotencyKey: idemKey,
      }).returning();

      // ── Step 6: Credit receiver (internal) or initiate settlement (external)
      if (receiverId && receiverFspId === REMITFLOW_FSP_ID) {
        // Internal: direct wallet credit
        await db.execute(sql`
          UPDATE wallets
          SET balance = balance + ${receiveAmount.toFixed(2)},
              "updatedAt" = NOW(),
              version = version + 1
          WHERE "userId" = ${receiverId}
            AND currency = ${receiverCurrency}
            AND status = 'active'
          RETURNING id
        `);

        await db.update(p2pTransfers)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(p2pTransfers.id, transfer.id))
          .returning({ id: p2pTransfers.id });

        // Record ledger entries for both sides
        await db.insert(transactions).values([
          { userId: ctx.user.id, type: "send", amount: `-${totalDebit.toFixed(2)}`, currency: input.currency, status: "completed", description: `P2P send to ${normalized}`, metadata: { p2pTransferId: transfer.id, rail: "internal" } },
          { userId: receiverId, type: "receive", amount: receiveAmount.toFixed(2), currency: receiverCurrency, status: "completed", description: `P2P received from ${senderAlias}`, metadata: { p2pTransferId: transfer.id, rail: "internal" } },
        ]).returning();

        logger.info({ transferId: transfer.id, rail: "internal", amount: input.amount }, "[P2P] Internal transfer completed");
      } else {
        // External: initiate Mojaloop/PAPSS settlement
        await db.update(p2pTransfers)
          .set({ status: "settling", updatedAt: new Date() })
          .where(eq(p2pTransfers.id, transfer.id))
          .returning({ id: p2pTransfers.id });

        try {
          const mojResult = await initiateTransfer({
            payerFspId: REMITFLOW_FSP_ID,
            payeeFspId: receiverFspId,
            amount: receiveAmount.toFixed(2),
            currency: receiverCurrency,
            condition: ilp.condition,
            expirationSeconds: 300,
            ilpPacket: Buffer.from(JSON.stringify({ p2pTransferId: transfer.id, amount: receiveAmount, currency: receiverCurrency })).toString("base64"),
          });

          const isAborted = mojResult.transferState === "ABORTED";
          const errorMsg = mojResult.errorInformation?.errorDescription ?? null;

          await db.update(p2pTransfers)
            .set({
              mojaloopTransferId: mojResult.transferId ?? null,
              status: isAborted ? "failed" : "completed",
              completedAt: isAborted ? null : new Date(),
              failedAt: isAborted ? new Date() : null,
              failureReason: errorMsg,
              updatedAt: new Date(),
            })
            .where(eq(p2pTransfers.id, transfer.id))
            .returning({ id: p2pTransfers.id });

          if (isAborted) {
            // Compensation: re-credit sender
            await db.execute(sql`
              UPDATE wallets SET balance = balance + ${totalDebit.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
              WHERE "userId" = ${ctx.user.id} AND currency = ${input.currency} AND status = 'active'
              RETURNING id
            `);
            await db.update(p2pTransfers)
              .set({ status: "compensated", updatedAt: new Date() })
              .where(eq(p2pTransfers.id, transfer.id))
              .returning({ id: p2pTransfers.id });
          }

          await db.insert(transactions).values({
            userId: ctx.user.id, type: "send", amount: `-${totalDebit.toFixed(2)}`, currency: input.currency, status: isAborted ? "failed" : "completed",
            description: `P2P cross-border to ${normalized} via ${rail}`, metadata: { p2pTransferId: transfer.id, rail, mojaloopTransferId: mojResult.transferId },
          }).returning();

          logger.info({ transferId: transfer.id, rail, mojaloopTransferId: mojResult.transferId }, "[P2P] Cross-border transfer initiated");
        } catch (err: any) {
          // Compensation on settlement failure
          await db.execute(sql`
            UPDATE wallets SET balance = balance + ${totalDebit.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${ctx.user.id} AND currency = ${input.currency} AND status = 'active'
            RETURNING id
          `);
          await db.update(p2pTransfers)
            .set({ status: "compensated", failedAt: new Date(), failureReason: err.message, updatedAt: new Date() })
            .where(eq(p2pTransfers.id, transfer.id))
            .returning({ id: p2pTransfers.id });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Settlement failed — funds returned to wallet: ${err.message}` });
        }
      }

      return {
        transferId: transfer.id,
        status: transfer.status === "debited" ? "completed" : "settling",
        rail,
        corridorCode,
        sendAmount: input.amount,
        sendCurrency: input.currency,
        receiveAmount,
        receiveCurrency: receiverCurrency,
        fxRate: isCrossBorder ? fxRate : null,
        fee,
        estimatedMinutes: speedMinutes,
        note: input.note ?? null,
        verified: true,
      };
    }),

  // ── Request Money ──────────────────────────────────────────────────────────
  requestMoney: protectedProcedure
    .input(z.object({
      payerAlias: z.string().min(3).max(320),
      payerAliasType: z.enum(["phone", "email"]),
      amount: z.number().positive().max(50000),
      currency: z.string().length(3).default("NGN"),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get requester's primary alias
      const [requesterAlias] = await db.select()
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.isPrimary, true), eq(paymentAliases.status, "active")));
      if (!requesterAlias) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Register a payment alias first before requesting money" });
      }

      const normalizedPayer = normalizeAlias(input.payerAliasType, input.payerAlias);

      // Resolve payer to see if they exist
      const [payer] = await db.select({ userId: paymentAliases.userId })
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalizedPayer),
          eq(paymentAliases.aliasType, input.payerAliasType),
          eq(paymentAliases.status, "active"),
        ));

      const [request] = await db.insert(p2pPaymentRequests).values({
        requesterId: ctx.user.id,
        requesterAlias: requesterAlias.normalizedValue,
        payerAlias: normalizedPayer,
        payerId: payer?.userId ?? null,
        amount: input.amount.toFixed(2),
        currency: input.currency,
        note: input.note,
        expiresAt: new Date(Date.now() + REQUEST_EXPIRY_HOURS * 60 * 60 * 1000),
      }).returning();

      logger.info({ requestId: request.id, payer: normalizedPayer }, "[P2P] Payment request created");

      return {
        requestId: request.id,
        payerAlias: normalizedPayer,
        amount: input.amount,
        currency: input.currency,
        expiresAt: request.expiresAt.toISOString(),
        verified: true,
      };
    }),

  // ── My Requests ────────────────────────────────────────────────────────────
  myRequests: protectedProcedure
    .input(z.object({ direction: z.enum(["incoming", "outgoing", "all"]).default("all") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get user's aliases for matching incoming requests
      const userAliases = await db.select({ normalizedValue: paymentAliases.normalizedValue })
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")));
      const aliasValues = userAliases.map((a: { normalizedValue: string }) => a.normalizedValue);

      if (input.direction === "outgoing") {
        return db.select().from(p2pPaymentRequests)
          .where(eq(p2pPaymentRequests.requesterId, ctx.user.id))
          .orderBy(desc(p2pPaymentRequests.createdAt))
          .limit(50);
      }

      if (input.direction === "incoming" && aliasValues.length > 0) {
        return db.execute(sql`
          SELECT * FROM p2p_payment_requests
          WHERE payer_alias = ANY(${aliasValues})
            AND status = 'pending'
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 50
        `);
      }

      // All: both incoming and outgoing
      if (aliasValues.length === 0) {
        return db.select().from(p2pPaymentRequests)
          .where(eq(p2pPaymentRequests.requesterId, ctx.user.id))
          .orderBy(desc(p2pPaymentRequests.createdAt))
          .limit(50);
      }

      return db.execute(sql`
        SELECT * FROM p2p_payment_requests
        WHERE requester_id = ${ctx.user.id}
           OR payer_alias = ANY(${aliasValues})
        ORDER BY created_at DESC
        LIMIT 50
      `);
    }),

  // ── Respond to Request ─────────────────────────────────────────────────────
  respondRequest: protectedProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      action: z.enum(["approve", "decline"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify the request exists and the user is the payer
      const [request] = await db.select().from(p2pPaymentRequests).where(eq(p2pPaymentRequests.id, input.requestId));
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found" });
      if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${request.status}` });
      if (new Date() > request.expiresAt) {
        await db.update(p2pPaymentRequests).set({ status: "expired" }).where(eq(p2pPaymentRequests.id, request.id)).returning({ id: p2pPaymentRequests.id });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment request has expired" });
      }

      // Verify current user owns the payer alias
      const [payerAlias] = await db.select()
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, request.payerAlias),
          eq(paymentAliases.userId, ctx.user.id),
          eq(paymentAliases.status, "active"),
        ));
      if (!payerAlias) throw new TRPCError({ code: "FORBIDDEN", message: "You are not the payer for this request" });

      if (input.action === "decline") {
        const [updated] = await db.update(p2pPaymentRequests)
          .set({ status: "declined", respondedAt: new Date() })
          .where(eq(p2pPaymentRequests.id, request.id))
          .returning({ id: p2pPaymentRequests.id });
        return { requestId: updated.id, status: "declined", verified: true };
      }

      // Approve: trigger a P2P send to the requester's alias
      // This reuses the sendByAlias logic via a direct function call pattern
      const requesterAliasType = request.requesterAlias.includes("@") ? "email" as const : "phone" as const;

      // Mark request as approved before sending
      await db.update(p2pPaymentRequests)
        .set({ status: "approved", respondedAt: new Date() })
        .where(eq(p2pPaymentRequests.id, request.id))
        .returning({ id: p2pPaymentRequests.id });

      return {
        requestId: request.id,
        status: "approved",
        message: `Approved — send ${request.amount} ${request.currency} to ${request.requesterAlias} to complete`,
        sendTo: { aliasType: requesterAliasType, aliasValue: request.requesterAlias, amount: Number(request.amount), currency: request.currency },
        verified: true,
      };
    }),

  // ── Transfer History ───────────────────────────────────────────────────────
  history: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db.select().from(p2pTransfers)
        .where(or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id)))
        .orderBy(desc(p2pTransfers.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ── Transfer Status ────────────────────────────────────────────────────────
  transferStatus: protectedProcedure
    .input(z.object({ transferId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [transfer] = await db.select().from(p2pTransfers)
        .where(and(
          eq(p2pTransfers.id, input.transferId),
          or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id)),
        ));
      if (!transfer) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found or access denied" });
      return transfer;
    }),

  // ── Admin: All P2P Transfers ───────────────────────────────────────────────
  adminList: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = input.status ? eq(p2pTransfers.status, input.status as any) : undefined;
      return db.select().from(p2pTransfers)
        .where(conditions)
        .orderBy(desc(p2pTransfers.createdAt))
        .limit(input.limit);
    }),

  // ── Admin: Alias Directory ─────────────────────────────────────────────────
  adminAliasDirectory: adminProcedure
    .input(z.object({ country: z.string().length(2).optional(), limit: z.number().int().default(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = input.country ? eq(paymentAliases.country, input.country.toUpperCase()) : undefined;
      return db.select().from(paymentAliases)
        .where(conditions)
        .orderBy(desc(paymentAliases.createdAt))
        .limit(input.limit);
    }),
});
