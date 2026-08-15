/**
 * Production Scenarios — Top 10 Stakeholder Workflows
 *
 * Validates that the RemitFlow platform can handle real-world production
 * workflows end-to-end across all 20 stablecoin features, polyglot services,
 * and middleware integrations.
 *
 * Scenarios:
 *  S1  Diaspora Worker — Send remittance home (US→NG corridor)
 *  S2  Merchant — Accept stablecoin payment at checkout
 *  S3  Employer — Run stablecoin payroll for remote team
 *  S4  DeFi User — Swap stablecoins + lend for yield
 *  S5  Compliance Officer — Screen transactions + audit
 *  S6  LP Admin — Monitor reserves + rebalance pools
 *  S7  Developer — Integrate RemitFlow API
 *  S8  Savings User — Lock funds in vault + earn yield
 *  S9  DAO Member — Propose fee change + vote
 *  S10 Agent/BDC — Cash-in/cash-out operations
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Stakeholder Context Factories ────────────────────────────────────────────

function createUserCtx(overrides: {
  id?: number;
  name?: string;
  role?: "user" | "admin";
  kycTier?: "tier0" | "tier1" | "tier2" | "tier3";
} = {}): TrpcContext {
  const id = overrides.id ?? 1;
  return {
    user: {
      id,
      openId: `test-user-${id}`,
      email: `user${id}@remitflow.test`,
      name: overrides.name ?? `Test User ${id}`,
      loginMethod: "keycloak",
      role: overrides.role ?? "user",
      kycTier: overrides.kycTier ?? "tier3",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const diasporaWorker = () => appRouter.createCaller(createUserCtx({ id: 9001, name: "Amara Diallo", kycTier: "tier3" }));
const merchantUser = () => appRouter.createCaller(createUserCtx({ id: 9002, name: "Lagos Mart Ltd", role: "admin" }));
const employerUser = () => appRouter.createCaller(createUserCtx({ id: 9003, name: "TechCo Africa", role: "admin" }));
const defiUser = () => appRouter.createCaller(createUserCtx({ id: 9004, name: "DeFi Dave" }));
const complianceOfficer = () => appRouter.createCaller(createUserCtx({ id: 9005, name: "Sarah MLRO", role: "admin" }));
const lpAdmin = () => appRouter.createCaller(createUserCtx({ id: 9006, name: "LP Admin", role: "admin" }));
const developerUser = () => appRouter.createCaller(createUserCtx({ id: 9007, name: "Dev Builder" }));
const savingsUser = () => appRouter.createCaller(createUserCtx({ id: 9008, name: "Patience Saver" }));
const daoMember = () => appRouter.createCaller(createUserCtx({ id: 9009, name: "Governance Gov" }));
const agentUser = () => appRouter.createCaller(createUserCtx({ id: 9010, name: "Agent Musa", role: "admin" }));

// ═══════════════════════════════════════════════════════════════════════════════
// S1: DIASPORA WORKER — Send Remittance Home (US → Nigeria)
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Nigerian diaspora in USA sending money home to family
// Workflow: Check corridors → Get FX quote → Send via optimized corridor → Track
// ═══════════════════════════════════════════════════════════════════════════════

describe("S1: Diaspora Worker — Send Remittance Home", () => {
  const caller = diasporaWorker();

  it("Step 1: List available corridors (should include US→NG)", async () => {
    const result = await caller.remittanceCorridors.list({});
    expect(result).toBeDefined();
    expect(result.corridors).toBeDefined();
    expect(Array.isArray(result.corridors)).toBe(true);
    expect(result.corridors.length).toBeGreaterThan(0);

    const usNg = result.corridors.find(
      (c: { source: { country: string }; destination: { country: string } }) =>
        c.source.country === "US" && c.destination.country === "NG"
    );
    expect(usNg).toBeDefined();
    expect(usNg!.source.currency).toBe("USD");
    expect(usNg!.destination.currency).toBe("NGN");
  });

  it("Step 2: Get corridor quote for $500 USD → NGN", async () => {
    const quote = await caller.remittanceCorridors.getQuote({
      corridorId: "US-NG",
      amount: 500,
    });
    expect(quote).toBeDefined();
    expect(quote.sendAmount).toBe(500);
    expect(quote.receiveAmount).toBeGreaterThan(0);
    expect(quote.fxRate).toBeGreaterThan(0);
    expect(quote.fee).toBeGreaterThanOrEqual(0);
    expect(quote.estimatedDelivery).toBeDefined();
  });

  it("Step 3: Send remittance via corridor", async () => {
    const result = await caller.remittanceCorridors.send({
      corridorId: "US-NG",
      amount: 500,
      recipientName: "Mama Diallo",
      recipientAccount: "0123456789",
      recipientBank: "First Bank",
      purpose: "family_support",
    });
    expect(result).toBeDefined();
    expect(result.transferId).toBeDefined();
    expect(result.status).toMatch(/pending|processing|completed/);
    expect(result.amount).toBe(500);
    expect(result.destAmount).toBeGreaterThan(0);
  });

  it("Step 4: Check transfer history", async () => {
    const result = await caller.remittanceCorridors.history({ limit: 20 });
    expect(result).toBeDefined();
    expect(result.transfers).toBeDefined();
    expect(Array.isArray(result.transfers)).toBe(true);
    expect(result.transfers.length).toBeGreaterThan(0);
  });

  it("Step 5: Schedule recurring remittance (weekly)", async () => {
    const payment = await caller.programmablePayments.create({
      name: "Weekly Family Support",
      scheduleType: "recurring",
      stablecoin: "USDC",
      amount: 100,
      recipientId: 1282,
      chain: "polygon",
      cronExpression: "0 9 * * 1",
      maxExecutions: 52,
    });
    expect(payment).toBeDefined();
    expect(payment.id).toBeDefined();
    expect(payment.status).toMatch(/scheduled|pending/);
    expect(payment.scheduleType).toBe("recurring");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S2: MERCHANT — Accept Stablecoin Payment at Checkout
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: E-commerce business accepting USDC payments
// Workflow: Register → Create intent → Customer pays → Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

describe("S2: Merchant — Accept Stablecoin Payment", () => {
  const caller = merchantUser();
  let merchantId: string;
  let intentId: string;

  it("Step 1: Register as merchant", async () => {
    const result = await caller.merchantGateway.register({
      businessName: "Lagos Mart Ltd",
      acceptedCoins: ["USDC", "USDT"],
      settlementCoin: "USDC",
      settlementCurrency: "USD",
    });
    expect(result).toBeDefined();
    expect(result.merchantId).toBeDefined();
    expect(result.apiKey).toBeDefined();
    merchantId = result.merchantId;
  });

  it("Step 2: Create payment intent ($49.99)", async () => {
    const intent = await caller.merchantGateway.createPaymentIntent({
      merchantId,
      amount: 49.99,
      currency: "USD",
      stablecoin: "USDC",
      description: "Premium Subscription",
      metadata: { orderId: "ORD-12345", customerId: "CUST-789" },
    });
    expect(intent).toBeDefined();
    expect(intent.intentId).toBeDefined();
    expect(intent.status).toBe("pending");
    expect(intent.amount).toBe(49.99);
    expect(intent.depositAddress).toBeDefined();
    intentId = intent.intentId;
  });

  it("Step 3: Simulate customer payment", async () => {
    const payment = await caller.merchantGateway.simulatePayment({
      intentId,
      coin: "USDC",
      amount: 49.99,
    });
    expect(payment).toBeDefined();
    expect(payment.status).toBe("completed");
    expect(payment.txHash).toBeDefined();
  });

  it("Step 4: View merchant dashboard", async () => {
    const dashboard = await caller.merchantGateway.dashboard({
      merchantId,
    });
    expect(dashboard).toBeDefined();
    expect(dashboard.merchant).toBeDefined();
    expect(dashboard.merchant.merchantId).toBe(merchantId);
  });

  it("Step 5: Process refund", async () => {
    const refund = await caller.merchantGateway.refund({
      intentId,
      reason: "Customer requested",
    });
    expect(refund).toBeDefined();
    expect(refund.status).toBe("refunded");
    expect(refund.refundAmount).toBeGreaterThan(0);
  });

  it("Step 6: Create invoice for B2B payment", async () => {
    const invoice = await caller.invoicesAndSubscriptions.createInvoice({
      recipientName: "Buyer Corp",
      recipientEmail: "buyer@company.com",
      amount: 5000,
      stablecoin: "USDC",
      description: "Wholesale order Q4",
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      items: [
        { description: "Widget A (100 units)", quantity: 100, unitPrice: 30 },
        { description: "Widget B (50 units)", quantity: 50, unitPrice: 40 },
      ],
    });
    expect(invoice).toBeDefined();
    expect(invoice.invoiceId).toBeDefined();
    expect(invoice.status).toBe("sent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S3: EMPLOYER — Run Stablecoin Payroll for Remote Team
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Tech company paying 50+ remote workers in USDC
// Workflow: Create payroll run → Add employees → Execute batch → Verify
// ═══════════════════════════════════════════════════════════════════════════════

describe("S3: Employer — Stablecoin Payroll", () => {
  const caller = employerUser();
  let runId: string;
  let batchId: string;

  it("Step 1: Create payroll run", async () => {
    const run = await caller.platformFeatures.payroll_createRun({
      name: "June 2026 Payroll",
      stablecoin: "USDC",
      employees: [
        { name: "Alice Ng", walletAddress: "0xAlice", amount: 3500 },
        { name: "Bob Accra", walletAddress: "0xBob", amount: 2800 },
        { name: "Charlie Nairobi", walletAddress: "0xCharlie", amount: 4200 },
        { name: "Diana Lagos", walletAddress: "0xDiana", amount: 3000 },
        { name: "Emeka Abuja", walletAddress: "0xEmeka", amount: 2500 },
      ],
    });
    expect(run).toBeDefined();
    expect(run.runId).toBeDefined();
    expect(run.totalAmount).toBe(16000);
    expect(run.status).toBe("draft");
    runId = run.runId;
  });

  it("Step 2: Create batch payout from payroll", async () => {
    const batch = await caller.batchPayouts.create({
      name: "June 2026 Salary Disbursement",
      stablecoin: "USDC",
      chain: "polygon",
      recipients: [
        { name: "Alice Ng", address: "0xAlice", amount: 3500 },
        { name: "Bob Accra", address: "0xBob", amount: 2800 },
        { name: "Charlie Nairobi", address: "0xCharlie", amount: 4200 },
        { name: "Diana Lagos", address: "0xDiana", amount: 3000 },
        { name: "Emeka Abuja", address: "0xEmeka", amount: 2500 },
      ],
      dryRun: true,
    });
    expect(batch).toBeDefined();
    expect(batch.batchId).toBeDefined();
    expect(batch.totalAmount).toBeGreaterThan(0);
    expect(batch.recipientCount).toBe(5);
    batchId = batch.batchId;
  });

  it("Step 3: Execute batch payout — rejected, no executor wired, state unchanged", async () => {
    // batchPayouts.execute must refuse loudly: no on-chain payout executor is
    // wired, and fabricating txHashes/success for real money movement is a
    // critical defect (audit S6). Assert rejection AND unchanged batch state.
    await expect(
      caller.batchPayouts.execute({ batchId }),
    ).rejects.toThrow(/no on-chain payout executor/i);
    await expect(
      caller.batchPayouts.retryFailed({ batchId }),
    ).rejects.toThrow(/no on-chain payout executor/i);

    const batch = await caller.batchPayouts.get({ batchId });
    expect(batch).toBeDefined();
    // State must be exactly as created: still a draft dry-run batch, no
    // fabricated txHashes, no fabricated recipient completions.
    expect(batch.status).toBe("draft");
    expect(batch.dryRun).toBe(true);
    expect(batch.executedAt).toBeUndefined();
    expect(batch.completedAt).toBeUndefined();
    for (const recipient of batch.recipients) {
      expect(recipient.txHash).toBeUndefined();
      expect(recipient.status).not.toBe("completed");
    }
  });

  it("Step 4: Execute payroll run", async () => {
    const execution = await caller.platformFeatures.payroll_executeRun({
      runId,
    });
    expect(execution).toBeDefined();
    expect(execution.status).toMatch(/executing|completed/);
  });

  it("Step 5: List payroll history", async () => {
    const history = await caller.platformFeatures.payroll_list();
    expect(history).toBeDefined();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S4: DEFI USER — Swap Stablecoins + Lend for Yield
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Crypto-native user optimizing stablecoin portfolio
// Workflow: Check pairs → Get swap quote → Execute swap → Supply to lending
// ═══════════════════════════════════════════════════════════════════════════════

describe("S4: DeFi User — Swap + Lend", () => {
  const caller = defiUser();
  let quoteId: string;

  it("Step 1: Get supported swap pairs", async () => {
    const result = await caller.crossCurrencySwap.getSupportedPairs();
    expect(result).toBeDefined();
    expect(Array.isArray(result.pairs)).toBe(true);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.totalPairs).toBeGreaterThan(0);
  });

  it("Step 2: Get swap quote (USDT → USDC)", async () => {
    const quote = await caller.crossCurrencySwap.getQuote({
      fromCoin: "USDT",
      toCoin: "USDC",
      amount: 10000,
      fromChain: "polygon",
      toChain: "polygon",
    });
    expect(quote).toBeDefined();
    expect(quote.inputAmount).toBe(10000);
    expect(quote.outputAmount).toBeGreaterThan(0);
    expect(quote.quoteId).toBeDefined();
    quoteId = quote.quoteId;
  });

  it("Step 3: Execute swap using quote", async () => {
    const swap = await caller.crossCurrencySwap.executeSwap({
      quoteId,
    });
    expect(swap).toBeDefined();
    expect(swap.swapId).toBeDefined();
    expect(swap.status).toMatch(/completed|pending/);
  });

  it("Step 4: Check lending markets", async () => {
    const markets = await caller.lendingBorrowing.getMarkets();
    expect(markets).toBeDefined();
    expect(Array.isArray(markets)).toBe(true);
    expect(markets.length).toBeGreaterThanOrEqual(5);

    const usdcMarket = markets.find((m: { stablecoin: string; coin: string }) => m.stablecoin === "USDC" || m.coin === "USDC");
    expect(usdcMarket).toBeDefined();
    expect(usdcMarket!.supplyApy).toBeGreaterThan(0);
    expect(usdcMarket!.borrowApy).toBeGreaterThan(0);
  });

  it("Step 5: Supply USDC to lending pool", async () => {
    const supply = await caller.lendingBorrowing.supply({
      stablecoin: "USDC",
      amount: 5000,
    });
    expect(supply).toBeDefined();
    expect(supply.positionId).toBeDefined();
    expect(supply.type).toBe("supply");
    expect(supply.amount).toBe(5000);
  });

  it("Step 6: Borrow DAI against USDC collateral", async () => {
    const borrow = await caller.lendingBorrowing.borrow({
      borrowCoin: "DAI",
      borrowAmount: 2000,
      collateralCoin: "USDC",
      collateralAmount: 3500,
    });
    expect(borrow).toBeDefined();
    expect(borrow.positionId).toBeDefined();
    expect(borrow.type).toBe("borrow");
    expect(borrow.healthFactor).toBeGreaterThan(1);
  });

  it("Step 7: Check all positions", async () => {
    const result = await caller.lendingBorrowing.getPositions();
    expect(result).toBeDefined();
    expect(result.positions).toBeDefined();
    expect(Array.isArray(result.positions)).toBe(true);
    expect(result.positions.length).toBeGreaterThanOrEqual(2);
  });

  it("Step 8: Repay partial borrow", async () => {
    const result = await caller.lendingBorrowing.getPositions();
    const borrowPos = result.positions.find((p: { type: string }) => p.type === "borrow");
    expect(borrowPos).toBeDefined();

    const repay = await caller.lendingBorrowing.repay({
      positionId: borrowPos!.positionId,
      amount: 1000,
    });
    expect(repay).toBeDefined();
    expect(repay.remaining).toBeLessThan(2000);
  });

  it("Step 9: Create ERC-4337 smart wallet for gasless ops", async () => {
    const wallet = await caller.accountAbstraction.createWallet({
      chain: "polygon",
    });
    expect(wallet).toBeDefined();
    expect(wallet.address).toMatch(/^0x/);
    expect(wallet.chain).toBe("polygon");
  });

  it("Step 10: Send gasless transaction", async () => {
    const wallets = await caller.accountAbstraction.listWallets();
    expect(wallets.length).toBeGreaterThan(0);

    const tx = await caller.accountAbstraction.sendGasless({
      walletId: wallets[0].walletId,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      token: "USDC",
      amount: 100,
    });
    expect(tx).toBeDefined();
    expect(tx.userOpId).toBeDefined();
    expect(tx.status).toMatch(/submitted|completed|confirmed/);
    expect(tx.gasSponsored).toBe(true);
  });

  it("Step 11: Check swap history", async () => {
    const result = await caller.crossCurrencySwap.history({});
    expect(result).toBeDefined();
    expect(result.swaps).toBeDefined();
    expect(Array.isArray(result.swaps)).toBe(true);
    expect(result.swaps.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S5: COMPLIANCE OFFICER — Screen Transactions + Audit
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: MLRO reviewing transactions for AML/sanctions compliance
// Workflow: Spending analytics → Insurance coverage → Corridor compliance → Approvals
// ═══════════════════════════════════════════════════════════════════════════════

describe("S5: Compliance Officer — Transaction Screening", () => {
  const caller = complianceOfficer();

  it("Step 1: Get spending analytics (detect anomalies)", async () => {
    const analytics = await caller.platformFeatures.analytics_spending({
      period: "30d",
    });
    expect(analytics).toBeDefined();
    expect(analytics.categories).toBeDefined();
    expect(analytics.totalSpent).toBeGreaterThanOrEqual(0);
  });

  it("Step 2: Check insurance coverage status", async () => {
    const coverage = await caller.platformFeatures.insurance_coverage();
    expect(coverage).toBeDefined();
    expect(Array.isArray(coverage.policies)).toBe(true);
    expect(coverage.totalCoverage).toBeGreaterThan(0);
  });

  it("Step 3: Review corridor compliance levels", async () => {
    const result = await caller.remittanceCorridors.list({});
    expect(result.corridors.length).toBeGreaterThan(0);

    for (const corridor of result.corridors) {
      expect(corridor.complianceLevel).toBeDefined();
      expect(["basic", "enhanced", "full"]).toContain(corridor.complianceLevel);
    }
  });

  it("Step 4: Create high-value payment with dual approval", async () => {
    const payment = await caller.programmablePayments.create({
      name: "High-value transfer requiring dual approval",
      scheduleType: "one_time",
      stablecoin: "USDC",
      amount: 50000,
      recipientAddress: "0xHighValueRecipient",
      chain: "ethereum",
      requireApprovals: 2,
      approvers: [9005, 9006],
    });
    expect(payment).toBeDefined();
    expect(payment.status).toBe("pending");
    expect(payment.requireApprovals).toBe(2);
  });

  it("Step 5: Approve the payment (first approval)", async () => {
    const result = await caller.programmablePayments.list({});
    const highValue = result.payments.find(
      (p: { amount: number }) => p.amount === 50000
    );
    expect(highValue).toBeDefined();

    const approval = await caller.programmablePayments.approve({
      id: highValue!.id,
    });
    expect(approval).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S6: LP ADMIN — Monitor Reserves + Rebalance
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Liquidity pool administrator managing platform reserves
// Workflow: Wallet overview → Corridor analytics → Referral stats → Lending rates
// ═══════════════════════════════════════════════════════════════════════════════

describe("S6: LP Admin — Reserve Management", () => {
  const caller = lpAdmin();

  it("Step 1: Get multi-currency wallet overview", async () => {
    const overview = await caller.platformFeatures.wallet_overview();
    expect(overview).toBeDefined();
    expect(overview.balances).toBeDefined();
    expect(Array.isArray(overview.balances)).toBe(true);
    expect(overview.totalValueUsd).toBeGreaterThanOrEqual(0);
  });

  it("Step 2: Check corridor analytics for rebalancing", async () => {
    const result = await caller.remittanceCorridors.list({});
    expect(result.corridors.length).toBeGreaterThan(0);

    const usNg = result.corridors.find(
      (c: { id: string }) => c.id === "US-NG"
    );
    expect(usNg).toBeDefined();
    expect(usNg!.feePercent).toBeGreaterThan(0);
  });

  it("Step 3: Review referral program performance", async () => {
    const stats = await caller.platformFeatures.referral_stats();
    expect(stats).toBeDefined();
    expect(stats.totalReferrals).toBeGreaterThanOrEqual(0);
    expect(stats.totalEarned).toBeGreaterThanOrEqual(0);
  });

  it("Step 4: Get referral code for LP partner onboarding", async () => {
    const code = await caller.platformFeatures.referral_getCode();
    expect(code).toBeDefined();
    expect(code.code).toBeDefined();
  });

  it("Step 5: Check lending market rates for yield optimization", async () => {
    const markets = await caller.lendingBorrowing.getMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(5);

    for (const market of markets) {
      expect(market.supplyApy).toBeGreaterThan(0);
      expect(market.borrowApy).toBeGreaterThan(0);
      expect(market.totalSupply).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S7: DEVELOPER — Integrate RemitFlow API
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Third-party developer building on RemitFlow rails
// Workflow: Create API key → Read docs → Make test calls → Revoke key
// ═══════════════════════════════════════════════════════════════════════════════

describe("S7: Developer — API Integration", () => {
  const caller = developerUser();
  let apiKeyId: string;

  it("Step 1: Create API key", async () => {
    const key = await caller.platformFeatures.devApi_createKey({
      name: "Production Integration Key",
      permissions: ["transfers.read", "transfers.write", "wallets.read"],
    });
    expect(key).toBeDefined();
    expect(key.keyId).toBeDefined();
    expect(key.apiKey).toBeDefined();
    expect(key.permissions).toContain("transfers.read");
    apiKeyId = key.keyId;
  });

  it("Step 2: Get API documentation", async () => {
    const docs = await caller.platformFeatures.devApi_docs();
    expect(docs).toBeDefined();
    expect(docs.version).toBeDefined();
    expect(docs.endpoints).toBeDefined();
    expect(Array.isArray(docs.endpoints)).toBe(true);
    expect(docs.endpoints.length).toBeGreaterThan(0);
  });

  it("Step 3: List API keys", async () => {
    const keys = await caller.platformFeatures.devApi_listKeys();
    expect(keys).toBeDefined();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.find((k: { keyId: string }) => k.keyId === apiKeyId)).toBeDefined();
  });

  it("Step 4: Test corridor quote (simulating API call)", async () => {
    const quote = await caller.remittanceCorridors.getQuote({
      corridorId: "UK-GH",
      amount: 200,
    });
    expect(quote).toBeDefined();
    expect(quote.receiveAmount).toBeGreaterThan(0);
  });

  it("Step 5: Test swap quote (simulating API call)", async () => {
    const quote = await caller.crossCurrencySwap.getQuote({
      fromCoin: "USDC",
      toCoin: "DAI",
      amount: 1000,
      fromChain: "ethereum",
      toChain: "ethereum",
    });
    expect(quote).toBeDefined();
    expect(quote.outputAmount).toBeGreaterThan(0);
  });

  it("Step 6: Revoke API key", async () => {
    const result = await caller.platformFeatures.devApi_revokeKey({
      keyId: apiKeyId,
    });
    expect(result).toBeDefined();
    expect(result.status).toBe("revoked");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S8: SAVINGS USER — Lock Funds + Earn Yield
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Risk-averse user wanting guaranteed stablecoin yield
// Workflow: View tiers → Deposit to 90-day vault → Check earnings → Withdraw
// ═══════════════════════════════════════════════════════════════════════════════

describe("S8: Savings User — Vault Deposits", () => {
  const caller = savingsUser();
  let depositId: string;

  it("Step 1: Get vault tiers", async () => {
    const tiers = await caller.savingsVault.getTiers();
    expect(tiers).toBeDefined();
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBeGreaterThanOrEqual(5);

    const tier90 = tiers.find((t: { termDays: number }) => t.termDays === 90);
    expect(tier90).toBeDefined();
    expect(tier90!.apy).toBe(7.0);
  });

  it("Step 2: Deposit $2,000 USDC into 90-day vault", async () => {
    const deposit = await caller.savingsVault.deposit({
      termDays: 90,
      amount: 2000,
      stablecoin: "USDC",
    });
    expect(deposit).toBeDefined();
    expect(deposit.depositId).toBeDefined();
    expect(deposit.principal).toBe(2000);
    expect(deposit.apy).toBe(7.0);
    expect(deposit.maturityDate).toBeDefined();
    depositId = deposit.depositId;
  });

  it("Step 3: Deposit $5,000 into 365-day vault (max APY)", async () => {
    const deposit = await caller.savingsVault.deposit({
      termDays: 365,
      amount: 5000,
      stablecoin: "USDC",
    });
    expect(deposit).toBeDefined();
    expect(deposit.apy).toBe(10.0);
    expect(deposit.principal).toBe(5000);
  });

  it("Step 4: View all deposits with summary", async () => {
    const result = await caller.savingsVault.getDeposits();
    expect(result).toBeDefined();
    expect(result.deposits).toBeDefined();
    expect(result.deposits.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toBeDefined();
    expect(result.summary.totalDeposited).toBeGreaterThanOrEqual(7000);
  });

  it("Step 5: Early withdrawal (with penalty)", async () => {
    const withdrawal = await caller.savingsVault.withdraw({
      depositId,
    });
    expect(withdrawal).toBeDefined();
    expect(withdrawal.principal).toBe(2000);
    expect(withdrawal.penalty).toBeGreaterThan(0);
    expect(withdrawal.netAmount).toBeLessThan(2000);
  });

  it("Step 6: Buy gift card with remaining yield", async () => {
    const brands = await caller.platformFeatures.giftCards_getBrands();
    expect(brands).toBeDefined();
    expect(Array.isArray(brands)).toBe(true);
    expect(brands.length).toBeGreaterThan(0);

    const purchase = await caller.platformFeatures.giftCards_purchase({
      brand: brands[0].brand,
      denomination: 50,
      currency: "USD",
      payWithCoin: "USDC",
    });
    expect(purchase).toBeDefined();
    expect(purchase.cardId).toBeDefined();
    expect(purchase.redemptionCode).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S9: DAO MEMBER — Propose Fee Change + Vote
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Governance token holder participating in platform decisions
// Workflow: Create proposal → Vote → Check results
// ═══════════════════════════════════════════════════════════════════════════════

describe("S9: DAO Member — Governance", () => {
  const caller = daoMember();
  let proposalId: string;

  it("Step 1: Create proposal to reduce corridor fees", async () => {
    const proposal = await caller.platformFeatures.dao_createProposal({
      title: "Reduce US-NG corridor fee from 0.5% to 0.3%",
      description:
        "To increase competitiveness and volume on our highest-traffic corridor, " +
        "I propose reducing the US→NG fee from 0.5% to 0.3%. Analysis shows a 0.2% " +
        "fee reduction would increase volume by ~40%, resulting in net revenue increase.",
      category: "fee_change",
      options: ["Yes - reduce to 0.3%", "No - keep at 0.5%"],
      durationDays: 7,
      quorum: 3,
    });
    expect(proposal).toBeDefined();
    expect(proposal.proposalId).toBeDefined();
    expect(proposal.status).toBe("active");
    proposalId = proposal.proposalId;
  });

  it("Step 2: Cast vote (option 0 = Yes)", async () => {
    const vote = await caller.platformFeatures.dao_vote({
      proposalId,
      optionIndex: 0,
    });
    expect(vote).toBeDefined();
    expect(vote.totalVotes).toBeGreaterThanOrEqual(1);
  });

  it("Step 3: Another member votes (option 1 = No)", async () => {
    const otherMember = appRouter.createCaller(
      createUserCtx({ id: 9099, name: "Counter Voter" })
    );
    const vote = await otherMember.platformFeatures.dao_vote({
      proposalId,
      optionIndex: 1,
    });
    expect(vote).toBeDefined();
    expect(vote.totalVotes).toBeGreaterThanOrEqual(2);
  });

  it("Step 4: List proposals and check vote tally", async () => {
    const proposals = await caller.platformFeatures.dao_listProposals({});
    expect(proposals).toBeDefined();
    expect(Array.isArray(proposals)).toBe(true);

    const ourProposal = proposals.find(
      (p: { proposalId: string }) => p.proposalId === proposalId
    );
    expect(ourProposal).toBeDefined();
    expect(ourProposal!.totalVotes).toBeGreaterThanOrEqual(2);
  });

  it("Step 5: Mint NFT receipt for governance participation", async () => {
    const nft = await caller.platformFeatures.nft_mint({
      transactionId: proposalId,
      amount: 1,
      stablecoin: "USDC",
      recipientName: "Governance Vote Receipt",
      chain: "polygon",
    });
    expect(nft).toBeDefined();
    expect(nft.tokenId).toBeDefined();
    expect(nft.metadataUri).toBeDefined();
  });

  it("Step 6: List NFT receipts", async () => {
    const nfts = await caller.platformFeatures.nft_list();
    expect(nfts).toBeDefined();
    expect(Array.isArray(nfts)).toBe(true);
    expect(nfts.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S10: AGENT/BDC — Cash-In/Cash-Out Operations
// ═══════════════════════════════════════════════════════════════════════════════
// Stakeholder: Licensed agent (Bureau de Change) facilitating cash operations
// Workflow: Check wallet → Limit orders → Subscriptions → Analytics → Corridors
// ═══════════════════════════════════════════════════════════════════════════════

describe("S10: Agent/BDC — Cash Operations", () => {
  const caller = agentUser();
  let orderId: string;

  it("Step 1: Check wallet overview (multi-currency float)", async () => {
    const overview = await caller.platformFeatures.wallet_overview();
    expect(overview).toBeDefined();
    expect(overview.balances).toBeDefined();
    expect(overview.totalValueUsd).toBeGreaterThanOrEqual(0);
  });

  it("Step 2: Create limit order (buy NGN when rate hits 1550)", async () => {
    const order = await caller.platformFeatures.limitOrder_create({
      type: "buy",
      stablecoin: "USDC",
      fiatCurrency: "NGN",
      amount: 10000,
      targetRate: 1550,
    });
    expect(order).toBeDefined();
    expect(order.orderId).toBeDefined();
    expect(order.status).toBe("open");
    expect(order.targetRate).toBe(1550);
    orderId = order.orderId;
  });

  it("Step 3: List open limit orders", async () => {
    const orders = await caller.platformFeatures.limitOrder_list();
    expect(orders).toBeDefined();
    expect(Array.isArray(orders)).toBe(true);
    expect(orders.length).toBeGreaterThan(0);
  });

  it("Step 4: Cancel limit order", async () => {
    const cancel = await caller.platformFeatures.limitOrder_cancel({
      orderId,
    });
    expect(cancel).toBeDefined();
    expect(cancel.status).toBe("cancelled");
  });

  it("Step 5: Create recurring subscription for reports", async () => {
    const sub = await caller.invoicesAndSubscriptions.createSubscription({
      planName: "Daily Float Report",
      amount: 5,
      stablecoin: "USDC",
      interval: "daily",
      subscriberUserId: 9010,
    });
    expect(sub).toBeDefined();
    expect(sub.subscriptionId).toBeDefined();
    expect(sub.status).toBe("active");
  });

  it("Step 6: View spending analytics", async () => {
    const analytics = await caller.platformFeatures.analytics_spending({
      period: "7d",
    });
    expect(analytics).toBeDefined();
    expect(analytics.categories).toBeDefined();
  });

  it("Step 7: Get corridor quote for customer (US→NG)", async () => {
    const quote = await caller.remittanceCorridors.getQuote({
      corridorId: "US-NG",
      amount: 1000,
    });
    expect(quote).toBeDefined();
    expect(quote.receiveAmount).toBeGreaterThan(0);
    expect(quote.fee).toBeGreaterThanOrEqual(0);
  });

  it("Step 8: Process customer remittance", async () => {
    const transfer = await caller.remittanceCorridors.send({
      corridorId: "US-NG",
      amount: 1000,
      recipientName: "Customer Family",
      recipientAccount: "9876543210",
      recipientBank: "GTBank",
      purpose: "family_support",
    });
    expect(transfer).toBeDefined();
    expect(transfer.transferId).toBeDefined();
    expect(transfer.status).toMatch(/pending|processing|completed/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCALE VALIDATION — Concurrent Operations
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scale Validation — Concurrent Operations", () => {
  it("Multiple users can create wallets concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const caller = appRouter.createCaller(
          createUserCtx({ id: 10000 + i, name: `Concurrent User ${i}` })
        );
        return caller.accountAbstraction.createWallet({
          chain: "polygon",
        });
      })
    );
    expect(results).toHaveLength(10);
    const addresses = results.map((r) => r.address);
    const unique = new Set(addresses);
    expect(unique.size).toBe(10);
  });

  it("Multiple merchants can register concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        const caller = appRouter.createCaller(
          createUserCtx({ id: 11000 + i, name: `Merchant ${i}`, role: "admin" })
        );
        return caller.merchantGateway.register({
          businessName: `Business ${i}`,
          acceptedCoins: ["USDC"],
          settlementCurrency: "USD",
        });
      })
    );
    expect(results).toHaveLength(5);
    const ids = results.map((r) => r.merchantId);
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });

  it("Multiple swap quotes can be fetched concurrently", async () => {
    const pairs: { from: string; to: string }[] = [
      { from: "USDT", to: "USDC" },
      { from: "USDC", to: "DAI" },
      { from: "DAI", to: "BUSD" },
      { from: "BUSD", to: "PYUSD" },
      { from: "PYUSD", to: "USDT" },
    ];
    const results = await Promise.all(
      pairs.map((p) => {
        const caller = appRouter.createCaller(
          createUserCtx({ id: 12001 })
        );
        return caller.crossCurrencySwap.getQuote({
          fromCoin: p.from as "USDT" | "USDC" | "DAI" | "BUSD" | "PYUSD",
          toCoin: p.to as "USDT" | "USDC" | "DAI" | "BUSD" | "PYUSD",
          amount: 1000,
          fromChain: "polygon",
          toChain: "polygon",
        });
      })
    );
    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r.outputAmount).toBeGreaterThan(0);
    });
  });

  it("Multiple corridor quotes can be fetched concurrently", async () => {
    const corridorIds = ["US-NG", "UK-GH", "EU-KE", "UK-NG", "US-GH"];
    const results = await Promise.all(
      corridorIds.map((id) => {
        const caller = appRouter.createCaller(createUserCtx({ id: 12002 }));
        return caller.remittanceCorridors.getQuote({
          corridorId: id,
          amount: 500,
        });
      })
    );
    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r.receiveAmount).toBeGreaterThan(0);
    });
  });

  it("Multiple vault deposits can be made concurrently", async () => {
    const termDays = [30, 60, 90, 180, 365];
    const results = await Promise.all(
      termDays.map((days, i) => {
        const caller = appRouter.createCaller(
          createUserCtx({ id: 13000 + i })
        );
        return caller.savingsVault.deposit({
          termDays: days,
          amount: 1000 * (i + 1),
          stablecoin: "USDC",
        });
      })
    );
    expect(results).toHaveLength(5);
    results.forEach((r, i) => {
      expect(r.principal).toBe(1000 * (i + 1));
    });
  });

  it("Data isolation: User A cannot see User B's positions", async () => {
    const userA = appRouter.createCaller(createUserCtx({ id: 14001 }));
    const userB = appRouter.createCaller(createUserCtx({ id: 14002 }));

    await userA.lendingBorrowing.supply({ stablecoin: "USDC", amount: 1000 });
    await userB.lendingBorrowing.supply({ stablecoin: "DAI", amount: 2000 });

    const resultA = await userA.lendingBorrowing.getPositions();
    const resultB = await userB.lendingBorrowing.getPositions();

    const aHasB = resultA.positions.some(
      (p: { stablecoin: string; amount: number }) => p.stablecoin === "DAI" && p.amount === 2000
    );
    const bHasA = resultB.positions.some(
      (p: { stablecoin: string; amount: number }) => p.stablecoin === "USDC" && p.amount === 1000
    );

    expect(aHasB).toBe(false);
    expect(bHasA).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-FEATURE WORKFLOW — Full Customer Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-Feature Workflow — Full Customer Lifecycle", () => {
  const caller = appRouter.createCaller(
    createUserCtx({ id: 15001, name: "Complete Lifecycle User" })
  );

  it("Full lifecycle: corridor → swap → save → lend → pay → govern", async () => {
    // 1. Send remittance
    const remit = await caller.remittanceCorridors.send({
      corridorId: "US-NG",
      amount: 200,
      recipientName: "Family",
      recipientAccount: "1111111111",
      recipientBank: "Access Bank",
      purpose: "family_support",
    });
    expect(remit.transferId).toBeDefined();

    // 2. Swap USDT to USDC (first get quote, then execute)
    const quote = await caller.crossCurrencySwap.getQuote({
      fromCoin: "USDT",
      toCoin: "USDC",
      amount: 500,
      fromChain: "polygon",
      toChain: "polygon",
    });
    const swap = await caller.crossCurrencySwap.executeSwap({
      quoteId: quote.quoteId,
    });
    expect(swap.swapId).toBeDefined();

    // 3. Deposit savings
    const deposit = await caller.savingsVault.deposit({
      termDays: 90,
      amount: 300,
      stablecoin: "USDC",
    });
    expect(deposit.depositId).toBeDefined();

    // 4. Supply to lending
    const supply = await caller.lendingBorrowing.supply({
      stablecoin: "USDC",
      amount: 200,
    });
    expect(supply.positionId).toBeDefined();

    // 5. Create scheduled payment
    const scheduled = await caller.programmablePayments.create({
      name: "Monthly rent",
      scheduleType: "recurring",
      stablecoin: "USDC",
      amount: 50,
      recipientAddress: "0xLandlord",
      chain: "polygon",
      cronExpression: "0 0 1 * *",
    });
    expect(scheduled.id).toBeDefined();

    // 6. Create governance proposal
    const proposal = await caller.platformFeatures.dao_createProposal({
      title: "Add EURC support for EU corridors",
      description: "Support Euro-backed stablecoin EURC for EU corridors to improve UX for European users",
      category: "fee_change",
      options: ["Yes", "No"],
      durationDays: 14,
      quorum: 5,
    });
    expect(proposal.proposalId).toBeDefined();

    // 7. Get referral code to share
    const referral = await caller.platformFeatures.referral_getCode();
    expect(referral.code).toBeDefined();

    // 8. Mint NFT receipt for first remittance
    const nft = await caller.platformFeatures.nft_mint({
      transactionId: remit.transferId,
      amount: 200,
      stablecoin: "USDC",
      recipientName: "Family",
      chain: "polygon",
    });
    expect(nft.tokenId).toBeDefined();
  });
});
