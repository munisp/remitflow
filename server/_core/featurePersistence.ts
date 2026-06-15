/**
 * featurePersistence.ts — Database persistence layer for all 20 platform features
 *
 * Bridges in-memory Map stores with PostgreSQL write-through persistence,
 * TigerBeetle double-entry ledger for financial operations,
 * and Kafka event emission for the event-driven architecture.
 *
 * Architecture:
 *   1. In-memory Map (hot cache, sub-ms reads)
 *   2. PostgreSQL via Drizzle (durable, queryable)
 *   3. TigerBeetle (double-entry ledger for money movement)
 *   4. Kafka (event bus for audit, analytics, downstream services)
 */

import { sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Database Access ──────────────────────────────────────────────────────────

let _db: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null = null;

async function getDb() {
  if (_db) return _db;
  try {
    const { getDb: getAppDb } = await import("../db.js");
    _db = await getAppDb();
    return _db;
  } catch {
    return null;
  }
}

// ── Kafka Event Emitter ──────────────────────────────────────────────────────

interface FeatureEvent {
  topic: string;
  key: string;
  value: Record<string, unknown>;
  timestamp?: string;
}

const eventBuffer: FeatureEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER_SIZE = 100;

async function flushEvents() {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0, eventBuffer.length);

  try {
    const { publishEvent } = await import("../middleware/kafka");
    for (const event of batch) {
      await publishEvent(event.topic, event.key, {
        ...event.value,
        _emittedAt: event.timestamp ?? new Date().toISOString(),
        _source: "feature-persistence",
      });
    }
  } catch (err) {
    logger.debug({ err, count: batch.length }, "Kafka event flush failed — events dropped");
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushEvents().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

export function emitFeatureEvent(topic: string, key: string, value: Record<string, unknown>) {
  eventBuffer.push({ topic, key, value, timestamp: new Date().toISOString() });
  if (eventBuffer.length >= MAX_BUFFER_SIZE) {
    flushEvents().catch(() => {});
  } else {
    scheduleFlush();
  }
}

// ── TigerBeetle Ledger Integration ──────────────────────────────────────────

interface LedgerEntry {
  id: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  currency: string;
  reference: string;
  code: number;
  timestamp: string;
}

const ledgerEntries: LedgerEntry[] = [];

export async function createLedgerEntry(entry: Omit<LedgerEntry, "id" | "timestamp">): Promise<LedgerEntry> {
  const { randomBytes } = await import("crypto");
  const ledgerEntry: LedgerEntry = {
    ...entry,
    id: `ledger-${randomBytes(16).toString("hex")}`,
    timestamp: new Date().toISOString(),
  };

  ledgerEntries.push(ledgerEntry);

  // Forward to TigerBeetle via the Rust sidecar (port 8117)
  try {
    const res = await fetch("http://localhost:8117/api/ledger/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        debit_account_id: entry.debitAccountId,
        credit_account_id: entry.creditAccountId,
        amount: Math.round(entry.amount * 100),
        code: entry.code,
        ledger: 1,
        reference: entry.reference,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`TigerBeetle sidecar: ${res.status}`);
  } catch {
    logger.debug({ reference: entry.reference }, "TigerBeetle sidecar unavailable — using fallback");
  }

  // Persist to PostgreSQL
  const db = await getDb();
  if (db) {
    try {
      await (db as any).execute(sql`
        INSERT INTO ledger_entries (id, debit_account_id, credit_account_id, amount, currency, reference, code, created_at)
        VALUES (${ledgerEntry.id}, ${entry.debitAccountId}, ${entry.creditAccountId}, ${entry.amount}, ${entry.currency}, ${entry.reference}, ${entry.code}, NOW())
        ON CONFLICT (id) DO NOTHING
      `);
    } catch {
      // Table may not exist yet — graceful degradation
    }
  }

  return ledgerEntry;
}

export function getLedgerEntries(reference?: string): LedgerEntry[] {
  if (reference) return ledgerEntries.filter(e => e.reference === reference);
  return [...ledgerEntries];
}

// ── Write-Through Persistence for Feature Stores ─────────────────────────────

export async function persistFeatureRecord(
  tableName: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const columnList = columns.map(c => `"${camelToSnake(c)}"`).join(", ");
    const updateSet = columns.map((c, i) => `"${camelToSnake(c)}" = $${i + 1}`).join(", ");

    await (db as any).execute(sql.raw(
      `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})
       ON CONFLICT ("id") DO UPDATE SET ${updateSet}`,
    ));
  } catch {
    // Table may not exist — features degrade to in-memory only
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// ── Feature-Specific Event Emitters ──────────────────────────────────────────

export const FeatureEvents = {
  // F1: Programmable Payments
  paymentCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.programmable-payments", data.paymentId as string, { event: "payment.created", ...data }),
  paymentApproved: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.programmable-payments", data.paymentId as string, { event: "payment.approved", ...data }),
  paymentCancelled: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.programmable-payments", data.paymentId as string, { event: "payment.cancelled", ...data }),

  // F2: Cross-Currency Swap
  swapQuoted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.swaps", data.quoteId as string, { event: "swap.quoted", ...data }),
  swapExecuted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.swaps", data.swapId as string, { event: "swap.executed", ...data }),

  // F3: Merchant Gateway
  merchantRegistered: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.merchant", data.merchantId as string, { event: "merchant.registered", ...data }),
  paymentIntentCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.merchant", data.intentId as string, { event: "payment_intent.created", ...data }),
  paymentCompleted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.merchant", data.intentId as string, { event: "payment.completed", ...data }),
  refundIssued: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.merchant", data.intentId as string, { event: "refund.issued", ...data }),

  // F4: Batch Payouts
  batchCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.batch-payouts", data.batchId as string, { event: "batch.created", ...data }),
  batchExecuted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.batch-payouts", data.batchId as string, { event: "batch.executed", ...data }),

  // F5: Account Abstraction
  walletCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.account-abstraction", data.walletId as string, { event: "wallet.created", ...data }),
  gaslessTxSent: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.account-abstraction", data.opId as string, { event: "gasless_tx.sent", ...data }),
  recoveryInitiated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.account-abstraction", data.walletId as string, { event: "recovery.initiated", ...data }),

  // F6: Lending/Borrowing
  supplyDeposited: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.lending", data.positionId as string, { event: "supply.deposited", ...data }),
  loanBorrowed: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.lending", data.positionId as string, { event: "loan.borrowed", ...data }),
  loanRepaid: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.lending", data.positionId as string, { event: "loan.repaid", ...data }),

  // F7+F8: Invoices & Subscriptions
  invoiceCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.invoices", data.invoiceId as string, { event: "invoice.created", ...data }),
  invoicePaid: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.invoices", data.invoiceId as string, { event: "invoice.paid", ...data }),
  subscriptionCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.subscriptions", data.subscriptionId as string, { event: "subscription.created", ...data }),
  subscriptionCancelled: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.subscriptions", data.subscriptionId as string, { event: "subscription.cancelled", ...data }),

  // F9: Savings Vault
  savingsDeposited: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.savings", data.depositId as string, { event: "savings.deposited", ...data }),
  savingsWithdrawn: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.savings", data.depositId as string, { event: "savings.withdrawn", ...data }),

  // F10: Remittance Corridors
  corridorTransferSent: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.corridors", data.transferId as string, { event: "corridor.transfer_sent", ...data }),

  // F11-F20: Platform Features
  payrollExecuted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.payroll", data.runId as string, { event: "payroll.executed", ...data }),
  limitOrderCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.limit-orders", data.orderId as string, { event: "limit_order.created", ...data }),
  giftCardPurchased: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.gift-cards", data.purchaseId as string, { event: "gift_card.purchased", ...data }),
  apiKeyCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.dev-api", data.keyId as string, { event: "api_key.created", ...data }),
  proposalCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.governance", data.proposalId as string, { event: "proposal.created", ...data }),
  proposalVoted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.governance", data.proposalId as string, { event: "proposal.voted", ...data }),
  nftMinted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.nft-receipts", data.tokenId as string, { event: "nft.minted", ...data }),

  // QR Payments
  qrCodeCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.qr-payments", data.qrId as string, { event: "qr.created", ...data }),
  qrCodeScanned: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.qr-payments", data.scanId as string, { event: "qr.scanned", ...data }),
  merchantQRRegistered: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.qr-payments", data.profileId as string, { event: "merchant_qr.registered", ...data }),

  // NFC Payments
  nfcTerminalRegistered: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.nfc-payments", data.terminalId as string, { event: "nfc.terminal_registered", ...data }),
  nfcPaymentProcessed: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.nfc-payments", data.txId as string, { event: "nfc.payment_processed", ...data }),
  nfcTagProvisioned: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.nfc-payments", data.tagId as string, { event: "nfc.tag_provisioned", ...data }),
  nfcOfflineSynced: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.nfc-payments", data.offlineId as string, { event: "nfc.offline_synced", ...data }),
  nfcRefundProcessed: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.nfc-payments", data.txId as string, { event: "nfc.refund_processed", ...data }),
};

// ── Database Migration for Feature Tables ────────────────────────────────────

export async function ensureFeatureTables(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id VARCHAR(64) PRIMARY KEY,
        debit_account_id VARCHAR(64) NOT NULL,
        credit_account_id VARCHAR(64) NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'USD',
        reference VARCHAR(256),
        code INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_merchant_accounts (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        business_name VARCHAR(200) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        total_volume NUMERIC(18,2) DEFAULT 0,
        total_payments INTEGER DEFAULT 0,
        fee_percent NUMERIC(5,2) DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_payment_intents (
        id VARCHAR(64) PRIMARY KEY,
        merchant_id VARCHAR(64) NOT NULL REFERENCES feature_merchant_accounts(id),
        amount NUMERIC(18,2) NOT NULL,
        currency VARCHAR(8) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        tx_hash VARCHAR(128),
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_invoices (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        currency VARCHAR(8) NOT NULL,
        stablecoin VARCHAR(8) NOT NULL,
        status VARCHAR(20) DEFAULT 'sent',
        payment_link TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_subscriptions (
        id VARCHAR(64) PRIMARY KEY,
        merchant_id VARCHAR(64) NOT NULL,
        subscriber_user_id INTEGER NOT NULL,
        plan_name VARCHAR(200),
        amount NUMERIC(18,2) NOT NULL,
        stablecoin VARCHAR(8) NOT NULL,
        interval VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        next_billing_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_swap_executions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        from_coin VARCHAR(8) NOT NULL,
        to_coin VARCHAR(8) NOT NULL,
        from_chain VARCHAR(20),
        to_chain VARCHAR(20),
        input_amount NUMERIC(18,6) NOT NULL,
        output_amount NUMERIC(18,6) NOT NULL,
        fee NUMERIC(18,6),
        status VARCHAR(20) DEFAULT 'completed',
        tx_hash VARCHAR(128),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_lending_positions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type VARCHAR(10) NOT NULL,
        coin VARCHAR(8) NOT NULL,
        amount NUMERIC(18,6) NOT NULL,
        rate NUMERIC(8,4),
        health_factor NUMERIC(8,4),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_savings_deposits (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount NUMERIC(18,6) NOT NULL,
        stablecoin VARCHAR(8) NOT NULL,
        term_days INTEGER NOT NULL,
        apy NUMERIC(8,4) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        maturity_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_corridor_transfers (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        corridor_id VARCHAR(10) NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        source_currency VARCHAR(8) NOT NULL,
        dest_currency VARCHAR(8) NOT NULL,
        fx_rate NUMERIC(18,6) NOT NULL,
        fee NUMERIC(18,2) NOT NULL,
        dest_amount NUMERIC(18,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_smart_wallets (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        chain VARCHAR(20) NOT NULL,
        address VARCHAR(128),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_batch_payouts (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(200),
        stablecoin VARCHAR(8) NOT NULL,
        total_amount NUMERIC(18,6) NOT NULL,
        total_fee NUMERIC(18,6) NOT NULL,
        recipient_count INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_programmable_payments (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type VARCHAR(20) NOT NULL,
        amount NUMERIC(18,6) NOT NULL,
        stablecoin VARCHAR(8) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        schedule_type VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_entries(reference);
      CREATE INDEX IF NOT EXISTS idx_merchant_user ON feature_merchant_accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_user ON feature_invoices(user_id);
      CREATE INDEX IF NOT EXISTS idx_swap_user ON feature_swap_executions(user_id);
      CREATE INDEX IF NOT EXISTS idx_lending_user ON feature_lending_positions(user_id);
      CREATE INDEX IF NOT EXISTS idx_savings_user ON feature_savings_deposits(user_id);
      CREATE INDEX IF NOT EXISTS idx_corridor_user ON feature_corridor_transfers(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_user ON feature_smart_wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_batch_user ON feature_batch_payouts(user_id);
      CREATE INDEX IF NOT EXISTS idx_payment_user ON feature_programmable_payments(user_id);
    `);

    logger.info("Feature persistence tables ensured");
  } catch (err) {
    logger.debug({ err }, "Feature table creation failed — running in-memory only mode");
  }
}

// ── Webhook Retry Queue ──────────────────────────────────────────────────────

interface WebhookAttempt {
  url: string;
  payload: string;
  signature: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number;
  status: "pending" | "delivered" | "failed";
}

const webhookQueue: WebhookAttempt[] = [];
let webhookProcessorRunning = false;

export async function enqueueWebhook(url: string, payload: string, signature: string): Promise<void> {
  webhookQueue.push({
    url,
    payload,
    signature,
    attempts: 0,
    maxAttempts: 5,
    nextRetryAt: Date.now(),
    status: "pending",
  });

  if (!webhookProcessorRunning) {
    webhookProcessorRunning = true;
    processWebhookQueue().catch(() => { webhookProcessorRunning = false; });
  }
}

async function processWebhookQueue(): Promise<void> {
  while (webhookQueue.some(w => w.status === "pending")) {
    const pending = webhookQueue.filter(w => w.status === "pending" && w.nextRetryAt <= Date.now());

    for (const webhook of pending) {
      webhook.attempts++;
      try {
        const res = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-RemitFlow-Signature": webhook.signature,
          },
          body: webhook.payload,
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok || res.status < 500) {
          webhook.status = "delivered";
          emitFeatureEvent("feature.webhooks", webhook.url, {
            event: "webhook.delivered",
            attempts: webhook.attempts,
          });
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        if (webhook.attempts >= webhook.maxAttempts) {
          webhook.status = "failed";
          emitFeatureEvent("feature.webhooks", webhook.url, {
            event: "webhook.failed",
            attempts: webhook.attempts,
          });
        } else {
          // Exponential backoff: 1s, 4s, 9s, 16s, 25s
          webhook.nextRetryAt = Date.now() + (webhook.attempts ** 2) * 1000;
        }
      }
    }

    // Wait 1s before next check
    await new Promise(r => setTimeout(r, 1000));
  }
  webhookProcessorRunning = false;
}

// ── Circuit Breaker for External APIs ────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  successCount: number;
}

const circuits = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 30_000;
const HALF_OPEN_SUCCESS_THRESHOLD = 3;

export function getCircuitBreaker(serviceName: string): {
  canRequest: () => boolean;
  recordSuccess: () => void;
  recordFailure: () => void;
} {
  if (!circuits.has(serviceName)) {
    circuits.set(serviceName, { failures: 0, lastFailure: 0, state: "closed", successCount: 0 });
  }

  const circuit = circuits.get(serviceName)!;

  return {
    canRequest: () => {
      if (circuit.state === "closed") return true;
      if (circuit.state === "open") {
        if (Date.now() - circuit.lastFailure > RECOVERY_TIMEOUT_MS) {
          circuit.state = "half-open";
          circuit.successCount = 0;
          return true;
        }
        return false;
      }
      // half-open
      return true;
    },

    recordSuccess: () => {
      if (circuit.state === "half-open") {
        circuit.successCount++;
        if (circuit.successCount >= HALF_OPEN_SUCCESS_THRESHOLD) {
          circuit.state = "closed";
          circuit.failures = 0;
        }
      }
      if (circuit.state === "closed") circuit.failures = 0;
    },

    recordFailure: () => {
      circuit.failures++;
      circuit.lastFailure = Date.now();
      if (circuit.failures >= FAILURE_THRESHOLD) {
        circuit.state = "open";
        logger.warn({ serviceName, failures: circuit.failures }, "Circuit breaker opened");
        emitFeatureEvent("feature.circuit-breaker", serviceName, {
          event: "circuit.opened",
          failures: circuit.failures,
        });
      }
    },
  };
}

// ── Input Sanitization ───────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
};

export function sanitizeHtml(input: string): string {
  return input.replace(/[&<>"'/]/g, char => HTML_ENTITIES[char] || char);
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T, fields: string[]): T {
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === "string") {
      (result as any)[field] = sanitizeHtml(result[field] as string);
    }
  }
  return result;
}
