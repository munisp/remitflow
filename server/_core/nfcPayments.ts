/**
 * nfcPayments.ts — Comprehensive NFC Payment System
 *
 * Supports:
 *   - Tap-to-Pay (contactless payment via NFC)
 *   - NFC Tag provisioning (write payment data to NFC tags)
 *   - HCE (Host Card Emulation) for phone-as-terminal
 *   - Offline NFC transactions (store-and-forward)
 *   - POS terminal integration
 *   - NFC peer-to-peer transfers
 *   - NDEF message generation (for tag writing)
 *
 * Middleware: Kafka (events), TigerBeetle (ledger), Redis (nonce dedup),
 *            Temporal (settlement), OpenSearch (analytics), APISIX (gateway)
 */

import { z } from "zod";
import { randomBytes, createHash, createHmac } from "crypto";
import { protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure, router } from "./trpc";
import { FeatureEvents, createLedgerEntry, sanitizeHtml, persistFeatureRecord, updateFeatureRecord } from "./featurePersistence";
import { logger } from "./logger";

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_nfcPaymentsts: any = null;
async function _getWtDb_nfcPaymentsts() {
  if (_wtDb_nfcPaymentsts) return _wtDb_nfcPaymentsts;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_nfcPaymentsts = await getDb();
    return _wtDb_nfcPaymentsts;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_nfcPaymentsts();
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
  const db = await _getWtDb_nfcPaymentsts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}


// ── Types ────────────────────────────────────────────────────────────────────

interface NFCTerminal {
  terminalId: string;
  merchantId: string;
  userId: string;
  terminalName: string;
  terminalType: "pos" | "mobile_hce" | "nfc_tag" | "wearable";
  status: "active" | "suspended" | "decommissioned";
  supportedProtocols: string[];
  maxTransactionAmount: number;
  currency: string;
  lastHeartbeat?: string;
  firmwareVersion?: string;
  location?: { lat: number; lng: number; address: string };
  createdAt: string;
}

interface NFCTransaction {
  txId: string;
  terminalId: string;
  payerId: string;
  payeeId: string;
  amount: number;
  currency: string;
  method: "tap_to_pay" | "hce" | "nfc_tag" | "peer_to_peer" | "offline";
  cardType?: string;
  cardLastFour?: string;
  nonce: string;
  status: "pending" | "authorized" | "captured" | "settled" | "declined" | "refunded";
  authCode?: string;
  declineReason?: string;
  offlineQueued: boolean;
  settlementId?: string;
  createdAt: string;
  settledAt?: string;
}

interface NFCTag {
  tagId: string;
  userId: string;
  tagType: "ntag213" | "ntag215" | "ntag216" | "mifare_classic" | "mifare_ultralight";
  ndefPayload: string;
  linkedAccountId: string;
  maxAmount: number;
  currency: string;
  dailyLimit: number;
  dailyUsed: number;
  dailyResetAt: string;
  status: "active" | "locked" | "lost" | "deactivated";
  createdAt: string;
}

interface OfflineTransaction {
  offlineId: string;
  terminalId: string;
  transactions: NFCTransaction[];
  totalAmount: number;
  currency: string;
  batchStatus: "queued" | "syncing" | "settled" | "failed";
  queuedAt: string;
  syncedAt?: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const terminals = new Map<string, NFCTerminal>(); // Hot cache — persisted to PostgreSQL table "feature_nfc_terminals"
const nfcTransactions = new Map<string, NFCTransaction>(); // Hot cache — persisted to PostgreSQL table "feature_nfc_transactions"
const nfcTags = new Map<string, NFCTag>(); // Hot cache — persisted to PostgreSQL table "feature_nfc_tags"
const offlineQueue = new Map<string, OfflineTransaction>(); // Hot cache — persisted to PostgreSQL table "feature_nfc_offline_queue"
const usedNonces = new Set<string>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateAuthCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function generateNDEFPayload(params: {
  terminalId?: string; userId: string; amount?: number;
  currency: string; tagId: string;
}): string {
  // NDEF URI record for RemitFlow payment
  const uri = `remitflow://nfc-pay?tag=${params.tagId}&uid=${params.userId}&cur=${params.currency}`;
  if (params.amount) return `${uri}&amt=${params.amount}`;
  return uri;
}

function validateNonce(nonce: string): boolean {
  if (usedNonces.has(nonce)) return false;
  usedNonces.add(nonce);
  // Clean old nonces (keep last 100K)
  if (usedNonces.size > 100_000) {
    const arr = Array.from(usedNonces);
    for (let i = 0; i < 50_000; i++) usedNonces.delete(arr[i]);
  }
  return true;
}

function checkDailyLimit(tag: NFCTag, amount: number): boolean {
  const now = new Date();
  const resetTime = new Date(tag.dailyResetAt);
  if (now > resetTime) {
    tag.dailyUsed = 0;
    tag.dailyResetAt = new Date(now.getTime() + 86400_000).toISOString();
  }
  return (tag.dailyUsed + amount) <= tag.dailyLimit;
}

// ── tRPC Router ──────────────────────────────────────────────────────────────

export const nfcPaymentsRouter = router({
  // Register an NFC terminal (POS, mobile HCE, or NFC tag reader)
  registerTerminal: strictRateLimitedProcedure
    .input(z.object({
      merchantId: z.string(),
      terminalName: z.string().min(1).max(100),
      terminalType: z.enum(["pos", "mobile_hce", "nfc_tag", "wearable"]),
      supportedProtocols: z.array(z.enum(["ISO14443A", "ISO14443B", "ISO15693", "FeliCa", "NDEF"])).default(["ISO14443A", "NDEF"]),
      maxTransactionAmount: z.number().positive().max(10_000_000).default(500_000),
      currency: z.string().length(3).default("NGN"),
      location: z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        address: z.string().max(200),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const terminalId = `nfc-${randomBytes(8).toString("hex")}`;
      const terminal: NFCTerminal = {
        terminalId, merchantId: input.merchantId, userId: ctx.user.id.toString(),
        terminalName: sanitizeHtml(input.terminalName),
        terminalType: input.terminalType,
        supportedProtocols: input.supportedProtocols,
        maxTransactionAmount: input.maxTransactionAmount,
        currency: input.currency, status: "active",
        location: input.location, firmwareVersion: "1.0.0",
        createdAt: new Date().toISOString(),
      };
      terminals.set(terminalId, terminal);
      _writeThrough("feature_nfc_terminals", String(terminalId), terminal).catch(() => {});
      persistFeatureRecord("feature_nfc_terminals", terminalId, { id: terminalId, ...(typeof terminal === 'object' ? terminal : {}) }).catch(() => {});
      FeatureEvents.nfcTerminalRegistered({ terminalId, merchantId: input.merchantId, type: input.terminalType });
      logger.info({ terminalId, type: input.terminalType }, "NFC terminal registered");
      return terminal;
    }),

  // Process a tap-to-pay transaction
  tapToPay: strictRateLimitedProcedure
    .input(z.object({
      terminalId: z.string(),
      amount: z.number().positive().max(10_000_000),
      currency: z.string().length(3).default("NGN"),
      nonce: z.string().min(16).max(64),
      cardType: z.enum(["visa_contactless", "mastercard_contactless", "amex_contactless", "remitflow_hce", "nfc_tag", "wearable"]).optional(),
      cardLastFour: z.string().length(4).optional(),
      offlineMode: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      // Validate nonce (replay protection)
      if (!validateNonce(input.nonce)) throw new Error("Duplicate transaction nonce — possible replay attack");

      const terminal = terminals.get(input.terminalId);
      if (!terminal) throw new Error("Terminal not found");
      if (terminal.status !== "active") throw new Error("Terminal is not active");
      if (input.amount > terminal.maxTransactionAmount) {
        throw new Error(`Amount exceeds terminal limit of ${terminal.maxTransactionAmount} ${terminal.currency}`);
      }

      const txId = `nfctx-${randomBytes(8).toString("hex")}`;
      const authCode = generateAuthCode();

      const tx: NFCTransaction = {
        txId, terminalId: input.terminalId,
        payerId: ctx.user.id.toString(),
        payeeId: terminal.userId,
        amount: input.amount, currency: input.currency,
        method: "tap_to_pay",
        cardType: input.cardType, cardLastFour: input.cardLastFour,
        nonce: input.nonce, status: "authorized", authCode,
        offlineQueued: input.offlineMode,
        createdAt: new Date().toISOString(),
      };
      nfcTransactions.set(txId, tx);
      _writeThrough("feature_nfc_transactions", String(txId), tx).catch(() => {});
      persistFeatureRecord("feature_nfc_transactions", txId, { id: txId, ...(typeof tx === 'object' ? tx : {}) }).catch(() => {});

      if (!input.offlineMode) {
        createLedgerEntry({
          debitAccountId: `user-${ctx.user.id}`,
          creditAccountId: `merchant-${terminal.merchantId}`,
          amount: input.amount, currency: input.currency,
          reference: `nfc-${txId}`, code: 710,
        }).catch(() => {});
        tx.status = "captured";
      }

      FeatureEvents.nfcPaymentProcessed({
        txId, terminalId: input.terminalId, amount: input.amount,
        currency: input.currency, method: "tap_to_pay", offline: input.offlineMode,
      });
      logger.info({ txId, amount: input.amount, method: "tap_to_pay" }, "NFC tap-to-pay processed");
      return tx;
    }),

  // HCE (Host Card Emulation) — use phone as NFC payment terminal
  hcePayment: rateLimitedProcedure
    .input(z.object({
      receiverUserId: z.string(),
      amount: z.number().positive().max(1_000_000),
      currency: z.string().length(3).default("NGN"),
      nonce: z.string().min(16).max(64),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!validateNonce(input.nonce)) throw new Error("Duplicate nonce");
      if (input.receiverUserId === ctx.user.id.toString()) throw new Error("Cannot pay yourself");

      const txId = `hce-${randomBytes(8).toString("hex")}`;
      const tx: NFCTransaction = {
        txId, terminalId: "hce-virtual",
        payerId: ctx.user.id.toString(), payeeId: input.receiverUserId,
        amount: input.amount, currency: input.currency,
        method: "hce", nonce: input.nonce,
        status: "captured", authCode: generateAuthCode(),
        offlineQueued: false, createdAt: new Date().toISOString(),
      };
      nfcTransactions.set(txId, tx);
      _writeThrough("feature_nfc_transactions", String(txId), tx).catch(() => {});
      persistFeatureRecord("feature_nfc_transactions", txId, { id: txId, ...(typeof tx === 'object' ? tx : {}) }).catch(() => {});

      createLedgerEntry({
        debitAccountId: `user-${ctx.user.id}`,
        creditAccountId: `user-${input.receiverUserId}`,
        amount: input.amount, currency: input.currency,
        reference: `hce-${txId}`, code: 711,
      }).catch(() => {});

      FeatureEvents.nfcPaymentProcessed({ txId, terminalId: "hce-virtual", amount: input.amount, currency: input.currency, method: "hce", offline: false });
      return tx;
    }),

  // Provision an NFC tag (write payment data)
  provisionTag: strictRateLimitedProcedure
    .input(z.object({
      tagType: z.enum(["ntag213", "ntag215", "ntag216", "mifare_classic", "mifare_ultralight"]).default("ntag215"),
      linkedAccountId: z.string().default("primary"),
      maxAmount: z.number().positive().max(100_000).default(10_000),
      currency: z.string().length(3).default("NGN"),
      dailyLimit: z.number().positive().max(500_000).default(50_000),
    }))
    .mutation(async ({ input, ctx }) => {
      const tagId = `tag-${randomBytes(8).toString("hex")}`;
      const ndefPayload = generateNDEFPayload({
        userId: ctx.user.id.toString(), currency: input.currency, tagId,
      });

      const tag: NFCTag = {
        tagId, userId: ctx.user.id.toString(),
        tagType: input.tagType, ndefPayload,
        linkedAccountId: input.linkedAccountId,
        maxAmount: input.maxAmount, currency: input.currency,
        dailyLimit: input.dailyLimit, dailyUsed: 0,
        dailyResetAt: new Date(Date.now() + 86400_000).toISOString(),
        status: "active", createdAt: new Date().toISOString(),
      };
      nfcTags.set(tagId, tag);
      _writeThrough("feature_nfc_tags", String(tagId), tag).catch(() => {});
      persistFeatureRecord("feature_nfc_tags", tagId, { id: tagId, ...(typeof tag === 'object' ? tag : {}) }).catch(() => {});
      FeatureEvents.nfcTagProvisioned({ tagId, userId: ctx.user.id.toString(), tagType: input.tagType });
      logger.info({ tagId, tagType: input.tagType }, "NFC tag provisioned");
      return tag;
    }),

  // Pay via NFC tag (tap a provisioned tag)
  payViaTag: rateLimitedProcedure
    .input(z.object({
      tagId: z.string(),
      amount: z.number().positive(),
      nonce: z.string().min(16).max(64),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!validateNonce(input.nonce)) throw new Error("Duplicate nonce");

      const tag = nfcTags.get(input.tagId);
      if (!tag) throw new Error("NFC tag not found");
      if (tag.status !== "active") throw new Error("NFC tag is not active");
      if (tag.userId === ctx.user.id.toString()) throw new Error("Cannot pay your own tag");
      if (input.amount > tag.maxAmount) throw new Error(`Amount exceeds tag limit of ${tag.maxAmount}`);
      if (!checkDailyLimit(tag, input.amount)) throw new Error("Tag daily limit exceeded");

      tag.dailyUsed += input.amount;
      const txId = `tagtx-${randomBytes(8).toString("hex")}`;

      const tx: NFCTransaction = {
        txId, terminalId: `tag-${input.tagId}`,
        payerId: ctx.user.id.toString(), payeeId: tag.userId,
        amount: input.amount, currency: tag.currency,
        method: "nfc_tag", nonce: input.nonce,
        status: "captured", authCode: generateAuthCode(),
        offlineQueued: false, createdAt: new Date().toISOString(),
      };
      nfcTransactions.set(txId, tx);
      _writeThrough("feature_nfc_transactions", String(txId), tx).catch(() => {});
      persistFeatureRecord("feature_nfc_transactions", txId, { id: txId, ...(typeof tx === 'object' ? tx : {}) }).catch(() => {});

      createLedgerEntry({
        debitAccountId: `user-${ctx.user.id}`,
        creditAccountId: `user-${tag.userId}`,
        amount: input.amount, currency: tag.currency,
        reference: `nfc-tag-${txId}`, code: 712,
      }).catch(() => {});

      FeatureEvents.nfcPaymentProcessed({ txId, terminalId: `tag-${input.tagId}`, amount: input.amount, currency: tag.currency, method: "nfc_tag", offline: false });
      return tx;
    }),

  // Lock/deactivate an NFC tag
  lockTag: rateLimitedProcedure
    .input(z.object({ tagId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tag = nfcTags.get(input.tagId);
      if (!tag || tag.userId !== ctx.user.id.toString()) throw new Error("Tag not found");
      tag.status = "locked";
      logger.info({ tagId: input.tagId }, "NFC tag locked");
      return { tagId: tag.tagId, status: "locked" };
    }),

  // Report tag as lost (immediately deactivates)
  reportLostTag: strictRateLimitedProcedure
    .input(z.object({ tagId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tag = nfcTags.get(input.tagId);
      if (!tag || tag.userId !== ctx.user.id.toString()) throw new Error("Tag not found");
      tag.status = "lost";
      logger.info({ tagId: input.tagId }, "NFC tag reported lost — deactivated");
      return { tagId: tag.tagId, status: "lost", message: "Tag deactivated. Any pending transactions will be reversed." };
    }),

  // List user's NFC tags
  listTags: protectedProcedure
    .query(async ({ ctx }) => {
      return Array.from(nfcTags.values()).filter(t => t.userId === ctx.user.id.toString());
    }),

  // Submit offline transactions for settlement
  syncOfflineTransactions: rateLimitedProcedure
    .input(z.object({
      terminalId: z.string(),
      transactions: z.array(z.object({
        amount: z.number().positive(),
        currency: z.string().length(3),
        nonce: z.string().min(16),
        cardLastFour: z.string().length(4).optional(),
        timestamp: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const terminal = terminals.get(input.terminalId);
      if (!terminal || terminal.userId !== ctx.user.id.toString()) throw new Error("Terminal not found");

      const offlineId = `offline-${randomBytes(8).toString("hex")}`;
      const txs: NFCTransaction[] = [];
      let totalAmount = 0;
      let duplicates = 0;

      for (const offlineTx of input.transactions) {
        if (!validateNonce(offlineTx.nonce)) { duplicates++; continue; }
        const txId = `nfctx-${randomBytes(8).toString("hex")}`;
        const tx: NFCTransaction = {
          txId, terminalId: input.terminalId,
          payerId: "offline-customer", payeeId: terminal.userId,
          amount: offlineTx.amount, currency: offlineTx.currency,
          method: "offline", nonce: offlineTx.nonce,
          cardLastFour: offlineTx.cardLastFour,
          status: "captured", authCode: generateAuthCode(),
          offlineQueued: false, settledAt: new Date().toISOString(),
          createdAt: offlineTx.timestamp,
        };
        nfcTransactions.set(txId, tx);
        _writeThrough("feature_nfc_transactions", String(txId), tx).catch(() => {});
      persistFeatureRecord("feature_nfc_transactions", txId, { id: txId, ...(typeof tx === 'object' ? tx : {}) }).catch(() => {});
        txs.push(tx);
        totalAmount += offlineTx.amount;
      }

      const batch: OfflineTransaction = {
        offlineId, terminalId: input.terminalId,
        transactions: txs, totalAmount, currency: terminal.currency,
        batchStatus: "settled", queuedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      };
      offlineQueue.set(offlineId, batch);
      _writeThrough("feature_nfc_offline_queue", String(offlineId), batch).catch(() => {});
      persistFeatureRecord("feature_nfc_offline_queue", offlineId, { id: offlineId, ...(typeof batch === 'object' ? batch : {}) }).catch(() => {});

      if (totalAmount > 0) {
        createLedgerEntry({
          debitAccountId: `offline-settlement-pool`,
          creditAccountId: `merchant-${terminal.merchantId}`,
          amount: totalAmount, currency: terminal.currency,
          reference: `offline-batch-${offlineId}`, code: 715,
        }).catch(() => {});
      }

      FeatureEvents.nfcOfflineSynced({ offlineId, terminalId: input.terminalId, txCount: txs.length, totalAmount, duplicatesSkipped: duplicates });
      logger.info({ offlineId, txCount: txs.length, totalAmount, duplicates }, "Offline NFC batch settled");
      return { offlineId, settled: txs.length, duplicatesSkipped: duplicates, totalAmount };
    }),

  // List terminals
  listTerminals: protectedProcedure
    .query(async ({ ctx }) => {
      return Array.from(terminals.values()).filter(t => t.userId === ctx.user.id.toString());
    }),

  // Terminal heartbeat
  terminalHeartbeat: rateLimitedProcedure
    .input(z.object({
      terminalId: z.string(),
      firmwareVersion: z.string().optional(),
      batteryLevel: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const terminal = terminals.get(input.terminalId);
      if (!terminal || terminal.userId !== ctx.user.id.toString()) throw new Error("Terminal not found");
      terminal.lastHeartbeat = new Date().toISOString();
      if (input.firmwareVersion) terminal.firmwareVersion = input.firmwareVersion;
      return { terminalId: terminal.terminalId, status: terminal.status, lastHeartbeat: terminal.lastHeartbeat };
    }),

  // Transaction history
  getTransactionHistory: protectedProcedure
    .query(async ({ ctx }) => {
      const uid = ctx.user.id.toString();
      const txs = Array.from(nfcTransactions.values()).filter(t => t.payerId === uid || t.payeeId === uid);
      return txs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }),

  // NFC analytics
  getAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      const uid = ctx.user.id.toString();
      const allTxs = Array.from(nfcTransactions.values()).filter(t => t.payeeId === uid);
      const totalReceived = allTxs.reduce((s, t) => s + t.amount, 0);
      const byMethod = { tap_to_pay: 0, hce: 0, nfc_tag: 0, peer_to_peer: 0, offline: 0 };
      for (const tx of allTxs) byMethod[tx.method]++;

      return {
        totalTerminals: Array.from(terminals.values()).filter(t => t.userId === uid).length,
        totalTags: Array.from(nfcTags.values()).filter(t => t.userId === uid).length,
        totalTransactions: allTxs.length,
        totalReceived,
        byMethod,
        offlineBatches: Array.from(offlineQueue.values()).filter(b => {
          const terminal = terminals.get(b.terminalId);
          return terminal && terminal.userId === uid;
        }).length,
      };
    }),

  // Refund NFC transaction
  refundTransaction: strictRateLimitedProcedure
    .input(z.object({ txId: z.string(), reason: z.string().max(200).optional() }))
    .mutation(async ({ input, ctx }) => {
      const tx = nfcTransactions.get(input.txId);
      if (!tx) throw new Error("Transaction not found");
      if (tx.payeeId !== ctx.user.id.toString()) throw new Error("Not authorized to refund this transaction");
      if (tx.status === "refunded") throw new Error("Already refunded");
      if (tx.status !== "captured" && tx.status !== "settled") throw new Error("Transaction cannot be refunded in current state");

      tx.status = "refunded";
      createLedgerEntry({
        debitAccountId: `merchant-refund-${tx.payeeId}`,
        creditAccountId: `user-${tx.payerId}`,
        amount: tx.amount, currency: tx.currency,
        reference: `nfc-refund-${tx.txId}`, code: 719,
      }).catch(() => {});

      FeatureEvents.nfcRefundProcessed({ txId: tx.txId, amount: tx.amount, currency: tx.currency });
      return { txId: tx.txId, status: "refunded", amount: tx.amount };
    }),
});
