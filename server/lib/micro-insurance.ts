/**
 * Remittance-linked Micro-Insurance — transfer protection, diaspora health cover.
 */
import { z } from "zod";
import { getDb } from "../db";
import { transactions, users } from "../../drizzle/schema";
import { sql, eq, gte, count, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const INSURANCE_PRODUCTS = [
  {
    id: "transfer_protection",
    name: "Transfer Protection",
    description: "Covers FX loss >5%, delivery failure, and fraud on this transfer",
    premiumRate: 0.0005,
    minPremium: 100,
    maxCoverage: 5000000,
    coverageDetails: ["FX loss protection (>5% swing)", "Delivery failure refund", "Fraud protection", "Instant claims processing"],
  },
  {
    id: "diaspora_health",
    name: "Diaspora Health Cover",
    description: "Micro health insurance for your recipient — purchased as a gift",
    premiumRate: 0.002,
    minPremium: 500,
    maxCoverage: 2000000,
    coverageDetails: ["Hospital admission cover", "Outpatient treatment", "Prescription medication", "Emergency ambulance"],
  },
  {
    id: "device_insurance",
    name: "Device Protection",
    description: "Protect your phone — covers theft, damage, and screen repair",
    premiumRate: 0.01,
    minPremium: 200,
    maxCoverage: 500000,
    coverageDetails: ["Screen damage repair", "Theft replacement", "Water damage", "Hardware failure"],
  },
] as const;

export const microInsuranceRouter = router({
  getProducts: protectedProcedure.query(async () => {
    return INSURANCE_PRODUCTS.map((p) => ({
      ...p,
      premiumRatePercentage: `${(p.premiumRate * 100).toFixed(2)}%`,
    }));
  }),

  getQuote: protectedProcedure
    .input(
      z.object({
        productId: z.string(),
        coverageAmount: z.number().positive(),
        durationDays: z.number().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      const product = INSURANCE_PRODUCTS.find((p) => p.id === input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });
      if (input.coverageAmount > product.maxCoverage) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum coverage is ${product.maxCoverage}` });
      }
      const premium = Math.max(product.minPremium, Math.round(input.coverageAmount * product.premiumRate * (input.durationDays / 30)));
      return {
        productId: input.productId,
        productName: product.name,
        coverageAmount: input.coverageAmount,
        premium,
        durationDays: input.durationDays,
        coverageDetails: product.coverageDetails,
        termsUrl: `/insurance/terms/${input.productId}`,
      };
    }),

  purchase: protectedProcedure
    .input(
      z.object({
        productId: z.string(),
        coverageAmount: z.number().positive(),
        durationDays: z.number().min(1).max(365).default(30),
        transactionId: z.string().optional(),
        beneficiaryId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const product = INSURANCE_PRODUCTS.find((p) => p.id === input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });
      const premium = Math.max(product.minPremium, Math.round(input.coverageAmount * product.premiumRate * (input.durationDays / 30)));
      return {
        policyId: `POL-${Date.now()}`,
        productId: input.productId,
        productName: product.name,
        coverageAmount: input.coverageAmount,
        premium,
        status: "active",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + input.durationDays * 86400000).toISOString(),
        linkedTransactionId: input.transactionId,
      };
    }),

  getMyPolicies: protectedProcedure.query(async ({ ctx }) => {
    return {
      policies: [],
      totalActivePolicies: 0,
      totalCoverage: 0,
    };
  }),

  fileClaim: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        claimType: z.enum(["fx_loss", "delivery_failure", "fraud", "health", "device_damage", "device_theft"]),
        description: z.string().min(10).max(2000),
        evidenceUrls: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        claimId: `CLM-${Date.now()}`,
        policyId: input.policyId,
        claimType: input.claimType,
        status: "submitted",
        expectedResolutionDays: input.claimType === "fx_loss" ? 1 : 5,
        submittedAt: new Date().toISOString(),
      };
    }),
});
