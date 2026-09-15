/**
 * stablecoinRecon.ts — Stablecoin On/Off-Ramp Reconciliation (SPEC-wave12 §3.3)
 *
 * Hourly node-cron sweep that finds onramp_transactions / offramp_transactions
 * stuck in 'pending'/'processing' for more than 2 hours and flags them for
 * manual review.
 *
 * Honesty rules (non-negotiable):
 *   - This job NEVER auto-completes a transaction. The only terminal-state
 *     writer is the stablecoin_settlement Kafka consumer (provider evidence).
 *   - The go-stablecoin-settlement GET /ledger/history feed is used where
 *     possible as corroborating evidence for the alert payload — a ledger hit
 *     is reported, never acted on.
 *   - Stale rows are flagged via audit log + Kafka alert. The on/off-ramp
 *     tables have no metadata column and the schema is read-only for this
 *     wave, so the 'stale_flagged' marker lives in the audit log and alert
 *     payload (metadata.recon = 'stale_flagged').
 *
 * Boot registration: ORCH registers startStablecoinRecon() in server/_core.
 */
import cron, { type ScheduledTask } from "node-cron";
import { sql } from "drizzle-orm";
import { getDb, createAuditLog } from "../db";
import { logger } from "../_core/logger";
import { publishEvent } from "../middleware/kafka";

// SPEC-wave12 §3.3 — ORCH adds KAFKA_TOPICS.STABLECOIN_RECON_ALERTS at merge
const RECON_ALERTS_TOPIC = "remitflow.stablecoin.recon.alerts";

// go-stablecoin-settlement (B2 sets default PORT 8215).
const SETTLEMENT_URL = (
  process.env.STABLECOIN_SETTLEMENT_URL ??
  process.env.SETTLEMENT_URL ??
  "http://localhost:8215"
).replace(/\/+$/, "");

const STALE_THRESHOLD_HOURS = 2;

let tasks: ScheduledTask[] = [];
let tickInFlight = false;

interface StaleRow {
  id: number;
  userId: number;
  txRef: string;
  stablecoin: string;
  amount: string;
  status: string;
  createdAt: string;
}

interface LedgerEntry {
  entry_id: string;
  transfer_ref: string;
  flow_type: string;
  amount: string;
  currency: string;
  timestamp: string;
}

/**
 * Best-effort evidence lookup: fetch recent settlement ledger entries and
 * return the one whose transfer_ref matches txRef, if any. Fail-soft — the
 * settlement service being down never blocks a recon tick.
 */
async function findLedgerEvidence(txRef: string): Promise<LedgerEntry | null> {
  try {
    const res = await fetch(`${SETTLEMENT_URL}/ledger/history?limit=500`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "[StablecoinRecon] settlement /ledger/history unavailable");
      return null;
    }
    const data = (await res.json()) as { entries?: LedgerEntry[] };
    if (!Array.isArray(data.entries)) return null;
    return data.entries.find((e) => e.transfer_ref === txRef) ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[StablecoinRecon] settlement ledger query failed (non-blocking)");
    return null;
  }
}

async function flagStaleRow(kind: "onramp" | "offramp", row: StaleRow): Promise<void> {
  const evidence = await findLedgerEvidence(row.txRef);

  // NEVER auto-complete — even with ledger evidence. Terminal transitions
  // belong to the settlement consumer alone.
  logger.warn(
    { kind, txRef: row.txRef, userId: row.userId, status: row.status, ageHours: STALE_THRESHOLD_HOURS, ledgerEvidence: evidence ? evidence.entry_id : null },
    "[StablecoinRecon] stale stablecoin transaction flagged for manual review",
  );

  await createAuditLog({
    userId: row.userId,
    action: "stablecoin.recon.stale_flagged",
    targetType: `${kind}_transaction`,
    description: row.txRef,
    metadata: {
      recon: "stale_flagged",
      kind,
      status: row.status,
      stablecoin: row.stablecoin,
      amount: row.amount,
      createdAt: row.createdAt,
      staleThresholdHours: STALE_THRESHOLD_HOURS,
      ledgerEvidence: evidence,
    },
  }).catch(() => {});

  // Telemetry is fail-soft — never blocks the sweep.
  await publishEvent(RECON_ALERTS_TOPIC, `stablecoin-recon:${kind}:${row.txRef}`, {
    type: "STABLECOIN_RECON_STALE",
    kind,
    txRef: row.txRef,
    userId: row.userId,
    status: row.status,
    stablecoin: row.stablecoin,
    amount: row.amount,
    createdAt: row.createdAt,
    metadata: { recon: "stale_flagged" },
    ledgerEvidence: evidence,
    detectedAt: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[StablecoinRecon] Kafka alert publish failed (non-blocking)"),
  );
}

async function runReconTick(): Promise<void> {
  if (tickInFlight) return; // overlap guard
  tickInFlight = true;
  try {
    const db = await getDb();
    if (!db) {
      logger.warn("[StablecoinRecon] database unavailable — tick skipped");
      return;
    }

    const staleOnramps = (await db.execute(sql`
      SELECT id, user_id AS "userId", tx_ref AS "txRef", stablecoin,
             stablecoin_amount AS "amount", status, created_at AS "createdAt"
      FROM onramp_transactions
      WHERE status IN ('pending', 'processing')
        AND created_at < NOW() - INTERVAL '${sql.raw(String(STALE_THRESHOLD_HOURS))} hours'
      ORDER BY created_at ASC
      LIMIT 200
    `)) as unknown as StaleRow[];

    const staleOfframps = (await db.execute(sql`
      SELECT id, user_id AS "userId", tx_ref AS "txRef", stablecoin,
             stablecoin_amount AS "amount", status, created_at AS "createdAt"
      FROM offramp_transactions
      WHERE status IN ('pending', 'processing')
        AND created_at < NOW() - INTERVAL '${sql.raw(String(STALE_THRESHOLD_HOURS))} hours'
      ORDER BY created_at ASC
      LIMIT 200
    `)) as unknown as StaleRow[];

    for (const row of staleOnramps) await flagStaleRow("onramp", row);
    for (const row of staleOfframps) await flagStaleRow("offramp", row);

    if (staleOnramps.length + staleOfframps.length > 0) {
      logger.info(
        { onramp: staleOnramps.length, offramp: staleOfframps.length },
        "[StablecoinRecon] tick complete — stale transactions flagged",
      );
    }
  } catch (err) {
    // Never throw out of the cron callback.
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[StablecoinRecon] tick failed — will retry next hour");
  } finally {
    tickInFlight = false;
  }
}

/** Register the hourly reconciliation job. Idempotent. Called by ORCH at boot. */
export function startStablecoinRecon(): void {
  if (tasks.length > 0) return;
  tasks.push(
    cron.schedule("0 * * * *", () => {
      void runReconTick();
    }),
  );
  logger.info("[StablecoinRecon] hourly reconciliation job registered");
}

/** Stop the recon job (tests / graceful shutdown). */
export function stopStablecoinRecon(): void {
  for (const t of tasks) t.stop();
  tasks = [];
}
