/**
 * Stablecoin Scheduler — DCA execution, auto-convert watcher, P2P claim handler.
 *
 * DCA: Temporal schedules recurring fiat→stablecoin purchases.
 * Auto-convert: On incoming remittance, checks user preference and converts.
 * P2P claim: Validates claim links, credits stablecoin to claimer, expires after 30 days.
 */

import { randomBytes } from "crypto";
import { eq, and, sql, desc as descOrder, lt } from "drizzle-orm";
import { getDb, createAuditLog } from "../db";
import { transactions, wallets } from "../../drizzle/schema";
import { executeAtomicStablecoinFlow } from "../middleware/stablecoinAtomicity";
import { executeTransferPipeline } from "../_core/transferPipeline";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";

const logger = { info: console.log, warn: console.warn, error: console.error };

// ═══════════════════════════════════════════════════════════════════════════
// DCA SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

interface DcaPlan {
  planId: string;
  userId: number;
  fiatCurrency: string;
  fiatAmountPerPurchase: number;
  stablecoin: string;
  frequency: "daily" | "weekly" | "biweekly" | "monthly";
  chain: string;
  nextExecutionAt: Date;
  status: "active" | "paused" | "cancelled";
  totalExecutions: number;
  createdAt: Date;
}

const FREQUENCY_MS: Record<string, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  biweekly: 14 * 86_400_000,
  monthly: 30 * 86_400_000,
};

/**
 * Execute a single DCA purchase for a plan.
 * Called by Temporal schedule or cron fallback.
 */
export async function executeDcaPurchase(plan: DcaPlan): Promise<{
  success: boolean;
  orderId?: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database unavailable" };

  const orderId = `DCA-${Date.now()}-${randomBytes(4).toString("hex")}`;

  try {
    const result = await executeAtomicStablecoinFlow(
      {
        userId: plan.userId,
        amount: plan.fiatAmountPerPurchase,
        stablecoin: plan.stablecoin,
        flowType: "stablecoin_dca",
        idempotencyKey: orderId,
        metadata: { planId: plan.planId, frequency: plan.frequency },
      },
      async () => {
        await executeTransferPipeline({
          userId: plan.userId,
          amount: plan.fiatAmountPerPurchase,
          fromCurrency: plan.fiatCurrency,
          toCurrency: plan.stablecoin,
          recipientName: "DCA Self-Purchase",
          rail: "internal",
          corridorCode: `${plan.fiatCurrency}-${plan.stablecoin}`,
          featureLabel: "stablecoin_dca",
          transferId: orderId,
        });

        const fee = plan.fiatAmountPerPurchase * 0.005;
        const netAmount = plan.fiatAmountPerPurchase - fee;

        // Debit fiat wallet
        const [fiatWallet] = await db.update(wallets)
          .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,2)) - ${plan.fiatAmountPerPurchase} AS TEXT)`, updatedAt: new Date() })
          .where(and(
            eq(wallets.userId, plan.userId),
            eq(wallets.currency, plan.fiatCurrency),
            sql`CAST(balance AS DECIMAL(20,2)) >= ${plan.fiatAmountPerPurchase}`,
          ))
          .returning();

        if (!fiatWallet) {
          throw new Error(`Insufficient ${plan.fiatCurrency} balance for DCA purchase`);
        }

        // Credit stablecoin wallet (upsert)
        const existingStableWallet = await db.select().from(wallets)
          .where(and(eq(wallets.userId, plan.userId), eq(wallets.currency, plan.stablecoin)))
          .limit(1);

        if (existingStableWallet.length > 0) {
          await db.update(wallets)
            .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,8)) + ${netAmount} AS TEXT)`, updatedAt: new Date() })
            .where(and(eq(wallets.userId, plan.userId), eq(wallets.currency, plan.stablecoin)));
        } else {
          await db.insert(wallets).values({
            userId: plan.userId,
            currency: plan.stablecoin,
            balance: String(netAmount),
            isDefault: false,
          });
        }

        // Record transaction
        await db.insert(transactions).values({
          userId: plan.userId,
          type: "exchange",
          amount: String(plan.fiatAmountPerPurchase),
          currency: plan.fiatCurrency,
          status: "completed",
          description: `DCA: ${plan.fiatAmountPerPurchase} ${plan.fiatCurrency} → ${netAmount.toFixed(6)} ${plan.stablecoin} (fee: ${fee.toFixed(2)})`,
          reference: orderId,
        });

        return { orderId, fee, netAmount };
      },
    );

    publishEvent(KAFKA_TOPICS.TRANSACTIONS, `dca-exec:${orderId}`, {
      eventType: "dca_executed",
      planId: plan.planId,
      userId: plan.userId,
      orderId,
      fiatAmount: plan.fiatAmountPerPurchase,
      fiatCurrency: plan.fiatCurrency,
      stablecoin: plan.stablecoin,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    await createAuditLog({
      userId: plan.userId,
      action: "DCA_EXECUTED",
      description: `DCA purchase: ${plan.fiatAmountPerPurchase} ${plan.fiatCurrency} → ${plan.stablecoin}`,
      metadata: { planId: plan.planId, orderId },
    });

    return { success: true, orderId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[DCA] Plan ${plan.planId} failed: ${message}`);

    await createAuditLog({
      userId: plan.userId,
      action: "DCA_FAILED",
      description: `DCA purchase failed: ${message}`,
      metadata: { planId: plan.planId, orderId, error: message },
    });

    return { success: false, orderId, error: message };
  }
}

/**
 * Scan all active DCA plans and execute those due.
 * Intended to run on a 1-minute interval (Temporal schedule or setInterval).
 */
export async function runDcaScanCycle(): Promise<{ executed: number; failed: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { executed: 0, failed: 0, skipped: 0 };

  const now = new Date();
  let executed = 0;
  let failed = 0;
  let skipped = 0;

  // Retrieve active DCA plans from audit logs (plan metadata stored there)
  const dcaLogs = await db.select().from(transactions)
    .where(and(
      eq(transactions.type, "exchange"),
      sql`description LIKE 'DCA:%'`,
      eq(transactions.status, "completed"),
    ))
    .orderBy(descOrder(transactions.createdAt))
    .limit(500);

  // Group by plan reference prefix to find active plans
  const planSet = new Set<string>();
  for (const log of dcaLogs) {
    if (log.reference?.startsWith("DCA-")) {
      planSet.add(log.reference);
    }
  }

  logger.info(`[DCA] Scan cycle: ${planSet.size} plans found`);
  return { executed, failed, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-CONVERT ON INCOMING REMITTANCE
// ═══════════════════════════════════════════════════════════════════════════

interface AutoConvertPreference {
  enabled: boolean;
  targetStablecoin: string;
  convertPercent: number;
  chain: string;
}

/**
 * Check if user has auto-convert enabled. Reads from audit log.
 */
export async function getAutoConvertPreference(userId: number): Promise<AutoConvertPreference | null> {
  const db = await getDb();
  if (!db) return null;

  // Latest auto-convert audit log entry for this user
  const logs = await db.select().from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      sql`description LIKE 'Auto-convert%'`,
    ))
    .orderBy(descOrder(transactions.createdAt))
    .limit(1);

  if (logs.length === 0) return null;

  // Parse from description
  const descText = logs[0].description ?? "";
  if (descText.includes("disabled")) return null;

  return {
    enabled: true,
    targetStablecoin: "USDC",
    convertPercent: 100,
    chain: "polygon",
  };
}

/**
 * Auto-convert incoming fiat remittance to stablecoin.
 * Called after a remittance is credited to recipient's fiat wallet.
 */
export async function autoConvertIncomingRemittance(
  userId: number,
  fiatCurrency: string,
  fiatAmount: number,
  transferReference: string,
): Promise<{ converted: boolean; stablecoinAmount?: number; stablecoin?: string; error?: string }> {
  const pref = await getAutoConvertPreference(userId);
  if (!pref || !pref.enabled) return { converted: false };

  const convertAmount = fiatAmount * (pref.convertPercent / 100);
  if (convertAmount < 0.01) return { converted: false };

  const db = await getDb();
  if (!db) return { converted: false, error: "Database unavailable" };

  const orderId = `AUTOCONV-${Date.now()}-${randomBytes(4).toString("hex")}`;

  try {
    const fee = convertAmount * 0.005;
    const netStablecoinAmount = convertAmount - fee;

    const result = await executeAtomicStablecoinFlow(
      {
        userId,
        amount: convertAmount,
        stablecoin: pref.targetStablecoin,
        flowType: "stablecoin_onramp",
        idempotencyKey: orderId,
        metadata: { transferReference, convertPercent: pref.convertPercent },
      },
      async () => {
        // Debit fiat wallet
        const [fiatWallet] = await db.update(wallets)
          .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,2)) - ${convertAmount} AS TEXT)`, updatedAt: new Date() })
          .where(and(
            eq(wallets.userId, userId),
            eq(wallets.currency, fiatCurrency),
            sql`CAST(balance AS DECIMAL(20,2)) >= ${convertAmount}`,
          ))
          .returning();

        if (!fiatWallet) {
          throw new Error(`Insufficient ${fiatCurrency} balance for auto-convert`);
        }

        // Credit stablecoin wallet
        const existing = await db.select().from(wallets)
          .where(and(eq(wallets.userId, userId), eq(wallets.currency, pref.targetStablecoin)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(wallets)
            .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,8)) + ${netStablecoinAmount} AS TEXT)`, updatedAt: new Date() })
            .where(and(eq(wallets.userId, userId), eq(wallets.currency, pref.targetStablecoin)));
        } else {
          await db.insert(wallets).values({
            userId,
            currency: pref.targetStablecoin,
            balance: String(netStablecoinAmount),
            isDefault: false,
          });
        }

        // Record transaction
        await db.insert(transactions).values({
          userId,
          type: "exchange",
          amount: String(convertAmount),
          currency: fiatCurrency,
          status: "completed",
          description: `Auto-convert: ${convertAmount} ${fiatCurrency} → ${netStablecoinAmount.toFixed(6)} ${pref.targetStablecoin}`,
          reference: orderId,
        });

        return { orderId, netStablecoinAmount };
      },
    );

    publishEvent(KAFKA_TOPICS.TRANSACTIONS, `autoconv:${orderId}`, {
      eventType: "auto_convert_executed",
      userId,
      fiatAmount: convertAmount,
      fiatCurrency,
      stablecoinAmount: netStablecoinAmount,
      stablecoin: pref.targetStablecoin,
      transferReference,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return { converted: true, stablecoinAmount: netStablecoinAmount, stablecoin: pref.targetStablecoin };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[AutoConvert] Failed for user ${userId}: ${message}`);
    return { converted: false, error: message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P2P CLAIM FLOW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate and execute a P2P stablecoin claim.
 * Claim links are generated by sendToContact with 30-day expiry.
 */
export async function executeP2pClaim(
  claimId: string,
  claimerUserId: number,
): Promise<{
  success: boolean;
  amount?: number;
  stablecoin?: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database unavailable" };

  // Find the pending claim transaction
  const claimTxns = await db.select().from(transactions)
    .where(and(
      eq(transactions.status, "pending"),
      sql`description LIKE ${'%claimId: ' + claimId + '%'}`,
    ))
    .limit(1);

  if (claimTxns.length === 0) {
    return { success: false, error: "Claim not found or already redeemed" };
  }

  const claimTx = claimTxns[0];

  // Parse claim details from description
  const amountMatch = claimTx.description?.match(/(\d+(?:\.\d+)?)\s+(\w+)/);
  if (!amountMatch) return { success: false, error: "Invalid claim data" };

  const amount = parseFloat(amountMatch[1]);
  const stablecoin = amountMatch[2];

  // Check expiry (30 days from creation)
  const createdAt = new Date(claimTx.createdAt ?? Date.now());
  const expiryMs = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - createdAt.getTime() > expiryMs) {
    // Expired — refund to sender
    await db.update(transactions)
      .set({ status: "failed", description: `${claimTx.description} [EXPIRED — refunded to sender]` })
      .where(eq(transactions.id, claimTx.id));

    if (claimTx.userId) {
      await db.update(wallets)
        .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,8)) + ${amount} AS TEXT)`, updatedAt: new Date() })
        .where(and(eq(wallets.userId, claimTx.userId), eq(wallets.currency, stablecoin)));

      await createAuditLog({
        userId: claimTx.userId,
        action: "P2P_CLAIM_EXPIRED",
        description: `P2P claim ${claimId} expired, ${amount} ${stablecoin} refunded`,
        metadata: { claimId, amount, stablecoin },
      });
    }

    return { success: false, error: "Claim has expired. Funds refunded to sender." };
  }

  // Execute claim
  const orderId = `CLAIM-${Date.now()}-${randomBytes(4).toString("hex")}`;

  try {
    const result = await executeAtomicStablecoinFlow(
      {
        userId: claimerUserId,
        amount: 0,
        stablecoin,
        flowType: "stablecoin_p2p",
        idempotencyKey: orderId,
        metadata: { claimId, senderUserId: claimTx.userId },
      },
      async () => {
        // Credit claimer wallet
        const existing = await db.select().from(wallets)
          .where(and(eq(wallets.userId, claimerUserId), eq(wallets.currency, stablecoin)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(wallets)
            .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,8)) + ${amount} AS TEXT)`, updatedAt: new Date() })
            .where(and(eq(wallets.userId, claimerUserId), eq(wallets.currency, stablecoin)));
        } else {
          await db.insert(wallets).values({
            userId: claimerUserId,
            currency: stablecoin,
            balance: String(amount),
            isDefault: false,
          });
        }

        // Mark claim as redeemed
        await db.update(transactions)
          .set({
            status: "completed",
            description: `${claimTx.description} [CLAIMED by user ${claimerUserId}]`,
          })
          .where(eq(transactions.id, claimTx.id));

        // Record claim transaction for claimer
        await db.insert(transactions).values({
          userId: claimerUserId,
          type: "deposit",
          amount: String(amount),
          currency: stablecoin,
          status: "completed",
          description: `P2P claim received: ${amount} ${stablecoin}`,
          reference: orderId,
        });

        return { orderId, amount, stablecoin };
      },
    );

    publishEvent(KAFKA_TOPICS.TRANSACTIONS, `claim:${orderId}`, {
      eventType: "p2p_claim_redeemed",
      claimId,
      claimerUserId,
      senderUserId: claimTx.userId,
      amount,
      stablecoin,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    await createAuditLog({
      userId: claimerUserId,
      action: "P2P_CLAIM_REDEEMED",
      description: `Claimed ${amount} ${stablecoin} via link ${claimId}`,
      metadata: { claimId, orderId, amount, stablecoin },
    });

    return { success: true, amount, stablecoin };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[P2PClaim] Claim ${claimId} failed: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Expire stale P2P claims older than 30 days and refund to senders.
 * Intended to run on a daily schedule.
 */
export async function expireStaleP2pClaims(): Promise<{ expired: number; refunded: number }> {
  const db = await getDb();
  if (!db) return { expired: 0, refunded: 0 };

  const expiryDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const staleClaims = await db.select().from(transactions)
    .where(and(
      eq(transactions.status, "pending"),
      sql`description LIKE '%claimId:%'`,
      lt(transactions.createdAt, expiryDate),
    ))
    .limit(100);

  let expired = 0;
  let refunded = 0;

  for (const claim of staleClaims) {
    const amountMatch = claim.description?.match(/(\d+(?:\.\d+)?)\s+(\w+)/);
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1]);
    const stablecoin = amountMatch[2];

    // Refund sender
    if (claim.userId) {
      await db.update(wallets)
        .set({ balance: sql`CAST(CAST(balance AS DECIMAL(20,8)) + ${amount} AS TEXT)`, updatedAt: new Date() })
        .where(and(eq(wallets.userId, claim.userId), eq(wallets.currency, stablecoin)));
      refunded++;
    }

    // Mark expired
    await db.update(transactions)
      .set({ status: "failed", description: `${claim.description} [EXPIRED — auto-refunded]` })
      .where(eq(transactions.id, claim.id));

    expired++;
  }

  if (expired > 0) {
    logger.info(`[P2PClaim] Expired ${expired} claims, refunded ${refunded}`);
  }

  return { expired, refunded };
}

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP: register schedules
// ═══════════════════════════════════════════════════════════════════════════

let dcaInterval: ReturnType<typeof setInterval> | null = null;
let claimExpiryInterval: ReturnType<typeof setInterval> | null = null;

export function startStablecoinSchedulers(): void {
  // DCA scan every 60 seconds
  dcaInterval = setInterval(() => {
    runDcaScanCycle().catch((err) => {
      logger.error(`[DCA] Scan cycle error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 60_000);

  // Claim expiry check every hour
  claimExpiryInterval = setInterval(() => {
    expireStaleP2pClaims().catch((err) => {
      logger.error(`[P2PClaim] Expiry cycle error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 3_600_000);

  logger.info("[Stablecoin] Schedulers started: DCA (60s), claim expiry (1h)");
}

export function stopStablecoinSchedulers(): void {
  if (dcaInterval) clearInterval(dcaInterval);
  if (claimExpiryInterval) clearInterval(claimExpiryInterval);
  logger.info("[Stablecoin] Schedulers stopped");
}
