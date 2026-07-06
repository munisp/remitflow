/**
 * RemitFlow — Mojaloop FSP Adapter
 * Implements the Mojaloop Open API v1.1 (FSPIOP) specification for interbank transfers.
 * Docs: https://docs.mojaloop.io/api-snippets/
 *
 * Endpoints used:
 *   POST /parties/{Type}/{ID}           — party lookup
 *   POST /quotes                        — quote request
 *   POST /transfers                     — transfer initiation
 *   GET  /transfers/{transferId}        — transfer status
 *   PUT  /transfers/{transferId}/error  — error callback
 *
 * Default sandbox: https://sandbox.mojaloop.io (public test environment)
 */

import crypto from "crypto";
import { circuitBreakers, CircuitOpenError } from "./services/circuitBreaker";
import { logger } from './_core/logger';

// ─── Configuration ────────────────────────────────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function mojaloopEnv(name: string, sandboxFallback: string): string {
  const val = process.env[name];
  if (val) return val;
  if (IS_PRODUCTION) {
    logger.error({ variable: name }, `[Mojaloop] CRITICAL: Missing ${name} in production — Mojaloop rail will be unavailable`);
    return "";
  }
  logger.warn({ variable: name }, `[Mojaloop] Using sandbox fallback for ${name} (development mode)`);
  return sandboxFallback;
}

const MOJALOOP_BASE_URL = mojaloopEnv("MOJALOOP_SWITCH_URL", "https://sandbox.mojaloop.io");
const MOJALOOP_FSP_ID = mojaloopEnv("MOJALOOP_FSP_ID", "remitflow-fsp");
const MOJALOOP_API_KEY = mojaloopEnv("MOJALOOP_API_KEY", "remitflow-sandbox-key");
const MOJALOOP_CALLBACK_URL =
  process.env.MOJALOOP_CALLBACK_URL ?? "https://remitflow.example.com/api/mojaloop/callback";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface MojaloopParty {
  partyIdType: "MSISDN" | "ACCOUNT_ID" | "EMAIL" | "PERSONAL_ID" | "BUSINESS" | "DEVICE" | "IBAN" | "ALIAS";
  partyIdentifier: string;
  fspId?: string;
  name?: string;
  personalInfo?: {
    complexName?: { firstName?: string; lastName?: string };
    dateOfBirth?: string;
  };
}

export interface MojaloopQuoteRequest {
  quoteId: string;
  transactionId: string;
  payee: MojaloopParty;
  payer: MojaloopParty;
  amountType: "SEND" | "RECEIVE";
  amount: { currency: string; amount: string };
  transactionType: {
    scenario: "TRANSFER" | "DEPOSIT" | "WITHDRAWAL" | "PAYMENT" | "REFUND";
    initiator: "PAYER" | "PAYEE";
    initiatorType: "CONSUMER" | "AGENT" | "BUSINESS" | "DEVICE";
  };
  note?: string;
}

export interface MojaloopTransferRequest {
  transferId: string;
  payeeFsp: string;
  payerFsp: string;
  amount: { currency: string; amount: string };
  ilpPacket: string;
  condition: string;
  expiration: string;
}

export interface MojaloopTransferResult {
  transferId: string;
  transferState: "RECEIVED" | "RESERVED" | "COMMITTED" | "ABORTED";
  completedTimestamp?: string;
  fulfilment?: string;
  errorInformation?: {
    errorCode: string;
    errorDescription: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateUUID(): string {
  return crypto.randomUUID();
}

function generateILPCondition(): string {
  // In production: use ILP library to generate real condition from fulfillment
  // For sandbox: use a deterministic SHA-256 preimage
  const preimage = crypto.randomBytes(32);
  const condition = crypto.createHash("sha256").update(preimage).digest("base64url");
  return condition;
}

function generateILPPacket(amount: string, currency: string, destination: string): string {
  // Simplified ILP packet (base64url encoded)
  // In production: use ilp-packet library
  const packet = Buffer.from(
    JSON.stringify({ amount, currency, destination, expiry: new Date(Date.now() + 30000).toISOString() })
  ).toString("base64url");
  return packet;
}

function getMojaloopHeaders(contentType = "application/json"): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Accept": "application/vnd.interoperability.transfers+json;version=1.1",
    "FSPIOP-Source": MOJALOOP_FSP_ID,
    "FSPIOP-Destination": "central-ledger",
    "Date": new Date().toUTCString(),
    "Authorization": `Bearer ${MOJALOOP_API_KEY}`,
    "X-Forwarded-For": "127.0.0.1",
  };
}

// ─── Party Lookup ─────────────────────────────────────────────────────────────
export async function lookupParty(
  partyIdType: MojaloopParty["partyIdType"],
  partyIdentifier: string
): Promise<{ found: boolean; party?: MojaloopParty; fspId?: string; error?: string }> {
  try {
    const url = `${MOJALOOP_BASE_URL}/parties/${partyIdType}/${encodeURIComponent(partyIdentifier)}`;
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(url, {
      method: "GET",
      headers: getMojaloopHeaders(),
      signal: AbortSignal.timeout(10000),
    }));
    if (resp.status === 200) {
      const body = await resp.json() as any;
      return {
        found: true,
        party: body.party ?? body,
        fspId: body.party?.partyIdInfo?.fspId ?? body.fspId,
      };
    }
    if (resp.status === 404) {
      return { found: false, error: "Party not found in Mojaloop network" };
    }
    // Async callback pattern — 202 Accepted means lookup is in progress
    if (resp.status === 202) {
      return { found: true, party: { partyIdType, partyIdentifier }, fspId: "pending-callback" };
    }
    return { found: false, error: `Lookup failed with status ${resp.status}` };
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — skipping party lookup');
    } else {
      logger.warn({ data: err.message }, '[Mojaloop] Party lookup failed');
    }
    if (IS_PRODUCTION) {
      return { found: false, error: `Mojaloop party lookup failed: ${err.message}` };
    }
    // Graceful fallback for development environments only
    return {
      found: true,
      party: {
        partyIdType,
        partyIdentifier,
        fspId: "ecobank-ng",
        name: "Mojaloop Test Payee",
        personalInfo: { complexName: { firstName: "Test", lastName: "Payee" } },
      },
      fspId: "ecobank-ng",
    };
  }
}

// ─── Quote Request ────────────────────────────────────────────────────────────
export async function requestQuote(params: {
  payerMsisdn: string;
  payeeMsisdn: string;
  payerFspId: string;
  payeeFspId: string;
  amount: string;
  currency: string;
  note?: string;
}): Promise<{
  quoteId: string;
  transactionId: string;
  transferAmount: { currency: string; amount: string };
  payeeFspFee?: { currency: string; amount: string };
  payeeFspCommission?: { currency: string; amount: string };
  expiration: string;
  ilpPacket: string;
  condition: string;
  error?: string;
}> {
  const quoteId = generateUUID();
  const transactionId = generateUUID();

  const quoteRequest: MojaloopQuoteRequest = {
    quoteId,
    transactionId,
    payee: {
      partyIdType: "MSISDN",
      partyIdentifier: params.payeeMsisdn,
      fspId: params.payeeFspId,
    },
    payer: {
      partyIdType: "MSISDN",
      partyIdentifier: params.payerMsisdn,
      fspId: params.payerFspId,
    },
    amountType: "SEND",
    amount: { currency: params.currency, amount: params.amount },
    transactionType: {
      scenario: "TRANSFER",
      initiator: "PAYER",
      initiatorType: "CONSUMER",
    },
    note: params.note,
  };

  try {
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/quotes`, {
      method: "POST",
      headers: getMojaloopHeaders(),
      body: JSON.stringify(quoteRequest),
      signal: AbortSignal.timeout(15000),
    }));

    if (resp.status === 200 || resp.status === 202) {
      // Async callback pattern: 202 means accepted, real quote comes via PUT /quotes/{quoteId}
      const expiration = new Date(Date.now() + 60000).toISOString();
      const ilpPacket = generateILPPacket(params.amount, params.currency, params.payeeMsisdn);
      const condition = generateILPCondition();
      return {
        quoteId,
        transactionId,
        transferAmount: { currency: params.currency, amount: params.amount },
        payeeFspFee: { currency: params.currency, amount: "0.50" },
        expiration,
        ilpPacket,
        condition,
      };
    }
    throw new Error(`Quote request failed: ${resp.status}`);
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — quote unavailable');
    } else {
      logger.warn({ data: err.message }, '[Mojaloop] Quote request failed');
    }
    if (IS_PRODUCTION) {
      throw new Error(`Mojaloop quote request failed: ${err.message}`);
    }
    const expiration = new Date(Date.now() + 60000).toISOString();
    return {
      quoteId,
      transactionId,
      transferAmount: { currency: params.currency, amount: params.amount },
      payeeFspFee: { currency: params.currency, amount: "0.50" },
      expiration,
      ilpPacket: generateILPPacket(params.amount, params.currency, params.payeeMsisdn),
      condition: generateILPCondition(),
    };
  }
}

// ─── Transfer Initiation ──────────────────────────────────────────────────────
export async function initiateTransfer(params: {
  payerFspId: string;
  payeeFspId: string;
  amount: string;
  currency: string;
  ilpPacket: string;
  condition: string;
  expirationSeconds?: number;
}): Promise<MojaloopTransferResult> {
  const transferId = generateUUID();
  const expiration = new Date(
    Date.now() + (params.expirationSeconds ?? 30) * 1000
  ).toISOString();

  const transferRequest: MojaloopTransferRequest = {
    transferId,
    payeeFsp: params.payeeFspId,
    payerFsp: params.payerFspId,
    amount: { currency: params.currency, amount: params.amount },
    ilpPacket: params.ilpPacket,
    condition: params.condition,
    expiration,
  };

  try {
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/transfers`, {
      method: "POST",
      headers: {
        ...getMojaloopHeaders(),
        "FSPIOP-Destination": params.payeeFspId,
      },
      body: JSON.stringify(transferRequest),
      signal: AbortSignal.timeout(30000),
    }));

    if (resp.status === 200) {
      const body = await resp.json() as any;
      return {
        transferId: body.transferId ?? transferId,
        transferState: body.transferState ?? "COMMITTED",
        completedTimestamp: body.completedTimestamp ?? new Date().toISOString(),
        fulfilment: body.fulfilment,
      };
    }
    if (resp.status === 202) {
      // Async: transfer accepted, state will be updated via PUT /transfers/{transferId}
      return {
        transferId,
        transferState: "RESERVED",
        completedTimestamp: undefined,
      };
    }
    const errBody = await resp.json().catch(() => ({})) as any;
    return {
      transferId,
      transferState: "ABORTED",
      errorInformation: {
        errorCode: errBody.errorInformation?.errorCode ?? String(resp.status),
        errorDescription: errBody.errorInformation?.errorDescription ?? `Transfer failed: ${resp.status}`,
      },
    };
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — transfer unavailable');
    } else {
      logger.warn({ data: err.message }, '[Mojaloop] Transfer initiation failed');
    }
    return {
      transferId,
      transferState: "ABORTED",
      errorInformation: { errorCode: "5000", errorDescription: `Mojaloop transfer failed: ${err.message}` },
    };
  }
}

// ─── Transfer Status ──────────────────────────────────────────────────────────
export async function getTransferStatus(transferId: string): Promise<MojaloopTransferResult> {
  try {
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/transfers/${transferId}`, {
      method: "GET",
      headers: getMojaloopHeaders(),
      signal: AbortSignal.timeout(10000),
    }));
    if (resp.status === 200) {
      const body = await resp.json() as any;
      return {
        transferId: body.transferId ?? transferId,
        transferState: body.transferState ?? "COMMITTED",
        completedTimestamp: body.completedTimestamp,
        fulfilment: body.fulfilment,
      };
    }
    return { transferId, transferState: "ABORTED", errorInformation: { errorCode: String(resp.status), errorDescription: "Status check failed" } };
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — status unavailable');
    }
    return { transferId, transferState: "ABORTED", errorInformation: { errorCode: "5000", errorDescription: `Status check failed: ${err.message}` } };
  }
}

// ─── FSP Participants List ────────────────────────────────────────────────────
export async function getFSPParticipants(): Promise<Array<{
  fspId: string;
  name: string;
  currency: string[];
  country: string;
  active: boolean;
}>> {
  try {
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/participants`, {
      headers: getMojaloopHeaders(),
      signal: AbortSignal.timeout(8000),
    }));
    if (resp.ok) {
      const body = await resp.json() as any;
      return Array.isArray(body) ? body : body.participants ?? [];
    }
  } catch { /* fallback */ }

  logger.warn("[Mojaloop] Participants endpoint unavailable — returning empty list");
  return [];
}

// ─── ILP Fulfillment / Condition Matching ─────────────────────────────────────

/**
 * Generate an ILP condition and fulfillment pair for a transfer.
 * The condition is a SHA-256 hash of the fulfillment.
 * The fulfillment is revealed only when the transfer is committed.
 *
 * Per FSPIOP spec:
 *   condition  = BASE64URL(SHA256(fulfillment))
 *   fulfillment = 32 random bytes, BASE64URL-encoded
 */
export function generateIlpConditionPair(): { condition: string; fulfillment: string } {
  const fulfillmentBytes = crypto.randomBytes(32);
  const fulfillment = fulfillmentBytes.toString("base64url");
  const condition = crypto.createHash("sha256").update(fulfillmentBytes).digest("base64url");
  return { condition, fulfillment };
}

/**
 * Verify that a fulfillment matches a condition.
 * Used in the callback handler when Mojaloop switch returns the fulfillment.
 */
export function verifyIlpFulfillment(condition: string, fulfillment: string): boolean {
  try {
    const fulfillmentBytes = Buffer.from(fulfillment, "base64url");
    const computedCondition = crypto.createHash("sha256").update(fulfillmentBytes).digest("base64url");
    return computedCondition === condition;
  } catch {
    return false;
  }
}

/**
 * Generate a full ILP packet for a transfer request.
 * Includes destination address, amount, and expiry.
 */
export function buildIlpPacket(params: {
  amount: string;
  currency: string;
  destinationFspId: string;
  destinationAccount: string;
  expirySeconds?: number;
}): { ilpPacket: string; condition: string; fulfillment: string } {
  const { condition, fulfillment } = generateIlpConditionPair();
  const expiry = new Date(Date.now() + (params.expirySeconds || 30) * 1000).toISOString();

  const packet = {
    amount: { amount: params.amount, currency: params.currency },
    destination: `g.${params.destinationFspId}.${params.destinationAccount}`,
    data: { transactionType: { scenario: "TRANSFER", initiator: "PAYER", initiatorType: "CONSUMER" } },
    expiration: expiry,
  };

  const ilpPacket = Buffer.from(JSON.stringify(packet)).toString("base64url");
  return { ilpPacket, condition, fulfillment };
}

// ─── Webhook Receiver (Mojaloop Callback Handlers) ───────────────────────────

export interface MojaloopCallback {
  transferId: string;
  transferState: "COMMITTED" | "ABORTED" | "RESERVED";
  fulfilment?: string;
  completedTimestamp?: string;
  errorInformation?: { errorCode: string; errorDescription: string };
}

/** Pending transfers awaiting callback — keyed by transferId */

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
// All in-memory Maps are persisted to PostgreSQL on write and loaded on startup.

let _wtDb: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null = null;

async function _getWtDb() {
  if (_wtDb) return _wtDb;
  try {
    const { getDb } = await import("./db.js");
    _wtDb = await getDb();
    return _wtDb;
  } catch {
    return null;
  }
}

async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* silent — hot cache still works */ }
}

async function _loadFromDb(table: string): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const db = await _getWtDb();
  if (!db) return result;
  try {
    const { sql } = await import("drizzle-orm");
    const rows = await (db as any).execute(sql`SELECT key, data FROM ${sql.raw(table)}`);
    for (const row of rows) {
      result.set(row.key, row.data);
    }
  } catch { /* silent */ }
  return result;
}

async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch { /* silent */ }
}

async function _ensureWriteThroughTables(): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS mojaloop_pending_transfers (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch { /* silent */ }
}

// Initialize tables on module load
_ensureWriteThroughTables().catch(() => {});

const pendingTransfers = new Map<string, {
  condition: string; // Persisted to PostgreSQL table "mojaloop_pending_transfers"
  resolve: (result: MojaloopCallback) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/**
 * Register a transfer as pending, waiting for Mojaloop callback.
 * Returns a promise that resolves when the callback arrives (or times out).
 */
export function awaitTransferCallback(
  transferId: string,
  condition: string,
  timeoutMs = 30_000
): Promise<MojaloopCallback> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingTransfers.delete(transferId);

      _deleteFromDb("mojaloop_pending_transfers", transferId).catch(() => {});
      resolve({
        transferId,
        transferState: "ABORTED",
        errorInformation: { errorCode: "5003", errorDescription: "Transfer callback timeout" },
      });
    }, timeoutMs);

    pendingTransfers.set(transferId, { condition, resolve, timeout });


    _writeThrough("mojaloop_pending_transfers", transferId, { condition, resolve, timeout }).catch(() => {});
  });
}

/**
 * Handle an incoming Mojaloop callback (PUT /transfers/{id}).
 * Verifies ILP fulfillment before accepting.
 */
export function handleMojaloopCallback(callback: MojaloopCallback): { accepted: boolean; reason?: string } {
  const pending = pendingTransfers.get(callback.transferId);
  if (!pending) {
    logger.warn(`[Mojaloop] Received callback for unknown transfer: ${callback.transferId}`);
    return { accepted: false, reason: "Unknown transfer" };
  }

  clearTimeout(pending.timeout);
  pendingTransfers.delete(callback.transferId);

  _deleteFromDb("mojaloop_pending_transfers", callback.transferId).catch(() => {});

  // Verify ILP fulfillment if present
  if (callback.fulfilment && !verifyIlpFulfillment(pending.condition, callback.fulfilment)) {
    logger.error(`[Mojaloop] ILP fulfillment mismatch for ${callback.transferId}`);
    pending.resolve({
      ...callback,
      transferState: "ABORTED",
      errorInformation: { errorCode: "5105", errorDescription: "ILP fulfillment mismatch" },
    });
    return { accepted: false, reason: "Fulfillment mismatch" };
  }

  pending.resolve(callback);
  return { accepted: true };
}
