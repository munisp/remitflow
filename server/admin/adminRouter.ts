/**
 * RemitFlow — Admin Dashboard tRPC Router
 *
 * Internal operations panel for compliance, ops, and engineering teams.
 * All endpoints require admin role authentication.
 *
 * Features:
 *   - Transaction investigation (search, freeze, refund)
 *   - KYC manual review (override verification, request re-verification)
 *   - Compliance case management (SAR queue, sanctions matches)
 *   - System health (service status, queue depths, error rates)
 *   - User management (lock/unlock, tier override, audit log)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";

// ── Types ─────────────────────────────────────────────────────────────────────

const TransferStatus = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "frozen",
  "refunded",
  "under_review",
]);

const CaseStatus = z.enum([
  "open",
  "investigating",
  "escalated",
  "filed",
  "closed",
  "false_positive",
]);

const AdminAction = z.enum([
  "freeze_transfer",
  "unfreeze_transfer",
  "refund_transfer",
  "lock_user",
  "unlock_user",
  "override_kyc",
  "request_rekyc",
  "file_sar",
  "close_case",
  "escalate_case",
]);

// ── Admin Router ──────────────────────────────────────────────────────────────

export const adminRouter = router({
  // ── Transaction Investigation ────────────────────────────────────────────

  transactions: router({
    search: adminProcedure
      .input(
        z.object({
          query: z.string().optional(),
          userId: z.string().uuid().optional(),
          status: TransferStatus.optional(),
          corridor: z.string().optional(),
          minAmount: z.number().optional(),
          maxAmount: z.number().optional(),
          dateFrom: z.string().datetime().optional(),
          dateTo: z.string().datetime().optional(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(20),
        })
      )
      .query(async ({ input }) => {
        // Production: Query database with filters
        return {
          transactions: [] as Array<{
            id: string;
            userId: string;
            amount: number;
            currency: string;
            status: string;
            corridor: string;
            createdAt: string;
            riskScore: number;
          }>,
          total: 0,
          page: input.page,
          limit: input.limit,
        };
      }),

    getDetail: adminProcedure
      .input(z.object({ transferId: z.string().uuid() }))
      .query(async ({ input }) => {
        return {
          transfer: null as null | {
            id: string;
            userId: string;
            beneficiaryId: string;
            sourceAmount: number;
            sourceCurrency: string;
            destinationAmount: number;
            destinationCurrency: string;
            fxRate: number;
            fee: number;
            status: string;
            rail: string;
            corridor: string;
            idempotencyKey: string;
            createdAt: string;
            updatedAt: string;
            settledAt: string | null;
            failureReason: string | null;
          },
          timeline: [] as Array<{
            event: string;
            timestamp: string;
            details: Record<string, unknown>;
          }>,
          riskFactors: [] as Array<{
            factor: string;
            score: number;
            explanation: string;
          }>,
          relatedTransfers: [] as Array<{ id: string; amount: number; status: string }>,
        };
      }),

    freeze: adminProcedure
      .input(
        z.object({
          transferId: z.string().uuid(),
          reason: z.string().min(10),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Update status to 'frozen', emit audit event, notify compliance
        return {
          success: true,
          transferId: input.transferId,
          newStatus: "frozen" as const,
          auditId: crypto.randomUUID(),
        };
      }),

    unfreeze: adminProcedure
      .input(
        z.object({
          transferId: z.string().uuid(),
          approvedBy: z.string(),
          reason: z.string().min(10),
        })
      )
      .mutation(async ({ input }) => {
        return {
          success: true,
          transferId: input.transferId,
          newStatus: "processing" as const,
          auditId: crypto.randomUUID(),
        };
      }),

    refund: adminProcedure
      .input(
        z.object({
          transferId: z.string().uuid(),
          reason: z.string().min(10),
          approvedBy: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Initiate refund via TigerBeetle reversal, update status, notify user
        return {
          success: true,
          transferId: input.transferId,
          refundId: crypto.randomUUID(),
          newStatus: "refunded" as const,
        };
      }),
  }),

  // ── KYC Management ──────────────────────────────────────────────────────

  kyc: router({
    pendingReviews: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(50).default(10),
        })
      )
      .query(async ({ input }) => {
        return {
          reviews: [] as Array<{
            id: string;
            userId: string;
            userName: string;
            documentType: string;
            submittedAt: string;
            currentTier: number;
            requestedTier: number;
            providerResult: string;
            riskFlags: string[];
          }>,
          total: 0,
          page: input.page,
        };
      }),

    overrideVerification: adminProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          newTier: z.number().int().min(0).max(3),
          reason: z.string().min(20),
          approvedBy: z.string(),
          expiresAt: z.string().datetime().optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Update user tier, emit audit event, notify user
        return {
          success: true,
          userId: input.userId,
          previousTier: 0,
          newTier: input.newTier,
          auditId: crypto.randomUUID(),
        };
      }),

    requestReVerification: adminProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          reason: z.string().min(10),
          documentsRequired: z.array(z.string()),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Reset tier to 0, send notification, create re-KYC task
        return {
          success: true,
          userId: input.userId,
          notificationSent: true,
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
      }),
  }),

  // ── Compliance Case Management ──────────────────────────────────────────

  compliance: router({
    cases: adminProcedure
      .input(
        z.object({
          status: CaseStatus.optional(),
          type: z.enum(["sanctions_match", "sar", "structuring", "pep", "adverse_media"]).optional(),
          assignedTo: z.string().optional(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(50).default(10),
        })
      )
      .query(async ({ input }) => {
        return {
          cases: [] as Array<{
            id: string;
            type: string;
            status: string;
            priority: "critical" | "high" | "medium" | "low";
            userId: string;
            userName: string;
            description: string;
            assignedTo: string | null;
            createdAt: string;
            deadline: string | null;
            transferIds: string[];
          }>,
          total: 0,
          page: input.page,
        };
      }),

    assignCase: adminProcedure
      .input(
        z.object({
          caseId: z.string().uuid(),
          assignTo: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        return { success: true, caseId: input.caseId, assignedTo: input.assignTo };
      }),

    updateCase: adminProcedure
      .input(
        z.object({
          caseId: z.string().uuid(),
          status: CaseStatus,
          notes: z.string().min(10),
          action: AdminAction.optional(),
        })
      )
      .mutation(async ({ input }) => {
        return {
          success: true,
          caseId: input.caseId,
          newStatus: input.status,
          auditId: crypto.randomUUID(),
        };
      }),

    sarQueue: adminProcedure.query(async () => {
      return {
        pending: 0,
        dueSoon: 0, // Due within 24h
        overdue: 0,
        filedThisMonth: 0,
        items: [] as Array<{
          id: string;
          userId: string;
          amount: number;
          reason: string;
          deadline: string;
          jurisdiction: string;
        }>,
      };
    }),

    fileSar: adminProcedure
      .input(
        z.object({
          caseId: z.string().uuid(),
          jurisdiction: z.enum(["CA", "US", "GB", "NG"]),
          narrativeOverride: z.string().optional(),
          filedBy: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Generate SAR/STR, submit to regulator API, mark case as filed
        return {
          success: true,
          caseId: input.caseId,
          filingReference: `SAR-${input.jurisdiction}-${Date.now()}`,
          filedAt: new Date().toISOString(),
        };
      }),
  }),

  // ── System Health ───────────────────────────────────────────────────────

  system: router({
    health: adminProcedure.query(async () => {
      return {
        status: "healthy" as "healthy" | "degraded" | "down",
        services: [
          { name: "API", status: "up", latencyMs: 12 },
          { name: "PostgreSQL", status: "up", latencyMs: 3 },
          { name: "Redis", status: "up", latencyMs: 1 },
          { name: "Kafka", status: "up", latencyMs: 5 },
          { name: "TigerBeetle", status: "up", latencyMs: 2 },
          { name: "Temporal", status: "up", latencyMs: 8 },
          { name: "Vault", status: "up", latencyMs: 4 },
          { name: "Circle API", status: "up", latencyMs: 120 },
          { name: "Flutterwave API", status: "up", latencyMs: 180 },
          { name: "Onfido API", status: "up", latencyMs: 200 },
        ] as Array<{ name: string; status: "up" | "degraded" | "down"; latencyMs: number }>,
        queues: {
          transfersPending: 0,
          kycPending: 0,
          sarPending: 0,
          deadLetter: 0,
        },
        metrics: {
          transfersToday: 0,
          volumeToday: 0,
          errorRate: 0,
          p95Latency: 0,
        },
      };
    }),

    recentErrors: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
      .query(async ({ input }) => {
        return {
          errors: [] as Array<{
            id: string;
            message: string;
            stack: string;
            count: number;
            firstSeen: string;
            lastSeen: string;
            service: string;
          }>,
          total: 0,
        };
      }),

    killSwitch: adminProcedure
      .input(
        z.object({
          action: z.enum(["freeze", "unfreeze"]),
          reason: z.string().min(10),
          approvedBy: z.string(),
          scope: z.enum(["all", "transfers", "signups", "withdrawals"]).default("all"),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Set platform freeze flag, reject new transactions, notify all on-call
        return {
          success: true,
          action: input.action,
          scope: input.scope,
          timestamp: new Date().toISOString(),
          auditId: crypto.randomUUID(),
        };
      }),
  }),

  // ── User Management ─────────────────────────────────────────────────────

  users: router({
    search: adminProcedure
      .input(
        z.object({
          query: z.string().optional(),
          kycTier: z.number().int().min(0).max(3).optional(),
          status: z.enum(["active", "locked", "suspended", "closed"]).optional(),
          country: z.string().length(2).optional(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(50).default(20),
        })
      )
      .query(async ({ input }) => {
        return {
          users: [] as Array<{
            id: string;
            email: string;
            fullName: string;
            kycTier: number;
            status: string;
            country: string;
            createdAt: string;
            lastLoginAt: string;
            totalTransfers: number;
            totalVolume: number;
          }>,
          total: 0,
          page: input.page,
        };
      }),

    lock: adminProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          reason: z.string().min(10),
          duration: z.enum(["24h", "7d", "30d", "permanent"]).default("permanent"),
        })
      )
      .mutation(async ({ input }) => {
        // Production: Lock user, freeze pending transfers, revoke sessions
        return {
          success: true,
          userId: input.userId,
          lockedUntil: input.duration === "permanent" ? null : new Date().toISOString(),
          pendingTransfersFrozen: 0,
          sessionsRevoked: 0,
        };
      }),

    unlock: adminProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          reason: z.string().min(10),
          approvedBy: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        return {
          success: true,
          userId: input.userId,
          auditId: crypto.randomUUID(),
        };
      }),

    auditLog: adminProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(50),
        })
      )
      .query(async ({ input }) => {
        return {
          events: [] as Array<{
            id: string;
            eventType: string;
            details: Record<string, unknown>;
            ipAddress: string;
            userAgent: string;
            createdAt: string;
          }>,
          total: 0,
          page: input.page,
        };
      }),
  }),

  // ── Reconciliation ──────────────────────────────────────────────────────

  reconciliation: router({
    status: adminProcedure.query(async () => {
      return {
        lastRun: new Date().toISOString(),
        status: "balanced" as "balanced" | "discrepancy",
        discrepancies: [] as Array<{
          accountId: string;
          expected: number;
          actual: number;
          difference: number;
          currency: string;
        }>,
        nostroBalances: [] as Array<{
          currency: string;
          bank: string;
          balance: number;
          lastReconciled: string;
        }>,
      };
    }),

    triggerReconciliation: adminProcedure
      .input(z.object({ scope: z.enum(["full", "transfers", "nostro"]).default("full") }))
      .mutation(async ({ input }) => {
        return {
          jobId: crypto.randomUUID(),
          scope: input.scope,
          startedAt: new Date().toISOString(),
          estimatedDuration: "2-5 minutes",
        };
      }),
  }),
});

export type AdminRouter = typeof adminRouter;
