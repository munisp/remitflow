/**
 * Seed script: Feature Flags + Tenants
 * Run: node scripts/seed-feature-flags-tenants.mjs
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.LOCAL_DATABASE_URL });
await client.connect();

// ─── Feature Flags ────────────────────────────────────────────────────────────
const PLATFORM_FLAGS = [
  // Core
  { key: "send_money",          name: "Send Money",           category: "core",        description: "Core remittance send flow",                   default_enabled: true,  rollout_pct: 100 },
  { key: "receive_money",       name: "Receive Money",        category: "core",        description: "Receive funds via virtual account",           default_enabled: true,  rollout_pct: 100 },
  { key: "fx_alerts",           name: "FX Rate Alerts",       category: "core",        description: "Set target exchange rate alerts",             default_enabled: true,  rollout_pct: 100 },
  { key: "rate_lock",           name: "Rate Lock",            category: "core",        description: "Lock favorable exchange rate for 24h",        default_enabled: true,  rollout_pct: 100 },
  { key: "recurring_payments",  name: "Recurring Payments",   category: "core",        description: "Scheduled recurring transfers",               default_enabled: true,  rollout_pct: 100 },
  // Payments
  { key: "batch_payments",      name: "Batch Payments",       category: "payments",    description: "Upload CSV for bulk transfers",               default_enabled: true,  rollout_pct: 100 },
  { key: "qr_pay",              name: "QR Pay",               category: "payments",    description: "Send/receive via QR code",                    default_enabled: true,  rollout_pct: 100 },
  { key: "virtual_cards",       name: "Virtual Cards",        category: "payments",    description: "Issue virtual Visa/Mastercard",               default_enabled: true,  rollout_pct: 100 },
  { key: "direct_debit",        name: "Direct Debit",         category: "payments",    description: "Set up direct debit mandates",                default_enabled: false, rollout_pct: 0   },
  { key: "bnpl",                name: "Buy Now Pay Later",    category: "payments",    description: "Installment payment plans",                   default_enabled: false, rollout_pct: 20  },
  // Savings & Invest
  { key: "savings_goals",       name: "Savings Goals",        category: "savings",     description: "Create and track savings goals",              default_enabled: true,  rollout_pct: 100 },
  { key: "diaspora_invest",     name: "DiasporaVest",         category: "savings",     description: "African bond and equity investments",         default_enabled: true,  rollout_pct: 100 },
  { key: "stablecoin_swap",     name: "Stablecoin Swap",      category: "savings",     description: "Swap to USDC/USDT stablecoins",               default_enabled: false, rollout_pct: 10  },
  { key: "cbdc",                name: "CBDC Integration",     category: "savings",     description: "Central bank digital currency support",       default_enabled: false, rollout_pct: 0   },
  // Community
  { key: "community_funds",     name: "Community Funds",      category: "community",   description: "Group savings pools (esusu/tontine)",         default_enabled: true,  rollout_pct: 100 },
  { key: "talent_bridge",       name: "TalentBridge",         category: "community",   description: "Diaspora skills marketplace",                 default_enabled: true,  rollout_pct: 100 },
  { key: "family_dashboard",    name: "Family Dashboard",     category: "community",   description: "Manage family members and allowances",        default_enabled: true,  rollout_pct: 100 },
  { key: "referral_program",    name: "Referral Program",     category: "community",   description: "Earn rewards for referrals",                  default_enabled: true,  rollout_pct: 100 },
  // Compliance
  { key: "kyc_tier2",           name: "KYC Tier 2",           category: "compliance",  description: "Enhanced identity verification",              default_enabled: true,  rollout_pct: 100 },
  { key: "travel_rule",         name: "Travel Rule",          category: "compliance",  description: "FATF travel rule compliance",                 default_enabled: true,  rollout_pct: 100 },
  { key: "dpia",                name: "DPIA Assessments",     category: "compliance",  description: "Data protection impact assessments",          default_enabled: true,  rollout_pct: 100 },
  // Fintech
  { key: "mojaloop",            name: "Mojaloop FSP",         category: "fintech",     description: "Interoperable transfers via Mojaloop switch", default_enabled: true,  rollout_pct: 100 },
  { key: "mpesa_integration",   name: "M-Pesa Integration",   category: "fintech",     description: "Direct M-Pesa send/receive",                  default_enabled: true,  rollout_pct: 100 },
  { key: "wise_integration",    name: "Wise Integration",     category: "fintech",     description: "Wise corridor pricing and transfers",         default_enabled: true,  rollout_pct: 100 },
  // Admin
  { key: "admin_panel",         name: "Admin Panel",          category: "admin",       description: "Full admin dashboard access",                 default_enabled: false, rollout_pct: 0   },
  { key: "feature_flags_ui",    name: "Feature Flags UI",     category: "admin",       description: "Admin feature flag management",               default_enabled: false, rollout_pct: 0   },
  { key: "tenant_management",   name: "Tenant Management",    category: "admin",       description: "Multi-tenant admin controls",                 default_enabled: false, rollout_pct: 0   },
];

console.log("Seeding feature flags...");
for (const flag of PLATFORM_FLAGS) {
  await client.query(`
    INSERT INTO feature_flags (key, name, category, description, default_enabled, rollout_pct, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      default_enabled = EXCLUDED.default_enabled,
      rollout_pct = EXCLUDED.rollout_pct,
      "updatedAt" = NOW()
  `, [flag.key, flag.name, flag.category, flag.description, flag.default_enabled, flag.rollout_pct]);
}
console.log(`  ✓ ${PLATFORM_FLAGS.length} feature flags seeded`);

// ─── Demo Tenants ─────────────────────────────────────────────────────────────
const DEMO_TENANTS = [
  {
    slug: "remitflow-default",
    name: "RemitFlow Default",
    brand_name: "RemitFlow",
    plan: "enterprise",
    status: "active",
    primary_color: "#7c3aed",
    secondary_color: "#06b6d4",
    accent_color: "#f59e0b",
    default_currency: "USD",
    default_locale: "en",
    support_email: "support@remitflow.app",
    max_users: 100000,
  },
  {
    slug: "diaspora-uk",
    name: "DiasporaUK Ltd",
    brand_name: "DiasporaUK Pay",
    plan: "white_label",
    status: "active",
    primary_color: "#1d4ed8",
    secondary_color: "#10b981",
    accent_color: "#f59e0b",
    default_currency: "GBP",
    default_locale: "en",
    support_email: "support@diasporauk.com",
    max_users: 5000,
    custom_domain: "pay.diasporauk.com",
  },
  {
    slug: "afri-remit",
    name: "AfriRemit Inc",
    brand_name: "AfriRemit",
    plan: "growth",
    status: "trial",
    primary_color: "#059669",
    secondary_color: "#7c3aed",
    accent_color: "#ef4444",
    default_currency: "USD",
    default_locale: "en",
    support_email: "hello@afriremit.com",
    max_users: 1000,
  },
  {
    slug: "naija-pay",
    name: "NaijaPay Technologies",
    brand_name: "NaijaPay",
    plan: "starter",
    status: "active",
    primary_color: "#16a34a",
    secondary_color: "#dc2626",
    accent_color: "#ca8a04",
    default_currency: "NGN",
    default_locale: "en",
    support_email: "info@naijapay.ng",
    max_users: 500,
  },
];

console.log("Seeding tenants...");
for (const tenant of DEMO_TENANTS) {
  await client.query(`
    INSERT INTO tenants (slug, name, brand_name, plan, status, primary_color, secondary_color, accent_color,
      default_currency, default_locale, support_email, max_users, custom_domain, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      brand_name = EXCLUDED.brand_name,
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      primary_color = EXCLUDED.primary_color,
      secondary_color = EXCLUDED.secondary_color,
      accent_color = EXCLUDED.accent_color,
      default_currency = EXCLUDED.default_currency,
      default_locale = EXCLUDED.default_locale,
      support_email = EXCLUDED.support_email,
      max_users = EXCLUDED.max_users,
      custom_domain = EXCLUDED.custom_domain,
      "updatedAt" = NOW()
  `, [
    tenant.slug, tenant.name, tenant.brand_name, tenant.plan, tenant.status,
    tenant.primary_color, tenant.secondary_color, tenant.accent_color,
    tenant.default_currency, tenant.default_locale, tenant.support_email,
    tenant.max_users, tenant.custom_domain ?? null,
  ]);
}
console.log(`  ✓ ${DEMO_TENANTS.length} demo tenants seeded`);

await client.end();
console.log("\n✅ Feature flags and tenants seeded successfully!");
