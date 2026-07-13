/**
 * schema.kyc-triggers.ts — Drizzle ORM Schema for KYC/KYB Trigger Tracking
 *
 * Tables:
 *  - kyc_trigger_events       — audit log of every trigger fired
 *  - kyc_trigger_outcomes     — outcome of each trigger (workflow started, frozen, etc.)
 *  - kyc_tier_requirements    — per-product/operation KYC tier requirements
 *  - kyb_trigger_events       — KYB-specific trigger audit log
 *  - kyc_freeze_log           — log of all account freezes and unfreezes
 *  - kyc_rekyc_schedule       — scheduled re-KYC events
 *  - kyc_country_risk_log     — log of country risk level changes
 */

import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./schema";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const kycTriggerTypeEnum = pgEnum("kyc_trigger_type", [
  "user_registration",
  "first_transfer_attempt",
  "transaction_over_1000",
  "transaction_over_10000",
  "pep_match_detected",
  "sanctions_hit",
  "high_risk_score",
  "periodic_rekyc_due",
  "country_risk_change",
  "sar_filed",
  "business_registration",
  "director_change",
  "merchant_onboarding",
  "license_expiry",
  "beneficial_owner_change",
  "kyc_tier_upgrade_required",
  "kyc_document_expired",
  "kyc_address_change",
  "kyc_manual_review",
]);

export const kycTriggerStatusEnum = pgEnum("kyc_trigger_status", [
  "fired",
  "processing",
  "workflow_started",
  "completed",
  "failed",
  "ignored",
]);

export const kycEntityTypeEnum = pgEnum("kyc_entity_type", ["user", "business", "merchant"]);

export const kycFreezeReasonEnum = pgEnum("kyc_freeze_reason", [
  "sanctions_hit",
  "sar_filed",
  "high_risk_score",
  "manual_review",
  "pep_edd_required",
  "document_expired",
  "suspicious_activity",
  "regulatory_hold",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const kycTriggerEvents = pgTable(
  "kyc_trigger_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerType: kycTriggerTypeEnum("trigger_type").notNull(),
    entityType: kycEntityTypeEnum("entity_type").notNull().default("user"),
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id"),
    amount: decimal("amount", { precision: 20, scale: 8 }),
    currency: varchar("currency", { length: 10 }),
    riskScore: decimal("risk_score", { precision: 5, scale: 2 }),
    country: varchar("country", { length: 10 }),
    correlationId: uuid("correlation_id").notNull().defaultRandom(),
    status: kycTriggerStatusEnum("status").notNull().default("fired"),
    workflowId: varchar("workflow_id", { length: 255 }),
    metadata: jsonb("metadata"),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    userIdIdx: index("kyc_trigger_events_user_id_idx").on(t.userId),
    triggerTypeIdx: index("kyc_trigger_events_trigger_type_idx").on(t.triggerType),
    statusIdx: index("kyc_trigger_events_status_idx").on(t.status),
    correlationIdx: index("kyc_trigger_events_correlation_id_idx").on(t.correlationId),
    firedAtIdx: index("kyc_trigger_events_fired_at_idx").on(t.firedAt),
    entityIdx: index("kyc_trigger_events_entity_idx").on(t.entityType, t.entityId),
  }),
);

export const kycFreezeLog = pgTable(
  "kyc_freeze_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id"),
    freezeReason: kycFreezeReasonEnum("freeze_reason").notNull(),
    frozenBy: varchar("frozen_by", { length: 255 }).notNull().default("system"),
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull().defaultNow(),
    unfrozenAt: timestamp("unfrozen_at", { withTimezone: true }),
    unfrozenBy: varchar("unfrozen_by", { length: 255 }),
    triggerEventId: uuid("trigger_event_id").references(() => kycTriggerEvents.id),
    sanctionsList: varchar("sanctions_list", { length: 255 }),
    sarReference: varchar("sar_reference", { length: 255 }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    userIdIdx: index("kyc_freeze_log_user_id_idx").on(t.userId),
    isActiveIdx: index("kyc_freeze_log_is_active_idx").on(t.isActive),
    frozenAtIdx: index("kyc_freeze_log_frozen_at_idx").on(t.frozenAt),
  }),
);

export const kycReKYCSchedule = pgTable(
  "kyc_rekyc_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kycTier: integer("kyc_tier").notNull().default(0),
    scheduleReason: varchar("schedule_reason", { length: 100 }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    riskScore: decimal("risk_score", { precision: 5, scale: 2 }),
    isPep: boolean("is_pep").notNull().default(false),
    isHighRisk: boolean("is_high_risk").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index("kyc_rekyc_schedule_user_id_idx").on(t.userId),
    dueAtIdx: index("kyc_rekyc_schedule_due_at_idx").on(t.dueAt),
    completedAtIdx: index("kyc_rekyc_schedule_completed_at_idx").on(t.completedAt),
  }),
);

export const kycTierRequirements = pgTable(
  "kyc_tier_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationType: varchar("operation_type", { length: 100 }).notNull(),
    minimumTier: integer("minimum_tier").notNull().default(1),
    maxAmountTier1: decimal("max_amount_tier1", { precision: 20, scale: 8 }),
    maxAmountTier2: decimal("max_amount_tier2", { precision: 20, scale: 8 }),
    maxAmountTier3: decimal("max_amount_tier3", { precision: 20, scale: 8 }),
    currency: varchar("currency", { length: 10 }).notNull().default("USD"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationTypeIdx: index("kyc_tier_requirements_operation_type_idx").on(t.operationType),
  }),
);

export const kybTriggerEvents = pgTable(
  "kyb_trigger_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerType: varchar("trigger_type", { length: 100 }).notNull(),
    businessId: uuid("business_id").notNull(),
    userId: uuid("user_id").references(() => users.id),
    correlationId: uuid("correlation_id").notNull().defaultRandom(),
    status: kycTriggerStatusEnum("status").notNull().default("fired"),
    workflowId: varchar("workflow_id", { length: 255 }),
    directorName: varchar("director_name", { length: 255 }),
    ownerName: varchar("owner_name", { length: 255 }),
    ownershipPercentage: decimal("ownership_percentage", { precision: 5, scale: 2 }),
    licenseType: varchar("license_type", { length: 100 }),
    licenseExpiryDate: timestamp("license_expiry_date", { withTimezone: true }),
    metadata: jsonb("metadata"),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    businessIdIdx: index("kyb_trigger_events_business_id_idx").on(t.businessId),
    triggerTypeIdx: index("kyb_trigger_events_trigger_type_idx").on(t.triggerType),
    firedAtIdx: index("kyb_trigger_events_fired_at_idx").on(t.firedAt),
  }),
);

export const kycCountryRiskLog = pgTable(
  "kyc_country_risk_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: varchar("country_code", { length: 10 }).notNull(),
    previousRiskLevel: varchar("previous_risk_level", { length: 50 }),
    newRiskLevel: varchar("new_risk_level", { length: 50 }).notNull(),
    changeReason: text("change_reason"),
    affectedUsersCount: integer("affected_users_count").default(0),
    reKYCTriggeredCount: integer("rekyc_triggered_count").default(0),
    changedBy: varchar("changed_by", { length: 255 }).notNull().default("system"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    countryCodeIdx: index("kyc_country_risk_log_country_code_idx").on(t.countryCode),
    changedAtIdx: index("kyc_country_risk_log_changed_at_idx").on(t.changedAt),
  }),
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const kycTriggerEventsRelations = relations(kycTriggerEvents, ({ one }) => ({
  user: one(users, { fields: [kycTriggerEvents.userId], references: [users.id] }),
}));

export const kycFreezeLogRelations = relations(kycFreezeLog, ({ one }) => ({
  user: one(users, { fields: [kycFreezeLog.userId], references: [users.id] }),
  triggerEvent: one(kycTriggerEvents, {
    fields: [kycFreezeLog.triggerEventId],
    references: [kycTriggerEvents.id],
  }),
}));

export const kycReKYCScheduleRelations = relations(kycReKYCSchedule, ({ one }) => ({
  user: one(users, { fields: [kycReKYCSchedule.userId], references: [users.id] }),
}));

export const kybTriggerEventsRelations = relations(kybTriggerEvents, ({ one }) => ({
  user: one(users, { fields: [kybTriggerEvents.userId], references: [users.id] }),
}));
