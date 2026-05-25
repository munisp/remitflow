/**
 * v94 Features Router
 * A/B Testing Framework, Referral Bonuses, Document Vault, Rate Alert History
 */
import { TRPCError } from "@trpc/server";
import { auditedProcedure, auditedAdminProcedure, rateLimitedProcedure } from "../_core/trpc";
import { and, desc, eq, gte, lte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db.js";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import {
  abExperiments, abAssignments, abEvents,
  referralBonuses, documentVaultTable, rateAlertHistory, users,
  docReminderPrefs, docReminderLog,
} from "../../drizzle/schema.js";
import { storagePut } from "../storage.js";
import { randomBytes } from "crypto";

// ─── A/B Testing Router ───────────────────────────────────────────────────────
export const abTestingRouter = router({
  // Admin: list all experiments
  listExperiments: adminProcedure
    .input(z.object({ status: z.enum(["draft", "running", "paused", "completed", "all"]).default("all") }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { experiments: [] };
      const rows = input?.status && input.status !== "all"
        ? await db.select().from(abExperiments).where(eq(abExperiments.status, input.status as any)).orderBy(desc(abExperiments.createdAt))
        : await db.select().from(abExperiments).orderBy(desc(abExperiments.createdAt));
      return { experiments: rows };
    }),

  // Admin: create experiment
  createExperiment: adminProcedure
    .input(z.object({
      name: z.string().min(3).max(200),
      description: z.string().optional(),
      targetPage: z.string().optional(),
      variants: z.array(z.object({
        id: z.string(),
        name: z.string().min(1).max(100).trim(),
        weight: z.number().min(0).max(100),
        description: z.string().optional(),
      })).min(2),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const totalWeight = input.variants.reduce((s, v) => s + v.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Variant weights must sum to 100" });
      }
      const [exp] = await db.insert(abExperiments).values({
        name: input.name,
        description: input.description,
        variants: input.variants,
        targetPage: input.targetPage,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        createdBy: ctx.user.id,
        status: "draft",
      }).returning();
      return { experiment: exp };
    }),

  // Admin: update experiment status
  updateExperimentStatus: adminProcedure
    .input(z.object({
      experimentId: z.number(),
      status: z.enum(["draft", "running", "paused", "completed"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(abExperiments)
        .set({ status: input.status as any, updatedAt: new Date() })
        .where(eq(abExperiments.id, input.experimentId));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Public: assign variant for a user/session
  assignVariant: auditedProcedure
    .input(z.object({ experimentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { variantId: "control" };
      // Check existing assignment
      const [existing] = await db.select().from(abAssignments)
        .where(and(eq(abAssignments.experimentId, input.experimentId), eq(abAssignments.userId, ctx.user.id)))
        .limit(1);
      if (existing) return { variantId: existing.variantId, assignmentId: existing.id };
      // Get experiment
      const [exp] = await db.select().from(abExperiments).where(eq(abExperiments.id, input.experimentId)).limit(1);
      if (!exp || exp.status !== "running") return { variantId: "control" };
      // Weighted random assignment
      const variants = exp.variants as Array<{ id: string; weight: number }>;
      const rand = (Date.now() % 100);
      let cumulative = 0;
      let selectedVariant = variants[0].id;
      for (const v of variants) {
        cumulative += v.weight;
        if (rand <= cumulative) { selectedVariant = v.id; break; }
      }
      const [assignment] = await db.insert(abAssignments).values({
        experimentId: input.experimentId,
        userId: ctx.user.id,
        variantId: selectedVariant,
      }).returning();
      return { variantId: selectedVariant, assignmentId: assignment.id };
    }),

  // Track A/B event
  trackEvent: protectedProcedure
    .input(z.object({
      experimentId: z.number(),
      variantId: z.string(),
      eventType: z.enum(["impression", "click", "conversion", "signup", "transfer"]),
      assignmentId: z.number().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.insert(abEvents).values({
        experimentId: input.experimentId,
        assignmentId: input.assignmentId,
        variantId: input.variantId,
        eventType: input.eventType as any,
        metadata: input.metadata ?? {},
      });
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Admin: get experiment results
  getResults: adminProcedure
    .input(z.object({ experimentId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { results: [] };
      const [exp] = await db.select().from(abExperiments).where(eq(abExperiments.id, input.experimentId)).limit(1);
      if (!exp) throw new TRPCError({ code: "NOT_FOUND" });
      const events = await db.select().from(abEvents).where(eq(abEvents.experimentId, input.experimentId));
      const assignments = await db.select().from(abAssignments).where(eq(abAssignments.experimentId, input.experimentId));
      const variants = exp.variants as Array<{ id: string; name: string; weight: number }>;
      const results = variants.map(v => {
        const variantAssignments = assignments.filter((a: any) => a.variantId === v.id).length;
        const variantEvents = events.filter((e: any) => e.variantId === v.id);
        const impressions = variantEvents.filter((e: any) => e.eventType === "impression").length;
        const conversions = variantEvents.filter((e: any) => e.eventType === "conversion").length;
        const clicks = variantEvents.filter((e: any) => e.eventType === "click").length;
        return {
          variantId: v.id,
          variantName: v.name,
          weight: v.weight,
          assignments: variantAssignments,
          impressions,
          clicks,
          conversions,
          ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : "0.00",
          conversionRate: impressions > 0 ? ((conversions / impressions) * 100).toFixed(2) : "0.00",
        };
      });
      return { experiment: exp, results };
    }),
});

// ─── Referral Bonuses Router ──────────────────────────────────────────────────
export const referralBonusRouter = router({
  // List my referral bonuses
  list: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { bonuses: [], totalEarned: 0, pendingAmount: 0 };
      const rows = await db.select().from(referralBonuses)
        .where(eq(referralBonuses.referrerId, ctx.user.id))
        .orderBy(desc(referralBonuses.createdAt));
      const totalEarned = rows.filter((r: any) => r.status === "paid").reduce((s: any, r: any) => s + Number(r.referrerBonus ?? 0), 0);
      const pendingAmount = rows.filter((r: any) => r.status === "pending").reduce((s: any, r: any) => s + Number(r.referrerBonus ?? 0), 0);
      return { bonuses: rows, totalEarned, pendingAmount };
    }),

  // Admin: list all bonuses
  adminList: adminProcedure
    .input(z.object({ status: z.string().optional(), page: z.number().default(1) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { bonuses: [], total: 0 };
      const rows = await db.select().from(referralBonuses).orderBy(desc(referralBonuses.createdAt)).limit(50).offset(((input?.page ?? 1) - 1) * 50);
      return { bonuses: rows, total: rows.length };
    }),

  // Admin: approve/pay bonus
  updateStatus: adminProcedure
    .input(z.object({
      bonusId: z.number(),
      status: z.enum(["approved", "paid", "rejected"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(referralBonuses)
        .set({
          status: input.status as any,
          notes: input.notes,
          paidAt: input.status === "paid" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(referralBonuses.id, input.bonusId));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Leaderboard
  leaderboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { leaders: [] };
    const rows = await db.select({
      referrerId: referralBonuses.referrerId,
      totalBonuses: sql<number>`COUNT(*)`,
      totalEarned: sql<number>`SUM(CAST(${referralBonuses.referrerBonus} AS DECIMAL))`,
      name: users.name,
      email: users.email,
    }).from(referralBonuses)
      .innerJoin(users, eq(users.id, referralBonuses.referrerId))
      .where(eq(referralBonuses.status, "paid"))
      .groupBy(referralBonuses.referrerId, users.name, users.email)
      .orderBy(desc(sql`SUM(CAST(${referralBonuses.referrerBonus} AS DECIMAL))`))
      .limit(20);
    const leaders = rows.map((r: any, idx: any) => ({
      rank: idx + 1,
      userId: r.referrerId,
      name: r.name ?? r.email ?? `User #${r.referrerId}`,
      totalReferrals: Number(r.totalBonuses),
      totalEarned: Number(r.totalEarned ?? 0),
    }));
    return { leaders };
  }),
});

// ─── Document Vault Router ────────────────────────────────────────────────────
export const documentVaultRouter = router({
  // List my documents
  list: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { documents: [] };
      const rows = await db.select().from(documentVaultTable)
        .where(eq(documentVaultTable.userId, ctx.user.id))
        .orderBy(desc(documentVaultTable.createdAt));
      const filtered = input?.category
        ? rows.filter((r: any) => r.category === input.category)
        : rows;
      return { documents: filtered };
    }),

  // Upload document
  upload: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      category: z.enum(["identity", "address", "financial", "compliance", "contract", "other"]).default("other"),
      fileBase64: z.string(),
      mimeType: z.string().default("application/octet-stream"),
      fileName: z.string(),
      expiresAt: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const suffix = randomBytes(8).toString("hex");
      const fileKey = `vault/${ctx.user.id}/${suffix}-${input.fileName}`;
      const buffer = Buffer.from(input.fileBase64, "base64");
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      const [doc] = await db.insert(documentVaultTable).values({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        category: input.category as any,
        fileUrl: url,
        fileKey,
        mimeType: input.mimeType,
        fileSize: buffer.length,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        tags: input.tags ?? [],
      }).returning();
      return { document: doc };
    }),

  // Share document with partner/user
  share: protectedProcedure
    .input(z.object({
      documentId: z.number(),
      shareWithEmail: z.string().email(),
      accessLevel: z.enum(["view", "download"]).default("view"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [doc] = await db.select().from(documentVaultTable)
        .where(and(eq(documentVaultTable.id, input.documentId), eq(documentVaultTable.userId, ctx.user.id)))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const sharedWith = [...(doc.sharedWith ?? []), {
        email: input.shareWithEmail,
        userId: 0,
        accessLevel: input.accessLevel,
        sharedAt: new Date().toISOString(),
      }];
      await db.update(documentVaultTable)
        .set({ sharedWith, status: "shared" as any, updatedAt: new Date() })
        .where(eq(documentVaultTable.id, input.documentId));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Set expiry
  setExpiry: auditedProcedure
    .input(z.object({ documentId: z.number(), expiresAt: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(documentVaultTable)
        .set({ expiresAt: new Date(input.expiresAt), updatedAt: new Date() })
        .where(and(eq(documentVaultTable.id, input.documentId), eq(documentVaultTable.userId, ctx.user.id)));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Delete document
  delete: auditedProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(documentVaultTable)
        .where(and(eq(documentVaultTable.id, input.documentId), eq(documentVaultTable.userId, ctx.user.id)));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Archive document
  archive: auditedProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(documentVaultTable)
        .set({ status: "archived" as any, updatedAt: new Date() })
        .where(and(eq(documentVaultTable.id, input.documentId), eq(documentVaultTable.userId, ctx.user.id)));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Get documents expiring within N days
  expiringDocuments: protectedProcedure
    .input(z.object({ daysAhead: z.number().min(1).max(90).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { documents: [] };
      const cutoff = new Date(Date.now() + (input?.daysAhead ?? 30) * 24 * 60 * 60 * 1000);
      const rows = await db.select().from(documentVaultTable)
        .where(and(
          eq(documentVaultTable.userId, ctx.user.id),
          eq(documentVaultTable.status, "active" as any),
          isNotNull(documentVaultTable.expiresAt),
          lte(documentVaultTable.expiresAt, cutoff)
        ))
        .orderBy(documentVaultTable.expiresAt);
      const now = new Date();
      return {
        documents: rows.map((d: any) => ({
          ...d,
          daysLeft: d.expiresAt ? Math.ceil((d.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
        })),
      };
    }),

  // Get reminder preferences
  getReminderPrefs: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const [prefs] = await db.select().from(docReminderPrefs).where(eq(docReminderPrefs.userId, ctx.user.id)).limit(1);
    return prefs ?? {
      remind30d: true, remind14d: true, remind7d: true, remind3d: true, remind1d: true,
      notifyEmail: true, notifyInApp: true, notifyPush: false,
    };
  }),

  // Update reminder preferences
  updateReminderPrefs: protectedProcedure
    .input(z.object({
      remind30d: z.boolean().optional(),
      remind14d: z.boolean().optional(),
      remind7d: z.boolean().optional(),
      remind3d: z.boolean().optional(),
      remind1d: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      notifyPush: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db.select({ id: docReminderPrefs.id }).from(docReminderPrefs).where(eq(docReminderPrefs.userId, ctx.user.id)).limit(1);
      if (existing) {
        await db.update(docReminderPrefs)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(docReminderPrefs.userId, ctx.user.id));
      } else {
        await db.insert(docReminderPrefs).values({
          userId: ctx.user.id,
          remind30d: input.remind30d ?? true,
          remind14d: input.remind14d ?? true,
          remind7d: input.remind7d ?? true,
          remind3d: input.remind3d ?? true,
          remind1d: input.remind1d ?? true,
          notifyEmail: input.notifyEmail ?? true,
          notifyInApp: input.notifyInApp ?? true,
          notifyPush: input.notifyPush ?? false,
        });
      }
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // List reminder log (history of sent reminders)
  reminderLog: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { logs: [] };
      const rows = await db.select({
        id: docReminderLog.id,
        documentId: docReminderLog.documentId,
        reminderType: docReminderLog.reminderType,
        channel: docReminderLog.channel,
        status: docReminderLog.status,
        sentAt: docReminderLog.sentAt,
        docName: documentVaultTable.name,
        docCategory: documentVaultTable.category,
      })
        .from(docReminderLog)
        .leftJoin(documentVaultTable, eq(docReminderLog.documentId, documentVaultTable.id))
        .where(eq(docReminderLog.userId, ctx.user.id))
        .orderBy(desc(docReminderLog.sentAt))
        .limit(input?.limit ?? 50);
      return { logs: rows };
    }),

  // Manually trigger reminder scan (admin only)
  triggerReminderScan: auditedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      const { sendDocumentVaultExpiryReminders } = await import("../scheduler.js");
      await sendDocumentVaultExpiryReminders();
      return { success: true, message: "Reminder scan completed" };
    } catch (err: any) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
    }
  }),
});

// ─── Rate Alert History Router ────────────────────────────────────────────────
export const rateAlertHistoryRouter = router({
  // List my alert history
  list: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().optional(),
      toCurrency: z.string().optional(),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { history: [] };
      const rows = await db.select().from(rateAlertHistory)
        .where(eq(rateAlertHistory.userId, ctx.user.id))
        .orderBy(desc(rateAlertHistory.triggeredAt))
        .limit(input?.limit ?? 50);
      return { history: rows };
    }),

  // Snooze alert
  snooze: auditedProcedure
    .input(z.object({
      alertHistoryId: z.number(),
      snoozeHours: z.number().min(1).max(168).default(24),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const snoozedUntil = new Date(Date.now() + input.snoozeHours * 3600 * 1000);
      await db.update(rateAlertHistory)
        .set({ status: "snoozed" as any, snoozedUntil })
        .where(and(eq(rateAlertHistory.id, input.alertHistoryId), eq(rateAlertHistory.userId, ctx.user.id)));
      return { success: true, snoozedUntil };
    }),

  // Dismiss alert
  dismiss: auditedProcedure
    .input(z.object({ alertHistoryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(rateAlertHistory)
        .set({ status: "dismissed" as any })
        .where(and(eq(rateAlertHistory.id, input.alertHistoryId), eq(rateAlertHistory.userId, ctx.user.id)));
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // Get stats
  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { total: 0, triggered: 0, snoozed: 0, dismissed: 0 };
    const rows = await db.select().from(rateAlertHistory).where(eq(rateAlertHistory.userId, ctx.user.id));
    return {
      total: rows.length,
      triggered: rows.filter((r: any) => r.status === "triggered").length,
      snoozed: rows.filter((r: any) => r.status === "snoozed").length,
      dismissed: rows.filter((r: any) => r.status === "dismissed").length,
    };
  }),
});
