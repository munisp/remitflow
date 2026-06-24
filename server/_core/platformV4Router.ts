/**
 * platformV4Router.ts — tRPC router for Phase 4 platform hardening endpoints
 *
 * Wires all platformHardeningV4.ts functions into tRPC procedures:
 * - KYC: Synthetic identity detection, document fraud ML, EDD submission
 * - Stablecoins: On-chain transfer, insurance claims
 * - Fund Flow: Transaction simulation, multi-rail failover, FX hedging, DLQ
 * - Middleware: Fluvio, OpenSearch, Lakehouse, APISix, TigerBeetle
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "./trpc";
import { getDb } from "../db";
import {
  detectSyntheticIdentity,
  verifyDocumentAuthenticity,
  submitEDDInformation,
  executeOnChainTransfer,
  submitInsuranceClaim,
  simulateTransfer,
  selectRailWithFailover,
  hedgeFxRateLock,
  processDLQ,
  registerFluvioSmartModules,
  applyOpenSearchLifecyclePolicies,
  triggerLakehousePipeline,
  syncAPISixRoutes,
  reconcileTigerBeetle,
  initV4Schema,
} from "./platformHardeningV4";

// ── KYC/KYB Endpoints ───────────────────────────────────────────────────────

const kycV4Router = router({
  detectSyntheticIdentity: protectedProcedure
    .input(z.object({
      applicantId: z.string(),
      fullName: z.string(),
      dateOfBirth: z.string(),
      ssn: z.string().optional(),
      phone: z.string(),
      email: z.string().email(),
      address: z.string(),
      deviceFingerprint: z.string(),
      ipAddress: z.string(),
      applicationTimestamp: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return detectSyntheticIdentity(db, input);
    }),

  verifyDocumentAuthenticity: protectedProcedure
    .input(z.object({
      documentId: z.string(),
      documentType: z.enum(["passport", "national_id", "drivers_license", "utility_bill", "bank_statement"]),
      issuingCountry: z.string().length(2),
      imageBase64: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return verifyDocumentAuthenticity(db, input);
    }),

  submitEDD: protectedProcedure
    .input(z.object({
      userId: z.string(),
      sourceOfWealth: z.enum(["employment", "business", "inheritance", "investments", "real_estate", "other"]),
      sourceOfFunds: z.enum(["salary", "business_income", "savings", "loan", "gift", "sale_of_assets", "other"]),
      employerName: z.string().optional(),
      annualIncome: z.number().positive(),
      incomeCurrency: z.string(),
      evidenceDocumentIds: z.array(z.string()),
      additionalNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return submitEDDInformation(db, input);
    }),
});

// ── Stablecoin Endpoints ────────────────────────────────────────────────────

const stablecoinV4Router = router({
  executeOnChainTransfer: protectedProcedure
    .input(z.object({
      userId: z.string(),
      fromAddress: z.string(),
      toAddress: z.string(),
      amount: z.string(),
      tokenAddress: z.string(),
      chain: z.enum(["ethereum", "polygon", "arbitrum", "optimism", "base", "avalanche"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return executeOnChainTransfer(db, input);
    }),

  submitInsuranceClaim: protectedProcedure
    .input(z.object({
      userId: z.string(),
      policyId: z.string(),
      incidentType: z.enum(["de_peg", "smart_contract_hack", "bridge_exploit", "oracle_failure"]),
      incidentDate: z.string(),
      affectedAmount: z.number().positive(),
      affectedCurrency: z.string(),
      description: z.string(),
      evidenceUrls: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return submitInsuranceClaim(db, input);
    }),
});

// ── Fund Flow Endpoints ─────────────────────────────────────────────────────

const fundFlowV4Router = router({
  simulateTransfer: protectedProcedure
    .input(z.object({
      fromUserId: z.string(),
      toUserId: z.string(),
      amount: z.number().positive(),
      currency: z.string(),
      targetCurrency: z.string(),
      corridor: z.string(),
      rail: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return simulateTransfer(db, input);
    }),

  selectRail: protectedProcedure
    .input(z.object({
      corridor: z.string(),
      amount: z.number().positive(),
      currency: z.string(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return selectRailWithFailover(db, input.corridor, input.amount, input.currency);
    }),

  hedgeFxRate: protectedProcedure
    .input(z.object({
      quoteId: z.string(),
      fromCurrency: z.string(),
      toCurrency: z.string(),
      amount: z.number().positive(),
      lockedRate: z.number().positive(),
      expiresAt: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return hedgeFxRateLock(db, input);
    }),

  processDLQ: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return processDLQ(db);
    }),
});

// ── Middleware/Infra Endpoints ──────────────────────────────────────────────

const middlewareV4Router = router({
  registerFluvioModules: adminProcedure
    .mutation(async () => {
      await registerFluvioSmartModules();
      return { success: true, timestamp: new Date().toISOString() };
    }),

  applyOpenSearchPolicies: adminProcedure
    .mutation(async () => {
      await applyOpenSearchLifecyclePolicies();
      return { success: true, timestamp: new Date().toISOString() };
    }),

  triggerLakehouse: adminProcedure
    .input(z.object({
      layer: z.enum(["bronze", "silver", "gold"]),
      fullRefresh: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return triggerLakehousePipeline(input.layer, { fullRefresh: input.fullRefresh });
    }),

  syncAPISixRoutes: adminProcedure
    .mutation(async () => {
      await syncAPISixRoutes();
      return { success: true, timestamp: new Date().toISOString() };
    }),

  reconcileTigerBeetle: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return reconcileTigerBeetle(db);
    }),

  initSchema: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await initV4Schema(db);
      return { success: true, timestamp: new Date().toISOString() };
    }),
});

// ── Exported Router ─────────────────────────────────────────────────────────

export const platformV4Router = router({
  kyc: kycV4Router,
  stablecoin: stablecoinV4Router,
  fundFlow: fundFlowV4Router,
  middleware: middlewareV4Router,
});
