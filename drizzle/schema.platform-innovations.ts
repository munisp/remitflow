/**
 * RemitFlow — Platform Innovation Schema Extensions
 *
 * New tables for:
 *   1. Webhook management (endpoints, delivery logs, secrets)
 *   2. SLO/SLA tracking (events, reports, error budgets)
 *   3. Cost attribution (per-tenant, per-rail, per-service)
 *   4. Chaos experiments (definitions, runs, blast radius)
 *   5. FX hedging positions (forwards, options, hedges)
 *   6. Real-time compliance events (scores, sanctions, PEP)
 *   7. Developer API keys and rate limit state
 */

import {
  pgTable, uuid, text, integer, bigint, boolean, timestamp,
  decimal, jsonb, index, uniqueIndex, pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const webhookStatusEnum = pgEnum("webhook_status", ["active", "inactive", "suspended"]);
export const sloStatusEnum     = pgEnum("slo_status",     ["healthy", "at_risk", "breached"]);
export const chaosTypeEnum     = pgEnum("chaos_type",     ["latency", "error", "network_partition", "resource_exhaustion", "service_kill"]);
export const chaosStatusEnum   = pgEnum("chaos_status",   ["pending", "running", "complete", "aborted"]);
export const riskBandEnum      = pgEnum("risk_band",      ["low", "medium", "high", "critical"]);
export const complianceActionEnum = pgEnum("compliance_action", ["allow", "review", "block"]);

// ── Webhook endpoints ─────────────────────────────────────────────────────────
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      integer("user_id").notNull(),
  tenantId:    text("tenant_id"),
  url:         text("url").notNull(),
  events:      text("events").array().notNull(),
  secret:      text("secret").notNull(),
  status:      webhookStatusEnum("status").default("active").notNull(),
  description: text("description"),
  failureCount: integer("failure_count").default(0).notNull(),
  lastDeliveredAt: timestamp("last_delivered_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx:   index("webhook_endpoints_user_idx").on(t.userId),
  tenantIdx: index("webhook_endpoints_tenant_idx").on(t.tenantId),
}));

// ── Webhook delivery logs ─────────────────────────────────────────────────────
export const webhookDeliveryLogs = pgTable("webhook_delivery_logs", {
  id:          uuid("id").primaryKey().defaultRandom(),
  webhookId:   uuid("webhook_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  event:       text("event").notNull(),
  payload:     jsonb("payload"),
  statusCode:  integer("status_code"),
  latencyMs:   integer("latency_ms"),
  success:     boolean("success").default(false).notNull(),
  attempt:     integer("attempt").default(1).notNull(),
  error:       text("error"),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
}, (t) => ({
  webhookIdx: index("webhook_delivery_logs_webhook_idx").on(t.webhookId),
  eventIdx:   index("webhook_delivery_logs_event_idx").on(t.event),
  successIdx: index("webhook_delivery_logs_success_idx").on(t.success),
}));

// ── SLO events ────────────────────────────────────────────────────────────────
export const sloEvents = pgTable("slo_events", {
  id:        bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  sloName:   text("slo_name").notNull(),
  service:   text("service").notNull(),
  success:   boolean("success").notNull(),
  latencyMs: decimal("latency_ms", { precision: 10, scale: 2 }),
  metadata:  jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  sloNameIdx:  index("slo_events_slo_name_idx").on(t.sloName),
  serviceIdx:  index("slo_events_service_idx").on(t.service),
  createdIdx:  index("slo_events_created_idx").on(t.createdAt),
}));

// ── SLO reports (daily snapshots) ─────────────────────────────────────────────
export const sloReports = pgTable("slo_reports", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  sloName:             text("slo_name").notNull(),
  service:             text("service").notNull(),
  targetPct:           decimal("target_pct",            { precision: 6, scale: 3 }).notNull(),
  compliancePct:       decimal("compliance_pct",        { precision: 6, scale: 3 }).notNull(),
  errorBudgetUsedPct:  decimal("error_budget_used_pct", { precision: 6, scale: 3 }).notNull(),
  errorBudgetRemainPct:decimal("error_budget_remain_pct",{ precision: 6, scale: 3 }).notNull(),
  burnRate1h:          decimal("burn_rate_1h",          { precision: 8, scale: 2 }),
  burnRate24h:         decimal("burn_rate_24h",         { precision: 8, scale: 2 }),
  status:              sloStatusEnum("status").notNull(),
  reportDate:          timestamp("report_date").notNull(),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  sloDateIdx: index("slo_reports_slo_date_idx").on(t.sloName, t.reportDate),
}));

// ── Cost attribution entries ──────────────────────────────────────────────────
export const costAttributionEntries = pgTable("cost_attribution_entries", {
  id:        bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId:  text("tenant_id").notNull(),
  rail:      text("rail").notNull(),
  service:   text("service").notNull(),
  costUsd:   decimal("cost_usd", { precision: 12, scale: 6 }).notNull(),
  count:     integer("count").default(1).notNull(),
  metadata:  jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:  index("cost_attribution_tenant_idx").on(t.tenantId),
  railIdx:    index("cost_attribution_rail_idx").on(t.rail),
  serviceIdx: index("cost_attribution_service_idx").on(t.service),
  dateIdx:    index("cost_attribution_date_idx").on(t.createdAt),
}));

// ── Chaos experiments ─────────────────────────────────────────────────────────
export const chaosExperiments = pgTable("chaos_experiments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  name:           text("name").notNull(),
  type:           chaosTypeEnum("type").notNull(),
  targetService:  text("target_service").notNull(),
  config:         jsonb("config").notNull(),
  blastRadius:    jsonb("blast_radius"),
  status:         chaosStatusEnum("status").default("pending").notNull(),
  injectedCount:  bigint("injected_count", { mode: "number" }).default(0).notNull(),
  startedAt:      timestamp("started_at"),
  completedAt:    timestamp("completed_at"),
  createdBy:      integer("created_by"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  statusIdx:  index("chaos_experiments_status_idx").on(t.status),
  serviceIdx: index("chaos_experiments_service_idx").on(t.targetService),
}));

// ── FX hedging positions ──────────────────────────────────────────────────────
export const fxHedgingPositions = pgTable("fx_hedging_positions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         text("tenant_id"),
  currencyPair:     text("currency_pair").notNull(),
  hedgeType:        text("hedge_type").notNull(), // forward | option | swap
  notionalAmount:   decimal("notional_amount", { precision: 20, scale: 8 }).notNull(),
  strikeRate:       decimal("strike_rate",     { precision: 20, scale: 8 }).notNull(),
  spotRateAtEntry:  decimal("spot_rate_at_entry", { precision: 20, scale: 8 }).notNull(),
  currentSpotRate:  decimal("current_spot_rate",  { precision: 20, scale: 8 }),
  unrealizedPnl:    decimal("unrealized_pnl",     { precision: 20, scale: 8 }),
  premiumPaid:      decimal("premium_paid",        { precision: 20, scale: 8 }),
  expiresAt:        timestamp("expires_at").notNull(),
  status:           text("status").default("open").notNull(), // open | closed | expired | exercised
  closedAt:         timestamp("closed_at"),
  realizedPnl:      decimal("realized_pnl", { precision: 20, scale: 8 }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:  index("fx_hedging_positions_tenant_idx").on(t.tenantId),
  pairIdx:    index("fx_hedging_positions_pair_idx").on(t.currencyPair),
  statusIdx:  index("fx_hedging_positions_status_idx").on(t.status),
  expiryIdx:  index("fx_hedging_positions_expiry_idx").on(t.expiresAt),
}));

// ── Compliance transaction scores ─────────────────────────────────────────────
export const complianceTransactionScores = pgTable("compliance_transaction_scores", {
  id:            uuid("id").primaryKey().defaultRandom(),
  transactionId: text("transaction_id").notNull(),
  userId:        integer("user_id").notNull(),
  riskScore:     integer("risk_score").notNull(),
  riskBand:      riskBandEnum("risk_band").notNull(),
  action:        complianceActionEnum("action").notNull(),
  reasons:       text("reasons").array(),
  sanctionsHit:  boolean("sanctions_hit").default(false).notNull(),
  pepHit:        boolean("pep_hit").default(false).notNull(),
  metadata:      jsonb("metadata"),
  scoredAt:      timestamp("scored_at").defaultNow().notNull(),
}, (t) => ({
  txIdx:     index("compliance_scores_tx_idx").on(t.transactionId),
  userIdx:   index("compliance_scores_user_idx").on(t.userId),
  bandIdx:   index("compliance_scores_band_idx").on(t.riskBand),
  actionIdx: index("compliance_scores_action_idx").on(t.action),
}));

// ── Developer API keys ────────────────────────────────────────────────────────
export const developerApiKeys = pgTable("developer_api_keys", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       integer("user_id").notNull(),
  tenantId:     text("tenant_id"),
  keyHash:      text("key_hash").notNull(),
  keyPrefix:    text("key_prefix").notNull(), // first 8 chars for display
  name:         text("name").notNull(),
  scopes:       text("scopes").array(),
  environment:  text("environment").default("production").notNull(), // production | sandbox
  lastUsedAt:   timestamp("last_used_at"),
  expiresAt:    timestamp("expires_at"),
  revokedAt:    timestamp("revoked_at"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx:   index("developer_api_keys_user_idx").on(t.userId),
  hashIdx:   uniqueIndex("developer_api_keys_hash_idx").on(t.keyHash),
  prefixIdx: index("developer_api_keys_prefix_idx").on(t.keyPrefix),
}));

// ── GDPR erasure requests ─────────────────────────────────────────────────────
export const gdprErasureRequests = pgTable("gdpr_erasure_requests", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       integer("user_id").notNull(),
  requesterId:  text("requester_id").notNull(),
  reason:       text("reason"),
  status:       text("status").default("initiated").notNull(), // initiated | processing | complete | failed
  steps:        jsonb("steps"),
  completedAt:  timestamp("completed_at"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx:   index("gdpr_erasure_requests_user_idx").on(t.userId),
  statusIdx: index("gdpr_erasure_requests_status_idx").on(t.status),
}));

// ── Relations ─────────────────────────────────────────────────────────────────
export const webhookEndpointsRelations = relations(webhookEndpoints, ({ many }) => ({
  deliveryLogs: many(webhookDeliveryLogs),
}));

export const webhookDeliveryLogsRelations = relations(webhookDeliveryLogs, ({ one }) => ({
  webhook: one(webhookEndpoints, { fields: [webhookDeliveryLogs.webhookId], references: [webhookEndpoints.id] }),
}));

// ── TypeScript insert types ───────────────────────────────────────────────────
export type InsertWebhookEndpoint           = typeof webhookEndpoints.$inferInsert;
export type InsertWebhookDeliveryLog        = typeof webhookDeliveryLogs.$inferInsert;
export type InsertSloEvent                  = typeof sloEvents.$inferInsert;
export type InsertSloReport                 = typeof sloReports.$inferInsert;
export type InsertCostAttributionEntry      = typeof costAttributionEntries.$inferInsert;
export type InsertChaosExperiment           = typeof chaosExperiments.$inferInsert;
export type InsertFxHedgingPosition         = typeof fxHedgingPositions.$inferInsert;
export type InsertComplianceTransactionScore = typeof complianceTransactionScores.$inferInsert;
export type InsertDeveloperApiKey           = typeof developerApiKeys.$inferInsert;
export type InsertGdprErasureRequest        = typeof gdprErasureRequests.$inferInsert;
