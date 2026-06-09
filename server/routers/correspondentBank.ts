import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { correspondentBanksV200 as correspondentBanks, correspondentSettlements } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

const CORRESPONDENT_URL = process.env.CORRESPONDENT_MANAGER_URL ?? "http://go-correspondent-manager:8096";

async function callCorrespondentService(path: string, body?: object) {
  const res = await fetch(`${CORRESPONDENT_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Service error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Correspondent service error: ${err}` });
  }
  return res.json();
}

function requireAdmin(role: string | null) {
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
}

export const correspondentBankRouter = router({
  getCorrespondents: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const db = await getDb();
    return db.select().from(correspondentBanks).orderBy(correspondentBanks.bankName);
  }),

  getCorrespondentBalances: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    try {
      return await callCorrespondentService("/balances");
    } catch {
      // Return DB balances as fallback
      const db = await getDb();
      const banks = await db.select().from(correspondentBanks);
      return banks.map((b: any) => ({
        correspondent_id: b.correspondentId,
        bank_name: b.bankName,
        currency: b.currency,
        nostro_balance_usd: parseFloat(b.nostroBalanceUsd ?? "0"),
        vostro_balance_usd: parseFloat(b.vostroBalanceUsd ?? "0"),
        clearing_line_usd: parseFloat(b.clearingLineUsd ?? "0"),
        utilization_pct: parseFloat(b.utilizationPct ?? "0"),
        source: "database",
      }));
    }
  }),

  addCorrespondent: protectedProcedure
    .input(z.object({
      bankName: z.string().min(2).max(200),
      swiftCode: z.string().min(8).max(11),
      countryCode: z.string().length(2),
      currency: z.string().length(3),
      clearingLineUsd: z.number().positive(),
      feeBps: z.number().min(0).max(500).default(50),
      settlementRail: z.enum(["swift", "sepa", "ach", "rtgs", "mojaloop"]).default("swift"),
    }))
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);
      const db = await getDb();
      const correspondentId = `CORR-${input.swiftCode}-${Date.now()}`;
      const [_row] = await db.insert(correspondentBanks).values({
        correspondentId,
        bankName: input.bankName,
        swiftCode: input.swiftCode,
        countryCode: input.countryCode,
        currency: input.currency,
        clearingLineUsd: input.clearingLineUsd.toString(),
        nostroBalanceUsd: "0",
        vostroBalanceUsd: "0",
        utilizationPct: "0",
        feeBps: input.feeBps.toString(),
        settlementRail: input.settlementRail,
        status: "active",
        createdAt: new Date(),
      }).returning();
      return { correspondentId, success: true, verified: true };
    }),

  updateCorrespondentStatus: protectedProcedure
    .input(z.object({
      correspondentId: z.string(),
      status: z.enum(["active", "suspended", "inactive"]),
    }))
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);
      const db = await getDb();
      const [_row] = await db.update(correspondentBanks)
        .set({ status: input.status })
        .where(eq(correspondentBanks.correspondentId, input.correspondentId)).returning();
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  triggerRebalance: protectedProcedure
    .input(z.object({
      correspondentId: z.string(),
      currency: z.string().length(3),
      amount: z.number().positive(),
      direction: z.enum(["nostro_top_up", "vostro_drawdown"]),
    }))
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);
      return callCorrespondentService("/rebalance", {
        correspondent_id: input.correspondentId,
        currency: input.currency,
        amount: input.amount,
        direction: input.direction,
      });
    }),

  getSettlementHistory: protectedProcedure
    .input(z.object({
      correspondentId: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      requireAdmin(ctx.user.role);
      const db = await getDb();
      return db.select().from(correspondentSettlements)
        .where(eq(correspondentSettlements.correspondentId, input.correspondentId))
        .orderBy(desc(correspondentSettlements.createdAt))
        .limit(input.limit);
    }),

  getCorrespondentAnalytics: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const db = await getDb();
    const banks = await db.select().from(correspondentBanks);
    const totalClearingLine = banks.reduce((s: any, b: any) => s + parseFloat(b.clearingLineUsd ?? "0"), 0);
    const totalNostro = banks.reduce((s: any, b: any) => s + parseFloat(b.nostroBalanceUsd ?? "0"), 0);
    const avgFeeBps = banks.length > 0
      ? banks.reduce((s: any, b: any) => s + parseFloat(b.feeBps ?? "50"), 0) / banks.length
      : 0;
    return {
      totalCorrespondents: banks.length,
      activeCorrespondents: banks.filter((b: any) => b.status === "active").length,
      totalClearingLineUsd: totalClearingLine,
      totalNostroBalanceUsd: totalNostro,
      avgFeeBps: avgFeeBps.toFixed(1),
      byCountry: banks.reduce((acc: Record<string, number>, b: any) => {
        acc[b.countryCode ?? "XX"] = (acc[b.countryCode ?? "XX"] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }),
});
