/**
 * RemitAI — AI Financial Assistant.
 * Natural language transfers, spending insights, smart suggestions, multilingual.
 */
import { z } from "zod";
import { getDb } from "../db";
import { transactions, users, wallets, beneficiaries } from "../../drizzle/schema";
import { sql, eq, gte, desc, count, sum, and } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { safeParseAmount } from "./safeDecimal";

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string }> = [
  { pattern: /send\s+(\$|₦|£|€)?[\d,.]+\s+to\s+/i, intent: "transfer" },
  { pattern: /how\s+much\s+(did|have)\s+i\s+(send|sent|transfer)/i, intent: "spending_query" },
  { pattern: /what.*rate|exchange.*rate|fx.*rate/i, intent: "rate_query" },
  { pattern: /balance|how\s+much\s+do\s+i\s+have/i, intent: "balance_query" },
  { pattern: /history|recent.*transfer|past.*payment/i, intent: "history_query" },
  { pattern: /help|support|issue|problem/i, intent: "support" },
  { pattern: /kyc|verify|upgrade/i, intent: "kyc_query" },
];

function parseIntent(message: string): { intent: string; confidence: number } {
  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(message)) {
      return { intent, confidence: 0.85 };
    }
  }
  return { intent: "general", confidence: 0.3 };
}

function extractTransferDetails(message: string) {
  const amountMatch = message.match(/(\$|₦|£|€)?([\d,]+(?:\.\d{2})?)/);
  const recipientMatch = message.match(/to\s+([A-Za-z\s]+?)(?:\s+in|\s*$)/i);
  return {
    amount: amountMatch ? safeParseAmount(amountMatch[2].replace(",", "")) : null,
    currency: amountMatch?.[1] === "$" ? "USD" : amountMatch?.[1] === "₦" ? "NGN" : amountMatch?.[1] === "£" ? "GBP" : amountMatch?.[1] === "€" ? "EUR" : null,
    recipientName: recipientMatch?.[1]?.trim() ?? null,
  };
}

export const remitAiRouter = router({
  chat: protectedProcedure
    .input(z.object({ message: z.string().min(1).max(500), conversationId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const userId = ctx.user!.id;
      const { intent, confidence } = parseIntent(input.message);

      let response: { text: string; action?: Record<string, unknown>; suggestions?: string[] };

      switch (intent) {
        case "transfer": {
          const details = extractTransferDetails(input.message);
          if (details.amount && details.recipientName) {
            const matches = await db
              .select()
              .from(beneficiaries)
              .where(and(eq(beneficiaries.userId, userId), sql`LOWER(${beneficiaries.name}) LIKE ${`%${details.recipientName.toLowerCase()}%`}`))
              .limit(3);
            response = {
              text: matches.length > 0
                ? `I'll send ${details.currency ?? ""}${details.amount} to ${matches[0].name}. Confirm?`
                : `I found no beneficiary named "${details.recipientName}". Would you like to add them?`,
              action: matches.length > 0
                ? { type: "confirm_transfer", amount: details.amount, currency: details.currency, beneficiaryId: matches[0].id, beneficiaryName: matches[0].name }
                : { type: "add_beneficiary", name: details.recipientName },
              suggestions: ["Confirm", "Change amount", "Cancel"],
            };
          } else {
            response = { text: "How much would you like to send, and to whom?", suggestions: ["Send $200 to Mom", "Send ₦50,000 to John"] };
          }
          break;
        }
        case "balance_query": {
          const walletData = await db.select().from(wallets).where(eq(wallets.userId, userId));
          const balanceText = walletData.map((w: { currency: string; balance: string | null }) => `${w.currency}: ${Number(w.balance).toLocaleString()}`).join(", ");
          response = { text: `Your balances: ${balanceText || "No wallets found"}`, suggestions: ["Top up", "Send money", "Transaction history"] };
          break;
        }
        case "spending_query": {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
          const [stats] = await db
            .select({ total: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`, count: count() })
            .from(transactions)
            .where(and(eq(transactions.userId, userId), gte(transactions.createdAt, thirtyDaysAgo)));
          response = {
            text: `In the last 30 days, you've made ${stats?.count ?? 0} transfers totaling ${(stats?.total ?? 0).toLocaleString()}`,
            suggestions: ["Show by country", "Compare to last month", "Export report"],
          };
          break;
        }
        case "rate_query": {
          response = { text: "Check our live rates page for the latest exchange rates across all corridors.", action: { type: "navigate", url: "/exchange-rates" }, suggestions: ["Set rate alert", "Lock a rate", "Compare rates"] };
          break;
        }
        case "kyc_query": {
          const [user] = await db.select().from(users).where(eq(users.id, userId));
          response = {
            text: `Your current tier: ${user?.kycTier ?? "tier0"}. ${user?.kycTier === "tier3" ? "You have the highest verification level!" : "Upgrade to increase your limits."}`,
            action: { type: "navigate", url: "/kyc" },
            suggestions: ["Start upgrade", "What documents needed?", "My limits"],
          };
          break;
        }
        default: {
          response = {
            text: "I can help you with transfers, balances, rates, and account management. What would you like to do?",
            suggestions: ["Send money", "Check balance", "Exchange rates", "Transaction history"],
          };
        }
      }

      return { ...response, intent, confidence, conversationId: input.conversationId ?? `conv-${Date.now()}` };
    }),

  smartSuggestions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const userId = ctx.user!.id;
    const suggestions: Array<{ type: string; title: string; description: string; actionUrl: string }> = [];

    const recentTx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(10);

    if (recentTx.length === 0) {
      suggestions.push({ type: "first_transfer", title: "Send your first transfer", description: "Get started by sending money to family or friends", actionUrl: "/send" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user && (!user.kycTier || user.kycTier !== "tier3")) {
      suggestions.push({ type: "kyc_upgrade", title: "Upgrade your account", description: "Increase your transfer limits with KYC verification", actionUrl: "/kyc" });
    }

    const walletData = await db.select().from(wallets).where(eq(wallets.userId, userId));
    if (walletData.length <= 1) {
      suggestions.push({ type: "multi_currency", title: "Add another currency", description: "Hold multiple currencies for better rates", actionUrl: "/wallet" });
    }

    return suggestions;
  }),
});
