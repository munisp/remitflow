import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { westAfricaTransfers } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

const XOF_ADAPTER_URL = process.env.XOF_ADAPTER_URL ?? "http://go-xof-adapter:8095";

const corridorCodeSchema = z.enum(["TG", "NE", "ML", "BJ", "GH"]);

async function callXofAdapter(path: string, body?: object) {
  const res = await fetch(`${XOF_ADAPTER_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `XOF adapter error: ${err}` });
  }
  return res.json();
}

export const westAfricaRouter = router({
  getXofFxRates: protectedProcedure.query(async () => {
    try {
      return await callXofAdapter("/fx-rates");
    } catch {
      // Return fallback rates if service unavailable
      return {
        TG: { xof_per_ngn: 0.383, bid: 0.380, ask: 0.386, spread_bps: 150 },
        NE: { xof_per_ngn: 0.383, bid: 0.380, ask: 0.386, spread_bps: 150 },
        ML: { xof_per_ngn: 0.383, bid: 0.380, ask: 0.386, spread_bps: 150 },
        BJ: { xof_per_ngn: 0.383, bid: 0.380, ask: 0.386, spread_bps: 150 },
        GH: { ghs_per_ngn: 0.0042, bid: 0.0041, ask: 0.0043, spread_bps: 200 },
        source: "fallback",
        timestamp: Date.now(),
      };
    }
  }),

  getXofQuote: protectedProcedure
    .input(z.object({
      corridorCode: corridorCodeSchema,
      amountNgn: z.number().positive().max(10_000_000),
    }))
    .query(async ({ input, ctx }) => {
      return callXofAdapter("/quote", {
        corridor_code: input.corridorCode,
        amount_ngn: input.amountNgn,
        user_id: ctx.user.id,
      });
    }),

  submitXofTransfer: protectedProcedure
    .input(z.object({
      corridorCode: corridorCodeSchema,
      amountNgn: z.number().positive().max(10_000_000),
      recipientMobileMoney: z.string().min(10).max(20),
      recipientName: z.string().min(2).max(100),
      mojaloopDfspId: z.string().min(2).max(50),
      purposeCode: z.string().default("FAM"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Create local record first
      const transferId = `XOF-${Date.now()}-${ctx.user.id}`;
      await db.insert(westAfricaTransfers).values({
        transferId,
        userId: ctx.user.id,
        corridorCode: input.corridorCode,
        amountNgn: input.amountNgn.toString(),
        recipientMobileMoney: input.recipientMobileMoney,
        recipientName: input.recipientName,
        mojaloopDfspId: input.mojaloopDfspId,
        purposeCode: input.purposeCode,
        status: "pending",
        createdAt: new Date(),
      });

      // Submit to XOF adapter
      const result = await callXofAdapter("/submit", {
        transfer_id: transferId,
        corridor_code: input.corridorCode,
        amount_ngn: input.amountNgn,
        recipient_mobile_money: input.recipientMobileMoney,
        recipient_name: input.recipientName,
        mojaloop_dfsp_id: input.mojaloopDfspId,
        purpose_code: input.purposeCode,
        user_id: ctx.user.id,
      });

      // Update status
      await db.update(westAfricaTransfers)
        .set({ status: result.status ?? "processing", mojaloopTxnId: result.mojaloop_txn_id })
        .where(eq(westAfricaTransfers.transferId, transferId)).returning();

      return { ...result, transferId };
    }),

  getXofTransferHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      return db.select().from(westAfricaTransfers)
        .where(eq(westAfricaTransfers.userId, ctx.user.id))
        .orderBy(desc(westAfricaTransfers.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getXofTransferStatus: protectedProcedure
    .input(z.object({ transferId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const [transfer] = await db.select().from(westAfricaTransfers)
        .where(and(
          eq(westAfricaTransfers.transferId, input.transferId),
          eq(westAfricaTransfers.userId, ctx.user.id),
        ));
      if (!transfer) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      return transfer;
    }),

  getXofCorridorStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const transfers = await db.select().from(westAfricaTransfers)
      .where(eq(westAfricaTransfers.userId, ctx.user.id));
    const stats: Record<string, { count: number; totalNgn: number }> = {};
    for (const t of transfers) {
      if (!stats[t.corridorCode]) stats[t.corridorCode] = { count: 0, totalNgn: 0 };
      stats[t.corridorCode].count++;
      stats[t.corridorCode].totalNgn += parseFloat(t.amountNgn ?? "0");
    }
    return stats;
  }),
});
