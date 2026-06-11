/**
 * Feature Flags, Multitenancy & White-Label Router
 * Full CRUD for admin-controlled feature flags, tenant management, and white-label branding.
 */
import { z } from "zod";
import { auditedProcedure, auditedAdminProcedure, rateLimitedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import {
  featureFlags, tenantFeatureFlags, userFeatureFlags,
  tenants, tenantUsers, whiteLabelConfigs,
} from "../../drizzle/schema.js";
import { eq, and, desc, asc, ilike, or, sql, inArray } from "drizzle-orm";

// ─── Canonical list of all platform feature flags ────────────────────────────
const PLATFORM_FLAGS = [
  { key: "send_money",         name: "Send Money",           category: "core",        description: "Allow users to initiate remittance transfers" },
  { key: "receive_money",      name: "Receive Money",        category: "core",        description: "Virtual accounts and QR receive flows" },
  { key: "wallet",             name: "Wallet",               category: "core",        description: "Multi-currency wallet management" },
  { key: "fx_alerts",          name: "FX Rate Alerts",       category: "core",        description: "Set target exchange rate alerts" },
  { key: "rate_lock",          name: "Rate Lock",            category: "core",        description: "Lock an exchange rate for up to 24 hours" },
  { key: "recurring_payments", name: "Recurring Payments",   category: "payments",    description: "Schedule automatic recurring transfers" },
  { key: "batch_payments",     name: "Batch Payments",       category: "payments",    description: "Upload CSV to pay multiple recipients at once" },
  { key: "virtual_cards",      name: "Virtual Cards",        category: "payments",    description: "Issue and manage virtual debit cards" },
  { key: "bill_payments",      name: "Bill Payments",        category: "payments",    description: "Pay utilities, subscriptions, and services" },
  { key: "airtime_data",       name: "Airtime & Data",       category: "payments",    description: "Top up mobile airtime and data bundles" },
  { key: "savings_goals",      name: "Savings Goals",        category: "savings",     description: "Create and track personal savings goals" },
  { key: "investments",        name: "DiasporaVest",         category: "savings",     description: "Invest in African bonds, equities, and real estate" },
  { key: "community_funds",    name: "Community Funds",      category: "community",   description: "Create and join diaspora community savings pools" },
  { key: "family_dashboard",   name: "Family Dashboard",     category: "community",   description: "Manage family members and shared budgets" },
  { key: "talent_bridge",      name: "TalentBridge",         category: "community",   description: "Diaspora talent marketplace" },
  { key: "referral_program",   name: "Referral Program",     category: "community",   description: "Earn rewards for referring new users" },
  { key: "marketplace",        name: "AfriMarket",           category: "commerce",    description: "Buy and sell goods in the diaspora marketplace" },
  { key: "pos_agents",         name: "POS & Agents",         category: "commerce",    description: "Find and use POS terminals and cash agents" },
  { key: "bnpl",               name: "Buy Now Pay Later",    category: "credit",      description: "Split purchases into installment payments" },
  { key: "stablecoin",         name: "Stablecoin Swap",      category: "crypto",      description: "Swap between fiat and stablecoins (USDC, USDT)" },
  { key: "cbdc",               name: "CBDC Wallet",          category: "crypto",      description: "Central Bank Digital Currency integration" },
  { key: "mojaloop",           name: "Mojaloop Transfers",   category: "interop",     description: "Interoperability with M-Pesa, MTN MoMo, Orange Money" },
  { key: "kyc_biometric",      name: "Biometric KYC",        category: "compliance",  description: "Facial recognition and liveness check for KYC" },
  { key: "ai_assistant",       name: "AI Assistant",         category: "ai",          description: "Conversational AI for transfer help and insights" },
  { key: "analytics_dashboard",name: "Analytics Dashboard",  category: "insights",    description: "Spend analytics, charts, and reports" },
  { key: "corridor_pricing",   name: "Corridor Pricing",     category: "insights",    description: "Compare rates across corridors and providers" },
  { key: "dispute_resolution", name: "Dispute Resolution",   category: "support",     description: "File and track transaction disputes" },
  { key: "live_chat",          name: "Live Chat Support",    category: "support",     description: "Real-time chat with support agents" },
  { key: "direct_debit",       name: "Direct Debit",         category: "payments",    description: "Set up direct debit mandates for recurring bills" },
  { key: "beyond_remittance",  name: "Beyond Remittance",    category: "premium",     description: "Premium investment and wealth management features" },
] as const;

// ─── Feature Flags Router ────────────────────────────────────────────────────
export const featureFlagsRouter = router({
  // List all flags (admin sees all; users see their effective state)
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      tenantId: z.number().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Ensure platform flags are seeded
      await seedPlatformFlags(db);

      let query = db.select().from(featureFlags).orderBy(asc(featureFlags.category), asc(featureFlags.name));

      const rows = await query;

      // If tenantId provided, overlay tenant overrides
      let tenantOverrides: Record<number, boolean> = {};
      if (input?.tenantId) {
        const overrides = await db.select()
          .from(tenantFeatureFlags)
          .where(eq(tenantFeatureFlags.tenantId, input.tenantId));
        for (const o of overrides) {
          tenantOverrides[o.flagId] = o.enabled;
        }
      }

      // If regular user, overlay user overrides
      let userOverrides: Record<number, boolean> = {};
      const userOverrideRows = await db.select()
        .from(userFeatureFlags)
        .where(eq(userFeatureFlags.userId, ctx.user.id));
      for (const o of userOverrideRows) {
        userOverrides[o.flagId] = o.enabled;
      }

      return rows
        .filter((f: any) => {
          if (input?.category && f.category !== input.category) return false;
          if (input?.search) {
            const s = input.search.toLowerCase();
            return f.name.toLowerCase().includes(s) || f.key.toLowerCase().includes(s) || (f.description ?? "").toLowerCase().includes(s);
          }
          return true;
        })
        .map((f: any) => ({
          ...f,
          effectiveEnabled: userOverrides[f.id] ?? tenantOverrides[f.id] ?? f.defaultEnabled,
          tenantOverride: tenantOverrides[f.id] ?? null,
          userOverride: userOverrides[f.id] ?? null,
        }));
    }),

  // Check a single flag by key (used by frontend to gate features)
  check: protectedProcedure
    .input(z.object({ key: z.string(), tenantId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" }); // fail open

      const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.key, input.key)).limit(1);
      if (!flag) return { enabled: true }; // unknown flags default to enabled

      // Check user override first
      const [userOverride] = await db.select().from(userFeatureFlags)
        .where(and(eq(userFeatureFlags.userId, ctx.user.id), eq(userFeatureFlags.flagId, flag.id)))
        .limit(1);
      if (userOverride) return { enabled: userOverride.enabled };

      // Check tenant override
      if (input.tenantId) {
        const [tenantOverride] = await db.select().from(tenantFeatureFlags)
          .where(and(eq(tenantFeatureFlags.tenantId, input.tenantId), eq(tenantFeatureFlags.flagId, flag.id)))
          .limit(1);
        if (tenantOverride) return { enabled: tenantOverride.enabled };
      }

      // Rollout percentage check
      if (flag.rolloutPct < 100) {
        const hash = (ctx.user.id * 2654435761) % 100;
        return { enabled: hash < flag.rolloutPct };
      }

      return { enabled: flag.defaultEnabled };
    }),

  // Admin: toggle a flag globally
  toggle: adminProcedure
    .input(z.object({
      flagId: z.number(),
      enabled: z.boolean(),
      rolloutPct: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [_row] = await db.update(featureFlags)
        .set({
          defaultEnabled: input.enabled,
          ...(input.rolloutPct !== undefined ? { rolloutPct: input.rolloutPct } : {}),
          updatedAt: new Date(),
        })
        .where(eq(featureFlags.id, input.flagId))
        .returning();
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Feature flag not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Admin: set tenant-level override
  setTenantOverride: adminProcedure
    .input(z.object({
      tenantId: z.number(),
      flagId: z.number(),
      enabled: z.boolean(),
      reason: z.string().max(2000).optional(),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Upsert
      const existing = await db.select().from(tenantFeatureFlags)
        .where(and(eq(tenantFeatureFlags.tenantId, input.tenantId), eq(tenantFeatureFlags.flagId, input.flagId)))
        .limit(1);
      let _row: any;
      if (existing.length > 0) {
        [_row] = await db.update(tenantFeatureFlags)
          .set({ enabled: input.enabled, reason: input.reason ?? null, overriddenBy: ctx.user.id, updatedAt: new Date(), expiresAt: input.expiresAt ? new Date(input.expiresAt) : null })
          .where(eq(tenantFeatureFlags.id, existing[0].id)).returning();
      } else {
        [_row] = await db.insert(tenantFeatureFlags).values({
          tenantId: input.tenantId, flagId: input.flagId, enabled: input.enabled,
          reason: input.reason ?? null, overriddenBy: ctx.user.id,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        }).returning();
      }
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Admin: remove tenant override (revert to global default)
  removeTenantOverride: adminProcedure
    .input(z.object({ tenantId: z.number(), flagId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const deleted = await db.delete(tenantFeatureFlags)
        .where(and(eq(tenantFeatureFlags.tenantId, input.tenantId), eq(tenantFeatureFlags.flagId, input.flagId)))
        .returning();
      if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant override not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Admin: set user-level override (beta access, early access)
  setUserOverride: adminProcedure
    .input(z.object({ userId: z.number(), flagId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const existing = await db.select().from(userFeatureFlags)
        .where(and(eq(userFeatureFlags.userId, input.userId), eq(userFeatureFlags.flagId, input.flagId))).limit(1);
      let _row: any;
      if (existing.length > 0) {
        [_row] = await db.update(userFeatureFlags).set({ enabled: input.enabled }).where(eq(userFeatureFlags.id, existing[0].id)).returning();
      } else {
        [_row] = await db.insert(userFeatureFlags).values({ userId: input.userId, flagId: input.flagId, enabled: input.enabled }).returning();
      }
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Admin: create or update a custom flag
  upsert: adminProcedure
    .input(z.object({
      id: z.number().optional(),
      key: z.string().min(2).max(100),
      name: z.string().min(2).max(255),
      description: z.string().max(2000).optional(),
      scope: z.enum(["global", "tenant", "user"]).default("global"),
      defaultEnabled: z.boolean().default(true),
      rolloutPct: z.number().min(0).max(100).default(100),
      category: z.string().default("feature"),
      tags: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.id) {
        const [_row] = await db.update(featureFlags).set({ ...input, updatedAt: new Date() }).where(eq(featureFlags.id, input.id)).returning();
        if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
        return { id: input.id };
      } else {
        const [row] = await db.insert(featureFlags).values({ ...input }).returning({ id: featureFlags.id }).returning();
        return { id: row.id };
      }
    }),

  // Admin: delete a custom flag
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const _deleted = await db.delete(featureFlags).where(eq(featureFlags.id, input.id)).returning();
      if (_deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Get categories for filter UI
  categories: protectedProcedure.query(async () => {
    return Array.from(new Set(PLATFORM_FLAGS.map(f => f.category)));
  }),

  // ── getNavFlags ──────────────────────────────────────────────────────────────
  // Resolves which nav feature keys are enabled for the current user.
  // Resolution order (highest priority wins):
  //   1. User-level override  (admin-granted beta / suspension)
  //   2. Tenant-level override (tenant admin toggle)
  //   3. Tenant plan gate     (starter < growth < enterprise < white_label)
  //   4. Role-based rule      (admin / user)
  //   5. KYC tier rule        (some features need tier2+)
  //   6. Global defaultEnabled + rollout %
  getNavFlags: protectedProcedure.query(async ({ ctx }) => {
    const PLAN_RANK: Record<string, number> = { starter: 0, growth: 1, enterprise: 2, white_label: 3 };
    const KYC_RANK:  Record<string, number> = { tier0: 0, tier1: 1, tier2: 2, tier3: 3 };

    // Nav feature rules: key -> { requiredRoles?, requiredKycTier?, requiredPlan? }
    const NAV_RULES: Record<string, { requiredRoles?: string[]; requiredKycTier?: string; requiredPlan?: string }> = {
      // Core
      send_money:               { requiredRoles: ["user","admin"], requiredKycTier: "tier1" },
      receive_money:            { requiredRoles: ["user","admin"] },
      wallet:                   { requiredRoles: ["user","admin"] },
      transactions:             { requiredRoles: ["user","admin"] },
      beneficiaries:            { requiredRoles: ["user","admin"] },
      qr_pay:                   { requiredRoles: ["user","admin"] },
      split_bill:               { requiredRoles: ["user","admin"] },
      // Payments
      batch_payments:           { requiredRoles: ["user","admin"], requiredPlan: "growth" },
      direct_debit:             { requiredRoles: ["user","admin"] },
      recurring_payments:       { requiredRoles: ["user","admin"] },
      scheduled_transfers:      { requiredRoles: ["user","admin"] },
      airtime_data:             { requiredRoles: ["user","admin"] },
      bill_payments:            { requiredRoles: ["user","admin"] },
      virtual_cards:            { requiredRoles: ["user","admin"] },
      payment_rails:            { requiredRoles: ["user","admin"], requiredPlan: "growth" },
      open_banking:             { requiredRoles: ["user","admin"], requiredPlan: "growth" },
      multi_currency_wallet:    { requiredRoles: ["user","admin"] },
      // FX
      fx_alerts:                { requiredRoles: ["user","admin"] },
      rate_calculator:          { requiredRoles: ["user","admin"] },
      rate_lock:                { requiredRoles: ["user","admin"] },
      fx_streaming:             { requiredRoles: ["user","admin"], requiredPlan: "growth" },
      fx_hedging:               { requiredRoles: ["user","admin"], requiredPlan: "enterprise" },
      fx_calculator:            { requiredRoles: ["user","admin"] },
      // Grow & Save
      savings_goals:            { requiredRoles: ["user","admin"] },
      investments:              { requiredRoles: ["user","admin"], requiredKycTier: "tier2", requiredPlan: "growth" },
      bnpl:                     { requiredRoles: ["user","admin"], requiredKycTier: "tier2" },
      cbdc:                     { requiredRoles: ["user","admin"], requiredPlan: "enterprise" },
      stablecoin:               { requiredRoles: ["user","admin"], requiredPlan: "growth" },
      corridors:                { requiredRoles: ["user","admin"] },
      beyond_remittance:        { requiredRoles: ["user","admin"], requiredPlan: "enterprise" },
      // Community
      community_funds:          { requiredRoles: ["user","admin"] },
      family_dashboard:         { requiredRoles: ["user","admin"] },
      talent_bridge:            { requiredRoles: ["user","admin"] },
      referral_program:         { requiredRoles: ["user","admin"] },
      marketplace:              { requiredRoles: ["user","admin"] },
      leaderboard:              { requiredRoles: ["user","admin"] },
      // Compliance
      kyc_verification:         { requiredRoles: ["user","admin"] },
      gdpr_privacy:             { requiredRoles: ["user","admin"] },
      travel_rule:              { requiredRoles: ["user","admin"] },
      disputes:                 { requiredRoles: ["user","admin"] },
      fraud_detection:          { requiredRoles: ["user","admin"] },
      sanctions_screening:      { requiredRoles: ["user","admin"] },
      compliance_scoring:       { requiredRoles: ["user","admin"] },
      kyc_lifecycle:            { requiredRoles: ["user","admin"] },
      // Account
      settings:                 { requiredRoles: ["user","admin"] },
      support:                  { requiredRoles: ["user","admin"] },
      live_chat:                { requiredRoles: ["user","admin"] },
      onboarding:               { requiredRoles: ["user","admin"] },
      document_vault:           { requiredRoles: ["user","admin"] },
      stripe_receipts:          { requiredRoles: ["user","admin"] },
      // Partners & Business
      partner_apply:            { requiredRoles: ["user","admin"] },
      partner_portal:           { requiredRoles: ["user","admin","partner"] },
      partner_revenue:          { requiredRoles: ["admin"] },
      branding_preview:         { requiredRoles: ["admin"] },
      partner_payouts:          { requiredRoles: ["admin"] },
      merchant_onboarding:      { requiredRoles: ["admin","partner"] },
      pos_agents:               { requiredRoles: ["user","admin"] },
      agent_network:            { requiredRoles: ["admin"] },
      // Developer
      webhooks:                 { requiredRoles: ["user","admin"] },
      api_keys:                 { requiredRoles: ["user","admin"] },
      mobile_sdk:               { requiredRoles: ["user","admin"] },
      developer_sandbox:        { requiredRoles: ["user","admin"] },
      api_usage:                { requiredRoles: ["user","admin"] },
      push_notifications:       { requiredRoles: ["user","admin"] },
      sandbox_scenarios:        { requiredRoles: ["admin"] },
      pwa_dashboard:            { requiredRoles: ["user","admin"] },
      // Admin-only
      admin_overview:           { requiredRoles: ["admin"] },
      admin_analytics:          { requiredRoles: ["admin"] },
      admin_users:              { requiredRoles: ["admin"] },
      admin_kyc:                { requiredRoles: ["admin"] },
      admin_compliance:         { requiredRoles: ["admin"] },
      admin_audit_log:          { requiredRoles: ["admin"] },
      admin_microservices:      { requiredRoles: ["admin"] },
      admin_corridor:           { requiredRoles: ["admin"] },
      admin_feature_flags:      { requiredRoles: ["admin"] },
      admin_tenants:            { requiredRoles: ["admin"] },
      admin_white_label:        { requiredRoles: ["admin"] },
      admin_tenant_flags:       { requiredRoles: ["admin"] },
      admin_revenue_share:      { requiredRoles: ["admin"] },
      admin_chat_agent:         { requiredRoles: ["admin"] },
      admin_agreements:         { requiredRoles: ["admin"] },
      admin_system_config:      { requiredRoles: ["admin"] },
      admin_bulk_actions:       { requiredRoles: ["admin"] },
      admin_beneficiaries:      { requiredRoles: ["admin"] },
      admin_promo_codes:        { requiredRoles: ["admin"] },
      admin_webhooks:           { requiredRoles: ["admin"] },
      admin_api_keys:           { requiredRoles: ["admin"] },
      admin_velocity:           { requiredRoles: ["admin"] },
      admin_payment_history:    { requiredRoles: ["admin"] },
      admin_security_audit:     { requiredRoles: ["admin"] },
      admin_lakehouse:          { requiredRoles: ["admin"] },
      admin_attack_sim:         { requiredRoles: ["admin"] },
      admin_compliance_email:   { requiredRoles: ["admin"] },
      admin_ab_testing:         { requiredRoles: ["admin"] },
      admin_partner_apps:       { requiredRoles: ["admin"] },
      admin_partner_payouts:    { requiredRoles: ["admin"] },
      admin_watchlist:          { requiredRoles: ["admin"] },
      admin_compliance_metrics: { requiredRoles: ["admin"] },
      admin_kyc_queue:          { requiredRoles: ["admin"] },
      admin_kyc_lifecycle:      { requiredRoles: ["admin"] },
      admin_regulatory:         { requiredRoles: ["admin"] },
      admin_aml_batch:          { requiredRoles: ["admin"] },
      admin_cross_border:       { requiredRoles: ["admin"] },
      admin_merchant_kyb:       { requiredRoles: ["admin"] },
      admin_doc_ocr:            { requiredRoles: ["admin"] },
      admin_treasury:           { requiredRoles: ["admin"] },
      admin_liquidity_stress:   { requiredRoles: ["admin"] },
      admin_liquidity:          { requiredRoles: ["admin"] },
      admin_sla:                { requiredRoles: ["admin"] },
      admin_chargebacks:        { requiredRoles: ["admin"] },
      admin_security_events:    { requiredRoles: ["admin"] },
      admin_fee_rules:          { requiredRoles: ["admin"] },
      admin_fee_crud:           { requiredRoles: ["admin"] },
      admin_fee_negotiation:    { requiredRoles: ["admin"] },
      admin_transfer_audit:     { requiredRoles: ["admin"] },
      admin_smart_routing:      { requiredRoles: ["admin"] },
      admin_multi_hop:          { requiredRoles: ["admin"] },
      admin_transfer_limits:    { requiredRoles: ["admin"] },
      admin_reconciliation:     { requiredRoles: ["admin"] },
      admin_system_health:      { requiredRoles: ["admin"] },
      admin_fx_options:         { requiredRoles: ["admin"] },
      admin_settlement_netting: { requiredRoles: ["admin"] },
      admin_realtime:           { requiredRoles: ["admin"] },
      admin_grafana:            { requiredRoles: ["admin"] },
      admin_revenue_analytics:  { requiredRoles: ["admin"] },
      admin_analytics_overview: { requiredRoles: ["admin"] },
      admin_webhook_retry:      { requiredRoles: ["admin"] },
      admin_tenant_config:      { requiredRoles: ["admin"] },
      admin_swift:              { requiredRoles: ["admin"] },
      admin_loyalty:            { requiredRoles: ["admin"] },
      admin_carbon:             { requiredRoles: ["admin"] },
      admin_notification_center:{ requiredRoles: ["admin"] },
      admin_audit_trail:        { requiredRoles: ["admin"] },
      admin_data_pipelines:     { requiredRoles: ["admin"] },
      admin_ledger:             { requiredRoles: ["admin"] },
      admin_nav_analytics:      { requiredRoles: ["admin"] },
      admin_ai_hub:             { requiredRoles: ["admin"] },
      admin_vector_search:      { requiredRoles: ["admin"] },
      admin_knowledge_graph:    { requiredRoles: ["admin"] },
      admin_ollama:             { requiredRoles: ["admin"] },
      admin_art_agent:          { requiredRoles: ["admin"] },
      admin_kgqa:               { requiredRoles: ["admin"] },
      admin_lakehouse_db:       { requiredRoles: ["admin"] },
      admin_cocoindex:          { requiredRoles: ["admin"] },
      admin_similar_tx:         { requiredRoles: ["admin"] },
      admin_ai_metrics:         { requiredRoles: ["admin"] },
    };

    const userRole    = ctx.user.role ?? "user";
    const userKycTier = (ctx.user as any).kycTier ?? "tier0";

    // Fetch tenant membership + plan
    let tenantPlan = "starter";
    let tenantId: number | null = null;
    const db = await getDb();
    if (db) {
      try {
        const membership = await db.select({ tenantId: tenantUsers.tenantId })
          .from(tenantUsers).where(eq(tenantUsers.userId, ctx.user.id)).limit(1);
        if (membership.length > 0) {
          tenantId = membership[0].tenantId;
          const [t] = await db.select({ plan: tenants.plan })
            .from(tenants).where(eq(tenants.id, tenantId!)).limit(1);
          if (t) tenantPlan = t.plan;
        }
      } catch { /* no tenant — use defaults */ }
    }

    // Bulk-fetch DB flags + overrides
    const dbFlagMap: Record<string, boolean> = {};
    if (db) {
      try {
        const allFlags = await db.select().from(featureFlags);
        const userOvRows = await db.select().from(userFeatureFlags)
          .where(eq(userFeatureFlags.userId, ctx.user.id));
        const userOv: Record<number, boolean> = {};
        for (const o of userOvRows) userOv[o.flagId] = o.enabled;
        const tenantOv: Record<number, boolean> = {};
        if (tenantId) {
          const tOvRows = await db.select().from(tenantFeatureFlags)
            .where(eq(tenantFeatureFlags.tenantId, tenantId));
          for (const o of tOvRows) {
            if (!o.expiresAt || o.expiresAt > new Date()) tenantOv[o.flagId] = o.enabled;
          }
        }
        for (const f of allFlags) {
          if (userOv[f.id] !== undefined)   { dbFlagMap[f.key] = userOv[f.id];   continue; }
          if (tenantOv[f.id] !== undefined) { dbFlagMap[f.key] = tenantOv[f.id]; continue; }
          if (f.rolloutPct < 100) {
            const hash = (ctx.user.id * 2654435761) % 100;
            dbFlagMap[f.key] = hash < f.rolloutPct;
          } else {
            dbFlagMap[f.key] = f.defaultEnabled;
          }
        }
      } catch { /* fail open */ }
    }

    // Resolve each nav key
    const result: Record<string, boolean> = {};
    for (const [key, rules] of Object.entries(NAV_RULES)) {
      // 1. Role check
      if (rules.requiredRoles && !rules.requiredRoles.includes(userRole)) {
        result[key] = false; continue;
      }
      // 2. KYC tier check
      if (rules.requiredKycTier) {
        if ((KYC_RANK[userKycTier] ?? 0) < (KYC_RANK[rules.requiredKycTier] ?? 0)) {
          result[key] = false; continue;
        }
      }
      // 3. Tenant plan check (admins bypass)
      if (rules.requiredPlan && userRole !== "admin") {
        if ((PLAN_RANK[tenantPlan] ?? 0) < (PLAN_RANK[rules.requiredPlan] ?? 0)) {
          result[key] = false; continue;
        }
      }
      // 4. DB flag (default true if not seeded yet)
      result[key] = dbFlagMap[key] ?? true;
    }
    return result;
  }),
});

// ─── Tenants Router ──────────────────────────────────────────────────────────
export const tenantsRouter = router({
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(["active", "suspended", "trial", "churned"]).optional(),
      plan: z.enum(["starter", "growth", "enterprise", "white_label"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(input?.limit ?? 20).offset(input?.offset ?? 0);
      const total = await db.select({ count: sql<number>`count(*)` }).from(tenants);
      return { tenants: rows, total: Number(total[0]?.count ?? 0) };
    }),

  get: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.id)).limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const members = await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, input.id));
      const flags = await db.select().from(tenantFeatureFlags).where(eq(tenantFeatureFlags.tenantId, input.id));
      const wlConfig = await db.select().from(whiteLabelConfigs).where(eq(whiteLabelConfigs.tenantId, input.id)).limit(1);
      return { ...tenant, memberCount: members.length, flagOverrides: flags.length, whiteLabelConfig: wlConfig[0] ?? null };
    }),

  create: adminProcedure
    .input(z.object({
      slug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
      name: z.string().min(2).max(255),
      plan: z.enum(["starter", "growth", "enterprise", "white_label"]).default("starter"),
      ownerId: z.number().optional(),
      brandName: z.string().optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      defaultCurrency: z.string().length(3).default("USD"),
      defaultLocale: z.string().default("en"),
      supportEmail: z.string().email().optional(),
      maxUsers: z.number().default(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.insert(tenants).values({ ...input, status: "trial" }).returning({ id: tenants.id }).returning();
      return { id: row.id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().max(2000).optional(),
      plan: z.enum(["starter", "growth", "enterprise", "white_label"]).optional(),
      status: z.enum(["active", "suspended", "trial", "churned"]).optional(),
      brandName: z.string().optional(),
      logoUrl: z.string().url().optional(),
      faviconUrl: z.string().url().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      supportEmail: z.string().email().optional(),
      supportUrl: z.string().url().optional(),
      customDomain: z.string().optional(),
      defaultCurrency: z.string().optional(),
      defaultLocale: z.string().optional(),
      maxUsers: z.number().optional(),
      maxMonthlyVolume: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { id, ...data } = input;
      const [_row] = await db.update(tenants).set({ ...data, updatedAt: new Date() }).where(eq(tenants.id, id)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });

      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  suspend: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [_row] = await db.update(tenants).set({ status: "suspended", updatedAt: new Date() }).where(eq(tenants.id, input.id)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });

      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  activate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [_row] = await db.update(tenants).set({ status: "active", updatedAt: new Date() }).where(eq(tenants.id, input.id)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });

      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const _deleted = await db.delete(tenants).where(eq(tenants.id, input.id)).returning();
      if (_deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  addMember: adminProcedure
    .input(z.object({ tenantId: z.number(), userId: z.number(), role: z.enum(["member", "admin", "owner"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.insert(tenantUsers).values(input).onConflictDoNothing().returning();
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  removeMember: adminProcedure
    .input(z.object({ tenantId: z.number(), userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const _deleted = await db.delete(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, input.userId))).returning();
      if (_deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Stats for admin dashboard
  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db.select({ status: tenants.status, plan: tenants.plan, count: sql<number>`count(*)` })
      .from(tenants).groupBy(tenants.status, tenants.plan);
    const total = rows.reduce((s: any, r: any) => s + Number(r.count), 0);
    const active = rows.filter((r: any) => r.status === "active").reduce((s: any, r: any) => s + Number(r.count), 0);
    const trial = rows.filter((r: any) => r.status === "trial").reduce((s: any, r: any) => s + Number(r.count), 0);
    const enterprise = rows.filter((r: any) => r.plan === "enterprise" || r.plan === "white_label").reduce((s: any, r: any) => s + Number(r.count), 0);
    return { total, active, trial, enterprise };
  }),
});

// ─── White-Label Router ──────────────────────────────────────────────────────
export const whiteLabelRouter = router({
  get: adminProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [config] = await db.select().from(whiteLabelConfigs).where(eq(whiteLabelConfigs.tenantId, input.tenantId)).limit(1);
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      return { config: config ?? null, tenant: tenant ?? null };
    }),

  upsert: adminProcedure
    .input(z.object({
      tenantId: z.number(),
      onboardingSteps: z.array(z.object({
        id: z.string(), label: z.string(), required: z.boolean(), order: z.number(), enabled: z.boolean(),
      })).optional(),
      navSections: z.array(z.string()).optional(),
      termsUrl: z.string().url().optional().nullable(),
      privacyUrl: z.string().url().optional().nullable(),
      welcomeEmailSubject: z.string().optional(),
      welcomeEmailBody: z.string().optional(),
      showPoweredBy: z.boolean().optional(),
      allowSelfRegistration: z.boolean().optional(),
      requireInviteCode: z.boolean().optional(),
      gaTrackingId: z.string().optional().nullable(),
      intercomAppId: z.string().optional().nullable(),
      // Branding (stored on tenant table)
      brandName: z.string().optional(),
      logoUrl: z.string().url().optional().nullable(),
      faviconUrl: z.string().url().optional().nullable(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      supportEmail: z.string().email().optional().nullable(),
      customDomain: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { tenantId, brandName, logoUrl, faviconUrl, primaryColor, secondaryColor, accentColor, supportEmail, customDomain, ...configData } = input;

      // Update tenant branding
      const brandingUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (brandName !== undefined) brandingUpdate.brandName = brandName;
      if (logoUrl !== undefined) brandingUpdate.logoUrl = logoUrl;
      if (faviconUrl !== undefined) brandingUpdate.faviconUrl = faviconUrl;
      if (primaryColor !== undefined) brandingUpdate.primaryColor = primaryColor;
      if (secondaryColor !== undefined) brandingUpdate.secondaryColor = secondaryColor;
      if (accentColor !== undefined) brandingUpdate.accentColor = accentColor;
      if (supportEmail !== undefined) brandingUpdate.supportEmail = supportEmail;
      if (customDomain !== undefined) brandingUpdate.customDomain = customDomain;
      await db.update(tenants).set(brandingUpdate).where(eq(tenants.id, tenantId)).returning();

      // Upsert white-label config
      const [existing] = await db.select().from(whiteLabelConfigs).where(eq(whiteLabelConfigs.tenantId, tenantId)).limit(1);
      let _row: any;
      if (existing) {
        [_row] = await db.update(whiteLabelConfigs).set({ ...configData, updatedAt: new Date() }).where(eq(whiteLabelConfigs.id, existing.id)).returning();
      } else {
        await db.insert(whiteLabelConfigs).values({ tenantId, ...configData }).returning();
      }
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Get effective branding for a given slug/domain (used by frontend on load)
  getBranding: protectedProcedure
    .input(z.object({ slug: z.string().optional(), domain: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      let query;
      if (input.slug) {
        query = db.select().from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
      } else if (input.domain) {
        query = db.select().from(tenants).where(eq(tenants.customDomain, input.domain)).limit(1);
      } else {
        return null;
      }
      const [tenant] = await query;
      if (!tenant) return null;
      const [config] = await db.select().from(whiteLabelConfigs).where(eq(whiteLabelConfigs.tenantId, tenant.id)).limit(1);
      return {
        brandName: tenant.brandName ?? "RemitFlow",
        logoUrl: tenant.logoUrl,
        faviconUrl: tenant.faviconUrl,
        primaryColor: tenant.primaryColor ?? "#7c3aed",
        secondaryColor: tenant.secondaryColor ?? "#06b6d4",
        accentColor: tenant.accentColor ?? "#f59e0b",
        supportEmail: tenant.supportEmail,
        showPoweredBy: config?.showPoweredBy ?? true,
        navSections: config?.navSections ?? [],
        onboardingSteps: config?.onboardingSteps ?? [],
      };
    }),
});

// ─── Helper: seed platform flags if not yet in DB ────────────────────────────
async function seedPlatformFlags(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) return;
  for (const f of PLATFORM_FLAGS) {
    try {
      await db.insert(featureFlags).values({
        key: f.key, name: f.name, description: f.description,
        scope: "global", defaultEnabled: true, rolloutPct: 100, category: f.category,
      }).onConflictDoNothing().returning();
    } catch { /* already exists */ }
  }
}
