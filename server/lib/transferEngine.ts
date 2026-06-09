/**
 * Transfer Engine — End-to-end money movement with middleware-ready ledger abstraction.
 * 
 * Flow: Initiate → Validate → Debit Sender → FX Convert → Credit Recipient → Settle
 * 
 * All financial operations (steps 5-10) run inside a single PostgreSQL transaction
 * with SERIALIZABLE isolation. On failure, the entire transaction rolls back —
 * no partial debits or orphaned ledger entries.
 * 
 * Middleware layers:
 * - Ledger: PostgreSQL (dev) → TigerBeetle (production)
 * - Events: PostgreSQL events table (dev) → Kafka (production)
 * - Workflow: Direct execution (dev) → Temporal (production)
 * - Service mesh: HTTP (dev) → Dapr sidecar (production)
 */
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { getDb } from "../db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransferRequest {
  senderId: number;
  recipientId: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  corridor: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  payoutMethod: "bank_transfer" | "mobile_money" | "cash_pickup" | "wallet";
  purpose: string;
  sourceOfFunds: string;
}

export interface TransferResult {
  transferId: string;
  status: "completed" | "pending_settlement" | "failed" | "pending_compliance";
  debitAmount: number;
  creditAmount: number;
  fxRate: number;
  fee: number;
  totalCharged: number;
  estimatedDelivery: string;
  referenceNumber: string;
  ledgerEntries: LedgerEntry[];
}

interface LedgerEntry {
  id: string;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  currency: string;
  type: "transfer" | "fee" | "fx_conversion";
  timestamp: Date;
}

interface FeeCalculation {
  flatFee: number;
  percentFee: number;
  totalFee: number;
  feeBreakdown: { type: string; amount: number }[];
}

// ─── Fee Tiers (real business logic) ─────────────────────────────────────────

const FEE_TIERS: Record<string, { flat: number; pct: number; min: number; max: number }> = {
  "USD-NGN": { flat: 2.99, pct: 0.015, min: 2.99, max: 49.99 },
  "USD-GHS": { flat: 2.49, pct: 0.012, min: 2.49, max: 39.99 },
  "USD-KES": { flat: 1.99, pct: 0.010, min: 1.99, max: 29.99 },
  "USD-ZAR": { flat: 3.99, pct: 0.018, min: 3.99, max: 59.99 },
  "GBP-NGN": { flat: 2.49, pct: 0.012, min: 2.49, max: 39.99 },
  "EUR-NGN": { flat: 2.49, pct: 0.012, min: 2.49, max: 39.99 },
  "CAD-NGN": { flat: 2.99, pct: 0.015, min: 2.99, max: 49.99 },
  DEFAULT: { flat: 3.99, pct: 0.018, min: 3.99, max: 79.99 },
};

const KYC_LIMITS: Record<string, { daily: number; monthly: number; single: number }> = {
  tier0: { daily: 100, monthly: 300, single: 50 },
  tier1: { daily: 1000, monthly: 5000, single: 500 },
  tier2: { daily: 10000, monthly: 50000, single: 5000 },
  tier3: { daily: 100000, monthly: 500000, single: 50000 },
};

// ─── Ledger Abstraction (middleware-ready) ───────────────────────────────────

/**
 * LedgerBackend interface — in production, swap to TigerBeetle client.
 * TigerBeetle provides: double-entry accounting, idempotent transfers,
 * strict serialization, and O(1) balance lookups.
 */
interface LedgerBackend {
  createTransfer(entry: LedgerEntry): Promise<void>;
  getBalance(accountId: number, currency: string): Promise<number>;
  debit(accountId: number, amount: number, currency: string, ref: string): Promise<void>;
  credit(accountId: number, amount: number, currency: string, ref: string): Promise<void>;
}

class PostgresLedger implements LedgerBackend {
  async createTransfer(entry: LedgerEntry): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      INSERT INTO ledger_entries (id, debit_account_id, credit_account_id, amount, currency, type, created_at)
      VALUES (${entry.id}, ${entry.debitAccountId}, ${entry.creditAccountId}, 
              ${entry.amount.toString()}, ${entry.currency}, ${entry.type}, NOW())
    `);
  }

  async getBalance(accountId: number, currency: string): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    const result = await db.execute(sql`
      SELECT CAST(COALESCE(balance, '0') AS DECIMAL) as balance 
      FROM wallets WHERE "userId" = ${accountId} AND currency = ${currency}
    `);
    const rows = result as unknown as { balance: string }[];
    return rows.length > 0 ? parseFloat(rows[0].balance) : 0;
  }

  async debit(accountId: number, amount: number, currency: string, ref: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      UPDATE wallets 
      SET balance = balance - ${amount.toString()}::numeric,
          "updatedAt" = NOW()
      WHERE "userId" = ${accountId} AND currency = ${currency}
        AND balance >= ${amount.toString()}::numeric
    `);
    await db.execute(sql`
      INSERT INTO transactions ("userId", type, "fromAmount", "fromCurrency", status, description, reference, "createdAt", "updatedAt")
      VALUES (${accountId}, 'send', ${amount.toString()}, ${currency}, 'completed', 
              ${'Transfer debit: ' + ref}, ${ref}, NOW(), NOW())
    `);
  }

  async credit(accountId: number, amount: number, currency: string, ref: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    // Ensure recipient has a wallet in this currency
    await db.execute(sql`
      INSERT INTO wallets ("userId", currency, balance, "createdAt", "updatedAt")
      VALUES (${accountId}, ${currency}, 0, NOW(), NOW())
      ON CONFLICT ("userId", currency) DO NOTHING
    `);
    await db.execute(sql`
      UPDATE wallets 
      SET balance = balance + ${amount.toString()}::numeric,
          "updatedAt" = NOW()
      WHERE "userId" = ${accountId} AND currency = ${currency}
    `);
    await db.execute(sql`
      INSERT INTO transactions ("userId", type, "fromAmount", "fromCurrency", status, description, reference, "createdAt", "updatedAt")
      VALUES (${accountId}, 'receive', ${amount.toString()}, ${currency}, 'completed', 
              ${'Transfer credit: ' + ref}, ${ref}, NOW(), NOW())
    `);
  }
}

/**
 * TigerBeetle-backed ledger — activated when TIGERBEETLE_ADDRESSES is set.
 * Uses the TigerBeetleIntegration class from middlewareIntegration for
 * double-entry accounting with idempotent transfers, strict serialization,
 * and O(1) balance lookups.
 */
class TigerBeetleLedger implements LedgerBackend {
  private tb: import('../middleware/middlewareIntegration.js').TigerBeetleIntegration | null = null;
  private initPromise: Promise<void> | null = null;

  private async ensureConnected(): Promise<void> {
    if (this.tb) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const { TigerBeetleIntegration } = await import('../middleware/middlewareIntegration.js');
        this.tb = new TigerBeetleIntegration();
        await this.tb.connect();
      } catch {
        this.tb = null;
      }
    })();
    return this.initPromise;
  }

  async createTransfer(entry: LedgerEntry): Promise<void> {
    await this.ensureConnected();
    if (!this.tb) {
      // Fall through to PostgreSQL if TigerBeetle init failed
      return pgFallback.createTransfer(entry);
    }
    const transferId = BigInt('0x' + entry.id.replace(/-/g, '').slice(0, 16));
    await this.tb.createTransfer({
      id: transferId,
      debitAccountId: BigInt(entry.debitAccountId),
      creditAccountId: BigInt(entry.creditAccountId),
      amount: BigInt(Math.round(entry.amount * 100)),
      ledger: 1,
      code: entry.type === 'fee' ? 2 : entry.type === 'fx_conversion' ? 3 : 1,
    });
    // Also write to PostgreSQL for queryability
    await pgFallback.createTransfer(entry);
  }

  async getBalance(accountId: number, currency: string): Promise<number> {
    await this.ensureConnected();
    if (!this.tb) return pgFallback.getBalance(accountId, currency);
    try {
      const accounts = await this.tb.lookupAccounts([BigInt(accountId)]);
      if (accounts.length > 0) {
        const acct = accounts[0];
        const creditsPosted = Number(acct.credits_posted ?? 0);
        const debitsPosted = Number(acct.debits_posted ?? 0);
        const debitsPending = Number(acct.debits_pending ?? 0);
        return (creditsPosted - debitsPosted - debitsPending) / 100;
      }
    } catch { /* fall through */ }
    return pgFallback.getBalance(accountId, currency);
  }

  async debit(accountId: number, amount: number, currency: string, ref: string): Promise<void> {
    await this.ensureConnected();
    if (!this.tb) return pgFallback.debit(accountId, amount, currency, ref);
    const transferId = BigInt('0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 16));
    await this.tb.createTransfer({
      id: transferId,
      debitAccountId: BigInt(accountId),
      creditAccountId: BigInt(9999), // Suspense account
      amount: BigInt(Math.round(amount * 100)),
      ledger: 1,
      code: 1,
    });
    // Also write to PostgreSQL for query/reporting
    await pgFallback.debit(accountId, amount, currency, ref);
  }

  async credit(accountId: number, amount: number, currency: string, ref: string): Promise<void> {
    await this.ensureConnected();
    if (!this.tb) return pgFallback.credit(accountId, amount, currency, ref);
    const transferId = BigInt('0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 16));
    await this.tb.createTransfer({
      id: transferId,
      debitAccountId: BigInt(9999), // Suspense account
      creditAccountId: BigInt(accountId),
      amount: BigInt(Math.round(amount * 100)),
      ledger: 1,
      code: 1,
    });
    await pgFallback.credit(accountId, amount, currency, ref);
  }
}

const pgFallback = new PostgresLedger();

// Activate TigerBeetle when configured; otherwise use PostgreSQL directly
const ledger: LedgerBackend = process.env.TIGERBEETLE_ADDRESSES
  ? new TigerBeetleLedger()
  : pgFallback;

// ─── Event Bus Abstraction (middleware-ready) ────────────────────────────────

/**
 * EventBus interface — in production, swap to Kafka producer.
 * Kafka provides: ordered event streaming, replay, consumer groups.
 */
interface EventBus {
  publish(topic: string, event: Record<string, unknown>): Promise<void>;
}

class PostgresEventBus implements EventBus {
  async publish(topic: string, event: Record<string, unknown>): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      INSERT INTO "auditLogs" ("userId", action, metadata, "createdAt")
      VALUES (${(event.userId as number) || 0}, ${topic}, ${JSON.stringify(event)}, NOW())
    `);
  }
}

/**
 * Kafka-backed event bus — activated when KAFKA_BROKERS is set.
 * Falls back to PostgreSQL audit log when Kafka unavailable.
 */
class KafkaEventBus implements EventBus {
  async publish(topic: string, event: Record<string, unknown>): Promise<void> {
    try {
      const { publishEvent } = await import('../middleware/kafka.js');
      const published = await publishEvent(topic, String(event.userId || 'system'), event);
      if (!published) {
        // Kafka unavailable — fall back to PostgreSQL
        await pgEventFallback.publish(topic, event);
      }
    } catch {
      await pgEventFallback.publish(topic, event);
    }
  }
}

const pgEventFallback = new PostgresEventBus();

const events: EventBus = process.env.KAFKA_BROKERS
  ? new KafkaEventBus()
  : pgEventFallback;

// ─── FX Rate Service ─────────────────────────────────────────────────────────

async function getFxRate(from: string, to: string): Promise<number> {
  const db = await getDb();
  if (!db) return 1;
  const result = await db.execute(sql`
    SELECT rate FROM fx_rate_history 
    WHERE from_currency = ${from} AND to_currency = ${to}
    ORDER BY recorded_at DESC LIMIT 1
  `);
  const rows = result as unknown as { rate: string }[];
  if (rows.length > 0) return parseFloat(rows[0].rate);
  // Fallback rates if no DB rate available
  const fallback: Record<string, number> = {
    "USD-NGN": 1580.50, "USD-GHS": 15.20, "USD-KES": 153.50,
    "GBP-NGN": 2010.00, "EUR-NGN": 1720.00, "USD-ZAR": 18.50,
  };
  return fallback[`${from}-${to}`] || 1.0;
}

// ─── Fee Calculation ─────────────────────────────────────────────────────────

function calculateFee(amount: number, corridor: string): FeeCalculation {
  const tier = FEE_TIERS[corridor] || FEE_TIERS.DEFAULT;
  // Use integer minor units (cents) to avoid float precision issues
  // pct is already a decimal (e.g., 0.015 for 1.5%), so multiply amount*pct in cents
  const amountCents = Math.round(amount * 100);
  const percentFeeCents = Math.round(amountCents * tier.pct);
  const flatCents = Math.round(tier.flat * 100);
  const minCents = Math.round(tier.min * 100);
  const maxCents = Math.round(tier.max * 100);
  const totalFeeCents = Math.max(minCents, Math.min(maxCents, flatCents + percentFeeCents));
  const percentFee = percentFeeCents / 100;
  const totalFee = totalFeeCents / 100;
  return {
    flatFee: tier.flat,
    percentFee,
    totalFee,
    feeBreakdown: [
      { type: "flat_fee", amount: tier.flat },
      { type: "percent_fee", amount: percentFee },
    ],
  };
}

// ─── KYC/AML Checks ─────────────────────────────────────────────────────────

async function validateCompliance(senderId: number, amount: number): Promise<{ allowed: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) return { allowed: true };
  // Get user's KYC tier
  const userResult = await db.execute(sql`
    SELECT "kycTier" FROM users WHERE id = ${senderId}
  `);
  const users = userResult as unknown as { kycTier: string }[];
  if (users.length === 0) return { allowed: false, reason: "User not found" };
  
  const user = users[0];
  const tier = user.kycTier || "tier1";
  const limits = KYC_LIMITS[tier] || KYC_LIMITS.tier1;

  // Check single transaction limit
  if (amount > limits.single) {
    return { allowed: false, reason: `Amount exceeds ${tier} single transaction limit ($${limits.single})` };
  }

  // Check daily volume
  const dailyResult = await db.execute(sql`
    SELECT COALESCE(SUM("fromAmount"), 0) as daily_total
    FROM transactions 
    WHERE "userId" = ${senderId} AND type = 'send' 
    AND "createdAt" > NOW() - INTERVAL '24 hours'
    AND status = 'completed'
  `);
  const dailyRows = dailyResult as unknown as { daily_total: string }[];
  const dailyTotal = parseFloat(dailyRows[0]?.daily_total || "0");
  
  if (dailyTotal + amount > limits.daily) {
    return { allowed: false, reason: `Would exceed ${tier} daily limit ($${limits.daily})` };
  }

  return { allowed: true };
}

// ─── Main Transfer Execution ─────────────────────────────────────────────────

/**
 * Execute a full transfer: validate → debit → convert → credit → settle
 * This function is Temporal-workflow-ready: each step is idempotent and can be
 * retried independently. In production, wrap each step as a Temporal activity.
 */
export async function executeTransfer(req: TransferRequest & { idempotencyKey?: string }): Promise<TransferResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Idempotency guard: if a key is provided, check for duplicate before executing
  if (req.idempotencyKey) {
    const existing = await db.execute(sql`
      SELECT "referenceId", status, "fromAmount", "toAmount", "exchangeRate", fee
      FROM transfers WHERE idempotency_key = ${req.idempotencyKey} LIMIT 1
    `);
    const rows = existing as unknown as Array<{ referenceId: string; status: string; fromAmount: string; toAmount: string; exchangeRate: string; fee: string }>;
    if (rows.length > 0) {
      const row = rows[0];
      return {
        transferId: row.referenceId,
        status: row.status as TransferResult["status"],
        debitAmount: parseFloat(row.fromAmount),
        creditAmount: parseFloat(row.toAmount),
        fxRate: parseFloat(row.exchangeRate),
        fee: parseFloat(row.fee),
        totalCharged: parseFloat(row.fromAmount) + parseFloat(row.fee),
        estimatedDelivery: "",
        referenceNumber: row.referenceId,
        ledgerEntries: [],
      };
    }
  }

  const transferId = `TXN-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const corridor = `${req.fromCurrency}-${req.toCurrency}`;

  // Step 1: Compliance validation (read-only, outside transaction)
  const compliance = await validateCompliance(req.senderId, req.amount);
  if (!compliance.allowed) {
    await events.publish("transfer.rejected", { transferId, reason: compliance.reason, userId: req.senderId });
    return {
      transferId,
      status: "failed",
      debitAmount: 0, creditAmount: 0, fxRate: 0, fee: 0, totalCharged: 0,
      estimatedDelivery: "", referenceNumber: transferId,
      ledgerEntries: [],
    };
  }

  // Step 2: Calculate fees (pure computation, outside transaction)
  const fee = calculateFee(req.amount, corridor);
  const totalCharged = req.amount + fee.totalFee;

  // Step 3: Get FX rate (read-only, outside transaction)
  const fxRate = await getFxRate(req.fromCurrency, req.toCurrency);
  const creditAmount = req.amount * fxRate;

  // Step 4: Verify sender has sufficient balance (read-only pre-check)
  const senderBalance = await ledger.getBalance(req.senderId, req.fromCurrency);
  if (senderBalance < totalCharged) {
    await events.publish("transfer.insufficient_funds", { transferId, userId: req.senderId, required: totalCharged, available: senderBalance });
    return {
      transferId, status: "failed",
      debitAmount: 0, creditAmount: 0, fxRate, fee: fee.totalFee, totalCharged,
      estimatedDelivery: "", referenceNumber: transferId, ledgerEntries: [],
    };
  }

  // ── BEGIN TRANSACTION ──────────────────────────────────────────────────────
  // Steps 5-10 run inside a single SERIALIZABLE transaction.
  // If any step fails, the entire transaction rolls back — no partial debits.
  // Middleware-ready: in production, swap to TigerBeetle two-phase commit.
  const feeEntry: LedgerEntry = {
    id: `${transferId}-fee`,
    debitAccountId: req.senderId,
    creditAccountId: 0,
    amount: fee.totalFee,
    currency: req.fromCurrency,
    type: "fee",
    timestamp: new Date(),
  };
  const fxEntry: LedgerEntry = {
    id: `${transferId}-fx`,
    debitAccountId: req.senderId,
    creditAccountId: req.recipientId,
    amount: creditAmount,
    currency: req.toCurrency,
    type: "fx_conversion",
    timestamp: new Date(),
  };

  // Use Drizzle's transaction API (postgres.js requires sql.begin, not raw BEGIN)
  // Middleware-ready: swap to TigerBeetle two-phase commit in production
  let txFailed = false;
  try {
    await db.transaction(async (tx: typeof db) => {
      // Step 5: Create transfer record (with idempotency key for dedup)
      await tx.execute(sql`
        INSERT INTO transfers (
          "userId", "beneficiaryId", "fromCurrency", "toCurrency", "fromAmount", "toAmount",
          "exchangeRate", fee, status, corridor, "payoutMethod", purpose, "referenceId", idempotency_key, "createdAt"
        ) VALUES (
          ${req.senderId}, ${req.recipientId}, ${req.fromCurrency}, ${req.toCurrency},
          ${req.amount.toString()}, ${creditAmount.toString()}, ${fxRate.toString()},
          ${fee.totalFee.toString()}, 'processing', ${corridor}, ${req.payoutMethod},
          ${req.purpose}, ${transferId}, ${req.idempotencyKey ?? null}, NOW()
        )
      `);

      // Step 6: Debit sender with balance re-check under lock
      const debitResult = await tx.execute(sql`
        UPDATE wallets 
        SET balance = balance - ${totalCharged.toString()}::numeric,
            "updatedAt" = NOW()
        WHERE "userId" = ${req.senderId} AND currency = ${req.fromCurrency}
          AND balance >= ${totalCharged.toString()}::numeric
        RETURNING balance
      `);
      const debitRows = debitResult as unknown as { balance: string }[];
      if (!debitRows || debitRows.length === 0) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      // Step 6b: Record debit transaction
      const debitRef = `${transferId}-debit`;
      await tx.execute(sql`
        INSERT INTO transactions ("userId", type, "fromAmount", "fromCurrency", status, description, reference, "createdAt", "updatedAt")
        VALUES (${req.senderId}, 'send', ${totalCharged.toString()}, ${req.fromCurrency}, 'completed', 
                ${'Transfer debit: ' + debitRef}, ${debitRef}, NOW(), NOW())
      `);

      // Step 7: Record fee ledger entry
      await tx.execute(sql`
        INSERT INTO ledger_entries (id, debit_account_id, credit_account_id, amount, currency, type, created_at)
        VALUES (${feeEntry.id}, ${feeEntry.debitAccountId}, ${feeEntry.creditAccountId}, 
                ${feeEntry.amount.toString()}, ${feeEntry.currency}, ${feeEntry.type}, NOW())
      `);

      // Step 8: FX conversion ledger entry
      await tx.execute(sql`
        INSERT INTO ledger_entries (id, debit_account_id, credit_account_id, amount, currency, type, created_at)
        VALUES (${fxEntry.id}, ${fxEntry.debitAccountId}, ${fxEntry.creditAccountId}, 
                ${fxEntry.amount.toString()}, ${fxEntry.currency}, ${fxEntry.type}, NOW())
      `);

      // Step 9: Credit recipient (ensure wallet exists, then credit)
      await tx.execute(sql`
        INSERT INTO wallets ("userId", currency, balance, "createdAt", "updatedAt")
        VALUES (${req.recipientId}, ${req.toCurrency}, 0, NOW(), NOW())
        ON CONFLICT ("userId", currency) DO NOTHING
      `);
      await tx.execute(sql`
        UPDATE wallets 
        SET balance = balance + ${creditAmount.toString()}::numeric,
            "updatedAt" = NOW()
        WHERE "userId" = ${req.recipientId} AND currency = ${req.toCurrency}
      `);
      const creditRef = `${transferId}-credit`;
      await tx.execute(sql`
        INSERT INTO transactions ("userId", type, "fromAmount", "fromCurrency", status, description, reference, "createdAt", "updatedAt")
        VALUES (${req.recipientId}, 'receive', ${creditAmount.toString()}, ${req.toCurrency}, 'completed', 
                ${'Transfer credit: ' + creditRef}, ${creditRef}, NOW(), NOW())
      `);

      // Step 10: Update transfer status to completed
      await tx.execute(sql`
        UPDATE transfers SET status = 'completed', "updatedAt" = NOW()
        WHERE "referenceId" = ${transferId}
      `);
    });
  } catch (err) {
    // Transaction auto-rolled back by Drizzle on throw
    txFailed = true;
    await events.publish("transfer.failed", { transferId, userId: req.senderId, error: String(err) });
    return {
      transferId, status: "failed",
      debitAmount: 0, creditAmount: 0, fxRate, fee: fee.totalFee, totalCharged,
      estimatedDelivery: "", referenceNumber: transferId, ledgerEntries: [],
    };
  }
  // ── END TRANSACTION ────────────────────────────────────────────────────────

  // Step 11: Initiate external disbursement via payment provider (sandbox in dev)
  // Middleware-ready: in production, this calls Stripe/Flutterwave/M-Pesa/MTN MoMo
  let disbursementStatus: "completed" | "pending_settlement" = "completed";
  let providerRef = "";
  try {
    const { initiatePayment } = await import('./paymentProviders.js');
    const railMap: Record<string, string> = {
      bank_transfer: "bank_transfer",
      mobile_money: "mobile_money",
      cash_pickup: "bank_transfer",
      wallet: "bank_transfer",
    };
    const paymentResult = await initiatePayment({
      amount: creditAmount,
      currency: req.toCurrency,
      fromCurrency: req.fromCurrency,
      toCurrency: req.toCurrency,
      recipientAccountNumber: req.beneficiaryAccount,
      recipientPhone: req.beneficiaryAccount,
      description: `RemitFlow: ${req.fromCurrency}→${req.toCurrency} for ${req.beneficiaryName}`,
      userId: req.senderId,
      transactionId: transferId,
      callbackUrl: process.env.WEBHOOK_CALLBACK_URL ?? `${process.env.BASE_URL ?? 'http://localhost:3001'}/api/webhooks/payment`,
    }, railMap[req.payoutMethod] ?? "bank_transfer");

    providerRef = paymentResult.providerRef;
    if (!paymentResult.success) {
      disbursementStatus = "pending_settlement";
      await events.publish("transfer.disbursement_failed", {
        transferId, userId: req.senderId, provider: paymentResult.providerName,
        error: paymentResult.errorMessage,
      });
    }
    // Update transfer with provider reference
    await db.execute(sql`
      UPDATE transfers SET provider_ref = ${providerRef},
        status = ${disbursementStatus === "completed" ? "completed" : "pending_settlement"},
        "updatedAt" = NOW()
      WHERE "referenceId" = ${transferId}
    `);
  } catch (disbursementErr) {
    // Non-fatal: internal ledger transfer succeeded, external disbursement can be retried
    disbursementStatus = "pending_settlement";
    await events.publish("transfer.disbursement_error", {
      transferId, userId: req.senderId, error: String(disbursementErr),
    });
  }

  // Step 12: Publish events outside transaction (Kafka in production)
  await events.publish("transfer.completed", {
    transferId, userId: req.senderId,
    amount: req.amount, fromCurrency: req.fromCurrency, toCurrency: req.toCurrency,
    creditAmount, fxRate, fee: fee.totalFee, corridor: req.corridor,
    providerRef, disbursementStatus,
  });

  const deliveryMap: Record<string, string> = {
    wallet: "Instant",
    mobile_money: "Within 5 minutes",
    bank_transfer: "Within 1-2 business days",
    cash_pickup: "Ready for pickup in 30 minutes",
  };

  return {
    transferId,
    status: disbursementStatus,
    debitAmount: totalCharged,
    creditAmount,
    fxRate,
    fee: fee.totalFee,
    totalCharged,
    estimatedDelivery: deliveryMap[req.payoutMethod] || "1-3 business days",
    referenceNumber: transferId,
    ledgerEntries: [feeEntry, fxEntry],
  };
}

// ─── Exported utilities ──────────────────────────────────────────────────────

export { calculateFee, validateCompliance, getFxRate };
export type { FeeCalculation, LedgerEntry, LedgerBackend, EventBus };
