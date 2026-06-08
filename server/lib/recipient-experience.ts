/**
 * Recipient Experience — tracking, onboarding, preferences.
 */
import { z } from "zod";
import { getDb } from "../db";
import { transactions, beneficiaries, notifications } from "../../drizzle/schema";
import { sql, eq, and, desc, count } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const recipientExperienceRouter = router({
  trackDelivery: protectedProcedure
    .input(z.object({ transactionId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [tx] = await db.select().from(transactions).where(eq(transactions.id, input.transactionId));
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      const currentStage = tx.status === "delivered" ? 3 : tx.status === "completed" ? 2 : tx.status === "pending" ? 1 : 0;
      return {
        transactionId: tx.id,
        status: tx.status,
        currentStage,
        eta: tx.status === "delivered" ? "Delivered" : "2-4 hours",
        stages: [
          { name: "Initiated", done: true },
          { name: "Processing", done: currentStage >= 1 },
          { name: "Sent to Provider", done: currentStage >= 2 },
          { name: "Delivered", done: currentStage >= 3 },
        ],
      };
    }),

  recipientPreferences: protectedProcedure
    .input(z.object({ beneficiaryId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [bene] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, input.beneficiaryId));
      if (!bene) throw new TRPCError({ code: "NOT_FOUND", message: "Beneficiary not found" });
      return {
        id: bene.id,
        name: bene.name,
        preferredMethod: bene.bankName ? "bank_transfer" : "mobile_money",
        currency: bene.currency ?? "NGN",
      };
    }),

  updateRecipientPreferences: protectedProcedure
    .input(z.object({ beneficiaryId: z.number(), preferredMethod: z.enum(["bank_transfer", "mobile_money", "agent_cash", "wallet"]), preferredCurrency: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db.update(beneficiaries).set({ currency: input.preferredCurrency }).where(eq(beneficiaries.id, input.beneficiaryId));
      return { success: true };
    }),

  sendThankYou: protectedProcedure
    .input(z.object({ transactionId: z.number(), message: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [tx] = await db.select().from(transactions).where(eq(transactions.id, input.transactionId));
      if (!tx) throw new TRPCError({ code: "NOT_FOUND" });
      await db.insert(notifications).values({
        userId: tx.userId,
        type: "system",
        title: "Thank you received!",
        message: input.message || "Your recipient acknowledged the transfer",
        isRead: false,
      });
      return { sent: true };
    }),

  recipientStats: protectedProcedure
    .input(z.object({ recipientName: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [stats] = await db
        .select({
          totalSent: sql<number>`COALESCE(SUM(CAST(${transactions.fromAmount} AS numeric)), 0)`,
          txCount: count(),
          lastDate: sql<Date>`MAX(${transactions.createdAt})`,
        })
        .from(transactions)
        .where(and(eq(transactions.userId, ctx.user!.id), eq(transactions.recipientName, input.recipientName)));
      return {
        totalAmountSent: stats?.totalSent ?? 0,
        transferCount: stats?.txCount ?? 0,
        lastTransferDate: stats?.lastDate?.toISOString() ?? null,
      };
    }),
});
