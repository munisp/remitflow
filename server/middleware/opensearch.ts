/**
 * RemitFlow — OpenSearch Client (Production v79)
 * Uses @opensearch-project/opensearch with graceful degradation.
 * Full-text search + SIEM for: transactions, audit logs, security events, compliance.
 */
import { Client } from "@opensearch-project/opensearch";
import { logger } from '../_core/logger';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL || "http://localhost:9200";
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || "admin";
const OPENSEARCH_PASS = process.env.OPENSEARCH_PASS || "";

if (!process.env.OPENSEARCH_PASS && process.env.NODE_ENV === "production") {
  console.warn("[OpenSearch] OPENSEARCH_PASS not set in production — authentication will fail");
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
      ssl: { rejectUnauthorized: false },
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
  if (!c) return;
  try {
    await c.index({ index: OS_INDICES.SECURITY_EVENTS, body: { ...event, "@timestamp": new Date().toISOString() } });
  } catch { /* graceful */ }
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
  if (!c) return;
  const allIndices = [...Object.values(INDICES), ...Object.values(OS_INDICES)];
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
    } catch { /* ignore */ }
  }
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
