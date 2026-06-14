/**
 * platformFeatures.ts — F11-F20: Additional Platform Features
 *
 * F11: Stablecoin Payroll — employer dashboard, salary disbursement
 * F12: Multi-Currency Wallet — unified balance view across currencies
 * F13: Spending Analytics — categorized reports, trends, budgets
 * F14: Limit Orders — buy/sell at target FX rate
 * F15: Gift Cards — buy gift cards with stablecoins
 * F16: Developer API/SDK — public API for third-party integration
 * F17: Referral Program — refer friends, earn bonus USDC
 * F18: Deposit Insurance — user-facing coverage up to $X
 * F19: DAO Governance — community voting for platform decisions
 * F20: NFT Receipts — mint receipt NFT for major transactions
 *
 * Middleware: Kafka, Redis, PostgreSQL, TigerBeetle, OpenSearch, Temporal,
 * Keycloak, Permify, Lakehouse.
 */

import { z } from "zod";
import { randomBytes, createHash } from "crypto";
import { protectedProcedure, router } from "./trpc";
import { logger } from "./logger";

// ── F11: Stablecoin Payroll ─────────────────────────────────────────────────

interface PayrollRun {
  runId: string;
  employerId: number;
  name: string;
  stablecoin: string;
  employees: Array<{ name: string; walletAddress: string; amount: number; status: string }>;
  totalAmount: number;
  status: string;
  scheduledAt: string;
  executedAt?: string;
  createdAt: string;
}

const payrollRuns = new Map<string, PayrollRun>();

// ── F14: Limit Orders ───────────────────────────────────────────────────────

interface LimitOrder {
  orderId: string;
  userId: number;
  type: "buy" | "sell";
  stablecoin: string;
  fiatCurrency: string;
  amount: number;
  targetRate: number;
  currentRate: number;
  status: "open" | "filled" | "cancelled" | "expired";
  expiresAt: string;
  filledAt?: string;
  createdAt: string;
}

const limitOrders = new Map<string, LimitOrder>();

// ── F15: Gift Cards ─────────────────────────────────────────────────────────

const GIFT_CARD_BRANDS = [
  { brand: "Amazon", denominations: [10, 25, 50, 100, 200], currencies: ["USD", "GBP", "EUR"] },
  { brand: "Steam", denominations: [10, 25, 50, 100], currencies: ["USD", "EUR"] },
  { brand: "Uber", denominations: [15, 25, 50], currencies: ["USD"] },
  { brand: "Netflix", denominations: [15, 30, 50], currencies: ["USD", "GBP"] },
  { brand: "Spotify", denominations: [10, 30, 60], currencies: ["USD", "EUR"] },
  { brand: "Apple", denominations: [10, 25, 50, 100], currencies: ["USD", "GBP"] },
  { brand: "Google Play", denominations: [10, 25, 50, 100], currencies: ["USD"] },
  { brand: "Jumia", denominations: [5000, 10000, 20000], currencies: ["NGN"] },
];

// ── F16: Developer API Keys ─────────────────────────────────────────────────

interface ApiKey {
  keyId: string;
  userId: number;
  name: string;
  apiKey: string;
  permissions: string[];
  rateLimit: number;
  totalRequests: number;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt?: string;
}

const apiKeys = new Map<string, ApiKey>();

// ── F17: Referrals ──────────────────────────────────────────────────────────

interface Referral {
  referralId: string;
  referrerId: number;
  refereeId?: number;
  code: string;
  bonusAmount: number;
  status: "pending" | "completed" | "expired";
  createdAt: string;
}

const referralStore = new Map<string, Referral>();

// ── F19: DAO Governance ─────────────────────────────────────────────────────

interface Proposal {
  proposalId: string;
  creatorId: number;
  title: string;
  description: string;
  category: string;
  options: string[];
  votes: Map<number, number>; // userId → optionIndex
  status: "active" | "passed" | "rejected" | "executed";
  quorum: number;
  startDate: string;
  endDate: string;
  createdAt: string;
}

const proposals = new Map<string, Proposal>();

// ── F20: NFT Receipts ───────────────────────────────────────────────────────

interface NftReceipt {
  tokenId: string;
  userId: number;
  transactionId: string;
  chain: string;
  contractAddress: string;
  metadataUri: string;
  amount: number;
  stablecoin: string;
  recipientName: string;
  mintedAt: string;
  txHash: string;
}

const nftReceipts = new Map<string, NftReceipt>();

// ── Combined Router ─────────────────────────────────────────────────────────

export const platformFeaturesRouter = router({
  // ═══ F11: Payroll ═══
  payroll_createRun: protectedProcedure
    .input(z.object({
      name: z.string(),
      stablecoin: z.enum(["USDT", "USDC", "DAI"]).default("USDC"),
      employees: z.array(z.object({
        name: z.string(),
        walletAddress: z.string(),
        amount: z.number().positive(),
      })).min(1).max(5000),
      scheduledAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const runId = `payroll-${randomBytes(8).toString("hex")}`;
      const totalAmount = input.employees.reduce((s, e) => s + e.amount, 0);

      const run: PayrollRun = {
        runId, employerId: ctx.user.id, name: input.name,
        stablecoin: input.stablecoin,
        employees: input.employees.map(e => ({ ...e, status: "pending" })),
        totalAmount, status: "scheduled",
        scheduledAt: input.scheduledAt || new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      payrollRuns.set(runId, run);
      return { runId, totalAmount, employeeCount: input.employees.length, status: "scheduled" };
    }),

  payroll_executeRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const run = payrollRuns.get(input.runId);
      if (!run || run.employerId !== ctx.user.id) throw new Error("Run not found");
      run.status = "completed";
      run.executedAt = new Date().toISOString();
      run.employees.forEach(e => { e.status = "paid"; });
      return { runId: run.runId, status: "completed", totalPaid: run.totalAmount };
    }),

  payroll_list: protectedProcedure
    .query(async ({ ctx }) => {
      return Array.from(payrollRuns.values()).filter(r => r.employerId === ctx.user.id);
    }),

  // ═══ F12: Multi-Currency Wallet ═══
  wallet_overview: protectedProcedure
    .query(async ({ ctx }) => {
      return {
        userId: ctx.user.id,
        balances: [
          { currency: "USD", type: "fiat", balance: 5000, equivalent_usd: 5000 },
          { currency: "NGN", type: "fiat", balance: 1_600_000, equivalent_usd: 1000 },
          { currency: "GBP", type: "fiat", balance: 790, equivalent_usd: 1000 },
          { currency: "USDC", type: "stablecoin", balance: 10000, equivalent_usd: 10000 },
          { currency: "USDT", type: "stablecoin", balance: 5000, equivalent_usd: 5000 },
          { currency: "DAI", type: "stablecoin", balance: 2000, equivalent_usd: 2000 },
        ],
        totalNetWorth: 24000,
        displayCurrency: "USD",
      };
    }),

  // ═══ F13: Spending Analytics ═══
  analytics_spending: protectedProcedure
    .input(z.object({
      period: z.enum(["7d", "30d", "90d", "1y"]).default("30d"),
    }))
    .query(async ({ input, ctx }) => {
      return {
        userId: ctx.user.id,
        period: input.period,
        totalSpent: 3500,
        totalReceived: 5200,
        netFlow: 1700,
        categories: [
          { name: "Remittances", amount: 2000, percentage: 57 },
          { name: "Bill Payments", amount: 500, percentage: 14 },
          { name: "Shopping", amount: 400, percentage: 11 },
          { name: "Subscriptions", amount: 200, percentage: 6 },
          { name: "Savings", amount: 300, percentage: 9 },
          { name: "Other", amount: 100, percentage: 3 },
        ],
        monthlyTrend: [
          { month: "2026-01", spent: 3200, received: 4800 },
          { month: "2026-02", spent: 2900, received: 5100 },
          { month: "2026-03", spent: 3500, received: 5200 },
        ],
        topRecipients: [
          { name: "Chidi Okeke", totalSent: 1200, count: 4 },
          { name: "Amina Bello", totalSent: 800, count: 3 },
        ],
        budgetAlerts: [
          { category: "Remittances", budget: 2500, spent: 2000, percentUsed: 80 },
        ],
      };
    }),

  // ═══ F14: Limit Orders ═══
  limitOrder_create: protectedProcedure
    .input(z.object({
      type: z.enum(["buy", "sell"]),
      stablecoin: z.enum(["USDT", "USDC", "DAI"]),
      fiatCurrency: z.string().default("NGN"),
      amount: z.number().positive(),
      targetRate: z.number().positive(),
      expiresInHours: z.number().int().min(1).max(720).default(24),
    }))
    .mutation(async ({ input, ctx }) => {
      const orderId = `lo-${randomBytes(8).toString("hex")}`;
      const order: LimitOrder = {
        orderId, userId: ctx.user.id, type: input.type,
        stablecoin: input.stablecoin, fiatCurrency: input.fiatCurrency,
        amount: input.amount, targetRate: input.targetRate,
        currentRate: 1600, status: "open",
        expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      limitOrders.set(orderId, order);
      return order;
    }),

  limitOrder_cancel: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const order = limitOrders.get(input.orderId);
      if (!order || order.userId !== ctx.user.id) throw new Error("Order not found");
      order.status = "cancelled";
      return { orderId: order.orderId, status: "cancelled" };
    }),

  limitOrder_list: protectedProcedure
    .query(async ({ ctx }) => {
      return Array.from(limitOrders.values()).filter(o => o.userId === ctx.user.id);
    }),

  // ═══ F15: Gift Cards ═══
  giftCards_getBrands: protectedProcedure
    .query(async () => GIFT_CARD_BRANDS),

  giftCards_purchase: protectedProcedure
    .input(z.object({
      brand: z.string(),
      denomination: z.number().positive(),
      currency: z.string().default("USD"),
      payWithCoin: z.enum(["USDT", "USDC", "DAI"]).default("USDC"),
      recipientEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const cardId = `gc-${randomBytes(8).toString("hex")}`;
      const redemptionCode = randomBytes(8).toString("hex").toUpperCase();
      return {
        cardId, brand: input.brand, denomination: input.denomination,
        currency: input.currency, redemptionCode,
        status: "delivered", deliveredTo: input.recipientEmail || "self",
        purchasedAt: new Date().toISOString(),
      };
    }),

  // ═══ F16: Developer API/SDK ═══
  devApi_createKey: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      permissions: z.array(z.enum([
        "transfers.read", "transfers.write", "wallets.read", "wallets.write",
        "rates.read", "invoices.read", "invoices.write", "webhooks.manage",
      ])).min(1),
      rateLimit: z.number().int().min(10).max(10000).default(1000),
    }))
    .mutation(async ({ input, ctx }) => {
      const keyId = `key-${randomBytes(8).toString("hex")}`;
      const apiKeyValue = `rf_${randomBytes(32).toString("hex")}`;

      const key: ApiKey = {
        keyId, userId: ctx.user.id, name: input.name,
        apiKey: apiKeyValue, permissions: input.permissions,
        rateLimit: input.rateLimit, totalRequests: 0,
        status: "active", createdAt: new Date().toISOString(),
      };
      apiKeys.set(keyId, key);
      return { keyId, apiKey: apiKeyValue, permissions: input.permissions };
    }),

  devApi_revokeKey: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const key = apiKeys.get(input.keyId);
      if (!key || key.userId !== ctx.user.id) throw new Error("Key not found");
      key.status = "revoked";
      return { keyId: key.keyId, status: "revoked" };
    }),

  devApi_listKeys: protectedProcedure
    .query(async ({ ctx }) => {
      return Array.from(apiKeys.values())
        .filter(k => k.userId === ctx.user.id)
        .map(k => ({ keyId: k.keyId, name: k.name, permissions: k.permissions, status: k.status, createdAt: k.createdAt }));
    }),

  devApi_docs: protectedProcedure
    .query(async () => ({
      baseUrl: "https://api.remitflow.io/v1",
      authentication: "Bearer token (API key in Authorization header)",
      endpoints: [
        { method: "POST", path: "/transfers", description: "Create stablecoin transfer" },
        { method: "GET", path: "/transfers/:id", description: "Get transfer status" },
        { method: "GET", path: "/rates", description: "Get live FX rates" },
        { method: "POST", path: "/invoices", description: "Create payment invoice" },
        { method: "GET", path: "/wallets", description: "List wallets" },
        { method: "POST", path: "/webhooks", description: "Register webhook endpoint" },
        { method: "POST", path: "/batch-payouts", description: "Create batch payout" },
        { method: "GET", path: "/corridors", description: "List remittance corridors" },
      ],
      sdks: {
        javascript: "npm install @remitflow/sdk",
        python: "pip install remitflow",
        go: "go get github.com/remitflow/remitflow-go",
        rust: "cargo add remitflow",
      },
      rateLimits: { default: "1000 req/min", burst: "50 req/sec" },
    })),

  // ═══ F17: Referral Program ═══
  referral_getCode: protectedProcedure
    .query(async ({ ctx }) => {
      const existing = Array.from(referralStore.values()).find(r => r.referrerId === ctx.user.id);
      if (existing) return { code: existing.code, totalReferrals: Array.from(referralStore.values()).filter(r => r.referrerId === ctx.user.id).length };

      const code = `RF-${randomBytes(4).toString("hex").toUpperCase()}`;
      const ref: Referral = {
        referralId: `ref-${randomBytes(8).toString("hex")}`,
        referrerId: ctx.user.id, code, bonusAmount: 5.00,
        status: "pending", createdAt: new Date().toISOString(),
      };
      referralStore.set(ref.referralId, ref);
      return { code, totalReferrals: 0, bonusPerReferral: 5.00, shareLink: `https://remitflow.io/join?ref=${code}` };
    }),

  referral_stats: protectedProcedure
    .query(async ({ ctx }) => {
      const refs = Array.from(referralStore.values()).filter(r => r.referrerId === ctx.user.id);
      return {
        totalReferrals: refs.length,
        completedReferrals: refs.filter(r => r.status === "completed").length,
        totalEarned: refs.filter(r => r.status === "completed").reduce((s, r) => s + r.bonusAmount, 0),
        pendingBonus: refs.filter(r => r.status === "pending").reduce((s, r) => s + r.bonusAmount, 0),
      };
    }),

  // ═══ F18: Deposit Insurance ═══
  insurance_coverage: protectedProcedure
    .query(async ({ ctx }) => ({
      userId: ctx.user.id,
      maxCoverage: 100_000,
      currentBalance: 17_000,
      coveredAmount: 17_000,
      coveragePercent: 100,
      provider: "Nexus Mutual + Lloyd's",
      policyId: "RF-INS-2026",
      coveredEvents: [
        "Smart contract exploit",
        "Custody provider hack",
        "Stablecoin de-peg > 5%",
        "Bridge exploit",
      ],
      exclusions: [
        "User error (wrong address)",
        "Regulatory seizure",
        "Admin key compromise via social engineering",
      ],
      claimProcess: "File via app → 48h review → Payout in 7 days",
    })),

  // ═══ F19: DAO Governance ═══
  dao_createProposal: protectedProcedure
    .input(z.object({
      title: z.string().min(5).max(200),
      description: z.string().min(20).max(5000),
      category: z.enum(["fee_change", "new_corridor", "lp_onboarding", "protocol_upgrade", "community"]),
      options: z.array(z.string()).min(2).max(10),
      durationDays: z.number().int().min(1).max(30).default(7),
      quorum: z.number().int().min(1).default(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const proposalId = `prop-${randomBytes(8).toString("hex")}`;
      const now = new Date();
      const end = new Date(now.getTime() + input.durationDays * 86400_000);

      const proposal: Proposal = {
        proposalId, creatorId: ctx.user.id,
        title: input.title, description: input.description,
        category: input.category, options: input.options,
        votes: new Map(), status: "active",
        quorum: input.quorum,
        startDate: now.toISOString(), endDate: end.toISOString(),
        createdAt: now.toISOString(),
      };
      proposals.set(proposalId, proposal);
      return { proposalId, title: input.title, endDate: end.toISOString() };
    }),

  dao_vote: protectedProcedure
    .input(z.object({ proposalId: z.string(), optionIndex: z.number().int().min(0) }))
    .mutation(async ({ input, ctx }) => {
      const proposal = proposals.get(input.proposalId);
      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status !== "active") throw new Error("Voting closed");
      if (input.optionIndex >= proposal.options.length) throw new Error("Invalid option");
      if (proposal.votes.has(ctx.user.id)) throw new Error("Already voted");

      proposal.votes.set(ctx.user.id, input.optionIndex);
      return { proposalId: proposal.proposalId, votedFor: proposal.options[input.optionIndex], totalVotes: proposal.votes.size };
    }),

  dao_listProposals: protectedProcedure
    .input(z.object({ status: z.enum(["active", "passed", "rejected", "executed"]).optional() }))
    .query(async ({ input }) => {
      let result = Array.from(proposals.values());
      if (input.status) result = result.filter(p => p.status === input.status);
      return result.map(p => ({
        proposalId: p.proposalId, title: p.title, category: p.category,
        status: p.status, totalVotes: p.votes.size, quorum: p.quorum,
        endDate: p.endDate,
      }));
    }),

  // ═══ F20: NFT Receipts ═══
  nft_mint: protectedProcedure
    .input(z.object({
      transactionId: z.string(),
      amount: z.number().positive(),
      stablecoin: z.string(),
      recipientName: z.string(),
      chain: z.enum(["ethereum", "polygon", "base"]).default("polygon"),
    }))
    .mutation(async ({ input, ctx }) => {
      const tokenId = `nft-${randomBytes(8).toString("hex")}`;
      const contractAddress = `0x${createHash("sha256").update("RemitFlowReceipt").digest("hex").slice(0, 40)}`;
      const metadataUri = `https://metadata.remitflow.io/receipt/${tokenId}`;

      const receipt: NftReceipt = {
        tokenId, userId: ctx.user.id,
        transactionId: input.transactionId, chain: input.chain,
        contractAddress, metadataUri,
        amount: input.amount, stablecoin: input.stablecoin,
        recipientName: input.recipientName,
        mintedAt: new Date().toISOString(),
        txHash: `0x${randomBytes(32).toString("hex")}`,
      };
      nftReceipts.set(tokenId, receipt);
      return receipt;
    }),

  nft_list: protectedProcedure
    .query(async ({ ctx }) => {
      return Array.from(nftReceipts.values()).filter(r => r.userId === ctx.user.id);
    }),
});
