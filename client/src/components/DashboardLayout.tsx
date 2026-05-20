import { useAuth } from "@/_core/hooks/useAuth";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { ConnectionHealthBanner } from "@/components/ConnectionHealthBanner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, LogOut, Users, Wallet2, ArrowUpRight, ArrowDownLeft,
  List, BarChart2, BarChart3, RefreshCw, Bell, Repeat, CreditCard, PiggyBank, Receipt,
  Smartphone, Shield, FileText, Gift, Settings2, HelpCircle, MessageCircle, UserCog,
  ShieldCheck, Activity, TrendingUp, Target, Briefcase, Heart, Cpu, ShoppingBag,
  Globe, Trophy, LineChart, ChevronDown, ChevronRight, Search, Command, Sun, Moon,
  User, CheckCircle2, Circle, ArrowRight, Home, Zap, Building2, Landmark, Flag,
  Scale, Coins, Network, Route, Palette, SplitSquareHorizontal, AlertTriangle, Banknote, QrCode, Calculator, Layers,
  DollarSign, Webhook, Key, ListFilter, Sliders, Rocket, PieChart,
  FlaskConical, GitBranch, ShieldAlert, Tag, CalendarClock,
  Brain, Database, MessageSquare, Wrench, BrainCircuit,
  BookOpen, Wind, FileCheck,
  Radio, TrendingDown, CreditCard as CardIcon, Landmark as BankIcon,
  BarChart, AlertOctagon, Gauge, Tv2, ToggleLeft, Droplets, Store, Leaf, Star, Repeat2, Settings, Monitor} from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NotificationBell } from "./NotificationBell";
import { ChatWidget } from "./ChatWidget";
import { GlobalMobileNav } from "./GlobalMobileNav";
import { OfflineQueueBanner } from "./OfflineQueueBanner";
import { SessionTimeout } from "./SessionTimeout";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { trpc } from "@/lib/trpc";

// ─── NAV GROUP DEFINITIONS ────────────────────────────────────────────────────
type NavItem = {
  icon: React.ElementType;
  label: string;
  path: string;
  adminOnly?: true;
  partnerOnly?: true;    // visible to partner or admin roles
  featureKey?: string;   // matches NAV_RULES key in featureFlags router
  secondary?: true;      // shown only when user expands "More" in the group
};

type NavGroup = {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
  adminOnly?: true;
};

const NAV_GROUPS: NavGroup[] = [
  // ── 1. HOME ───────────────────────────────────────────────────────────────
  {
    id: "home",
    label: "Home",
    icon: LayoutDashboard,
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    ],
  },
  // ── 2. MONEY & PAYMENTS ───────────────────────────────────────────────────
  {
    id: "money",
    label: "Money & Payments",
    icon: Wallet2,
    items: [
      { icon: Wallet2,              label: "Wallet",              path: "/wallet",              featureKey: "wallet" },
      { icon: ArrowUpRight,         label: "Send Money",          path: "/send",                featureKey: "send_money" },
      { icon: ArrowDownLeft,        label: "Receive",             path: "/receive",             featureKey: "receive_money" },
      { icon: List,                 label: "Transactions",        path: "/transactions",        featureKey: "transactions" },
      { icon: Users,                label: "Beneficiaries",       path: "/beneficiaries",       featureKey: "beneficiaries" },
      { icon: CreditCard,           label: "Cards",               path: "/cards",               featureKey: "virtual_cards" },
      { icon: Receipt,              label: "Bills",               path: "/bills",               featureKey: "bill_payments" },
      { icon: Smartphone,           label: "Airtime & Data",      path: "/airtime",             featureKey: "airtime_data" },
      // secondary
      { icon: QrCode,               label: "QR Pay",              path: "/qr-code",             featureKey: "qr_pay",              secondary: true },
      { icon: Users,                label: "Split Bill",          path: "/split-bill",          featureKey: "split_bill",          secondary: true },
      { icon: SplitSquareHorizontal,label: "Batch Payments",      path: "/batch-payments",      featureKey: "batch_payments",      secondary: true },
      { icon: Banknote,             label: "Direct Debit",        path: "/direct-debit",        featureKey: "direct_debit",        secondary: true },
      { icon: Repeat,               label: "Recurring Payments",  path: "/recurring",           featureKey: "recurring_payments",  secondary: true },
      { icon: CalendarClock,        label: "Scheduled Transfers", path: "/scheduled-transfers", featureKey: "scheduled_transfers", secondary: true },
      { icon: BankIcon,             label: "Payment Rails",       path: "/payment-rails",       featureKey: "payment_rails",       secondary: true },
      { icon: CardIcon,             label: "Open Banking",        path: "/open-banking",        featureKey: "open_banking",        secondary: true },
      { icon: Wallet2,              label: "Multi-Currency",      path: "/wallet/multi-currency-v2", featureKey: "multi_currency_wallet", secondary: true },
    ],
  },
  // ── 3. FX & RATES ─────────────────────────────────────────────────────────
  {
    id: "fx",
    label: "FX & Rates",
    icon: RefreshCw,
    items: [
      { icon: RefreshCw,    label: "Exchange Rates",  path: "/exchange",        featureKey: "fx_alerts" },
      { icon: Bell,         label: "FX Alerts",       path: "/fx-alerts",       featureKey: "fx_alerts" },
      { icon: Calculator,   label: "Rate Calculator", path: "/calculator",      featureKey: "rate_calculator" },
      { icon: Layers,       label: "Rate Lock",       path: "/rate-lock",       featureKey: "rate_lock" },
      { icon: Calculator,   label: "FX Calculator",   path: "/fx-calculator",   featureKey: "fx_calculator" },
      // secondary
      { icon: TrendingDown, label: "FX Streaming",    path: "/fx-streaming",    featureKey: "fx_streaming",  secondary: true },
      { icon: TrendingUp,   label: "FX Hedging",      path: "/fx-hedging",      featureKey: "fx_hedging",    secondary: true },
    ],
  },
  // ── 4. GROW & SAVE ────────────────────────────────────────────────────────
  {
    id: "grow",
    label: "Grow & Save",
    icon: TrendingUp,
    items: [
      { icon: PiggyBank,  label: "Savings",         path: "/savings",          featureKey: "savings_goals" },
      { icon: Target,     label: "Savings Goals",   path: "/goals",            featureKey: "savings_goals" },
      { icon: Route,      label: "Corridors",       path: "/corridors",        featureKey: "corridors" },
      { icon: TrendingUp, label: "DiasporaVest",    path: "/invest",           featureKey: "investments" },
      { icon: LineChart,  label: "Beyond Remittance",path: "/beyond-remittance",featureKey: "beyond_remittance" },
      // secondary
      { icon: Coins,      label: "BNPL",            path: "/bnpl",             featureKey: "bnpl",          secondary: true },
      { icon: Landmark,   label: "CBDC",            path: "/cbdc",             featureKey: "cbdc",          secondary: true },
      { icon: Zap,        label: "Stablecoin",      path: "/stablecoin",       featureKey: "stablecoin",    secondary: true },
      { icon: PieChart,   label: "My Portfolio",    path: "/invest/portfolio", featureKey: "investments",   secondary: true },
      { icon: BarChart3,  label: "NGX Stocks",      path: "/invest/stocks",    featureKey: "investments",   secondary: true },
      { icon: Home,       label: "Real Estate",     path: "/invest/real-estate",featureKey: "investments",  secondary: true },
      { icon: Rocket,     label: "Startups",        path: "/invest/startups",  featureKey: "investments",   secondary: true },
    ],
  },
  // ── 5. COMMUNITY ──────────────────────────────────────────────────────────
  {
    id: "community",
    label: "Community",
    icon: Heart,
    items: [
      { icon: Heart,       label: "Community Funds",  path: "/community",           featureKey: "community_funds" },
      { icon: Users,       label: "Family Dashboard", path: "/family",              featureKey: "family_dashboard" },
      { icon: Briefcase,   label: "TalentBridge",     path: "/talent",              featureKey: "talent_bridge" },
      { icon: Gift,        label: "Referral Program", path: "/referral",            featureKey: "referral_program" },
      { icon: ShoppingBag, label: "AfriMarket",       path: "/marketplace",         featureKey: "marketplace" },
      // secondary
      { icon: Globe,       label: "Community Hub",    path: "/community-hub",       featureKey: "community_funds",  secondary: true },
      { icon: Trophy,      label: "Leaderboard",      path: "/community/leaderboard",featureKey: "leaderboard",      secondary: true },
      { icon: Gift,        label: "Referral Dashboard",path: "/referral-dashboard", featureKey: "referral_program", secondary: true },
    ],
  },
  // ── 6. COMPLIANCE & IDENTITY ──────────────────────────────────────────────
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldAlert,
    items: [
      { icon: Shield,      label: "KYC Verification",   path: "/kyc",                featureKey: "kyc_verification" },
      { icon: FileText,    label: "GDPR & Privacy",     path: "/gdpr",               featureKey: "gdpr_privacy" },
      { icon: Scale,       label: "Disputes",           path: "/disputes",           featureKey: "disputes" },
      { icon: AlertOctagon,label: "Fraud Detection",    path: "/fraud-detection-v2", featureKey: "fraud_detection" },
      { icon: ShieldCheck, label: "Sanctions Screening",path: "/sanctions-screening",featureKey: "sanctions_screening" },
      // secondary
      { icon: AlertTriangle,label: "Travel Rule",       path: "/travel-rule",        featureKey: "travel_rule",        secondary: true },
      { icon: ShieldCheck, label: "Compliance Scoring", path: "/compliance-scoring", featureKey: "compliance_scoring", secondary: true },
      { icon: Shield,      label: "Compliance Reports", path: "/compliance-reporting",featureKey: "compliance_scoring",secondary: true },
      { icon: FileCheck,   label: "KYC Lifecycle",      path: "/kyc-lifecycle",      featureKey: "kyc_lifecycle",      secondary: true },
      { icon: Building2,    label: "BDC Partner Portal",  path: "/partners/bdc",        featureKey: "bdc_portal",         secondary: true },
      { icon: TrendingUp,   label: "CBN Rate Transparency",path: "/compliance/rates",    featureKey: "cbn_rates",          secondary: true },
      { icon: FileText,    label: "Form M History",      path: "/sme/form-m-history",  featureKey: "form_m_history",     secondary: true },
    ],
  },
  // ── 6b. SME TRADE ───────────────────────────────────────────────────────
  {
    id: "sme-trade",
    label: "SME Trade",
    icon: TrendingUp,
    items: [
      { icon: FileText,    label: "Trade Payments",      path: "/sme/trade-payment",   featureKey: "sme_trade_payment" },
      { icon: ShieldCheck, label: "Form M History",      path: "/sme/form-m-history",  featureKey: "form_m_history" },
    ],
  },
  // ── 7. ACCOUNT ────────────────────────────────────────────────────────────
  {
    id: "account",
    label: "Account",
    icon: User,
    items: [
      { icon: Settings2,   label: "Settings",       path: "/settings",       featureKey: "settings" },
      { icon: HelpCircle,  label: "Support",        path: "/support",        featureKey: "support" },
      { icon: MessageCircle,label: "Live Chat",     path: "/live-chat",      featureKey: "live_chat" },
      { icon: CheckCircle2,label: "Onboarding",     path: "/onboarding",     featureKey: "onboarding" },
      // secondary
      { icon: FileText,    label: "Document Vault", path: "/document-vault", featureKey: "document_vault", secondary: true },
      { icon: Receipt,     label: "Stripe Receipts",path: "/stripe-receipts",featureKey: "stripe_receipts", secondary: true },
    ],
  },
  // ── 8. PARTNERS & BUSINESS ────────────────────────────────────────────────
  {
    id: "partners",
    label: "Partners & Business",
    icon: Building2,
    items: [
      { icon: FileText,      label: "Apply as Partner",   path: "/partners/apply",        featureKey: "partner_apply" },
      { icon: LayoutDashboard,label: "Partner Portal",   path: "/partner/portal",        featureKey: "partner_portal",    partnerOnly: true },
      { icon: Building2,     label: "POS & Agents",       path: "/pos",                   featureKey: "pos_agents" },
      { icon: Store,         label: "Merchant Onboarding",path: "/merchant-onboarding",   featureKey: "merchant_onboarding", partnerOnly: true },
      // secondary (admin-gated)
      { icon: DollarSign,    label: "Revenue Share",      path: "/partner/revenue-share", featureKey: "partner_revenue",    secondary: true },
      { icon: Palette,       label: "Branding Preview",   path: "/partner/branding-preview",featureKey: "branding_preview", secondary: true },
      { icon: DollarSign,    label: "Partner Payouts",    path: "/partner-payouts-v2",    featureKey: "partner_payouts",    secondary: true },
      { icon: Network,       label: "Agent Network",      path: "/agents",                featureKey: "agent_network",      secondary: true },
    ],
  },
  // ── 9. DEVELOPER ──────────────────────────────────────────────────────────
  {
    id: "developer",
    label: "Developer",
    icon: Cpu,
    items: [
      { icon: Webhook,     label: "Webhooks",          path: "/developer/webhooks", featureKey: "webhooks" },
      { icon: Key,         label: "API Keys",           path: "/developer/api-keys", featureKey: "api_keys" },
      { icon: Zap,         label: "Developer Sandbox", path: "/developer-sandbox",  featureKey: "developer_sandbox" },
      { icon: BarChart3,   label: "API Usage",          path: "/api-usage",          featureKey: "api_usage" },
      // secondary
      { icon: Smartphone,  label: "Mobile SDK",         path: "/pwa-features",       featureKey: "mobile_sdk",        secondary: true },
      { icon: Bell,        label: "Push Notifications", path: "/push-notifications", featureKey: "push_notifications",secondary: true },
      { icon: FlaskConical,label: "Sandbox Scenarios",  path: "/sandbox-scenarios",  featureKey: "sandbox_scenarios", secondary: true },
      { icon: LayoutDashboard,label: "PWA Dashboard",   path: "/pwa-dashboard",      featureKey: "pwa_dashboard",     secondary: true },
    ],
  },
  // ── 10. ADMIN (admin only) ─────────────────────────────────────────────────
  {
    id: "admin",
    label: "Admin",
    icon: ShieldCheck,
    adminOnly: true,
    items: [
      // Core Admin — primary (always visible)
      { icon: LayoutDashboard, label: "Overview",       path: "/admin",                  featureKey: "admin_overview",    adminOnly: true },
      { icon: UserCog,         label: "Users",          path: "/admin/users",            featureKey: "admin_users",       adminOnly: true },
      { icon: ShieldCheck,     label: "KYC Review",     path: "/admin/kyc",              featureKey: "admin_kyc",         adminOnly: true },
      { icon: Shield,          label: "Compliance",     path: "/admin/compliance",       featureKey: "admin_compliance",  adminOnly: true },
      { icon: Activity,        label: "Audit Log",      path: "/admin/audit-log",        featureKey: "admin_audit_log",   adminOnly: true },
      { icon: Flag,            label: "Feature Flags",  path: "/admin/feature-flags",    featureKey: "admin_feature_flags",adminOnly: true },
      { icon: Building2,       label: "Tenants",        path: "/admin/tenants",          featureKey: "admin_tenants",     adminOnly: true },
      { icon: Palette,         label: "White Label",    path: "/admin/white-label",      featureKey: "admin_white_label", adminOnly: true },
      { icon: Flag,            label: "Tenant Flags",   path: "/admin/tenant-feature-flags", featureKey: "admin_tenant_flags", adminOnly: true },
      // Secondary Admin
      { icon: BarChart3,       label: "Analytics",      path: "/admin/analytics",        featureKey: "admin_analytics",   adminOnly: true, secondary: true },
      { icon: TrendingUp,      label: "Transfer Analytics", path: "/admin/transfer-analytics", featureKey: "admin_transfer_analytics", adminOnly: true, secondary: true },
      { icon: AlertTriangle,   label: "Disputes",           path: "/admin/disputes",         featureKey: "admin_disputes",         adminOnly: true, secondary: true },
      { icon: Cpu,             label: "Microservices",  path: "/admin/microservices",    featureKey: "admin_microservices",adminOnly: true, secondary: true },
      { icon: Route,           label: "Corridor Pricing",path: "/admin/corridor-pricing",featureKey: "admin_corridor",    adminOnly: true, secondary: true },
      { icon: DollarSign,      label: "Revenue Share",  path: "/admin/revenue-share",    featureKey: "admin_revenue_share",adminOnly: true, secondary: true },
      { icon: MessageSquare,   label: "Chat Agent",     path: "/admin/chat-agent",       featureKey: "admin_chat_agent",  adminOnly: true, secondary: true },
      { icon: FileCheck,       label: "Digital Agreements",path: "/admin/digital-agreements",featureKey: "admin_agreements",adminOnly: true, secondary: true },
      { icon: Sliders,         label: "System Config",  path: "/admin/system-config",    featureKey: "admin_system_config",adminOnly: true, secondary: true },
      { icon: Users,           label: "Bulk Actions",   path: "/admin/bulk-actions",     featureKey: "admin_bulk_actions",adminOnly: true, secondary: true },
      { icon: Users,           label: "Beneficiary Mgr",path: "/admin/beneficiaries",    featureKey: "admin_beneficiaries",adminOnly: true, secondary: true },
      { icon: Tag,             label: "Promo Codes",    path: "/admin/promo-codes",      featureKey: "admin_promo_codes", adminOnly: true, secondary: true },
      { icon: Webhook,         label: "Webhooks Admin", path: "/admin/webhooks",         featureKey: "admin_webhooks",    adminOnly: true, secondary: true },
      { icon: Key,             label: "API Keys Admin", path: "/admin/api-keys",         featureKey: "admin_api_keys",    adminOnly: true, secondary: true },
      { icon: Zap,             label: "Velocity Checks",path: "/admin/velocity-checks",  featureKey: "admin_velocity",    adminOnly: true, secondary: true },
      // Compliance Admin (secondary)
      { icon: Receipt,      label: "Payment History",     path: "/payments/history",              featureKey: "admin_payment_history",   adminOnly: true, secondary: true },
      { icon: ShieldCheck,  label: "Security Audit",      path: "/admin/security-audit",          featureKey: "admin_security_audit",    adminOnly: true, secondary: true },
      { icon: ShieldAlert,  label: "Security Dashboard",  path: "/admin/security-dashboard",      featureKey: "admin_security_dashboard",adminOnly: true, secondary: true },
      { icon: Activity,     label: "Services Health",     path: "/admin/services-health",         featureKey: "admin_services_health",   adminOnly: true, secondary: true },
      { icon: Shield,       label: "PBAC Policies",       path: "/admin/pbac-policies",           featureKey: "admin_pbac",             adminOnly: true, secondary: true },
      { icon: ShieldCheck,  label: "Partner Applications",path: "/admin/partner-applications",     featureKey: "admin_partner_apps",      adminOnly: true, secondary: true },
      { icon: DollarSign,   label: "Partner Payouts",     path: "/admin/partner-payouts",         featureKey: "admin_partner_payouts",   adminOnly: true, secondary: true },
      { icon: ListFilter,   label: "Watchlist",           path: "/admin/compliance-watchlist",    featureKey: "admin_watchlist",         adminOnly: true, secondary: true },
      { icon: Shield,       label: "Compliance Metrics",  path: "/admin/compliance-metrics",      featureKey: "admin_compliance_metrics",adminOnly: true, secondary: true },
      { icon: UserCog,      label: "KYC Admin Queue",     path: "/admin/kyc-queue",               featureKey: "admin_kyc_queue",         adminOnly: true, secondary: true },
      { icon: GitBranch,    label: "KYC Lifecycle Admin", path: "/admin/kyc-lifecycle",           featureKey: "admin_kyc_lifecycle",     adminOnly: true, secondary: true },
      { icon: FileText,     label: "Regulatory Reporting",path: "/admin/regulatory-reporting",    featureKey: "admin_regulatory",        adminOnly: true, secondary: true },
      { icon: Shield,       label: "AML Batch Engine",    path: "/admin/aml-batch",               featureKey: "admin_aml_batch",         adminOnly: true, secondary: true },
      { icon: FileText,    label: "Form M Audit",        path: "/compliance/form-m-audit",       featureKey: "admin_form_m_audit",       adminOnly: true, secondary: true },
      { icon: Globe,        label: "Cross-Border Compliance",path: "/admin/cross-border-compliance",featureKey: "admin_cross_border",     adminOnly: true, secondary: true },
      { icon: Building2,    label: "Merchant KYB",        path: "/admin/merchant-kyb",            featureKey: "admin_merchant_kyb",      adminOnly: true, secondary: true },
      { icon: FileText,     label: "Document OCR",        path: "/admin/document-ocr",            featureKey: "admin_doc_ocr",           adminOnly: true, secondary: true },
      // Treasury & Risk (secondary)
      { icon: Landmark,     label: "Treasury",            path: "/treasury",                      featureKey: "admin_treasury",          adminOnly: true, secondary: true },
      { icon: TrendingDown, label: "Liquidity Stress",    path: "/admin/liquidity-stress",        featureKey: "admin_liquidity_stress",  adminOnly: true, secondary: true },
      { icon: Droplets,     label: "Liquidity Monitor",   path: "/liquidity",                     featureKey: "admin_liquidity",         adminOnly: true, secondary: true },
      { icon: Activity,     label: "SLA Monitor",         path: "/sla-monitor",                   featureKey: "admin_sla",               adminOnly: true, secondary: true },
      { icon: ShieldCheck,  label: "Chargebacks",         path: "/chargebacks",                   featureKey: "admin_chargebacks",       adminOnly: true, secondary: true },
      { icon: Shield,       label: "Security Events",     path: "/security-events",               featureKey: "admin_security_events",   adminOnly: true, secondary: true },
      { icon: Calculator,   label: "Fee Rules Engine",    path: "/fee-rules",                     featureKey: "admin_fee_rules",         adminOnly: true, secondary: true },
      { icon: Sliders,      label: "Fee Negotiation",     path: "/fee-negotiation",               featureKey: "admin_fee_negotiation",   adminOnly: true, secondary: true },
      { icon: GitBranch,    label: "Transfer Audit",      path: "/transfer-audit",                featureKey: "admin_transfer_audit",    adminOnly: true, secondary: true },
      { icon: Route,        label: "Smart Routing",       path: "/smart-routing",                 featureKey: "admin_smart_routing",     adminOnly: true, secondary: true },
      { icon: Sliders,      label: "Multi-Hop Routing",   path: "/multi-hop-routing",             featureKey: "admin_multi_hop",         adminOnly: true, secondary: true },
      { icon: TrendingUp,   label: "Transfer Limits",     path: "/transfer-limits",               featureKey: "admin_transfer_limits",   adminOnly: true, secondary: true },
      { icon: Sliders,      label: "Reconciliation",      path: "/reconciliation-v2",             featureKey: "admin_reconciliation",    adminOnly: true, secondary: true },
      { icon: Sliders,      label: "System Health",       path: "/system-health-v2",              featureKey: "admin_system_health",     adminOnly: true, secondary: true },
      { icon: TrendingUp,   label: "FX Options",          path: "/admin/fx-options",              featureKey: "admin_fx_options",        adminOnly: true, secondary: true },
      { icon: Repeat2,      label: "Settlement Netting",  path: "/admin/settlement-netting",      featureKey: "admin_settlement_netting",adminOnly: true, secondary: true },
      // Monitoring & Ops (secondary)
      { icon: Radio,        label: "Real-Time Monitor",   path: "/realtime-monitor",              featureKey: "admin_realtime",          adminOnly: true, secondary: true },
      { icon: Tv2,          label: "Grafana Dashboards",  path: "/grafana",                       featureKey: "admin_grafana",           adminOnly: true, secondary: true },
      { icon: BarChart,     label: "Revenue Analytics",   path: "/revenue-analytics",             featureKey: "admin_revenue_analytics", adminOnly: true, secondary: true },
      { icon: BarChart2,    label: "Analytics Overview",  path: "/analytics",                     featureKey: "admin_analytics_overview",adminOnly: true, secondary: true },
      { icon: Webhook,      label: "Webhook Retry Queue", path: "/webhook-retry",                 featureKey: "admin_webhook_retry",     adminOnly: true, secondary: true },
      { icon: Palette,      label: "Tenant Config",       path: "/tenant-config",                 featureKey: "admin_tenant_config",     adminOnly: true, secondary: true },
      { icon: Globe,        label: "SWIFT Tracker",       path: "/swift-tracker",                 featureKey: "admin_swift",             adminOnly: true, secondary: true },
      { icon: Star,         label: "Loyalty",             path: "/loyalty-v2",                    featureKey: "admin_loyalty",           adminOnly: true, secondary: true },
      { icon: Leaf,         label: "Carbon Offset",       path: "/carbon-offset",                 featureKey: "admin_carbon",            adminOnly: true, secondary: true },
      { icon: Bell,         label: "Notification Center", path: "/notification-center",           featureKey: "admin_notification_center",adminOnly: true, secondary: true },
      { icon: Activity,     label: "Audit Trail",         path: "/audit-trail-v2",                featureKey: "admin_audit_trail",       adminOnly: true, secondary: true },
      { icon: Wind,         label: "Data Pipelines",      path: "/data-pipelines",                featureKey: "admin_data_pipelines",    adminOnly: true, secondary: true },
      { icon: BookOpen,     label: "Multi-Currency Ledger",path: "/ledger",                       featureKey: "admin_ledger",            adminOnly: true, secondary: true },
      { icon: BarChart2,    label: "Nav Analytics",       path: "/admin/nav-analytics",           featureKey: "admin_nav_analytics",     adminOnly: true, secondary: true },
      { icon: BarChart2,    label: "A/B Testing",         path: "/ab-testing",                    featureKey: "admin_ab_testing",        adminOnly: true, secondary: true },
      { icon: Database,     label: "Lakehouse Analytics", path: "/admin/lakehouse-analytics",     featureKey: "admin_lakehouse",         adminOnly: true, secondary: true },
      { icon: ShieldAlert,  label: "Attack Simulator",    path: "/admin/attack-simulator",        featureKey: "admin_attack_sim",        adminOnly: true, secondary: true },
      { icon: Bell,         label: "Compliance Email",    path: "/admin/compliance-email",        featureKey: "admin_compliance_email",  adminOnly: true, secondary: true },
      // AI / ML (secondary)
      { icon: BrainCircuit, label: "AI Hub",              path: "/ai-hub",                        featureKey: "admin_ai_hub",            adminOnly: true, secondary: true },
      { icon: Database,     label: "Vector Search",       path: "/vector-search",                 featureKey: "admin_vector_search",     adminOnly: true, secondary: true },
      { icon: Network,      label: "Knowledge Graph",     path: "/knowledge-graph",               featureKey: "admin_knowledge_graph",   adminOnly: true, secondary: true },
      { icon: Cpu,          label: "Ollama Chat",         path: "/ollama-chat",                   featureKey: "admin_ollama",            adminOnly: true, secondary: true },
      { icon: Brain,        label: "ART Agent",           path: "/art-agent",                     featureKey: "admin_art_agent",         adminOnly: true, secondary: true },
      { icon: MessageSquare,label: "KGQA",               path: "/kgqa",                          featureKey: "admin_kgqa",              adminOnly: true, secondary: true },
      { icon: Layers,       label: "Lakehouse",           path: "/lakehouse",                     featureKey: "admin_lakehouse_db",      adminOnly: true, secondary: true },
      { icon: RefreshCw,    label: "CocoIndex",           path: "/cocoindex",                     featureKey: "admin_cocoindex",         adminOnly: true, secondary: true },
      { icon: Zap,          label: "Similar Transactions",path: "/similar-transactions",          featureKey: "admin_similar_tx",        adminOnly: true, secondary: true },
      { icon: BarChart3,    label: "AI Metrics",          path: "/ai-metrics",                    featureKey: "admin_ai_metrics",        adminOnly: true, secondary: true },
      { icon: ShieldCheck,  label: "Agent KYB Review",    path: "/admin/agent-kyb",               featureKey: "admin_agent_kyb",         adminOnly: true },
      { icon: Radio,        label: "Payment Rails Health",path: "/admin/rails-health",            featureKey: "admin_rails_health",      adminOnly: true, secondary: true },
      { icon: Shield,       label: "Liveness Audit",      path: "/admin/liveness-audit",          featureKey: "admin_liveness_audit",    adminOnly: true },
      { icon: AlertTriangle,label: "Compliance Alerts",   path: "/compliance-alerts",             featureKey: "admin_compliance_alerts", adminOnly: true },
      { icon: BarChart2,    label: "Compliance Analytics",path: "/admin/compliance-analytics",    featureKey: "admin_compliance_analytics", adminOnly: true },
      { icon: ShieldAlert,  label: "MLRO Dashboard",       path: "/admin/mlro",                    featureKey: "admin_mlro",              adminOnly: true },
      { icon: FileText,     label: "SAR History",          path: "/admin/sar-history",             featureKey: "admin_sar_history",       adminOnly: true },
      { icon: Users,        label: "Officer Workload",     path: "/admin/officer-workload",        featureKey: "admin_officer_workload",  adminOnly: true },
    ],
  },
  // ── AGENT NETWORK ─────────────────────────────────────────────────────────
  {
    id: "agent",
    label: "Agent Network",
    icon: Store,
    items: [
      { icon: Store,        label: "Agent POS",            path: "/agent/pos",                     featureKey: "agent_pos" },
      { icon: UserCog,      label: "Become an Agent",      path: "/agent/register",                featureKey: "agent_register" },
    ],
  },
  // ── MY TRANSFERS & SUPPORT ────────────────────────────────────────────────
  {
    id: "my-transfers",
    label: "My Transfers",
    icon: List,
    items: [
      { icon: List,          label: "Transfer History",    path: "/transfers",                     featureKey: "transfers" },
      { icon: Coins,         label: "Send Crypto",         path: "/send-crypto",                   featureKey: "crypto_transfers" },
      { icon: MessageCircle, label: "Support Tickets",     path: "/support/tickets",               featureKey: "support_tickets" },
      { icon: Monitor,       label: "Business Deck",       path: "/presentation",                  featureKey: "presentation_deck" },
      { icon: Briefcase,     label: "Global Payroll",      path: "/payroll",                       featureKey: "global_payroll" },
      { icon: TrendingUp,    label: "Bond Market",          path: "/bonds",                         featureKey: "diaspora_bonds" },
    ],
  },
  // ── BUSINESS FINANCE (Tier 1) ─────────────────────────────────────────────
  {
    id: "business-finance",
    label: "Business Finance",
    icon: Briefcase,
    items: [
      { icon: Receipt,      label: "Expense Management",   path: "/expense-management",   featureKey: "expense_management" },
      { icon: Users,        label: "Contractor Payments",  path: "/contractor-payments",  featureKey: "contractor_payments" },
      { icon: ShieldCheck,  label: "Merchant KYB Review",  path: "/merchant-kyb",         featureKey: "merchant_kyb" },
      { icon: FileText,     label: "Payroll & Tax Filing", path: "/payroll-tax",          featureKey: "payroll_tax" },
    ],
  },
  // ── TRADE FINANCE (Tier 2) ────────────────────────────────────────────────
  {
    id: "trade-finance",
    label: "Trade Finance",
    icon: Landmark,
    items: [
      { icon: PiggyBank,    label: "Business Savings",     path: "/business-savings",     featureKey: "business_savings" },
      { icon: TrendingUp,   label: "Bond Secondary Market",path: "/bond-market",           featureKey: "bond_market" },
      { icon: FileText,     label: "Letter of Credit",     path: "/letter-of-credit",     featureKey: "letter_of_credit" },
      { icon: DollarSign,   label: "Invoice Financing",    path: "/invoice-financing",    featureKey: "invoice_financing" },
      { icon: Briefcase,    label: "Payroll Run",           path: "/payroll-run",          featureKey: "payroll_run" },
    ],
  },
  // ── ADVANCED PRODUCTS (Tier 3) ────────────────────────────────────────────
  {
    id: "advanced-products",
    label: "Advanced Products",
    icon: Rocket,
    items: [
      { icon: Key,          label: "Embedded Payroll API",  path: "/embedded-payroll-api", featureKey: "embedded_payroll_api" },
      { icon: Home,         label: "Diaspora Mortgage",     path: "/diaspora-mortgage",    featureKey: "diaspora_mortgage" },
      { icon: Star,         label: "Credit Scoring",        path: "/credit-scoring",       featureKey: "credit_scoring" },
      { icon: Leaf,         label: "ESG Reporting",         path: "/esg-reporting",        featureKey: "esg_reporting" },
    ],
  },
];

// Flat list for command palette + breadcrumbs
const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) =>
  g.items.map((item) => ({ ...item, group: g.label }))
);

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const GROUP_COLLAPSE_KEY = "nav-group-collapse";
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

// ─── ONBOARDING STEPS ─────────────────────────────────────────────────────────
function getOnboardingSteps(
  user: { kycTier?: string | null; email?: string | null } | null
) {
  if (!user) return [];
  return [
    {
      id: "profile",
      label: "Complete profile",
      path: "/settings",
      done: !!user.email,
    },
    {
      id: "kyc",
      label: "Verify identity (KYC)",
      path: "/kyc",
      done:
        !!user.kycTier &&
        user.kycTier !== "tier0" &&
        user.kycTier !== "tier1",
    },
    { id: "wallet", label: "Fund your wallet", path: "/wallet", done: false },
    {
      id: "send",
      label: "Send your first transfer",
      path: "/send",
      done: false,
    },
  ];
}

// ─── ADMIN SSE BADGE ──────────────────────────────────────────────────────────
function useAdminSseBadge(isAdmin: boolean) {
  const [badgeCount, setBadgeCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const MAX_RETRY_DELAY_MS = 60_000; // cap at 60 s for low-bandwidth environments
    function connect() {
      es = new EventSource("/api/admin/sse", { withCredentials: true });
      es.onopen = () => {
        retryCount = 0; // reset backoff counter on successful connection
      };
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (
            data.type === "new_kyc" ||
            data.type === "new_compliance_case"
          ) {
            setBadgeCount((c) => c + 1);
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (cap)
        // Handles unreliable connectivity in low-bandwidth / rural environments
        const delay = Math.min(1_000 * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
        retryCount += 1;
        retryTimeout = setTimeout(connect, delay);
      };
    }
    connect();
    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [isAdmin]);
  return { badgeCount, clearBadge: () => setBadgeCount(0) };
}

// ─── COMMAND PALETTE ──────────────────────────────────────────────────────────
function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = query.trim()
    ? ALL_NAV_ITEMS.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.group.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : ALL_NAV_ITEMS.slice(0, 8);

  const handleSelect = (path: string) => {
    setLocation(path);
    onClose();
  };
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, features..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && results.length > 0)
                handleSelect(results[0].path);
            }}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No results found
            </p>
          ) : (
            results.map((item) => (
              <button
                key={item.path}
                onClick={() => handleSelect(item.path)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent text-left transition-colors"
              >
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.group}</p>
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
        <div className="border-t px-4 py-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>
            <kbd className="rounded border bg-muted px-1">↵</kbd> select
          </span>
          <span>
            <kbd className="rounded border bg-muted px-1">ESC</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── ONBOARDING PROGRESS ──────────────────────────────────────────────────────
function OnboardingProgress({
  user,
}: {
  user: { kycTier?: string | null; email?: string | null } | null;
}) {
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("onboarding-dismissed") === "true"
  );
  const steps = getOnboardingSteps(user);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  if (dismissed || allDone) return null;
  const nextStep = steps.find((s) => !s.done);
  const pct = Math.round((doneCount / steps.length) * 100);
  return (
    <div className="mx-3 mb-3 rounded-lg border bg-primary/5 p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-foreground">Getting started</span>
        <button
          onClick={() => {
            setDismissed(true);
            localStorage.setItem("onboarding-dismissed", "true");
          }}
          className="text-muted-foreground hover:text-foreground transition-colors text-[10px]"
        >
          Dismiss
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-muted-foreground mb-2">
        {doneCount}/{steps.length} steps complete
      </p>
      <div className="space-y-1">
        {steps.map((step) => (
          <button
            key={step.id}
            onClick={() => !step.done && setLocation(step.path)}
            className={`w-full flex items-center gap-2 rounded px-1.5 py-1 transition-colors ${
              step.done
                ? "opacity-50 cursor-default"
                : "hover:bg-primary/10 cursor-pointer"
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span
              className={
                step.done
                  ? "line-through text-muted-foreground"
                  : "text-foreground"
              }
            >
              {step.label}
            </span>
            {!step.done && step.id === nextStep?.id && (
              <span className="ml-auto text-[10px] text-primary font-medium">
                Next →
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── BREADCRUMB ───────────────────────────────────────────────────────────────
function Breadcrumb({ path }: { path: string }) {
  const item = ALL_NAV_ITEMS.find((i) => i.path === path);
  if (!item) return null;
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Home className="h-3.5 w-3.5" />
      <ChevronRight className="h-3.5 w-3.5" />
      <span>{item.group}</span>
      <ChevronRight className="h-3.5 w-3.5" />
      <span className="text-foreground font-medium">{item.label}</span>
    </div>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Landmark className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground">
              Access your RemitFlow dashboard to send money, track transfers,
              and grow your wealth.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }
  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

// ─── INNER CONTENT ────────────────────────────────────────────────────────────
function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: {
  children: React.ReactNode;
  setSidebarWidth: (w: number) => void;
}) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { state: sidebarState } = useSidebar();
  const isCollapsed = sidebarState === "collapsed";
  const isAdmin = user?.role === "admin";
  const isPartner = user?.role === "partner" || isAdmin;
  const { badgeCount, clearBadge } = useAdminSseBadge(isAdmin);

  // Feature flag resolution
  const { data: navFlags } = trpc.featureFlags.getNavFlags.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // cache 5 min
    retry: false,
  });

  // Per-group "More" expander state — persisted to localStorage
  const MORE_EXPAND_KEY = "remitflow-sidebar-more-expanded";
  const [moreExpanded, setMoreExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(MORE_EXPAND_KEY) ?? "{}"); } catch { return {}; }
  });
  const toggleMore = useCallback((id: string) => {
    setMoreExpanded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(MORE_EXPAND_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Resize
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_WIDTH);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.clientX - startX.current;
      const newW = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth.current + delta)
      );
      setSidebarWidth(newW);
    };
    const onUp = () => {
      isResizing.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setSidebarWidth]);

  // Group collapse
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(GROUP_COLLAPSE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Command palette
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if (e.key === "Escape") setCmdOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Dark mode
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  // Filter items by feature flags + role; split into primary / secondary
  const getGroupItems = (group: NavGroup) => {
    const allItems = group.items.filter((item) => {
      // Role gate
      if (item.adminOnly && !isAdmin) return false;
      if (item.partnerOnly && !isPartner) return false;
      // Feature flag gate (default to visible if flags not loaded yet)
      if (item.featureKey && navFlags) {
        return navFlags[item.featureKey] !== false;
      }
      return true;
    });
    const primary   = allItems.filter((i) => !i.secondary);
    const secondary = allItems.filter((i) => !!i.secondary);
    return { primary, secondary };
  };

  const visibleGroups = NAV_GROUPS.filter((g) => {
    if (g.adminOnly && !isAdmin) return false;
    // Hide group if all its items are gated
    const { primary, secondary } = getGroupItems(g);
    return primary.length > 0 || secondary.length > 0;
  });

  return (
    <>
      <ImpersonationBanner />
      <ConnectionHealthBanner />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <Sidebar collapsible="icon">
        {/* Header */}
        <SidebarHeader className="px-3 py-3 border-b">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-bold tracking-tight">RemitFlow</p>
              <p className="text-[10px] text-muted-foreground">
                Cross-Border Finance
              </p>
            </div>
            <SidebarTrigger
              className="h-7 w-7 rounded-md group-data-[collapsible=icon]:hidden"
              aria-label="Toggle navigation"
            />
          </div>
          {/* Search trigger */}
          <button
            onClick={() => setCmdOpen(true)}
            className="mt-2 w-full flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors group-data-[collapsible=icon]:hidden"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search...</span>
            <kbd className="hidden sm:inline-flex h-4 items-center gap-0.5 rounded border bg-background px-1 text-[10px]">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </button>
        </SidebarHeader>

        {/* Nav Groups */}
        <SidebarContent className="overflow-y-auto overflow-x-hidden py-2">
          <div className="group-data-[collapsible=icon]:hidden">
            <OnboardingProgress user={user} />
          </div>

          {visibleGroups.map((group) => {
            const isGroupCollapsed = collapsed[group.id] ?? false;
            const { primary, secondary } = getGroupItems(group);
            const hasActive = [...primary, ...secondary].some((i) => i.path === location);
            const isMoreOpen = moreExpanded[group.id] ?? false;

            const renderItem = (item: NavItem) => {
              const isActive = location === item.path;
              const isAdminCompliance = item.path === "/admin/compliance";
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={isActive}
                    onClick={() => {
                      setLocation(item.path);
                      if (isAdminCompliance && badgeCount > 0) clearBadge();
                    }}
                    tooltip={item.label}
                    className={`h-9 text-sm font-normal transition-all ${
                      isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/60"
                    }`}
                  >
                    <item.icon className={`h-4 w-4 shrink-0 ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`} />
                    <span className="truncate">{item.label}</span>
                    {isAdminCompliance && isAdmin && badgeCount > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            };

            return (
              <div key={group.id} className="mb-1">
                {/* Group label */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors rounded-md mx-1 group-data-[collapsible=icon]:hidden ${
                    hasActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ width: "calc(100% - 8px)" }}
                >
                  <group.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  {group.id === "admin" && badgeCount > 0 && (
                    <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                  {isGroupCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                </button>

                {/* Items */}
                {!isGroupCollapsed && (
                  <SidebarMenu className="px-1">
                    {/* Primary items always visible */}
                    {primary.map(renderItem)}

                    {/* Secondary items behind More toggle */}
                    {secondary.length > 0 && (
                      <>
                        {isMoreOpen && secondary.map(renderItem)}
                        <SidebarMenuItem>
                          <button
                            onClick={() => toggleMore(group.id)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded-md"
                          >
                            {isMoreOpen ? (
                              <><ChevronDown className="h-3 w-3" /><span>Less</span></>
                            ) : (
                              <><ChevronRight className="h-3 w-3" /><span>More ({secondary.length})</span></>
                            )}
                          </button>
                        </SidebarMenuItem>
                      </>
                    )}
                  </SidebarMenu>
                )}
              </div>
            );
          })}
        </SidebarContent>

        {/* Footer */}
        <SidebarFooter className="p-3 border-t">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-8 w-8 border shrink-0">
                  <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                    {user?.name?.charAt(0).toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "—"}
                    </p>
                    {user?.role === "admin" && (
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1 py-0 h-4 shrink-0"
                      >
                        Admin
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email || "—"}
                    </p>
                    {user?.kycTier && user.kycTier !== "tier0" && (
                      <span
                        className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded border leading-none ${
                          user.kycTier === "tier3"
                            ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                            : user.kycTier === "tier2"
                            ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800"
                            : "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800"
                        }`}
                      >
                        {user.kycTier === "tier3"
                          ? "KYC ✓"
                          : user.kycTier === "tier2"
                          ? "KYC 2"
                          : "KYC 1"}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => setLocation("/profile")}
                className="cursor-pointer"
              >
                <User className="mr-2 h-4 w-4" />
                <span>My Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setLocation("/settings")}
                className="cursor-pointer"
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleDark} className="cursor-pointer">
                {dark ? (
                  <>
                    <Sun className="mr-2 h-4 w-4" />
                    <span>Light mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="mr-2 h-4 w-4" />
                    <span>Dark mode</span>
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors ${
            isCollapsed ? "hidden" : ""
          }`}
          onMouseDown={(e) => {
            if (isCollapsed) return;
            isResizing.current = true;
            startX.current = e.clientX;
            const w = parseInt(
              getComputedStyle(document.documentElement).getPropertyValue(
                "--sidebar-width"
              ) || String(DEFAULT_WIDTH)
            );
            startWidth.current = isNaN(w) ? DEFAULT_WIDTH : w;
          }}
          style={{ zIndex: 50 }}
        />
      </Sidebar>

      {/* Main */}
      <SidebarInset>
        {/* Top bar */}
        <div
          className={`flex border-b items-center justify-between bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40 ${
            isMobile ? "h-14" : "h-12"
          }`}
        >
          <div className="flex items-center gap-3">
            {isMobile && (
              <SidebarTrigger className="h-8 w-8 rounded-lg bg-background" />
            )}
            <Breadcrumb path={location} />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
              <kbd className="hidden md:inline-flex h-4 items-center gap-0.5 rounded border bg-background px-1 text-[10px]">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>
            <NotificationBell />
            <LanguageSwitcher />
          </div>
        </div>

        <OfflineQueueBanner />

        <main className="flex-1 p-4 pb-safe">{children}</main>
        <ChatWidget />
        <GlobalMobileNav />
        <SessionTimeout />
      </SidebarInset>
    </>
  );
}
