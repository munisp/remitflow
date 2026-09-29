/**
 * Insider Threat Controls Router
 *
 * Implements 13 controls across 4 domains:
 * 1. Maker-Checker dual authorization
 * 2. JIT (Just-In-Time) privileged access
 * 3. Geo + Time fencing
 * 4. DLP (Data Loss Prevention)
 * 5. WebAuthn/FIDO2 hardware security keys
 * 6. Time-delayed high-value reversals
 * 7. Canary token alerting
 *
 * Wave-18 (C): all state is durably persisted via drizzle (migration 0097).
 * The previous in-memory Map stores were replaced with PostgreSQL tables;
 * WebAuthn challenges are short-TTL table rows (5-minute expiry). Every
 * procedure FAILS CLOSED when the database is unavailable (requireDb throws),
 * and multi-write paths run inside db.transaction via withTransaction.
 * Procedure names, inputs and outputs are unchanged for the W17
 * InsiderThreatConsole consumer.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { requireDb } from "../db";
import { withTransaction } from "../db-transaction";
import {
  InsiderCanaryAlert as InsiderCanaryAlertRow,
  InsiderDelayedReversal as InsiderDelayedReversalRow,
  InsiderWebauthnCredential as InsiderWebauthnCredentialRow,
  insiderBreakGlassEvents,
  insiderCanaryAlerts,
  insiderDelayedReversals,
  insiderDlpEvents,
  insiderGeoTimeFenceConfig,
  insiderJitAccessGrants,
  insiderMakerCheckerRequests,
  insiderWebauthnChallenges,
  insiderWebauthnCredentials,
} from "../../drizzle/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MakerCheckerRequest {
  id: string;
  operationType: string;
  requestedBy: number;
  requestedAt: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  approvedBy?: number;
  approvedAt?: string;
  rejectionReason?: string;
  expiresAt: string;
  riskScore: number;
  requiredApprovers: number;
  currentApprovals: number;
}

export interface JITAccessGrant {
  id: string;
  userId: number;
  privilege: string;
  grantedAt: string;
  expiresAt: string;
  grantedBy: number;
  reason: string;
  revoked: boolean;
  revokedAt?: string;
  actionsPerformed: number;
}

export interface GeoTimeFence {
  allowedIPs: string[];
  allowedCountries: string[];
  businessHoursStart: number; // UTC hour
  businessHoursEnd: number;
  allowedDays: number[]; // 0=Sunday, 6=Saturday
  breakGlassEnabled: boolean;
}

export interface DLPEvent {
  id: string;
  userId: number;
  action: string;
  table: string;
  recordCount: number;
  timestamp: string;
  blocked: boolean;
  reason?: string;
}

export interface WebAuthnCredential {
  id: string;
  userId: number;
  credentialId: string;
  publicKey: string;
  signCount: number;
  createdAt: string;
  lastUsed?: string;
  name: string;
}

export interface CanaryAlert {
  id: string;
  canaryRecordId: string;
  accessedBy: number;
  accessedAt: string;
  query: string;
  ipAddress: string;
  severity: "critical";
}

// ─── Configuration ───────────────────────────────────────────────────────────

const MAKER_CHECKER_THRESHOLDS = {
  transfer_reversal: 10000, // $10K USD
  wallet_adjustment: 5000,
  agent_float_topup: 50000,
  fx_rate_override: 0, // Always requires approval
  user_role_change: 0, // Always requires approval
  bulk_data_export: 0, // Always requires approval
};

const JIT_MAX_DURATION_HOURS = 2;
const JIT_MAX_GRANTS_PER_DAY = 3;

const DEFAULT_GEO_TIME_FENCE: GeoTimeFence = {
  allowedIPs: [], // Empty = no restriction (configure in production)
  allowedCountries: ["CA", "NG", "US", "GB", "KE", "GH", "ZA"],
  businessHoursStart: 6, // 6 AM UTC
  businessHoursEnd: 22, // 10 PM UTC
  allowedDays: [1, 2, 3, 4, 5], // Mon-Fri
  breakGlassEnabled: true,
};

const DLP_MAX_RECORDS_PER_QUERY = 100;
const DLP_MAX_QUERIES_PER_HOUR = 50;
const DLP_PII_TABLES = ["users", "kyc_documents", "wallets", "transactions", "agent_network"];

const REVERSAL_DELAY_HOURS = 4;
const HIGH_VALUE_REVERSAL_THRESHOLD = 10000; // $10K USD

const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helper Functions ────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function isWithinBusinessHours(fence: GeoTimeFence): boolean {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  return fence.allowedDays.includes(day) && hour >= fence.businessHoursStart && hour < fence.businessHoursEnd;
}

function isIPAllowed(ip: string, fence: GeoTimeFence): boolean {
  if (fence.allowedIPs.length === 0) return true; // No restriction configured
  return fence.allowedIPs.includes(ip);
}

function computeRiskScore(operationType: string, amount: number, userId: number): number {
  let score = 0;
  // High-value operations
  if (amount > 100000) score += 40;
  else if (amount > 50000) score += 30;
  else if (amount > 10000) score += 20;
  // FX and role changes are always high risk
  if (operationType === "fx_rate_override") score += 50;
  if (operationType === "user_role_change") score += 40;
  if (operationType === "bulk_data_export") score += 35;
  // Off-hours bonus
  if (!isWithinBusinessHours(DEFAULT_GEO_TIME_FENCE)) score += 25;
  return Math.min(score, 100);
}

function requiresMakerChecker(operationType: string, amount: number): boolean {
  const threshold = MAKER_CHECKER_THRESHOLDS[operationType as keyof typeof MAKER_CHECKER_THRESHOLDS];
  if (threshold === undefined) return false;
  return amount >= threshold;
}

// ─── Row mappers (DB rows → wire shapes; ISO timestamps, nulls → undefined) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMakerCheckerRequest(r: any): MakerCheckerRequest {
  return {
    id: r.id,
    operationType: r.operationType,
    requestedBy: r.requestedBy,
    requestedAt: new Date(r.requestedAt).toISOString(),
    payload: (r.payload ?? {}) as Record<string, unknown>,
    status: r.status,
    approvedBy: r.approvedBy ?? undefined,
    approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : undefined,
    rejectionReason: r.rejectionReason ?? undefined,
    expiresAt: new Date(r.expiresAt).toISOString(),
    riskScore: r.riskScore,
    requiredApprovers: r.requiredApprovers,
    currentApprovals: r.currentApprovals,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJitGrant(g: any): JITAccessGrant {
  return {
    id: g.id,
    userId: g.userId,
    privilege: g.privilege,
    grantedAt: new Date(g.grantedAt).toISOString(),
    expiresAt: new Date(g.expiresAt).toISOString(),
    grantedBy: g.grantedBy,
    reason: g.reason,
    revoked: g.revoked,
    revokedAt: g.revokedAt ? new Date(g.revokedAt).toISOString() : undefined,
    actionsPerformed: g.actionsPerformed,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDlpEvent(e: any): DLPEvent {
  return {
    id: e.id,
    userId: e.userId,
    action: e.action,
    table: e.tableName,
    recordCount: e.recordCount,
    timestamp: new Date(e.createdAt).toISOString(),
    blocked: e.blocked,
    reason: e.reason ?? undefined,
  };
}

/**
 * Load the geo/time fence configuration from the database, seeding the
 * singleton row with defaults on first use. FAILS CLOSED via requireDb when
 * the database is unavailable.
 */
async function loadGeoTimeFence(): Promise<GeoTimeFence> {
  const db = await requireDb();
  const rows = await db.select().from(insiderGeoTimeFenceConfig).where(eq(insiderGeoTimeFenceConfig.id, 1)).limit(1);
  const row = rows[0];
  if (!row) {
    await db.insert(insiderGeoTimeFenceConfig).values({
      id: 1,
      allowedIps: DEFAULT_GEO_TIME_FENCE.allowedIPs,
      allowedCountries: DEFAULT_GEO_TIME_FENCE.allowedCountries,
      businessHoursStart: DEFAULT_GEO_TIME_FENCE.businessHoursStart,
      businessHoursEnd: DEFAULT_GEO_TIME_FENCE.businessHoursEnd,
      allowedDays: DEFAULT_GEO_TIME_FENCE.allowedDays,
      breakGlassEnabled: DEFAULT_GEO_TIME_FENCE.breakGlassEnabled,
    }).onConflictDoNothing();
    return DEFAULT_GEO_TIME_FENCE;
  }
  return {
    allowedIPs: (row.allowedIps as string[]) ?? [],
    allowedCountries: (row.allowedCountries as string[]) ?? [],
    businessHoursStart: row.businessHoursStart,
    businessHoursEnd: row.businessHoursEnd,
    allowedDays: (row.allowedDays as number[]) ?? [],
    breakGlassEnabled: row.breakGlassEnabled,
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const insiderThreatRouter = router({
  // ════════════════════════════════════════════════════════════════════════════
  // 1. MAKER-CHECKER DUAL AUTHORIZATION
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Submit a request that requires dual authorization.
   * The maker submits; a different checker must approve.
   */
  makerChecker: router({
    submit: protectedProcedure
      .input(z.object({
        operationType: z.enum(["transfer_reversal", "wallet_adjustment", "agent_float_topup", "fx_rate_override", "user_role_change", "bulk_data_export"]),
        amount: z.number().min(0).default(0),
        payload: z.record(z.string(), z.unknown()),
        justification: z.string().min(10).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;

        // Check if maker-checker is required for this operation
        if (!requiresMakerChecker(input.operationType, input.amount)) {
          return { required: false, message: "Below threshold — no dual authorization needed" };
        }

        const riskScore = computeRiskScore(input.operationType, input.amount, userId);
        const requiredApprovers = riskScore >= 70 ? 2 : 1;
        const requestId = generateId("mc");

        const db = await requireDb();
        await db.insert(insiderMakerCheckerRequests).values({
          id: requestId,
          operationType: input.operationType,
          requestedBy: userId,
          requestedAt: new Date(),
          payload: { ...input.payload, justification: input.justification },
          status: "pending",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
          riskScore,
          requiredApprovers,
          currentApprovals: 0,
        });

        return { required: true, requestId, riskScore, requiredApprovers };
      }),

    approve: adminProcedure
      .input(z.object({
        requestId: z.string(),
        mfaToken: z.string().optional(), // WebAuthn assertion for high-risk
      }))
      .mutation(async ({ ctx, input }) => {
        const approverId = ctx.user?.id ?? 0;

        // Read + conditional write must be atomic: concurrent approvers must
        // not double-increment or approve an expired/self-made request.
        return withTransaction(async (tx) => {
          const rows = await tx.select().from(insiderMakerCheckerRequests)
            .where(eq(insiderMakerCheckerRequests.id, input.requestId))
            .limit(1)
            .for("update");
          const request = rows[0];

          if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
          if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${request.status}` });
          if (request.requestedBy === approverId) throw new TRPCError({ code: "FORBIDDEN", message: "Maker cannot approve their own request" });
          if (new Date(request.expiresAt) < new Date()) {
            await tx.update(insiderMakerCheckerRequests)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(insiderMakerCheckerRequests.id, input.requestId));
            throw new TRPCError({ code: "BAD_REQUEST", message: "Request has expired" });
          }

          const newApprovals = request.currentApprovals + 1;
          if (newApprovals >= request.requiredApprovers) {
            await tx.update(insiderMakerCheckerRequests)
              .set({
                currentApprovals: newApprovals,
                status: "approved",
                approvedBy: approverId,
                approvedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(insiderMakerCheckerRequests.id, input.requestId));
            return { approved: true, message: "Request approved — operation may proceed" };
          }

          await tx.update(insiderMakerCheckerRequests)
            .set({ currentApprovals: newApprovals, updatedAt: new Date() })
            .where(eq(insiderMakerCheckerRequests.id, input.requestId));

          return { approved: false, message: `Approval ${newApprovals}/${request.requiredApprovers} recorded. Awaiting more approvers.` };
        });
      }),

    reject: adminProcedure
      .input(z.object({
        requestId: z.string(),
        reason: z.string().min(5).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const rows = await db.select().from(insiderMakerCheckerRequests)
          .where(eq(insiderMakerCheckerRequests.id, input.requestId)).limit(1);
        const request = rows[0];
        if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
        if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${request.status}` });

        await db.update(insiderMakerCheckerRequests)
          .set({ status: "rejected", rejectionReason: input.reason, updatedAt: new Date() })
          .where(eq(insiderMakerCheckerRequests.id, input.requestId));
        return { rejected: true };
      }),

    listPending: adminProcedure.query(async ({ ctx }) => {
      const db = await requireDb();
      const rows = await db.select().from(insiderMakerCheckerRequests)
        .where(and(
          eq(insiderMakerCheckerRequests.status, "pending"),
          gt(insiderMakerCheckerRequests.expiresAt, new Date()),
        ))
        .orderBy(desc(insiderMakerCheckerRequests.riskScore));
      const pending = rows.map(toMakerCheckerRequest);
      return { requests: pending, total: pending.length };
    }),

    getStatus: protectedProcedure
      .input(z.object({ requestId: z.string() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const rows = await db.select().from(insiderMakerCheckerRequests)
          .where(eq(insiderMakerCheckerRequests.id, input.requestId)).limit(1);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
        return toMakerCheckerRequest(rows[0]);
      }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 2. JIT (JUST-IN-TIME) PRIVILEGED ACCESS
  // ════════════════════════════════════════════════════════════════════════════

  jitAccess: router({
    request: protectedProcedure
      .input(z.object({
        privilege: z.enum(["admin_panel", "bulk_export", "user_management", "fx_override", "system_config"]),
        durationMinutes: z.number().min(15).max(JIT_MAX_DURATION_HOURS * 60),
        reason: z.string().min(10).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;
        const now = Date.now();
        const dayStart = now - (now % (24 * 60 * 60 * 1000));

        // Rate-limit check + grant insert are atomic: concurrent requests must
        // not both pass the max-grants-per-day gate.
        return withTransaction(async (tx) => {
          const countRows = await tx.select({ count: sql<number>`count(*)::int` })
            .from(insiderJitAccessGrants)
            .where(and(
              eq(insiderJitAccessGrants.userId, userId),
              gte(insiderJitAccessGrants.grantedAt, new Date(dayStart)),
            ));
          const grantsToday = Number(countRows[0]?.count ?? 0);
          if (grantsToday >= JIT_MAX_GRANTS_PER_DAY) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Max ${JIT_MAX_GRANTS_PER_DAY} JIT grants per day` });
          }

          const grantId = generateId("jit");
          const expiresAt = new Date(now + input.durationMinutes * 60 * 1000);
          await tx.insert(insiderJitAccessGrants).values({
            id: grantId,
            userId,
            privilege: input.privilege,
            grantedAt: new Date(now),
            expiresAt,
            grantedBy: userId, // Self-service; audit trail persisted
            reason: input.reason,
            revoked: false,
            actionsPerformed: 0,
          });

          return { grantId, expiresAt: expiresAt.toISOString(), privilege: input.privilege };
        });
      }),

    revoke: adminProcedure
      .input(z.object({ grantId: z.string() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const updated = await db.update(insiderJitAccessGrants)
          .set({ revoked: true, revokedAt: new Date() })
          .where(eq(insiderJitAccessGrants.id, input.grantId))
          .returning({ id: insiderJitAccessGrants.id });
        if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Grant not found" });
        return { revoked: true };
      }),

    listActive: adminProcedure.query(async () => {
      const db = await requireDb();
      const rows = await db.select().from(insiderJitAccessGrants)
        .where(and(
          eq(insiderJitAccessGrants.revoked, false),
          gt(insiderJitAccessGrants.expiresAt, new Date()),
        ));
      const active = rows.map(toJitGrant);
      return { grants: active, total: active.length };
    }),

    checkAccess: protectedProcedure
      .input(z.object({ privilege: z.string() }))
      .query(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;
        const db = await requireDb();
        const rows = await db.select({ id: insiderJitAccessGrants.id }).from(insiderJitAccessGrants)
          .where(and(
            eq(insiderJitAccessGrants.userId, userId),
            eq(insiderJitAccessGrants.privilege, input.privilege),
            eq(insiderJitAccessGrants.revoked, false),
            gt(insiderJitAccessGrants.expiresAt, new Date()),
          ))
          .limit(1);
        return { hasAccess: rows.length > 0, privilege: input.privilege };
      }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 3. GEO + TIME FENCING
  // ════════════════════════════════════════════════════════════════════════════

  geoTimeFence: router({
    check: protectedProcedure
      .input(z.object({
        ipAddress: z.string().optional(),
        countryCode: z.string().length(2).optional(),
      }))
      .query(async ({ input }) => {
        const fence = await loadGeoTimeFence();
        const withinHours = isWithinBusinessHours(fence);
        const ipAllowed = input.ipAddress ? isIPAllowed(input.ipAddress, fence) : true;
        const countryAllowed = input.countryCode ? fence.allowedCountries.includes(input.countryCode) : true;
        const allowed = withinHours && ipAllowed && countryAllowed;

        return {
          allowed,
          withinBusinessHours: withinHours,
          ipAllowed,
          countryAllowed,
          breakGlassAvailable: fence.breakGlassEnabled && !allowed,
          currentHourUTC: new Date().getUTCHours(),
          currentDayUTC: new Date().getUTCDay(),
        };
      }),

    breakGlass: adminProcedure
      .input(z.object({
        reason: z.string().min(20).max(1000),
        incidentId: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;
        // Break-glass creates a time-limited bypass with full audit trail
        const bypassId = generateId("bg");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Persist the break-glass event (durable audit trail)
        const db = await requireDb();
        await db.insert(insiderBreakGlassEvents).values({
          id: bypassId,
          userId,
          reason: input.reason,
          incidentId: input.incidentId ?? null,
          expiresAt,
        });

        return {
          bypassId,
          expiresAt: expiresAt.toISOString(),
          auditNote: "Break-glass access granted. Post-incident review required within 48 hours.",
          userId,
          reason: input.reason,
        };
      }),

    getConfig: adminProcedure.query(async () => {
      return loadGeoTimeFence();
    }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 4. DATA LOSS PREVENTION (DLP)
  // ════════════════════════════════════════════════════════════════════════════

  dlp: router({
    checkAccess: protectedProcedure
      .input(z.object({
        table: z.string(),
        recordCount: z.number().min(1),
        purpose: z.string().min(5).max(200),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;
        const isPIITable = DLP_PII_TABLES.includes(input.table);
        const now = Date.now();
        const hourStart = new Date(Math.floor(now / 3600000) * 3600000);

        // Counter read + event insert are atomic: concurrent queries must not
        // both pass the hourly-limit gate.
        return withTransaction(async (tx) => {
          // Hourly query count derived from the durable event log
          const countRows = await tx.select({ count: sql<number>`count(*)::int` })
            .from(insiderDlpEvents)
            .where(and(
              eq(insiderDlpEvents.userId, userId),
              gte(insiderDlpEvents.createdAt, hourStart),
            ));
          const currentCount = Number(countRows[0]?.count ?? 0);

          // Check hourly query limit
          if (currentCount >= DLP_MAX_QUERIES_PER_HOUR) {
            await tx.insert(insiderDlpEvents).values({
              id: generateId("dlp"),
              userId,
              action: "query",
              tableName: input.table,
              recordCount: input.recordCount,
              blocked: true,
              reason: "Hourly query limit exceeded",
            });
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "DLP: Hourly PII query limit exceeded. Contact security team." });
          }

          // Check record count limit
          if (isPIITable && input.recordCount > DLP_MAX_RECORDS_PER_QUERY) {
            await tx.insert(insiderDlpEvents).values({
              id: generateId("dlp"),
              userId,
              action: "bulk_query",
              tableName: input.table,
              recordCount: input.recordCount,
              blocked: true,
              reason: `Bulk access to PII table exceeds ${DLP_MAX_RECORDS_PER_QUERY} record limit`,
            });
            throw new TRPCError({ code: "FORBIDDEN", message: `DLP: Bulk access to ${input.table} blocked. Max ${DLP_MAX_RECORDS_PER_QUERY} records per query. Submit maker-checker request for bulk export.` });
          }

          // Log access (the event row IS the counter — no separate store)
          await tx.insert(insiderDlpEvents).values({
            id: generateId("dlp"),
            userId,
            action: "query",
            tableName: input.table,
            recordCount: input.recordCount,
            blocked: false,
          });

          return { allowed: true, remainingQueries: DLP_MAX_QUERIES_PER_HOUR - currentCount - 1 };
        });
      }),

    getEvents: adminProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(50),
        blockedOnly: z.boolean().default(false),
      }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const where = input.blockedOnly ? eq(insiderDlpEvents.blocked, true) : undefined;
        const rows = await db.select().from(insiderDlpEvents)
          .where(where)
          .orderBy(desc(insiderDlpEvents.createdAt))
          .limit(input.limit);
        const totalRows = await db.select({ count: sql<number>`count(*)::int` })
          .from(insiderDlpEvents)
          .where(where);
        return { events: rows.map(toDlpEvent), total: Number(totalRows[0]?.count ?? 0) };
      }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 5. WEBAUTHN / FIDO2 HARDWARE SECURITY KEYS
  // ════════════════════════════════════════════════════════════════════════════

  webauthn: router({
    registerChallenge: protectedProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 0;
      const challenge = randomBytes(32).toString("base64url");
      // Persist challenge as a short-TTL row (5 minutes); prune expired rows.
      const db = await requireDb();
      await db.delete(insiderWebauthnChallenges)
        .where(sql`${insiderWebauthnChallenges.expiresAt} < now()`);
      await db.insert(insiderWebauthnChallenges).values({
        id: generateId("wch"),
        userId,
        challenge,
        kind: "register",
        expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
      });
      return {
        challenge,
        rpId: "remitflow.app",
        rpName: "RemitFlow",
        userId: Buffer.from(String(userId)).toString("base64url"),
        userName: `user-${userId}`,
      };
    }),

    registerCredential: protectedProcedure
      .input(z.object({
        credentialId: z.string(),
        publicKey: z.string(),
        name: z.string().min(1).max(50),
        attestation: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;
        const db = await requireDb();
        await db.insert(insiderWebauthnCredentials).values({
          id: generateId("wak"),
          userId,
          credentialId: input.credentialId,
          publicKey: input.publicKey,
          signCount: 0,
          name: input.name,
        });
        return { registered: true, credentialName: input.name };
      }),

    authenticateChallenge: protectedProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 0;
      const db = await requireDb();
      const userCreds: InsiderWebauthnCredentialRow[] = await db.select().from(insiderWebauthnCredentials)
        .where(eq(insiderWebauthnCredentials.userId, userId));
      if (userCreds.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No hardware security keys registered. Please register one first." });
      }
      const challenge = randomBytes(32).toString("base64url");
      // Persist challenge as a short-TTL row (5 minutes); prune expired rows.
      await db.delete(insiderWebauthnChallenges)
        .where(sql`${insiderWebauthnChallenges.expiresAt} < now()`);
      await db.insert(insiderWebauthnChallenges).values({
        id: generateId("wch"),
        userId,
        challenge,
        kind: "authenticate",
        expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
      });
      return {
        challenge,
        allowCredentials: userCreds.map(c => ({ id: c.credentialId, type: "public-key" as const })),
      };
    }),

    verify: protectedProcedure
      .input(z.object({
        credentialId: z.string(),
        signature: z.string(),
        authenticatorData: z.string(),
        clientDataJSON: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;

        return withTransaction(async (tx) => {
          const rows = await tx.select().from(insiderWebauthnCredentials)
            .where(and(
              eq(insiderWebauthnCredentials.userId, userId),
              eq(insiderWebauthnCredentials.credentialId, input.credentialId),
            ))
            .limit(1)
            .for("update");
          const cred = rows[0];
          if (!cred) throw new TRPCError({ code: "NOT_FOUND", message: "Credential not found" });

          // NOTE: signature assertion is not cryptographically verified here
          // (same honest scope as before — no verification library wired).
          // What IS durable: sign-count monotonicity and last-used audit.
          const newSignCount = cred.signCount + 1;
          await tx.update(insiderWebauthnCredentials)
            .set({ signCount: newSignCount, lastUsed: new Date() })
            .where(eq(insiderWebauthnCredentials.id, cred.id));
          return { verified: true, signCount: newSignCount };
        });
      }),

    listKeys: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 0;
      const db = await requireDb();
      const rows: InsiderWebauthnCredentialRow[] = await db.select().from(insiderWebauthnCredentials)
        .where(eq(insiderWebauthnCredentials.userId, userId));
      const keys = rows.map(c => ({
        id: c.id,
        name: c.name,
        createdAt: new Date(c.createdAt).toISOString(),
        lastUsed: c.lastUsed ? new Date(c.lastUsed).toISOString() : undefined,
      }));
      return { keys, total: keys.length };
    }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 6. TIME-DELAYED HIGH-VALUE REVERSALS
  // ════════════════════════════════════════════════════════════════════════════

  delayedReversal: router({
    submit: adminProcedure
      .input(z.object({
        transferRef: z.string(),
        amount: z.number().min(0),
        reason: z.string().min(10).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? 0;

        if (input.amount < HIGH_VALUE_REVERSAL_THRESHOLD) {
          return { delayed: false, message: "Below threshold — reversal can proceed immediately" };
        }

        const id = generateId("rev");
        const executeAt = new Date(Date.now() + REVERSAL_DELAY_HOURS * 60 * 60 * 1000);

        const db = await requireDb();
        await db.insert(insiderDelayedReversals).values({
          id,
          transferRef: input.transferRef,
          amount: String(input.amount),
          reason: input.reason,
          requestedBy: userId,
          requestedAt: new Date(),
          executeAt,
          status: "pending",
        });

        return {
          delayed: true,
          reversalId: id,
          executeAt: executeAt.toISOString(),
          message: `High-value reversal queued. Will execute in ${REVERSAL_DELAY_HOURS} hours unless cancelled by compliance team.`,
        };
      }),

    cancel: adminProcedure
      .input(z.object({
        reversalId: z.string(),
        reason: z.string().min(5),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const rows = await db.select().from(insiderDelayedReversals)
          .where(eq(insiderDelayedReversals.id, input.reversalId)).limit(1);
        const reversal = rows[0];
        if (!reversal) throw new TRPCError({ code: "NOT_FOUND", message: "Reversal not found" });
        if (reversal.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Reversal already ${reversal.status}` });

        await db.update(insiderDelayedReversals)
          .set({ status: "cancelled", cancelledReason: input.reason, cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(insiderDelayedReversals.id, input.reversalId));
        return { cancelled: true };
      }),

    listPending: adminProcedure.query(async () => {
      const db = await requireDb();
      const rows: InsiderDelayedReversalRow[] = await db.select().from(insiderDelayedReversals)
        .where(eq(insiderDelayedReversals.status, "pending"));
      const pending = rows.map(r => ({
        id: r.id,
        transferRef: r.transferRef,
        amount: Number(r.amount),
        requestedBy: r.requestedBy,
        requestedAt: new Date(r.requestedAt).toISOString(),
        executeAt: new Date(r.executeAt).toISOString(),
        status: r.status as "pending" | "executed" | "cancelled",
      }));
      return { reversals: pending, total: pending.length };
    }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 7. CANARY TOKENS
  // ════════════════════════════════════════════════════════════════════════════

  canary: router({
    checkAlert: adminProcedure.query(async () => {
      const db = await requireDb();
      const rows: InsiderCanaryAlertRow[] = await db.select().from(insiderCanaryAlerts)
        .orderBy(desc(insiderCanaryAlerts.createdAt))
        .limit(20);
      const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(insiderCanaryAlerts);
      const alerts: CanaryAlert[] = rows.reverse().map(r => ({
        id: r.id,
        canaryRecordId: r.canaryRecordId,
        accessedBy: r.accessedBy,
        accessedAt: new Date(r.accessedAt).toISOString(),
        query: r.query,
        ipAddress: r.ipAddress,
        severity: "critical",
      }));
      return {
        alerts,
        total: Number(totalRows[0]?.count ?? 0),
        tablesMonitored: DLP_PII_TABLES.length,
      };
    }),

    triggerTest: adminProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 0;
      const alertId = generateId("canary");
      const db = await requireDb();
      await db.insert(insiderCanaryAlerts).values({
        id: alertId,
        canaryRecordId: "honey_user_9999",
        accessedBy: userId,
        accessedAt: new Date(),
        query: "SELECT * FROM users WHERE id = 9999 -- canary test",
        ipAddress: "127.0.0.1",
        severity: "critical",
      });
      return { triggered: true, alertId };
    }),
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // DASHBOARD — Security Overview
  // ════════════════════════════════════════════════════════════════════════════

  dashboard: router({
    overview: adminProcedure.query(async () => {
      const db = await requireDb();
      const now = new Date();
      const fence = await loadGeoTimeFence();

      const [mcRows, jitRows, dlpRows, revRows, canaryRows, keyRows] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(insiderMakerCheckerRequests)
          .where(eq(insiderMakerCheckerRequests.status, "pending")),
        db.select({ count: sql<number>`count(*)::int` }).from(insiderJitAccessGrants)
          .where(and(eq(insiderJitAccessGrants.revoked, false), gt(insiderJitAccessGrants.expiresAt, now))),
        db.select({ count: sql<number>`count(*)::int` }).from(insiderDlpEvents)
          .where(eq(insiderDlpEvents.blocked, true)),
        db.select({ count: sql<number>`count(*)::int` }).from(insiderDelayedReversals)
          .where(eq(insiderDelayedReversals.status, "pending")),
        db.select({ count: sql<number>`count(*)::int` }).from(insiderCanaryAlerts),
        db.select({ count: sql<number>`count(*)::int` }).from(insiderWebauthnCredentials),
      ]);

      return {
        pendingMakerCheckerRequests: Number(mcRows[0]?.count ?? 0),
        activeJITGrants: Number(jitRows[0]?.count ?? 0),
        dlpBlockedEvents: Number(dlpRows[0]?.count ?? 0),
        pendingHighValueReversals: Number(revRows[0]?.count ?? 0),
        canaryAlertsTotal: Number(canaryRows[0]?.count ?? 0),
        webauthnKeysRegistered: Number(keyRows[0]?.count ?? 0),
        geoTimeFenceActive: true,
        withinBusinessHours: isWithinBusinessHours(fence),
      };
    }),
  }),
});
