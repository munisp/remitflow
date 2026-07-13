/**
 * RemitFlow — Next-Generation KYC Pipeline Schema
 *
 * Tables for the full KYC pipeline:
 *   - kyc_orchestrations: Top-level KYC workflow record
 *   - kyc_document_extractions: PaddleOCR + Docling extraction results
 *   - kyc_vlm_analyses: VLM semantic analysis results
 *   - kyc_liveness_checks: 6-layer liveness detection results
 *   - kyc_biometric_profiles: ArcFace embedding enrollment records
 *   - kyc_biometric_matches: Face match audit log
 *   - kyc_dedup_detections: Duplicate identity detection log
 *   - kyc_challenge_sessions: Active liveness challenge sessions
 *   - kyc_fraud_signals: Fraud signal audit log
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  real,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const kycStatusEnum = pgEnum("kyc_status", [
  "pending", "processing", "approved", "rejected", "manual_review", "expired",
]);

export const docTypeEnum = pgEnum("kyc_doc_type", [
  "passport", "national_id", "drivers_license", "bvn", "nin", "utility_bill",
]);

export const livenessResultEnum = pgEnum("liveness_result", [
  "live", "spoof_print_2d", "spoof_replay_2d", "spoof_mask_3d",
  "spoof_digital_injection", "spoof_deepfake", "spoof_partial", "unknown",
]);

export const kycProviderEnum = pgEnum("kyc_provider", [
  "internal", "iproov", "facetec", "onfido", "jumio", "sumsub",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

/** Top-level KYC orchestration record — one per KYC submission */
export const kycOrchestrations = pgTable("kyc_orchestrations", {
  id:               text("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  status:           kycStatusEnum("status").notNull().default("pending"),
  docType:          docTypeEnum("doc_type").notNull(),
  docNumber:        text("doc_number"),
  firstName:        text("first_name").notNull(),
  lastName:         text("last_name").notNull(),
  dateOfBirth:      text("date_of_birth"),
  nationality:      text("nationality"),
  rejectionReasons: jsonb("rejection_reasons").$type<string[]>().default([]),
  fraudSignals:     jsonb("fraud_signals").$type<string[]>().default([]),
  stages:           jsonb("stages").$type<Record<string, unknown>>().default({}),
  processingMs:     integer("processing_ms"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
  expiresAt:        timestamp("expires_at"),
}, (t) => ({
  userIdx:   index("kyc_orch_user_idx").on(t.userId),
  statusIdx: index("kyc_orch_status_idx").on(t.status),
  createdIdx: index("kyc_orch_created_idx").on(t.createdAt),
}));

/** PaddleOCR + Docling document extraction results */
export const kycDocumentExtractions = pgTable("kyc_document_extractions", {
  id:             text("id").primaryKey(),
  orchestrationId: text("orchestration_id").notNull(),
  userId:         integer("user_id").notNull(),
  docType:        text("doc_type").notNull(),
  // Extracted fields
  extractedFirstName:   text("extracted_first_name"),
  extractedLastName:    text("extracted_last_name"),
  extractedDocNumber:   text("extracted_doc_number"),
  extractedDob:         text("extracted_dob"),
  extractedExpiry:      text("extracted_expiry"),
  extractedNationality: text("extracted_nationality"),
  extractedCountry:     text("extracted_country"),
  extractedMrz:         text("extracted_mrz"),
  mrzCheckDigitValid:   boolean("mrz_check_digit_valid"),
  // Pipeline metadata
  paddleOcrConfidence:  real("paddleocr_confidence"),
  doclingConfidence:    real("docling_confidence"),
  overallConfidence:    real("overall_confidence"),
  pipelineStages:       jsonb("pipeline_stages").$type<string[]>().default([]),
  fraudSignals:         jsonb("fraud_signals").$type<string[]>().default([]),
  rawExtraction:        jsonb("raw_extraction"),
  processingMs:         integer("processing_ms"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orchIdx:  index("kyc_doc_orch_idx").on(t.orchestrationId),
  userIdx:  index("kyc_doc_user_idx").on(t.userId),
}));

/** VLM (Vision Language Model) semantic document analysis */
export const kycVlmAnalyses = pgTable("kyc_vlm_analyses", {
  id:              text("id").primaryKey(),
  orchestrationId: text("orchestration_id").notNull(),
  userId:          integer("user_id").notNull(),
  model:           text("model").notNull(),  // e.g. "gpt-4o", "claude-3-5-sonnet"
  docType:         text("doc_type").notNull(),
  // VLM outputs
  isAuthentic:         boolean("is_authentic"),
  authenticityScore:   real("authenticity_score"),
  tamperingDetected:   boolean("tampering_detected"),
  tamperingDetails:    text("tampering_details"),
  securityFeatures:    jsonb("security_features").$type<string[]>().default([]),
  missingFeatures:     jsonb("missing_features").$type<string[]>().default([]),
  fraudIndicators:     jsonb("fraud_indicators").$type<string[]>().default([]),
  extractedFields:     jsonb("extracted_fields"),
  vlmRawResponse:      text("vlm_raw_response"),
  processingMs:        integer("processing_ms"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orchIdx: index("kyc_vlm_orch_idx").on(t.orchestrationId),
  userIdx: index("kyc_vlm_user_idx").on(t.userId),
}));

/** 6-layer liveness detection results */
export const kycLivenessChecks = pgTable("kyc_liveness_checks", {
  id:              text("id").primaryKey(),
  orchestrationId: text("orchestration_id"),
  userId:          integer("user_id").notNull(),
  // Scores
  isLive:              boolean("is_live").notNull(),
  overallConfidence:   real("overall_confidence").notNull(),
  passiveScore:        real("passive_score"),
  activeScore:         real("active_score"),
  depthScore:          real("depth_score"),
  injectionScore:      real("injection_score"),
  deepfakeScore:       real("deepfake_score"),
  qualityScore:        real("quality_score"),
  // Spoof classification
  spoofType:           livenessResultEnum("spoof_type"),
  // Challenge results
  challengeResults:    jsonb("challenge_results"),
  // Provider
  provider:            kycProviderEnum("provider").default("internal"),
  processingMs:        integer("processing_ms"),
  auditTrail:          jsonb("audit_trail"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx:  index("kyc_liveness_user_idx").on(t.userId),
  orchIdx:  index("kyc_liveness_orch_idx").on(t.orchestrationId),
  liveIdx:  index("kyc_liveness_live_idx").on(t.isLive),
}));

/** ArcFace biometric enrollment profiles */
export const kycBiometricProfiles = pgTable("kyc_biometric_profiles", {
  id:           text("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  profileId:    text("profile_id").notNull(),
  qualityScore: real("quality_score"),
  docType:      text("doc_type"),
  isActive:     boolean("is_active").notNull().default(true),
  enrolledAt:   timestamp("enrolled_at").defaultNow().notNull(),
  revokedAt:    timestamp("revoked_at"),
  revokedReason: text("revoked_reason"),
}, (t) => ({
  userIdx:      index("kyc_bio_user_idx").on(t.userId),
  profileIdx:   uniqueIndex("kyc_bio_profile_idx").on(t.profileId),
  activeIdx:    index("kyc_bio_active_idx").on(t.userId, t.isActive),
}));

/** Biometric face match audit log */
export const kycBiometricMatches = pgTable("kyc_biometric_matches", {
  id:           text("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  profileId:    text("profile_id"),
  matched:      boolean("matched").notNull(),
  similarity:   real("similarity").notNull(),
  threshold:    real("threshold").notNull(),
  method:       text("method"),  // "arcface_r100", "histogram_fallback"
  latencyMs:    integer("latency_ms"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx:    index("kyc_match_user_idx").on(t.userId),
  matchedIdx: index("kyc_match_result_idx").on(t.matched),
}));

/** Duplicate identity detection log */
export const kycDedupDetections = pgTable("kyc_dedup_detections", {
  id:              text("id").primaryKey(),
  probeUserId:     integer("probe_user_id").notNull(),
  matchedUserId:   integer("matched_user_id"),
  similarity:      real("similarity").notNull(),
  isDuplicate:     boolean("is_duplicate").notNull(),
  action:          text("action").notNull(),  // "block_duplicate_identity", "allow"
  reviewedBy:      integer("reviewed_by"),
  reviewedAt:      timestamp("reviewed_at"),
  reviewNotes:     text("review_notes"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  probeIdx:   index("kyc_dedup_probe_idx").on(t.probeUserId),
  matchIdx:   index("kyc_dedup_match_idx").on(t.matchedUserId),
  dupIdx:     index("kyc_dedup_is_dup_idx").on(t.isDuplicate),
}));

/** Active liveness challenge sessions */
export const kycChallengeSessions = pgTable("kyc_challenge_sessions", {
  id:           text("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  challenges:   jsonb("challenges").$type<string[]>().notNull(),
  completed:    boolean("completed").notNull().default(false),
  createdAtMs:  bigint("created_at_ms", { mode: "number" }).notNull(),
  expiresAtMs:  bigint("expires_at_ms", { mode: "number" }).notNull(),
  completedAt:  timestamp("completed_at"),
}, (t) => ({
  userIdx:    index("kyc_challenge_user_idx").on(t.userId),
  expiredIdx: index("kyc_challenge_expires_idx").on(t.expiresAtMs),
}));

/** Fraud signal audit log — all signals across all KYC stages */
export const kycFraudSignals = pgTable("kyc_fraud_signals", {
  id:              text("id").primaryKey(),
  orchestrationId: text("orchestration_id").notNull(),
  userId:          integer("user_id").notNull(),
  signalType:      text("signal_type").notNull(),
  signalDetail:    text("signal_detail"),
  severity:        text("severity").notNull().default("medium"),  // low, medium, high, critical
  source:          text("source").notNull(),  // "paddleocr", "vlm", "liveness", "biometric", "aml"
  resolved:        boolean("resolved").notNull().default(false),
  resolvedBy:      integer("resolved_by"),
  resolvedAt:      timestamp("resolved_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orchIdx:     index("kyc_fraud_orch_idx").on(t.orchestrationId),
  userIdx:     index("kyc_fraud_user_idx").on(t.userId),
  typeIdx:     index("kyc_fraud_type_idx").on(t.signalType),
  severityIdx: index("kyc_fraud_severity_idx").on(t.severity),
}));

// ── Relations ─────────────────────────────────────────────────────────────────
export const kycOrchestrationsRelations = relations(kycOrchestrations, ({ many }) => ({
  documentExtractions: many(kycDocumentExtractions),
  vlmAnalyses:         many(kycVlmAnalyses),
  livenessChecks:      many(kycLivenessChecks),
  fraudSignals:        many(kycFraudSignals),
}));

export const kycDocumentExtractionsRelations = relations(kycDocumentExtractions, ({ one }) => ({
  orchestration: one(kycOrchestrations, {
    fields:     [kycDocumentExtractions.orchestrationId],
    references: [kycOrchestrations.id],
  }),
}));

export const kycVlmAnalysesRelations = relations(kycVlmAnalyses, ({ one }) => ({
  orchestration: one(kycOrchestrations, {
    fields:     [kycVlmAnalyses.orchestrationId],
    references: [kycOrchestrations.id],
  }),
}));

export const kycLivenessChecksRelations = relations(kycLivenessChecks, ({ one }) => ({
  orchestration: one(kycOrchestrations, {
    fields:     [kycLivenessChecks.orchestrationId],
    references: [kycOrchestrations.id],
  }),
}));

export const kycFraudSignalsRelations = relations(kycFraudSignals, ({ one }) => ({
  orchestration: one(kycOrchestrations, {
    fields:     [kycFraudSignals.orchestrationId],
    references: [kycOrchestrations.id],
  }),
}));

// ── Insert Types ──────────────────────────────────────────────────────────────
export type InsertKycOrchestration      = typeof kycOrchestrations.$inferInsert;
export type InsertKycDocumentExtraction = typeof kycDocumentExtractions.$inferInsert;
export type InsertKycVlmAnalysis        = typeof kycVlmAnalyses.$inferInsert;
export type InsertKycLivenessCheck      = typeof kycLivenessChecks.$inferInsert;
export type InsertKycBiometricProfile   = typeof kycBiometricProfiles.$inferInsert;
export type InsertKycBiometricMatch     = typeof kycBiometricMatches.$inferInsert;
export type InsertKycDedupDetection     = typeof kycDedupDetections.$inferInsert;
export type InsertKycChallengeSession   = typeof kycChallengeSessions.$inferInsert;
export type InsertKycFraudSignal        = typeof kycFraudSignals.$inferInsert;
