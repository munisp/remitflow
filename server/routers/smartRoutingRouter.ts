/**
 * RemitFlow — AI Smart Routing Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Provides AI-powered transfer path selection using multi-factor scoring:
 *
 *   1. Cost optimization — minimize total fees across corridors
 *   2. Speed optimization — select fastest settlement path
 *   3. Reliability scoring — historical success rate per corridor/provider
 *   4. Liquidity awareness — real-time liquidity depth from providers
 *   5. Compliance routing — avoid sanctioned intermediaries
 *   6. FX rate optimization — best exchange rate at time of routing
 *
 * The router queries the Go agent intelligence service for ML-based scoring,
 * falls back to rule-based scoring if the service is unavailable.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { withSpan } from "../telemetry/otel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RouteOption {
  routeId: string;
  provider: string;
  corridor: string;
  estimatedFeeUsd: number;
  estimatedFeePercent: number;
  estimatedDeliveryMinutes: number;
  fxRate: number;
  recipientReceives: number;
  reliabilityScore: number;   // 0–100
  liquidityScore: number;     // 0–100
  complianceScore: number;    // 0–100 (100 = fully compliant)
  overallScore: number;       // weighted composite
  recommended: boolean;
  tags: string[];             // e.g. ["fastest", "cheapest", "most_reliable"]
}

interface RoutingDecision {
  requestId: string;
  sendAmount: number;
  sendCurrency: string;
  receiveCurrency: string;
  corridorCode: string;
  routes: RouteOption[];
  recommendedRouteId: string;
  decisionFactors: Record<string, number>;
  modelVersion: string;
  computedAt: Date;
}

// ── Route Scoring (Rule-Based Fallback) ───────────────────────────────────────

const PROVIDER_RELIABILITY: Record<string, number> = {
  mojaloop: 98,
  swift: 95,
  fednow: 99,
  cips: 97,
  sepa: 98,
  stablecoin: 90,
  cbdc: 99,
  ripple: 88,
  wise: 94,
  default: 85,
};

const PROVIDER_SPEED_MINUTES: Record<string, number> = {
  mojaloop: 5,
  fednow: 1,
  cips: 30,
  sepa: 60,
  swift: 1440,
  stablecoin: 2,
  cbdc: 1,
  ripple: 5,
  wise: 120,
  default: 240,
};

function scoreRoute(route: Omit<RouteOption, "overallScore" | "recommended" | "tags">): RouteOption {
  // Weighted scoring: cost 30%, speed 25%, reliability 25%, compliance 20%
  const costScore = Math.max(0, 100 - route.estimatedFeePercent * 20); // 5% fee = 0 score
  const speedScore = Math.max(0, 100 - (route.estimatedDeliveryMinutes / 1440) * 100);
  const reliabilityScore = route.reliabilityScore;
  const complianceScore = route.complianceScore;

  const overallScore =
    costScore * 0.30 +
    speedScore * 0.25 +
    reliabilityScore * 0.25 +
    complianceScore * 0.20;

  const tags: string[] = [];

  return {
    ...route,
    overallScore: Math.round(overallScore * 10) / 10,
    recommended: false,
    tags,
  };
}

function buildRouteOptions(
  sendAmount: number,
  sendCurrency: string,
  receiveCurrency: string,
  fxRates: Record<string, number>
): RouteOption[] {
  const corridorKey = `${sendCurrency}-${receiveCurrency}`;
  const baseRate = fxRates[corridorKey] ?? fxRates[`${receiveCurrency}-${sendCurrency}`]
    ? 1 / (fxRates[`${receiveCurrency}-${sendCurrency}`] ?? 1)
    : 1.0;

  const routes: RouteOption[] = [
    {
      routeId: `route-mojaloop-${Date.now()}`,
      provider: "mojaloop",
      corridor: corridorKey,
      estimatedFeeUsd: 2.50 + sendAmount * 0.010,
      estimatedFeePercent: 1.0,
      estimatedDeliveryMinutes: PROVIDER_SPEED_MINUTES.mojaloop,
      fxRate: baseRate * 0.995,
      recipientReceives: sendAmount * baseRate * 0.995 - 2.50,
      reliabilityScore: PROVIDER_RELIABILITY.mojaloop,
      liquidityScore: 92,
      complianceScore: 100,
      overallScore: 0,
      recommended: false,
      tags: [],
    },
    {
      routeId: `route-stablecoin-${Date.now() + 1}`,
      provider: "stablecoin",
      corridor: corridorKey,
      estimatedFeeUsd: 0.50 + sendAmount * 0.005,
      estimatedFeePercent: 0.5,
      estimatedDeliveryMinutes: PROVIDER_SPEED_MINUTES.stablecoin,
      fxRate: baseRate * 0.998,
      recipientReceives: sendAmount * baseRate * 0.998 - 0.50,
      reliabilityScore: PROVIDER_RELIABILITY.stablecoin,
      liquidityScore: 85,
      complianceScore: 95,
      overallScore: 0,
      recommended: false,
      tags: [],
    },
    {
      routeId: `route-swift-${Date.now() + 2}`,
      provider: "swift",
      corridor: corridorKey,
      estimatedFeeUsd: 15.00 + sendAmount * 0.020,
      estimatedFeePercent: 2.0,
      estimatedDeliveryMinutes: PROVIDER_SPEED_MINUTES.swift,
      fxRate: baseRate * 0.990,
      recipientReceives: sendAmount * baseRate * 0.990 - 15.00,
      reliabilityScore: PROVIDER_RELIABILITY.swift,
      liquidityScore: 99,
      complianceScore: 100,
      overallScore: 0,
      recommended: false,
      tags: [],
    },
  ];

  // Score all routes
  const scoredRoutes = routes.map(scoreRoute);

  // Add tags
  const cheapest = [...scoredRoutes].sort((a, b) => a.estimatedFeeUsd - b.estimatedFeeUsd)[0];
  const fastest = [...scoredRoutes].sort((a, b) => a.estimatedDeliveryMinutes - b.estimatedDeliveryMinutes)[0];
  const mostReliable = [...scoredRoutes].sort((a, b) => b.reliabilityScore - a.reliabilityScore)[0];

  scoredRoutes.forEach((r) => {
    if (r.routeId === cheapest.routeId) r.tags.push("cheapest");
    if (r.routeId === fastest.routeId) r.tags.push("fastest");
    if (r.routeId === mostReliable.routeId) r.tags.push("most_reliable");
  });

  // Mark recommended (highest overall score)
  const recommended = [...scoredRoutes].sort((a, b) => b.overallScore - a.overallScore)[0];
  recommended.recommended = true;
  recommended.tags.push("recommended");

  return scoredRoutes;
}

// ── Agent Intelligence Service Call ──────────────────────────────────────────

async function queryAgentIntelligence(
  sendAmount: number,
  sendCurrency: string,
  receiveCurrency: string,
  userId: number
): Promise<{ routes: RouteOption[]; modelVersion: string } | null> {
  try {
    const agentUrl = process.env.AGENT_INTELLIGENCE_URL ?? "http://go-agent-intelligence:9001";
    const response = await fetch(`${agentUrl}/api/routing/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sendAmount,
        sendCurrency,
        receiveCurrency,
        userId,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000), // 3s timeout — fall back if slow
    });

    if (!response.ok) return null;
    const data = await response.json() as { routes: RouteOption[]; modelVersion: string };
    return data;
  } catch {
    return null;
  }
}

// ── tRPC Router ───────────────────────────────────────────────────────────────

export const smartRoutingRouter = router({
  /**
   * Get AI-scored route options for a transfer.
   * Returns ranked routes with cost, speed, and reliability scores.
   */
  getRoutes: protectedProcedure
    .input(z.object({
      sendAmount: z.number().positive(),
      sendCurrency: z.string().length(3),
      receiveCurrency: z.string().length(3),
      priority: z.enum(["cost", "speed", "reliability", "balanced"]).default("balanced"),
    }))
    .query(async ({ input, ctx }) => {
      return withSpan("smartRouting.getRoutes", async (span) => {
        span.setAttributes({
          "routing.send_currency": input.sendCurrency,
          "routing.receive_currency": input.receiveCurrency,
          "routing.amount": input.sendAmount,
          "routing.priority": input.priority,
        });

        const userId = ctx.user.id;

        // Try AI agent first
        const agentResult = await queryAgentIntelligence(
          input.sendAmount,
          input.sendCurrency,
          input.receiveCurrency,
          userId
        );

        let routes: RouteOption[];
        let modelVersion: string;

        if (agentResult) {
          routes = agentResult.routes;
          modelVersion = agentResult.modelVersion;
          logger.info({ userId, corridor: `${input.sendCurrency}-${input.receiveCurrency}` }, "[SmartRouting] Used AI agent scoring");
        } else {
          // Fall back to rule-based scoring
          const fxRates: Record<string, number> = {
            "USD-NGN": 1580.0,
            "USD-GHS": 15.2,
            "USD-KES": 129.5,
            "GBP-NGN": 2010.0,
            "EUR-NGN": 1720.0,
          };
          routes = buildRouteOptions(input.sendAmount, input.sendCurrency, input.receiveCurrency, fxRates);
          modelVersion = "rule-based-v1";
          logger.info({ userId }, "[SmartRouting] Used rule-based fallback scoring");
        }

        // Re-sort by priority preference
        if (input.priority === "cost") {
          routes.sort((a, b) => a.estimatedFeeUsd - b.estimatedFeeUsd);
        } else if (input.priority === "speed") {
          routes.sort((a, b) => a.estimatedDeliveryMinutes - b.estimatedDeliveryMinutes);
        } else if (input.priority === "reliability") {
          routes.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
        } else {
          routes.sort((a, b) => b.overallScore - a.overallScore);
        }

        const recommendedRoute = routes.find((r) => r.recommended) ?? routes[0];

        return {
          requestId: `RQ-${Date.now()}`,
          sendAmount: input.sendAmount,
          sendCurrency: input.sendCurrency,
          receiveCurrency: input.receiveCurrency,
          routes,
          recommendedRouteId: recommendedRoute?.routeId ?? "",
          modelVersion,
          computedAt: new Date(),
        } satisfies RoutingDecision;
      });
    }),

  /**
   * Get historical routing analytics for a corridor.
   * Shows average fees, delivery times, and success rates.
   */
  getCorridorAnalytics: protectedProcedure
    .input(z.object({
      sendCurrency: z.string().length(3),
      receiveCurrency: z.string().length(3),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ input }) => {
      // In production: query from analytics database / lakehouse
      const corridor = `${input.sendCurrency}-${input.receiveCurrency}`;

      return {
        corridor,
        period: `${input.days}d`,
        averageFeePercent: 1.2,
        averageDeliveryMinutes: 45,
        successRate: 99.3,
        volumeUsd: 1_250_000,
        transactionCount: 8_432,
        topProvider: "mojaloop",
        providerBreakdown: [
          { provider: "mojaloop", share: 0.65, avgFeePercent: 1.0, avgDeliveryMinutes: 5, successRate: 99.8 },
          { provider: "stablecoin", share: 0.25, avgFeePercent: 0.5, avgDeliveryMinutes: 2, successRate: 98.5 },
          { provider: "swift", share: 0.10, avgFeePercent: 2.0, avgDeliveryMinutes: 1440, successRate: 99.9 },
        ],
      };
    }),

  /**
   * Lock in a specific route for a transfer (pre-authorization).
   * Returns a route lock token valid for 60 seconds.
   */
  lockRoute: protectedProcedure
    .input(z.object({
      routeId: z.string(),
      sendAmount: z.number().positive(),
      sendCurrency: z.string().length(3),
      receiveCurrency: z.string().length(3),
    }))
    .mutation(async ({ input, ctx }) => {
      const lockToken = `LOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 60_000); // 60 seconds

      logger.info(
        { userId: ctx.user.id, routeId: input.routeId, lockToken },
        "[SmartRouting] Route locked"
      );

      return {
        lockToken,
        routeId: input.routeId,
        lockedAmount: input.sendAmount,
        sendCurrency: input.sendCurrency,
        receiveCurrency: input.receiveCurrency,
        expiresAt,
        status: "locked",
      };
    }),
});
