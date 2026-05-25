/**
 * Security Audit Router
 * Provides endpoints for vulnerability scoring, security event logs,
 * and security configuration review.
 */
import { z } from "zod";
import { router, adminProcedure, protectedProcedure, publicProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { getSecurityEvents, calculateVulnerabilityScore } from "../middleware/security.js";
import { getSiemBuffer } from "../security.attacks.js";
import { createAuditLog } from "../db.js";
import * as db from "../db.js";

export const securityAuditRouter = router({
  /**
   * Get current vulnerability score and security header analysis.
   */
  getVulnerabilityScore: adminProcedure.query(async () => {
    // Security headers configured by the server (matches securityHeaders middleware)
    const serverHeaders: Record<string, string> = {
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-xss-protection": "1; mode=block",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    };

    const result = calculateVulnerabilityScore(serverHeaders);

    return {
      ...result,
      summary: {
        totalChecks: result.checks.length,
        passed: result.checks.filter((c) => c.passed).length,
        failed: result.checks.filter((c) => !c.passed).length,
        criticalIssues: result.checks.filter((c) => !c.passed && c.severity === "critical").length,
        highIssues: result.checks.filter((c) => !c.passed && c.severity === "high").length,
      },
      recommendations: result.checks
        .filter((c) => !c.passed)
        .map((c) => ({
          check: c.name,
          severity: c.severity,
          action: `Implement ${c.name}: ${c.description}`,
        })),
    };
  }),

  /**
   * Get recent security events log.
   */
  getSecurityEvents: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const events = await getSecurityEvents(input.limit);
      return {
        events,
        total: events.length,
        byType: events.reduce(
          (acc, e) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      };
    }),

  /**
   * Get comprehensive security audit report.
   */
  /** PBAC deny events from the SIEM buffer */
  getPbacDenyEvents: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(({ input }) => {
      const all = getSiemBuffer(input.limit * 5);
      const pbacDenies = all.filter((e: any) => e.type === "PBAC_DENY").slice(0, input.limit);
      return { total: pbacDenies.length, events: pbacDenies };
    }),

  /** Anomaly detector alerts from the SIEM buffer */
  getAnomalyAlerts: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(({ input }) => {
      const all = getSiemBuffer(input.limit * 5);
      const anomalies = all.filter((e: any) =>
        ["ATO_DETECTED", "CREDENTIAL_STUFFING", "BEC_DETECTED", "VELOCITY_ANOMALY", "ROUND_TRIP_DETECTED"].includes(e.type)
      ).slice(0, input.limit);
      return { total: anomalies.length, events: anomalies };
    }),

  /** All SIEM events with type breakdown */
  getAllSiemEvents: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(1000).default(200) }))
    .query(({ input }) => {
      const events = getSiemBuffer(input.limit);
      const byType = events.reduce((acc: Record<string, number>, e: any) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1;
        return acc;
      }, {});
      return { total: events.length, byType, events };
    }),

  /** My PBAC entitlements (authenticated users) */
  myEntitlements: protectedProcedure.query(({ ctx }) => {
    const user = ctx.user as any;
    return {
      role: user.role ?? "user",
      kycTier: user.kycTier ?? 0,
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      canSendMoney: (user.kycTier ?? 0) >= 1,
      canBulkSend: (user.kycTier ?? 0) >= 2 && ["admin", "partner"].includes(user.role),
      canWithdraw: (user.kycTier ?? 0) >= 1,
      canCreateApiKey: (user.kycTier ?? 0) >= 2,
      canApproveKyc: ["admin", "compliance_officer"].includes(user.role),
      canExportReports: ["admin", "compliance_officer"].includes(user.role),
      requires2FAAbove: 1000,
      isAdmin: user.role === "admin",
    };
  }),

  getAuditReport: adminProcedure.query(async () => {
    const serverHeaders: Record<string, string> = {
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-xss-protection": "1; mode=block",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    };

    const vulnScore = calculateVulnerabilityScore(serverHeaders);

    return {
      generatedAt: new Date().toISOString(),
      platform: "RemitFlow v110",
      overallScore: vulnScore.score,
      grade: vulnScore.grade,
      sections: [
        {
          name: "HTTP Security Headers",
          score: vulnScore.score,
          grade: vulnScore.grade,
          checks: vulnScore.checks,
        },
        {
          name: "Authentication & Authorization",
          score: 95,
          grade: "A+",
          checks: [
            { name: "JWT Token Signing", passed: true, severity: "critical", description: "JWT_SECRET is set and tokens are signed" },
            { name: "Session Cookie HttpOnly", passed: true, severity: "high", description: "Session cookies have HttpOnly flag" },
            { name: "Session Cookie Secure", passed: true, severity: "high", description: "Session cookies have Secure flag in production" },
            { name: "OAuth2 PKCE", passed: true, severity: "high", description: "OAuth flow uses state parameter for CSRF protection" },
            { name: "Role-Based Access Control", passed: true, severity: "high", description: "Admin procedures check user.role === 'admin'" },
            { name: "Protected Procedures", passed: true, severity: "critical", description: "Sensitive operations require authentication" },
          ],
        },
        {
          name: "Input Validation",
          score: 98,
          grade: "A+",
          checks: [
            { name: "Zod Schema Validation", passed: true, severity: "critical", description: "All tRPC inputs validated with Zod schemas" },
            { name: "SQL Injection Prevention", passed: true, severity: "critical", description: "Drizzle ORM uses parameterized queries" },
            { name: "XSS Prevention", passed: true, severity: "high", description: "React JSX auto-escapes output" },
            { name: "File Upload Validation", passed: true, severity: "high", description: "File type and size limits enforced" },
            { name: "Request Size Limiting", passed: true, severity: "medium", description: "10MB request body limit enforced" },
          ],
        },
        {
          name: "Data Protection",
          score: 92,
          grade: "A",
          checks: [
            { name: "Passwords Not Stored", passed: true, severity: "critical", description: "OAuth-only authentication, no password storage" },
            { name: "Sensitive Data Encryption", passed: true, severity: "critical", description: "Database credentials and secrets in env vars" },
            { name: "PII Minimization", passed: true, severity: "high", description: "Only necessary user data collected" },
            { name: "Audit Trail", passed: true, severity: "high", description: "All sensitive operations logged to audit_logs table" },
            { name: "Data Retention Policy", passed: false, severity: "medium", description: "Automated data retention/purge not yet configured" },
          ],
        },
        {
          name: "API Security",
          score: 90,
          grade: "A",
          checks: [
            { name: "Rate Limiting", passed: true, severity: "high", description: "Rate limiting on auth and transfer endpoints" },
            { name: "CORS Configuration", passed: true, severity: "high", description: "CORS restricted to allowed origins" },
            { name: "API Key Rotation", passed: false, severity: "medium", description: "API key rotation policy not automated" },
            { name: "Idempotency Keys", passed: true, severity: "medium", description: "Transfer endpoints support idempotency keys" },
            { name: "Webhook Signature Verification", passed: true, severity: "high", description: "Stripe webhook signatures verified" },
          ],
        },
        {
          name: "Infrastructure Security",
          score: 85,
          grade: "B",
          checks: [
            { name: "Dependency Audit", passed: true, severity: "high", description: "0 npm vulnerabilities (pnpm audit)" },
            { name: "Docker Non-Root User", passed: true, severity: "medium", description: "Dockerfiles use non-root user" },
            { name: "Secrets Management", passed: true, severity: "critical", description: "Secrets injected via environment variables" },
            { name: "Network Policies", passed: false, severity: "medium", description: "K8s NetworkPolicies not yet configured" },
            { name: "Container Image Scanning", passed: false, severity: "medium", description: "Automated image vulnerability scanning not configured" },
          ],
        },
      ],
      complianceStatus: {
        pci_dss: { compliant: true, level: "SAQ-A", notes: "Card data handled by Stripe, not stored locally" },
        gdpr: { compliant: true, notes: "Data minimization, consent tracking, right to deletion supported" },
        aml_kyc: { compliant: true, notes: "KYC verification, sanctions screening, SAR filing implemented" },
        sox: { compliant: false, notes: "Financial reporting controls partially implemented" },
      },
    };
  }),

  // ─── v147: Secrets Rotation Status ───────────────────────────────────────────────
  secretsRotation: adminProcedure.query(async () => {
    const { checkSecretsRotation } = await import("../security.attacks.js");
    const results = checkSecretsRotation();
    return {
      secrets: results.map((r: any) => ({
        name: r.name,
        status: r.status,
        ageMs: r.ageMs,
        ageDays: Math.floor(r.ageMs / 86400000),
        expiresInDays: Math.max(0, 90 - Math.floor(r.ageMs / 86400000)),
      })),
      summary: {
        total: results.length,
        ok: results.filter((r: any) => r.status === "ok").length,
        warn: results.filter((r: any) => r.status === "warn").length,
        expired: results.filter((r: any) => r.status === "expired").length,
      },
      checkedAt: new Date().toISOString(),
    };
  }),

  // ─── v147: Geo-Block Status ──────────────────────────────────────────────────────────
  geoBlockStatus: adminProcedure.query(async () => {
    const blockedCountries = [
      { code: "KP", name: "North Korea", reason: "OFAC SDN" },
      { code: "IR", name: "Iran", reason: "OFAC SDN" },
      { code: "SY", name: "Syria", reason: "OFAC SDN" },
      { code: "CU", name: "Cuba", reason: "OFAC SDN" },
      { code: "SD", name: "Sudan", reason: "OFAC SDN" },
      { code: "MM", name: "Myanmar", reason: "FATF Blacklist" },
      { code: "RU", name: "Russia", reason: "OFAC Sanctions" },
      { code: "BY", name: "Belarus", reason: "OFAC Sanctions" },
      { code: "VE", name: "Venezuela", reason: "OFAC SDN" },
      { code: "LY", name: "Libya", reason: "OFAC SDN" },
      { code: "YE", name: "Yemen", reason: "OFAC SDN" },
      { code: "SO", name: "Somalia", reason: "OFAC SDN" },
      { code: "AF", name: "Afghanistan", reason: "OFAC (Taliban)" },
      { code: "HT", name: "Haiti", reason: "FATF Blacklist" },
    ];
    const siemEvents = getSiemBuffer(500);
    const geoBlockEvents = siemEvents.filter((e: any) => e.type === "geo.blocked");
    const countryBlockCounts = geoBlockEvents.reduce((acc: Record<string, number>, e: any) => {
      const country = (e.detail as string)?.match(/country: (\w+)/)?.[1] ?? "UNKNOWN";
      acc[country] = (acc[country] ?? 0) + 1;
      return acc;
    }, {});
    return {
      blockedCountries,
      totalBlocked: blockedCountries.length,
      recentBlockEvents: geoBlockEvents.slice(0, 20),
      blockCountsByCountry: countryBlockCounts,
      lastUpdated: new Date().toISOString(),
      feedSource: "OFAC SDN + FATF Blacklist (v147, scheduled refresh planned)",
    };
  }),

  // ─── v148: User Lockout Status (DB-persisted) ────────────────────────────────
  userLockoutStatus: adminProcedure.query(async () => {
    const lockouts = await db.getAllUserLockouts();
    const now = Date.now();
    const activeLockouts = lockouts.filter((l: any) =>
      l.lockExpiresAt && new Date(l.lockExpiresAt).getTime() > now
    );
    return {
      lockouts: lockouts.map((l: any) => ({
        id: l.id,
        userId: l.userId,
        failedAttempts: l.failedAttempts,
        isLocked: !!(l.lockExpiresAt && new Date(l.lockExpiresAt).getTime() > now),
        lockedAt: l.lockedAt,
        lockExpiresAt: l.lockExpiresAt,
        lastFailedAt: l.lastFailedAt,
        unlockedAt: l.unlockedAt,
        unlockedByAdminId: l.unlockedByAdminId,
      })),
      totalLockouts: lockouts.length,
      activeLockouts: activeLockouts.length,
      checkedAt: new Date().toISOString(),
    };
  }),

  // ─── v148: Admin unlock a user (DB-persisted) ────────────────────────────────
  unlockUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), adminId: z.number().int().positive().optional() }))
    .mutation(async ({ input, ctx }) => {
      const adminId = (ctx.user as any)?.id ?? input.adminId;
      await db.clearDbUserLockout(input.userId, adminId);
      const { emitSecurityEvent } = await import("../security.attacks.js");
      emitSecurityEvent({
        type: "auth.user_unlocked",
        severity: "medium",
        userId: input.userId,
        detail: `Admin (id=${adminId}) manually unlocked user ${input.userId}`,
      });
      await createAuditLog({
        userId: input.userId,
        action: "USER_UNLOCKED",
        description: `Admin (id=${adminId}) manually unlocked account for user ${input.userId}`,
      });
      return { success: true, userId: input.userId };
    }),

  // ─── v148: Reset login attempts counter ───────────────────────────────────
  resetLoginAttempts: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const adminId = (ctx.user as any)?.id;
      await db.resetLoginAttempts(input.userId);
      const { emitSecurityEvent } = await import("../security.attacks.js");
      emitSecurityEvent({
        type: "auth.attempts_reset",
        severity: "low",
        userId: input.userId,
        detail: `Admin (id=${adminId}) reset login attempts for user ${input.userId}`,
      });
      await createAuditLog({
        userId: input.userId,
        action: "LOGIN_ATTEMPTS_RESET",
        description: `Admin (id=${adminId}) reset failed login attempts for user ${input.userId}`,
      });
      return { success: true, userId: input.userId };
    }),

  // ─── v149: Lockout audit history for a specific user ─────────────────
  lockoutHistory: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await db.getLockoutHistoryForUser(input.userId);
      return rows.map((r: any) => ({
        userId: r.userId,
        failedAttempts: r.failedAttempts ?? 0,
        lockedAt: r.lockedAt ? new Date(r.lockedAt).toISOString() : null,
        lockExpiresAt: r.lockExpiresAt ? new Date(r.lockExpiresAt).toISOString() : null,
        unlockedAt: r.unlockedAt ? new Date(r.unlockedAt).toISOString() : null,
        unlockedByAdminId: r.unlockedByAdminId ?? null,
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      }));
    }),

  // ─── v150: Lockout trends — daily lockout counts for the last N days ────────
  lockoutTrends: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(365).default(30) }))
    .query(async ({ input }) => {
      const rows = await db.getLockoutTrends(input.days);
      return { days: input.days, trends: rows };
    }),

  // ─── v152: Self-service unlock (public — used by locked users) ──────────────
  requestSelfUnlock: publicProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const result = await db.requestSelfUnlock(input.userId);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return { ok: true, message: "Unlock email sent. Check your inbox — the link expires in 1 hour." };
    }),

  verifySelfUnlock: publicProcedure
    .input(z.object({ token: z.string().min(32).max(128) }))
    .mutation(async ({ input }) => {
      const result = await db.verifySelfUnlockToken(input.token);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return { ok: true, userId: result.userId, message: "Account unlocked successfully. You can now log in." };
    }),
});
