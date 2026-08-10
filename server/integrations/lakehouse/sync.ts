/**
 * RemitFlow — Lakehouse Sync Integration
 * ────────────────────────────────────────
 * Triggers incremental syncs on the python-lakehouse sync engine, which owns
 * extraction (PostgreSQL → Parquet → S3/MinIO) and watermark state
 * (lakehouse_sync_state). This module:
 *   - delegates per-table syncs via POST /sync/{table}
 *   - delegates full syncs via POST /sync/all
 *   - pushes compliance report extracts via POST /ingest/compliance_reports
 *   - records job metadata in lakehouse_sync_jobs for observability
 *
 * Contract note: the sync engine serves /sync/{table} (pull-based, registered
 * tables only) and /ingest/{table} (push-based). This module uses the real
 * routes only — the previous /ingest/{table} push-sync mismatch is resolved.
 */
import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { sql } from "drizzle-orm";

const LAKEHOUSE_URL = process.env.LAKEHOUSE_URL || "http://localhost:8102";

export interface SyncResult {
  tableName: string;
  recordsSynced: number;
  success: boolean;
  error?: string;
  durationMs: number;
}

/** Tables registered for pull-based sync in the python-lakehouse engine (SYNC_TABLES). */
const PULL_SYNC_TABLES = [
  "users",
  "transactions",
  "wallets",
  "kyc_documents",
  "audit_logs",
  "fx_rates",
  "compliance_cases",
  "fraud_alerts",
  "notifications",
  "outbox_events",
  "tigerbeetle_transfers",
  "settlement_batches",
];

async function recordSyncJob(
  tableName: string,
  status: "completed" | "failed",
  recordsSynced: number,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await (db as any).execute(sql`
      INSERT INTO lakehouse_sync_jobs (table_name, last_sync_id, status, records_synced, created_at, completed_at)
      VALUES (${tableName}, 0, ${status}, ${recordsSynced}, NOW(), NOW())
    `);
  } catch (err) {
    logger.warn({ err, tableName }, "[Lakehouse] Failed to record sync job metadata (non-fatal)");
  }
}

// ─── Core Sync Function (delegates to python-lakehouse) ──────────────────────
async function syncTable(tableName: string): Promise<SyncResult> {
  const start = Date.now();

  let res: Response;
  try {
    res = await fetch(`${LAKEHOUSE_URL}/sync/${encodeURIComponent(tableName)}`, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    const error = `[Lakehouse] Sync engine unreachable at ${LAKEHOUSE_URL}: ${(err as Error).message}`;
    logger.error({ tableName }, error);
    await recordSyncJob(tableName, "failed", 0);
    return { tableName, recordsSynced: 0, success: false, error, durationMs: Date.now() - start };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const error = `Lakehouse sync failed: HTTP ${res.status} ${detail.slice(0, 300)}`;
    logger.error({ tableName }, `[Lakehouse] ${error}`);
    await recordSyncJob(tableName, "failed", 0);
    return { tableName, recordsSynced: 0, success: false, error, durationMs: Date.now() - start };
  }

  const body = await res.json() as { rows_synced?: number; status?: string };
  const recordsSynced = body.rows_synced ?? 0;
  await recordSyncJob(tableName, "completed", recordsSynced);
  logger.info({ tableName, recordsSynced, engineStatus: body.status }, "[Lakehouse] Sync completed");
  return { tableName, recordsSynced, success: true, durationMs: Date.now() - start };
}

// ─── Platform-Wide Sync ───────────────────────────────────────────────────────
export async function syncAllTables(): Promise<SyncResult[]> {
  logger.info({ tableCount: PULL_SYNC_TABLES.length }, "[Lakehouse] Starting platform-wide sync");
  const results = await Promise.allSettled(PULL_SYNC_TABLES.map(t => syncTable(t)));

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { tableName: PULL_SYNC_TABLES[i], recordsSynced: 0, success: false, error: String(r.reason), durationMs: 0 }
  );
}

// ─── Compliance Report Sync (push-based via /ingest) ─────────────────────────
export async function syncComplianceReport(fromDate: Date, toDate: Date): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("[Lakehouse] Compliance report sync failed — database unavailable");

  const records = await (db as any).execute(sql`
    SELECT
      t.id, t.user_id, t.type, t.status, t.from_currency, t.from_amount,
      t.to_currency, t.to_amount, t.fee, t.reference, t.created_at,
      u.email, u.kyc_tier, u.country
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.created_at BETWEEN ${fromDate} AND ${toDate}
    ORDER BY t.created_at ASC
  `);

  if (records.length === 0) {
    logger.info("[Lakehouse] Compliance report sync: no records in range");
    return;
  }

  let res: Response;
  try {
    res = await fetch(`${LAKEHOUSE_URL}/ingest/compliance_reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: records.map((r: Record<string, unknown>) => ({
          ...r,
          _report_from: fromDate.toISOString(),
          _report_to: toDate.toISOString(),
        })),
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new Error(`[Lakehouse] Compliance report sync failed — engine unreachable at ${LAKEHOUSE_URL}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[Lakehouse] Compliance report sync failed — HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  logger.info({ recordCount: records.length }, "[Lakehouse] Compliance report synced");
}
