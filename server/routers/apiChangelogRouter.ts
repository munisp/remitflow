/**
 * API Changelog Router — Full CRUD for API versioning and release notes
 */
import { z } from "zod";
import { adminProcedure, publicProcedure, router, rateLimitedProcedure } from "../_core/trpc.js"; // rateLimitedProcedure available for rate-limited public endpoints
import { TRPCError } from "@trpc/server";
import { eq, desc, sql, like, and } from "drizzle-orm";
import { apiChangelogs } from "../../drizzle/schema.js";

async function getDb() {
  const { getDb: _getDb } = await import("../db.js");
  return _getDb();
}

const DEFAULT_CHANGELOGS = [
  { version: "4.2.0", title: "CIPS/UPI/PIX Payment Rails", type: "major", summary: "Added support for China CIPS, India UPI, and Brazil PIX payment rails with real-time routing.", newEndpoints: JSON.stringify(["/api/trpc/paymentRails.initiateRailTransfer", "/api/trpc/paymentRails.lookupRecipient", "/api/trpc/paymentRails.getLiveRates"]), bugFixes: JSON.stringify(["Fixed race condition in concurrent transfer processing", "Resolved FX rate caching stale data issue"]), releaseDate: new Date("2026-04-24") },
  { version: "4.1.0", title: "Digital Agreements & Revenue Share PWA", type: "minor", summary: "Introduced digital agreement lifecycle with e-signatures and a standalone Revenue Share PWA.", newEndpoints: JSON.stringify(["/api/trpc/digitalAgreements.create", "/api/trpc/digitalAgreements.sign", "/partner/revenue-share"]), bugFixes: JSON.stringify(["Fixed partner payout calculation rounding error"]), releaseDate: new Date("2026-04-20") },
  { version: "4.0.0", title: "Middleware Stack: Kafka, Temporal, TigerBeetle", type: "major", summary: "Integrated full middleware stack including Kafka event streaming, Temporal workflows, and TigerBeetle double-entry ledger.", breakingChanges: JSON.stringify(["Transfer API now returns ledger entry IDs", "Webhook payload format updated to include Kafka offset"]), newEndpoints: JSON.stringify(["/api/trpc/microservices.getServiceHealth", "/api/trpc/microservices.getServiceMetrics"]), bugFixes: JSON.stringify(["Resolved webhook delivery retry storm bug"]), releaseDate: new Date("2026-04-15") },
  { version: "3.5.0", title: "Security Hardening & Vulnerability Audit", type: "minor", summary: "Applied CSP, HSTS, rate limiting, SQL injection detection, and XSS sanitization across all endpoints.", newEndpoints: JSON.stringify(["/api/trpc/securityAudit.getSecurityScore", "/api/trpc/securityAudit.getVulnerabilities"]), bugFixes: JSON.stringify(["Fixed CSRF token validation bypass", "Resolved session fixation vulnerability"]), releaseDate: new Date("2026-04-10") },
  { version: "3.0.0", title: "Multi-Rail Mojaloop Integration", type: "major", summary: "Full Mojaloop FSPIOP integration with SWIFT, SEPA, ACH, and Faster Payments corridors.", breakingChanges: JSON.stringify(["Transfer status enum expanded: added 'processing_rail' state", "Quote API now requires corridor parameter"]), newEndpoints: JSON.stringify(["/api/trpc/mojaloop.initiateTransfer", "/api/trpc/mojaloop.getQuote"]), bugFixes: JSON.stringify(["Fixed duplicate transfer detection logic"]), releaseDate: new Date("2026-03-01") },
];

export const apiChangelogRouter = router({
  list: publicProcedure
    .input(z.object({
      type: z.enum(["major", "minor", "patch", "security", "all"]).default("all"),
      search: z.string().max(100).optional(),
      limit: z.number().min(1).max(50).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: DEFAULT_CHANGELOGS.map((c, i) => ({ ...c, id: i + 1, isPublished: true, createdAt: new Date() })), total: DEFAULT_CHANGELOGS.length };
      
      // Seed if empty
      const existing = await db.select({ id: apiChangelogs.id }).from(apiChangelogs).limit(1);
      if (existing.length === 0) {
        await db.insert(apiChangelogs).values(DEFAULT_CHANGELOGS).onConflictDoNothing();
      }
      
      const conditions = [];
      if (input.type !== "all") conditions.push(eq(apiChangelogs.type, input.type));
      if (input.search) conditions.push(like(apiChangelogs.title, `%${input.search}%`));
      conditions.push(eq(apiChangelogs.isPublished, true));
      
      const [items, countResult] = await Promise.all([
        db.select().from(apiChangelogs)
          .where(and(...conditions))
          .orderBy(desc(apiChangelogs.releaseDate))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(apiChangelogs).where(and(...conditions)),
      ]);
      
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "NOT_FOUND" });
      const [entry] = await db.select().from(apiChangelogs).where(eq(apiChangelogs.id, input.id));
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      return entry;
    }),

  create: adminProcedure
    .input(z.object({
      version: z.string().min(1).max(20),
      title: z.string().min(1).max(255),
      type: z.enum(["major", "minor", "patch", "security"]),
      summary: z.string().min(1),
      releaseDate: z.date(),
      breakingChanges: z.array(z.string()).optional(),
      newEndpoints: z.array(z.string()).optional(),
      deprecatedEndpoints: z.array(z.string()).optional(),
      bugFixes: z.array(z.string()).optional(),
      isPublished: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [entry] = await db.insert(apiChangelogs).values({
        ...input,
        breakingChanges: input.breakingChanges ? JSON.stringify(input.breakingChanges) : null,
        newEndpoints: input.newEndpoints ? JSON.stringify(input.newEndpoints) : null,
        deprecatedEndpoints: input.deprecatedEndpoints ? JSON.stringify(input.deprecatedEndpoints) : null,
        bugFixes: input.bugFixes ? JSON.stringify(input.bugFixes) : null,
      }).returning();
      return entry;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().max(255).optional(),
      summary: z.string().optional(),
      isPublished: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...updates } = input;
      const [entry] = await db.update(apiChangelogs).set(updates).where(eq(apiChangelogs.id, id)).returning();
      return entry;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(apiChangelogs).where(eq(apiChangelogs.id, input.id));
      return { success: true };
    }),
});
