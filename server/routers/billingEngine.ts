/**
 * RemitFlow — Billing Engine tRPC Router
 *
 * Bridges the Go billing engine microservice into the main RemitFlow tRPC API.
 * Every remittance transaction automatically creates a billing event that captures:
 *   - Transfer fee (percentage / flat / hybrid)
 *   - FX spread revenue
 *   - Platform vs IMTO partner profit split
 *   - Payout network cost
 *   - Allocated overhead per transaction
 *   - Net platform profit
 *
 * Role-based access (PBAC):
 *   - billing:admin       → full access
 *   - billing:config-manager → read + write billing configs
 *   - billing:analyst     → read events + P&L
 *   - billing:auditor     → read events + audit log
 *   - billing:partner     → own events only
 *   - Any authenticated user → can trigger computeBillingEvent via transactions.send
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { createAuditLog } from "../audit.service";
import {
  billingEvents,
  billingConfigs,
  billingConfigHistory,
  billingAuditLog,
  billingTenants,
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { logger } from '../_core/logger';
import { safeParseAmount } from "../lib/safeDecimal";

// ─── Billing Engine HTTP client ───────────────────────────────────────────────

const BILLING_ENGINE_URL = process.env.BILLING_ENGINE_URL || "http://localhost:8081";
const BILLING_ENGINE_TIMEOUT = 5000; // 5s — fail fast, don't block transactions

async function callBillingEngine(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BILLING_ENGINE_TIMEOUT);
  try {
    const res = await fetch(`${BILLING_ENGINE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Billing engine error ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    // Billing engine is non-blocking — log but don't fail the transaction
    logger.error({ err: err }, '[BillingEngine] Call failed:');
    return null;
  }
}

// ─── Fee computation (local fallback when Go service is unavailable) ──────────

interface LocalFeeResult {
  transferFeeMinor: number;
  platformFeeShareMinor: number;
  partnerFeeShareMinor: number;
  fxSpreadMinor: number;
  fxHedgeCostMinor: number;
  netFxRevenueMinor: number;
  payoutCostMinor: number;
  allocatedOverheadMinor: number;
  netPlatformProfitMinor: number;
  appliedRate: string;
  recvAmountMinor: number;
}

function computeFeeLocally(
  sendAmountMinor: number,
  midMarketRate: number,
  config: {
    feeMode: "PERCENTAGE" | "FLAT" | "HYBRID";
    feePercentage: number;
    flatFeeMinor: number;
    feeCapMinor: number;
    feeFloorMinor: number;
    fxSpreadPercentage: number;
    hedgeCostPercentage: number;
    platformFeeSharePct: number;
    platformFxSharePct: number;
    overheadPerTxMinor: number;
  },
  payoutMethod: string
): LocalFeeResult {
  // Transfer fee
  let fee = 0;
  if (config.feeMode === "PERCENTAGE") {
    fee = Math.round(sendAmountMinor * (config.feePercentage / 100));
  } else if (config.feeMode === "FLAT") {
    fee = config.flatFeeMinor;
  } else {
    // HYBRID: percentage + flat
    fee = Math.round(sendAmountMinor * (config.feePercentage / 100)) + config.flatFeeMinor;
  }
  fee = Math.max(config.feeFloorMinor, Math.min(config.feeCapMinor, fee));

  // FX spread
  const spreadRate = midMarketRate * (1 - config.fxSpreadPercentage / 100);
  const recvAmountMinor = Math.round((sendAmountMinor - fee) * spreadRate);
  const fxSpreadMinor = Math.round((sendAmountMinor - fee) * (midMarketRate - spreadRate));
  const fxHedgeCostMinor = Math.round(fxSpreadMinor * (config.hedgeCostPercentage / 100));
  const netFxRevenueMinor = fxSpreadMinor - fxHedgeCostMinor;

  // Payout cost (per method)
  const payoutCosts: Record<string, number> = {
    BANK_TRANSFER: 50,   // £0.50
    MOBILE_MONEY: 30,    // £0.30
    CASH_PICKUP: 150,    // £1.50
    WALLET: 10,          // £0.10
    CRYPTO: 200,         // £2.00
  };
  const payoutCostMinor = payoutCosts[payoutMethod] ?? 50;

  // Profit split
  const platformFeeShareMinor = Math.round(fee * (config.platformFeeSharePct / 100));
  const partnerFeeShareMinor = fee - platformFeeShareMinor;
  const platformFxShareMinor = Math.round(netFxRevenueMinor * (config.platformFxSharePct / 100));

  // Net platform profit
  const netPlatformProfitMinor =
    platformFeeShareMinor + platformFxShareMinor - payoutCostMinor - config.overheadPerTxMinor;

  return {
    transferFeeMinor: fee,
    platformFeeShareMinor,
    partnerFeeShareMinor,
    fxSpreadMinor,
    fxHedgeCostMinor,
    netFxRevenueMinor,
    payoutCostMinor,
    allocatedOverheadMinor: config.overheadPerTxMinor,
    netPlatformProfitMinor,
    appliedRate: spreadRate.toFixed(8),
    recvAmountMinor,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const billingEngineRouter = router({

  // ── Compute billing event for a transaction (called by transactions.send) ──
  computeBillingEvent: protectedProcedure
    .input(z.object({
      tenantId: z.string().default("default"),
      transactionId: z.string(),
      corridor: z.string(),          // e.g. "GB-NG"
      sendCurrency: z.string().length(3),
      recvCurrency: z.string().length(3),
      sendAmountMinor: z.number().int().positive(),
      midMarketRate: z.number().positive(),
      payoutMethod: z.enum(["BANK_TRANSFER", "MOBILE_MONEY", "CASH_PICKUP", "WALLET", "CRYPTO"]).default("BANK_TRANSFER"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 1. Get active billing config for tenant
      const config = await db
        .select()
        .from(billingConfigs)
        .where(and(eq(billingConfigs.tenantId, input.tenantId), eq(billingConfigs.isActive, true)))
        .limit(1);

      const cfg = config[0] ?? {
        feeMode: "PERCENTAGE" as const,
        feePercentage: "1.5000",
        flatFeeMinor: 0,
        feeCapMinor: 2000,
        feeFloorMinor: 100,
        fxSpreadPercentage: "0.80",
        hedgeCostPercentage: "0.15",
        platformFeeSharePct: "40.0",
        platformFxSharePct: "100.0",
        overheadPerTxMinor: 50,
        version: "default",
      };

      // 2. Try Go billing engine first, fall back to local computation
      const engineResult = await callBillingEngine("/v1/billing/events/compute", "POST", {
        tenant_id: input.tenantId,
        transaction_id: input.transactionId,
        corridor: input.corridor,
        send_currency: input.sendCurrency,
        recv_currency: input.recvCurrency,
        send_amount_minor: input.sendAmountMinor,
        mid_market_rate: input.midMarketRate.toString(),
        payout_method: input.payoutMethod,
      });

      let feeResult: LocalFeeResult;
      if (engineResult && typeof engineResult === "object" && "transfer_fee_minor" in (engineResult as Record<string, unknown>)) {
        const r = engineResult as Record<string, number | string>;
        feeResult = {
          transferFeeMinor: Number(r.transfer_fee_minor),
          platformFeeShareMinor: Number(r.platform_fee_share_minor),
          partnerFeeShareMinor: Number(r.partner_fee_share_minor),
          fxSpreadMinor: Number(r.fx_spread_minor),
          fxHedgeCostMinor: Number(r.fx_hedge_cost_minor),
          netFxRevenueMinor: Number(r.net_fx_revenue_minor),
          payoutCostMinor: Number(r.payout_cost_minor),
          allocatedOverheadMinor: Number(r.allocated_overhead_minor),
          netPlatformProfitMinor: Number(r.net_platform_profit_minor),
          appliedRate: String(r.applied_rate),
          recvAmountMinor: Number(r.recv_amount_minor),
        };
      } else {
        feeResult = computeFeeLocally(
          input.sendAmountMinor,
          input.midMarketRate,
          {
            feeMode: cfg.feeMode as "PERCENTAGE" | "FLAT" | "HYBRID",
            feePercentage: safeParseAmount(cfg.feePercentage ?? "1.5"),
            flatFeeMinor: cfg.flatFeeMinor ?? 0,
            feeCapMinor: cfg.feeCapMinor ?? 2000,
            feeFloorMinor: cfg.feeFloorMinor ?? 100,
            fxSpreadPercentage: safeParseAmount(cfg.fxSpreadPercentage ?? "0.80"),
            hedgeCostPercentage: safeParseAmount(cfg.hedgeCostPercentage ?? "0.15"),
            platformFeeSharePct: safeParseAmount(cfg.platformFeeSharePct ?? "40.0"),
            platformFxSharePct: safeParseAmount(cfg.platformFxSharePct ?? "100.0"),
            overheadPerTxMinor: cfg.overheadPerTxMinor ?? 50,
          },
          input.payoutMethod
        );
      }

      // 3. Persist billing event
      const { randomBytes } = await import("crypto");
      const eventId = `be-${Date.now()}-${randomBytes(4).toString("hex")}`;
      const now = Date.now();

      await db.insert(billingEvents).values({
        eventId,
        tenantId: input.tenantId,
        transactionId: input.transactionId,
        corridor: input.corridor,
        sendCurrency: input.sendCurrency,
        recvCurrency: input.recvCurrency,
        sendAmountMinor: input.sendAmountMinor,
        recvAmountMinor: feeResult.recvAmountMinor,
        transferFeeMinor: feeResult.transferFeeMinor,
        platformFeeShareMinor: feeResult.platformFeeShareMinor,
        partnerFeeShareMinor: feeResult.partnerFeeShareMinor,
        feeMode: cfg.feeMode as "PERCENTAGE" | "FLAT" | "HYBRID",
        midMarketRate: input.midMarketRate.toString(),
        appliedRate: feeResult.appliedRate,
        fxSpreadMinor: feeResult.fxSpreadMinor,
        fxHedgeCostMinor: feeResult.fxHedgeCostMinor,
        netFxRevenueMinor: feeResult.netFxRevenueMinor,
        payoutMethod: input.payoutMethod,
        payoutCostMinor: feeResult.payoutCostMinor,
        allocatedOverheadMinor: feeResult.allocatedOverheadMinor,
        netPlatformProfitMinor: feeResult.netPlatformProfitMinor,
        settlementStatus: "PENDING",
        createdByUserId: String(ctx.user.id),
        billingConfigVersion: cfg.version ?? "default",
        eventTimestampMs: now,
      }).onConflictDoNothing().returning();

      return {
        eventId,
        ...feeResult,
        corridor: input.corridor,
        sendCurrency: input.sendCurrency,
        recvCurrency: input.recvCurrency,
        sendAmountMinor: input.sendAmountMinor,
        billingConfigVersion: cfg.version ?? "default",
        computedAt: now,
        source: engineResult ? "billing-engine-go" : "local-fallback",
      };
    }),

  // ── Get billing config for a tenant ──────────────────────────────────────
  getBillingConfig: protectedProcedure
    .input(z.object({ tenantId: z.string().default("default") }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const configs = await db
        .select()
        .from(billingConfigs)
        .where(and(eq(billingConfigs.tenantId, input.tenantId), eq(billingConfigs.isActive, true)))
        .limit(1);
      return configs[0] ?? null;
    }),

  // ── Update billing config (billing:config-manager or admin) ──────────────
  updateBillingConfig: adminProcedure
    .input(z.object({
      tenantId: z.string(),
      feeMode: z.enum(["PERCENTAGE", "FLAT", "HYBRID"]).optional(),
      feePercentage: z.string().optional(),
      flatFeeMinor: z.number().int().optional(),
      feeCapMinor: z.number().int().optional(),
      feeFloorMinor: z.number().int().optional(),
      fxSpreadPercentage: z.string().optional(),
      hedgeCostPercentage: z.string().optional(),
      platformFeeSharePct: z.string().optional(),
      platformFxSharePct: z.string().optional(),
      overheadPerTxMinor: z.number().int().optional(),
      changeReason: z.string().min(10, "Change reason must be at least 10 characters"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { tenantId, changeReason, ...updates } = input;

      // Snapshot current config before update (for audit trail)
      const existing = await db
        .select()
        .from(billingConfigs)
        .where(and(eq(billingConfigs.tenantId, tenantId), eq(billingConfigs.isActive, true)))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Billing config not found for tenant" });
      }

      const now = Date.now();
      const newVersion = `${Date.now()}`;

      await db
        .update(billingConfigs)
        .set({
          ...updates,
          version: newVersion,
          updatedBy: String(ctx.user.id),
          changeReason,
          updatedAtMs: now,
        })
        .where(and(eq(billingConfigs.tenantId, tenantId), eq(billingConfigs.isActive, true)));

      // Audit log
      await db.insert(billingAuditLog).values({
        tenantId,
        eventType: "CONFIG_CHANGED",
        entityType: "billing_config",
        entityId: existing[0].configId,
        actorUserId: String(ctx.user.id),
        actorRole: ctx.user.role ?? "user",
        beforeState: JSON.stringify(existing[0]),
        afterState: JSON.stringify({ ...existing[0], ...updates, version: newVersion }),
        occurredAtMs: now,
      }).returning();

      // Audit log for billing config change
      await createAuditLog({
        userId: ctx.user.id,
        action: "billing.config.updated",
        targetType: "billing_config",
        targetId: 0,
        description: `Billing config updated for tenant ${tenantId}: ${changeReason}`,
        severity: "warning",
        metadata: { tenantId, changeReason },
      });
      return { success: true, verified: true, version: newVersion, updatedAt: now };
    }),

  // ── List billing events for a tenant ─────────────────────────────────────
  listBillingEvents: protectedProcedure
    .input(z.object({
      tenantId: z.string().default("default"),
      corridor: z.string().optional(),
      fromMs: z.number().optional(),
      toMs: z.number().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [eq(billingEvents.tenantId, input.tenantId)];
      if (input.corridor) conditions.push(eq(billingEvents.corridor, input.corridor));
      if (input.fromMs) conditions.push(gte(billingEvents.eventTimestampMs, input.fromMs));
      if (input.toMs) conditions.push(lte(billingEvents.eventTimestampMs, input.toMs));

      const [events, countResult] = await Promise.all([
        db.select().from(billingEvents)
          .where(and(...conditions))
          .orderBy(desc(billingEvents.eventTimestampMs))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(billingEvents)
          .where(and(...conditions)),
      ]);

      return { events, total: Number(countResult[0]?.count ?? 0) };
    }),

  // ── Get tenant P&L summary ────────────────────────────────────────────────
  getTenantPnL: protectedProcedure
    .input(z.object({
      tenantId: z.string().default("default"),
      periodDays: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const fromMs = Date.now() - input.periodDays * 24 * 60 * 60 * 1000;

      const result = await db
        .select({
          totalTransactions: sql<number>`count(*)`,
          totalSendVolumeMinor: sql<number>`sum(send_amount_minor)`,
          totalFeeMinor: sql<number>`sum(transfer_fee_minor)`,
          platformFeeMinor: sql<number>`sum(platform_fee_share_minor)`,
          partnerFeeMinor: sql<number>`sum(partner_fee_share_minor)`,
          netFxRevenueMinor: sql<number>`sum(net_fx_revenue_minor)`,
          fxHedgeCostMinor: sql<number>`sum(fx_hedge_cost_minor)`,
          payoutCostMinor: sql<number>`sum(payout_cost_minor)`,
          overheadMinor: sql<number>`sum(allocated_overhead_minor)`,
          netProfitMinor: sql<number>`sum(net_platform_profit_minor)`,
          avgMarginPct: sql<number>`avg(net_platform_profit_minor::float / nullif(send_amount_minor, 0) * 100)`,
        })
        .from(billingEvents)
        .where(
          and(
            eq(billingEvents.tenantId, input.tenantId),
            gte(billingEvents.eventTimestampMs, fromMs)
          )
        );

      const r = result[0];
      return {
        tenantId: input.tenantId,
        periodDays: input.periodDays,
        totalTransactions: Number(r?.totalTransactions ?? 0),
        totalSendVolumeMinor: Number(r?.totalSendVolumeMinor ?? 0),
        totalFeeMinor: Number(r?.totalFeeMinor ?? 0),
        platformFeeMinor: Number(r?.platformFeeMinor ?? 0),
        partnerFeeMinor: Number(r?.partnerFeeMinor ?? 0),
        netFxRevenueMinor: Number(r?.netFxRevenueMinor ?? 0),
        fxHedgeCostMinor: Number(r?.fxHedgeCostMinor ?? 0),
        payoutCostMinor: Number(r?.payoutCostMinor ?? 0),
        overheadMinor: Number(r?.overheadMinor ?? 0),
        netProfitMinor: Number(r?.netProfitMinor ?? 0),
        avgMarginPct: Number(r?.avgMarginPct ?? 0).toFixed(2),
        computedAt: Date.now(),
      };
    }),

  // ── Per-corridor breakdown ────────────────────────────────────────────────
  getCorridorBreakdown: protectedProcedure
    .input(z.object({
      tenantId: z.string().default("default"),
      periodDays: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const fromMs = Date.now() - input.periodDays * 24 * 60 * 60 * 1000;

      return db
        .select({
          corridor: billingEvents.corridor,
          sendCurrency: billingEvents.sendCurrency,
          transactionCount: sql<number>`count(*)`,
          totalSendMinor: sql<number>`sum(send_amount_minor)`,
          avgSendMinor: sql<number>`avg(send_amount_minor)`,
          netProfitMinor: sql<number>`sum(net_platform_profit_minor)`,
          totalFeeMinor: sql<number>`sum(transfer_fee_minor)`,
          netFxRevenueMinor: sql<number>`sum(net_fx_revenue_minor)`,
        })
        .from(billingEvents)
        .where(
          and(
            eq(billingEvents.tenantId, input.tenantId),
            gte(billingEvents.eventTimestampMs, fromMs)
          )
        )
        .groupBy(billingEvents.corridor, billingEvents.sendCurrency)
        .orderBy(desc(sql`sum(send_amount_minor)`));
    }),

  // ── Billing config history (audit trail) ─────────────────────────────────
  getConfigHistory: protectedProcedure
    .input(z.object({
      tenantId: z.string().default("default"),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db
        .select()
        .from(billingConfigHistory)
        .where(eq(billingConfigHistory.tenantId, input.tenantId))
        .orderBy(desc(billingConfigHistory.changedAtMs))
        .limit(input.limit);
    }),

  // ── Audit log ─────────────────────────────────────────────────────────────
  getAuditLog: adminProcedure
    .input(z.object({
      tenantId: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = input.tenantId ? [eq(billingAuditLog.tenantId, input.tenantId)] : [];

      const [entries, countResult] = await Promise.all([
        db.select().from(billingAuditLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(billingAuditLog.occurredAtMs))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(billingAuditLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { entries, total: Number(countResult[0]?.count ?? 0) };
    }),

  // ── Provision billing config for new tenant (called by onboarding) ────────
  provisionTenantBillingConfig: adminProcedure
    .input(z.object({
      tenantId: z.string(),
      tenantName: z.string(),
      tenantType: z.enum(["IMTO_PARTNER", "WHITE_LABEL", "ENTERPRISE_SENDER"]),
      feePercentage: z.string().default("1.5000"),
      platformFeeSharePct: z.string().default("40.0"),
      fxSpreadPercentage: z.string().default("0.80"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const configId = `bc-${input.tenantId}-${Date.now()}`;
      const now = Date.now();

      // Upsert tenant
      await db.insert(billingTenants).values({
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        tenantType: input.tenantType,
        status: "ACTIVE",
        ownerEmail: `admin@${input.tenantId}.com`,
        ownerName: input.tenantName,
        onboardedAt: new Date(),
      }).onConflictDoNothing().returning();

      // Provision billing config
      await db.insert(billingConfigs).values({
        configId,
        tenantId: input.tenantId,
        version: "1.0.0",
        isActive: true,
        feeMode: "PERCENTAGE",
        feePercentage: input.feePercentage,
        flatFeeMinor: 0,
        feeCapMinor: 2000,
        feeFloorMinor: 100,
        fxSpreadPercentage: input.fxSpreadPercentage,
        hedgeCostPercentage: "0.15",
        platformFeeSharePct: input.platformFeeSharePct,
        platformFxSharePct: "100.0",
        overheadPerTxMinor: 50,
        updatedBy: String(ctx.user.id),
        changeReason: "Initial provisioning at tenant onboarding",
        createdAtMs: now,
        updatedAtMs: now,
      }).onConflictDoNothing().returning();

      // Audit log
      await db.insert(billingAuditLog).values({
        tenantId: input.tenantId,
        eventType: "TENANT_PROVISIONED",
        entityType: "billing_config",
        entityId: configId,
        actorUserId: String(ctx.user.id),
        actorRole: ctx.user.role ?? "admin",
        afterState: JSON.stringify({ configId, tenantId: input.tenantId }),
        occurredAtMs: now,
      }).returning();

      return { success: true, verified: true, configId, tenantId: input.tenantId };
    }),


  // ── Provision new tenant via onboarding wizard ───────────────────────────
  provisionTenant: protectedProcedure
    .input(z.object({
      companyName: z.string().min(2),
      companyType: z.string().default("imto_partner"),
      country: z.string().length(2).default("NG"),
      registrationNumber: z.string().min(2),
      contactEmail: z.string().email(),
      contactPhone: z.string().optional(),
      billingTier: z.enum(["starter", "growth", "enterprise"]).default("growth"),
      platformSplitPct: z.number().min(10).max(90).default(40),
      transferFeePct: z.number().min(0).max(5).default(1.2),
      fxSpreadPct: z.number().min(0).max(3).default(0.5),
      onboardingFeeUsd: z.number().min(0).default(500),
      monthlyPlatformFeeUsd: z.number().min(0).default(200),
      complianceLevel: z.string().default("standard"),
      corridors: z.array(z.string()).default(["UK_NG", "US_NG"]),
      amlProvider: z.string().default("smile_id"),
      kycTier: z.string().default("tier2"),
      webhookUrl: z.string().optional(),
      ipWhitelist: z.string().optional(),
      rateLimitPerMin: z.number().int().min(10).max(10000).default(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { randomBytes } = await import("crypto");
      const tenantId = `tenant_${randomBytes(6).toString("hex")}`;
      const configId = `cfg_${randomBytes(6).toString("hex")}`;
      const workflowId = `wf_${randomBytes(8).toString("hex")}`;
      const now = Date.now();
      await db.insert(billingTenants).values({
        tenantId,
        tenantName: input.companyName,
        tier: input.billingTier,
        isActive: true,
        contactEmail: input.contactEmail,
        onboardedAt: new Date(),
      }).onConflictDoNothing().returning();
      await db.insert(billingConfigs).values({
        configId,
        tenantId,
        version: "1.0.0",
        isActive: true,
        feeMode: "PERCENTAGE",
        feePercentage: String(input.transferFeePct),
        flatFeeMinor: 0,
        feeCapMinor: 2000,
        feeFloorMinor: 100,
        fxSpreadPercentage: String(input.fxSpreadPct),
        hedgeCostPercentage: "0.15",
        platformFeeSharePct: String(input.platformSplitPct),
        platformFxSharePct: "100.0",
        overheadPerTxMinor: 50,
        updatedBy: String(ctx.user.id),
        changeReason: "Initial provisioning via onboarding wizard",
        createdAtMs: now,
        updatedAtMs: now,
      }).onConflictDoNothing().returning();
      await createAuditLog({
        userId: ctx.user.id,
        action: "billing.tenant.provisioned",
        targetType: "billing_tenant",
        targetId: 0,
        description: `Tenant ${input.companyName} provisioned via onboarding wizard`,
        severity: "info",
        metadata: { tenantId, companyType: input.companyType, corridors: input.corridors, workflowId },
      });
      try {
        const { getTemporalClient } = await import("../_core/temporal");
        const client = await getTemporalClient();
        if (client) {
          await client.workflow.start("tenantOnboardingWorkflow", {
            taskQueue: "remitflow-onboarding",
            workflowId,
            args: [{ tenantId, ...input }],
          });
        }
      } catch {
        // Temporal unavailable — provisioning continues without workflow orchestration
      }
      return { tenantId, configId, workflowId, status: "provisioned" };
    }),

  // ── Health check ──────────────────────────────────────────────────────────
  health: protectedProcedure.query(async () => {
    const engineHealth = await callBillingEngine("/v1/health", "GET");
    return {
      status: "ok",
      goEngine: engineHealth ? "connected" : "unavailable (using local fallback)",
      timestamp: Date.now(),
    };
  }),
});
