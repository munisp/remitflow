import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { requireDb } from "../db";
import { logger } from "../_core/logger";
import { auditRegulatoryFiling, recordAuditEvent } from "../lib/complianceAuditTrail";
import type { RegulatoryReport } from "../lib/regulatoryReporting";
import { incRegulatoryFilingOutcome } from "../metrics";

export type FilingQueueStatus = "pending" | "processing" | "retry" | "submitted" | "dead_letter";

export interface FilingQueueRow {
  id: number;
  report_id: string;
  tenant_id: number;
  requested_by: number;
  report_type: "SAR" | "STR" | "CTR" | "LCTR";
  jurisdiction: "CA" | "US" | "GB" | "NG" | "GH" | "KE" | "ZA";
  payload: RegulatoryReport | string;
  status: FilingQueueStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date;
  lock_token: string | null;
  locked_until: Date | null;
  last_attempt_at: Date | null;
  submitted_at: Date | null;
  provider_reference: string | null;
  last_http_status: number | null;
  last_error: string | null;
  requeued_by: number | null;
  requeued_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EnqueueInput {
  tenantId: number;
  requestedBy: number;
  report: RegulatoryReport;
}

interface QueueSummary {
  pending: number;
  processing: number;
  retry: number;
  submitted: number;
  deadLetter: number;
}

interface ProviderConfig {
  url: string;
  apiKey: string;
  path: string;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

function requiredPositiveInt(name: string): number {
  const raw = process.env[name];
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizedPayload(payload: FilingQueueRow["payload"]): RegulatoryReport {
  if (typeof payload === "string") {
    return JSON.parse(payload) as RegulatoryReport;
  }
  return payload;
}

function providerConfig(jurisdiction: FilingQueueRow["jurisdiction"]): ProviderConfig {
  const byJurisdiction: Partial<Record<FilingQueueRow["jurisdiction"], { url: string; key: string; path: string }>> = {
    CA: { url: "FINTRAC_API_URL", key: "FINTRAC_API_KEY", path: "/v1/reports" },
    US: { url: "FINCEN_API_URL", key: "FINCEN_API_KEY", path: "/v1/filing" },
    GB: { url: "NCA_API_URL", key: "NCA_API_KEY", path: "/submit" },
    NG: { url: "NFIU_API_URL", key: "NFIU_API_KEY", path: "/reports/submit" },
  };
  const config = byJurisdiction[jurisdiction];
  if (!config) {
    throw new NonRetryableFilingError(`No automated regulatory filing connector is configured for jurisdiction ${jurisdiction}`);
  }
  const url = process.env[config.url]?.replace(/\/$/, "");
  const apiKey = process.env[config.key];
  if (!url || !apiKey) {
    throw new NonRetryableFilingError(`${config.url} and ${config.key} must be configured for ${jurisdiction} regulatory filing`);
  }
  return { url, apiKey, path: config.path };
}

class NonRetryableFilingError extends Error {}

function providerPayload(report: RegulatoryReport): Record<string, unknown> {
  return {
    reportType: report.type,
    reportId: report.id,
    subject: report.subject,
    transactions: report.transactions,
    indicators: report.indicators.map((indicator) => indicator.code),
    narrative: report.narrative,
    dateRange: report.dateRange,
    totalAmount: report.totalAmount,
    currency: report.currency,
  };
}

async function submitToProvider(row: FilingQueueRow): Promise<{ reference: string; httpStatus: number }> {
  const report = normalizedPayload(row.payload);
  const config = providerConfig(row.jurisdiction);
  const response = await fetch(`${config.url}${config.path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": report.id,
      "X-RemitFlow-Report-Type": report.type,
    },
    body: JSON.stringify(providerPayload(report)),
    signal: AbortSignal.timeout(requiredPositiveInt("REGULATORY_FILING_HTTP_TIMEOUT_MS")),
  });
  const responseText = await response.text();
  if (!response.ok) {
    const message = `Regulatory provider returned HTTP ${response.status}: ${responseText.slice(0, 512)}`;
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      throw new NonRetryableFilingError(message);
    }
    throw new Error(message);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new NonRetryableFilingError("Regulatory provider response was not valid JSON");
  }
  const reference = [payload.reference, payload.reportNumber, payload.bsaId, payload.filingReference]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!reference) {
    throw new NonRetryableFilingError("Regulatory provider response did not include a filing reference");
  }
  return { reference, httpStatus: response.status };
}

async function asTenant<T>(tenantId: number, userId: number, operation: (db: any) => Promise<T>): Promise<T> {
  const db = await requireDb();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${String(tenantId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${String(userId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'false', true)`);
    return operation(tx);
  });
}

async function asWorker<T>(operation: (db: any) => Promise<T>): Promise<T> {
  const db = await requireDb();
  return db.transaction(async (tx: any) => {
    // A dedicated worker has no interactive tenant. It is limited to queue
    // operations and every mutation is captured by PostgreSQL audit triggers.
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'true', true)`);
    return operation(tx);
  });
}

export async function enqueueRegulatoryFiling(input: EnqueueInput): Promise<FilingQueueRow> {
  const maxAttempts = requiredPositiveInt("REGULATORY_FILING_MAX_ATTEMPTS");
  const report = input.report;
  if (!["SAR", "STR", "CTR", "LCTR"].includes(report.type)) {
    throw new Error(`Unsupported queueable report type: ${report.type}`);
  }

  const [row] = await asTenant(input.tenantId, input.requestedBy, async (db) =>
    db.execute(sql`
      INSERT INTO regulatory_filing_queue (
        report_id, tenant_id, requested_by, report_type, jurisdiction, payload,
        status, max_attempts, next_attempt_at
      ) VALUES (
        ${report.id}, ${input.tenantId}, ${input.requestedBy}, ${report.type}, ${report.jurisdiction},
        ${JSON.stringify(report)}::jsonb, 'pending', ${maxAttempts}, NOW()
      )
      ON CONFLICT (report_id) DO UPDATE
        SET updated_at = NOW()
      RETURNING *
    `) as Promise<FilingQueueRow[]>,
  );
  if (!row) throw new Error(`Unable to enqueue regulatory report ${report.id}`);

  incRegulatoryFilingOutcome("queued");
  await recordAuditEvent({
    type: "regulatory.report.queued",
    userId: input.requestedBy,
    actorId: `user-${input.requestedBy}`,
    actorType: "compliance_officer",
    jurisdiction: report.jurisdiction,
    correlationId: report.id,
    details: { reportId: report.id, reportType: report.type, queueId: row.id, tenantId: input.tenantId },
  });
  return row;
}

async function claimDueRows(limit: number): Promise<FilingQueueRow[]> {
  return asWorker(async (db) => {
    const lockToken = randomUUID();
    return db.execute(sql`
      WITH due AS (
        SELECT id
        FROM regulatory_filing_queue
        WHERE status IN ('pending', 'retry')
          AND next_attempt_at <= NOW()
          AND (locked_until IS NULL OR locked_until < NOW())
          AND attempt_count < max_attempts
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE regulatory_filing_queue queue
      SET status = 'processing',
          attempt_count = queue.attempt_count + 1,
          lock_token = ${lockToken}::uuid,
          locked_until = NOW() + make_interval(secs => ${requiredPositiveInt("REGULATORY_FILING_LOCK_SECONDS")}::int),
          last_attempt_at = NOW(),
          updated_at = NOW()
      FROM due
      WHERE queue.id = due.id
      RETURNING queue.*
    `) as Promise<FilingQueueRow[]>;
  });
}

async function markSubmitted(row: FilingQueueRow, result: { reference: string; httpStatus: number }): Promise<void> {
  await asWorker(async (db) => {
    const rows = await db.execute(sql`
      UPDATE regulatory_filing_queue
      SET status = 'submitted', submitted_at = NOW(), provider_reference = ${result.reference},
          last_http_status = ${result.httpStatus}, last_error = NULL, lock_token = NULL,
          locked_until = NULL, next_attempt_at = NOW(), updated_at = NOW()
      WHERE id = ${row.id} AND lock_token = ${row.lock_token}::uuid
      RETURNING *
    `) as FilingQueueRow[];
    if (!rows[0]) throw new Error(`Lost regulatory filing queue lock for ${row.report_id}`);
  });
  incRegulatoryFilingOutcome("submitted");
  await auditRegulatoryFiling({
    userId: row.requested_by,
    reportId: row.report_id,
    reportType: row.report_type,
    jurisdiction: row.jurisdiction,
    filingReference: result.reference,
    filedBy: "regulatory-filing-worker",
  });
}

async function markFailure(row: FilingQueueRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 4096) : "Unknown regulatory filing failure";
  const nonRetryable = error instanceof NonRetryableFilingError;
  const exhausted = row.attempt_count >= row.max_attempts;
  const deadLetter = nonRetryable || exhausted;
  const delayMs = requiredPositiveInt("REGULATORY_FILING_BACKOFF_MS") * (2 ** Math.min(row.attempt_count - 1, 8));
  await asWorker(async (db) => {
    const rows = await db.execute(sql`
      UPDATE regulatory_filing_queue
      SET status = ${deadLetter ? "dead_letter" : "retry"},
          last_error = ${message},
          lock_token = NULL,
          locked_until = NULL,
          next_attempt_at = ${deadLetter ? new Date() : new Date(Date.now() + delayMs)},
          updated_at = NOW()
      WHERE id = ${row.id} AND lock_token = ${row.lock_token}::uuid
      RETURNING *
    `) as FilingQueueRow[];
    if (!rows[0]) throw new Error(`Lost regulatory filing queue lock for ${row.report_id}`);
  });
  incRegulatoryFilingOutcome(deadLetter ? "dead_letter" : "retry");
  await recordAuditEvent({
    type: deadLetter ? "regulatory.report.dead_lettered" : "regulatory.report.retry_scheduled",
    userId: row.requested_by,
    actorId: "regulatory-filing-worker",
    actorType: "automated",
    jurisdiction: row.jurisdiction,
    correlationId: row.report_id,
    details: {
      reportId: row.report_id,
      queueId: row.id,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      deadLetter,
      error: message,
    },
  });
}

export async function processDueRegulatoryFilings(limit = requiredPositiveInt("REGULATORY_FILING_BATCH_SIZE")): Promise<{ claimed: number; submitted: number; retried: number; deadLettered: number }> {
  if (running) return { claimed: 0, submitted: 0, retried: 0, deadLettered: 0 };
  running = true;
  try {
    const rows = await claimDueRows(limit);
    let submitted = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const row of rows) {
      try {
        const result = await submitToProvider(row);
        await markSubmitted(row, result);
        submitted++;
      } catch (error) {
        await markFailure(row, error);
        if (error instanceof NonRetryableFilingError || row.attempt_count >= row.max_attempts) deadLettered++;
        else retried++;
        logger.error({ reportId: row.report_id, queueId: row.id, error: error instanceof Error ? error.message : String(error) }, "Regulatory filing attempt failed");
      }
    }
    return { claimed: rows.length, submitted, retried, deadLettered };
  } finally {
    running = false;
  }
}

export async function requeueDeadLetterRegulatoryFiling(params: { tenantId: number; queueId: number; requeuedBy: number }): Promise<FilingQueueRow> {
  const [row] = await asTenant(params.tenantId, params.requeuedBy, async (db) =>
    db.execute(sql`
      UPDATE regulatory_filing_queue
      SET status = 'pending', attempt_count = 0, next_attempt_at = NOW(), lock_token = NULL,
          locked_until = NULL, last_error = NULL, requeued_by = ${params.requeuedBy},
          requeued_at = NOW(), updated_at = NOW()
      WHERE id = ${params.queueId} AND tenant_id = ${params.tenantId} AND status = 'dead_letter'
      RETURNING *
    `) as Promise<FilingQueueRow[]>,
  );
  if (!row) throw new Error("Dead-letter filing was not found in the active tenant or is not eligible for requeue");
  incRegulatoryFilingOutcome("requeued");
  await recordAuditEvent({
    type: "regulatory.report.requeued",
    userId: params.requeuedBy,
    actorId: `user-${params.requeuedBy}`,
    actorType: "compliance_officer",
    jurisdiction: row.jurisdiction,
    correlationId: row.report_id,
    details: { reportId: row.report_id, queueId: row.id, tenantId: params.tenantId },
  });
  return row;
}

export async function listRegulatoryFilings(tenantId: number, userId: number, status?: FilingQueueStatus): Promise<FilingQueueRow[]> {
  return asTenant(tenantId, userId, async (db) =>
    db.execute(sql`
      SELECT * FROM regulatory_filing_queue
      WHERE tenant_id = ${tenantId}
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT 250
    `) as Promise<FilingQueueRow[]>,
  );
}

export async function getRegulatoryFilingQueueSummary(tenantId: number, userId: number): Promise<QueueSummary> {
  const [row] = await asTenant(tenantId, userId, async (db) =>
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'retry')::int AS retry,
        COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
        COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter
      FROM regulatory_filing_queue
      WHERE tenant_id = ${tenantId}
    `) as Promise<Array<{ pending: number; processing: number; retry: number; submitted: number; dead_letter: number }>>,
  );
  return {
    pending: Number(row?.pending ?? 0),
    processing: Number(row?.processing ?? 0),
    retry: Number(row?.retry ?? 0),
    submitted: Number(row?.submitted ?? 0),
    deadLetter: Number(row?.dead_letter ?? 0),
  };
}

export function startRegulatoryFilingRetryWorker(): void {
  if (timer) return;
  const intervalMs = requiredPositiveInt("REGULATORY_FILING_RETRY_INTERVAL_MS");
  timer = setInterval(() => {
    void processDueRegulatoryFilings().catch((error) => logger.error({ error }, "Regulatory filing retry cycle failed"));
  }, intervalMs);
  void processDueRegulatoryFilings().catch((error) => logger.error({ error }, "Initial regulatory filing retry cycle failed"));
}

export function stopRegulatoryFilingRetryWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
