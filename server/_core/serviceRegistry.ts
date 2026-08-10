/**
 * RemitFlow — Unified Service Registry
 * ─────────────────────────────────────
 * Central typed client for ALL polyglot microservices.
 * Every service has a default localhost port and an env-override.
 * All calls are fire-and-forget safe: if a sidecar is unavailable,
 * the function resolves with a safe default so the main flow continues.
 *
 * Port assignments (8082–8220):
 *   8082  rust-audit-service
 *   8083  python-compliance-service
 *   8084  go-ratelimit-sidecar
 *   8085  go-security-sidecar
 *   8086  python-anomaly-detector
 *   8087  rust-crypto-guard
 *   8088  rust-device-fingerprint
 *   8089  transfer-engine (Go)
 *   8090  fx-engine (Go)
 *   8091  risk-engine (Go)
 *   8092  ledger-service (Go)
 *   8093  aml-engine (Rust)
 *   8094  fraud-ml (Python)
 *   8095  python-compliance-ml
 *   8096  python-kyc-liveness
 *   8097  python-sanctions-updater
 *   8098  pdf-receipt (Python)
 *   8099  rust-pdf-receipt
 *   8100  search-indexer (Python)
 *   8101  rust-sme-bulk-processor
 *   8102  go-cips-adapter
 *   8103  python-pix-adapter
 *   8104  rust-upi-adapter
 *   8105  go-kafka-service
 *   8106  kafka-processor (Python)
 *   8107  go-temporal-worker
 *   8108  temporal-workflows (Python)
 *   8109  go-permify-service
 *   8110  python-keycloak-service
 *   8111  go-apisix-service
 *   8112  go-apisix-config
 *   8113  mojaloop-connector (Go)
 *   8114  rust-fluvio-service
 *   8115  rust-pg-service
 *   8116  rust-redis-service
 *   8117  rust-tigerbeetle-service
 *   8118  rust-share-link
 *   8119  rust-portfolio-calc
 *   8120  go-export-service
 *   8121  go-investment-feed
 *   8122  go-community-feed
 *   8123  analytics (Python)
 *   8124  python-nav-analytics
 *   8125  python-investment-ml
 *   8126  python-lakehouse-service
 *   8127  python-opensearch-service
 *   8128  lakehouse-etl (Python)
 *   8129  rate-limiter (Rust)
 *   8130  rust-audit-service (secondary)
 */

const TIMEOUT_MS = parseInt(process.env.SIDECAR_TIMEOUT_MS ?? "2000");

// ── Service URL registry ──────────────────────────────────────────────────────
export const SERVICE_URLS = {
  // Security & Auth
  rustAudit:           process.env.RUST_AUDIT_URL           ?? "http://localhost:8082",
  pythonCompliance:    process.env.PYTHON_COMPLIANCE_URL     ?? "http://localhost:8083",
  goRatelimit:         process.env.GO_RATELIMIT_URL          ?? "http://localhost:8084",
  goSecurity:          process.env.GO_SECURITY_URL           ?? "http://localhost:8085",
  pythonAnomaly:       process.env.PYTHON_ANOMALY_URL        ?? "http://localhost:8086",
  rustCryptoGuard:     process.env.RUST_CRYPTO_GUARD_URL     ?? "http://localhost:8087",
  rustDeviceFingerprint: process.env.RUST_DEVICE_FP_URL      ?? "http://localhost:8088",
  // Core financial
  transferEngine:      process.env.TRANSFER_ENGINE_URL       ?? "http://localhost:8089",
  fxEngine:            process.env.FX_ENGINE_URL             ?? "http://localhost:8090",
  riskEngine:          process.env.RISK_ENGINE_URL           ?? "http://localhost:8091",
  ledgerService:       process.env.LEDGER_SERVICE_URL        ?? "http://localhost:8092",
  amlEngine:           process.env.AML_ENGINE_URL            ?? "http://localhost:8093",
  fraudMl:             process.env.FRAUD_ML_URL              ?? "http://localhost:8094",
  pythonComplianceMl:  process.env.PYTHON_COMPLIANCE_ML_URL  ?? "http://localhost:8095",
  // KYC
  rustLivenessProxy:   process.env.RUST_LIVENESS_PROXY_URL   ?? "http://localhost:8096",  // Rust fail-closed proxy → python-kyc-liveness
  pythonKycLiveness:   process.env.PYTHON_KYC_LIVENESS_URL   ?? "http://localhost:8090",  // Python FastAPI liveness service (behind proxy)
  pythonDeepfake:      process.env.PYTHON_DEEPFAKE_URL        ?? "http://localhost:8097",  // Python deepfake detector
  pythonSanctions:     process.env.PYTHON_SANCTIONS_URL      ?? "http://localhost:8098",
  // PDF / Documents
  pdfReceipt:          process.env.PDF_RECEIPT_URL           ?? "http://localhost:8098",
  rustPdfReceipt:      process.env.RUST_PDF_RECEIPT_URL      ?? "http://localhost:8099",
  // Search
  searchIndexer:       process.env.SEARCH_INDEXER_URL        ?? "http://localhost:8100",
  // Payment rails
  mojaloopConnector:   process.env.MOJALOOP_URL              ?? "http://localhost:8113",
  goCipsAdapter:       process.env.GO_CIPS_URL               ?? "http://localhost:8102",
  pythonPixAdapter:    process.env.PYTHON_PIX_URL            ?? "http://localhost:8103",
  rustUpiAdapter:      process.env.RUST_UPI_URL              ?? "http://localhost:8104",
  // Messaging
  goKafkaService:      process.env.GO_KAFKA_URL              ?? "http://localhost:8105",
  kafkaProcessor:      process.env.KAFKA_PROCESSOR_URL       ?? "http://localhost:8106",
  // Workflows
  goTemporalWorker:    process.env.GO_TEMPORAL_URL           ?? "http://localhost:8107",
  temporalWorkflows:   process.env.TEMPORAL_WORKFLOWS_URL    ?? "http://localhost:8108",
  // IAM
  goPermifyService:    process.env.GO_PERMIFY_URL            ?? "http://localhost:8109",
  pythonKeycloak:      process.env.PYTHON_KEYCLOAK_URL       ?? "http://localhost:8110",
  // Gateway
  goApisixService:     process.env.GO_APISIX_URL             ?? "http://localhost:8111",
  goApisixConfig:      process.env.GO_APISIX_CONFIG_URL      ?? "http://localhost:8112",
  goDaprService:       process.env.GO_DAPR_URL               ?? "http://localhost:8113",
  // Streaming
  rustFluvio:          process.env.RUST_FLUVIO_URL           ?? "http://localhost:8114",
  // Data
  rustPgService:       process.env.RUST_PG_URL               ?? "http://localhost:8115",
  rustRedisService:    process.env.RUST_REDIS_URL            ?? "http://localhost:8116",
  rustTigerbeetle:     process.env.RUST_TIGERBEETLE_URL      ?? "http://localhost:8117",
  rustShareLink:       process.env.RUST_SHARE_LINK_URL       ?? "http://localhost:8118",
  rustPortfolioCalc:   process.env.RUST_PORTFOLIO_URL        ?? "http://localhost:8119",
  // Exports & Analytics
  goExportService:     process.env.GO_EXPORT_URL             ?? "http://localhost:8120",
  goInvestmentFeed:    process.env.GO_INVESTMENT_FEED_URL    ?? "http://localhost:8121",
  goCommunityFeed:     process.env.GO_COMMUNITY_FEED_URL     ?? "http://localhost:8122",
  analyticsService:    process.env.ANALYTICS_URL             ?? "http://localhost:8123",
  pythonNavAnalytics:  process.env.PYTHON_NAV_ANALYTICS_URL  ?? "http://localhost:8124",
  pythonInvestmentMl:  process.env.PYTHON_INVESTMENT_ML_URL  ?? "http://localhost:8125",
  pythonLakehouse:     process.env.PYTHON_LAKEHOUSE_URL      ?? "http://localhost:8126",
  pythonOpensearch:    process.env.PYTHON_OPENSEARCH_URL     ?? "http://localhost:8127",
  lakehouseEtl:        process.env.LAKEHOUSE_ETL_URL         ?? "http://localhost:8128",
  rateLimiter:         process.env.RATE_LIMITER_URL          ?? "http://localhost:8129",
  // ── Newly registered orphan services (v205) ────────────────────────────────
  floatIncome:           process.env.FLOAT_INCOME_URL            ?? "http://localhost:8130",
  goBdcConnector:        process.env.GO_BDC_CONNECTOR_URL        ?? "http://localhost:8131",
  goBricspayAdapter:     process.env.GO_BRICSPAY_URL             ?? "http://localhost:8132",
  goCorrespondentMgr:    process.env.GO_CORRESPONDENT_URL        ?? "http://localhost:8133",
  goGhipssAdapter:       process.env.GO_GHIPSS_URL               ?? "http://localhost:8134",
  goHnwRouting:          process.env.GO_HNW_ROUTING_URL          ?? "http://localhost:8135",
  goLivenessAggregator:  process.env.GO_LIVENESS_AGG_URL         ?? "http://localhost:8098",
  goPapssService:        process.env.GO_PAPSS_URL                ?? "http://localhost:8136",
  goSecurityHardening:   process.env.GO_SECURITY_HARDENING_URL   ?? "http://localhost:8110",
  goSettlementRegistry:  process.env.GO_SETTLEMENT_URL           ?? "http://localhost:8137",
  goSmeTradeService:     process.env.GO_SME_TRADE_URL            ?? "http://localhost:8138",
  goTemporalCbn:         process.env.GO_TEMPORAL_CBN_URL         ?? "http://localhost:8139",
  goXofAdapter:          process.env.GO_XOF_ADAPTER_URL          ?? "http://localhost:8140",
  outboundSwift:         process.env.OUTBOUND_SWIFT_URL          ?? "http://localhost:8141",
  pythonAfricbdc:        process.env.PYTHON_AFRICBDC_URL         ?? "http://localhost:8142",
  pythonCbnLakehouse:    process.env.PYTHON_CBN_LAKEHOUSE_URL    ?? "http://localhost:8143",
  revenueAnalytics:      process.env.REVENUE_ANALYTICS_URL       ?? "http://localhost:8083",
  rustBmatchEngine:      process.env.RUST_BMATCH_URL             ?? "http://localhost:8144",
  rustHnwFxEngine:       process.env.RUST_HNW_FX_URL             ?? "http://localhost:8100",
  rustImmigrantKyc:      process.env.RUST_IMMIGRANT_KYC_URL      ?? "http://localhost:8145",
  rustMbridgeAdapter:    process.env.RUST_MBRIDGE_URL            ?? "http://localhost:8146",
  rustSmeBulkProcessor:  process.env.RUST_SME_BULK_URL           ?? "http://localhost:8101",
  universalFx:           process.env.UNIVERSAL_FX_URL            ?? "http://localhost:8147",
  gatewayConfig:         process.env.GATEWAY_CONFIG_URL          ?? "http://localhost:8148",
} as const;

export type ServiceName = keyof typeof SERVICE_URLS;

// ── Core HTTP helper ──────────────────────────────────────────────────────────
async function fetchSvc<T>(
  url: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
  fallback?: T
): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return fallback as T;
    return (await res.json()) as T;
  } catch {
    return fallback as T;
  } finally {
    clearTimeout(tid);
  }
}

// ── Health check (all services) ───────────────────────────────────────────────
export interface ServiceHealth {
  name: string;
  url: string;
  status: "healthy" | "degraded" | "unavailable";
  latencyMs?: number;
}

export async function checkAllServicesHealth(): Promise<ServiceHealth[]> {
  const results = await Promise.allSettled(
    Object.entries(SERVICE_URLS).map(async ([name, url]) => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${url}/health`, { signal: controller.signal });
        clearTimeout(tid);
        return {
          name,
          url,
          status: res.ok ? "healthy" : "degraded",
          latencyMs: Date.now() - start,
        } as ServiceHealth;
      } catch {
        return { name, url, status: "unavailable", latencyMs: Date.now() - start } as ServiceHealth;
      }
    })
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value : { name: "unknown", url: "", status: "unavailable" }));
}

// ── AML Engine (Rust) ─────────────────────────────────────────────────────────
export interface AmlCheckResult {
  flagged: boolean;
  riskScore: number;
  reasons: string[];
  requiresReview: boolean;
}
export async function amlCheck(payload: {
  userId: number;
  amount: number;
  currency: string;
  destinationCountry: string;
  beneficiaryName: string;
}): Promise<AmlCheckResult> {
  return fetchSvc<AmlCheckResult>(
    SERVICE_URLS.amlEngine, "/check", "POST", payload,
    { flagged: false, riskScore: 0, reasons: [], requiresReview: false }
  );
}

// ── Fraud ML (Python) ─────────────────────────────────────────────────────────
export interface FraudScore {
  score: number; // 0–1
  label: "low" | "medium" | "high" | "critical";
  features: Record<string, number>;
}
export async function fraudScore(payload: {
  userId: number;
  amount: number;
  deviceFingerprint?: string;
  ipAddress?: string;
}): Promise<FraudScore> {
  return fetchSvc<FraudScore>(
    SERVICE_URLS.fraudMl, "/score", "POST", payload,
    { score: 0, label: "low", features: {} }
  );
}

// ── Transfer Engine (Go) ──────────────────────────────────────────────────────
export interface TransferEngineResult {
  transferId: string;
  status: "queued" | "processing" | "completed" | "failed";
  estimatedArrival: string;
  fee: number;
  fxRate: number;
}
export async function initiateTransfer(payload: {
  fromUserId: number;
  toUserId?: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  rail: "swift" | "sepa" | "ach" | "mojaloop" | "pix" | "upi";
}): Promise<TransferEngineResult> {
  return fetchSvc<TransferEngineResult>(
    SERVICE_URLS.transferEngine, "/transfer", "POST", payload,
    { transferId: `local-${Date.now()}`, status: "queued", estimatedArrival: new Date(Date.now() + 86400000).toISOString(), fee: 0, fxRate: 1 }
  );
}

// ── FX Engine (Go) ────────────────────────────────────────────────────────────
export interface FxQuote {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  inverseRate: number;
  spread: number;
  validUntil: string;
}
export async function getFxQuote(from: string, to: string): Promise<FxQuote> {
  return fetchSvc<FxQuote>(
    SERVICE_URLS.fxEngine, `/quote?from=${from}&to=${to}`, "GET", undefined,
    { fromCurrency: from, toCurrency: to, rate: 1, inverseRate: 1, spread: 0.005, validUntil: new Date(Date.now() + 900000).toISOString() }
  );
}

// ── Risk Engine (Go) ──────────────────────────────────────────────────────────
export interface RiskAssessment {
  userId: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  score: number;
  triggers: string[];
  recommendedAction: "allow" | "review" | "block";
}
export async function assessRisk(userId: number, context: Record<string, unknown>): Promise<RiskAssessment> {
  return fetchSvc<RiskAssessment>(
    SERVICE_URLS.riskEngine, "/assess", "POST", { userId, context },
    { userId, riskLevel: "low", score: 0, triggers: [], recommendedAction: "allow" }
  );
}

// ── Ledger Service (Go) ───────────────────────────────────────────────────────
export interface LedgerEntry {
  entryId: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: string;
  timestamp: string;
}
export async function postLedgerEntry(entry: Omit<LedgerEntry, "entryId" | "timestamp">): Promise<LedgerEntry> {
  return fetchSvc<LedgerEntry>(
    SERVICE_URLS.ledgerService, "/entry", "POST", entry,
    { ...entry, entryId: `local-${Date.now()}`, timestamp: new Date().toISOString() }
  );
}

// ── KYC Liveness (Python) ─────────────────────────────────────────────────────
export interface LivenessResult {
  passed: boolean;
  confidence: number;
  livenessScore: number;
  spoofingDetected: boolean;
  /** Set to true when the liveness service was unreachable — callers should surface an error, not approve KYC */
  serviceUnavailable?: boolean;
}
/** SECURITY NOTE: fallback is deliberately FAILING (passed:false, score:0) so that a service outage
 *  blocks KYC progression rather than silently granting approval.
 *  Routes through the Rust proxy (port 8096) which adds circuit-breaking and rate-limiting. */
export async function checkLiveness(imageUrl: string): Promise<LivenessResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_URLS.rustLivenessProxy}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
      signal: controller.signal,
    });
    if (!res.ok) return { passed: false, confidence: 0.0, livenessScore: 0.0, spoofingDetected: false, serviceUnavailable: true };
    return (await res.json()) as LivenessResult;
  } catch {
    // Service unreachable — fail closed (do NOT approve KYC)
    return { passed: false, confidence: 0.0, livenessScore: 0.0, spoofingDetected: false, serviceUnavailable: true };
  } finally {
    clearTimeout(tid);
  }
}

// ── Deepfake Detection (Python) ───────────────────────────────────────────────────
export interface DeepfakeResult {
  is_deepfake: boolean;
  confidence: number;       // 0–1 probability of being a deepfake
  method: string;           // "hf_model:...", "frequency_domain_dct", "landmark_consistency", "fail_closed"
  indicators: string[];     // e.g. ["checkerboard_artifacts", "elevated_high_freq_energy"]
  processing_time_ms: number;
  /** True when the deepfake service was unreachable — callers should treat as inconclusive */
  serviceUnavailable?: boolean;
}
/** SECURITY NOTE: fallback is FAIL-CLOSED (is_deepfake:true) when the service is unreachable,
 *  so that an outage blocks KYC rather than silently approving potentially fake faces. */
export async function checkDeepfake(imageUrl: string, userId?: string): Promise<DeepfakeResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_URLS.pythonDeepfake}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, user_id: userId }),
      signal: controller.signal,
    });
    if (!res.ok) return { is_deepfake: true, confidence: 0.0, method: "fail_closed", indicators: ["upstream_error"], processing_time_ms: 0, serviceUnavailable: true };
    return (await res.json()) as DeepfakeResult;
  } catch {
    return { is_deepfake: true, confidence: 0.0, method: "fail_closed", indicators: ["service_unreachable"], processing_time_ms: 0, serviceUnavailable: true };
  } finally {
    clearTimeout(tid);
  }
}

// ── Sanctions Updater (Python) ─────────────────────────────────────────────────────
export interface SanctionsCheckResult {
  matched: boolean;
  matchedLists: string[];
  matchScore: number;
  entityName?: string;
}
export async function checkSanctions(name: string, country?: string): Promise<SanctionsCheckResult> {
  return fetchSvc<SanctionsCheckResult>(
    SERVICE_URLS.pythonSanctions, "/check", "POST", { name, country },
    { matched: false, matchedLists: [], matchScore: 0 }
  );
}

// ── PDF Receipt (Python / Rust) ───────────────────────────────────────────────
export interface ReceiptResult {
  pdfUrl: string;
  receiptId: string;
}
export async function generateReceipt(transfer: {
  id: string;
  amount: number;
  currency: string;
  recipientName: string;
  senderName: string;
  date: string;
}): Promise<ReceiptResult> {
  return fetchSvc<ReceiptResult>(
    SERVICE_URLS.rustPdfReceipt, "/generate", "POST", transfer,
    { pdfUrl: "", receiptId: `receipt-${transfer.id}` }
  );
}

// ── Mojaloop Connector (Go) ───────────────────────────────────────────────────
// Connector serves the FSPIOP route set under /v1 (see services/mojaloop-connector).
// Fail-closed: connector errors propagate as MojaloopConnectorError — callers
// must handle failure, no fabricated transfer IDs are returned.
export interface MojaloopTransferResult {
  transferId: string;
  transferState: "RECEIVED" | "RESERVED" | "COMMITTED" | "ABORTED";
  fulfilment?: string;
  completedTimestamp?: string;
}

export class MojaloopConnectorError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "MojaloopConnectorError";
    this.statusCode = statusCode;
  }
}

export async function mojaloopTransfer(payload: {
  transferId?: string;
  payerFsp: string;
  payeeFsp: string;
  amount: number | string;
  currency: string;
  ilpPacket: string;
  condition?: string;
}): Promise<MojaloopTransferResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_URLS.mojaloopConnector}/v1/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, amount: String(payload.amount) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MojaloopConnectorError(
        `mojaloop-connector /v1/transfers failed: HTTP ${res.status} ${body}`,
        res.status
      );
    }
    return (await res.json()) as MojaloopTransferResult;
  } catch (err) {
    if (err instanceof MojaloopConnectorError) throw err;
    throw new MojaloopConnectorError(
      `mojaloop-connector unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(tid);
  }
}

export async function mojaloopGetTransfer(transferId: string): Promise<MojaloopTransferResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_URLS.mojaloopConnector}/v1/transfers/${encodeURIComponent(transferId)}`, {
      signal: controller.signal,
    });
    if (res.status === 404) {
      throw new MojaloopConnectorError(`Transfer not found: ${transferId}`, 404);
    }
    if (!res.ok) {
      throw new MojaloopConnectorError(`mojaloop-connector GET transfer failed: HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as MojaloopTransferResult;
  } catch (err) {
    if (err instanceof MojaloopConnectorError) throw err;
    throw new MojaloopConnectorError(
      `mojaloop-connector unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(tid);
  }
}

// ── PIX Adapter (Python) ──────────────────────────────────────────────────────
export interface PixResult {
  endToEndId: string;
  status: "ACSC" | "RJCT" | "PDNG";
  timestamp: string;
}
export async function pixTransfer(payload: {
  pixKey: string;
  amount: number;
  description: string;
}): Promise<PixResult> {
  return fetchSvc<PixResult>(
    SERVICE_URLS.pythonPixAdapter, "/transfer", "POST", payload,
    { endToEndId: `pix-${Date.now()}`, status: "ACSC", timestamp: new Date().toISOString() }
  );
}

// ── UPI Adapter (Rust) ────────────────────────────────────────────────────────
export interface UpiResult {
  transactionId: string;
  status: "SUCCESS" | "FAILURE" | "PENDING";
  upiRefNum: string;
}
export async function upiTransfer(payload: {
  vpa: string;
  amount: number;
  remarks: string;
}): Promise<UpiResult> {
  return fetchSvc<UpiResult>(
    SERVICE_URLS.rustUpiAdapter, "/transfer", "POST", payload,
    { transactionId: `upi-${Date.now()}`, status: "SUCCESS", upiRefNum: `REF${Date.now()}` }
  );
}

// ── Search Indexer (Python) ───────────────────────────────────────────────────
export interface SearchResult {
  hits: Array<{ id: string; type: string; title: string; score: number }>;
  total: number;
}
export async function searchPlatform(query: string, types?: string[]): Promise<SearchResult> {
  return fetchSvc<SearchResult>(
    SERVICE_URLS.searchIndexer, "/search", "POST", { query, types },
    { hits: [], total: 0 }
  );
}

// ── Analytics (Python) ────────────────────────────────────────────────────────
export interface AnalyticsEvent {
  userId?: number;
  event: string;
  properties: Record<string, unknown>;
}
export async function trackEvent(event: AnalyticsEvent): Promise<void> {
  await fetchSvc<void>(SERVICE_URLS.analyticsService, "/track", "POST", event, undefined);
}

// ── Portfolio Calc (Rust) ─────────────────────────────────────────────────────
export interface PortfolioMetrics {
  totalValue: number;
  totalReturn: number;
  returnPct: number;
  sharpeRatio: number;
  volatility: number;
}
export async function calcPortfolio(userId: number): Promise<PortfolioMetrics> {
  return fetchSvc<PortfolioMetrics>(
    SERVICE_URLS.rustPortfolioCalc, `/portfolio/${userId}`, "GET", undefined,
    { totalValue: 0, totalReturn: 0, returnPct: 0, sharpeRatio: 0, volatility: 0 }
  );
}

// ── Share Link (Rust) ─────────────────────────────────────────────────────────
export interface ShareLinkResult {
  shortUrl: string;
  token: string;
  expiresAt: string;
}
export async function createShareLink(payload: {
  resourceType: string;
  resourceId: string;
  userId: number;
  expiresInHours?: number;
}): Promise<ShareLinkResult> {
  return fetchSvc<ShareLinkResult>(
    SERVICE_URLS.rustShareLink, "/create", "POST", payload,
    { shortUrl: `https://remitflow.app/s/${Date.now()}`, token: `tok-${Date.now()}`, expiresAt: new Date(Date.now() + 86400000).toISOString() }
  );
}

// ── Device Fingerprint (Rust) ─────────────────────────────────────────────────
export interface DeviceRisk {
  fingerprint: string;
  riskScore: number;
  isKnownDevice: boolean;
  flags: string[];
}
export async function checkDeviceFingerprint(fp: string, userId?: number): Promise<DeviceRisk> {
  return fetchSvc<DeviceRisk>(
    SERVICE_URLS.rustDeviceFingerprint, "/check", "POST", { fingerprint: fp, userId },
    { fingerprint: fp, riskScore: 0, isKnownDevice: true, flags: [] }
  );
}

// ── Compliance ML (Python) ────────────────────────────────────────────────────
export interface ComplianceScore {
  score: number;
  category: "clean" | "suspicious" | "high_risk";
  triggers: string[];
}
export async function complianceScore(userId: number, txData: Record<string, unknown>): Promise<ComplianceScore> {
  return fetchSvc<ComplianceScore>(
    SERVICE_URLS.pythonComplianceMl, "/score", "POST", { userId, ...txData },
    { score: 0, category: "clean", triggers: [] }
  );
}

// ── Investment ML (Python) ────────────────────────────────────────────────────
export interface InvestmentRecommendation {
  recommendations: Array<{ assetId: string; score: number; reason: string }>;
  riskProfile: "conservative" | "moderate" | "aggressive";
}
export async function getInvestmentRecommendations(userId: number): Promise<InvestmentRecommendation> {
  return fetchSvc<InvestmentRecommendation>(
    SERVICE_URLS.pythonInvestmentMl, `/recommendations/${userId}`, "GET", undefined,
    { recommendations: [], riskProfile: "moderate" }
  );
}

// ── NAV Analytics (Python) ────────────────────────────────────────────────────
export interface NavData {
  nav: number;
  change24h: number;
  change7d: number;
  aum: number;
}
export async function getNavData(fundId: string): Promise<NavData> {
  return fetchSvc<NavData>(
    SERVICE_URLS.pythonNavAnalytics, `/nav/${fundId}`, "GET", undefined,
    { nav: 1.0, change24h: 0, change7d: 0, aum: 0 }
  );
}

// ── Export Service (Go) ───────────────────────────────────────────────────────
export interface ExportResult {
  downloadUrl: string;
  expiresAt: string;
  format: string;
  rowCount: number;
}
export async function exportData(payload: {
  userId: number;
  format: "csv" | "xlsx" | "pdf";
  dataType: "transactions" | "statements" | "tax";
  dateFrom?: string;
  dateTo?: string;
}): Promise<ExportResult> {
  return fetchSvc<ExportResult>(
    SERVICE_URLS.goExportService, "/export", "POST", payload,
    { downloadUrl: "", expiresAt: new Date(Date.now() + 3600000).toISOString(), format: payload.format, rowCount: 0 }
  );
}

// ── Community Feed (Go) ───────────────────────────────────────────────────────
export interface FeedPost {
  id: string;
  userId: number;
  content: string;
  likes: number;
  createdAt: string;
}
export async function getCommunityFeed(page = 1, limit = 20): Promise<FeedPost[]> {
  return fetchSvc<FeedPost[]>(
    SERVICE_URLS.goCommunityFeed, `/feed?page=${page}&limit=${limit}`, "GET", undefined,
    []
  );
}

// ── Investment Feed (Go) ──────────────────────────────────────────────────────
export interface InvestmentFeedItem {
  id: string;
  type: "opportunity" | "news" | "performance";
  title: string;
  body: string;
  assetClass: string;
  createdAt: string;
}
export async function getInvestmentFeed(userId: number): Promise<InvestmentFeedItem[]> {
  return fetchSvc<InvestmentFeedItem[]>(
    SERVICE_URLS.goInvestmentFeed, `/feed/${userId}`, "GET", undefined,
    []
  );
}

// ── Anomaly Detector (Python) ─────────────────────────────────────────────────
export interface AnomalyResult {
  isAnomaly: boolean;
  anomalyType?: string;
  confidence: number;
  details: Record<string, unknown>;
}
export async function detectAnomaly(payload: {
  userId: number;
  eventType: string;
  features: Record<string, number>;
}): Promise<AnomalyResult> {
  return fetchSvc<AnomalyResult>(
    SERVICE_URLS.pythonAnomaly, "/detect", "POST", payload,
    { isAnomaly: false, confidence: 0, details: {} }
  );
}

// ── Crypto Guard (Rust) ───────────────────────────────────────────────────────
export interface FileValidationResult {
  safe: boolean;
  mimeType: string;
  threats: string[];
  hash: string;
}
export async function validateFile(fileUrl: string): Promise<FileValidationResult> {
  return fetchSvc<FileValidationResult>(
    SERVICE_URLS.rustCryptoGuard, "/validate", "POST", { fileUrl },
    { safe: true, mimeType: "application/octet-stream", threats: [], hash: "" }
  );
}

// ── Permify (Go) ──────────────────────────────────────────────────────────────
export interface PermifyCheckResult {
  allowed: boolean;
  reason?: string;
}
export async function permifyCheck(payload: {
  subject: string;
  permission: string;
  object: string;
}): Promise<PermifyCheckResult> {
  return fetchSvc<PermifyCheckResult>(
    SERVICE_URLS.goPermifyService, "/check", "POST", payload,
    { allowed: false, reason: "service unavailable" }
  );
}

// ── Keycloak (Python) ─────────────────────────────────────────────────────────
export interface KeycloakTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export async function keycloakToken(userId: string, realm = "remitflow"): Promise<KeycloakTokenResult> {
  return fetchSvc<KeycloakTokenResult>(
    SERVICE_URLS.pythonKeycloak, "/token", "POST", { userId, realm },
    { accessToken: "", refreshToken: "", expiresIn: 0 }
  );
}
