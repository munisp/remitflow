/**
 * Loyalty Points Router — DB-backed
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a loyalty/rewards program:
 * - Earn points on transfers (tier-based multipliers)
 * - Redeem points for fee discounts
 * - Point expiry (12 months rolling)
 * - Tier promotion/demotion based on lifetime earned
 * - Leaderboard
 * - Bonus point campaigns
 *
 * Uses SQL via getDb() — no in-memory state.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { getDb, createAuditLog } from "../db";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { broadcastUserEvent } from "../sse.service";

type Tier = "bronze" | "silver" | "gold" | "platinum";

const TIER_MULTIPLIERS: Record<Tier, number> = {
  bronze: 1.0,
  silver: 1.25,
  gold: 1.5,
  platinum: 2.0,
};

const TIER_THRESHOLDS: Record<Tier, number> = {
  bronze: 0,
  silver: 500,
  gold: 2000,
  platinum: 10000,
};

const TIER_ORDER: Tier[] = ["bronze", "silver", "gold", "platinum"];

function computeTier(lifetimeEarned: number): Tier {
  if (lifetimeEarned >= TIER_THRESHOLDS.platinum) return "platinum";
  if (lifetimeEarned >= TIER_THRESHOLDS.gold) return "gold";
  if (lifetimeEarned >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

function nextTierInfo(tier: Tier, lifetimeEarned: number) {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx >= TIER_ORDER.length - 1) return null;
  const next = TIER_ORDER[idx + 1];
  return { tier: next, pointsNeeded: TIER_THRESHOLDS[next] - lifetimeEarned };
}

const POINTS_EXPIRY_MONTHS = 12;
const POINTS_PER_UNIT = 10; // 1 point per $10 transferred
const REDEMPTION_VALUE = 0.01; // 1 point = $0.01 discount

async function ensureLoyaltyTables(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      balance INTEGER NOT NULL DEFAULT 0,
      lifetime_earned INTEGER NOT NULL DEFAULT 0,
      lifetime_redeemed INTEGER NOT NULL DEFAULT 0,
      tier VARCHAR(20) NOT NULL DEFAULT 'bronze',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL,
      amount INTEGER NOT NULL,
      description VARCHAR(500),
      expires_at TIMESTAMPTZ,
      expired BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user ON loyalty_transactions(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_loyalty_tx_expires ON loyalty_transactions(expires_at) WHERE expired = FALSE AND type = 'earn'`);
}

async function getOrCreateAccount(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const rows = await db.execute(sql`SELECT * FROM loyalty_accounts WHERE user_id = ${userId}`);
  const existing = (rows as unknown as Array<Record<string, unknown>>)[0];
  if (existing) return existing;
  const inserted = await db.execute(sql`
    INSERT INTO loyalty_accounts (user_id, balance, lifetime_earned, lifetime_redeemed, tier)
    VALUES (${userId}, 0, 0, 0, 'bronze')
    ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
    RETURNING *
  `);
  return (inserted as unknown as Array<Record<string, unknown>>)[0];
}

export const loyaltyPointsRouter = router({
  getBalance: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureLoyaltyTables(db);
      const account = await getOrCreateAccount(db, ctx.user.id);
      const balance = Number(account.balance) || 0;
      const lifetimeEarned = Number(account.lifetime_earned) || 0;
      const lifetimeRedeemed = Number(account.lifetime_redeemed) || 0;
      const tier = (account.tier as Tier) || "bronze";
      return {
        balance,
        tier,
        multiplier: TIER_MULTIPLIERS[tier],
        lifetimeEarned,
        lifetimeRedeemed,
        nextTier: nextTierInfo(tier, lifetimeEarned),
      };
    }),

  earnPoints: protectedProcedure
    .input(z.object({
      transferAmount: z.number().positive().max(10_000_000),
      currency: z.string().length(3),
      corridor: z.string(),
      transferId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureLoyaltyTables(db);
      const account = await getOrCreateAccount(db, ctx.user.id);
      const currentTier = (account.tier as Tier) || "bronze";
      const basePoints = Math.floor(input.transferAmount / POINTS_PER_UNIT);
      const multiplier = TIER_MULTIPLIERS[currentTier];
      const points = Math.floor(basePoints * multiplier);
      if (points <= 0) {
        return { pointsEarned: 0, newBalance: Number(account.balance), tier: currentTier, multiplier };
      }
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + POINTS_EXPIRY_MONTHS);

      await db.execute(sql`
        INSERT INTO loyalty_transactions (user_id, type, amount, description, expires_at)
        VALUES (${ctx.user.id}, 'earn', ${points}, ${`Transfer of ${input.transferAmount} ${input.currency} (${input.corridor})`}, ${expiresAt})
      `);
      const newLifetime = Number(account.lifetime_earned) + points;
      const newBalance = Number(account.balance) + points;
      const newTier = computeTier(newLifetime);
      await db.execute(sql`
        UPDATE loyalty_accounts
        SET balance = ${newBalance}, lifetime_earned = ${newLifetime}, tier = ${newTier}, updated_at = NOW()
        WHERE user_id = ${ctx.user.id}
      `);
      if (newTier !== currentTier) {
        logger.info({ userId: ctx.user.id, oldTier: currentTier, newTier }, "Loyalty tier promotion");
        await createAuditLog({ userId: ctx.user.id, action: "LOYALTY_TIER_CHANGE", metadata: { from: currentTier, to: newTier } });
      }
      logger.info({ userId: ctx.user.id, points, tier: newTier }, "Points earned");
      // Kafka event for points earning
      publishEvent(KAFKA_TOPICS.TRANSACTIONS, `loyalty:earn:${ctx.user.id}:${Date.now()}`, {
        eventType: "loyalty_points_earned",
        userId: ctx.user.id,
        pointsEarned: points,
        newBalance,
        tier: newTier,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Loyalty] Kafka event failed"));

      if (newTier !== currentTier) {
        broadcastUserEvent(ctx.user.id, {
          type: "transfer_received",
          payload: { title: "Tier Promotion!", message: `Congratulations! You are now ${newTier} tier.` },
        });
      }

      return { pointsEarned: points, newBalance, tier: newTier, multiplier };
    }),

  redeemPoints: protectedProcedure
    .input(z.object({ points: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureLoyaltyTables(db);
      const account = await getOrCreateAccount(db, ctx.user.id);
      const currentBalance = Number(account.balance);
      if (currentBalance < input.points) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient points: have ${currentBalance}, need ${input.points}` });
      }
      const discountAmount = input.points * REDEMPTION_VALUE;
      const newBalance = currentBalance - input.points;
      const newRedeemed = Number(account.lifetime_redeemed) + input.points;
      await db.execute(sql`
        INSERT INTO loyalty_transactions (user_id, type, amount, description)
        VALUES (${ctx.user.id}, 'redeem', ${-input.points}, ${`Redeemed for $${discountAmount.toFixed(2)} fee discount`})
      `);
      await db.execute(sql`
        UPDATE loyalty_accounts
        SET balance = ${newBalance}, lifetime_redeemed = ${newRedeemed}, updated_at = NOW()
        WHERE user_id = ${ctx.user.id}
      `);
      await createAuditLog({ userId: ctx.user.id, action: "LOYALTY_REDEEM", metadata: { points: input.points, discount: discountAmount } });

      // Kafka event for points redemption
      publishEvent(KAFKA_TOPICS.TRANSACTIONS, `loyalty:redeem:${ctx.user.id}:${Date.now()}`, {
        eventType: "loyalty_points_redeemed",
        userId: ctx.user.id,
        pointsRedeemed: input.points,
        discountAmount,
        newBalance,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Loyalty] Kafka event failed"));

      broadcastUserEvent(ctx.user.id, {
        type: "transfer_received",
        payload: { title: "Points Redeemed", message: `${input.points} points redeemed for $${discountAmount.toFixed(2)} discount` },
      });

      return { pointsRedeemed: input.points, discountAmount, newBalance };
    }),

  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureLoyaltyTables(db);
      const rows = await db.execute(sql`
        SELECT id, type, amount, description, expires_at, expired, created_at
        FROM loyalty_transactions
        WHERE user_id = ${ctx.user.id}
        ORDER BY created_at DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
      const countResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM loyalty_transactions WHERE user_id = ${ctx.user.id}`);
      const total = Number((countResult as unknown as Array<Record<string, unknown>>)[0]?.total) || 0;
      return { transactions: rows as unknown as Array<Record<string, unknown>>, total };
    }),

  expireOldPoints: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureLoyaltyTables(db);
      const now = new Date();
      const expired = await db.execute(sql`
        UPDATE loyalty_transactions
        SET expired = TRUE
        WHERE user_id = ${ctx.user.id} AND type = 'earn' AND expired = FALSE AND expires_at < ${now}
        RETURNING amount
      `);
      const expiredRows = expired as unknown as Array<Record<string, unknown>>;
      const totalExpired = expiredRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      if (totalExpired > 0) {
        await db.execute(sql`
          UPDATE loyalty_accounts SET balance = GREATEST(0, balance - ${totalExpired}), updated_at = NOW()
          WHERE user_id = ${ctx.user.id}
        `);
        await db.execute(sql`
          INSERT INTO loyalty_transactions (user_id, type, amount, description)
          VALUES (${ctx.user.id}, 'expire', ${-totalExpired}, ${`${expiredRows.length} point batches expired after ${POINTS_EXPIRY_MONTHS} months`})
        `);
        logger.info({ userId: ctx.user.id, totalExpired, batches: expiredRows.length }, "Points expired");
      }
      return { expiredPoints: totalExpired, batchesExpired: expiredRows.length };
    }),

  leaderboard: protectedProcedure
    .input(z.object({ limit: z.number().min(5).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureLoyaltyTables(db);
      const rows = await db.execute(sql`
        SELECT la.user_id, la.balance, la.lifetime_earned, la.tier, u.name
        FROM loyalty_accounts la
        LEFT JOIN users u ON u.id = la.user_id
        ORDER BY la.lifetime_earned DESC
        LIMIT ${input.limit}
      `);
      return { leaderboard: (rows as unknown as Array<Record<string, unknown>>).map((r, i) => ({ rank: i + 1, userId: r.user_id, name: r.name || `User ${r.user_id}`, balance: Number(r.balance), lifetimeEarned: Number(r.lifetime_earned), tier: r.tier })) };
    }),
});
