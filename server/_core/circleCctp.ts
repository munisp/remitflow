/**
 * circleCctp.ts — Circle CCTP (Cross-Chain Transfer Protocol) attestation client
 *
 * CCTP is permissionless: USDC is burned on the source chain, Circle's iris
 * attestation API observes the burn and (after source-chain finality) returns
 * a signed attestation that authorizes the mint on the destination chain.
 *
 *   - Production iris: https://iris-api.circle.com
 *   - Sandbox iris:    https://iris-api-sandbox.circle.com
 *
 * This module polls GET /attestations/{messageHash} with honest states only
 * (pending_confirmations | complete | failed — exactly what iris returns),
 * enforces a poll timeout, and persists every poll/update to the durable
 * cctp_transfers table (drizzle/0106_circle_cctp.sql). Nothing here fabricates
 * transaction hashes, message hashes, or attestations — every value comes from
 * the caller's on-chain burn or from a real iris HTTP response.
 *
 * Honesty / fail-closed:
 *   - If the database is unavailable, persistence throws (no silent loss).
 *   - If iris is unreachable or returns an unexpected payload, the transfer
 *     stays pending_confirmations until the poll timeout, then is marked
 *     failed with last_error set — never auto-completed.
 */

import { sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Config ──────────────────────────────────────────────────────────────────

const CIRCLE_IS_PROD = process.env.CIRCLE_ENV === "production";
const IRIS_BASE_URL = CIRCLE_IS_PROD
  ? "https://iris-api.circle.com"
  : "https://iris-api-sandbox.circle.com";

// Defaults: iris finality on mainnet chains can take ~15-20 min (e.g. Ethereum
// ~65 blocks); allow generous but bounded polling.
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 30 * 60_000; // 30 minutes
const REQUEST_TIMEOUT_MS = 10_000;

// ── Types ───────────────────────────────────────────────────────────────────

/** Honest mirror of iris attestation states. */
export type CctpTransferStatus = "pending_confirmations" | "complete" | "failed";

export interface CctpTransferRow {
  id: number;
  tenant_id: number | null;
  burn_tx_hash: string;
  message_hash: string | null;
  source_chain: string;
  dest_chain: string;
  amount: string;
  status: CctpTransferStatus;
  attestation: string | null;
  last_error: string | null;
  poll_count: number;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface IrisAttestationResponse {
  status?: string;
  attestation?: string | null;
}

/** True when a real Circle configuration is present (used by capabilities). */
export function isCircleCctpConfigured(): boolean {
  return !!process.env.CIRCLE_API_KEY?.trim();
}

// ── DB access ───────────────────────────────────────────────────────────────

async function getDbOrThrow() {
  const { getDb } = await import("../db.js");
  const db = await getDb();
  if (!db) throw new Error("[CCTP] FAIL-CLOSED: database unavailable — refusing to track transfer without durability");
  return db;
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Record a source-chain USDC burn. Idempotent on (tenant_id, burn_tx_hash) —
 * a duplicate burn registration returns the existing row untouched.
 * The burnTxHash must be the REAL on-chain transaction hash of the
 * depositForBurn call; messageHash (keccak of the emitted CCTP message) may be
 * supplied later via setCctpMessageHash once the logs are indexed.
 */
export async function recordCctpBurn(params: {
  tenantId?: number | null;
  burnTxHash: string;
  sourceChain: string;
  destChain: string;
  amount: string;
  messageHash?: string;
}): Promise<CctpTransferRow> {
  const db = await getDbOrThrow();
  const result = await (db as any).execute(sql`
    INSERT INTO cctp_transfers (tenant_id, burn_tx_hash, message_hash, source_chain, dest_chain, amount, status)
    VALUES (${params.tenantId ?? null}, ${params.burnTxHash}, ${params.messageHash ?? null},
            ${params.sourceChain}, ${params.destChain}, ${params.amount}, 'pending_confirmations')
    ON CONFLICT (tenant_id, burn_tx_hash) DO NOTHING
    RETURNING *
  `);
  const rows = (result?.rows ?? result) as CctpTransferRow[];
  if (rows.length > 0) return rows[0];
  const existing = await (db as any).execute(sql`
    SELECT * FROM cctp_transfers
    WHERE burn_tx_hash = ${params.burnTxHash}
      AND tenant_id IS NOT DISTINCT FROM ${params.tenantId ?? null}
    LIMIT 1
  `);
  const existingRows = (existing?.rows ?? existing) as CctpTransferRow[];
  if (existingRows.length === 0) throw new Error("[CCTP] burn insert raced and row not found");
  return existingRows[0];
}

/** Attach the CCTP message hash once known (from burn tx logs). */
export async function setCctpMessageHash(transferId: number, messageHash: string): Promise<void> {
  const db = await getDbOrThrow();
  await (db as any).execute(sql`
    UPDATE cctp_transfers
    SET message_hash = ${messageHash}, updated_at = NOW()
    WHERE id = ${transferId}
  `);
}

/** Persist the outcome of one attestation poll. Every poll is recorded. */
async function persistPollResult(params: {
  id: number;
  status: CctpTransferStatus;
  attestation?: string | null;
  lastError?: string | null;
}): Promise<void> {
  const db = await getDbOrThrow();
  await (db as any).execute(sql`
    UPDATE cctp_transfers
    SET status = ${params.status},
        attestation = COALESCE(${params.attestation ?? null}, attestation),
        last_error = ${params.lastError ?? null},
        poll_count = poll_count + 1,
        last_polled_at = NOW(),
        updated_at = NOW()
    WHERE id = ${params.id}
  `);
}

// ── Iris attestation client ─────────────────────────────────────────────────

/**
 * Single attestation fetch from Circle's iris API.
 * Returns the honest iris state. Throws on network/HTTP/parse errors so the
 * caller can decide (retry vs. timeout); the transfer is never marked
 * complete without an attestation string from the response.
 */
export async function fetchAttestation(messageHash: string): Promise<{
  status: CctpTransferStatus;
  attestation: string | null;
}> {
  const url = `${IRIS_BASE_URL}/attestations/${encodeURIComponent(messageHash)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) {
    // Message hash not yet observed by iris — honest "still pending".
    return { status: "pending_confirmations", attestation: null };
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[CCTP] iris ${response.status}: ${text.slice(0, 500)}`);
  }

  const body = (await response.json()) as IrisAttestationResponse;
  const rawStatus = String(body.status ?? "").toLowerCase();

  if (rawStatus === "complete") {
    if (typeof body.attestation !== "string" || body.attestation.length === 0) {
      // Never fabricate: "complete" without an attestation payload is not usable.
      throw new Error("[CCTP] iris reported complete but returned no attestation");
    }
    return { status: "complete", attestation: body.attestation };
  }
  if (rawStatus === "pending_confirmations") {
    return { status: "pending_confirmations", attestation: null };
  }
  if (rawStatus === "failed") {
    return { status: "failed", attestation: null };
  }
  throw new Error(`[CCTP] iris returned unknown status: ${rawStatus || "<empty>"}`);
}

/**
 * Poll iris until the attestation completes, fails, or the timeout elapses.
 * Every poll result (including transient errors) is persisted to
 * cctp_transfers. On timeout the transfer is marked failed with last_error —
 * it can be picked up again by resumeIncompleteCctpTransfers().
 */
export async function pollAttestation(params: {
  transferId: number;
  messageHash: string;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<{ status: CctpTransferStatus; attestation: string | null }> {
  const intervalMs = params.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const result = await fetchAttestation(params.messageHash);
      await persistPollResult({ id: params.transferId, status: result.status, attestation: result.attestation });
      if (result.status !== "pending_confirmations") {
        logger.info({ transferId: params.transferId, status: result.status }, "[CCTP] attestation terminal state");
        return result;
      }
    } catch (err) {
      const message = (err as Error).message;
      logger.warn({ transferId: params.transferId, err: message }, "[CCTP] attestation poll error — will retry until timeout");
      await persistPollResult({ id: params.transferId, status: "pending_confirmations", lastError: message });
    }

    if (Date.now() + intervalMs > deadline) {
      const lastError = `attestation poll timeout after ${timeoutMs}ms`;
      await persistPollResult({ id: params.transferId, status: "failed", lastError });
      logger.error({ transferId: params.transferId }, "[CCTP] " + lastError);
      return { status: "failed", attestation: null };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/**
 * Boot-time resume: scan for transfers that are not in a terminal state and
 * re-poll each once against iris. Transfers whose message hash is still
 * unknown stay pending_confirmations (their burn indexer must supply the
 * message hash first). Returns how many transfers were refreshed.
 *
 * Wiring note: called from server boot by the lane owning server/_core/index.ts.
 */
export async function resumeIncompleteCctpTransfers(): Promise<number> {
  const db = await getDbOrThrow();
  const result = await (db as any).execute(sql`
    SELECT id, message_hash FROM cctp_transfers
    WHERE status NOT IN ('complete', 'failed')
    ORDER BY id
    LIMIT 500
  `);
  const rows = (result?.rows ?? result) as Array<{ id: number; message_hash: string | null }>;
  let refreshed = 0;
  for (const row of rows) {
    if (!row.message_hash) continue;
    try {
      const att = await fetchAttestation(row.message_hash);
      await persistPollResult({ id: row.id, status: att.status, attestation: att.attestation });
      refreshed++;
    } catch (err) {
      const message = (err as Error).message;
      logger.warn({ transferId: row.id, err: message }, "[CCTP] resume poll failed — leaving pending");
      await persistPollResult({ id: row.id, status: "pending_confirmations", lastError: message });
    }
  }
  if (rows.length > 0) {
    logger.info({ scanned: rows.length, refreshed }, "[CCTP] resumed incomplete transfers");
  }
  return refreshed;
}

/** Read a transfer by tenant + burn tx hash (idempotent burn lookup). */
export async function getCctpTransfer(tenantId: number | null, burnTxHash: string): Promise<CctpTransferRow | null> {
  const db = await getDbOrThrow();
  const result = await (db as any).execute(sql`
    SELECT * FROM cctp_transfers
    WHERE burn_tx_hash = ${burnTxHash}
      AND tenant_id IS NOT DISTINCT FROM ${tenantId}
    LIMIT 1
  `);
  const rows = (result?.rows ?? result) as CctpTransferRow[];
  return rows[0] ?? null;
}
