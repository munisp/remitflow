import { pgTable, serial, varchar, integer, timestamp, boolean, text, bigint, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./schema";

// ─── Keycloak ────────────────────────────────────────────────────────────────
export const keycloakSessions = pgTable("keycloak_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  sessionId: varchar("session_id", { length: 128 }).notNull().unique(),
  token: text("token").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("keycloak_sessions_user_idx").on(t.userId),
  index("keycloak_sessions_session_idx").on(t.sessionId),
]);

// ─── TigerBeetle ─────────────────────────────────────────────────────────────
export const tigerbeetleAccounts = pgTable("tigerbeetle_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  tbAccountId: bigint("tb_account_id", { mode: "bigint" }).notNull().unique(),
  ledger: integer("ledger").notNull(),
  code: integer("code").notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  status: varchar("status", { length: 30 }).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("tb_accounts_user_idx").on(t.userId),
  index("tb_accounts_ledger_idx").on(t.ledger),
]);

export const tigerbeetleTransfers = pgTable("tigerbeetle_transfers", {
  id: serial("id").primaryKey(),
  tbTransferId: bigint("tb_transfer_id", { mode: "bigint" }).notNull().unique(),
  debitAccountId: bigint("debit_account_id", { mode: "bigint" }).notNull(),
  creditAccountId: bigint("credit_account_id", { mode: "bigint" }).notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  ledger: integer("ledger").notNull(),
  code: integer("code").notNull(),
  status: varchar("status", { length: 30 }).default("posted").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("tb_transfers_debit_idx").on(t.debitAccountId),
  index("tb_transfers_credit_idx").on(t.creditAccountId),
]);

// ─── Permify ─────────────────────────────────────────────────────────────────
export const permifyAuditLogs = pgTable("permify_audit_logs", {
  id: serial("id").primaryKey(),
  subjectId: varchar("subject_id", { length: 128 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: varchar("entity_id", { length: 128 }).notNull(),
  permission: varchar("permission", { length: 64 }).notNull(),
  allowed: boolean("allowed").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("permify_audit_subject_idx").on(t.subjectId),
  index("permify_audit_entity_idx").on(t.entityType, t.entityId),
]);

// ─── APISIX ──────────────────────────────────────────────────────────────────
export const apisixRouteLogs = pgTable("apisix_route_logs", {
  id: serial("id").primaryKey(),
  routeId: varchar("route_id", { length: 128 }).notNull(),
  path: varchar("path", { length: 256 }).notNull(),
  upstreamUrl: varchar("upstream_url", { length: 256 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("apisix_route_logs_route_idx").on(t.routeId),
]);

// ─── Dapr ────────────────────────────────────────────────────────────────────
export const daprStateAudit = pgTable("dapr_state_audit", {
  id: serial("id").primaryKey(),
  storeName: varchar("store_name", { length: 128 }).notNull(),
  key: varchar("key", { length: 256 }).notNull(),
  operation: varchar("operation", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("dapr_state_audit_key_idx").on(t.key),
]);

// ─── Temporal ────────────────────────────────────────────────────────────────
export const temporalExecutions = pgTable("temporal_executions", {
  id: serial("id").primaryKey(),
  workflowId: varchar("workflow_id", { length: 256 }).notNull().unique(),
  runId: varchar("run_id", { length: 256 }).notNull(),
  workflowType: varchar("workflow_type", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("temporal_exec_workflow_idx").on(t.workflowId),
  index("temporal_exec_status_idx").on(t.status),
]);

// ─── Fluvio ──────────────────────────────────────────────────────────────────
export const fluvioOffsets = pgTable("fluvio_offsets", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 128 }).notNull(),
  partition: integer("partition").notNull(),
  consumerGroup: varchar("consumer_group", { length: 128 }).notNull(),
  offset: bigint("offset", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("fluvio_offsets_unique_idx").on(t.topic, t.partition, t.consumerGroup),
]);

// ─── Lakehouse ───────────────────────────────────────────────────────────────
export const lakehouseSyncJobs = pgTable("lakehouse_sync_jobs", {
  id: serial("id").primaryKey(),
  tableName: varchar("table_name", { length: 128 }).notNull(),
  lastSyncId: bigint("last_sync_id", { mode: "bigint" }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  recordsSynced: integer("records_synced").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("lakehouse_sync_table_idx").on(t.tableName),
]);

// ─── OpenAppSec ──────────────────────────────────────────────────────────────
export const openappsecEvents = pgTable("openappsec_events", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 128 }).notNull().unique(),
  action: varchar("action", { length: 32 }).notNull(), // block, detect
  score: integer("score").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  path: varchar("path", { length: 256 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("openappsec_events_ip_idx").on(t.ipAddress),
  index("openappsec_events_action_idx").on(t.action),
]);

// ─── Redis ───────────────────────────────────────────────────────────────────
export const redisCacheAudit = pgTable("redis_cache_audit", {
  id: serial("id").primaryKey(),
  keyPattern: varchar("key_pattern", { length: 128 }).notNull(),
  operation: varchar("operation", { length: 32 }).notNull(), // set, del, flush
  hitCount: integer("hit_count").default(0),
  missCount: integer("miss_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("redis_cache_audit_pattern_idx").on(t.keyPattern),
]);
