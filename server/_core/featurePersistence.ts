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

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_featurePersistencets: any = null;
async function _getWtDb_featurePersistencets() {
  if (_wtDb_featurePersistencets) return _wtDb_featurePersistencets;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_featurePersistencets = await getDb();
    return _wtDb_featurePersistencets;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_featurePersistencets();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* hot cache still works */ }
}
async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb_featurePersistencets();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}


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

  const bridgeUrl = process.env.TIGERBEETLE_BRIDGE_URL?.replace(/\/$/, "");
  if (!bridgeUrl) throw new Error("TIGERBEETLE_BRIDGE_URL is required for ledger writes");
  const res = await fetch(`${bridgeUrl}/api/ledger/transfer`, {
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
  if (!res.ok) throw new Error(`TigerBeetle ledger bridge rejected ${entry.reference}: ${res.status}`);

  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable for ledger reconciliation persistence");
  await (db as any).execute(sql`
    INSERT INTO ledger_entries (id, debit_account_id, credit_account_id, amount, currency, reference, code, created_at)
    VALUES (${ledgerEntry.id}, ${entry.debitAccountId}, ${entry.creditAccountId}, ${entry.amount}, ${entry.currency}, ${entry.reference}, ${entry.code}, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Compatibility cache is populated only after both durable writes succeed.
  ledgerEntries.push(ledgerEntry);
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
    const columnList = columns.map(c => `"${camelToSnake(c)}"`).join(", ");
    // Build parameterized placeholders for safe insertion
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const updateSet = columns.map((c, i) => `"${camelToSnake(c)}" = $${i + 1}`).join(", ");

    const query = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})
       ON CONFLICT ("id") DO UPDATE SET ${updateSet}`;

    // Use parameterized query with actual values bound
    const serializedValues = values.map(v => {
      if (v === null || v === undefined) return null;
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    });

    await (db as any).execute(sql.raw(query), serializedValues);
  } catch (err) {
    logger.debug({ err, tableName, id }, "persistFeatureRecord failed — table may not exist");
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Load all records from a feature table, optionally filtered by user_id.
 * Returns an array of camelCased objects.
 */
export async function loadFeatureRecords(
  tableName: string,
  filter?: { userId?: number; where?: string },
): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = `SELECT * FROM "${tableName}"`;
    if (filter?.userId) {
      query += ` WHERE user_id = ${filter.userId}`;
    }
    if (filter?.where) {
      query += filter.userId ? ` AND ${filter.where}` : ` WHERE ${filter.where}`;
    }
    query += ` ORDER BY created_at DESC`;

    const rows = await (db as any).execute(sql.raw(query));
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map((row: Record<string, unknown>) => {
      const camelRow: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        camelRow[snakeToCamel(key)] = value;
      }
      return camelRow;
    });
  } catch {
    return [];
  }
}

/**
 * Load a single record by ID from a feature table.
 */
export async function loadFeatureRecord(
  tableName: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // Use parameterized query to prevent SQL injection
    const rows = await (db as any).execute(
      sql`SELECT * FROM ${sql.raw(`"${tableName}"`)} WHERE id = ${id} LIMIT 1`
    );
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;
    const camelRow: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      camelRow[snakeToCamel(key)] = value;
    }
    return camelRow;
  } catch {
    return null;
  }
}

/**
 * Delete a record from a feature table by ID.
 */
export async function deleteFeatureRecord(
  tableName: string,
  id: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any).execute(
      sql`DELETE FROM ${sql.raw(`"${tableName}"`)} WHERE id = ${id}`
    );
  } catch {
    // Graceful degradation
  }
}

/**
 * Update specific columns on a feature record.
 */
export async function updateFeatureRecord(
  tableName: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const entries = Object.entries(data);
    const setClauses = entries.map(([key], i) => `"${camelToSnake(key)}" = $${i + 1}`).join(", ");
    const values = entries.map(([, val]) => {
      if (val === null || val === undefined) return null;
      if (typeof val === "object") return JSON.stringify(val);
      return val;
    });
    values.push(id); // for WHERE clause

    await (db as any).execute(
      sql.raw(`UPDATE "${tableName}" SET ${setClauses} WHERE id = $${entries.length + 1}`),
      values,
    );
  } catch {
    // Graceful degradation
  }
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

  // Mark Lane Integration
  markLaneQuoteCreated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.quoteId as string, { event: "marklane.quote.created", ...data }),
  markLaneTransferInitiated: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.transferId as string, { event: "marklane.transfer.initiated", ...data }),
  markLaneTransferCancelled: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.transferId as string, { event: "marklane.transfer.cancelled", ...data }),
  markLaneTransferCompleted: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.transferId as string, { event: "marklane.transfer.completed", ...data }),
  markLaneKYCPassportRequested: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.passportId as string, { event: "marklane.kyc.passport_requested", ...data }),
  markLaneKYCPassportRevoked: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.passportId as string, { event: "marklane.kyc.passport_revoked", ...data }),
  markLanePrefundingRequested: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.prefundingId as string, { event: "marklane.settlement.prefunding", ...data }),
  markLaneFXProfessionalRegistered: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.professionalId as string, { event: "marklane.fx_professional.registered", ...data }),
  markLaneWebhookRegistered: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.webhookId as string, { event: "marklane.webhook.registered", ...data }),
  markLaneWebhookProcessed: (data: Record<string, unknown>) =>
    emitFeatureEvent("feature.marklane", data.eventId as string, { event: "marklane.webhook.processed", ...data }),
};

// ── Database Migration for Feature Tables ────────────────────────────────────

const REQUIRED_FEATURE_TABLES = [
  "feature_merchant_accounts",
  "feature_payment_intents",
  "feature_invoices",
  "feature_subscriptions",
  "feature_swap_executions",
  "feature_lending_positions",
  "feature_savings_deposits",
  "feature_corridor_transfers",
  "feature_smart_wallets",
  "feature_batch_payouts",
  "feature_programmable_payments",
  "feature_payroll_runs",
  "feature_limit_orders",
  "feature_api_keys",
  "feature_proposals",
  "feature_referrals",
  "feature_qr_codes",
  "feature_qr_scans",
  "feature_nfc_terminals",
  "feature_nfc_transactions",
  "feature_nfc_tags",
  "feature_merchant_qr_profiles",
  "feature_marklane_quotes",
  "feature_marklane_transfers",
  "feature_marklane_kyc_passports",
  "feature_marklane_fx_professionals",
  "feature_marklane_prefunding",
  "compliance_filings",
] as const;

/**
 * Verify that the migration lifecycle has provisioned the feature tables.
 * This module deliberately does not mutate schema at startup: a missing table
 * is a deployment failure, not a condition for an in-memory fallback.
 */
export async function ensureFeatureTables(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable while validating feature persistence schema");
  const escapedNames = REQUIRED_FEATURE_TABLES.map(name => `'${name}'`).join(", ");
  const result = await (db as any).execute(sql.raw(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${escapedNames})
  `));
  const rows = Array.isArray(result) ? result : (result?.rows ?? []);
  const found = new Set(rows.map((row: { table_name?: string }) => row.table_name));
  const missing = REQUIRED_FEATURE_TABLES.filter(name => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Feature persistence schema is incomplete; run migrations before startup: ${missing.join(", ")}`);
  }
  logger.info({ tableCount: REQUIRED_FEATURE_TABLES.length }, "Feature persistence schema verified");
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
    _writeThrough("wt_feature_persistence_circuits", String(serviceName), { failures: 0, lastFailure: 0, state: "closed", successCount: 0 }).catch(() => {});
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
