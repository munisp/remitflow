/**
 * RemitFlow — OpenSearch Client (Production v79)
 * Uses @opensearch-project/opensearch with graceful degradation.
 * Full-text search + SIEM for: transactions, audit logs, security events, compliance.
 */
import { Client } from "@opensearch-project/opensearch";
import { logger } from '../_core/logger';

// Canonical env names: OPENSEARCH_USERNAME / OPENSEARCH_PASSWORD (matches .env.example).
// Legacy aliases OPENSEARCH_USER / OPENSEARCH_PASS are still honored for backward compatibility.
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || "http://localhost:9200";
const OPENSEARCH_USER = process.env.OPENSEARCH_USERNAME || process.env.OPENSEARCH_USER || "admin";
const OPENSEARCH_PASS = process.env.OPENSEARCH_PASSWORD || process.env.OPENSEARCH_PASS || "";

// TLS verification is ON by default. Set OPENSEARCH_INSECURE=true ONLY for local dev
// against self-signed certs — never in production.
const OPENSEARCH_INSECURE = process.env.OPENSEARCH_INSECURE === "true";
const IS_PROD = process.env.NODE_ENV === "production";

if (OPENSEARCH_INSECURE && IS_PROD) {
  logger.error("[OpenSearch] OPENSEARCH_INSECURE=true in production — TLS certificate verification is DISABLED. This is a security violation.");
} else if (OPENSEARCH_INSECURE) {
  logger.warn("[OpenSearch] OPENSEARCH_INSECURE=true — TLS certificate verification disabled (dev only)");
}

if (!OPENSEARCH_PASS && IS_PROD) {
  logger.warn("[OpenSearch] OPENSEARCH_PASSWORD not set in production — authentication will fail");
}

// ── Index Names ───────────────────────────────────────────────────────────────

export const OS_INDICES = {
  SECURITY_EVENTS: "remitflow-security-events",
  FRAUD_ALERTS: "remitflow-fraud-alerts",
  KYC_EVENTS: "remitflow-kyc-events",
  API_LOGS: "remitflow-api-logs",
  COMPLIANCE: "remitflow-compliance",
};

export const INDICES = {
  TRANSACTIONS: "remitflow-transactions",
  USERS: "remitflow-users",
  BENEFICIARIES: "remitflow-beneficiaries",
  AUDIT_LOGS: "remitflow-audit-logs",
  MARKET_LISTINGS: "remitflow-market-listings",
  TALENT_PROFILES: "remitflow-talent-profiles",
} as const;

// ── Search Result Types ───────────────────────────────────────────────────────

export interface SearchHit<T = Record<string, unknown>> {
  _id: string;
  _score: number;
  _source: T;
}

export interface SearchResult<T = Record<string, unknown>> {
  total: number;
  hits: SearchHit<T>[];
  took: number;
}

// ── Real OpenSearch Client ────────────────────────────────────────────────────
let _realClient: Client | null = null;
let _realAvailable = false;
let _realChecked = false;

export async function getRealOSClient(): Promise<Client | null> {
  if (_realChecked && !_realAvailable) return null;
  if (_realClient && _realAvailable) return _realClient;
  try {
    _realClient = new Client({
      node: OPENSEARCH_URL,
      auth: { username: OPENSEARCH_USER, password: OPENSEARCH_PASS },
      ssl: { rejectUnauthorized: !OPENSEARCH_INSECURE },
      requestTimeout: 5000,
    });
    await _realClient.ping();
    _realAvailable = true;
    _realChecked = true;
    logger.info("[OpenSearch] SDK client connected");
    return _realClient;
  } catch {
    _realAvailable = false;
    _realChecked = true;
    return null;
  }
}

export async function logSecurityEvent(event: {
  type: string; userId?: number; ipAddress?: string;
  severity: "low" | "medium" | "high" | "critical"; details: string;
}): Promise<void> {
  const c = await getRealOSClient();
  const IS_PRODUCTION = process.env.NODE_ENV === "production";
  if (!c) {
    if (IS_PRODUCTION) {
      throw new Error("[OpenSearch] FAIL-CLOSED: Cannot index security event — OpenSearch unavailable in production");
    }
    return;
  }
  try {
    await c.index({ index: OS_INDICES.SECURITY_EVENTS, body: { ...event, "@timestamp": new Date().toISOString() } });
  } catch (err) {
    if (IS_PRODUCTION) {
      throw new Error(`[OpenSearch] FAIL-CLOSED: Security event indexing failed — ${(err as Error).message}`);
    }
  }
}

/** Index mappings — defines field types, analyzers, and tokenizers for each index */
const INDEX_MAPPINGS: Record<string, Record<string, unknown>> = {
  [OS_INDICES.SECURITY_EVENTS]: {
    properties: {
      type: { type: "keyword" },
      severity: { type: "keyword" },
      userId: { type: "integer" },
      ipAddress: { type: "ip" },
      details: { type: "text", analyzer: "standard" },
      "@timestamp": { type: "date" },
    },
  },
  [OS_INDICES.FRAUD_ALERTS]: {
    properties: {
      alertType: { type: "keyword" },
      userId: { type: "integer" },
      transactionId: { type: "keyword" },
      riskScore: { type: "float" },
      amount: { type: "scaled_float", scaling_factor: 100 },
      currency: { type: "keyword" },
      status: { type: "keyword" },
      "@timestamp": { type: "date" },
    },
  },
  [OS_INDICES.KYC_EVENTS]: {
    properties: {
      eventType: { type: "keyword" },
      userId: { type: "integer" },
      kycTier: { type: "integer" },
      documentType: { type: "keyword" },
      status: { type: "keyword" },
      "@timestamp": { type: "date" },
    },
  },
  [OS_INDICES.API_LOGS]: {
    properties: {
      method: { type: "keyword" },
      path: { type: "keyword" },
      statusCode: { type: "integer" },
      duration: { type: "float" },
      userId: { type: "integer" },
      ip: { type: "ip" },
      "@timestamp": { type: "date" },
    },
  },
  [OS_INDICES.COMPLIANCE]: {
    properties: {
      reportType: { type: "keyword" },
      jurisdiction: { type: "keyword" },
      status: { type: "keyword" },
      riskLevel: { type: "keyword" },
      userId: { type: "integer" },
      amount: { type: "scaled_float", scaling_factor: 100 },
      "@timestamp": { type: "date" },
    },
  },
};

export async function ensureIndicesExist(): Promise<void> {
  const c = await getRealOSClient();
  if (!c) {
    throw new Error("[OpenSearch] Cannot bootstrap indices — OpenSearch cluster unavailable");
  }
  const allIndices = [...Object.values(INDICES), ...Object.values(OS_INDICES)];
  const failures: string[] = [];
  for (const index of allIndices) {
    try {
      const exists = await c.indices.exists({ index });
      if (!exists.body) {
        const mappings = INDEX_MAPPINGS[index];
        await c.indices.create({
          index,
          body: {
            settings: { number_of_shards: 1, number_of_replicas: 0 },
            ...(mappings ? { mappings } : {}),
          },
        });
        logger.info(`[OpenSearch] Created index ${index} with mappings`);
      }
    } catch (err) {
      failures.push(`${index}: ${(err as Error).message}`);
      logger.error({ err, index }, `[OpenSearch] Failed to ensure index ${index}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`[OpenSearch] Index bootstrap failed for ${failures.length} index(es): ${failures.join("; ")}`);
  }
}

// ── Index Templates + ILM Bootstrap ──────────────────────────────────────────

interface StablecoinTemplateFile {
  ilm_policy?: { name: string; policy: Record<string, unknown> };
  index_templates?: Array<{
    name: string;
    index_patterns: string[];
    template: Record<string, unknown>;
  }>;
}

function loadTemplateFile(): StablecoinTemplateFile {
  // Resolve repo-root-relative path regardless of CWD (tsx runtime vs bundled dist).
  const candidates = [
    "infra/opensearch/stablecoin-index-templates.json",
    "../../infra/opensearch/stablecoin-index-templates.json",
  ];
  for (const rel of candidates) {
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      const full = path.resolve(process.cwd(), rel);
      if (fs.existsSync(full)) {
        return JSON.parse(fs.readFileSync(full, "utf-8")) as StablecoinTemplateFile;
      }
    } catch { /* try next candidate */ }
  }
  throw new Error(
    `[OpenSearch] stablecoin-index-templates.json not found (searched: ${candidates.join(", ")} from cwd=${process.cwd()})`,
  );
}

/**
 * Apply stablecoin index templates + ILM policy from
 * infra/opensearch/stablecoin-index-templates.json to the cluster.
 * Real API calls only — throws (loudly) if the cluster rejects any request.
 */
export async function applyIndexTemplates(): Promise<{ templatesApplied: string[]; ilmApplied: boolean }> {
  const c = await getRealOSClient();
  if (!c) {
    throw new Error("[OpenSearch] Cannot apply index templates — OpenSearch cluster unavailable");
  }

  const spec = loadTemplateFile();
  const templatesApplied: string[] = [];

  for (const tpl of spec.index_templates ?? []) {
    await c.indices.putIndexTemplate({
      name: tpl.name,
      body: {
        index_patterns: tpl.index_patterns,
        template: tpl.template,
      },
    });
    templatesApplied.push(tpl.name);
    logger.info(`[OpenSearch] Applied index template ${tpl.name} (patterns: ${tpl.index_patterns.join(",")})`);
  }

  let ilmApplied = false;
  if (spec.ilm_policy) {
    // The policy file uses Elasticsearch ILM phase syntax. Attempt the ES-compatible
    // endpoint first; on OpenSearch clusters without ES-ILM compatibility this will
    // fail loudly rather than fabricate success.
    try {
      await c.transport.request({
        method: "PUT",
        path: `_ilm/policy/${encodeURIComponent(spec.ilm_policy.name)}`,
        body: { policy: spec.ilm_policy.policy },
      });
      ilmApplied = true;
      logger.info(`[OpenSearch] Applied ILM policy ${spec.ilm_policy.name}`);
    } catch (err) {
      logger.error(
        { err, policy: spec.ilm_policy.name },
        "[OpenSearch] ILM policy apply failed — cluster may not support ES-style _ilm/policy " +
        "(OpenSearch ISM uses a different schema via _plugins/_ism/policies). " +
        "Index templates were applied; retention policy must be configured via ISM.",
      );
      throw new Error(`[OpenSearch] Failed to apply ILM policy '${spec.ilm_policy.name}': ${(err as Error).message}`);
    }
  }

  return { templatesApplied, ilmApplied };
}

/**
 * Full OpenSearch bootstrap: indices + templates + ILM.
 * Called once from server startup; throws on failure so the caller can log loudly.
 */
export async function bootstrapOpenSearch(): Promise<void> {
  await ensureIndicesExist();
  await applyIndexTemplates();
}

/** Retry OpenSearch connection — allows recovery after transient failures */
export async function retryOSConnection(): Promise<boolean> {
  _realChecked = false;
  _realAvailable = false;
  _realClient = null;
  const client = await getRealOSClient();
  return client !== null;
}

// ── Search Query Builders ───────────────────────────────────────────────────

export function buildMatchQuery(field: string, value: string): Record<string, unknown> {
  return { match: { [field]: value } };
}

export function buildTermQuery(field: string, value: string | number): Record<string, unknown> {
  return { term: { [field]: value } };
}

export function buildRangeQuery(field: string, gte?: unknown, lte?: unknown): Record<string, unknown> {
  const range: Record<string, unknown> = {};
  if (gte !== undefined) range.gte = gte;
  if (lte !== undefined) range.lte = lte;
  return { range: { [field]: range } };
}

export function buildBoolQuery(params: {
  must?: Record<string, unknown>[];
  filter?: Record<string, unknown>[];
  should?: Record<string, unknown>[];
  mustNot?: Record<string, unknown>[];
}): Record<string, unknown> {
  const bool: Record<string, unknown> = {};
  if (params.must?.length) bool.must = params.must;
  if (params.filter?.length) bool.filter = params.filter;
  if (params.should?.length) bool.should = params.should;
  if (params.mustNot?.length) bool.must_not = params.mustNot;
  return { bool };
}

export function buildSecurityEventQuery(params: {
  severity?: string;
  type?: string;
  userId?: number;
  from?: string;
  to?: string;
}): Record<string, unknown> {
  const filters: Record<string, unknown>[] = [];
  if (params.severity) filters.push(buildTermQuery("severity", params.severity));
  if (params.type) filters.push(buildTermQuery("type", params.type));
  if (params.userId) filters.push(buildTermQuery("userId", params.userId));
  if (params.from || params.to) filters.push(buildRangeQuery("@timestamp", params.from, params.to));
  return filters.length > 0 ? buildBoolQuery({ filter: filters }) : { match_all: {} };
}

// ── Legacy HTTP Client (graceful degradation) ─────────────────────────────────

class OpenSearchClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private available = false;

  constructor() {
    this.baseUrl = OPENSEARCH_URL;
    const auth = Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASS}`).toString("base64");
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    };
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/_cluster/health`, {
        headers: this.headers,
        signal: AbortSignal.timeout(2000),
      });
      this.available = res.ok;
      if (this.available) {
        logger.info("[OPENSEARCH] Connected successfully");
      }
    } catch {
      this.available = false;
      logger.info("[OPENSEARCH] Not available, search will use database fallback");
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async search<T = Record<string, unknown>>(
    index: string,
    query: Record<string, unknown>,
    options: { from?: number; size?: number; sort?: unknown[] } = {}
  ): Promise<SearchResult<T>> {
    if (!this.available) {
      return { total: 0, hits: [], took: 0 };
    }

    try {
      const body = {
        query,
        from: options.from ?? 0,
        size: options.size ?? 20,
        ...(options.sort ? { sort: options.sort } : {}),
      };

      const res = await fetch(`${this.baseUrl}/${index}/_search`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        logger.error(`[OPENSEARCH] Search failed: ${res.status}`);
        return { total: 0, hits: [], took: 0 };
      }

      const data = (await res.json()) as {
        hits: { total: { value: number }; hits: SearchHit<T>[] };
        took: number;
      };

      return {
        total: data.hits.total.value,
        hits: data.hits.hits,
        took: data.took,
      };
    } catch (error) {
      logger.error({ err: error }, '[OPENSEARCH] Search error:');
      return { total: 0, hits: [], took: 0 };
    }
  }

  async index(indexName: string, id: string, document: unknown): Promise<boolean> {
    if (!this.available) return false;

    try {
      const res = await fetch(`${this.baseUrl}/${indexName}/_doc/${id}`, {
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify(document),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async delete(indexName: string, id: string): Promise<boolean> {
    if (!this.available) return false;

    try {
      const res = await fetch(`${this.baseUrl}/${indexName}/_doc/${id}`, {
        method: "DELETE",
        headers: this.headers,
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async bulkIndex(indexName: string, documents: Array<{ id: string; doc: unknown }>): Promise<number> {
    if (!this.available || documents.length === 0) return 0;

    try {
      const body = documents
        .flatMap(({ id, doc }) => [
          JSON.stringify({ index: { _index: indexName, _id: id } }),
          JSON.stringify(doc),
        ])
        .join("\n") + "\n";

      const res = await fetch(`${this.baseUrl}/_bulk`, {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/x-ndjson" },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return 0;
      const data = (await res.json()) as { errors: boolean; items: unknown[] };
      return data.errors ? 0 : documents.length;
    } catch {
      return 0;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let osClient: OpenSearchClient | null = null;

export function getOpenSearchClient(): OpenSearchClient {
  if (!osClient) {
    osClient = new OpenSearchClient();
  }
  return osClient;
}

// ── High-Level Search Functions ───────────────────────────────────────────────

export async function searchTransactions(
  userId: string,
  query: string,
  options: { from?: number; size?: number; status?: string; dateFrom?: string; dateTo?: string } = {}
): Promise<SearchResult> {
  const client = getOpenSearchClient();

  const must: unknown[] = [
    { term: { userId } },
  ];

  if (query) {
    must.push({
      multi_match: {
        query,
        fields: ["beneficiaryName^2", "reference^3", "note"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    });
  }

  if (options.status) {
    must.push({ term: { status: options.status } });
  }

  const filter: unknown[] = [];
  if (options.dateFrom || options.dateTo) {
    filter.push({
      range: {
        createdAt: {
          ...(options.dateFrom ? { gte: options.dateFrom } : {}),
          ...(options.dateTo ? { lte: options.dateTo } : {}),
        },
      },
    });
  }

  return client.search(INDICES.TRANSACTIONS, {
    bool: { must, ...(filter.length ? { filter } : {}) },
  }, {
    from: options.from,
    size: options.size,
    sort: [{ createdAt: { order: "desc" } }],
  });
}

export async function searchMarketListings(
  query: string,
  options: { category?: string; country?: string; from?: number; size?: number } = {}
): Promise<SearchResult> {
  const client = getOpenSearchClient();

  const must: unknown[] = [{ term: { status: "active" } }];

  if (query) {
    must.push({
      multi_match: {
        query,
        fields: ["title^3", "description^2", "tags"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    });
  }

  if (options.category) must.push({ term: { category: options.category } });
  if (options.country) must.push({ term: { country: options.country } });

  return client.search(INDICES.MARKET_LISTINGS, { bool: { must } }, {
    from: options.from,
    size: options.size,
    sort: [{ createdAt: { order: "desc" } }],
  });
}

export async function indexTransaction(tx: {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  beneficiaryName?: string;
  reference?: string;
  note?: string;
  destinationCountry?: string;
  createdAt: Date;
}): Promise<void> {
  await getOpenSearchClient().index(INDICES.TRANSACTIONS, tx.id, {
    ...tx,
    createdAt: tx.createdAt.toISOString(),
  });
}

export async function indexMarketListing(listing: {
  id: string;
  sellerId: string;
  title: string;
  description?: string;
  category: string;
  price: number;
  currency: string;
  country?: string;
  status: string;
  tags?: string[];
  createdAt: Date;
}): Promise<void> {
  await getOpenSearchClient().index(INDICES.MARKET_LISTINGS, listing.id, {
    ...listing,
    createdAt: listing.createdAt.toISOString(),
  });
}
