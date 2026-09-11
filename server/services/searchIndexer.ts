/**
 * W10-C5 / SPEC-wave10 — OpenSearch indexer for AP/AR/vendors search.
 *
 * Indexes (SPEC-wave10 shared foundation):
 *   vendors       → vendors table
 *   vendor_bills  → vendor_bills table
 *   invoices_v2   → invoices_v2 table
 *
 * Discipline:
 *  - WRITES are fail-soft: OPENSEARCH_URL unset → warn once + skip; any
 *    OpenSearch error → warn. Search is non-critical and must never throw
 *    into business (money) paths.
 *  - READS never fabricate: on OpenSearch outage/unconfigured, search*
 *    functions fall back to a drizzle LIKE query against the source tables.
 *  - Kafka consumers (existing server/middleware/kafka consumer pattern)
 *    subscribe to the three Wave-10 topics and upsert docs. Export
 *    startSearchIndexer() for boot registration by the orchestrator in
 *    server/_core/index.ts (this coder does NOT edit that file).
 */
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { invoicesV2, vendorBills, vendors } from "../../drizzle/schema";
import { createKafkaConsumer, subscribeWithHandler } from "../middleware/kafka";
import { logger } from "../_core/logger";

// ─── Index names (SPEC-wave10) ────────────────────────────────────────────────
export const SEARCH_INDEXES = {
  VENDORS: "vendors",
  VENDOR_BILLS: "vendor_bills",
  INVOICES: "invoices_v2",
} as const;

export const SEARCH_KAFKA_TOPICS = {
  VENDOR_BILLS: "remitflow.vendor-bills",
  INVOICES: "remitflow.invoices",
  EMBEDDED_PAYOUTS: "remitflow.embedded-payouts",
} as const;

const OS_TIMEOUT_MS = 5_000;
let warnedUnconfigured = false;

function opensearchBase(): string | null {
  const url = process.env.OPENSEARCH_URL?.trim();
  if (!url) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.warn("[SearchIndexer] OPENSEARCH_URL unset — indexing disabled (fail-soft), reads fall back to DB LIKE");
    }
    return null;
  }
  return url.replace(/\/+$/, "");
}

// ─── Writes (fail-soft — never throw) ─────────────────────────────────────────

async function upsertDoc(index: string, id: string | number, doc: Record<string, unknown>): Promise<void> {
  const base = opensearchBase();
  if (!base) return;
  try {
    const res = await fetch(`${base}/${index}/_doc/${encodeURIComponent(String(id))}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(OS_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ index, id, status: res.status, body: body.slice(0, 200) }, "[SearchIndexer] Upsert rejected (fail-soft)");
    }
  } catch (err) {
    logger.warn({ index, id, err: err instanceof Error ? err.message : String(err) }, "[SearchIndexer] Upsert failed (fail-soft)");
  }
}

/** Index a vendor row (upsert). Never throws. */
export async function indexVendor(vendor: Record<string, unknown> & { id: number; tenantId: number }): Promise<void> {
  await upsertDoc(SEARCH_INDEXES.VENDORS, vendor.id, {
    ...vendor,
    _indexedAt: new Date().toISOString(),
  });
}

/** Index a vendor bill row (upsert). Never throws. */
export async function indexVendorBill(bill: Record<string, unknown> & { id: number; tenantId: number }): Promise<void> {
  await upsertDoc(SEARCH_INDEXES.VENDOR_BILLS, bill.id, {
    ...bill,
    _indexedAt: new Date().toISOString(),
  });
}

/** Index an invoices_v2 row (upsert). Never throws. */
export async function indexInvoice(invoice: Record<string, unknown> & { id: number; tenantId: number }): Promise<void> {
  await upsertDoc(SEARCH_INDEXES.INVOICES, invoice.id, {
    ...invoice,
    _indexedAt: new Date().toISOString(),
  });
}

// ─── Reads (OpenSearch → DB LIKE fallback; never fabricate) ──────────────────

interface OsHit { _source?: Record<string, unknown>; }

async function osSearch(index: string, tenantId: number, query: string, fields: string[], limit: number): Promise<Record<string, unknown>[] | null> {
  const base = opensearchBase();
  if (!base) return null; // unconfigured → caller falls back to DB
  try {
    const res = await fetch(`${base}/${index}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        size: limit,
        query: {
          bool: {
            must: [{ term: { tenantId } }],
            should: [{ multi_match: { query, fields, type: "best_fields", fuzziness: "AUTO" } }],
            minimum_should_match: 1,
          },
        },
      }),
      signal: AbortSignal.timeout(OS_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ index, status: res.status }, "[SearchIndexer] Search failed — falling back to DB LIKE");
      return null;
    }
    const data = (await res.json()) as { hits?: { hits?: OsHit[] } };
    return (data.hits?.hits ?? []).map((h) => h._source ?? {});
  } catch (err) {
    logger.warn({ index, err: err instanceof Error ? err.message : String(err) }, "[SearchIndexer] Search error — falling back to DB LIKE");
    return null;
  }
}

function likePattern(q: string): string {
  // Escape LIKE metacharacters so user input cannot alter the pattern semantics.
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Search vendors for a tenant. Falls back to DB LIKE on any OpenSearch failure. */
export async function searchVendors(tenantId: number, query: string, limit = 25): Promise<Record<string, unknown>[]> {
  const q = query.trim();
  if (!q) return [];
  const osHits = await osSearch(SEARCH_INDEXES.VENDORS, tenantId, q, ["legalName^3", "displayName^2", "tin"], limit);
  if (osHits) return osHits;
  const db = await getDb();
  if (!db) throw new Error("[SearchIndexer] DB unavailable — cannot serve search fallback");
  const p = likePattern(q);
  return db
    .select()
    .from(vendors)
    .where(and(
      eq(vendors.tenantId, tenantId),
      or(ilike(vendors.legalName, p), ilike(vendors.displayName, p), ilike(vendors.tin, p)),
    ))
    .orderBy(desc(vendors.updatedAt))
    .limit(limit);
}

/** Search vendor bills for a tenant. Falls back to DB LIKE on any OpenSearch failure. */
export async function searchBills(
  tenantId: number,
  query: string,
  opts: { status?: string; vendorId?: number; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const q = query.trim();
  const limit = opts.limit ?? 25;
  if (q) {
    const osHits = await osSearch(SEARCH_INDEXES.VENDOR_BILLS, tenantId, q, ["billNumber^3", "description^2"], limit);
    if (osHits) return osHits;
  }
  const db = await getDb();
  if (!db) throw new Error("[SearchIndexer] DB unavailable — cannot serve search fallback");
  const conds: SQL[] = [eq(vendorBills.tenantId, tenantId)];
  if (opts.status) conds.push(eq(vendorBills.status, opts.status));
  if (opts.vendorId != null) conds.push(eq(vendorBills.vendorId, opts.vendorId));
  if (q) {
    const p = likePattern(q);
    conds.push(or(ilike(vendorBills.billNumber, p), ilike(vendorBills.description, p))!);
  }
  return db.select().from(vendorBills).where(and(...conds)).orderBy(desc(vendorBills.updatedAt)).limit(limit);
}

/** Search invoices_v2 for a tenant. Falls back to DB LIKE on any OpenSearch failure. */
export async function searchInvoices(
  tenantId: number,
  query: string,
  opts: { status?: string; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const q = query.trim();
  const limit = opts.limit ?? 25;
  if (q) {
    const osHits = await osSearch(SEARCH_INDEXES.INVOICES, tenantId, q, ["invoiceNumber^3", "customerName^2", "customerEmail"], limit);
    if (osHits) return osHits;
  }
  const db = await getDb();
  if (!db) throw new Error("[SearchIndexer] DB unavailable — cannot serve search fallback");
  const conds: SQL[] = [eq(invoicesV2.tenantId, tenantId)];
  if (opts.status) conds.push(eq(invoicesV2.status, opts.status));
  if (q) {
    const p = likePattern(q);
    conds.push(or(ilike(invoicesV2.invoiceNumber, p), ilike(invoicesV2.customerName, p), ilike(invoicesV2.customerEmail, p))!);
  }
  return db.select().from(invoicesV2).where(and(...conds)).orderBy(desc(invoicesV2.updatedAt)).limit(limit);
}

// ─── Kafka consumer (existing server/middleware/kafka pattern) ────────────────

/**
 * Wave-10 event payload convention (produced by C1/C2/C5 routers):
 *   { type: string, tenantId: number, id: number, doc?: Record<string, unknown> }
 * When `doc` is absent the row is re-read from the source table (never index
 * stale or fabricated fields).
 */
async function handleIndexEvent(topic: string, _key: string | null, value: Record<string, unknown>): Promise<void> {
  const tenantId = Number(value.tenantId);
  const id = Number(value.id);
  if (!Number.isFinite(tenantId) || !Number.isFinite(id)) {
    logger.warn({ topic, value }, "[SearchIndexer] Event missing tenantId/id — skipped");
    return;
  }
  const inlineDoc = (value.doc && typeof value.doc === "object" ? value.doc : null) as (Record<string, unknown> & { id: number; tenantId: number }) | null;

  if (topic === SEARCH_KAFKA_TOPICS.VENDOR_BILLS) {
    if (inlineDoc) { await indexVendorBill({ ...inlineDoc, id, tenantId }); return; }
    const db = await getDb();
    if (!db) throw new Error("DB unavailable — cannot reindex vendor bill");
    const [row] = await db.select().from(vendorBills).where(and(eq(vendorBills.id, id), eq(vendorBills.tenantId, tenantId))).limit(1);
    if (row) await indexVendorBill(row as unknown as Record<string, unknown> & { id: number; tenantId: number });
    return;
  }
  if (topic === SEARCH_KAFKA_TOPICS.INVOICES) {
    if (inlineDoc) { await indexInvoice({ ...inlineDoc, id, tenantId }); return; }
    const db = await getDb();
    if (!db) throw new Error("DB unavailable — cannot reindex invoice");
    const [row] = await db.select().from(invoicesV2).where(and(eq(invoicesV2.id, id), eq(invoicesV2.tenantId, tenantId))).limit(1);
    if (row) await indexInvoice(row as unknown as Record<string, unknown> & { id: number; tenantId: number });
    return;
  }
  if (topic === SEARCH_KAFKA_TOPICS.EMBEDDED_PAYOUTS) {
    // No dedicated payouts index in SPEC-wave10 (indexes: vendors, vendor_bills,
    // invoices_v2). A payout against a vendor refreshes that vendor's search doc.
    const vendorId = Number(value.vendorId);
    if (Number.isFinite(vendorId) && vendorId > 0) {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable — cannot reindex vendor");
      const [row] = await db.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
      if (row) await indexVendor(row as unknown as Record<string, unknown> & { id: number; tenantId: number });
    }
    return;
  }
  logger.warn({ topic }, "[SearchIndexer] Unknown topic — event ignored");
}

let started = false;

/**
 * Start the search-indexer Kafka consumer for the three Wave-10 topics.
 * Idempotent. Kafka unavailable → warn + return (indexing stays fail-soft;
 * direct indexVendor / indexVendorBill / indexInvoice calls from routers keep working).
 *
 * BOOT REGISTRATION (orchestrator): mirror the startStablecoinSchedulers
 * pattern in server/_core/index.ts (~:1349) — this coder must NOT edit that file:
 *   const { startSearchIndexer } = await import("../services/searchIndexer.js");
 *   await startSearchIndexer();
 */
export async function startSearchIndexer(): Promise<void> {
  if (started) return;
  started = true;
  const consumer = await createKafkaConsumer("remitflow-search-indexer");
  if (!consumer) {
    logger.warn("[SearchIndexer] Kafka consumer unavailable — event-driven indexing disabled (direct index calls still work)");
    return;
  }
  await subscribeWithHandler(
    consumer,
    [SEARCH_KAFKA_TOPICS.VENDOR_BILLS, SEARCH_KAFKA_TOPICS.INVOICES, SEARCH_KAFKA_TOPICS.EMBEDDED_PAYOUTS],
    handleIndexEvent,
  );
  logger.info({ topics: Object.values(SEARCH_KAFKA_TOPICS) }, "[SearchIndexer] Kafka consumer started");
}
