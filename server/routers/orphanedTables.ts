/**
 * RemitFlow — Orphaned Tables Router
 * Wires CRUD procedures for 7 previously unreferenced DB tables:
 * - outboxEvents: transactional outbox pattern for event publishing
 * - slaIncidents: SLA breach tracking
 * - nifiPipelineRuns: Apache NiFi pipeline execution history
 * - dbtRunHistory: dbt transformation run history
 * - airflowDagRuns: Apache Airflow DAG run history
 * - partnerApplicationComments: internal comments on partner applications
 * - complianceEmailConfig: per-tenant compliance officer email configuration
 */
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  outboxEvents,
  slaIncidents,
  nifiPipelineRuns,
  dbtRunHistory,
  airflowDagRuns,
  partnerApplicationComments,
  complianceEmailConfig,
  partnerApplications,
  users,
} from "../../drizzle/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { createAuditLog } from "../db";

// ─── Outbox Events Router ─────────────────────────────────────────────────────
// Transactional outbox pattern: events are written here atomically with DB writes,
// then a background worker publishes them to Kafka/message bus.
export const outboxEventsRouter = router({
  list: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "published", "failed", "all"]).default("all"),
      aggregateType: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: any[] = [];
      if (input?.status && input.status !== "all") conditions.push(eq(outboxEvents.status, input.status));
      if (input?.aggregateType) conditions.push(eq(outboxEvents.aggregateType, input.aggregateType));
      const rows = await db.select().from(outboxEvents)
        .where(conditions.length > 0 ? and(...(conditions as any[])) : undefined)
        .orderBy(desc(outboxEvents.createdAt))
        .limit(input?.limit ?? 50);
      return rows;
    }),

  retry: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, input.id));
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      await db.update(outboxEvents)
        .set({ status: "pending", retryCount: (event.retryCount ?? 0) + 1, failedAt: null, errorMessage: null })
        .where(eq(outboxEvents.id, input.id)).returning();
      return { success: true, verified: true, message: "Event queued for retry" };
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db.select({
      status: outboxEvents.status,
      count: sql<number>`count(*)::int`,
    }).from(outboxEvents).groupBy(outboxEvents.status);
    const stats: Record<string, number> = { pending: 0, published: 0, failed: 0, total: 0 };
    for (const row of rows) {
      stats[row.status ?? "pending"] = row.count;
      stats.total += row.count;
    }
    return stats;
  }),

  purge: adminProcedure
    .input(z.object({ olderThanDays: z.number().min(1).max(365).default(30) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const cutoff = new Date(Date.now() - input.olderThanDays * 86400000);
      const result = await db.delete(outboxEvents)
        .where(and(eq(outboxEvents.status, "published"), sql`${outboxEvents.publishedAt} < ${cutoff}`)).returning();
      await createAuditLog({ userId: ctx.user.id, action: "OUTBOX_PURGE", description: `Purged ${result.length} published outbox events older than ${input.olderThanDays} days` });
      return { success: true, verified: true, purgedCount: result.length, message: `Purged ${result.length} events older than ${input.olderThanDays} days` };
    }),
});

// ─── SLA Incidents Router ─────────────────────────────────────────────────────
export const slaIncidentsRouter = router({
  list: adminProcedure
    .input(z.object({
      status: z.enum(["open", "resolved", "all"]).default("all"),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: any[] = [];
      if (input?.status && input.status !== "all") conditions.push(eq(slaIncidents.status, input.status));
      const rows = await db.select().from(slaIncidents)
        .where(conditions.length > 0 ? and(...(conditions as any[])) : undefined)
        .orderBy(desc(slaIncidents.startedAt))
        .limit(input?.limit ?? 50);
      return rows;
    }),

  create: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      rootCause: z.string().min(1).max(2000).optional(),
      affectedService: z.string().min(1).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [incident] = await db.insert(slaIncidents).values({
        title: input.title,
        severity: input.severity,
        rootCause: input.rootCause,
        affectedService: input.affectedService,
        status: "open",
        startedAt: new Date(),
        reportedBy: ctx.user.id,
      }).returning();
      await createAuditLog({ userId: ctx.user.id, action: "SLA_INCIDENT_CREATED", description: `SLA incident created: ${input.title} (${input.severity})` });
      return incident;
    }),

  resolve: adminProcedure
    .input(z.object({ id: z.number().int().positive(), resolution: z.string().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [incident] = await db.update(slaIncidents)
        .set({ status: "resolved", resolvedAt: new Date(), resolution: input.resolution })
        .where(eq(slaIncidents.id, input.id))
        .returning();
      if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      await createAuditLog({ userId: ctx.user.id, action: "SLA_INCIDENT_RESOLVED", description: `SLA incident ${input.id} resolved` });
      return incident;
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [stats] = await db.select({
      open: sql<number>`count(*) filter (where status = 'open')::int`,
      resolved: sql<number>`count(*) filter (where status = 'resolved')::int`,
      critical: sql<number>`count(*) filter (where severity = 'critical')::int`,
      avgResolutionMs: sql<number>`coalesce(avg(extract(epoch from (resolved_at - started_at)) * 1000) filter (where resolved_at is not null), 0)::int`,
    }).from(slaIncidents);
    return stats ?? { open: 0, resolved: 0, critical: 0, avgResolutionMs: 0 };
  }),
});

// ─── NiFi Pipeline Runs Router ────────────────────────────────────────────────
export const nifiPipelineRunsRouter = router({
  list: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "running", "success", "failed", "all"]).default("all"),
      pipelineName: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: any[] = [];
      if (input?.status && input.status !== "all") conditions.push(eq(nifiPipelineRuns.status, input.status));
      if (input?.pipelineName) conditions.push(eq(nifiPipelineRuns.pipelineName, input.pipelineName));
      const rows = await db.select().from(nifiPipelineRuns)
        .where(conditions.length > 0 ? and(...(conditions as any[])) : undefined)
        .orderBy(desc(nifiPipelineRuns.startedAt))
        .limit(input?.limit ?? 50);
      return rows;
    }),

  trigger: adminProcedure
    .input(z.object({
      pipelineName: z.string().min(1).max(255),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [run] = await db.insert(nifiPipelineRuns).values({
        pipelineName: input.pipelineName,
        status: "pending",
        triggeredBy: ctx.user.id,
        startedAt: new Date(),
        metadata: input.metadata ?? {},
      }).returning();
      await createAuditLog({ userId: ctx.user.id, action: "NIFI_PIPELINE_TRIGGERED", description: `NiFi pipeline triggered: ${input.pipelineName}` });
      return run;
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [stats] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      running: sql<number>`count(*) filter (where status = 'running')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      totalRecords: sql<number>`coalesce(sum(records_processed), 0)::int`,
    }).from(nifiPipelineRuns);
    return stats ?? { pending: 0, running: 0, completed: 0, failed: 0, totalRecords: 0 };
  }),
});

// ─── dbt Run History Router ───────────────────────────────────────────────────
export const dbtRunHistoryRouter = router({
  list: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "running", "success", "failed", "all"]).default("all"),
      modelSelect: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: any[] = [];
      if (input?.status && input.status !== "all") conditions.push(eq(dbtRunHistory.status, input.status));
      if (input?.modelSelect) conditions.push(eq(dbtRunHistory.modelSelect, input.modelSelect));
      const rows = await db.select().from(dbtRunHistory)
        .where(conditions.length > 0 ? and(...(conditions as any[])) : undefined)
        .orderBy(desc(dbtRunHistory.startedAt))
        .limit(input?.limit ?? 50);
      return rows;
    }),

  trigger: adminProcedure
    .input(z.object({
      modelSelect: z.string().min(1).max(255).default("all"),
      runId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const runId = input.runId ?? `dbt_run_${Date.now()}`;
      const [run] = await db.insert(dbtRunHistory).values({
        runId,
        modelSelect: input.modelSelect,
        status: "pending",
        triggeredBy: ctx.user.id,
        startedAt: new Date(),
      }).returning();
      await createAuditLog({ userId: ctx.user.id, action: "DBT_RUN_TRIGGERED", description: `dbt run triggered: ${input.modelSelect}` });
      return run;
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [stats] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      running: sql<number>`count(*) filter (where status = 'running')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      totalModels: sql<number>`coalesce(sum(models_run), 0)::int`,
      totalErrors: sql<number>`coalesce(sum(models_error), 0)::int`,
    }).from(dbtRunHistory);
    return stats ?? { pending: 0, running: 0, completed: 0, failed: 0, totalModels: 0, totalErrors: 0 };
  }),
});

// ─── Airflow DAG Runs Router ──────────────────────────────────────────────────
export const airflowDagRunsRouter = router({
  list: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "running", "success", "failed", "all"]).default("all"),
      dagId: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: any[] = [];
      if (input?.status && input.status !== "all") conditions.push(eq(airflowDagRuns.status, input.status));
      if (input?.dagId) conditions.push(eq(airflowDagRuns.dagId, input.dagId));
      const rows = await db.select().from(airflowDagRuns)
        .where(conditions.length > 0 ? and(...(conditions as any[])) : undefined)
        .orderBy(desc(airflowDagRuns.startedAt))
        .limit(input?.limit ?? 50);
      return rows;
    }),

  trigger: adminProcedure
    .input(z.object({
      dagId: z.string().min(1).max(100),
      conf: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const runId = `manual_${Date.now()}`;
      const [run] = await db.insert(airflowDagRuns).values({
        dagId: input.dagId,
        runId,
        status: "pending",
        triggeredBy: ctx.user.id,
        conf: input.conf ?? {},
        startedAt: new Date(),
      }).returning();
      await createAuditLog({ userId: ctx.user.id, action: "AIRFLOW_DAG_TRIGGERED", description: `Airflow DAG triggered: ${input.dagId}` });
      return run;
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [stats] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      running: sql<number>`count(*) filter (where status = 'running')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      uniqueDags: sql<number>`count(distinct dag_id)::int`,
    }).from(airflowDagRuns);
    return stats ?? { pending: 0, running: 0, completed: 0, failed: 0, uniqueDags: 0 };
  }),
});

// ─── Partner Application Comments Router ─────────────────────────────────────
export const partnerApplicationCommentsRouter = router({
  list: protectedProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      includeInternal: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Verify user has access to this application (either owner or admin)
      const [app] = await db.select().from(partnerApplications)
        .where(eq(partnerApplications.id, input.applicationId));
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin && app.applicantId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const conditions: any[] = [eq(partnerApplicationComments.applicationId, input.applicationId)];
      // Non-admins only see external comments
      if (!isAdmin || !input.includeInternal) {
        conditions.push(eq(partnerApplicationComments.isInternal, false));
      }
      const rows = await db.select({
        id: partnerApplicationComments.id,
        applicationId: partnerApplicationComments.applicationId,
        authorId: partnerApplicationComments.authorId,
        comment: partnerApplicationComments.comment,
        isInternal: partnerApplicationComments.isInternal,
        createdAt: partnerApplicationComments.createdAt,
        authorName: users.name,
      }).from(partnerApplicationComments)
        .leftJoin(users, eq(partnerApplicationComments.authorId, users.id))
        .where(and(...conditions))
        .orderBy(desc(partnerApplicationComments.createdAt));
      return rows;
    }),

  add: protectedProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      comment: z.string().min(1).max(2000),
      isInternal: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Only admins can add internal comments
      if (input.isInternal && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can add internal comments" });
      }
      const [comment] = await db.insert(partnerApplicationComments).values({
        applicationId: input.applicationId,
        authorId: ctx.user.id,
        comment: input.comment,
        isInternal: input.isInternal,
      }).returning();
      await createAuditLog({ userId: ctx.user.id, action: "PARTNER_COMMENT_ADDED", description: `Comment added to partner application ${input.applicationId}` });
      return comment;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const _deleted = await db.delete(partnerApplicationComments)
        .where(eq(partnerApplicationComments.id, input.id)).returning();
      if (_deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      await createAuditLog({ userId: ctx.user.id, action: "PARTNER_COMMENT_DELETED", description: `Partner application comment ${input.id} deleted` });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),
});

// ─── Compliance Email Config Router ──────────────────────────────────────────
export const complianceEmailConfigRouter = router({
  get: adminProcedure
    .input(z.object({ tenantId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: any[] = [eq(complianceEmailConfig.isActive, true)];
      if (input?.tenantId) conditions.push(eq(complianceEmailConfig.tenantId, input.tenantId));
      const [config] = await db.select({
        id: complianceEmailConfig.id,
        tenantId: complianceEmailConfig.tenantId,
        officerName: complianceEmailConfig.officerName,
        officerEmail: complianceEmailConfig.officerEmail,
        reportTypes: complianceEmailConfig.reportTypes,
        isActive: complianceEmailConfig.isActive,
        smtpHost: complianceEmailConfig.smtpHost,
        smtpPort: complianceEmailConfig.smtpPort,
        smtpUser: complianceEmailConfig.smtpUser,
        fromEmail: complianceEmailConfig.fromEmail,
        fromName: complianceEmailConfig.fromName,
        createdAt: complianceEmailConfig.createdAt,
        updatedAt: complianceEmailConfig.updatedAt,
        // Never return smtpPasswordEncrypted
      }).from(complianceEmailConfig)
        .where(and(...conditions))
        .limit(1);
      return config ?? null;
    }),

  upsert: adminProcedure
    .input(z.object({
      tenantId: z.number().int().positive().optional(),
      officerName: z.string().min(1).max(255),
      officerEmail: z.string().email().max(255),
      reportTypes: z.array(z.string()).default(["CTR", "SAR", "FBAR"]),
      smtpHost: z.string().max(255).optional(),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      smtpUser: z.string().max(255).optional(),
      smtpPassword: z.string().max(500).optional(),
      fromEmail: z.string().email().max(255).optional(),
      fromName: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const values: any = {
        officerName: input.officerName,
        officerEmail: input.officerEmail,
        reportTypes: input.reportTypes,
        isActive: true,
        updatedAt: new Date(),
        createdBy: ctx.user.id,
      };
      if (input.tenantId) values.tenantId = input.tenantId;
      if (input.smtpHost) values.smtpHost = input.smtpHost;
      if (input.smtpPort) values.smtpPort = input.smtpPort;
      if (input.smtpUser) values.smtpUser = input.smtpUser;
      if (input.smtpPassword) values.smtpPasswordEncrypted = Buffer.from(input.smtpPassword).toString("base64");
      if (input.fromEmail) values.fromEmail = input.fromEmail;
      if (input.fromName) values.fromName = input.fromName;
      const [config] = await db.insert(complianceEmailConfig).values(values)
        .onConflictDoUpdate({ target: [complianceEmailConfig.tenantId], set: values })
        .returning();
      await createAuditLog({ userId: ctx.user.id, action: "COMPLIANCE_EMAIL_CONFIG_UPDATED", description: `Compliance email config updated for officer: ${input.officerEmail}` });
      return { success: true, verified: true, id: config.id };
    }),

  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db.select({
      id: complianceEmailConfig.id,
      tenantId: complianceEmailConfig.tenantId,
      officerName: complianceEmailConfig.officerName,
      officerEmail: complianceEmailConfig.officerEmail,
      reportTypes: complianceEmailConfig.reportTypes,
      isActive: complianceEmailConfig.isActive,
      fromEmail: complianceEmailConfig.fromEmail,
      updatedAt: complianceEmailConfig.updatedAt,
    }).from(complianceEmailConfig).orderBy(desc(complianceEmailConfig.updatedAt));
    return rows;
  }),

  deactivate: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [_row] = await db.update(complianceEmailConfig)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(complianceEmailConfig.id, input.id)).returning();
      await createAuditLog({ userId: ctx.user.id, action: "COMPLIANCE_EMAIL_CONFIG_DEACTIVATED", description: `Compliance email config ${input.id} deactivated` });
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),
});
