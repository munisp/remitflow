/**
 * RemitFlow — Production-Readiness Schema Extensions
 * ════════════════════════════════════════════════════
 * Drizzle ORM table definitions for production-grade tables that are
 * NOT defined in schema.ts, schema.integrations.ts, or schema.pg.ts.
 *
 * Duplicate-free: tables already defined in canonical schema files are
 * re-exported from there (see schema.ts barrel exports).
 *
 * Unique tables here:
 *   - lakehouse_sync_state   — Lakehouse ETL watermark tracking
 *   - permify_audit_log      — Permify RBAC decision audit trail
 *   - apisix_route_audit     — APISIX dynamic route change log
 *   - waf_events             — OpenAppSec WAF security events
 *   - dapr_events            — Dapr pub/sub event audit
 *   - compliance_cases       — AML/KYC compliance case management
 *   - settlement_batches     — Multi-rail settlement batch records
 *   - circuit_breaker_state  — Circuit-breaker state per integration
 *   - integration_health_log — Periodic integration health snapshots
 *   - dlq_events             — Dead-letter queue for failed events
 *   - rate_limit_violations  — Rate-limit breach audit log
 *   - secret_rotation_log    — Secret/key rotation audit trail
 */

import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Lakehouse Sync State ─────────────────────────────────────────────────────
// Tracks the high-water mark for each table exported to the data lakehouse.
// Distinct from schema.integrations.ts::lakehouseSyncJobs (job-level records).

export const lakehouseSyncState = pgTable(
  "lakehouse_sync_state",
  {
    id:           bigserial("id", { mode: "number" }).primaryKey(),
    tableName:    varchar("table_name", { length: 255 }).notNull().unique(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    rowsSynced:   bigint("rows_synced", { mode: "number" }).notNull().default(0),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export type LakehouseSyncState    = typeof lakehouseSyncState.$inferSelect;
export type NewLakehouseSyncState = typeof lakehouseSyncState.$inferInsert;

// ─── Permify Policy Audit Log ─────────────────────────────────────────────────
// Records every Permify permission check decision for compliance and debugging.

export const permifyAuditLog = pgTable(
  "permify_audit_log",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    userId:      bigint("user_id", { mode: "number" }),
    entityType:  varchar("entity_type", { length: 100 }).notNull(),
    entityId:    varchar("entity_id", { length: 255 }).notNull(),
    permission:  varchar("permission", { length: 100 }).notNull(),
    subjectType: varchar("subject_type", { length: 100 }).notNull(),
    subjectId:   varchar("subject_id", { length: 255 }).notNull(),
    decision:    varchar("decision", { length: 10 }).notNull(),   // "allow" | "deny"
    snapToken:   varchar("snap_token", { length: 255 }),
    latencyMs:   integer("latency_ms"),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx:   index("idx_permify_audit_user").on(t.userId, t.createdAt),
    entityIdx: index("idx_permify_audit_entity").on(t.entityType, t.entityId),
    deniedIdx: index("idx_permify_audit_denied").on(t.decision, t.createdAt),
  })
);

export type PermifyAuditEntry    = typeof permifyAuditLog.$inferSelect;
export type NewPermifyAuditEntry = typeof permifyAuditLog.$inferInsert;

// ─── APISIX Route Audit Log ───────────────────────────────────────────────────
// Captures every create/update/delete on APISIX routes for change management.

export const apisixRouteAudit = pgTable(
  "apisix_route_audit",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    routeId:     varchar("route_id", { length: 255 }).notNull(),
    operation:   varchar("operation", { length: 20 }).notNull(),  // create|update|delete
    routeConfig: jsonb("route_config").notNull().default({}),
    performedBy: bigint("performed_by", { mode: "number" }),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    routeIdx: index("idx_apisix_route_audit_route").on(t.routeId, t.createdAt),
  })
);

export type ApisixRouteAudit    = typeof apisixRouteAudit.$inferSelect;
export type NewApisixRouteAudit = typeof apisixRouteAudit.$inferInsert;

// ─── OpenAppSec WAF Events ────────────────────────────────────────────────────
// Stores security events detected by the OpenAppSec WAF layer.

export const wafEvents = pgTable(
  "waf_events",
  {
    id:             bigserial("id", { mode: "number" }).primaryKey(),
    eventType:      varchar("event_type", { length: 50 }).notNull(),
    severity:       varchar("severity", { length: 20 }).notNull(),
    sourceIp:       varchar("source_ip", { length: 45 }),
    userId:         bigint("user_id", { mode: "number" }),
    requestUri:     text("request_uri"),
    attackType:     varchar("attack_type", { length: 100 }),
    payloadSnippet: text("payload_snippet"),
    actionTaken:    varchar("action_taken", { length: 20 }).notNull(),
    ruleId:         varchar("rule_id", { length: 100 }),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    severityIdx: index("idx_waf_events_severity").on(t.severity, t.createdAt),
    sourceIpIdx: index("idx_waf_events_source_ip").on(t.sourceIp, t.createdAt),
    userIdx:     index("idx_waf_events_user").on(t.userId, t.createdAt),
  })
);

export type WafEvent    = typeof wafEvents.$inferSelect;
export type NewWafEvent = typeof wafEvents.$inferInsert;

// ─── Dapr Events Audit ────────────────────────────────────────────────────────
// Audit trail for all Dapr pub/sub messages published or consumed.

export const daprEvents = pgTable(
  "dapr_events",
  {
    id:           bigserial("id", { mode: "number" }).primaryKey(),
    eventType:    varchar("event_type", { length: 100 }).notNull(),
    pubsubName:   varchar("pubsub_name", { length: 100 }).notNull(),
    topic:        varchar("topic", { length: 255 }).notNull(),
    data:         jsonb("data").notNull().default({}),
    status:       varchar("status", { length: 20 }).notNull().default("published"),
    errorMessage: text("error_message"),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    topicIdx:  index("idx_dapr_events_topic").on(t.topic, t.createdAt),
    statusIdx: index("idx_dapr_events_status").on(t.status, t.createdAt),
  })
);

export type DaprEvent    = typeof daprEvents.$inferSelect;
export type NewDaprEvent = typeof daprEvents.$inferInsert;

// ─── Compliance Cases ─────────────────────────────────────────────────────────
// AML/KYC compliance case management — one row per investigation.

export const complianceCases = pgTable(
  "compliance_cases",
  {
    id:              bigserial("id", { mode: "number" }).primaryKey(),
    userId:          bigint("user_id", { mode: "number" }).notNull(),
    caseType:        varchar("case_type", { length: 50 }).notNull(),
    status:          varchar("status", { length: 20 }).notNull().default("open"),
    priority:        varchar("priority", { length: 10 }).notNull().default("medium"),
    notes:           text("notes"),
    assignedTo:      bigint("assigned_to", { mode: "number" }),
    resolvedAt:      timestamp("resolved_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx:   index("idx_compliance_cases_user").on(t.userId, t.createdAt),
    statusIdx: index("idx_compliance_cases_status").on(t.status, t.priority),
  })
);

export type ComplianceCase    = typeof complianceCases.$inferSelect;
export type NewComplianceCase = typeof complianceCases.$inferInsert;

// ─── Settlement Batches ───────────────────────────────────────────────────────
// Multi-rail settlement batch records for netting and reconciliation.

export const settlementBatches = pgTable(
  "settlement_batches",
  {
    id:               bigserial("id", { mode: "number" }).primaryKey(),
    batchReference:   varchar("batch_reference", { length: 255 }).notNull().unique(),
    currency:         varchar("currency", { length: 10 }).notNull(),
    totalAmount:      numeric("total_amount", { precision: 20, scale: 8 }).notNull(),
    transactionCount: integer("transaction_count").notNull().default(0),
    status:           varchar("status", { length: 20 }).notNull().default("pending"),
    rail:             varchar("rail", { length: 50 }).notNull(),
    settledAt:        timestamp("settled_at", { withTimezone: true }),
    errorMessage:     text("error_message"),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("idx_settlement_batches_status").on(t.status, t.createdAt),
    railIdx:   index("idx_settlement_batches_rail").on(t.rail, t.status),
  })
);

export type SettlementBatch    = typeof settlementBatches.$inferSelect;
export type NewSettlementBatch = typeof settlementBatches.$inferInsert;

// ─── Circuit Breaker State ────────────────────────────────────────────────────
// Persistent circuit-breaker state per integration for cross-pod consistency.

export const circuitBreakerState = pgTable(
  "circuit_breaker_state",
  {
    id:              bigserial("id", { mode: "number" }).primaryKey(),
    integration:     varchar("integration", { length: 100 }).notNull().unique(),
    state:           varchar("state", { length: 10 }).notNull().default("closed"), // closed|open|half_open
    failureCount:    integer("failure_count").notNull().default(0),
    successCount:    integer("success_count").notNull().default(0),
    lastFailureAt:   timestamp("last_failure_at", { withTimezone: true }),
    lastSuccessAt:   timestamp("last_success_at", { withTimezone: true }),
    openedAt:        timestamp("opened_at", { withTimezone: true }),
    nextAttemptAt:   timestamp("next_attempt_at", { withTimezone: true }),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stateIdx: index("idx_cb_state_state").on(t.state),
  })
);

export type CircuitBreakerState    = typeof circuitBreakerState.$inferSelect;
export type NewCircuitBreakerState = typeof circuitBreakerState.$inferInsert;

// ─── Integration Health Log ───────────────────────────────────────────────────
// Periodic snapshots of each integration's health status for trending/alerting.

export const integrationHealthLog = pgTable(
  "integration_health_log",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    integration: varchar("integration", { length: 100 }).notNull(),
    status:      varchar("status", { length: 20 }).notNull(),   // healthy|degraded|unhealthy
    latencyMs:   integer("latency_ms"),
    details:     jsonb("details").default({}),
    checkedAt:   timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    integrationIdx: index("idx_health_log_integration").on(t.integration, t.checkedAt),
    statusIdx:      index("idx_health_log_status").on(t.status, t.checkedAt),
  })
);

export type IntegrationHealthLog    = typeof integrationHealthLog.$inferSelect;
export type NewIntegrationHealthLog = typeof integrationHealthLog.$inferInsert;

// ─── Dead-Letter Queue Events ─────────────────────────────────────────────────
// Stores events that failed all retry attempts for manual review/replay.

export const dlqEvents = pgTable(
  "dlq_events",
  {
    id:            bigserial("id", { mode: "number" }).primaryKey(),
    sourceQueue:   varchar("source_queue", { length: 255 }).notNull(),
    eventType:     varchar("event_type", { length: 100 }).notNull(),
    payload:       jsonb("payload").notNull().default({}),
    failureReason: text("failure_reason").notNull(),
    retryCount:    integer("retry_count").notNull().default(0),
    resolvedAt:    timestamp("resolved_at", { withTimezone: true }),
    resolvedBy:    bigint("resolved_by", { mode: "number" }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceQueueIdx: index("idx_dlq_source_queue").on(t.sourceQueue, t.createdAt),
    unresolvedIdx:  index("idx_dlq_unresolved").on(t.resolvedAt, t.createdAt),
  })
);

export type DlqEvent    = typeof dlqEvents.$inferSelect;
export type NewDlqEvent = typeof dlqEvents.$inferInsert;

// ─── Rate Limit Violations ────────────────────────────────────────────────────
// Audit log for rate-limit breaches detected by the Go rate-limiter sidecar.

export const rateLimitViolations = pgTable(
  "rate_limit_violations",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    userId:      bigint("user_id", { mode: "number" }),
    ipAddress:   varchar("ip_address", { length: 45 }),
    endpoint:    varchar("endpoint", { length: 255 }).notNull(),
    limitKey:    varchar("limit_key", { length: 255 }).notNull(),
    requestCount: integer("request_count").notNull(),
    windowSecs:  integer("window_secs").notNull(),
    blockedAt:   timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx:    index("idx_rate_violations_user").on(t.userId, t.blockedAt),
    ipIdx:      index("idx_rate_violations_ip").on(t.ipAddress, t.blockedAt),
    endpointIdx: index("idx_rate_violations_endpoint").on(t.endpoint, t.blockedAt),
  })
);

export type RateLimitViolation    = typeof rateLimitViolations.$inferSelect;
export type NewRateLimitViolation = typeof rateLimitViolations.$inferInsert;

// ─── Secret Rotation Log ──────────────────────────────────────────────────────
// Audit trail for all secret/API-key rotation events across integrations.

export const secretRotationLog = pgTable(
  "secret_rotation_log",
  {
    id:           bigserial("id", { mode: "number" }).primaryKey(),
    secretName:   varchar("secret_name", { length: 255 }).notNull(),
    integration:  varchar("integration", { length: 100 }).notNull(),
    rotatedBy:    bigint("rotated_by", { mode: "number" }),
    rotationMode: varchar("rotation_mode", { length: 20 }).notNull().default("manual"), // manual|auto
    success:      boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    rotatedAt:    timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    integrationIdx: index("idx_secret_rotation_integration").on(t.integration, t.rotatedAt),
    secretIdx:      index("idx_secret_rotation_secret").on(t.secretName, t.rotatedAt),
  })
);

export type SecretRotationLog    = typeof secretRotationLog.$inferSelect;
export type NewSecretRotationLog = typeof secretRotationLog.$inferInsert;
