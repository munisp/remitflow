/**
 * complianceAnalytics.ts — Compliance Analytics Router
 * Provides time-series, resolution time distribution, and false-positive rate
 * analytics for the /admin/compliance-analytics dashboard.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { complianceAlerts } from "../../drizzle/schema";
import { sql, gte, and, eq } from "drizzle-orm";

export const complianceAnalyticsRouter = router({
  // Time-series: alerts created per day for the last N days
  timeSeries: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db.execute(sql`
        SELECT
          DATE("createdAt") AS day,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
          COUNT(*) FILTER (WHERE severity = 'high') AS high,
          COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
          COUNT(*) FILTER (WHERE severity = 'low') AS low,
          COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
        FROM compliance_alerts
        WHERE "createdAt" >= ${since}
        GROUP BY DATE("createdAt")
        ORDER BY day ASC
      `);
      return (rows as any[]).map(r => ({
        day: String(r.day),
        total: Number(r.total),
        critical: Number(r.critical),
        high: Number(r.high),
        medium: Number(r.medium),
        low: Number(r.low),
        resolved: Number(r.resolved),
      }));
    }),

  // Resolution time distribution (hours to resolve, bucketed)
  resolutionTime: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db.execute(sql`
        SELECT
          CASE
            WHEN EXTRACT(EPOCH FROM ("resolved_at" - "createdAt")) / 3600 < 1 THEN '<1h'
            WHEN EXTRACT(EPOCH FROM ("resolved_at" - "createdAt")) / 3600 < 4 THEN '1-4h'
            WHEN EXTRACT(EPOCH FROM ("resolved_at" - "createdAt")) / 3600 < 24 THEN '4-24h'
            WHEN EXTRACT(EPOCH FROM ("resolved_at" - "createdAt")) / 3600 < 72 THEN '1-3d'
            ELSE '>3d'
          END AS bucket,
          COUNT(*) AS count
        FROM compliance_alerts
        WHERE status = 'resolved'
          AND "resolved_at" IS NOT NULL
          AND "createdAt" >= ${since}
        GROUP BY bucket
        ORDER BY MIN(EXTRACT(EPOCH FROM ("resolved_at" - "createdAt")))
      `);
      return (rows as any[]).map(r => ({ bucket: String(r.bucket), count: Number(r.count) }));
    }),

  // False-positive rate by alert type (resolved without SAR/action = false positive proxy)
  falsePositiveRate: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db.execute(sql`
        SELECT
          alert_type,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed,
          COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
          COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'dismissed') / NULLIF(COUNT(*), 0),
            1
          ) AS false_positive_pct
        FROM compliance_alerts
        WHERE "createdAt" >= ${since}
        GROUP BY alert_type
        ORDER BY total DESC
      `);
      return (rows as any[]).map(r => ({
        alertType: String(r.alert_type),
        total: Number(r.total),
        dismissed: Number(r.dismissed),
        resolved: Number(r.resolved),
        escalated: Number(r.escalated),
        falsePositivePct: Number(r.false_positive_pct ?? 0),
      }));
    }),

  // Summary KPIs
  summary: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const [row] = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'open') AS open,
          COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
          COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical') AS critical_open,
          ROUND(
            AVG(EXTRACT(EPOCH FROM ("resolved_at" - "createdAt")) / 3600)
            FILTER (WHERE status = 'resolved' AND "resolved_at" IS NOT NULL),
            1
          ) AS avg_resolution_hours
        FROM compliance_alerts
        WHERE "createdAt" >= ${since}
      `) as any[];
      return {
        total: Number(row?.total ?? 0),
        open: Number(row?.open ?? 0),
        resolved: Number(row?.resolved ?? 0),
        escalated: Number(row?.escalated ?? 0),
        criticalOpen: Number(row?.critical_open ?? 0),
        avgResolutionHours: Number(row?.avg_resolution_hours ?? 0),
      };
    }),

  // Alert type distribution (pie chart)
  alertTypeDistribution: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db.execute(sql`
        SELECT
          alert_type,
          COUNT(*) AS count,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
        FROM compliance_alerts
        WHERE "createdAt" >= ${since}
        GROUP BY alert_type
        ORDER BY count DESC
      `);
      return (rows as any[]).map(r => ({
        alertType: String(r.alert_type),
        count: Number(r.count),
        pct: Number(r.pct ?? 0),
      }));
    }),

  // Officer performance trend: weekly resolution rate per officer (last 4 weeks)
  officerPerformanceTrend: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db.execute(sql`
      SELECT
        u.name AS officer_name,
        DATE_TRUNC('week', ca."createdAt") AS week_start,
        COUNT(*) FILTER (WHERE ca.status = 'resolved') AS resolved,
        COUNT(*) AS total,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ca.status = 'resolved') / NULLIF(COUNT(*), 0), 1) AS resolution_rate
      FROM compliance_alerts ca
      JOIN users u ON u.id = ca.assigned_to
      WHERE ca."createdAt" >= NOW() - INTERVAL '28 days'
        AND ca.assigned_to IS NOT NULL
      GROUP BY u.name, DATE_TRUNC('week', ca."createdAt")
      ORDER BY week_start ASC, officer_name
    `);
    // Pivot: { week, [officerName]: resolutionRate }
    const byWeek: Record<string, Record<string, number>> = {};
    const officers = new Set<string>();
    for (const r of rows as any[]) {
      const w = String(r.week_start).substring(0, 10);
      const o = String(r.officer_name);
      officers.add(o);
      if (!byWeek[w]) byWeek[w] = {};
      byWeek[w][o] = Number(r.resolution_rate ?? 0);
    }
    return {
      weeks: Object.entries(byWeek).map(([week, rates]) => ({ week, ...rates })),
      officers: Array.from(officers),
    };
  }),

  // Volume by severity over time (stacked area chart data)
  severityTrend: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db.execute(sql`
        SELECT
          DATE("createdAt") AS day,
          severity,
          COUNT(*) AS count
        FROM compliance_alerts
        WHERE "createdAt" >= ${since}
        GROUP BY DATE("createdAt"), severity
        ORDER BY day ASC, severity
      `);
      // Pivot into { day, critical, high, medium, low }
      const byDay: Record<string, Record<string, number>> = {};
      for (const r of rows as any[]) {
        const d = String(r.day);
        if (!byDay[d]) byDay[d] = { critical: 0, high: 0, medium: 0, low: 0 };
        byDay[d][String(r.severity)] = Number(r.count);
      }
      return Object.entries(byDay).map(([day, counts]) => ({ day, ...counts }));
    }),
});
