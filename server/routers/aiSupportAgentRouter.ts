/**
 * RemitFlow — AI Support Agent Router (Ollama-powered)
 * ══════════════════════════════════════════════════════════════════════════════
 * Provides an intelligent customer support agent powered by local Ollama LLM
 * inference. The agent uses the ART (Adaptive Reasoning & Tools) framework to
 * answer customer queries about transfers, fees, KYC, and account status by
 * reasoning over live data from the database.
 *
 * Key capabilities:
 *  - Multi-turn conversation with session memory (Redis-backed)
 *  - Tool-augmented reasoning: live FX rates, transfer status, fee calculator
 *  - Escalation detection: automatically flags complex issues for human agents
 *  - Sentiment analysis: detects frustrated customers for priority routing
 *  - Multilingual: supports EN, FR, PT, SW, HA, YO, IG via Ollama qwen2.5
 *  - PII-safe: strips sensitive data before logging
 *
 * Model preference: qwen2.5:7b (multilingual) → llama3.1:8b → phi3:mini
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { requireRedisClient } from "../middleware/redis";
const redis = requireRedisClient();
import { ollamaChat, runARTAgent, type OllamaMessage } from "../ollama.service";
import { db } from "../db-shim";
import { transactions, wallets, users } from "../../drizzle/schema";
import { eq, desc, and, gte } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
const MAX_HISTORY_TURNS = 10;
const SUPPORT_MODEL = process.env.OLLAMA_SUPPORT_MODEL ?? "qwen2.5:7b";

// ── System Prompt ─────────────────────────────────────────────────────────────

const SUPPORT_SYSTEM_PROMPT = `You are RemitFlow's AI support assistant — a helpful, professional, and empathetic customer service agent for an international money transfer platform.

Your responsibilities:
1. Answer questions about transfer status, fees, exchange rates, and delivery times
2. Help customers understand KYC requirements and document submission
3. Explain transaction limits based on KYC tier
4. Assist with account and wallet queries
5. Escalate complex issues (disputes, fraud, compliance holds) to human agents

Tone: Friendly, clear, concise. Avoid jargon. Use the customer's preferred language.

Rules:
- NEVER share another customer's data
- NEVER promise specific outcomes for compliance holds or disputes
- NEVER provide legal or tax advice
- If you are unsure, say so and offer to escalate
- Always confirm the customer's transfer reference number before discussing a specific transfer

Supported corridors: Nigeria, Ghana, Kenya, South Africa, UK, USA, Canada, EU, Philippines, India, Mexico, Brazil.

When you detect frustration or urgency, acknowledge the customer's feelings first before providing information.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripPii(text: string): string {
  return text
    .replace(/\b\d{10,16}\b/g, "[ACCOUNT_NUMBER]")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g, "[IBAN]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]")
    .replace(/\b\d{11}\b/g, "[BVN/NIN]");
}

function detectEscalationNeeded(message: string): boolean {
  const escalationKeywords = [
    "fraud", "stolen", "unauthorized", "dispute", "chargeback",
    "compliance hold", "frozen", "blocked", "lawyer", "lawsuit",
    "report", "police", "regulator", "refund", "scam",
  ];
  const lower = message.toLowerCase();
  return escalationKeywords.some((kw) => lower.includes(kw));
}

function detectSentiment(message: string): "positive" | "neutral" | "frustrated" | "urgent" {
  const frustrated = ["angry", "furious", "terrible", "awful", "ridiculous", "unacceptable", "disgusting", "worst"];
  const urgent = ["urgent", "emergency", "asap", "immediately", "right now", "critical", "dying", "hospital"];
  const lower = message.toLowerCase();
  if (urgent.some((w) => lower.includes(w))) return "urgent";
  if (frustrated.some((w) => lower.includes(w))) return "frustrated";
  return "neutral";
}

async function getSessionHistory(sessionId: string): Promise<OllamaMessage[]> {
  const raw = await redis.get(`support:session:${sessionId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OllamaMessage[];
  } catch {
    return [];
  }
}

async function saveSessionHistory(sessionId: string, history: OllamaMessage[]): Promise<void> {
  const trimmed = history.slice(-MAX_HISTORY_TURNS * 2); // Keep last N turns (user + assistant)
  await redis.set(`support:session:${sessionId}`, JSON.stringify(trimmed), "EX", SESSION_TTL_SECONDS);
}

// ── Router ────────────────────────────────────────────────────────────────────

export const aiSupportAgentRouter = router({
  /**
   * Send a message to the AI support agent and get a response.
   */
  chat: protectedProcedure
    .input(z.object({
      sessionId: z.string().min(8).max(64),
      message: z.string().min(1).max(2000),
      language: z.enum(["en", "fr", "pt", "sw", "ha", "yo", "ig"]).default("en"),
      transferRef: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const { sessionId, message, language, transferRef } = input;

      // Detect sentiment and escalation need
      const sentiment = detectSentiment(message);
      const needsEscalation = detectEscalationNeeded(message);

      // Fetch user context for grounding
      let userContext = "";
      try {
        const [dbUser] = await db.select({
          kycTier: users.kycTier,
          name: users.name,
        }).from(users).where(eq(users.id, userId)).limit(1);

        if (dbUser) {
          userContext = `Customer KYC Tier: ${dbUser.kycTier ?? "tier0"}. `;
        }

        // If transfer ref provided, fetch transfer status
        if (transferRef) {
          const [txn] = await db.select({
            status: transactions.status,
            amount: transactions.fromAmount,
            currency: transactions.fromCurrency,
            createdAt: transactions.createdAt,
          }).from(transactions).where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.reference, transferRef),
            )
          ).limit(1);

          if (txn) {
            userContext += `Transfer ${transferRef}: ${txn.status}, ${txn.amount} ${txn.currency}, initiated ${txn.createdAt?.toISOString().slice(0, 10)}.`;
          } else {
            userContext += `Transfer reference ${transferRef} not found for this account.`;
          }
        }
      } catch (e) {
        logger.warn({ err: e }, "[SupportAgent] Failed to fetch user context");
      }

      // Build conversation history
      const history = await getSessionHistory(sessionId);

      const systemPrompt = `${SUPPORT_SYSTEM_PROMPT}

Current customer context: ${userContext || "No additional context available."}
Customer's preferred language: ${language.toUpperCase()}
Customer sentiment: ${sentiment}

${language !== "en" ? `IMPORTANT: Respond in ${language === "fr" ? "French" : language === "pt" ? "Portuguese" : language === "sw" ? "Swahili" : language === "ha" ? "Hausa" : language === "yo" ? "Yoruba" : "Igbo"} unless the customer writes in English.` : ""}`;

      const messages: OllamaMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: stripPii(message) },
      ];

      // Call Ollama
      const response = await ollamaChat(messages, SUPPORT_MODEL, {
        temperature: 0.3,
        maxTokens: 512,
      });

      // Update session history (without system prompt)
      const updatedHistory: OllamaMessage[] = [
        ...history,
        { role: "user", content: message },
        { role: "assistant", content: response.content },
      ];
      await saveSessionHistory(sessionId, updatedHistory);

      // Log for quality monitoring (PII-stripped)
      logger.info({
        sessionId,
        userId,
        model: response.model,
        durationMs: response.durationMs,
        sentiment,
        needsEscalation,
        usedFallback: response.usedFallback,
      }, "[SupportAgent] Chat response generated");

      return {
        response: response.content,
        model: response.model,
        durationMs: response.durationMs,
        sentiment,
        needsEscalation,
        escalationReason: needsEscalation
          ? "This query may require human agent review. Connecting you to our compliance team."
          : null,
        sessionId,
        turnCount: Math.floor(updatedHistory.length / 2),
        usedFallback: response.usedFallback,
      };
    }),

  /**
   * Use the ART (ReAct) agent for complex multi-step support queries.
   * Suitable for: "How much will it cost to send $500 to Nigeria today?"
   */
  agentQuery: protectedProcedure
    .input(z.object({
      question: z.string().min(5).max(1000),
      sessionId: z.string().min(8).max(64),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await runARTAgent(
        `[Customer Support Query] ${input.question}`,
        5,
      );

      logger.info({
        sessionId: input.sessionId,
        userId: ctx.user.id,
        steps: result.steps.length,
        durationMs: result.durationMs,
      }, "[SupportAgent] ART agent query completed");

      return {
        answer: result.finalAnswer,
        reasoning: result.steps.map((s) => ({
          thought: s.thought,
          action: s.action,
          observation: s.observation,
        })),
        confidence: result.confidence,
        model: result.model,
        durationMs: result.durationMs,
      };
    }),

  /**
   * Clear the session history for a support conversation.
   */
  clearSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(8).max(64) }))
    .mutation(async ({ input }) => {
      await redis.del(`support:session:${input.sessionId}`);
      return { cleared: true, sessionId: input.sessionId };
    }),

  /**
   * Get the conversation history for a session.
   */
  getHistory: protectedProcedure
    .input(z.object({ sessionId: z.string().min(8).max(64) }))
    .query(async ({ input }) => {
      const history = await getSessionHistory(input.sessionId);
      return {
        sessionId: input.sessionId,
        turns: Math.floor(history.length / 2),
        messages: history.filter((m) => m.role !== "system"),
      };
    }),
});
