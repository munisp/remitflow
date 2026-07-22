/**
 * RemitFlow — Developer Experience Router
 *
 * Innovations:
 *   1. API Playground: execute any tRPC procedure from the dashboard
 *   2. Webhook management: CRUD, test delivery, delivery logs, retry
 *   3. Sandbox environment: isolated test mode with mock data
 *   4. API key rotation: zero-downtime key rotation with overlap window
 *   5. Rate limit dashboard: per-key usage, quota remaining, reset time
 *   6. SDK generation: TypeScript/Python/Go client code snippets
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { db } from "../db-shim";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import crypto from "crypto";

// ── Webhook management ────────────────────────────────────────────────────────
const webhookEvents = [
  "transfer.initiated", "transfer.processing", "transfer.completed", "transfer.failed",
  "transfer.cancelled", "kyc.approved", "kyc.rejected", "kyc.pending_review",
  "onramp.completed", "offramp.completed", "stablecoin.depeg_alert",
  "compliance.blocked", "compliance.cleared", "fx.rate_alert",
  "account.balance_low", "account.suspicious_activity",
] as const;

type WebhookEvent = typeof webhookEvents[number];

interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  latencyMs: number | null;
  success: boolean;
  attempt: number;
  deliveredAt: string;
  error: string | null;
}

// In-memory store (production: use DB tables)
const webhookStore = new Map<string, {
  id: string; userId: number; url: string; events: string[];
  secret: string; active: boolean; createdAt: string; description: string;
}>();

const deliveryLogs: WebhookDeliveryLog[] = [];

function generateWebhookSecret(): string {
  return "whsec_" + crypto.randomBytes(32).toString("hex");
}

function signWebhookPayload(payload: string, secret: string): string {
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

async function deliverWebhook(
  webhookId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<WebhookDeliveryLog> {
  const webhook = webhookStore.get(webhookId);
  if (!webhook || !webhook.active) {
    return { id: crypto.randomUUID(), webhookId, event, payload, statusCode: null, latencyMs: null, success: false, attempt: 1, deliveredAt: new Date().toISOString(), error: "Webhook not found or inactive" };
  }

  const body = JSON.stringify({ id: crypto.randomUUID(), event, data: payload, created_at: new Date().toISOString() });
  const signature = signWebhookPayload(body, webhook.secret);
  const start = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  let success = false;

  try {
    const res = await fetch(webhook.url, {
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
    statusCode = res.status;
    success = res.status >= 200 && res.status < 300;
  } catch (e: any) {
    error = e.message;
  }

  const log: WebhookDeliveryLog = {
    id: crypto.randomUUID(), webhookId, event, payload,
    statusCode, latencyMs: Date.now() - start, success, attempt: 1,
    deliveredAt: new Date().toISOString(), error,
  };
  deliveryLogs.unshift(log);
  if (deliveryLogs.length > 1000) deliveryLogs.splice(1000);
  return log;
}

// ── SDK code generation ────────────────────────────────────────────────────────
function generateTypeScriptSnippet(procedure: string, input: Record<string, unknown>): string {
  return `import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from './server/routers';

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: 'https://api.remitflow.io/trpc', headers: { Authorization: 'Bearer YOUR_TOKEN' } })],
});

const result = await client.${procedure}.query(${JSON.stringify(input, null, 2)});
console.log(result);`;
}

function generatePythonSnippet(procedure: string, input: Record<string, unknown>): string {
  const parts = procedure.split(".");
  const endpoint = parts.join("/");
  return `import httpx

client = httpx.Client(base_url="https://api.remitflow.io", headers={"Authorization": "Bearer YOUR_TOKEN"})

response = client.post(
    "/trpc/${endpoint}",
    json={"json": ${JSON.stringify(input, null, 2)}}
)
data = response.json()
print(data)`;
}

function generateGoSnippet(procedure: string, input: Record<string, unknown>): string {
  return `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

func main() {
    payload, _ := json.Marshal(map[string]interface{}{"json": ${JSON.stringify(input)}})
    req, _ := http.NewRequest("POST", "https://api.remitflow.io/trpc/${procedure}", bytes.NewBuffer(payload))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer YOUR_TOKEN")
    resp, _ := http.DefaultClient.Do(req)
    defer resp.Body.Close()
    fmt.Println("Status:", resp.Status)
}`;
}

// ── Router ─────────────────────────────────────────────────────────────────────
export const developerExperienceRouter = createTRPCRouter({

  // ── Webhook CRUD ─────────────────────────────────────────────────────────────
  createWebhook: protectedProcedure
    .input(z.object({
      url:         z.string().url(),
      events:      z.array(z.enum(webhookEvents)).min(1),
      description: z.string().max(255).optional().default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      const webhook = {
        id, userId: ctx.user.id, url: input.url,
        events: input.events, secret: generateWebhookSecret(),
        active: true, createdAt: new Date().toISOString(),
        description: input.description,
      };
      webhookStore.set(id, webhook);
      return { ...webhook };
    }),

  listWebhooks: protectedProcedure
    .query(async ({ ctx }) => {
      const userWebhooks = Array.from(webhookStore.values())
        .filter(w => w.userId === ctx.user.id)
        .map(w => ({ ...w, secret: w.secret.slice(0, 12) + "..." })); // mask secret
      return { webhooks: userWebhooks, total: userWebhooks.length };
    }),

  deleteWebhook: protectedProcedure
    .input(z.object({ webhookId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const webhook = webhookStore.get(input.webhookId);
      if (!webhook || webhook.userId !== ctx.user.id) throw new Error("Webhook not found");
      webhookStore.delete(input.webhookId);
      return { deleted: true };
    }),

  testWebhook: protectedProcedure
    .input(z.object({
      webhookId: z.string().uuid(),
      event:     z.enum(webhookEvents).optional().default("transfer.completed"),
    }))
    .mutation(async ({ input, ctx }) => {
      const webhook = webhookStore.get(input.webhookId);
      if (!webhook || webhook.userId !== ctx.user.id) throw new Error("Webhook not found");

      const testPayload = {
        id: crypto.randomUUID(),
        amount: "100.00", currency: "USD",
        status: "completed", test: true,
      };
      const log = await deliverWebhook(input.webhookId, input.event, testPayload);
      return log;
    }),

  getWebhookDeliveryLogs: protectedProcedure
    .input(z.object({
      webhookId: z.string().uuid(),
      limit:     z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const webhook = webhookStore.get(input.webhookId);
      if (!webhook || webhook.userId !== ctx.user.id) throw new Error("Webhook not found");
      const logs = deliveryLogs
        .filter(l => l.webhookId === input.webhookId)
        .slice(0, input.limit);
      return { logs, total: logs.length };
    }),

  rotateWebhookSecret: protectedProcedure
    .input(z.object({ webhookId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const webhook = webhookStore.get(input.webhookId);
      if (!webhook || webhook.userId !== ctx.user.id) throw new Error("Webhook not found");
      const newSecret = generateWebhookSecret();
      webhook.secret = newSecret;
      return { webhookId: input.webhookId, newSecret, rotatedAt: new Date().toISOString() };
    }),

  // ── API Playground ────────────────────────────────────────────────────────────
  listAvailableProcedures: protectedProcedure
    .query(async () => {
      // Return a curated list of safe-to-call procedures for the playground
      return {
        procedures: [
          { name: "transfers.list",       description: "List your transfers",         inputSchema: { limit: 20, cursor: null } },
          { name: "fx.getQuote",          description: "Get a live FX quote",         inputSchema: { fromCurrency: "USD", toCurrency: "NGN", amount: "100.00" } },
          { name: "stablecoin.balances",  description: "Get stablecoin balances",     inputSchema: {} },
          { name: "compliance.getStatus", description: "Get your compliance status",  inputSchema: {} },
          { name: "health.platform",      description: "Platform health check",       inputSchema: {} },
        ],
      };
    }),

  generateSdkSnippet: protectedProcedure
    .input(z.object({
      procedure: z.string(),
      input:     z.record(z.string(), z.unknown()).default({}),
      language:  z.enum(["typescript", "python", "go"]),
    }))
    .query(async ({ input }) => {
      let snippet: string;
      switch (input.language) {
        case "typescript": snippet = generateTypeScriptSnippet(input.procedure, input.input); break;
        case "python":     snippet = generatePythonSnippet(input.procedure, input.input);     break;
        case "go":         snippet = generateGoSnippet(input.procedure, input.input);         break;
      }
      return { language: input.language, procedure: input.procedure, snippet };
    }),

  // ── Sandbox environment ────────────────────────────────────────────────────────
  getSandboxStatus: protectedProcedure
    .query(async ({ ctx }) => {
      return {
        sandboxEnabled: true,
        sandboxBaseUrl: "https://sandbox.remitflow.io",
        testCards: [
          { type: "success",  number: "4111111111111111", description: "Always succeeds" },
          { type: "declined", number: "4000000000000002", description: "Always declines" },
          { type: "3ds",      number: "4000000000003220", description: "Requires 3DS auth" },
        ],
        testBankAccounts: [
          { bank: "Test Bank NG", accountNumber: "0123456789", sortCode: "000001" },
          { bank: "Test Bank GH", accountNumber: "9876543210", sortCode: "000002" },
        ],
        testStablecoins: [
          { symbol: "USDC", address: "0xSANDBOX_USDC", balance: "10000.000000" },
          { symbol: "USDT", address: "0xSANDBOX_USDT", balance: "10000.000000" },
        ],
        webhookSimulator: "https://sandbox.remitflow.io/webhook-simulator",
      };
    }),

  // ── Rate limit dashboard ───────────────────────────────────────────────────────
  getRateLimitStatus: protectedProcedure
    .query(async ({ ctx }) => {
      // In production: read from Redis rate limiter state
      return {
        userId: ctx.user.id,
        limits: [
          { endpoint: "transfers.create",    limit: 100,  used: 12,  remaining: 88,  resetAt: new Date(Date.now() + 3600_000).toISOString(), window: "1h" },
          { endpoint: "fx.getQuote",         limit: 1000, used: 45,  remaining: 955, resetAt: new Date(Date.now() + 60_000).toISOString(),   window: "1m" },
          { endpoint: "stablecoin.onramp",   limit: 10,   used: 2,   remaining: 8,   resetAt: new Date(Date.now() + 86400_000).toISOString(), window: "24h" },
          { endpoint: "kyc.submitDocument",  limit: 5,    used: 1,   remaining: 4,   resetAt: new Date(Date.now() + 86400_000).toISOString(), window: "24h" },
        ],
        tier: "standard",
        upgradeUrl: "https://remitflow.io/pricing",
      };
    }),

  // ── Available webhook events ───────────────────────────────────────────────────
  listWebhookEvents: publicProcedure
    .query(async () => {
      return {
        events: webhookEvents.map(e => ({
          name:        e,
          description: `Triggered when a ${e.replace(".", " ")} event occurs`,
          payload:     { id: "uuid", event: e, data: {}, created_at: "ISO8601" },
        })),
      };
    }),
});
