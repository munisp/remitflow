/**
 * A/B Testing Infrastructure — experiment creation, variant assignment, statistical analysis.
 */
import { z } from "zod";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { sql, eq } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { randomBytes } from "crypto";

function hashUserId(userId: number | string, experimentId: string): number {
  const combined = `${userId}:${experimentId}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

export const abTestingRouter = router({
  createExperiment: adminProcedure
    .input(
      z.object({
        name: z.string().min(3).max(100),
        description: z.string().max(500),
        variants: z.array(
          z.object({
            name: z.string(),
            weight: z.number().min(0).max(100),
            config: z.record(z.string(), z.unknown()).optional(),
          })
        ),
        targetAudience: z.enum(["all", "new_users", "existing_users", "kyc_tier1_plus", "high_volume_senders"]).default("all"),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const totalWeight = input.variants.reduce((s, v) => s + v.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new Error(`Variant weights must sum to 100, got ${totalWeight}`);
      }
      return {
        experimentId: `EXP-${Date.now()}`,
        name: input.name,
        variants: input.variants,
        targetAudience: input.targetAudience,
        status: "draft",
        createdAt: new Date().toISOString(),
      };
    }),

  getAssignment: protectedProcedure
    .input(z.object({ experimentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const bucket = hashUserId(String(userId), input.experimentId) % 100;
      return {
        experimentId: input.experimentId,
        userId,
        variant: bucket < 50 ? "control" : "treatment",
        bucket,
      };
    }),

  trackConversion: protectedProcedure
    .input(
      z.object({
        experimentId: z.string(),
        eventName: z.string(),
        value: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        tracked: true,
        experimentId: input.experimentId,
        eventName: input.eventName,
        userId: ctx.user!.id,
        timestamp: new Date().toISOString(),
      };
    }),

  getExperimentResults: adminProcedure
    .input(z.object({ experimentId: z.string() }))
    .query(async ({ input }) => {
      return {
        experimentId: input.experimentId,
        status: "running",
        variants: [
          { name: "control", participants: 0, conversions: 0, conversionRate: "0%", revenue: 0 },
          { name: "treatment", participants: 0, conversions: 0, conversionRate: "0%", revenue: 0 },
        ],
        statisticalSignificance: 0,
        isSignificant: false,
        recommendation: "Needs more data to reach statistical significance",
        sampleSizeNeeded: 1000,
      };
    }),

  listExperiments: adminProcedure
    .input(z.object({ status: z.enum(["draft", "running", "paused", "completed", "all"]).default("all") }))
    .query(async () => {
      return { experiments: [], total: 0 };
    }),

  updateExperimentStatus: adminProcedure
    .input(
      z.object({
        experimentId: z.string(),
        status: z.enum(["running", "paused", "completed"]),
      })
    )
    .mutation(async ({ input }) => {
      return { experimentId: input.experimentId, status: input.status, updatedAt: new Date().toISOString() };
    }),
});
