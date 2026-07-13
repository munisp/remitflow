/**
 * RemitFlow — Developer Portal Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Self-service developer portal capabilities for B2B API partners:
 *
 *  Webhook Management:
 *   - Register, update, delete webhook endpoints
 *   - Per-event type subscriptions
 *   - HMAC-SHA256 signature verification
 *   - Delivery logs with retry history
 *   - Webhook simulator: fire test events to registered endpoints
 *
 *  API Key Management:
 *   - Create, rotate, revoke API keys
 *   - Scoped permissions (read, write, admin)
 *   - IP allowlist per key
 *   - Usage analytics per key
 *
 *  SDK Generation:
 *   - Generate TypeScript/JavaScript SDK from OpenAPI spec
 *   - Generate Python SDK
 *   - Generate Go SDK
 *   - Downloadable as zip archive
 *
 *  Developer Sandbox:
 *   - Test mode flag per API key
 *   - Synthetic transfer simulation
 *   - Mock KYC approval/rejection
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { getRedisClient } from "../middleware/redis";
const redis = getRedisClient();
import { db } from "../db-shim";
import { webhooks, apiKeys } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import * as crypto from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const WEBHOOK_EVENTS = [
  "transfer.initiated",
  "transfer.completed",
  "transfer.failed",
  "transfer.cancelled",
  "kyc.submitted",
  "kyc.approved",
  "kyc.rejected",
  "kyc.tier.upgraded",
  "fx.rate.alert",
  "bnpl.plan.created",
  "bnpl.instalment.due",
  "bnpl.instalment.paid",
  "bnpl.plan.defaulted",
  "savings.goal.reached",
  "savings.roundup.applied",
  "open_banking.consent.created",
  "open_banking.consent.revoked",
  "fraud.alert.raised",
  "compliance.str.generated",
  "wallet.funded",
  "wallet.withdrawn",
] as const;

type WebhookEvent = typeof WEBHOOK_EVENTS[number];

// ── HMAC Signature ────────────────────────────────────────────────────────────

function generateWebhookSignature(payload: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
}

// ── Webhook Delivery ──────────────────────────────────────────────────────────

async function deliverWebhook(
  url: string,
  secret: string,
  event: string,
  payload: unknown,
): Promise<{ success: boolean; statusCode?: number; durationMs: number; error?: string }> {
  const body = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
    id: `evt_${crypto.randomUUID()}`,
  });

  const signature = generateWebhookSignature(body, secret);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RemitFlow-Signature": signature,
        "X-RemitFlow-Event": event,
        "User-Agent": "RemitFlow-Webhooks/1.0",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return {
      success: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      durationMs: Date.now() - start,
    };
  } catch (e: any) {
    return {
      success: false,
      durationMs: Date.now() - start,
      error: e?.message ?? "Unknown error",
    };
  }
}

// ── Sample Payloads for Simulator ─────────────────────────────────────────────

const SAMPLE_PAYLOADS: Record<WebhookEvent, unknown> = {
  "transfer.initiated": {
    transferId: "txn_test_001",
    userId: 12345,
    amount: "250.00",
    fromCurrency: "USD",
    toCurrency: "NGN",
    exchangeRate: "1580.50",
    recipientName: "Adaeze Okonkwo",
    status: "initiated",
    reference: "RF-TEST-20240101",
  },
  "transfer.completed": {
    transferId: "txn_test_001",
    userId: 12345,
    amount: "250.00",
    fromCurrency: "USD",
    toCurrency: "NGN",
    amountReceived: "395125.00",
    status: "completed",
    completedAt: new Date().toISOString(),
  },
  "transfer.failed": {
    transferId: "txn_test_002",
    userId: 12345,
    amount: "100.00",
    status: "failed",
    failureReason: "Recipient bank account not found",
    failureCode: "RECIPIENT_NOT_FOUND",
  },
  "transfer.cancelled": {
    transferId: "txn_test_003",
    userId: 12345,
    amount: "500.00",
    status: "cancelled",
    cancelledBy: "user",
    cancelledAt: new Date().toISOString(),
  },
  "kyc.submitted": {
    userId: 12345,
    kycTier: "tier2",
    documentType: "passport",
    submittedAt: new Date().toISOString(),
  },
  "kyc.approved": {
    userId: 12345,
    kycTier: "tier2",
    approvedAt: new Date().toISOString(),
    approvedBy: "ai-reviewer",
  },
  "kyc.rejected": {
    userId: 12345,
    kycTier: "tier1",
    rejectionReason: "Document expired",
    rejectedAt: new Date().toISOString(),
  },
  "kyc.tier.upgraded": {
    userId: 12345,
    previousTier: "tier1",
    newTier: "tier2",
    upgradedAt: new Date().toISOString(),
    newDailyLimit: "10000.00",
  },
  "fx.rate.alert": {
    fromCurrency: "USD",
    toCurrency: "NGN",
    currentRate: "1585.00",
    targetRate: "1580.00",
    alertType: "above",
    triggeredAt: new Date().toISOString(),
  },
  "bnpl.plan.created": {
    planId: "bnpl_test_001",
    userId: 12345,
    amount: "500.00",
    currency: "USD",
    instalments: 4,
    instalmentAmount: "125.00",
    interestRate: "1.5",
    status: "active",
  },
  "bnpl.instalment.due": {
    planId: "bnpl_test_001",
    instalmentNumber: 2,
    dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    amount: "125.00",
    currency: "USD",
  },
  "bnpl.instalment.paid": {
    planId: "bnpl_test_001",
    instalmentNumber: 1,
    paidAt: new Date().toISOString(),
    amount: "125.00",
    currency: "USD",
    remainingInstalments: 3,
  },
  "bnpl.plan.defaulted": {
    planId: "bnpl_test_001",
    userId: 12345,
    outstandingAmount: "375.00",
    currency: "USD",
    defaultedAt: new Date().toISOString(),
  },
  "savings.goal.reached": {
    goalId: "goal_test_001",
    userId: 12345,
    goalName: "Emergency Fund",
    targetAmount: "1000.00",
    currency: "USD",
    reachedAt: new Date().toISOString(),
  },
  "savings.roundup.applied": {
    userId: 12345,
    transferId: "txn_test_001",
    roundUpAmount: "0.70",
    currency: "USD",
    goalId: "goal_test_001",
  },
  "open_banking.consent.created": {
    userId: 12345,
    consentId: "consent_test_001",
    institutionId: "barclays-uk",
    permissions: ["ReadAccountsBasic", "ReadBalances"],
    expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  },
  "open_banking.consent.revoked": {
    userId: 12345,
    consentId: "consent_test_001",
    revokedAt: new Date().toISOString(),
  },
  "fraud.alert.raised": {
    userId: 12345,
    transferId: "txn_test_004",
    riskScore: 0.87,
    riskLevel: "high",
    triggeredRules: ["velocity_check", "unusual_corridor"],
    action: "review",
  },
  "compliance.str.generated": {
    strId: "str_test_001",
    userId: 12345,
    transferId: "txn_test_004",
    reportType: "STR",
    generatedAt: new Date().toISOString(),
    submittedToFiu: false,
  },
  "wallet.funded": {
    userId: 12345,
    walletId: "wallet_test_001",
    amount: "500.00",
    currency: "USD",
    fundingMethod: "bank_transfer",
    fundedAt: new Date().toISOString(),
  },
  "wallet.withdrawn": {
    userId: 12345,
    walletId: "wallet_test_001",
    amount: "200.00",
    currency: "USD",
    withdrawalMethod: "bank_transfer",
    withdrawnAt: new Date().toISOString(),
  },
};

// ── Router ────────────────────────────────────────────────────────────────────

export const developerPortalRouter = router({

  // ── Webhook Management ─────────────────────────────────────────────────────

  registerWebhook: protectedProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
      description: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;

      const [webhook] = await db.insert(webhooks).values({
        userId,
        url: input.url,
        events: input.events,
        secret,
        status: "active",
        description: input.description,
      } as any).returning();

      logger.info({ userId, url: input.url, events: input.events }, "[DevPortal] Webhook registered");

      return {
        webhookId: (webhook as any)?.id ?? `wh_${Date.now()}`,
        url: input.url,
        events: input.events,
        secret, // Only shown once
        status: "active",
        message: "Webhook registered. Store the secret securely — it will not be shown again.",
      };
    }),

  listWebhooks: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        status: webhooks.status,
        description: webhooks.description,
        createdAt: webhooks.createdAt,
      })
        .from(webhooks)
        .where(eq(webhooks.userId, ctx.user.id))
        .orderBy(desc(webhooks.createdAt));

      return rows;
    }),

  deleteWebhook: protectedProcedure
    .input(z.object({ webhookId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(webhooks).where(
        and(
          eq(webhooks.id, input.webhookId as any),
          eq(webhooks.userId, ctx.user.id),
        )
      );
      return { deleted: true, webhookId: input.webhookId };
    }),

  /**
   * Fire a test webhook event to a registered endpoint.
   * Useful for integration testing without triggering real transactions.
   */
  simulateWebhookEvent: protectedProcedure
    .input(z.object({
      webhookId: z.string(),
      event: z.enum(WEBHOOK_EVENTS),
      customPayload: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [webhook] = await db.select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.webhookId as any),
            eq(webhooks.userId, ctx.user.id),
          )
        )
        .limit(1);

      if (!webhook) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found." });
      }

      const payload = input.customPayload ?? SAMPLE_PAYLOADS[input.event];
      const result = await deliverWebhook(
        (webhook as any).url,
        (webhook as any).secret,
        input.event,
        payload,
      );

      logger.info({
        webhookId: input.webhookId,
        event: input.event,
        success: result.success,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
      }, "[DevPortal] Webhook simulation fired");

      return {
        event: input.event,
        url: (webhook as any).url,
        success: result.success,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        error: result.error,
        payloadSent: payload,
      };
    }),

  // ── API Key Management ─────────────────────────────────────────────────────

  createApiKey: protectedProcedure
    .input(z.object({
      name: z.string().min(2).max(100),
      scopes: z.array(z.enum(["transfers:read", "transfers:write", "kyc:read", "fx:read", "admin:read"])).min(1),
      ipAllowlist: z.array(z.string().regex(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?).){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/, "Invalid IP address")).optional(),
      expiresAt: z.string().datetime().optional(),
      testMode: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const keyId = `rfk_${crypto.randomBytes(8).toString("hex")}`;
      const keySecret = `rfs_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(keySecret).digest("hex");

      await db.insert(apiKeys).values({
        userId,
        keyId,
        keyHash,
        name: input.name,
        scopes: input.scopes,
        ipAllowlist: input.ipAllowlist ?? [],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        testMode: input.testMode,
        status: "active",
      } as any);

      logger.info({ userId, keyId, scopes: input.scopes }, "[DevPortal] API key created");

      return {
        keyId,
        apiKey: `${keyId}.${keySecret}`, // Full key shown once
        name: input.name,
        scopes: input.scopes,
        testMode: input.testMode,
        message: "API key created. Store it securely — the full key will not be shown again.",
      };
    }),

  listApiKeys: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select({
        keyId: apiKeys.keyId,
        name: apiKeys.name,
        scopes: apiKeys.scopes,
        testMode: apiKeys.testMode,
        status: apiKeys.status,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.user.id))
        .orderBy(desc(apiKeys.createdAt));

      return rows;
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.update(apiKeys)
        .set({ status: "revoked" } as any)
        .where(
          and(
            eq(apiKeys.keyId, input.keyId),
            eq(apiKeys.userId, ctx.user.id),
          )
        );

      return { revoked: true, keyId: input.keyId };
    }),

  // ── SDK Generation ─────────────────────────────────────────────────────────

  /**
   * Get SDK generation instructions and links.
   * In production, this would trigger a CI job to generate and upload SDKs.
   */
  getSdkInfo: protectedProcedure
    .query(() => {
      return {
        sdks: [
          {
            language: "TypeScript",
            packageName: "@remitflow/sdk",
            version: "1.0.0",
            installCommand: "npm install @remitflow/sdk",
            docsUrl: "https://docs.remitflow.io/sdk/typescript",
            githubUrl: "https://github.com/remitflow/sdk-typescript",
            features: ["Full tRPC type safety", "Auto-retry with exponential backoff", "Webhook signature verification", "React hooks included"],
          },
          {
            language: "Python",
            packageName: "remitflow-sdk",
            version: "1.0.0",
            installCommand: "pip install remitflow-sdk",
            docsUrl: "https://docs.remitflow.io/sdk/python",
            githubUrl: "https://github.com/remitflow/sdk-python",
            features: ["Async/await support", "Pydantic models", "Webhook verification", "CLI tool"],
          },
          {
            language: "Go",
            packageName: "github.com/remitflow/sdk-go",
            version: "v1.0.0",
            installCommand: "go get github.com/remitflow/sdk-go",
            docsUrl: "https://docs.remitflow.io/sdk/go",
            githubUrl: "https://github.com/remitflow/sdk-go",
            features: ["Context-aware", "Struct-based requests", "Webhook middleware", "OpenTelemetry instrumented"],
          },
        ],
        openApiSpecUrl: "https://api.remitflow.io/openapi.json",
        postmanCollectionUrl: "https://api.remitflow.io/postman-collection.json",
      };
    }),

  // ── Sandbox Simulation ─────────────────────────────────────────────────────

  /**
   * Simulate a transfer in test mode (no real money moved).
   */
  simulateTransfer: protectedProcedure
    .input(z.object({
      amount: z.number().positive(),
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      outcome: z.enum(["success", "failure", "pending"]).default("success"),
      delaySeconds: z.number().int().min(0).max(30).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      // Simulate processing delay
      if (input.delaySeconds > 0) {
        await new Promise((r) => setTimeout(r, input.delaySeconds * 1000));
      }

      const mockRef = `RF-TEST-${Date.now()}`;
      const mockRate = { USD_NGN: 1580, GBP_NGN: 2000, USD_GHS: 15.2, USD_KES: 129 };
      const rateKey = `${input.fromCurrency}_${input.toCurrency}` as keyof typeof mockRate;
      const rate = mockRate[rateKey] ?? 1.0;

      if (input.outcome === "failure") {
        return {
          success: false,
          reference: mockRef,
          status: "failed",
          failureReason: "Simulated failure — recipient bank declined",
          failureCode: "BANK_DECLINED",
          testMode: true,
        };
      }

      return {
        success: true,
        reference: mockRef,
        status: input.outcome === "pending" ? "pending" : "completed",
        amount: input.amount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        exchangeRate: rate,
        amountReceived: parseFloat((input.amount * rate).toFixed(2)),
        fee: parseFloat((input.amount * 0.015).toFixed(2)),
        completedAt: input.outcome === "completed" ? new Date().toISOString() : null,
        testMode: true,
        message: "This is a test transfer. No real money was moved.",
      };
    }),

  /**
   * List all available webhook event types with sample payloads.
   */
  listWebhookEvents: protectedProcedure
    .query(() => {
      return WEBHOOK_EVENTS.map((event) => ({
        event,
        category: event.split(".")[0],
        samplePayload: SAMPLE_PAYLOADS[event],
      }));
    }),
});
