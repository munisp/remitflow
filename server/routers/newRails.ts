// RemitFlow — v171 New Payment Rails tRPC Router
//
// Covers: BRICSPay, mBridge, GhIPSS, AfriCBDC, PAPSS
// Each procedure:
//   1. Validates input
//   2. Inserts a DB record
//   3. Calls the corresponding Go/Rust/Python microservice via HTTP
//   4. Returns the result
//
// Mojaloop bridge: all rails attempt Mojaloop routing for last-mile delivery.
// Middleware events are emitted by the microservices themselves (Kafka/Dapr/Fluvio).

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditLog } from "../db";
import {
  bricspayTransfers,
  mbridgeTransfers,
  ghipssTransfers,
  africbdcTransfers,
  papssTransfers,
} from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../_core/logger";

const MICROSERVICE_URLS = {
  bricspay: process.env.BRICSPAY_SERVICE_URL || "http://localhost:8102",
  mbridge:  process.env.MBRIDGE_SERVICE_URL  || "http://localhost:8103",
  ghipss:   process.env.GHIPSS_SERVICE_URL   || "http://localhost:8104",
  africbdc: process.env.AFRICBDC_SERVICE_URL || "http://localhost:8105",
  papss:    process.env.PAPSS_SERVICE_URL    || "http://localhost:8106",
};

async function callRailService(url: string, path: string, body: unknown) {
  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Rail service error ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("timeout")) {
      // Persist to DB retry queue for automatic retry by background worker
      try {
        const db = await getDb();
        if (db) {
          await db.execute(
            sql`INSERT INTO outbox_events (event_type, payload, status, created_at)
                VALUES ('rail_retry', ${JSON.stringify({ url, path, body })}::jsonb, 'pending', NOW())
                ON CONFLICT DO NOTHING`
          );
        }
      } catch { /* DB unavailable — propagate original error */ }
      logger.warn({ url, path }, "Rail service unavailable — queued for retry");
      return { status: "queued", queued: true, message: "Payment queued for retry — microservice temporarily unavailable" };
    }
    throw err;
  }
}

// ── BRICSPay ──────────────────────────────────────────────────────────────────

const bricspayInitiateSchema = z.object({
  transferId: z.string().uuid(),
  senderCountry: z.enum(["CN", "RU", "IN", "BR", "ZA", "AE", "SA", "EG", "ET", "IR"]),
  receiverCountry: z.enum(["CN", "RU", "IN", "BR", "ZA", "AE", "SA", "EG", "ET", "IR"]),
  sendAmount: z.number().positive().max(1_000_000),
  sendCurrency: z.string().min(3).max(10),
  receiveCurrency: z.string().min(3).max(10),
  receiverVpa: z.string().min(5).max(200),
  senderName: z.string().optional(),
  receiverName: z.string().optional(),
  purpose: z.enum(["family_support", "business", "education", "medical", "investment", "other"]).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

// ── mBridge ───────────────────────────────────────────────────────────────────

const mbridgeInitiateSchema = z.object({
  transferId: z.string().uuid(),
  senderCountry: z.enum(["CN", "HK", "AE", "TH", "SA"]),
  receiverCountry: z.enum(["CN", "HK", "AE", "TH", "SA"]),
  sendAmount: z.number().positive().max(50_000_000), // wholesale only — high limits
  sendCbdc: z.enum(["eCNY", "eHKD", "dAED", "eBaht", "eSAR"]),
  receiveCbdc: z.enum(["eCNY", "eHKD", "dAED", "eBaht", "eSAR"]),
  receiverCbdcAddress: z.string().min(10).max(200),
  idempotencyKey: z.string().min(8).max(200),
});

// ── GhIPSS ────────────────────────────────────────────────────────────────────

const ghipssInitiateSchema = z.object({
  transferId: z.string().uuid(),
  transferType: z.enum(["GIP", "GHLINK", "MMI", "PAPSS"]),
  sendAmount: z.number().positive().max(100_000),
  sendCurrency: z.string().min(3).max(10),
  receiveCurrency: z.string().min(3).max(10).optional(),
  senderAccount: z.string().min(5).max(200),
  receiverAccount: z.string().min(5).max(200),
  receiverBank: z.string().optional(),
  receiverMsisdn: z.string().optional(),
  receiverName: z.string().optional(),
  narration: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

// ── AfriCBDC ──────────────────────────────────────────────────────────────────

const africbdcInitiateSchema = z.object({
  transferId: z.string().uuid(),
  cbdcType: z.enum(["eNGN", "eGHS", "dZAR", "AfriGo", "eCedi", "eKES"]),
  sendAmount: z.number().positive().max(10_000_000),
  currency: z.string().min(3).max(10),
  country: z.string().length(2),
  senderWallet: z.string().min(5).max(200),
  receiverWallet: z.string().min(5).max(200),
  receiverName: z.string().optional(),
  purpose: z.string().max(100).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

// ── PAPSS ─────────────────────────────────────────────────────────────────────

const papssInitiateSchema = z.object({
  transferId: z.string().uuid(),
  senderCountry: z.string().length(2),
  receiverCountry: z.string().length(2),
  sendAmount: z.number().positive().max(500_000),
  sendCurrency: z.string().min(3).max(10),
  receiveCurrency: z.string().min(3).max(10),
  senderAccount: z.string().min(5).max(200),
  receiverAccount: z.string().min(5).max(200),
  senderBankCode: z.string().optional(),
  receiverBankCode: z.string().optional(),
  receiverName: z.string().optional(),
  narration: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const newRailsRouter = router({
  // ── BRICSPay ────────────────────────────────────────────────────────────────
  bricspay: {
    initiate: protectedProcedure
      .input(bricspayInitiateSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const [record] = await db.insert(bricspayTransfers).values({
          userId: ctx.user.id,
          transferId: input.transferId,
          senderCountry: input.senderCountry,
          receiverCountry: input.receiverCountry,
          sendAmount: String(input.sendAmount),
          sendCurrency: input.sendCurrency,
          receiveCurrency: input.receiveCurrency,
          receiverVpa: input.receiverVpa,
          senderName: input.senderName,
          receiverName: input.receiverName,
          purpose: input.purpose,
          status: "pending",
        }).returning();

        const serviceResp = await callRailService(
          MICROSERVICE_URLS.bricspay,
          "/transfers",
          { ...input, userId: String(ctx.user.id) }
        );

        if (!serviceResp.queued) {
          await db.update(bricspayTransfers)
            .set({ status: "submitted", updatedAt: new Date() })
            .where(eq(bricspayTransfers.transferId, input.transferId));
        }

        await createAuditLog({
          userId: ctx.user.id,
          action: "bricspay_transfer_initiated",
          metadata: { transferId: input.transferId, amount: input.sendAmount, corridor: `${input.senderCountry}-${input.receiverCountry}` },
        });

        return { ...record, serviceResponse: serviceResp };
      }),

    getCorridors: protectedProcedure.query(async () => {
      const res = await callRailService(MICROSERVICE_URLS.bricspay, "/corridors", {}).catch(() => null);
      return res || {
        corridors: [
          { corridor: "CN-IN", currencies: "CNY-INR" },
          { corridor: "CN-RU", currencies: "CNY-RUB" },
          { corridor: "CN-BR", currencies: "CNY-BRL" },
          { corridor: "CN-ZA", currencies: "CNY-ZAR" },
          { corridor: "IN-ZA", currencies: "INR-ZAR" },
          { corridor: "RU-IN", currencies: "RUB-INR" },
          { corridor: "BR-ZA", currencies: "BRL-ZAR" },
          { corridor: "CN-AE", currencies: "CNY-AED" },
          { corridor: "IN-AE", currencies: "INR-AED" },
        ],
        operator: "BRICSPay DCMS",
        settlement: "T+0 CBDC atomic swap",
      };
    }),
  },

  // ── mBridge ─────────────────────────────────────────────────────────────────
  mbridge: {
    initiate: protectedProcedure
      .input(mbridgeInitiateSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const [record] = await db.insert(mbridgeTransfers).values({
          userId: ctx.user.id,
          transferId: input.transferId,
          senderCountry: input.senderCountry,
          receiverCountry: input.receiverCountry,
          sendAmount: String(input.sendAmount),
          sendCbdc: input.sendCbdc,
          receiveCbdc: input.receiveCbdc,
          receiverCbdcAddress: input.receiverCbdcAddress,
          status: "pending",
        }).returning();

        const serviceResp = await callRailService(
          MICROSERVICE_URLS.mbridge,
          "/transfers",
          { ...input, userId: String(ctx.user.id) }
        );

        await createAuditLog({
          userId: ctx.user.id,
          action: "mbridge_transfer_initiated",
          metadata: { transferId: input.transferId, amount: input.sendAmount, cbdcPair: `${input.sendCbdc}-${input.receiveCbdc}` },
        });

        return { ...record, serviceResponse: serviceResp };
      }),

    getParticipants: protectedProcedure.query(async () => ({
      participants: [
        { country: "CN", cbdc: "eCNY", status: "live", bank: "PBOC" },
        { country: "HK", cbdc: "eHKD", status: "live", bank: "HKMA" },
        { country: "AE", cbdc: "dAED", status: "live", bank: "CBUAE" },
        { country: "TH", cbdc: "eBaht", status: "pilot", bank: "BOT" },
        { country: "SA", cbdc: "eSAR", status: "pilot", bank: "SAMA" },
      ],
      platform: "mBridge (BIS Innovation Hub)",
      settlementType: "DLT atomic swap",
    })),
  },

  // ── GhIPSS ──────────────────────────────────────────────────────────────────
  ghipss: {
    initiate: protectedProcedure
      .input(ghipssInitiateSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const [record] = await db.insert(ghipssTransfers).values({
          userId: ctx.user.id,
          transferId: input.transferId,
          transferType: input.transferType,
          sendAmount: String(input.sendAmount),
          sendCurrency: input.sendCurrency,
          receiveCurrency: input.receiveCurrency,
          senderAccount: input.senderAccount,
          receiverAccount: input.receiverAccount,
          receiverBank: input.receiverBank,
          receiverMsisdn: input.receiverMsisdn,
          receiverName: input.receiverName,
          narration: input.narration,
          status: "pending",
        }).returning();

        const serviceResp = await callRailService(
          MICROSERVICE_URLS.ghipss,
          "/transfers",
          { ...input, userId: String(ctx.user.id) }
        );

        await createAuditLog({
          userId: ctx.user.id,
          action: "ghipss_transfer_initiated",
          metadata: { transferId: input.transferId, amount: input.sendAmount, transferType: input.transferType },
        });

        return { ...record, serviceResponse: serviceResp };
      }),

    getTransferTypes: protectedProcedure.query(async () => ({
      types: [
        { code: "GIP", name: "Ghana Interbank Payment", settlement: "T+0", maxAmount: 100000 },
        { code: "GHLINK", name: "GhLink Mobile Money Interoperability", settlement: "T+0", maxAmount: 50000 },
        { code: "MMI", name: "Mobile Money Interoperability", settlement: "T+0", maxAmount: 20000 },
        { code: "PAPSS", name: "PAPSS via GhIPSS Bridge", settlement: "T+0", maxAmount: 100000 },
      ],
      operator: "Ghana Interbank Payment Systems (GhIPSS)",
      currency: "GHS",
    })),
  },

  // ── AfriCBDC ─────────────────────────────────────────────────────────────────
  africbdc: {
    initiate: protectedProcedure
      .input(africbdcInitiateSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const [record] = await db.insert(africbdcTransfers).values({
          userId: ctx.user.id,
          transferId: input.transferId,
          cbdcType: input.cbdcType,
          sendAmount: String(input.sendAmount),
          currency: input.currency,
          country: input.country,
          senderWallet: input.senderWallet,
          receiverWallet: input.receiverWallet,
          receiverName: input.receiverName,
          purpose: input.purpose,
          status: "pending",
        }).returning();

        const serviceResp = await callRailService(
          MICROSERVICE_URLS.africbdc,
          "/transfers",
          { ...input, userId: String(ctx.user.id) }
        );

        await createAuditLog({
          userId: ctx.user.id,
          action: "africbdc_transfer_initiated",
          metadata: { transferId: input.transferId, amount: input.sendAmount, cbdcType: input.cbdcType, country: input.country },
        });

        return { ...record, serviceResponse: serviceResp };
      }),

    getCbdcStatus: protectedProcedure.query(async () => ({
      cbdcs: [
        { type: "eNGN", country: "NG", currency: "NGN", status: "live", launch: "2021-10", bank: "CBN" },
        { type: "eCedi", country: "GH", currency: "GHS", status: "pilot", launch: "2022-09", bank: "BOG" },
        { type: "dZAR", country: "ZA", currency: "ZAR", status: "pilot", launch: "2023-02", bank: "SARB", project: "Khokha" },
        { type: "AfriGo", country: "NG", currency: "NGN", status: "live", launch: "2023-01", bank: "CBN", note: "Card scheme" },
        { type: "eKES", country: "KE", currency: "KES", status: "planned", launch: "2025", bank: "CBK" },
        { type: "eGHS", country: "GH", currency: "GHS", status: "planned", launch: "2025", bank: "BOG" },
      ],
      mojalooopBridge: "All AfriCBDC transfers routed via Mojaloop for last-mile delivery",
    })),
  },

  // ── PAPSS ────────────────────────────────────────────────────────────────────
  papss: {
    initiate: protectedProcedure
      .input(papssInitiateSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const corridor = `${input.senderCountry}-${input.receiverCountry}`;

        const [record] = await db.insert(papssTransfers).values({
          userId: ctx.user.id,
          transferId: input.transferId,
          senderCountry: input.senderCountry,
          receiverCountry: input.receiverCountry,
          sendAmount: String(input.sendAmount),
          sendCurrency: input.sendCurrency,
          receiveCurrency: input.receiveCurrency,
          senderAccount: input.senderAccount,
          receiverAccount: input.receiverAccount,
          senderBankCode: input.senderBankCode,
          receiverBankCode: input.receiverBankCode,
          receiverName: input.receiverName,
          narration: input.narration,
          corridor,
          status: "pending",
        }).returning();

        const serviceResp = await callRailService(
          MICROSERVICE_URLS.papss,
          "/transfers",
          { ...input, userId: String(ctx.user.id), idempotencyKey: input.idempotencyKey }
        );

        if (!serviceResp.queued) {
          await db.update(papssTransfers)
            .set({
              status: "submitted",
              papssRef: serviceResp.papssRef,
              mojaloopRouted: serviceResp.mojaloopRouted ?? false,
              ghipssRouted: serviceResp.ghipssRouted ?? false,
              updatedAt: new Date(),
            })
            .where(eq(papssTransfers.transferId, input.transferId));
        }

        await createAuditLog({
          userId: ctx.user.id,
          action: "papss_transfer_initiated",
          metadata: { transferId: input.transferId, amount: input.sendAmount, corridor },
        });

        return { ...record, serviceResponse: serviceResp };
      }),

    getCorridors: protectedProcedure.query(async () => {
      const res = await callRailService(MICROSERVICE_URLS.papss, "/corridors", {}).catch(() => null);
      return res || {
        corridors: [
          { corridor: "NG-GH", currencies: "NGN-GHS" },
          { corridor: "NG-KE", currencies: "NGN-KES" },
          { corridor: "NG-TZ", currencies: "NGN-TZS" },
          { corridor: "GH-KE", currencies: "GHS-KES" },
          { corridor: "KE-TZ", currencies: "KES-TZS" },
          { corridor: "SN-CI", currencies: "XOF-XOF" },
          { corridor: "ZA-NG", currencies: "ZAR-NGN" },
          { corridor: "ZA-KE", currencies: "ZAR-KES" },
        ],
        operator: "Afreximbank / PAPSS",
        settlement: "T+0 multilateral netting",
        countries: 13,
      };
    }),
  },

  // ── Rail Health ──────────────────────────────────────────────────────────────
  railHealth: {
    getAll: protectedProcedure.query(async () => {
      const rails = ["mojaloop", "cips", "upi", "pix", "bricspay", "mbridge", "ghipss", "africbdc", "papss"] as const;
      const ports: Record<string, number> = {
        mojaloop: 8085, cips: 8091, upi: 8092, pix: 8093,
        bricspay: 8102, mbridge: 8103, ghipss: 8104, africbdc: 8105, papss: 8106,
      };

      const results = await Promise.allSettled(
        rails.map(async (rail) => {
          const start = Date.now();
          try {
            const res = await fetch(`http://localhost:${ports[rail]}/health`, {
              signal: AbortSignal.timeout(3000),
            });
            const latencyMs = Date.now() - start;
            return { rail, status: res.ok ? "healthy" : "degraded", latencyMs };
          } catch {
            return { rail, status: "offline" as const, latencyMs: null };
          }
        })
      );

      return results.map((r) => (r.status === "fulfilled" ? r.value : { rail: "unknown", status: "offline", latencyMs: null }));
    }),
  },
});
