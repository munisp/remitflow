/**
 * RemitFlow — AI FX Market Commentary Router (Ollama-powered)
 * ══════════════════════════════════════════════════════════════════════════════
 * Generates real-time, contextual FX market commentary for remittance corridors
 * using local Ollama LLM inference. Helps customers make informed decisions
 * about when to send money.
 *
 * Features:
 *  - Corridor-specific commentary (USD/NGN, GBP/KES, EUR/GHS, etc.)
 *  - Rate trend analysis (7-day, 30-day moving averages)
 *  - Best-time-to-send recommendations
 *  - Rate alert narrative generation
 *  - Weekly FX digest for email/push notifications
 *  - Multilingual commentary (EN, FR, PT, SW)
 *
 * Model preference: mistral:7b → llama3.1:8b → phi3:mini
 * (Mistral excels at structured financial text generation)
 */

import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { redis } from "../middleware/redis";
import { ollamaChat, generateStructuredOutput } from "../ollama.service";
import { db } from "../db";
import { fxRates } from "../../drizzle/schema";
import { eq, desc, gte, and } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const FX_MODEL = process.env.OLLAMA_FX_MODEL ?? "mistral:7b";
const COMMENTARY_CACHE_TTL = 15 * 60; // 15 minutes — FX moves fast
const DIGEST_CACHE_TTL = 60 * 60 * 6; // 6 hours for weekly digest

// ── Corridor Definitions ──────────────────────────────────────────────────────

const CORRIDORS: Record<string, { from: string; to: string; label: string; typical: number }> = {
  "USD_NGN": { from: "USD", to: "NGN", label: "US Dollar to Nigerian Naira", typical: 1580 },
  "GBP_NGN": { from: "GBP", to: "NGN", label: "British Pound to Nigerian Naira", typical: 2000 },
  "EUR_NGN": { from: "EUR", to: "NGN", label: "Euro to Nigerian Naira", typical: 1720 },
  "USD_GHS": { from: "USD", to: "GHS", label: "US Dollar to Ghanaian Cedi", typical: 15.2 },
  "GBP_GHS": { from: "GBP", to: "GHS", label: "British Pound to Ghanaian Cedi", typical: 19.2 },
  "USD_KES": { from: "USD", to: "KES", label: "US Dollar to Kenyan Shilling", typical: 129 },
  "GBP_KES": { from: "GBP", to: "KES", label: "British Pound to Kenyan Shilling", typical: 163 },
  "USD_ZAR": { from: "USD", to: "ZAR", label: "US Dollar to South African Rand", typical: 18.5 },
  "USD_PHP": { from: "USD", to: "PHP", label: "US Dollar to Philippine Peso", typical: 56.1 },
  "USD_INR": { from: "USD", to: "INR", label: "US Dollar to Indian Rupee", typical: 83.2 },
  "USD_MXN": { from: "USD", to: "MXN", label: "US Dollar to Mexican Peso", typical: 17.1 },
  "USD_BRL": { from: "USD", to: "BRL", label: "US Dollar to Brazilian Real", typical: 4.97 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchRateHistory(
  fromCurrency: string,
  toCurrency: string,
  days: number = 7,
): Promise<Array<{ date: string; rate: number }>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db.select({
      createdAt: fxRates.createdAt,
      rate: fxRates.rate,
    })
      .from(fxRates)
      .where(
        and(
          eq(fxRates.fromCurrency, fromCurrency),
          eq(fxRates.toCurrency, toCurrency),
          gte(fxRates.createdAt, since),
        )
      )
      .orderBy(desc(fxRates.createdAt))
      .limit(days * 24); // hourly snapshots

    return rows.map((r) => ({
      date: r.createdAt?.toISOString().slice(0, 10) ?? "",
      rate: parseFloat(r.rate ?? "0"),
    }));
  } catch {
    return [];
  }
}

function computeTrend(history: Array<{ rate: number }>): {
  change7d: number;
  changePercent7d: number;
  direction: "up" | "down" | "stable";
  volatility: "low" | "medium" | "high";
} {
  if (history.length < 2) {
    return { change7d: 0, changePercent7d: 0, direction: "stable", volatility: "low" };
  }
  const latest = history[0].rate;
  const oldest = history[history.length - 1].rate;
  const change7d = latest - oldest;
  const changePercent7d = (change7d / oldest) * 100;

  const rates = history.map((h) => h.rate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rates.length;
  const stdDev = Math.sqrt(variance);
  const cv = (stdDev / mean) * 100; // Coefficient of variation

  return {
    change7d: parseFloat(change7d.toFixed(4)),
    changePercent7d: parseFloat(changePercent7d.toFixed(2)),
    direction: Math.abs(changePercent7d) < 0.5 ? "stable" : changePercent7d > 0 ? "up" : "down",
    volatility: cv < 1 ? "low" : cv < 3 ? "medium" : "high",
  };
}

async function generateCorridorCommentary(
  corridorKey: string,
  currentRate: number,
  trend: ReturnType<typeof computeTrend>,
  language: string = "en",
): Promise<string> {
  const corridor = CORRIDORS[corridorKey];
  if (!corridor) return "Rate information unavailable.";

  const rateVsTypical = ((currentRate - corridor.typical) / corridor.typical) * 100;
  const rateContext = rateVsTypical > 2
    ? `${Math.abs(rateVsTypical).toFixed(1)}% above the typical rate (favourable for senders)`
    : rateVsTypical < -2
      ? `${Math.abs(rateVsTypical).toFixed(1)}% below the typical rate (less favourable for senders)`
      : "near the typical rate";

  const systemPrompt = `You are RemitFlow's FX market analyst. Write concise, helpful, and accurate FX commentary for retail remittance customers. Keep it under 80 words. Be factual, not alarmist. Avoid financial advice disclaimers — keep it conversational.${language !== "en" ? ` Write in ${language === "fr" ? "French" : language === "pt" ? "Portuguese" : "Swahili"}.` : ""}`;

  const userPrompt = `Write a brief FX update for the ${corridor.label} corridor.

Current rate: ${currentRate.toFixed(2)} ${corridor.to} per ${corridor.from}
7-day change: ${trend.changePercent7d > 0 ? "+" : ""}${trend.changePercent7d}%
Trend direction: ${trend.direction}
Market volatility: ${trend.volatility}
Rate context: ${rateContext}

Keep it under 80 words. Include a practical recommendation (e.g., "good time to send" or "consider waiting").`;

  const response = await ollamaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    FX_MODEL,
    { temperature: 0.4, maxTokens: 150 },
  );

  return response.content.trim();
}

// ── Router ────────────────────────────────────────────────────────────────────

export const aiFxCommentaryRouter = router({
  /**
   * Get AI-generated FX commentary for a specific corridor.
   */
  getCorridorCommentary: publicProcedure
    .input(z.object({
      fromCurrency: z.string().length(3).toUpperCase(),
      toCurrency: z.string().length(3).toUpperCase(),
      currentRate: z.number().positive(),
      language: z.enum(["en", "fr", "pt", "sw"]).default("en"),
    }))
    .query(async ({ input }) => {
      const corridorKey = `${input.fromCurrency}_${input.toCurrency}`;
      const cacheKey = `fx:commentary:${corridorKey}:${input.language}`;

      // Return cached commentary if fresh
      const cached = await redis.get(cacheKey);
      if (cached) {
        return { ...JSON.parse(cached), fromCache: true };
      }

      // Fetch rate history
      const history = await fetchRateHistory(input.fromCurrency, input.toCurrency, 7);
      const trend = computeTrend(history.length > 0 ? history : [{ rate: input.currentRate }]);

      // Generate commentary
      const commentary = await generateCorridorCommentary(
        corridorKey,
        input.currentRate,
        trend,
        input.language,
      );

      const result = {
        corridor: corridorKey,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        currentRate: input.currentRate,
        trend,
        commentary,
        generatedAt: new Date().toISOString(),
        fromCache: false,
      };

      await redis.set(cacheKey, JSON.stringify(result), "EX", COMMENTARY_CACHE_TTL);
      return result;
    }),

  /**
   * Generate a personalised FX rate alert narrative.
   * Called when a user's rate alert threshold is triggered.
   */
  generateRateAlertNarrative: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3).toUpperCase(),
      toCurrency: z.string().length(3).toUpperCase(),
      currentRate: z.number().positive(),
      targetRate: z.number().positive(),
      alertType: z.enum(["above", "below"]),
      transferAmount: z.number().positive().optional(),
      language: z.enum(["en", "fr", "pt", "sw"]).default("en"),
    }))
    .mutation(async ({ input }) => {
      const corridor = CORRIDORS[`${input.fromCurrency}_${input.toCurrency}`];
      const corridorLabel = corridor?.label ?? `${input.fromCurrency}/${input.toCurrency}`;
      const rateImprovement = Math.abs(
        ((input.currentRate - input.targetRate) / input.targetRate) * 100
      ).toFixed(2);

      const amountContext = input.transferAmount
        ? `For a transfer of ${input.transferAmount} ${input.fromCurrency}, the recipient would receive approximately ${(input.transferAmount * input.currentRate).toFixed(0)} ${input.toCurrency}.`
        : "";

      const response = await ollamaChat([
        {
          role: "system",
          content: "You are RemitFlow's FX alert system. Write a brief, exciting, and helpful push notification message (max 60 words) when a customer's rate alert is triggered.",
        },
        {
          role: "user",
          content: `Rate alert triggered for ${corridorLabel}!
Current rate: ${input.currentRate.toFixed(2)}
Target rate was: ${input.targetRate.toFixed(2)}
Alert type: rate went ${input.alertType} target
Rate improvement: ${rateImprovement}%
${amountContext}

Write a concise push notification message to encourage the customer to send money now.`,
        },
      ], FX_MODEL, { temperature: 0.5, maxTokens: 100 });

      return {
        narrative: response.content.trim(),
        corridor: `${input.fromCurrency}/${input.toCurrency}`,
        currentRate: input.currentRate,
        targetRate: input.targetRate,
        rateImprovementPercent: parseFloat(rateImprovement),
      };
    }),

  /**
   * Generate a weekly FX digest for email/push notifications.
   */
  generateWeeklyDigest: protectedProcedure
    .input(z.object({
      corridors: z.array(z.string()).min(1).max(5),
      language: z.enum(["en", "fr", "pt", "sw"]).default("en"),
    }))
    .query(async ({ input }) => {
      const cacheKey = `fx:digest:${input.corridors.sort().join(",")}_${input.language}`;
      const cached = await redis.get(cacheKey);
      if (cached) return { ...JSON.parse(cached), fromCache: true };

      const corridorSummaries: string[] = [];
      for (const key of input.corridors) {
        const corridor = CORRIDORS[key];
        if (!corridor) continue;
        const history = await fetchRateHistory(corridor.from, corridor.to, 7);
        const trend = computeTrend(history);
        const currentRate = history[0]?.rate ?? corridor.typical;
        corridorSummaries.push(
          `${corridor.label}: ${currentRate.toFixed(2)} (${trend.changePercent7d > 0 ? "+" : ""}${trend.changePercent7d}% this week, ${trend.direction})`
        );
      }

      const response = await ollamaChat([
        {
          role: "system",
          content: "You are RemitFlow's weekly FX analyst. Write a concise weekly FX digest (max 150 words) for remittance customers. Be helpful, factual, and actionable.",
        },
        {
          role: "user",
          content: `Write a weekly FX digest for these corridors:\n${corridorSummaries.join("\n")}\n\nInclude: key movements, best corridor this week, and a practical tip.`,
        },
      ], FX_MODEL, { temperature: 0.4, maxTokens: 250 });

      const result = {
        digest: response.content.trim(),
        corridors: input.corridors,
        generatedAt: new Date().toISOString(),
        fromCache: false,
      };

      await redis.set(cacheKey, JSON.stringify(result), "EX", DIGEST_CACHE_TTL);
      return result;
    }),

  /**
   * List all supported corridors with current rate context.
   */
  listCorridors: publicProcedure.query(() => {
    return Object.entries(CORRIDORS).map(([key, c]) => ({
      key,
      fromCurrency: c.from,
      toCurrency: c.to,
      label: c.label,
      typicalRate: c.typical,
    }));
  }),
});
