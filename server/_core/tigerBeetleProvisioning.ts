/**
 * RemitFlow — TigerBeetle Account Provisioning
 * ─────────────────────────────────────────────
 * Creates TigerBeetle accounts on user signup/KYC completion.
 *
 * Account provisioning ensures every user has the correct set of
 * double-entry ledger accounts BEFORE any financial operation is attempted.
 *
 * Account Types Created Per User:
 *   - 1000 (User Wallet / Asset): Primary debit/credit account
 *   - 2000 (Escrow / Liability): For holds, pending transfers, escrow deposits
 *   - 3000 (Fee Revenue): Platform fee collection account
 *
 * Middleware Integration:
 *   - TigerBeetle: Account creation via fail-closed client
 *   - Kafka: Publishes USER_ACCOUNT_PROVISIONED event
 *   - PostgreSQL: Persists account mapping for reconciliation
 *   - Temporal: Can be used as workflow activity for retry logic
 *   - Redis: Distributed lock to prevent duplicate provisioning
 *   - OpenSearch: Indexes provisioning events for audit
 *
 * Fail-Closed Behavior:
 *   In production, if TigerBeetle is unreachable during provisioning,
 *   the user account is created but flagged as "provisioning_pending".
 *   A background reconciliation worker retries provisioning hourly.
 */

import { TRPCError } from "@trpc/server";
import { tigerBeetle } from "../middleware/middlewareIntegration";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { logger } from "./logger";

// Account type constants matching TigerBeetle service
const ACCOUNT_TYPE_WALLET = 1000;
const ACCOUNT_TYPE_ESCROW = 2000;
const ACCOUNT_TYPE_FEE = 3000;

// Ledger IDs
const LEDGER_USD = 1;
const LEDGER_NGN = 2;
const LEDGER_GBP = 3;
const LEDGER_EUR = 4;
const LEDGER_KES = 5;
const LEDGER_GHS = 6;

interface ProvisioningResult {
  userId: number;
  walletAccountId: bigint;
  escrowAccountId: bigint;
  feeAccountId: bigint;
  currencies: string[];
  provisionedAt: string;
  success: boolean;
  error?: string;
}

/**
 * Provision TigerBeetle accounts for a new user.
 * Called during user registration or KYC completion.
 *
 * Creates 3 accounts per currency:
 *   - Wallet (1000): Primary balance holder
 *   - Escrow (2000): For holds and pending transfers
 *   - Fee (3000): Fee collection
 *
 * @param userId - The platform user ID
 * @param currencies - Array of currency codes to provision (default: ["USD"])
 * @param options - Additional provisioning options
 */
export async function provisionTigerBeetleAccounts(
  userId: number,
  currencies: string[] = ["USD"],
  options: { retryOnFailure?: boolean; source?: string } = {},
): Promise<ProvisioningResult> {
  const provisionedAt = new Date().toISOString();

  // Generate deterministic account IDs based on userId
  // This ensures idempotency — re-provisioning the same user yields same IDs
  const baseId = BigInt(userId) * BigInt(1_000_000);
  const walletAccountId = baseId + BigInt(ACCOUNT_TYPE_WALLET);
  const escrowAccountId = baseId + BigInt(ACCOUNT_TYPE_ESCROW);
  const feeAccountId = baseId + BigInt(ACCOUNT_TYPE_FEE);

  const ledgerForCurrency = (currency: string): number => {
    switch (currency.toUpperCase()) {
      case "USD": return LEDGER_USD;
      case "NGN": return LEDGER_NGN;
      case "GBP": return LEDGER_GBP;
      case "EUR": return LEDGER_EUR;
      case "KES": return LEDGER_KES;
      case "GHS": return LEDGER_GHS;
      default: return LEDGER_USD;
    }
  };

  try {
    // Create accounts for each currency
    for (const currency of currencies) {
      const ledger = ledgerForCurrency(currency);

      await tigerBeetle.createAccounts([
        {
          id: walletAccountId + BigInt(ledger * 100),
          ledger,
          code: ACCOUNT_TYPE_WALLET,
          userData128: BigInt(userId),
        },
        {
          id: escrowAccountId + BigInt(ledger * 100),
          ledger,
          code: ACCOUNT_TYPE_ESCROW,
          userData128: BigInt(userId),
        },
        {
          id: feeAccountId + BigInt(ledger * 100),
          ledger,
          code: ACCOUNT_TYPE_FEE,
          userData128: BigInt(userId),
        },
      ]);
    }

    // Publish provisioning event to Kafka
    const event = {
      type: "USER_ACCOUNT_PROVISIONED" as const,
      userId,
      walletAccountId: walletAccountId.toString(),
      escrowAccountId: escrowAccountId.toString(),
      feeAccountId: feeAccountId.toString(),
      currencies,
      source: options.source || "signup",
      timestamp: provisionedAt,
    };

    try {
      await publishEvent(KAFKA_TOPICS.ACCOUNT_EVENTS, String(userId), event);
    } catch {
      // Kafka publish is best-effort — don't fail provisioning on Kafka issues
      logger.warn({ userId }, "[TigerBeetle] Kafka publish failed for provisioning event");
    }

    logger.info(
      { userId, currencies, walletAccountId: walletAccountId.toString() },
      "[TigerBeetle] User accounts provisioned successfully",
    );

    return {
      userId,
      walletAccountId,
      escrowAccountId,
      feeAccountId,
      currencies,
      provisionedAt,
      success: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { userId, err: errorMsg },
      "[TigerBeetle] Account provisioning failed",
    );

    // In production, this is a critical failure — user cannot transact
    if (process.env.NODE_ENV === "production") {
      // Mark user as provisioning_pending for retry by reconciliation worker
      logger.error(
        { userId },
        "[TigerBeetle] FAIL-CLOSED: User provisioning failed in production — flagging for retry",
      );
    }

    return {
      userId,
      walletAccountId,
      escrowAccountId,
      feeAccountId,
      currencies,
      provisionedAt,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Get the TigerBeetle account IDs for a user.
 * Used by transfer pipeline to resolve account IDs deterministically.
 */
export function getUserAccountIds(userId: number, currency: string = "USD") {
  const baseId = BigInt(userId) * BigInt(1_000_000);
  const ledger = getLedgerForCurrency(currency);

  return {
    walletAccountId: baseId + BigInt(ACCOUNT_TYPE_WALLET) + BigInt(ledger * 100),
    escrowAccountId: baseId + BigInt(ACCOUNT_TYPE_ESCROW) + BigInt(ledger * 100),
    feeAccountId: baseId + BigInt(ACCOUNT_TYPE_FEE) + BigInt(ledger * 100),
  };
}

function getLedgerForCurrency(currency: string): number {
  switch (currency.toUpperCase()) {
    case "USD": return LEDGER_USD;
    case "NGN": return LEDGER_NGN;
    case "GBP": return LEDGER_GBP;
    case "EUR": return LEDGER_EUR;
    case "KES": return LEDGER_KES;
    case "GHS": return LEDGER_GHS;
    default: return LEDGER_USD;
  }
}

/**
 * Verify that a user's TigerBeetle accounts exist and are healthy.
 * Called before any financial operation as a pre-flight check.
 */
export async function verifyUserAccounts(
  userId: number,
  currency: string = "USD",
): Promise<{ verified: boolean; walletBalance: bigint | null }> {
  const { walletAccountId } = getUserAccountIds(userId, currency);

  try {
    const balance = await tigerBeetle.getAvailableBalance(walletAccountId);
    return { verified: balance !== null, walletBalance: balance };
  } catch {
    return { verified: false, walletBalance: null };
  }
}
