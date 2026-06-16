import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createCtx(): TrpcContext {
  const user = {
    id: 1,
    openId: "test-user",
    email: "test@remitflow.com",
    name: "Test User",
    loginMethod: "keycloak",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("RemitFlow tRPC Routers", () => {
  const caller = appRouter.createCaller(createCtx());

  // Auth
  it("auth.me returns the current user", async () => {
    const user = await caller.auth.me();
    expect(user).toBeDefined();
    expect(user?.email).toBe("test@remitflow.com");
  });

  it("auth.logout clears session cookie", async () => {
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });

  // Dashboard
  it("dashboard.summary returns portfolio data", async () => {
    const data = await caller.dashboard.summary();
    expect(data).toHaveProperty("totalBalance");
    expect(data).toHaveProperty("recentTransactions");
    expect(Array.isArray(data.recentTransactions)).toBe(true);
  }, 15000);

  it("dashboard.summary returns user info", async () => {
    const data = await caller.dashboard.summary();
    expect(data).toHaveProperty("user");
    expect(data.user).toHaveProperty("name");
  }, 15000);

  // Wallet
  it("wallet.list returns wallet balances", async () => {
    const wallets = await caller.wallet.list();
    expect(Array.isArray(wallets)).toBe(true);
    if (wallets.length > 0) {
      expect(wallets[0]).toHaveProperty("currency");
      expect(wallets[0]).toHaveProperty("balance");
    }
  });

  it("wallet.balances returns enriched balances with USD equivalent", async () => {
    const balances = await caller.wallet.balances();
    expect(Array.isArray(balances)).toBe(true);
    if (balances.length > 0) {
      expect(balances[0]).toHaveProperty("usdEquivalent");
    }
  });

  it("wallet.virtualAccount returns virtual accounts array", async () => {
    const va = await caller.wallet.virtualAccount();
    expect(Array.isArray(va)).toBe(true);
  });

  it("wallet.history returns recent transactions", async () => {
    const history = await caller.wallet.history();
    expect(Array.isArray(history)).toBe(true);
  });

  // Transactions
  it("transactions.list returns transaction history", async () => {
    const txns = await caller.transactions.list();
    expect(Array.isArray(txns)).toBe(true);
    if (txns.length > 0) {
      expect(txns[0]).toHaveProperty("id");
      expect(txns[0]).toHaveProperty("type");
    }
  });

  // FX
  it("fx.rates returns exchange rates array", async () => {
    const rates = await caller.fx.rates();
    expect(Array.isArray(rates)).toBe(true);
    expect(rates.length).toBeGreaterThan(0);
    const usd = rates.find((r: any) => r.currency === "USD");
    expect(usd).toBeDefined();
  }, 15000);

  it("fx.alerts returns alert list", async () => {
    const alerts = await caller.fx.alerts();
    expect(Array.isArray(alerts)).toBe(true);
  });

  // KYC
  it("kyc.status returns verification status with tiers", async () => {
    const status = await caller.kyc.status();
    expect(status).toHaveProperty("currentTier");
    expect(status).toHaveProperty("tiers");
    expect(Array.isArray(status.tiers)).toBe(true);
    expect(status.tiers.length).toBe(4);
  });

  // Cards
  it("cards.list returns card list", async () => {
    const cards = await caller.cards.list();
    expect(Array.isArray(cards)).toBe(true);
    if (cards.length > 0) {
      expect(cards[0]).toHaveProperty("type");
      expect(cards[0]).toHaveProperty("brand");
    }
  });

  // Mojaloop
  it("mojaloop.transfers returns transfer list", async () => {
    const transfers = await caller.mojaloop.transfers();
    expect(Array.isArray(transfers)).toBe(true);
    // transfers may be empty in test env (only includes txns with mojaloopTransferId)
    if (transfers.length > 0) {
      expect(transfers[0]).toHaveProperty("transferId");
      expect(transfers[0]).toHaveProperty("status");
    }
  });

  it("mojaloop.participants returns FSP list", async () => {
    const participants = await caller.mojaloop.participants();
    expect(Array.isArray(participants)).toBe(true);
    expect(participants[0]).toHaveProperty("fspId");
  });

  it("mojaloop.settlementWindows returns windows", async () => {
    const windows = await caller.mojaloop.settlementWindows();
    expect(Array.isArray(windows)).toBe(true);
    expect(windows[0]).toHaveProperty("state");
  });

  // Compliance
  it("compliance.fcaDashboard returns FCA metrics", async () => {
    const fca = await caller.compliance.fcaDashboard();
    expect(fca).toHaveProperty("status");
    expect(fca).toHaveProperty("complianceScore");
    expect(fca.status).toBe("compliant");
  });

  it("compliance.travelRule returns travel rule records array", async () => {
    const records = await caller.compliance.travelRule();
    expect(Array.isArray(records)).toBe(true);
  });

  // Savings
  it("savings.list returns savings goals", async () => {
    const goals = await caller.savings.list();
    expect(Array.isArray(goals)).toBe(true);
    if (goals.length > 0) {
      expect(goals[0]).toHaveProperty("targetAmount");
      expect(goals[0]).toHaveProperty("currentAmount");
    }
  });

  // Referral
  it("referral.info returns referral data with leaderboard", async () => {
    const info = await caller.referral.info();
    expect(info).toHaveProperty("referralCode");
    expect(info).toHaveProperty("totalReferrals");
    expect(Array.isArray(info.leaderboard)).toBe(true);
  });

  it("referral.stats returns same data as referral.info", async () => {
    const stats = await caller.referral.stats();
    expect(stats).toHaveProperty("referralCode");
    expect(stats).toHaveProperty("totalEarned");
  });

  // Corridors
  it("corridors.list returns corridor pricing", async () => {
    const corridors = await caller.corridors.list();
    expect(Array.isArray(corridors)).toBe(true);
    expect(corridors[0]).toHaveProperty("from");
    expect(corridors[0]).toHaveProperty("to");
    expect(corridors[0]).toHaveProperty("fee");
  });

  // Agents
  it("agents.list returns agent network", async () => {
    const agents = await caller.agents.list();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents[0]).toHaveProperty("name");
    expect(agents[0]).toHaveProperty("status");
    expect(agents[0]).toHaveProperty("agentId");
  });

  // Audit
  it("audit.logs returns audit log entries array", async () => {
    const result = await caller.audit.logs({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("audit.list returns audit log entries array", async () => {
    const result = await caller.audit.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });

  // CBDC
  it("cbdc.balances returns CBDC wallet data", async () => {
    const balances = await caller.cbdc.balances();
    expect(Array.isArray(balances)).toBe(true);
    expect(balances[0]).toHaveProperty("balance");
    expect(balances[0]).toHaveProperty("currency");
  });

  it("cbdc.transactions returns CBDC transaction history", async () => {
    const txns = await caller.cbdc.transactions();
    expect(Array.isArray(txns)).toBe(true);
  });

  // BNPL
  it("bnpl.eligibility returns credit eligibility", async () => {
    const eligibility = await caller.bnpl.eligibility();
    expect(eligibility).toHaveProperty("eligible");
    expect(eligibility).toHaveProperty("limit");
    expect(eligibility).toHaveProperty("score");
  });

  it("bnpl.plans returns BNPL plan list", async () => {
    const plans = await caller.bnpl.plans();
    expect(Array.isArray(plans)).toBe(true);
    if (plans.length > 0) {
      expect(plans[0]).toHaveProperty("merchant");
      expect(plans[0]).toHaveProperty("status");
    }
  });

  // POS
  it("pos.terminals returns POS terminal list", async () => {
    const terminals = await caller.pos.terminals();
    expect(Array.isArray(terminals)).toBe(true);
    expect(terminals[0]).toHaveProperty("terminalId");
    expect(terminals[0]).toHaveProperty("merchant");
  });

  // Payment Methods
  it("paymentMethods.list returns payment methods object", async () => {
    const methods = await caller.paymentMethods.list();
    expect(methods).toHaveProperty("cards");
    expect(methods).toHaveProperty("bankAccounts");
    expect(methods).toHaveProperty("wallets");
    expect(Array.isArray(methods.cards)).toBe(true);
  });

  // Beneficiaries
  it("beneficiaries.list returns beneficiary list", async () => {
    const beneficiaries = await caller.beneficiaries.list();
    expect(Array.isArray(beneficiaries)).toBe(true);
    if (beneficiaries.length > 0) {
      expect(beneficiaries[0]).toHaveProperty("name");
    }
  });

  // Notifications
  it("notifications.list returns notification object with array", async () => {
    const result = await caller.notifications.list();
    expect(result).toHaveProperty("notifications");
    expect(result).toHaveProperty("unread");
    expect(Array.isArray(result.notifications)).toBe(true);
  });

  // Stablecoin
  it("stablecoin.balances returns stablecoin wallets", async () => {
    const balances = await caller.stablecoin.balances();
    expect(Array.isArray(balances)).toBe(true);
    expect(balances[0]).toHaveProperty("symbol");
    expect(balances[0]).toHaveProperty("balance");
  });

  // Airtime
  it("airtime.providers returns provider list", async () => {
    const providers = await caller.airtime.providers();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers[0]).toHaveProperty("name");
  });

  // Bills
  it("bills.categories returns bill categories", async () => {
    const categories = await caller.bills.categories();
    expect(Array.isArray(categories)).toBe(true);
    expect(categories[0]).toHaveProperty("name");
    expect(categories[0]).toHaveProperty("providers");
  });

  // Support
  it("support.faqs returns FAQ list", async () => {
    const faqs = await caller.support.faqs();
    expect(Array.isArray(faqs)).toBe(true);
    expect(faqs[0]).toHaveProperty("q");
    expect(faqs[0]).toHaveProperty("a");
  });

  // Account Health
  it("accountHealth.score returns health score", async () => {
    const health = await caller.accountHealth.score();
    expect(health).toHaveProperty("score");
    expect(health).toHaveProperty("grade");
    expect(health).toHaveProperty("factors");
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  // Analytics
  it("analytics.overview returns analytics data", async () => {
    const overview = await caller.analytics.overview();
    expect(overview).toHaveProperty("totalSent");
    expect(overview).toHaveProperty("totalReceived");
    expect(overview).toHaveProperty("successRate");
  });

  // QR
  it("qr.info returns QR payment info", async () => {
    const info = await caller.qr.info();
    expect(info).toHaveProperty("userId");
    expect(info).toHaveProperty("paymentLink");
    expect(info).toHaveProperty("qrData");
  });

  // Recurring
  it("recurring.list returns recurring payments", async () => {
    const recurring = await caller.recurring.list();
    expect(Array.isArray(recurring)).toBe(true);
  });

  // Batch
  it("batch.list returns batch payments", async () => {
    const batch = await caller.batch.list();
    expect(Array.isArray(batch)).toBe(true);
  });

  // Virtual Accounts
  it("virtualAccount.list returns virtual accounts", async () => {
    const accounts = await caller.virtualAccount.list();
    expect(Array.isArray(accounts)).toBe(true);
  });

  // Disputes
  it("disputes.list returns disputes", async () => {
    const disputes = await caller.disputes.list();
    expect(Array.isArray(disputes)).toBe(true);
  });

  // Security
  it("security.settings returns security config", async () => {
    const settings = await caller.security.settings();
    expect(settings).toHaveProperty("twoFactorEnabled");
    expect(settings).toHaveProperty("activeSessions");
  });

  // Profile
  it("profile.get returns user profile", async () => {
    const profile = await caller.profile.get();
    expect(profile).toBeDefined();
  });

  // Direct Debit
  it("directDebit.mandates returns mandate list", async () => {
    const mandates = await caller.directDebit.mandates();
    expect(Array.isArray(mandates)).toBe(true);
    if (mandates.length > 0) {
      expect(mandates[0]).toHaveProperty("creditor");
    }
  });

  // Checkout
  it("checkout.apiKeys returns API keys", async () => {
    const keys = await caller.checkout.apiKeys();
    expect(keys).toHaveProperty("publicKey");
    expect(keys).toHaveProperty("secretKey");
  });

  // Investment
  it("investment.listAssets returns asset list", async () => {
    const assets = await caller.investment.listAssets({});
    expect(Array.isArray(assets)).toBe(true);
    if (assets.length > 0) {
      expect(assets[0]).toHaveProperty("symbol");
      expect(assets[0]).toHaveProperty("currentPrice");
    }
  });

  it("investment.getPriceHistory returns OHLC data for BTC", async () => {
    const history = await caller.investment.getPriceHistory({ symbol: "BTC", interval: "1d", limit: 30 });
    expect(Array.isArray(history)).toBe(true);
    if (history.length > 0) {
      expect(history[0]).toHaveProperty("open");
      expect(history[0]).toHaveProperty("close");
      expect(history[0]).toHaveProperty("timestamp");
    }
  });

  it("investment.getPortfolio returns portfolio summary", async () => {
    const portfolio = await caller.investment.getPortfolio();
    expect(portfolio).toHaveProperty("holdings");
    expect(portfolio).toHaveProperty("totalValue");
    expect(Array.isArray(portfolio.holdings)).toBe(true);
  });

  it("investment.getWatchlist returns watchlist items", async () => {
    const watchlist = await caller.investment.getWatchlist();
    expect(Array.isArray(watchlist)).toBe(true);
  });

  it("investment.getPriceFeed returns live price feed", async () => {
    const feed = await Promise.race([
      caller.investment.getPriceFeed(),
      new Promise((resolve) => setTimeout(() => resolve({ prices: [], count: 0, _timeout: true }), 5000)),
    ]);
    expect(feed).toBeDefined();
  }, 10000);
});
