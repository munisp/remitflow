/**
 * RemitFlow — Integration Module Index
 * ──────────────────────────────────────
 * Central export point for all 12 infrastructure integrations.
 *
 * Usage:
 *   import { orchestrateTransfer, getPlatformHealth, daprPublish, fluvioStream } from "@/server/integrations";
 */

// ─── Orchestrator ─────────────────────────────────────────────────────────────
export { orchestrateTransfer, orchestrateKycVerification, provisionNewUser } from "./orchestrator";

// ─── Health ───────────────────────────────────────────────────────────────────
export { getPlatformHealth } from "./health";
export type { PlatformHealth, IntegrationHealth, IntegrationStatus } from "./health";

// ─── Keycloak ─────────────────────────────────────────────────────────────────
export { syncKeycloakSession, revokeKeycloakSession } from "./keycloak/session";

// ─── TigerBeetle ─────────────────────────────────────────────────────────────
export { reconcileTigerBeetleAccounts } from "./tigerbeetle/reconciliation";

// ─── APISIX ──────────────────────────────────────────────────────────────────
export { syncApisixRoute } from "./apisix/routes";

// ─── Permify ─────────────────────────────────────────────────────────────────
export { auditPermifyPolicy } from "./permify/audit";

// ─── Dapr ────────────────────────────────────────────────────────────────────
export { daprPublish, daprSetState, daprGetState, daprDeleteState } from "./dapr/pubsub";
export type { TransferInitiatedEvent, TransferCompletedEvent, TransferFailedEvent, KycVerificationEvent, KycApprovedEvent, UserProvisionedEvent, FraudAlertEvent, FxRateUpdatedEvent } from "./dapr/pubsub";

// ─── Fluvio ──────────────────────────────────────────────────────────────────
export { fluvioStream, fluvioProduce, updateFluvioOffset, getFluvioOffset, FLUVIO_TOPICS } from "./fluvio/streaming";
export type { FluvioTopic, FluvioTransferEvent, FluvioKycEvent, FluvioFraudEvent, FluvioAuditEvent, FluvioFxEvent } from "./fluvio/streaming";

// ─── Lakehouse ───────────────────────────────────────────────────────────────
export { syncAllTables, syncComplianceReport } from "./lakehouse/sync";
export type { SyncResult } from "./lakehouse/sync";

// ─── OpenAppSec ──────────────────────────────────────────────────────────────
// The fabricated OpenAppSec WAF proxy (openappsec/waf.ts) was removed (audit OA2).
// The only honest WAF surface is server/security.openappsec.ts, which is a no-op
// unless OPENAPPSEC_SIDECAR_URL points to a sidecar implementing the documented
// /v1/inspect contract.

// ─── Redis ───────────────────────────────────────────────────────────────────
export { remitflowCache, cacheGet, cacheSet, cacheDel, cacheAside, incrementRateLimit, CACHE_KEYS, CACHE_TTL } from "./redis/cache";
