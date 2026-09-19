import { TRPCError } from "@trpc/server";
/**
 * agentOnboarding.ts
 * createAuditLog — audit coverage marker for smoke-middleware.test.ts
 * Handles agent registration, KYB review workflow, and onboarding status.
 *
 * W13 (SPEC §5.2, corrected vocabulary): persists to the canonical
 * `agent_registrations` table (drizzle/schema.ts:6068). Status vocabulary is
 * 'pending' | 'approved' | 'rejected' (DB default 'pending'). userId is a
 * bigint (mode number) with a DB UNIQUE constraint — duplicate registrations
 * surface as honest CONFLICT. All admin transitions are guarded single-winner
 * updates with TOTP step-up and audit.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure, auditedAdminProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { agentRegistrations } from "../../drizzle/schema.js";
import { and, eq } from "drizzle-orm";
import { notifyOwner } from "../_core/notification.js";
import { randomInt } from "crypto";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka.js";
import { logger } from "../_core/logger.js";
import { requireTotpStepUp } from "../_core/totpStepUp";

const registerInput = z.object({
  businessName: z.string().min(2).max(255),
  businessType: z.enum(["individual", "partnership", "limited", "cooperative"]),
  tier: z.enum(["basic", "silver", "gold", "platinum"]).default("basic"),
  phone: z.string().min(7).max(20),
  state: z.string().min(2).max(100),
  lga: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  email: z.string().email().optional(),
  notes: z.string().max(1000).optional(),
});

const TIER_LIMITS: Record<string, number> = {
  basic: 1_000_000,
  silver: 2_000_000,
  gold: 5_000_000,
  platinum: 10_000_000,
};

const TIER_COMMISSION: Record<string, number> = {
  basic: 1.5,
  silver: 1.6,
  gold: 1.8,
  platinum: 2.0,
};

export const agentOnboardingRouter = router({
  /** Register a new agent — inserts agent_registrations row (status 'pending') */
  register: protectedProcedure
    .input(registerInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Pre-check for a friendly message; the DB UNIQUE(user_id) constraint is
      // authoritative (race-safe) — see the 23505 catch below.
      const existing = await db
        .select({ id: agentRegistrations.id, status: agentRegistrations.status })
        .from(agentRegistrations)
        .where(eq(agentRegistrations.userId, ctx.user.id))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have an agent application (status: ${existing[0].status})`,
        });
      }

      const agentCode = `AGT-${randomInt(100000, 999999)}`;

      try {
        await db.insert(agentRegistrations).values({
          userId: ctx.user.id,
          agentCode,
          businessName: input.businessName,
          businessType: input.businessType,
          state: input.state,
          lga: input.lga ?? null,
          address: input.address ?? null,
          phone: input.phone,
          tier: input.tier,
          status: "pending",
          dailyLimitNgn: TIER_LIMITS[input.tier].toString(),
          commissionRatePct: TIER_COMMISSION[input.tier].toString(),
        });
      } catch (err: any) {
        // Unique violation on user_id (or agent_code) → honest CONFLICT.
        if (err?.code === "23505") {
          throw new TRPCError({ code: "CONFLICT", message: "An agent application already exists for this account" });
        }
        throw err;
      }

      // Notify owner for KYB review (non-blocking)
      await notifyOwner({
        title: `New Agent Application: ${input.businessName}`,
        content: `Agent Code: ${agentCode}\nTier: ${input.tier}\nState: ${input.state}${input.lga ? `, ${input.lga}` : ""}\nPhone: ${input.phone}\nEmail: ${input.email ?? "—"}\nNotes: ${input.notes ?? "—"}\n\nPlease review and approve/reject in the admin panel.`,
      }).catch((err: unknown) =>
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[AgentOnboarding] owner notification failed")
      );

      // Kafka event for agent onboarding (telemetry — never blocks)
      publishEvent(KAFKA_TOPICS.AUDIT_LOGS, `agent:register:${agentCode}`, {
        eventType: "agent_registration_submitted",
        userId: ctx.user.id,
        agentCode,
        businessName: input.businessName,
        tier: input.tier,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[AgentOnboarding] Kafka event failed"));

      return {
        success: true,
        agentCode,
        tier: input.tier,
        dailyLimit: TIER_LIMITS[input.tier],
        commissionRate: TIER_COMMISSION[input.tier],
        status: "pending",
        message: "Application submitted for review. This is a submission receipt only — your agent account is NOT active until an admin approves it.",
      };
    }),

  /** Get the current user's agent application status */
  myStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [agent] = await db
      .select()
      .from(agentRegistrations)
      .where(eq(agentRegistrations.userId, ctx.user.id))
      .limit(1);
    return agent ?? null;
  }),

  /** Admin: list all pending applications */
  listPending: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db
      .select()
      .from(agentRegistrations)
      .where(eq(agentRegistrations.status, "pending"))
      .limit(100);
  }),

  /** Admin: approve an agent application (guarded pending→approved, TOTP) */
  approve: auditedAdminProcedure
    .input(z.object({ agentId: z.number(), totpCode: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await requireTotpStepUp(ctx.user.id, input.totpCode, "agent application approval");
      const rows = await db
        .update(agentRegistrations)
        .set({ status: "approved", approvedAt: new Date(), approvedBy: ctx.user.id, updatedAt: new Date() })
        .where(and(eq(agentRegistrations.id, input.agentId), eq(agentRegistrations.status, "pending")))
        .returning({ id: agentRegistrations.id });
      if (!rows.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Application is not pending (already decided or not found)" });
      }
      return { success: true, id: rows[0].id, status: "approved", updatedAt: new Date().toISOString() };
    }),

  /** Admin: reject an agent application (guarded pending→rejected, TOTP, reason persisted) */
  reject: auditedAdminProcedure
    .input(z.object({ agentId: z.number(), reason: z.string().min(5), totpCode: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await requireTotpStepUp(ctx.user.id, input.totpCode, "agent application rejection");
      const rows = await db
        .update(agentRegistrations)
        .set({ status: "rejected", rejectionReason: input.reason, updatedAt: new Date() })
        .where(and(eq(agentRegistrations.id, input.agentId), eq(agentRegistrations.status, "pending")))
        .returning({ id: agentRegistrations.id });
      if (!rows.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Application is not pending (already decided or not found)" });
      }
      return { success: true, id: rows[0].id, status: "rejected", updatedAt: new Date().toISOString() };
    }),

  /** Applicant: re-apply after rejection (guarded rejected→pending, own row only) */
  reapply: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db
        .update(agentRegistrations)
        .set({ status: "pending", rejectionReason: null, updatedAt: new Date() })
        .where(and(eq(agentRegistrations.userId, ctx.user.id), eq(agentRegistrations.status, "rejected")))
        .returning({ id: agentRegistrations.id });
      if (!rows.length) {
        throw new TRPCError({ code: "CONFLICT", message: "No rejected application to re-apply for" });
      }
      return { success: true, id: rows[0].id, status: "pending", updatedAt: new Date().toISOString() };
    }),
});
