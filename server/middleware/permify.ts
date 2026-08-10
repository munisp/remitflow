import { logger } from '../_core/logger';
import { readFileSync } from 'fs';
import path from 'path';
/**
 * RemitFlow — Permify RBAC Client
 * Fine-grained authorization for all platform resources
 */

const PERMIFY_URL = process.env.PERMIFY_URL || process.env.PERMIFY_HTTP_URL || "";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT || process.env.PERMIFY_TENANT_ID || "";

// ── Permission Check Types ────────────────────────────────────────────────────

export interface PermissionCheck {
  entity: { type: string; id: string };
  permission: string;
  subject: { type: "user"; id: string };
}

export interface RelationshipWrite {
  entity: { type: string; id: string };
  relation: string;
  subject: { type: string; id: string };
}

// ── Permify Client ────────────────────────────────────────────────────────────

class PermifyClient {
  private baseUrl: string | null;
  private available = false;

  constructor() {
    this.baseUrl = PERMIFY_URL && PERMIFY_TENANT
      ? `${PERMIFY_URL.replace(/\/$/, "")}/v1/tenants/${PERMIFY_TENANT}`
      : null;
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    if (!PERMIFY_URL || !PERMIFY_TENANT || !this.baseUrl) {
      this.available = false;
      logger.error("[PERMIFY] PERMIFY_URL/PERMIFY_HTTP_URL and PERMIFY_TENANT_ID must be configured; denying authorization checks.");
      return;
    }
    try {
      const res = await fetch(`${PERMIFY_URL.replace(/\/$/, "")}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      this.available = res.ok;
      if (this.available) {
        logger.info("[PERMIFY] Authorization service connected");
      }
    } catch {
      this.available = false;
      logger.error("[PERMIFY] Authorization service unavailable; denying authorization checks.");
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async check(check: PermissionCheck): Promise<boolean> {
    if (!this.available || !this.baseUrl) {
      logger.warn("[PERMIFY] Unavailable or unconfigured — denying by default");
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/permissions/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "", snap_token: "", depth: 20 },
          entity: check.entity,
          permission: check.permission,
          subject: check.subject,
        }),
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) return false;
      const data = (await res.json()) as { can: "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED" };
      return data.can === "CHECK_RESULT_ALLOWED";
    } catch {
      return false;
    }
  }

  /**
   * In-memory permission cache — avoids network round-trip for repeated checks.
   * Cache entries expire after 30 seconds.
   */
  private permissionCache = new Map<string, { result: boolean; expiresAt: number }>();
  private static CACHE_TTL_MS = 30_000;

  private getCacheKey(check: PermissionCheck): string {
    return `${PERMIFY_TENANT}:${check.entity.type}:${check.entity.id}:${check.permission}:${check.subject.type}:${check.subject.id}`;
  }

  async checkCached(check: PermissionCheck): Promise<boolean> {
    const key = this.getCacheKey(check);
    const cached = this.permissionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const result = await this.check(check);
    this.permissionCache.set(key, { result, expiresAt: Date.now() + PermifyClient.CACHE_TTL_MS });
    return result;
  }

  /** Batch permission check — checks multiple permissions in parallel */
  async checkBatch(checks: PermissionCheck[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const promises = checks.map(async (check) => {
      const key = this.getCacheKey(check);
      const result = await this.checkCached(check);
      results.set(key, result);
    });
    await Promise.all(promises);
    return results;
  }

  async writeRelationship(rel: RelationshipWrite): Promise<boolean> {
    if (!this.available || !this.baseUrl) {
      logger.warn("[PERMIFY] Unavailable or unconfigured — denying relationship write");
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/relationships/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "" },
          tuples: [
            {
              entity: rel.entity,
              relation: rel.relation,
              subject: rel.subject,
            },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      });
      // Invalidate cache for affected entity
      if (res.ok) {
        const prefix = `${rel.entity.type}:${rel.entity.id}:`;
        Array.from(this.permissionCache.keys()).forEach(k => {
          if (k.startsWith(prefix)) this.permissionCache.delete(k);
        });
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteRelationship(rel: RelationshipWrite): Promise<boolean> {
    if (!this.available || !this.baseUrl) {
      logger.warn("[PERMIFY] Unavailable or unconfigured — denying relationship delete");
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/relationships/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tuples: [
            {
              entity: rel.entity,
              relation: rel.relation,
              subject: rel.subject,
            },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let permifyClient: PermifyClient | null = null;

export function getPermifyClient(): PermifyClient {
  if (!permifyClient) {
    permifyClient = new PermifyClient();
  }
  return permifyClient;
}

// ── High-Level Authorization Helpers ─────────────────────────────────────────

export async function canAccessTransaction(
  userId: string,
  transactionId: string,
  permission: "view" | "cancel" | "refund" | "approve"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "transaction", id: transactionId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function canAccessWallet(
  userId: string,
  walletId: string,
  permission: "view" | "deposit" | "withdraw" | "freeze"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "wallet", id: walletId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function canManageKYC(
  userId: string,
  kycRecordId: string,
  permission: "view" | "submit" | "approve" | "reject"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "kyc_record", id: kycRecordId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function canAccessDispute(
  userId: string,
  disputeId: string,
  permission: "view" | "submit" | "respond" | "resolve" | "escalate" = "submit"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "dispute", id: disputeId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function grantTransactionAccess(
  userId: string,
  transactionId: string,
  role: "owner" | "reviewer" = "owner"
): Promise<boolean> {
  return getPermifyClient().writeRelationship({
    entity: { type: "transaction", id: transactionId },
    relation: role,
    subject: { type: "user", id: userId },
  });
}

export async function grantWalletAccess(
  userId: string,
  walletId: string,
  role: "owner" | "auditor"
): Promise<boolean> {
  return getPermifyClient().writeRelationship({
    entity: { type: "wallet", id: walletId },
    relation: role,
    subject: { type: "user", id: userId },
  });
}

// ── Relationship Write Retry + Outbox (write-behind) ────────────────────────
// Permission checks are only as good as the tuples behind them. Relationship
// writes are retried inline with exponential backoff; if Permify still rejects
// them, the tuple is persisted to a PostgreSQL outbox table and drained by a
// background loop until Permify accepts it. Nothing is silently dropped.

export interface OutboxRelationship {
  entityType: string;
  entityId: string;
  relation: string;
  subjectType: string;
  subjectId: string;
}

const OUTBOX_TABLE = "permify_relationship_outbox";
const OUTBOX_MAX_ATTEMPTS = 100;
let outboxTableReady = false;

async function ensureOutboxTable(): Promise<any | null> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return null;
  if (outboxTableReady) return db;
  const { sql } = await import("drizzle-orm");
  await (db as any).execute(sql`
    CREATE TABLE IF NOT EXISTS permify_relationship_outbox (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  outboxTableReady = true;
  return db;
}

/** Persist a relationship tuple to the write-behind outbox. Returns false if the outbox itself is unavailable. */
export async function enqueueRelationshipWrite(rel: OutboxRelationship, lastError?: string): Promise<boolean> {
  try {
    const db = await ensureOutboxTable();
    if (!db) {
      logger.error({ rel }, "[PERMIFY] Outbox unavailable — relationship write cannot be deferred");
      return false;
    }
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO permify_relationship_outbox (entity_type, entity_id, relation, subject_type, subject_id, last_error)
      VALUES (${rel.entityType}, ${rel.entityId}, ${rel.relation}, ${rel.subjectType}, ${rel.subjectId}, ${lastError ?? null})
    `);
    startOutboxDrainer();
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), rel }, "[PERMIFY] Failed to enqueue relationship write");
    return false;
  }
}

/** Drain pending outbox rows into Permify. Rows that exhaust OUTBOX_MAX_ATTEMPTS are deleted with an error log. */
export async function flushRelationshipOutbox(maxBatch = 50): Promise<{ flushed: number; failed: number }> {
  const result = { flushed: 0, failed: 0 };
  try {
    const db = await ensureOutboxTable();
    if (!db) return result;
    const { sql } = await import("drizzle-orm");
    const rows = (await (db as any).execute(sql`
      SELECT id, entity_type, entity_id, relation, subject_type, subject_id, attempts
      FROM permify_relationship_outbox ORDER BY id LIMIT ${maxBatch}
    `)) as any[];
    const client = getPermifyClient();
    for (const row of rows) {
      const ok = await client.writeRelationship({
        entity: { type: row.entity_type, id: row.entity_id },
        relation: row.relation,
        subject: { type: row.subject_type, id: row.subject_id },
      });
      if (ok) {
        await (db as any).execute(sql`DELETE FROM permify_relationship_outbox WHERE id = ${row.id}`);
        result.flushed++;
      } else {
        const attempts = Number(row.attempts ?? 0) + 1;
        result.failed++;
        if (attempts >= OUTBOX_MAX_ATTEMPTS) {
          logger.error({ row }, "[PERMIFY] Outbox row exhausted max attempts — dropping (manual reconciliation required)");
          await (db as any).execute(sql`DELETE FROM permify_relationship_outbox WHERE id = ${row.id}`);
        } else {
          await (db as any).execute(sql`
            UPDATE permify_relationship_outbox SET attempts = ${attempts}, updated_at = NOW() WHERE id = ${row.id}
          `);
        }
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PERMIFY] Outbox flush failed");
  }
  return result;
}

let outboxDrainerStarted = false;
function startOutboxDrainer(): void {
  if (outboxDrainerStarted) return;
  outboxDrainerStarted = true;
  const interval = setInterval(() => {
    flushRelationshipOutbox().catch(() => {});
  }, 30_000);
  interval.unref?.();
  logger.info("[PERMIFY] Relationship outbox drainer started (30s interval)");
}

/**
 * Write a relationship tuple with inline retry (exponential backoff). On final
 * failure the tuple is enqueued to the outbox and false is returned so callers
 * can decide whether the operation is fatal.
 */
export async function writeRelationshipWithRetry(
  rel: OutboxRelationship,
  maxAttempts = 3
): Promise<boolean> {
  const client = getPermifyClient();
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ok = await client.writeRelationship({
        entity: { type: rel.entityType, id: rel.entityId },
        relation: rel.relation,
        subject: { type: rel.subjectType, id: rel.subjectId },
      });
      if (ok) return true;
      lastError = "Permify rejected the write";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
    }
  }
  logger.warn({ rel, lastError, maxAttempts }, "[PERMIFY] Relationship write failed after retries — enqueuing to outbox");
  const enqueued = await enqueueRelationshipWrite(rel, lastError);
  if (!enqueued) {
    logger.error({ rel }, "[PERMIFY] Relationship tuple lost: write failed AND outbox unavailable");
  }
  return false;
}

// ── Tenant + Schema Bootstrap (startup provisioning) ─────────────────────────
// Idempotent: creates the configured tenant if absent, then writes the canonical
// RemitFlow schema (infrastructure/integration/permify_policies/remitflow_schema.perm).
// Throws on any failure — callers in production must abort startup.

export interface PermifyBootstrapResult {
  tenantId: string;
  tenantExisted: boolean;
  schemaVersion: string;
}

function resolveCanonicalSchemaPath(): string {
  if (process.env.PERMIFY_SCHEMA_PATH) return process.env.PERMIFY_SCHEMA_PATH;
  return path.resolve(process.cwd(), "infrastructure/integration/permify_policies/remitflow_schema.perm");
}

export async function bootstrapPermifyTenantAndSchema(schemaPath?: string): Promise<PermifyBootstrapResult> {
  const baseUrl = PERMIFY_URL.replace(/\/$/, "");
  const tenantId = PERMIFY_TENANT;
  if (!baseUrl || !tenantId) {
    throw new Error("[PERMIFY] Bootstrap requires PERMIFY_URL (or PERMIFY_HTTP_URL) and PERMIFY_TENANT_ID to be configured");
  }

  // 1. Ensure the tenant exists (idempotent — "already exists" is success).
  let tenantExisted = false;
  const createRes = await fetch(`${baseUrl}/v1/tenants/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: tenantId, name: tenantId }),
    signal: AbortSignal.timeout(5000),
  });
  if (createRes.ok) {
    tenantExisted = false;
  } else {
    const body = await createRes.text().catch(() => "");
    if (createRes.status === 409 || /already exist/i.test(body)) {
      tenantExisted = true;
    } else {
      throw new Error(`[PERMIFY] Tenant creation failed with HTTP ${createRes.status}: ${body.slice(0, 300)}`);
    }
  }

  // 2. Load the canonical schema from disk — fail loudly if it is missing.
  const resolvedPath = schemaPath ?? resolveCanonicalSchemaPath();
  let schema: string;
  try {
    schema = readFileSync(resolvedPath, "utf8");
  } catch (err) {
    throw new Error(`[PERMIFY] Canonical schema not readable at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!schema.includes("entity user")) {
    throw new Error(`[PERMIFY] Canonical schema at ${resolvedPath} does not look like a Permify schema (missing 'entity user')`);
  }

  // 3. Write the schema to the tenant.
  const schemaRes = await fetch(`${baseUrl}/v1/tenants/${tenantId}/schemas/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!schemaRes.ok) {
    const body = await schemaRes.text().catch(() => "");
    throw new Error(`[PERMIFY] Schema write failed with HTTP ${schemaRes.status}: ${body.slice(0, 500)}`);
  }
  const schemaData = (await schemaRes.json()) as { schema_version?: string };
  if (!schemaData.schema_version) {
    throw new Error("[PERMIFY] Schema write returned no schema_version — refusing to continue");
  }

  logger.info({ tenantId, tenantExisted, schemaVersion: schemaData.schema_version }, "[PERMIFY] Bootstrap completed");
  return { tenantId, tenantExisted, schemaVersion: schemaData.schema_version };
}
