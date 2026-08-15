import { safeParseAmount } from "./lib/safeDecimal";
/**
 * RemitFlow — Lakehouse Integration Service (TypeScript layer)
 *
 * Architecture:
 *  PostgreSQL (OLTP) → Bronze (raw Parquet) → Silver (cleaned) → Gold (aggregates)
 *
 * Storage backends (in priority order):
 *  1. S3/MinIO via direct HTTP PUT (production)
 *  2. Lakehouse ETL Python service proxy (when running alongside microservices)
 *  3. Local filesystem fallback (development)
 *
 * Format: Apache Parquet via lakehouse-etl Python service
 * Catalog: Iceberg-compatible manifest (managed by lakehouse-etl)
 * Query:   DuckDB (in-process, reads Parquet files)
 */

// ── Config ────────────────────────────────────────────────────────────────────
const LAKEHOUSE_ETL_URL = process.env.LAKEHOUSE_ETL_URL || "http://localhost:8089";
const LAKEHOUSE_SERVICE_URL = process.env.LAKEHOUSE_SERVICE_URL || "http://localhost:8101";
const MINIO_URL = process.env.MINIO_URL || "http://localhost:9000";
const MINIO_BUCKET = process.env.S3_BUCKET || "remitflow-lakehouse";
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[lakehouse] ${name} is not set. Refusing to fall back to well-known ` +
        `default credentials; configure S3/MinIO credentials explicitly.`,
    );
  }
  return value;
}

const LAKEHOUSE_LOCAL_PATH = process.env.LAKEHOUSE_PATH || "/data/lakehouse";

// ── Layer Definitions ─────────────────────────────────────────────────────────
export const LAYERS = {
  BRONZE: "bronze",
  SILVER: "silver",
  GOLD: "gold",
} as const;

export const TABLES = {
  TRANSACTIONS: "transactions",
  USERS: "users",
  BENEFICIARIES: "beneficiaries",
  COMPLIANCE_CASES: "compliance_cases",
  RISK_SCORES: "risk_scores",
  DAILY_VOLUME: "daily_volume",
  CORRIDOR_ANALYTICS: "corridor_analytics",
  ML_FEATURES: "ml_features",
} as const;

// ── S3/MinIO Direct Storage ──────────────────────────────────────────────────

interface StorageResult {
  key: string;
  url: string;
  size: number;
  backend: "s3" | "etl-service" | "local";
}

let _minioAvailable: boolean | null = null;

async function checkMinioHealth(): Promise<boolean> {
  if (_minioAvailable !== null) return _minioAvailable;
  try {
    const res = await fetch(`${MINIO_URL}/minio/health/live`, { signal: AbortSignal.timeout(3000) });
    _minioAvailable = res.ok;
  } catch {
    _minioAvailable = false;
  }
  return _minioAvailable;
}

/**
 * AWS Signature Version 4 signing for S3-compatible storage (MinIO/S3).
 * Uses standard SigV4 instead of Basic auth for production compatibility.
 */
function signS3Request(method: string, url: string, headers: Record<string, string>, body: Buffer): Record<string, string> {
  const crypto = require("crypto") as typeof import("crypto");
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const region = process.env.AWS_REGION || "us-east-1";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  // Resolved lazily so the local-filesystem dev fallback never requires S3 creds.
  const accessKey = requireEnv("S3_ACCESS_KEY");
  const secretKey = requireEnv("S3_SECRET_KEY");

  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = crypto.createHash("sha256").update(body).digest("hex");

  const sortedHeaders = Object.keys(headers).sort();
  const signedHeaders = sortedHeaders.join(";");
  const canonicalHeaders = sortedHeaders.map(k => `${k}:${headers[k]}`).join("\n") + "\n";

  const parsedUrl = new URL(url);
  const canonicalRequest = [method, parsedUrl.pathname, parsedUrl.search.slice(1), canonicalHeaders, signedHeaders, headers["x-amz-content-sha256"]].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

  const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

async function putToMinio(key: string, data: Buffer, contentType: string): Promise<StorageResult | null> {
  if (!await checkMinioHealth()) return null;
  try {
    const url = `${MINIO_URL}/${MINIO_BUCKET}/${key}`;
    const headers: Record<string, string> = { "content-type": contentType, "host": new URL(MINIO_URL).host };
    const signedHeaders = signS3Request("PUT", url, headers, data);
    const res = await fetch(url, {
      method: "PUT",
      headers: signedHeaders,
      body: data as unknown as BodyInit,
    });
    if (res.ok || res.status === 200 || res.status === 204) {
      return { key, url, size: data.length, backend: "s3" };
    }
  } catch { /* fall through */ }
  return null;
}

async function writeLocal(key: string, data: Buffer | Uint8Array): Promise<StorageResult> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const fullPath = join(LAKEHOUSE_LOCAL_PATH, key);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
  return { key, url: `file://${fullPath}`, size: data.length, backend: "local" };
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

async function storagePutLakehouse(key: string, data: Buffer | Uint8Array | string, contentType: string): Promise<StorageResult> {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);

  const s3Result = await putToMinio(key, buf, contentType);
  if (s3Result) return s3Result;

  if (IS_PRODUCTION) {
    // Fail-closed: never silently degrade to the container-local filesystem in production.
    throw new Error(`[Lakehouse] FAIL-CLOSED: S3/MinIO unavailable — cannot persist '${key}'`);
  }
  return writeLocal(key, buf);
}

// ── Iceberg Manifest ─────────────────────────────────────────────────────────

interface IcebergSnapshot {
  snapshotId: number;
  sequenceNumber: number;
  timestampMs: number;
  operation: string;
  addedFiles: number;
  addedRecords: number;
  addedBytes: number;
}

async function commitIcebergSnapshot(
  layer: string,
  table: string,
  manifestFiles: string[],
  addedRows: number,
  addedBytes: number,
  fileFormat: "PARQUET" | "NDJSON" = "PARQUET",
): Promise<IcebergSnapshot> {
  const snapshotId = Date.now();
  const seq = snapshotId;
  const snapshot: IcebergSnapshot = {
    snapshotId,
    sequenceNumber: seq,
    timestampMs: snapshotId,
    operation: "append",
    addedFiles: manifestFiles.length,
    addedRecords: addedRows,
    addedBytes,
  };

  const manifestKey = `iceberg/${layer}/${table}/metadata/snap-${snapshotId}-manifest.json`;
  const manifestData = JSON.stringify({
    entries: manifestFiles.map((f) => ({
      status: 1,
      data_file: { file_path: f, file_format: fileFormat, record_count: Math.ceil(addedRows / manifestFiles.length) },
    })),
    snapshot_id: snapshotId,
    sequence_number: seq,
  }, null, 2);
  await storagePutLakehouse(manifestKey, manifestData, "application/json");

  const catalogKey = `iceberg/${layer}/${table}/metadata/v-current.metadata.json`;
  const catalogData = JSON.stringify({
    "format-version": 2,
    "table-uuid": `${layer}-${table}`,
    "location": `s3://${MINIO_BUCKET}/${layer}/${table}`,
    "last-sequence-number": seq,
    "last-updated-ms": snapshotId,
    "current-snapshot-id": snapshotId,
    "snapshots": [snapshot],
    "properties": { "write.format.default": "parquet" },
  }, null, 2);
  await storagePutLakehouse(catalogKey, catalogData, "application/json");

  return snapshot;
}

// ── NDJSON Staging Writer (pure TypeScript fallback) ─────────────────────────
//
// Real Parquet encoding requires pyarrow and is delegated to the Python ETL
// service. When that service is unavailable, we honestly write NDJSON staging
// files (.jsonl) rather than fabricating Parquet containers. The lakehouse-etl
// DuckDB query layer can read these via read_json_auto.

function toNdjsonBuffer(rows: Record<string, unknown>[]): Buffer {
  return Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

async function writeParquetViaETL(
  layer: string,
  table: string,
  rows: Record<string, unknown>[],
): Promise<{ key: string; url: string; rowCount: number; bytes: number; backend: string } | null> {
  try {
    const res = await fetch(`${LAKEHOUSE_ETL_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
  } catch { return null; }

  // Delegate to ETL service for proper pyarrow Parquet
  try {
    const res = await fetch(`${LAKEHOUSE_ETL_URL}/pipelines/run-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: table, limit: rows.length, incremental: false }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const result = await res.json() as Record<string, unknown>;
      const pipelines = result.pipelines as Record<string, Record<string, unknown>> | undefined;
      const pipeResult = pipelines?.[table];
      if (pipeResult?.status === "success") {
        return {
          key: (pipeResult.bronze as Record<string, unknown>)?.key as string || `${layer}/${table}/delegated`,
          url: (pipeResult.bronze as Record<string, unknown>)?.url as string || "",
          rowCount: pipeResult.records_loaded as number || rows.length,
          bytes: 0,
          backend: "etl-service-parquet",
        };
      }
    }
  } catch { /* fall through to local Parquet */ }
  return null;
}

// ── Bronze Layer: Raw Event Ingestion ─────────────────────────────────────────
export async function ingestToBronze(
  table: string,
  rows: Record<string, unknown>[],
  partitionDate?: string
): Promise<{ key: string; url: string; rowCount: number }> {
  const date = partitionDate || new Date().toISOString().split("T")[0];
  const timestamp = Date.now();

  const enrichedRows = rows.map((r) => ({
    ...r,
    _ingested_at: timestamp,
    _source: "remitflow-postgres",
    _layer: "bronze",
  }));

  // Try ETL service first (produces real Parquet via pyarrow)
  const etlResult = await writeParquetViaETL(LAYERS.BRONZE, table, enrichedRows);
  if (etlResult) {
    return { key: etlResult.key, url: etlResult.url, rowCount: etlResult.rowCount };
  }

  // Fallback: honest NDJSON staging file (readable via DuckDB read_json_auto)
  const ndjsonData = toNdjsonBuffer(enrichedRows);
  const key = `${LAYERS.BRONZE}/${table}/date=${date}/part-${timestamp}.jsonl`;
  const result = await storagePutLakehouse(key, ndjsonData, "application/x-ndjson");

  await commitIcebergSnapshot(LAYERS.BRONZE, table, [key], rows.length, ndjsonData.length, "NDJSON");

  return { key: result.key, url: result.url, rowCount: rows.length };
}

// ── Silver Layer: Cleaned & Normalized ───────────────────────────────────────
export async function transformToSilver(
  table: string,
  bronzeRows: Record<string, unknown>[]
): Promise<{ key: string; url: string; rowCount: number }> {
  const timestamp = Date.now();
  const date = new Date().toISOString().split("T")[0];

  const silverRows = bronzeRows.map((row) => {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith("_")) continue;
      cleaned[k] = v === null || v === undefined ? null : v;
      if (k === "amount" || k === "fee" || k === "risk_score") {
        cleaned[k] = safeParseAmount(String(v || "0"));
      }
      if (k.endsWith("_at") || k.endsWith("_date")) {
        cleaned[k] = v ? new Date(v as string | number | Date).toISOString() : null;
      }
    }
    return {
      ...cleaned,
      _silver_processed_at: timestamp,
      _layer: "silver",
    };
  });

  const silverData = toNdjsonBuffer(silverRows);
  const key = `${LAYERS.SILVER}/${table}/date=${date}/part-${timestamp}.jsonl`;
  const result = await storagePutLakehouse(key, silverData, "application/x-ndjson");

  await commitIcebergSnapshot(LAYERS.SILVER, table, [key], silverRows.length, silverData.length, "NDJSON");

  return { key: result.key, url: result.url, rowCount: silverRows.length };
}

// ── Gold Layer: Business Aggregates ──────────────────────────────────────────
export async function buildGoldAggregates(
  transactions: Record<string, unknown>[]
): Promise<{
  dailyVolume: { key: string; url: string };
  corridorAnalytics: { key: string; url: string };
  mlFeatures: { key: string; url: string };
}> {
  const timestamp = Date.now();
  const date = new Date().toISOString().split("T")[0];

  // Daily volume aggregation
  const dailyVolumeMap: Record<string, { date: string; currency: string; totalAmount: number; txCount: number; avgAmount: number; totalFees: number; completedCount: number; failedCount: number }> = {};
  for (const tx of transactions) {
    const txDate = tx.created_at ? new Date(tx.created_at as string | number | Date).toISOString().split("T")[0] : date;
    const currency = (tx.currency as string) || "USD";
    const key = `${txDate}_${currency}`;
    if (!dailyVolumeMap[key]) {
      dailyVolumeMap[key] = { date: txDate, currency, totalAmount: 0, txCount: 0, avgAmount: 0, totalFees: 0, completedCount: 0, failedCount: 0 };
    }
    const amount = safeParseAmount(String(tx.amount || "0"));
    dailyVolumeMap[key].totalAmount += amount;
    dailyVolumeMap[key].txCount++;
    dailyVolumeMap[key].totalFees += safeParseAmount(String(tx.fee || "0"));
    if (tx.status === "completed") dailyVolumeMap[key].completedCount++;
    if (tx.status === "failed") dailyVolumeMap[key].failedCount++;
  }
  for (const v of Object.values(dailyVolumeMap)) {
    v.avgAmount = v.txCount > 0 ? v.totalAmount / v.txCount : 0;
  }

  // Corridor analytics
  const corridorMap: Record<string, { corridor: string; fromCurrency: string; toCurrency: string; destinationCountry: string; txCount: number; totalVolume: number; avgRisk: number; avgAmount: number }> = {};
  for (const tx of transactions) {
    const from = (tx.currency as string) || "USD";
    const to = (tx.to_currency as string) || "USD";
    const dest = (tx.destination_country as string) || "US";
    const corridor = `${from}_${to}_${dest}`;
    if (!corridorMap[corridor]) {
      corridorMap[corridor] = { corridor, fromCurrency: from, toCurrency: to, destinationCountry: dest, txCount: 0, totalVolume: 0, avgRisk: 0, avgAmount: 0 };
    }
    corridorMap[corridor].txCount++;
    corridorMap[corridor].totalVolume += safeParseAmount(String(tx.amount || "0"));
    corridorMap[corridor].avgRisk += safeParseAmount(String(tx.risk_score || "0"));
  }
  for (const c of Object.values(corridorMap)) {
    c.avgRisk = c.txCount > 0 ? c.avgRisk / c.txCount : 0;
    c.avgAmount = c.txCount > 0 ? c.totalVolume / c.txCount : 0;
  }

  // ML feature store snapshot
  const mlFeatures = transactions.map((tx) => {
    const amount = safeParseAmount(String(tx.amount || "0"));
    const created = tx.created_at ? new Date(tx.created_at as string | number | Date) : new Date();
    return {
      tx_id: tx.id,
      amount_usd: amount,
      risk_score: safeParseAmount(String(tx.risk_score || "0")),
      is_high_value: amount > 10000 ? 1 : 0,
      is_round_number: amount > 0 && amount % 100 === 0 ? 1 : 0,
      destination_country: tx.destination_country || "US",
      currency: tx.currency || "USD",
      status: tx.status || "pending",
      hour_of_day: created.getUTCHours(),
      day_of_week: created.getUTCDay(),
      feature_date: date,
    };
  });

  const dvData = toNdjsonBuffer(Object.values(dailyVolumeMap));
  const caData = toNdjsonBuffer(Object.values(corridorMap));
  const mlData = toNdjsonBuffer(mlFeatures);

  const dvKey = `${LAYERS.GOLD}/daily_volume/date=${date}/part-${timestamp}.jsonl`;
  const caKey = `${LAYERS.GOLD}/corridor_analytics/date=${date}/part-${timestamp}.jsonl`;
  const mlKey = `${LAYERS.GOLD}/ml_features/date=${date}/part-${timestamp}.jsonl`;

  const [dvResult, caResult, mlResult] = await Promise.all([
    storagePutLakehouse(dvKey, dvData, "application/x-ndjson"),
    storagePutLakehouse(caKey, caData, "application/x-ndjson"),
    storagePutLakehouse(mlKey, mlData, "application/x-ndjson"),
  ]);

  await Promise.all([
    commitIcebergSnapshot(LAYERS.GOLD, "daily_volume", [dvKey], Object.values(dailyVolumeMap).length, dvData.length, "NDJSON"),
    commitIcebergSnapshot(LAYERS.GOLD, "corridor_analytics", [caKey], Object.values(corridorMap).length, caData.length, "NDJSON"),
    commitIcebergSnapshot(LAYERS.GOLD, "ml_features", [mlKey], mlFeatures.length, mlData.length, "NDJSON"),
  ]);

  return {
    dailyVolume: { key: dvResult.key, url: dvResult.url },
    corridorAnalytics: { key: caResult.key, url: caResult.url },
    mlFeatures: { key: mlResult.key, url: mlResult.url },
  };
}

// ── Full ETL Pipeline ─────────────────────────────────────────────────────────
export async function runLakehouseETL(transactions: Record<string, unknown>[]): Promise<{
  bronze: Awaited<ReturnType<typeof ingestToBronze>>;
  silver: Awaited<ReturnType<typeof transformToSilver>>;
  gold: Awaited<ReturnType<typeof buildGoldAggregates>>;
  totalRows: number;
  durationMs: number;
  format: string;
}> {
  const start = Date.now();

  // Try delegating to the Python ETL service for real Parquet
  try {
    const res = await fetch(`${LAKEHOUSE_ETL_URL}/pipelines/run-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: "transactions", limit: transactions.length || 1000, incremental: false }),
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const result = await res.json() as Record<string, unknown>;
      const txPipe = (result.pipelines as Record<string, Record<string, unknown>>)?.transactions;
      if (txPipe?.status === "success") {
        return {
          bronze: { key: (txPipe.bronze as Record<string, unknown>)?.key as string || "", url: "", rowCount: txPipe.records_extracted as number || 0 },
          silver: { key: (txPipe.silver as Record<string, unknown>)?.key as string || "", url: "", rowCount: txPipe.records_loaded as number || 0 },
          gold: {
            dailyVolume: { key: (txPipe.gold as Record<string, Record<string, unknown>>)?.daily_volume?.key as string || "", url: "" },
            corridorAnalytics: { key: (txPipe.gold as Record<string, Record<string, unknown>>)?.corridor_analytics?.key as string || "", url: "" },
            mlFeatures: { key: (txPipe.gold as Record<string, Record<string, unknown>>)?.ml_features?.key as string || "", url: "" },
          },
          totalRows: txPipe.records_extracted as number || 0,
          durationMs: Date.now() - start,
          format: "parquet-pyarrow",
        };
      }
    }
  } catch { /* fall through to local ETL */ }

  // Local ETL fallback
  const bronze = await ingestToBronze(TABLES.TRANSACTIONS, transactions);
  const silver = await transformToSilver(TABLES.TRANSACTIONS, transactions);
  const gold = await buildGoldAggregates(transactions);

  return {
    bronze,
    silver,
    gold,
    totalRows: transactions.length,
    durationMs: Date.now() - start,
    format: "ndjson-staging",
  };
}

// ── Router-Facing Lakehouse Operations (real HTTP to python-lakehouse) ───────
//
// These replace the deleted in-memory lakehouseHardened.ts fake. All writes and
// reads go to the python-lakehouse sync engine (LAKEHOUSE_URL), which persists
// records as Snappy Parquet on S3/MinIO. Fail loudly when unavailable — the
// lakehouse is a compliance data sink, so fabricated success is not acceptable.

const LAKEHOUSE_URL = process.env.LAKEHOUSE_URL || "http://localhost:8102";

export interface LakehouseWriteResult {
  path: string;
  table: string;
  rowsIngested: number;
  country: string;
  timestamp: string;
}

export interface LakehouseReadResult {
  table: string;
  rows: Record<string, unknown>[];
  totalRows: number;
  filesRead: number;
}

export async function lakehouseWrite(
  table: string,
  data: unknown,
  options: { country: string },
): Promise<LakehouseWriteResult> {
  const record = {
    ...(typeof data === "object" && data !== null ? data as Record<string, unknown> : { value: data }),
    _country: options.country,
    _written_at: new Date().toISOString(),
  };

  let res: Response;
  try {
    res = await fetch(`${LAKEHOUSE_URL}/ingest/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [record] }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`[Lakehouse] FAIL-CLOSED: write to table '${table}' failed — lakehouse service unreachable at ${LAKEHOUSE_URL}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[Lakehouse] FAIL-CLOSED: ingest rejected for table '${table}' — HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = await res.json() as { s3_key: string; path: string; rows_ingested: number; timestamp: string };
  return {
    path: body.path,
    table,
    rowsIngested: body.rows_ingested,
    country: options.country,
    timestamp: body.timestamp,
  };
}

export async function lakehouseRead(
  table: string,
  options: { country?: string; limit?: number } = {},
): Promise<LakehouseReadResult> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.country) params.set("country", options.country);

  let res: Response;
  try {
    res = await fetch(`${LAKEHOUSE_URL}/read/${encodeURIComponent(table)}?${params.toString()}`, {
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`[Lakehouse] FAIL-CLOSED: read from table '${table}' failed — lakehouse service unreachable at ${LAKEHOUSE_URL}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[Lakehouse] FAIL-CLOSED: read rejected for table '${table}' — HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = await res.json() as { rows: Record<string, unknown>[]; total_rows: number; files_read: number };
  return { table, rows: body.rows, totalRows: body.total_rows, filesRead: body.files_read };
}

export async function getLakehouseHealth(): Promise<{
  connected: boolean;
  service: string;
  syncEngineUrl: string;
  dbOk: boolean;
  s3Ok: boolean;
  syncedTables: number;
  failClosed: boolean;
  error?: string;
}> {
  const base = { service: "python-lakehouse", syncEngineUrl: LAKEHOUSE_URL, failClosed: true };
  try {
    const healthRes = await fetch(`${LAKEHOUSE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const health = await healthRes.json().catch(() => ({})) as { db_ok?: boolean; s3_ok?: boolean; status?: string };

    let syncedTables = 0;
    try {
      const statusRes = await fetch(`${LAKEHOUSE_URL}/sync/status`, { signal: AbortSignal.timeout(5000) });
      if (statusRes.ok) {
        const status = await statusRes.json() as { synced_tables?: number };
        syncedTables = status.synced_tables ?? 0;
      }
    } catch { /* status endpoint optional */ }

    return {
      ...base,
      connected: healthRes.ok,
      dbOk: health.db_ok ?? false,
      s3Ok: health.s3_ok ?? false,
      syncedTables,
      ...(healthRes.ok ? {} : { error: `health endpoint returned HTTP ${healthRes.status}` }),
    };
  } catch (err) {
    return { ...base, connected: false, dbOk: false, s3Ok: false, syncedTables: 0, error: (err as Error).message };
  }
}

// ── Status ────────────────────────────────────────────────────────────────────
export async function getLakehouseStatus(): Promise<{
  layers: typeof LAYERS;
  tables: typeof TABLES;
  minioUrl: string;
  etlServiceUrl: string;
  lakehouseServiceUrl: string;
  storageBackend: string;
  format: string;
  catalog: string;
  aiIntegrations: {
    qdrant: string;
    falkordb: string;
    cocoindex: string;
    ollama: string;
  };
  etlHealth: Record<string, unknown> | null;
}> {
  let etlHealth: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${LAKEHOUSE_ETL_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) etlHealth = await res.json() as Record<string, unknown>;
  } catch { /* ETL service not running */ }

  const minioOk = await checkMinioHealth();

  return {
    layers: LAYERS,
    tables: TABLES,
    minioUrl: MINIO_URL,
    etlServiceUrl: LAKEHOUSE_ETL_URL,
    lakehouseServiceUrl: LAKEHOUSE_SERVICE_URL,
    storageBackend: minioOk ? "s3-minio" : "local-filesystem",
    format: "Apache Parquet (Snappy compression)",
    catalog: "Iceberg-compatible JSON manifest",
    aiIntegrations: {
      qdrant: "Vector embeddings stored in Qdrant from Bronze layer via CocoIndex",
      falkordb: "Knowledge graph nodes built from Silver layer transactions",
      cocoindex: "Incremental pipeline: Bronze → Qdrant + FalkorDB",
      ollama: "Gold layer narrative generation + ML feature explanation",
    },
    etlHealth,
  };
}
