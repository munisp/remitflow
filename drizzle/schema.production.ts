/**
 * RemitFlow — Production-Readiness Schema Extensions
 * ════════════════════════════════════════════════════
 * Drizzle ORM table definitions for all new integration tables
 * added in migration 0054_production_readiness.sql
 *
 * Covers:
 *   - Outbox events (transactional outbox pattern)
 *   - TigerBeetle account mappings and transfer records
 *   - Fluvio consumer offsets
 *   - Lakehouse sync state
 *   - Fraud alerts (AML scorer output)
 *   - Keycloak session sync
 *   - Permify policy audit log
 *   - APISIX route audit log
 *   - OpenAppSec WAF events
 *   - Dapr event audit
 *   - Compliance cases
 *   - Settlement batches
 *   - Notifications
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
  timestamptz,
  jsonb,
  numeric,
  inet,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Outbox Events ────────────────────────────────────────────────────────────

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id:            bigserial("id", { mode: "number" }).primaryKey(),
    eventType:     varchar("event_type", { length: 100 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
    aggregateId:   varchar("aggregate_id", { length: 255 }).notNull(),
    payload:       jsonb("payload").notNull().default({}),
    status:        varchar("status", { length: 20 }).notNull().default("pending"),
    retryCount:    integer("retry_count").notNull().default(0),
    lastError:     text("last_error"),
    nextRetryAt:   timestamp("next_retry_at", { withTimezone: true }),
    processedAt:   timestamp("processed_at", { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCreatedIdx: index("idx_outbox_events_status_created").on(t.status, t.createdAt),
    aggregateIdx:     index("idx_outbox_events_aggregate").on(t.aggregateType, t.aggregateId),
  })
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

// ─── TigerBeetle Account Mappings ────────────────────────────────────────────

export const tigerbeetleAccounts = pgTable(
  "tigerbeetle_accounts",
  {
    id:             bigserial("id", { mode: "number" }).primaryKey(),
    tbAccountId:    varchar("tb_account_id", { length: 255 }).notNull().unique(),
    userId:         bigint("user_id", { mode: "number" }).notNull(),
    ledger:         integer("ledger").notNull(),
    code:           smallint("code").notNull(),
    status:         varchar("status", { length: 20 }).notNull().default("active"),
    debitsPosted:   bigint("debits_posted", { mode: "number" }).notNull().default(0),
    creditsPosted:  bigint("credits_posted", { mode: "number" }).notNull().default(0),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("idx_tb_accounts_user_id").on(t.userId),
    ledgerIdx:  index("idx_tb_accounts_ledger").on(t.ledger, t.status),
  })
);

export type TigerbeetleAccount = typeof tigerbeetleAccounts.$inferSelect;
export type NewTigerbeetleAccount = typeof tigerbeetleAccounts.$inferInsert;

// ─── TigerBeetle Transfer Records ────────────────────────────────────────────

export const tigerbeetleTransfers = pgTable(
  "tigerbeetle_transfers",
  {
    id:               bigserial("id", { mode: "number" }).primaryKey(),
    tbTransferId:     varchar("tb_transfer_id", { length: 255 }).notNull().unique(),
    debitAccountId:   varchar("debit_account_id", { length: 255 }).notNull(),
    creditAccountId:  varchar("credit_account_id", { length: 255 }).notNull(),
    amount:           bigint("amount", { mode: "number" }).notNull(),
    ledger:           integer("ledger").notNull(),
    code:             smallint("code").notNull(),
    status:           varchar("status", { length: 20 }).notNull().default("posted"),
    transactionId:    bigint("transaction_id", { mode: "number" }),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    debitIdx:       index("idx_tb_transfers_debit").on(t.debitAccountId),
    creditIdx:      index("idx_tb_transfers_credit").on(t.creditAccountId),
    transactionIdx: index("idx_tb_transfers_transaction").on(t.transactionId),
  })
);

export type TigerbeetleTransfer = typeof tigerbeetleTransfers.$inferSelect;
export type NewTigerbeetleTransfer = typeof tigerbeetleTransfers.$inferInsert;

// ─── Fluvio Consumer Offsets ──────────────────────────────────────────────────

export const fluvioOffsets = pgTable(
  "fluvio_offsets",
  {
    id:            bigserial("id", { mode: "number" }).primaryKey(),
    topic:         varchar("topic", { length: 255 }).notNull(),
    partition:     integer("partition").notNull().default(0),
    consumerGroup: varchar("consumer_group", { length: 255 }).notNull(),
    offset:        bigint("offset", { mode: "number" }).notNull().default(0),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    topicGroupUnique: uniqueIndex("idx_fluvio_offsets_unique").on(t.topic, t.partition, t.consumerGroup),
    topicIdx:         index("idx_fluvio_offsets_topic").on(t.topic, t.consumerGroup),
  })
);

export type FluvioOffset = typeof fluvioOffsets.$inferSelect;
export type NewFluvioOffset = typeof fluvioOffsets.$inferInsert;

// ─── Lakehouse Sync State ─────────────────────────────────────────────────────

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

export type LakehouseSyncState = typeof lakehouseSyncState.$inferSelect;
export type NewLakehouseSyncState = typeof lakehouseSyncState.$inferInsert;

// ─── Fraud Alerts ─────────────────────────────────────────────────────────────

export const fraudAlerts = pgTable(
  "fraud_alerts",
  {
    id:            bigserial("id", { mode: "number" }).primaryKey(),
    userId:        bigint("user_id", { mode: "number" }).notNull(),
    transactionId: bigint("transaction_id", { mode: "number" }),
    riskScore:     integer("risk_score").notNull(),
    riskTier:      varchar("risk_tier", { length: 20 }).notNull(),
    reasons:       jsonb("reasons").notNull().default([]),
    action:        varchar("action", { length: 20 }).notNull(),
    modelVersion:  varchar("model_version", { length: 50 }).notNull().default("1.0.0"),
    reviewedBy:    bigint("reviewed_by", { mode: "number" }),
    reviewedAt:    timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes:   text("review_notes"),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:      index("idx_fraud_alerts_user_id").on(t.userId, t.createdAt),
    riskTierIdx:    index("idx_fraud_alerts_risk_tier").on(t.riskTier, t.createdAt),
    transactionIdx: index("idx_fraud_alerts_transaction").on(t.transactionId),
  })
);

export type FraudAlert = typeof fraudAlerts.$inferSelect;
export type NewFraudAlert = typeof fraudAlerts.$inferInsert;

// ─── Keycloak Session Sync ────────────────────────────────────────────────────

export const keycloakSessions = pgTable(
  "keycloak_sessions",
  {
    id:                bigserial("id", { mode: "number" }).primaryKey(),
    userId:            bigint("user_id", { mode: "number" }).notNull(),
    keycloakSessionId: varchar("keycloak_session_id", { length: 255 }).notNull().unique(),
    keycloakUserId:    varchar("keycloak_user_id", { length: 255 }).notNull(),
    realm:             varchar("realm", { length: 100 }).notNull(),
    accessTokenHash:   varchar("access_token_hash", { length: 64 }),
    refreshTokenHash:  varchar("refresh_token_hash", { length: 64 }),
    expiresAt:         timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress:         varchar("ip_address", { length: 45 }),
    userAgent:         text("user_agent"),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt:        timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("idx_kc_sessions_user_id").on(t.userId),
    expiresIdx: index("idx_kc_sessions_expires").on(t.expiresAt),
  })
);

export type KeycloakSession = typeof keycloakSessions.$inferSelect;
export type NewKeycloakSession = typeof keycloakSessions.$inferInsert;

// ─── Permify Policy Audit Log ─────────────────────────────────────────────────

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
    decision:    varchar("decision", { length: 10 }).notNull(),
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

export type PermifyAuditEntry = typeof permifyAuditLog.$inferSelect;
export type NewPermifyAuditEntry = typeof permifyAuditLog.$inferInsert;

// ─── APISIX Route Audit Log ───────────────────────────────────────────────────

export const apisixRouteAudit = pgTable(
  "apisix_route_audit",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    routeId:     varchar("route_id", { length: 255 }).notNull(),
    operation:   varchar("operation", { length: 20 }).notNull(),
    routeConfig: jsonb("route_config").notNull().default({}),
    performedBy: bigint("performed_by", { mode: "number" }),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    routeIdx: index("idx_apisix_route_audit_route").on(t.routeId, t.createdAt),
  })
);

export type ApisixRouteAudit = typeof apisixRouteAudit.$inferSelect;
export type NewApisixRouteAudit = typeof apisixRouteAudit.$inferInsert;

// ─── OpenAppSec WAF Events ────────────────────────────────────────────────────

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
    severityIdx:  index("idx_waf_events_severity").on(t.severity, t.createdAt),
    sourceIpIdx:  index("idx_waf_events_source_ip").on(t.sourceIp, t.createdAt),
    userIdx:      index("idx_waf_events_user").on(t.userId, t.createdAt),
  })
);

export type WafEvent = typeof wafEvents.$inferSelect;
export type NewWafEvent = typeof wafEvents.$inferInsert;

// ─── Dapr Events Audit ────────────────────────────────────────────────────────

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

export type DaprEvent = typeof daprEvents.$inferSelect;
export type NewDaprEvent = typeof daprEvents.$inferInsert;

// ─── Compliance Cases ─────────────────────────────────────────────────────────

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

export type ComplianceCase = typeof complianceCases.$inferSelect;
export type NewComplianceCase = typeof complianceCases.$inferInsert;

// ─── Settlement Batches ───────────────────────────────────────────────────────

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
  })
);

export type SettlementBatch = typeof settlementBatches.$inferSelect;
export type NewSettlementBatch = typeof settlementBatches.$inferInsert;

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id:        bigserial("id", { mode: "number" }).primaryKey(),
    userId:    bigint("user_id", { mode: "number" }).notNull(),
    type:      varchar("type", { length: 100 }).notNull(),
    title:     varchar("title", { length: 255 }).notNull(),
    body:      text("body").notNull(),
    readAt:    timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index("idx_notifications_user_unread").on(t.userId, t.createdAt),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
