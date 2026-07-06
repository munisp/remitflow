/**
 * complianceAuditTrail.ts — Immutable Compliance Event Log
 *
 * Provides a tamper-evident audit trail for all compliance-relevant events:
 *   - KYC verification decisions
 *   - Sanctions screening results
 *   - Travel Rule messages sent/received
 *   - SAR/STR/CTR filings
 *   - Data subject requests
 *   - User tier changes
 *   - Transaction approvals/blocks
 *
 * Properties:
 *   - Append-only (no update/delete)
 *   - SHA-256 chain (each entry references previous hash)
 *   - Exportable in regulator-specific formats (CSV, XML, JSON)
 *   - Searchable by user, date range, event type, jurisdiction
 *
 * Storage: PostgreSQL (via persistFeatureRecord) + Kafka (real-time streaming)
 */

import { createHash, randomBytes } from "crypto";
import { logger } from "../_core/logger";
import { persistFeatureRecord, emitFeatureEvent } from "../_core/featurePersistence";

// ── Types ───────────────────────────────────────────────────────────────────

export type AuditEventType =
  | "kyc.verification.initiated"
  | "kyc.verification.completed"
  | "kyc.verification.failed"
  | "kyc.tier.upgraded"
  | "kyc.tier.downgraded"
  | "kyc.document.submitted"
  | "kyc.rekyc.triggered"
  | "sanctions.screening.passed"
  | "sanctions.screening.blocked"
  | "sanctions.screening.review"
  | "sanctions.pep.matched"
  | "travel_rule.submitted"
  | "travel_rule.acknowledged"
  | "travel_rule.declined"
  | "travel_rule.threshold.exceeded"
  | "regulatory.sar.filed"
  | "regulatory.ctr.filed"
  | "regulatory.str.filed"
  | "regulatory.report.acknowledged"
  | "transaction.approved"
  | "transaction.blocked"
  | "transaction.review_required"
  | "transaction.limit.exceeded"
  | "dsar.received"
  | "dsar.completed"
  | "dsar.rejected"
  | "account.frozen"
  | "account.unfrozen"
  | "account.closed"
  | "compliance.alert.triggered"
  | "compliance.alert.resolved";

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  userId?: number;
  actorId: string;             // Who performed the action (system, compliance officer, etc.)
  actorType: "system" | "user" | "compliance_officer" | "regulator" | "automated";
  jurisdiction?: string;
  details: Record<string, unknown>;
  metadata: {
    ip?: string;
    userAgent?: string;
    sessionId?: string;
    correlationId?: string;    // Links related events together
  };
  chainHash: string;           // SHA-256(previous.chainHash + this event data)
  previousHash: string;
}

export interface AuditQuery {
  userId?: number;
  eventTypes?: AuditEventType[];
  jurisdiction?: string;
  dateFrom?: string;
  dateTo?: string;
  actorId?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditExport {
  format: "json" | "csv" | "xml";
  events: AuditEvent[];
  exportedAt: string;
  exportedBy: string;
  jurisdiction: string;
  dateRange: { from: string; to: string };
  totalCount: number;
  checksum: string;            // SHA-256 of all event IDs for integrity verification
}

// ── State ───────────────────────────────────────────────────────────────────

let lastHash = "genesis-000000000000000000000000000000000000000000000000000000000000";

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Record an immutable compliance audit event.
 * Persists to PostgreSQL and emits to Kafka for real-time streaming.
 */
export async function recordAuditEvent(params: {
  type: AuditEventType;
  userId?: number;
  actorId: string;
  actorType: AuditEvent["actorType"];
  jurisdiction?: string;
  details: Record<string, unknown>;
  metadata?: AuditEvent["metadata"];
  correlationId?: string;
}): Promise<AuditEvent> {
  const id = `audit-${randomBytes(12).toString("hex")}`;
  const timestamp = new Date().toISOString();

  // Compute chain hash (tamper-evident)
  const hashInput = `${lastHash}|${id}|${timestamp}|${params.type}|${JSON.stringify(params.details)}`;
  const chainHash = createHash("sha256").update(hashInput).digest("hex");

  const event: AuditEvent = {
    id,
    timestamp,
    type: params.type,
    userId: params.userId,
    actorId: params.actorId,
    actorType: params.actorType,
    jurisdiction: params.jurisdiction,
    details: params.details,
    metadata: {
      ...params.metadata,
      correlationId: params.correlationId || params.metadata?.correlationId,
    },
    chainHash,
    previousHash: lastHash,
  };

  // Update chain
  lastHash = chainHash;

  // Persist to PostgreSQL (immutable — no ON CONFLICT UPDATE)
  await persistFeatureRecord("compliance_audit_log", id, {
    id,
    timestamp,
    eventType: params.type,
    userId: params.userId || 0,
    actorId: params.actorId,
    actorType: params.actorType,
    jurisdiction: params.jurisdiction || "",
    details: JSON.stringify(params.details),
    correlationId: params.correlationId || "",
    chainHash,
    previousHash: event.previousHash,
    createdAt: timestamp,
  });

  // Emit to Kafka for real-time streaming
  emitFeatureEvent("compliance.audit", id, {
    event: params.type,
    ...event,
  });

  logger.debug({ eventId: id, type: params.type, userId: params.userId }, "Compliance audit event recorded");

  return event;
}

/**
 * Record a KYC verification completion event.
 */
export async function auditKYCVerification(params: {
  userId: number;
  provider: string;
  checkId: string;
  result: "approved" | "declined" | "needs_review";
  tier: number;
  jurisdiction: string;
  correlationId?: string;
}): Promise<AuditEvent> {
  const type: AuditEventType = params.result === "approved"
    ? "kyc.verification.completed"
    : params.result === "declined"
      ? "kyc.verification.failed"
      : "kyc.verification.initiated";

  return recordAuditEvent({
    type,
    userId: params.userId,
    actorId: "system",
    actorType: "automated",
    jurisdiction: params.jurisdiction,
    details: {
      provider: params.provider,
      checkId: params.checkId,
      result: params.result,
      kycTier: params.tier,
    },
    correlationId: params.correlationId,
  });
}

/**
 * Record a sanctions screening event.
 */
export async function auditSanctionsScreening(params: {
  userId: number;
  name: string;
  result: "passed" | "blocked" | "review";
  matchScore: number;
  lists: string[];
  jurisdiction: string;
  transactionId?: string;
}): Promise<AuditEvent> {
  const type: AuditEventType = params.result === "passed"
    ? "sanctions.screening.passed"
    : params.result === "blocked"
      ? "sanctions.screening.blocked"
      : "sanctions.screening.review";

  return recordAuditEvent({
    type,
    userId: params.userId,
    actorId: "system",
    actorType: "automated",
    jurisdiction: params.jurisdiction,
    details: {
      screenedName: params.name,
      matchScore: params.matchScore,
      matchedLists: params.lists,
      transactionId: params.transactionId,
    },
  });
}

/**
 * Record a transaction decision event.
 */
export async function auditTransactionDecision(params: {
  userId: number;
  transactionId: string;
  decision: "approved" | "blocked" | "review_required";
  amount: number;
  currency: string;
  reasons: string[];
  jurisdiction: string;
}): Promise<AuditEvent> {
  const type: AuditEventType = params.decision === "approved"
    ? "transaction.approved"
    : params.decision === "blocked"
      ? "transaction.blocked"
      : "transaction.review_required";

  return recordAuditEvent({
    type,
    userId: params.userId,
    actorId: "system",
    actorType: "automated",
    jurisdiction: params.jurisdiction,
    details: {
      transactionId: params.transactionId,
      amount: params.amount,
      currency: params.currency,
      reasons: params.reasons,
    },
  });
}

/**
 * Record a regulatory report filing event.
 */
export async function auditRegulatoryFiling(params: {
  userId: number;
  reportId: string;
  reportType: "SAR" | "STR" | "CTR" | "LCTR";
  jurisdiction: string;
  filingReference?: string;
  filedBy: string;
}): Promise<AuditEvent> {
  const type: AuditEventType = params.reportType === "CTR" || params.reportType === "LCTR"
    ? "regulatory.ctr.filed"
    : params.reportType === "SAR"
      ? "regulatory.sar.filed"
      : "regulatory.str.filed";

  return recordAuditEvent({
    type,
    userId: params.userId,
    actorId: params.filedBy,
    actorType: "compliance_officer",
    jurisdiction: params.jurisdiction,
    details: {
      reportId: params.reportId,
      reportType: params.reportType,
      filingReference: params.filingReference,
    },
  });
}

// ── Export Functions ─────────────────────────────────────────────────────────

/**
 * Generate a compliance audit export for regulators.
 * Format varies by jurisdiction:
 *   - FINTRAC: XML (SWIFT-style)
 *   - FinCEN: JSON (BSA E-Filing)
 *   - FCA: CSV
 *   - NFIU: JSON
 */
export function generateAuditExport(params: {
  events: AuditEvent[];
  format: "json" | "csv" | "xml";
  jurisdiction: string;
  exportedBy: string;
  dateRange: { from: string; to: string };
}): AuditExport {
  const checksum = createHash("sha256")
    .update(params.events.map(e => e.id).join("|"))
    .digest("hex");

  return {
    format: params.format,
    events: params.events,
    exportedAt: new Date().toISOString(),
    exportedBy: params.exportedBy,
    jurisdiction: params.jurisdiction,
    dateRange: params.dateRange,
    totalCount: params.events.length,
    checksum,
  };
}

/**
 * Verify audit chain integrity.
 * Returns the first broken link if chain is tampered.
 */
export function verifyChainIntegrity(events: AuditEvent[]): {
  valid: boolean;
  brokenAt?: string;
  verifiedCount: number;
} {
  let previousHash = "genesis-000000000000000000000000000000000000000000000000000000000000";

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Verify previous hash link
    if (event.previousHash !== previousHash) {
      return { valid: false, brokenAt: event.id, verifiedCount: i };
    }

    // Verify current hash
    const hashInput = `${previousHash}|${event.id}|${event.timestamp}|${event.type}|${JSON.stringify(event.details)}`;
    const expectedHash = createHash("sha256").update(hashInput).digest("hex");

    if (event.chainHash !== expectedHash) {
      return { valid: false, brokenAt: event.id, verifiedCount: i };
    }

    previousHash = event.chainHash;
  }

  return { valid: true, verifiedCount: events.length };
}
