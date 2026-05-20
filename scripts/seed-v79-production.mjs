/**
 * RemitFlow v79 — Production Seed Script (corrected column names)
 * Run: node scripts/seed-v79-production.mjs
 */
import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/remitflow",
});

const q = (text, params) => pool.query(text, params);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max, dp = 2) => parseFloat((Math.random() * (max - min) + min).toFixed(dp));
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD", "GBP", "EUR"];
const CORRIDORS = ["NGN-GBP", "NGN-USD", "NGN-EUR", "GHS-USD", "KES-GBP", "ZAR-USD", "NGN-KES", "GHS-GBP"];
const FIRST_NAMES = ["Adaeze", "Chukwuemeka", "Fatima", "Kwame", "Amara", "Kofi", "Ngozi", "Tunde", "Ama", "Emeka", "Blessing", "Chisom", "Oluwaseun", "Aisha", "Yusuf", "Sade", "Bola", "Ike", "Nnamdi", "Zainab"];
const LAST_NAMES = ["Okafor", "Mensah", "Kamau", "Dlamini", "Diallo", "Asante", "Nwosu", "Adeyemi", "Owusu", "Ibrahim", "Mwangi", "Nkosi", "Traore", "Boateng", "Eze", "Obi", "Afolabi", "Bello", "Chukwu", "Osei"];
const BANKS = ["Access Bank", "GTBank", "First Bank", "Zenith Bank", "UBA", "Ecobank", "Stanbic IBTC", "FCMB", "Fidelity Bank", "Sterling Bank"];
const COUNTRIES = ["Nigeria", "Ghana", "Kenya", "South Africa", "Tanzania", "Uganda", "Senegal"];
const STATUSES = ["completed", "pending", "failed", "processing"];

async function main() {
  console.log("🌱 RemitFlow v79 Production Seed");
  console.log("══════════════════════════════════");

  // ── 1. Users ──────────────────────────────────────────────────────────────
  console.log("\n📧 Seeding users...");
  const userIds = [];
  for (let i = 0; i < 50; i++) {
    const firstName = rand(FIRST_NAMES);
    const lastName = rand(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@demo.remitflow.app`;
    try {
      const res = await q(
        `INSERT INTO users (name, email, "openId", role, "kycTier", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, email, `demo-${crypto.randomUUID()}`,
         rand(["user", "user", "user", "user", "admin"]),
         rand(["tier0", "tier1", "tier2", "tier3"]),
         daysAgo(randInt(1, 365))]
      );
      if (res.rows[0]) userIds.push(res.rows[0].id);
    } catch (e) { /* skip dups */ }
  }
  console.log(`  ✓ ${userIds.length} users`);

  if (userIds.length === 0) {
    // Fetch existing users
    const existing = await q(`SELECT id FROM users LIMIT 50`);
    userIds.push(...existing.rows.map(r => r.id));
    console.log(`  ℹ using ${userIds.length} existing users`);
  }

  // ── 2. Wallets ────────────────────────────────────────────────────────────
  console.log("\n💳 Seeding wallets...");
  let walletCount = 0;
  for (const uid of userIds) {
    const currencies = rand([["NGN"], ["NGN", "USD"], ["NGN", "USD", "GBP"], ["NGN", "GHS", "KES"]]);
    for (let ci = 0; ci < currencies.length; ci++) {
      try {
        await q(
          `INSERT INTO wallets ("userId", currency, balance, "lockedBalance", "isDefault", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT DO NOTHING`,
          [uid, currencies[ci], randFloat(1000, 5000000, 2), 0, ci === 0, "active", daysAgo(randInt(1, 300))]
        );
        walletCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${walletCount} wallets`);

  // ── 3. Transactions ───────────────────────────────────────────────────────
  console.log("\n💸 Seeding transactions...");
  let txCount = 0;
  const TX_TYPES = ["send", "receive", "exchange", "topup", "withdrawal"];
  const TX_DESC = ["Family support", "School fees", "Rent payment", "Business payment", "Medical bills", "Investment return", "Salary", "Freelance payment"];
  for (const uid of userIds) {
    const numTx = randInt(5, 30);
    for (let i = 0; i < numTx; i++) {
      const fromCurr = rand(CURRENCIES);
      const toCurr = rand(CURRENCIES.filter(c => c !== fromCurr));
      const amount = randFloat(500, 500000, 2);
      const fxRate = fromCurr === "NGN" ? randFloat(0.0005, 0.001, 6) : randFloat(0.8, 1.5, 4);
      try {
        await q(
          `INSERT INTO transactions ("userId", type, status, "fromCurrency", "fromAmount",
           "toCurrency", "toAmount", fee, "fxRate", reference, description,
           "recipientName", "recipientAccount", "recipientBank", "recipientCountry",
           channel, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
           ON CONFLICT DO NOTHING`,
          [uid, rand(TX_TYPES), rand(STATUSES), fromCurr, amount, toCurr,
           parseFloat((amount * fxRate).toFixed(2)),
           randFloat(50, 2500, 2), fxRate,
           `RF${Date.now()}${randInt(1000, 9999)}`,
           rand(TX_DESC),
           `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
           `${randInt(1000000000, 9999999999)}`,
           rand(BANKS), rand(COUNTRIES),
           rand(["web", "mobile", "api", "ussd"]),
           daysAgo(randInt(0, 365))]
        );
        txCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${txCount} transactions`);

  // ── 4. Beneficiaries ─────────────────────────────────────────────────────
  console.log("\n👥 Seeding beneficiaries...");
  let benCount = 0;
  for (const uid of userIds.slice(0, 40)) {
    for (let i = 0; i < randInt(2, 8); i++) {
      try {
        await q(
          `INSERT INTO beneficiaries ("userId", name, "accountNumber", "bankName", "bankCode",
           currency, country, phone, email, "isFavorite", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
          [uid, `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
           `${randInt(1000000000, 9999999999)}`,
           rand(BANKS), `${randInt(10, 99)}`,
           rand(CURRENCIES), rand(COUNTRIES),
           `+234${randInt(7000000000, 9099999999)}`,
           `user${randInt(100, 999)}@example.com`,
           Math.random() > 0.7,
           daysAgo(randInt(1, 300))]
        );
        benCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${benCount} beneficiaries`);

  // ── 5. Savings Goals ─────────────────────────────────────────────────────
  console.log("\n🎯 Seeding savings goals...");
  let savingsCount = 0;
  const GOAL_DATA = [
    { name: "Buy a house", emoji: "🏠", purpose: "real_estate" },
    { name: "School fees", emoji: "🎓", purpose: "education" },
    { name: "Emergency fund", emoji: "🛡️", purpose: "emergency" },
    { name: "New car", emoji: "🚗", purpose: "vehicle" },
    { name: "Business capital", emoji: "💼", purpose: "business" },
    { name: "Wedding fund", emoji: "💍", purpose: "wedding" },
    { name: "Vacation", emoji: "✈️", purpose: "travel" },
    { name: "Medical fund", emoji: "🏥", purpose: "medical" },
  ];
  for (const uid of userIds.slice(0, 40)) {
    for (let i = 0; i < randInt(1, 4); i++) {
      const goal = rand(GOAL_DATA);
      const target = randFloat(100000, 5000000, 2);
      const current = randFloat(0, target * 0.85, 2);
      try {
        await q(
          `INSERT INTO "savingsGoals" ("userId", name, emoji, "targetAmount", "currentAmount",
           currency, "targetDate", "autoSave", "autoSaveAmount", status, purpose, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) ON CONFLICT DO NOTHING`,
          [uid, goal.name, goal.emoji, target, current,
           rand(["NGN", "USD", "GBP"]),
           daysAgo(-randInt(30, 730)),
           Math.random() > 0.4, randFloat(5000, 100000, 2),
           rand(["active", "active", "active", "completed", "paused"]),
           goal.purpose, daysAgo(randInt(1, 180))]
        );
        savingsCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${savingsCount} savings goals`);

  // ── 6. Disputes ───────────────────────────────────────────────────────────
  console.log("\n⚖️ Seeding disputes...");
  let disputeCount = 0;
  const DISPUTE_TYPES = ["fraud", "unauthorized_transaction", "failed_transfer", "wrong_amount", "delayed_transfer", "general_inquiry"];
  const DISPUTE_DESC = [
    "Unauthorized transaction on my account that I did not initiate",
    "Transfer failed but money was deducted from my wallet",
    "Wrong amount was sent to the beneficiary",
    "Transfer has been delayed beyond the promised 24 hours",
    "Duplicate charge appeared on my statement",
    "Received less than the expected amount after exchange",
  ];
  for (const uid of userIds.slice(0, 30)) {
    for (let i = 0; i < randInt(0, 4); i++) {
      try {
        await q(
          `INSERT INTO disputes ("userId", type, description, status, resolution, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT DO NOTHING`,
          [uid, rand(DISPUTE_TYPES), rand(DISPUTE_DESC),
           rand(["open", "open", "in_review", "resolved", "closed"]),
           rand([null, null, "Refund processed", "Transaction confirmed valid", "Escalated to compliance"]),
           daysAgo(randInt(0, 90))]
        );
        disputeCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${disputeCount} disputes`);

  // ── 7. FX Rate Alerts ────────────────────────────────────────────────────
  console.log("\n🔔 Seeding FX alerts...");
  let alertCount = 0;
  const FX_PAIRS = [
    { from: "NGN", to: "USD", base: 0.00065 }, { from: "NGN", to: "GBP", base: 0.00052 },
    { from: "NGN", to: "EUR", base: 0.00060 }, { from: "GHS", to: "USD", base: 0.068 },
    { from: "KES", to: "USD", base: 0.0077 }, { from: "ZAR", to: "USD", base: 0.054 },
  ];
  for (const uid of userIds.slice(0, 35)) {
    for (let i = 0; i < randInt(1, 5); i++) {
      const pair = rand(FX_PAIRS);
      try {
        await q(
          `INSERT INTO "fxAlerts" ("userId", "fromCurrency", "toCurrency", "targetRate",
           direction, "isActive", triggered, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
          [uid, pair.from, pair.to,
           parseFloat((pair.base * (1 + (Math.random() - 0.5) * 0.15)).toFixed(8)),
           rand(["above", "below"]), Math.random() > 0.2, false,
           daysAgo(randInt(1, 90))]
        );
        alertCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${alertCount} FX alerts`);

  // ── 8. FX Rate History ────────────────────────────────────────────────────
  console.log("\n📈 Seeding FX rate history...");
  let fxHistCount = 0;
  for (const pair of FX_PAIRS) {
    for (let d = 180; d >= 0; d -= 1) {
      const drift = 1 + (Math.random() - 0.5) * 0.015;
      try {
        await q(
          `INSERT INTO fx_rate_history (from_currency, to_currency, rate, source, recorded_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [pair.from, pair.to, parseFloat((pair.base * drift).toFixed(8)),
           rand(["ECB", "XE", "OpenExchangeRates", "RemitFlow", "Fixer.io"]),
           daysAgo(d)]
        );
        fxHistCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${fxHistCount} FX rate history rows`);

  // ── 9. Audit Logs ─────────────────────────────────────────────────────────
  console.log("\n📋 Seeding audit logs...");
  let auditCount = 0;
  const AUDIT_ACTIONS = ["login", "logout", "transfer.send", "kyc.submit", "kyc.approved",
    "profile.update", "beneficiary.add", "wallet.topup", "dispute.create", "card.freeze",
    "settings.change", "2fa.enable", "admin.user.view", "password.change"];
  for (const uid of userIds.slice(0, 40)) {
    for (let i = 0; i < randInt(5, 40); i++) {
      const action = rand(AUDIT_ACTIONS);
      try {
        await q(
          `INSERT INTO "auditLogs" ("userId", action, description, "ipAddress", "userAgent",
           severity, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [uid, action, `User performed: ${action}`,
           `${randInt(1, 255)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(0, 255)}`,
           rand(["Mozilla/5.0 (Windows NT 10.0)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
                 "RemitFlow-Mobile/3.2 Android", "Mozilla/5.0 (Macintosh)"]),
           rand(["info", "info", "info", "warning", "critical"]),
           daysAgo(randInt(0, 180))]
        );
        auditCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${auditCount} audit log entries`);

  // ── 10. Notification Preferences ─────────────────────────────────────────
  console.log("\n🔕 Seeding notification preferences...");
  let notifCount = 0;
  const NOTIF_CATEGORIES = ["transactions", "security", "marketing", "kyc", "fx_alerts", "system"];
  for (const uid of userIds) {
    for (const category of NOTIF_CATEGORIES) {
      try {
        await q(
          `INSERT INTO "notificationPreferences" ("userId", category, "emailEnabled", "inAppEnabled", "pushEnabled", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT ("userId", category) DO NOTHING`,
          [uid, category,
           category === "security" ? true : Math.random() > 0.3,
           category === "transactions" ? true : Math.random() > 0.2,
           Math.random() > 0.5,
           daysAgo(randInt(1, 200))]
        );
        notifCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${notifCount} notification preferences`);

  // ── 11. Virtual Cards ─────────────────────────────────────────────────────
  console.log("\n💳 Seeding virtual cards...");
  let cardCount = 0;
  for (const uid of userIds.slice(0, 35)) {
    for (let i = 0; i < randInt(1, 3); i++) {
      try {
        await q(
          `INSERT INTO virtual_cards (user_id, card_number_masked, card_type, network,
           currency, balance, spending_limit, status, expiry_month, expiry_year,
           provider, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
          [uid, `**** **** **** ${randInt(1000, 9999)}`,
           rand(["virtual", "physical"]), rand(["Visa", "Mastercard"]),
           rand(["USD", "GBP", "EUR"]), randFloat(0, 5000, 2),
           randFloat(500, 10000, 2),
           rand(["active", "active", "active", "frozen", "expired"]),
           randInt(1, 12), randInt(2025, 2030),
           rand(["Stripe", "Flutterwave", "Paystack"]),
           daysAgo(randInt(1, 365))]
        );
        cardCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${cardCount} virtual cards`);

  // ── 12. Referrals ─────────────────────────────────────────────────────────
  console.log("\n🎁 Seeding referrals...");
  let referralCount = 0;
  for (const uid of userIds.slice(0, 30)) {
    for (let i = 0; i < randInt(0, 10); i++) {
      const referredId = rand(userIds.filter(id => id !== uid));
      if (!referredId) continue;
      try {
        await q(
          `INSERT INTO referrals ("referrerId", "referredId", status, "rewardAmount", "rewardCurrency", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [uid, referredId,
           rand(["pending", "completed", "completed", "completed", "paid"]),
           rand([5, 7.5, 10, 15]), "USD",
           daysAgo(randInt(1, 365))]
        );
        referralCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${referralCount} referrals`);

  // ── 13. Compliance Watchlist ──────────────────────────────────────────────
  console.log("\n🚨 Seeding compliance watchlist...");
  let watchlistCount = 0;
  for (let i = 0; i < 50; i++) {
    try {
      await q(
        `INSERT INTO compliance_watchlist (name, "date_of_birth", nationality, id_number,
         status, risk_score, matched_lists, notes, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT DO NOTHING`,
        [`${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
         daysAgo(randInt(7300, 25550)), // 20-70 years ago
         rand(["NG", "GH", "KE", "ZA", "US", "UK", "IR", "KP", "SY"]),
         `${randInt(10000000, 99999999)}`,
         rand(["flagged", "cleared", "pending_review", "flagged"]),
         randInt(40, 100),
         JSON.stringify(rand([["OFAC"], ["UN"], ["EU"], ["HM Treasury"], ["OFAC", "UN"]])),
         rand(["Matched on OFAC SDN list", "PEP - senior government official",
               "Adverse media - fraud allegations", "Sanctions evasion suspected"]),
         daysAgo(randInt(1, 730))]
      );
      watchlistCount++;
    } catch {}
  }
  console.log(`  ✓ ${watchlistCount} watchlist entries`);

  // ── 14. Agent Registrations ───────────────────────────────────────────────
  console.log("\n🏪 Seeding agent registrations...");
  let agentCount = 0;
  const STATES = ["Lagos", "Abuja", "Kano", "Rivers", "Oyo", "Anambra", "Delta", "Enugu", "Kaduna", "Ogun"];
  const BUSINESS_TYPES = ["fintech", "bank_agent", "microfinance", "cooperative", "mobile_money"];
  for (let i = 0; i < 40; i++) {
    const uid = rand(userIds);
    try {
      await q(
        `INSERT INTO agent_registrations (user_id, agent_code, business_name, business_type,
         state, lga, address, phone, tier, status, daily_limit_ngn, monthly_volume_ngn,
         commission_rate_pct, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT DO NOTHING`,
        [uid, `AGT${randInt(10000, 99999)}`,
         `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)} Agency`,
         rand(BUSINESS_TYPES), rand(STATES), `${rand(STATES)} LGA`,
         `${randInt(1, 200)} ${rand(["Main Street", "Market Road", "Bank Avenue", "Commerce Lane"])}`,
         `+234${randInt(7000000000, 9099999999)}`,
         rand(["basic", "standard", "premium"]),
         rand(["active", "active", "active", "suspended", "pending"]),
         randFloat(500000, 5000000, 2), randFloat(5000000, 50000000, 2),
         randFloat(0.5, 2.5, 2), daysAgo(randInt(1, 500))]
      );
      agentCount++;
    } catch {}
  }
  console.log(`  ✓ ${agentCount} agent registrations`);

  // ── 15. Batch Payments ────────────────────────────────────────────────────
  console.log("\n📦 Seeding batch payments...");
  let batchCount = 0;
  const BATCH_NAMES = ["Payroll Q1 2025", "Supplier Payments March", "Staff Salaries April",
    "Contractor Fees Q2", "Dividend Distribution", "Commission Payouts", "Vendor Settlements"];
  for (const uid of userIds.slice(0, 20)) {
    for (let i = 0; i < randInt(1, 5); i++) {
      const recipients = randInt(5, 200);
      const success = randInt(Math.floor(recipients * 0.8), recipients);
      const failed = recipients - success;
      const payments = Array.from({ length: Math.min(recipients, 10) }, () => ({
        name: `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
        account: `${randInt(1000000000, 9999999999)}`,
        bank: rand(BANKS),
        amount: randFloat(10000, 500000, 2),
        currency: "NGN",
        status: rand(["success", "success", "failed"]),
      }));
      try {
        await q(
          `INSERT INTO "batchPayments" ("userId", name, "totalAmount", currency,
           "totalRecipients", "successCount", "failedCount", status, payments, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) ON CONFLICT DO NOTHING`,
          [uid, rand(BATCH_NAMES), randFloat(500000, 50000000, 2),
           rand(["NGN", "USD", "GBP"]),
           recipients, success, failed,
           rand(["completed", "completed", "processing", "failed", "pending"]),
           JSON.stringify(payments), daysAgo(randInt(1, 180))]
        );
        batchCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${batchCount} batch payments`);

  // ── 16. Investment Opportunities ──────────────────────────────────────────
  console.log("\n📈 Seeding investment opportunities...");
  let investCount = 0;
  const INVEST_DATA = [
    { title: "Lagos Real Estate Fund III", sector: "real_estate", stage: "growth", country: "Nigeria", sdg: [11, 8] },
    { title: "Nairobi Tech Startup Fund", sector: "technology", stage: "seed", country: "Kenya", sdg: [9, 8] },
    { title: "Nigeria 91-Day T-Bills", sector: "government_bonds", stage: "established", country: "Nigeria", sdg: [1, 8] },
    { title: "Ghana Diaspora Bond 2026", sector: "government_bonds", stage: "established", country: "Ghana", sdg: [1, 10] },
    { title: "East Africa Agribusiness Fund", sector: "agriculture", stage: "growth", country: "Kenya", sdg: [2, 8] },
    { title: "SA Infrastructure Fund", sector: "infrastructure", stage: "growth", country: "South Africa", sdg: [9, 11] },
    { title: "West Africa Fintech Fund", sector: "fintech", stage: "series_a", country: "Nigeria", sdg: [8, 10] },
    { title: "Senegal Solar Energy Project", sector: "renewable_energy", stage: "growth", country: "Senegal", sdg: [7, 13] },
    { title: "Tanzania Tourism REIT", sector: "real_estate", stage: "established", country: "Tanzania", sdg: [8, 11] },
    { title: "Pan-Africa Healthcare Fund", sector: "healthcare", stage: "growth", country: "Nigeria", sdg: [3, 8] },
  ];
  for (const inv of INVEST_DATA) {
    const target = randFloat(1000000, 100000000, 2);
    try {
      await q(
        `INSERT INTO investment_opportunities (title, description, country, sector, stage,
         target_amount, raised_amount, min_investment, currency, due_date,
         sdg_alignment, expected_return, risk_level, status, investor_count, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) ON CONFLICT DO NOTHING`,
        [inv.title, `High-yield ${inv.sector} investment opportunity for diaspora investors in ${inv.country}`,
         inv.country, inv.sector, inv.stage,
         target, randFloat(target * 0.1, target * 0.9, 2),
         randFloat(10000, 500000, 2), rand(["NGN", "USD", "GBP"]),
         daysAgo(-randInt(30, 365)),
         JSON.stringify(inv.sdg),
         randFloat(8, 28, 1), rand(["low", "medium", "medium", "high"]),
         rand(["open", "open", "open", "closed", "coming_soon"]),
         randInt(5, 500), daysAgo(randInt(1, 180))]
      );
      investCount++;
    } catch {}
  }
  console.log(`  ✓ ${investCount} investment opportunities`);

  // ── 17. Corridor Margin History ───────────────────────────────────────────
  console.log("\n📊 Seeding corridor margin history...");
  let marginCount = 0;
  for (const corridor of CORRIDORS) {
    for (let i = 0; i < 15; i++) {
      try {
        await q(
          `INSERT INTO corridor_margin_history (corridor_id, corridor_name, change_type,
           old_value, new_value, changed_by, changed_by_name, reason, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
          [corridor, corridor.replace("-", " → "),
           rand(["margin_pct", "delivery_time_hours", "enabled", "min_amount", "max_amount"]),
           randFloat(0.5, 3.0, 2).toString(), randFloat(0.5, 3.0, 2).toString(),
           rand(userIds.slice(0, 5)) || 1,
           `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
           rand(["Market adjustment", "Competitive pricing review", "Risk reassessment",
                 "Regulatory compliance", "Quarterly pricing review", "Partner rate update"]),
           daysAgo(randInt(1, 180))]
        );
        marginCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${marginCount} corridor margin history rows`);

  // ── 18. Support Tickets ───────────────────────────────────────────────────
  console.log("\n🎫 Seeding support tickets...");
  let ticketCount = 0;
  const TICKET_SUBJECTS = [
    "Transfer not received by beneficiary", "Account verification issue",
    "Unable to add bank account", "FX rate query", "Card not working",
    "KYC document rejected", "Referral bonus not credited", "App login problem"
  ];
  for (const uid of userIds.slice(0, 30)) {
    for (let i = 0; i < randInt(0, 5); i++) {
      try {
        await q(
          `INSERT INTO support_tickets ("userId", subject, status, priority, category,
           "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT DO NOTHING`,
          [uid, rand(TICKET_SUBJECTS),
           rand(["open", "open", "in_progress", "resolved", "closed"]),
           rand(["low", "medium", "high", "urgent"]),
           rand(["technical", "billing", "compliance", "general"]),
           daysAgo(randInt(0, 90))]
        );
        ticketCount++;
      } catch {}
    }
  }
  console.log(`  ✓ ${ticketCount} support tickets`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════");
  console.log("✅ v79 Production Seed Complete!");
  console.log(`   Users: ${userIds.length} | Transactions: ${txCount} | Wallets: ${walletCount}`);
  console.log(`   Beneficiaries: ${benCount} | Savings Goals: ${savingsCount} | Disputes: ${disputeCount}`);
  console.log(`   FX Alerts: ${alertCount} | FX History: ${fxHistCount} | Audit Logs: ${auditCount}`);
  console.log(`   Virtual Cards: ${cardCount} | Referrals: ${referralCount} | Agents: ${agentCount}`);
  console.log(`   Batch Payments: ${batchCount} | Investments: ${investCount} | Watchlist: ${watchlistCount}`);
  console.log(`   Corridor History: ${marginCount} | Support Tickets: ${ticketCount}`);

  await pool.end();
}

main().catch(e => { console.error("Seed failed:", e.message); process.exit(1); });
