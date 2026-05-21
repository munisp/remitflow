/**
 * Loyalty Points Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a loyalty/rewards program:
 * - Earn points on transfers
 * - Tier-based multipliers
 * - Redeem points for fee discounts
 * - Point expiry (12 months)
 * - Leaderboard
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { createAuditLog } from "../db";

interface PointsAccount {
  userId: number;
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
  transactions: PointsTransaction[];
}

interface PointsTransaction {
  id: string;
  type: "earn" | "redeem" | "expire" | "bonus";
  amount: number;
  description: string;
  timestamp: string;
}

const TIER_MULTIPLIERS: Record<string, number> = {
  bronze: 1.0,
  silver: 1.25,
  gold: 1.5,
  platinum: 2.0,
};

const TIER_THRESHOLDS: Record<string, number> = {
  bronze: 0,
  silver: 500,
  gold: 2000,
  platinum: 10000,
};

// In-memory store (production: PostgreSQL)
const pointsAccounts = new Map<number, PointsAccount>();

function getOrCreateAccount(userId: number): PointsAccount {
  let account = pointsAccounts.get(userId);
  if (!account) {
    account = {
      userId,
      balance: 0,
      lifetimeEarned: 0,
      lifetimeRedeemed: 0,
      tier: "bronze",
      transactions: [],
    };
    pointsAccounts.set(userId, account);
  }
  return account;
}

function updateTier(account: PointsAccount): void {
  if (account.lifetimeEarned >= TIER_THRESHOLDS.platinum) {
    account.tier = "platinum";
  } else if (account.lifetimeEarned >= TIER_THRESHOLDS.gold) {
    account.tier = "gold";
  } else if (account.lifetimeEarned >= TIER_THRESHOLDS.silver) {
    account.tier = "silver";
  } else {
    account.tier = "bronze";
  }
}

export const loyaltyPointsRouter = router({
  // Get points balance
  getBalance: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(({ input }) => {
      const account = getOrCreateAccount(input.userId);
      return {
        balance: account.balance,
        tier: account.tier,
        multiplier: TIER_MULTIPLIERS[account.tier],
        lifetimeEarned: account.lifetimeEarned,
        lifetimeRedeemed: account.lifetimeRedeemed,
        nextTier: account.tier === "platinum" ? null : {
          tier: account.tier === "bronze" ? "silver" : account.tier === "silver" ? "gold" : "platinum",
          pointsNeeded: (account.tier === "bronze" ? TIER_THRESHOLDS.silver : account.tier === "silver" ? TIER_THRESHOLDS.gold : TIER_THRESHOLDS.platinum) - account.lifetimeEarned,
        },
      };
    }),

  // Earn points from a transfer
  earnPoints: publicProcedure
    .input(z.object({
      userId: z.number(),
      transferAmount: z.number().positive(),
      currency: z.string().length(3),
      corridor: z.string(),
    }))
    .mutation(({ input }) => {
      const account = getOrCreateAccount(input.userId);
      const basePoints = Math.floor(input.transferAmount / 10); // 1 point per $10
      const multiplier = TIER_MULTIPLIERS[account.tier];
      const points = Math.floor(basePoints * multiplier);

      account.balance += points;
      account.lifetimeEarned += points;
      account.transactions.push({
        id: `pt_${Date.now()}`,
        type: "earn",
        amount: points,
        description: `Transfer of ${input.transferAmount} ${input.currency} (${input.corridor})`,
        timestamp: new Date().toISOString(),
      });

      updateTier(account);

      logger.info({ userId: input.userId, points, tier: account.tier }, "Points earned");

      return {
        pointsEarned: points,
        newBalance: account.balance,
        tier: account.tier,
        multiplier,
      };
    }),

  // Redeem points for a fee discount
  redeemPoints: publicProcedure
    .input(z.object({
      userId: z.number(),
      points: z.number().positive(),
    }))
    .mutation(({ input }) => {
      const account = getOrCreateAccount(input.userId);
      if (account.balance < input.points) {
        return { success: false, reason: "Insufficient points" };
      }

      const discountAmount = input.points * 0.01; // 1 point = $0.01 discount
      account.balance -= input.points;
      account.lifetimeRedeemed += input.points;
      account.transactions.push({
        id: `pt_${Date.now()}`,
        type: "redeem",
        amount: -input.points,
        description: `Redeemed for $${discountAmount.toFixed(2)} fee discount`,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        pointsRedeemed: input.points,
        discountAmount,
        newBalance: account.balance,
      };
    }),

  // Get points history
  getHistory: publicProcedure
    .input(z.object({
      userId: z.number(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(({ input }) => {
      const account = getOrCreateAccount(input.userId);
      return {
        transactions: account.transactions.slice(-input.limit).reverse(),
        total: account.transactions.length,
      };
    }),
});
