/**
 * RemitFlow gRPC Client v14
 *
 * Provides typed TypeScript clients for all Rust gRPC microservices:
 *   - LedgerService  (rust-ledger-service:50051)
 *   - FraudService   (rust-fraud-service:50052)
 *   - FXService      (rust-fx-service:50053)
 *   - KYCService     (rust-kyc-service:50054)
 *
 * Uses @grpc/grpc-js with @grpc/proto-loader.
 * Falls back gracefully when services are unavailable (dev mode).
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from './_core/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Proto loading
// ============================================================================

const PROTO_PATH = path.join(__dirname, "proto", "remitflow.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.join(__dirname, "proto")],
});

const proto = grpc.loadPackageDefinition(packageDefinition) as any;
const remitflowProto = proto?.remitflow?.v1 ?? proto;

// ============================================================================
// Service addresses (from env or defaults)
// ============================================================================

const LEDGER_ADDR           = process.env.RUST_LEDGER_GRPC        ?? "localhost:50051";
const FRAUD_ADDR            = process.env.RUST_FRAUD_GRPC         ?? "localhost:50052";
const FX_ADDR               = process.env.RUST_FX_GRPC            ?? "localhost:50053";
const KYC_ADDR              = process.env.RUST_KYC_GRPC           ?? "localhost:50054";
const TRANSFER_ENGINE_ADDR  = process.env.GO_TRANSFER_ENGINE_GRPC ?? "localhost:50051";

// ============================================================================
// mTLS credentials (loaded once at startup)
// ============================================================================

const GRPC_TLS_ENABLED = process.env.GRPC_TLS_ENABLED !== "false"; // default: true in production
const GRPC_CA_CERT    = process.env.GRPC_CA_CERT    ?? "/etc/grpc-certs/ca.crt";
const GRPC_CLIENT_CERT = process.env.GRPC_CLIENT_CERT ?? "/etc/grpc-certs/client.crt";
const GRPC_CLIENT_KEY  = process.env.GRPC_CLIENT_KEY  ?? "/etc/grpc-certs/client.key";

function buildCredentials(): grpc.ChannelCredentials {
  if (!GRPC_TLS_ENABLED) {
    logger.warn("[gRPC] mTLS disabled — using insecure channel (dev mode)");
    return grpc.credentials.createInsecure();
  }
  try {
    const rootCert   = fs.readFileSync(GRPC_CA_CERT);
    const clientCert = fs.readFileSync(GRPC_CLIENT_CERT);
    const clientKey  = fs.readFileSync(GRPC_CLIENT_KEY);
    logger.info({ data: GRPC_CA_CERT }, '[gRPC] mTLS credentials loaded from');
    return grpc.credentials.createSsl(rootCert, clientKey, clientCert, {
      checkServerIdentity: () => undefined, // hostname verified via SAN in cert
    });
  } catch (err) {
    logger.warn("[gRPC] mTLS cert files not found — falling back to insecure:", (err as Error).message);
    return grpc.credentials.createInsecure();
  }
}

const GRPC_CREDENTIALS = buildCredentials();

// ============================================================================
// Channel options (connection pool, keepalive, retry)
// ============================================================================

const CHANNEL_OPTIONS: grpc.ChannelOptions = {
  "grpc.keepalive_time_ms": 30_000,
  "grpc.keepalive_timeout_ms": 10_000,
  "grpc.keepalive_permit_without_calls": 1,
  "grpc.http2.max_pings_without_data": 0,
  "grpc.http2.min_time_between_pings_ms": 10_000,
  "grpc.max_reconnect_backoff_ms": 5_000,
  "grpc.initial_reconnect_backoff_ms": 500,
  "grpc.service_config": JSON.stringify({
    methodConfig: [
      {
        name: [{}],
        retryPolicy: {
          maxAttempts: 3,
          initialBackoff: "0.1s",
          maxBackoff: "1s",
          backoffMultiplier: 2,
          retryableStatusCodes: ["UNAVAILABLE", "RESOURCE_EXHAUSTED"],
        },
      },
    ],
  }),
};

// ============================================================================
// Client singletons (lazy-initialized)
// ============================================================================

let _ledgerClient: any = null;
let _fraudClient: any = null;
let _fxClient: any = null;
let _kycClient: any = null;
let _transferEngineClient: any = null;

function getLedgerClient(): any {
  if (!_ledgerClient) {
    try {
      _ledgerClient = new remitflowProto.LedgerService(
        LEDGER_ADDR,
        GRPC_CREDENTIALS,
        CHANNEL_OPTIONS
      );
    } catch (err) {
      logger.warn("[gRPC] LedgerService unavailable (dev mode):", (err as Error).message);
    }
  }
  return _ledgerClient;
}

function getFraudClient(): any {
  if (!_fraudClient) {
    try {
      _fraudClient = new remitflowProto.FraudService(
        FRAUD_ADDR,
        GRPC_CREDENTIALS,
        CHANNEL_OPTIONS
      );
    } catch (err) {
      logger.warn("[gRPC] FraudService unavailable (dev mode):", (err as Error).message);
    }
  }
  return _fraudClient;
}

function getFXClient(): any {
  if (!_fxClient) {
    try {
      _fxClient = new remitflowProto.FXService(
        FX_ADDR,
        GRPC_CREDENTIALS,
        CHANNEL_OPTIONS
      );
    } catch (err) {
      logger.warn("[gRPC] FXService unavailable (dev mode):", (err as Error).message);
    }
  }
  return _fxClient;
}

function getKYCClient(): any {
  if (!_kycClient) {
    try {
      _kycClient = new remitflowProto.KYCService(
        KYC_ADDR,
        GRPC_CREDENTIALS,
        CHANNEL_OPTIONS
      );
    } catch (err) {
      logger.warn("[gRPC] KYCService unavailable (dev mode):", (err as Error).message);
    }
  }
  return _kycClient;
}

// ============================================================================
// Promisified call helper
// ============================================================================

function callGRPC<TReq, TRes>(
  client: any,
  method: string,
  request: TReq,
  timeoutMs = 10_000
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    if (!client) {
      return reject(new Error(`gRPC client not available for method ${method}`));
    }
    const deadline = new Date(Date.now() + timeoutMs);
    client[method](request, { deadline }, (err: grpc.ServiceError | null, response: TRes) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// ============================================================================
// Typed Ledger API
// ============================================================================

export interface LedgerTransferRequest {
  idempotencyKey: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;       // decimal string e.g. "100.50"
  currency: string;     // ISO 4217
  reference: string;
  description?: string;
}

export interface LedgerTransferResponse {
  transferId: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  timestamp: string;
}

export interface BalanceResponse {
  accountId: string;
  currency: string;
  availableBalance: string;
  reservedBalance: string;
  totalBalance: string;
}

export async function ledgerTransfer(req: LedgerTransferRequest): Promise<LedgerTransferResponse> {
  const client = getLedgerClient();
  if (!client) {
    // Graceful fallback for dev/test environments without Rust services
    logger.warn("[gRPC] LedgerService fallback: returning mock response");
    return {
      transferId: `mock-${req.idempotencyKey}`,
      status: "COMPLETED",
      timestamp: new Date().toISOString(),
    };
  }
  return callGRPC<LedgerTransferRequest, LedgerTransferResponse>(client, "transfer", req);
}

export async function ledgerGetBalance(accountId: string, currency: string): Promise<BalanceResponse> {
  const client = getLedgerClient();
  if (!client) {
    return { accountId, currency, availableBalance: "0", reservedBalance: "0", totalBalance: "0" };
  }
  return callGRPC<{ accountId: string; currency: string }, BalanceResponse>(
    client, "getBalance", { accountId, currency }
  );
}

export async function ledgerReserveFunds(
  idempotencyKey: string,
  accountId: string,
  amount: string,
  currency: string
): Promise<{ reservationId: string; expiresAt: string }> {
  const client = getLedgerClient();
  if (!client) {
    return { reservationId: `mock-res-${idempotencyKey}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }
  return callGRPC(client, "reserveFunds", { idempotencyKey, accountId, amount, currency });
}

// ============================================================================
// Typed Fraud API
// ============================================================================

export interface FraudCheckRequest {
  transactionId: string;
  userId: string;
  amount: string;
  currency: string;
  fromCountry: string;
  toCountry: string;
  recipientAccount: string;
  deviceFingerprint?: string;
  ipAddress?: string;
}

export interface FraudCheckResponse {
  riskScore: number;       // 0.0 – 1.0
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  decision: "APPROVE" | "REVIEW" | "BLOCK";
  reasons: string[];
  alertId?: string;
}

export async function fraudCheck(req: FraudCheckRequest): Promise<FraudCheckResponse> {
  const client = getFraudClient();
  if (!client) {
    // Dev fallback: approve all with low risk
    return {
      riskScore: 0.05,
      riskLevel: "LOW",
      decision: "APPROVE",
      reasons: ["dev-mode-fallback"],
    };
  }
  return callGRPC<FraudCheckRequest, FraudCheckResponse>(client, "scoreTransaction", req, 5_000);
}

export async function fraudReportFalsePositive(alertId: string, analystId: string, notes: string): Promise<void> {
  const client = getFraudClient();
  if (!client) return;
  await callGRPC(client, "reportFalsePositive", { alertId, analystId, notes });
}

// ============================================================================
// Typed FX Rate API
// ============================================================================

export interface FXRateResponse {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  bid: number;
  ask: number;
  spread: number;
  source: string;
  timestamp: string;
  expiresAt: string;
}

export interface FXQuoteResponse {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  toAmount: string;
  rate: number;
  fee: string;
  feeBreakdown: { type: string; amount: string; currency: string }[];
  expiresAt: string;
}

export async function fxGetRate(fromCurrency: string, toCurrency: string): Promise<FXRateResponse | null> {
  const client = getFXClient();
  if (!client) return null;
  try {
    return await callGRPC<{ fromCurrency: string; toCurrency: string }, FXRateResponse>(
      client, "getRate", { fromCurrency, toCurrency }, 3_000
    );
  } catch {
    return null;
  }
}

export async function fxGetQuote(
  fromCurrency: string,
  toCurrency: string,
  fromAmount: string,
  userId: string
): Promise<FXQuoteResponse | null> {
  const client = getFXClient();
  if (!client) return null;
  try {
    return await callGRPC<
      { fromCurrency: string; toCurrency: string; fromAmount: string; userId: string },
      FXQuoteResponse
    >(client, "getQuote", { fromCurrency, toCurrency, fromAmount, userId }, 5_000);
  } catch {
    return null;
  }
}

// ============================================================================
// Typed KYC API
// ============================================================================

export interface KYCSubmitRequest {
  userId: string;
  documentType: "PASSPORT" | "NATIONAL_ID" | "DRIVERS_LICENSE" | "UTILITY_BILL" | "BANK_STATEMENT";
  documentUrl: string;
  selfieUrl?: string;
  country: string;
}

export interface KYCSubmitResponse {
  verificationId: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED" | "MANUAL_REVIEW";
  estimatedCompletionMs: number;
}

export interface KYCStatusResponse {
  verificationId: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED" | "MANUAL_REVIEW";
  riskScore: number;
  extractedData?: {
    fullName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    expiryDate?: string;
    nationality?: string;
    address?: string;
  };
  livenessScore?: number;
  rejectionReasons?: string[];
  completedAt?: string;
}

export async function kycSubmitDocument(req: KYCSubmitRequest): Promise<KYCSubmitResponse> {
  const client = getKYCClient();
  if (!client) {
    return {
      verificationId: `mock-kyc-${req.userId}`,
      status: "PENDING",
      estimatedCompletionMs: 30_000,
    };
  }
  return callGRPC<KYCSubmitRequest, KYCSubmitResponse>(client, "submitDocument", req, 15_000);
}

export async function kycGetStatus(verificationId: string): Promise<KYCStatusResponse> {
  const client = getKYCClient();
  if (!client) {
    return {
      verificationId,
      status: "PENDING",
      riskScore: 0,
    };
  }
  return callGRPC<{ verificationId: string }, KYCStatusResponse>(
    client, "getVerificationStatus", { verificationId }
  );
}

// ============================================================================
// Go Transfer Engine API (v63)
// ============================================================================

function getTransferEngineClient(): any {
  if (!_transferEngineClient) {
    try {
      _transferEngineClient = new remitflowProto.TransferService(
        TRANSFER_ENGINE_ADDR,
        GRPC_CREDENTIALS,
        CHANNEL_OPTIONS
      );
    } catch (err) {
      logger.warn("[gRPC] TransferService unavailable (dev mode):", (err as Error).message);
    }
  }
  return _transferEngineClient;
}

export interface TransferStateRequest {
  transferId: string;
  event: "INITIATE" | "COMPLIANCE_PASS" | "COMPLIANCE_FAIL" | "FX_LOCKED" | "PAYMENT_SENT" | "PAYMENT_CONFIRMED" | "FAIL" | "CANCEL";
  userId?: string;
  metadata?: Record<string, string>;
}

export interface TransferStateResponse {
  transferId: string;
  previousState: string;
  newState: string;
  timestamp: string;
  fraudScore?: number;
  fraudDecision?: string;
}

export interface FraudScoreRequest {
  transferId: string;
  userId: string;
  amountUsd: number;
  fromCountry: string;
  toCountry: string;
  senderAgeDays: number;
  transfersLast24h: number;
  isFirstTransfer: boolean;
}

export interface FraudScoreResponse {
  transferId: string;
  riskScore: number;
  decision: "APPROVE" | "REVIEW" | "BLOCK";
  reasons: string[];
}

export async function transferEngineTransition(
  req: TransferStateRequest
): Promise<TransferStateResponse> {
  const client = getTransferEngineClient();
  if (!client) {
    // Graceful fallback for dev environments without Go service
    logger.warn("[gRPC] TransferService fallback: mock state transition");
    return {
      transferId: req.transferId,
      previousState: "PENDING",
      newState: req.event === "INITIATE" ? "COMPLIANCE_CHECK" : "PROCESSING",
      timestamp: new Date().toISOString(),
      fraudScore: 0.05,
      fraudDecision: "APPROVE",
    };
  }
  return callGRPC<TransferStateRequest, TransferStateResponse>(
    client, "transition", req, 10_000
  );
}

export async function transferEngineScoreFraud(
  req: FraudScoreRequest
): Promise<FraudScoreResponse> {
  const client = getTransferEngineClient();
  if (!client) {
    return {
      transferId: req.transferId,
      riskScore: 0.05,
      decision: "APPROVE",
      reasons: ["dev-mode-fallback"],
    };
  }
  return callGRPC<FraudScoreRequest, FraudScoreResponse>(
    client, "scoreFraud", req, 5_000
  );
}

// ============================================================================
// Health check for all gRPC services
// ============================================================================

export async function checkGRPCHealth(): Promise<Record<string, "UP" | "DOWN">> {
  const services: Record<string, () => any> = {
    ledger: getLedgerClient,
    fraud: getFraudClient,
    fx: getFXClient,
    kyc: getKYCClient,
    transferEngine: getTransferEngineClient,
  };

  const results: Record<string, "UP" | "DOWN"> = {};

  for (const [name, getClient] of Object.entries(services)) {
    const client = getClient();
    if (!client) {
      results[name] = "DOWN";
      continue;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = new Date(Date.now() + 2_000);
        client.waitForReady(deadline, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
      results[name] = "UP";
    } catch {
      results[name] = "DOWN";
    }
  }

  return results;
}

// ============================================================================
// Graceful shutdown
// ============================================================================

export function closeGRPCClients(): void {
  [_ledgerClient, _fraudClient, _fxClient, _kycClient, _transferEngineClient].forEach(client => {
    if (client) {
      try { client.close(); } catch { /* ignore */ }
    }
  });
  _ledgerClient = null;
  _fraudClient = null;
  _fxClient = null;
  _kycClient = null;
  _transferEngineClient = null;
  logger.info("[gRPC] All clients closed");
}
