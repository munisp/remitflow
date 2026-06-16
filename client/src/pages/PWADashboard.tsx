import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Wallet2, RefreshCw, Landmark, TrendingUp, Heart, ShieldAlert,
  User, Building2, Cpu, BrainCircuit, Gauge, ShieldCheck,
  LayoutDashboard, ArrowUpRight, ArrowDownLeft, List, Users, QrCode,
  SplitSquareHorizontal, Banknote, Repeat, Bell, Calculator, Layers,
  TrendingDown, Repeat2, Receipt, Smartphone, CalendarClock, BarChart3,
  Search, PiggyBank, Target, PieChart, Home, Rocket, LineChart, CreditCard,
  Coins, Zap, Route, Globe, Trophy, Briefcase, Gift, ShoppingBag, Network,
  Shield, FileText, Scale, AlertTriangle, AlertOctagon, FileCheck, ListFilter,
  GitBranch, UserCog, Settings2, HelpCircle, MessageCircle, CheckCircle2,
  DollarSign, Palette, Store, Droplets, Activity, Sliders, ShieldCheck as SC,
  Webhook, Key, FlaskConical, Database, Brain, MessageSquare, Radio, Tv2,
  BarChart, BarChart2, Wind, BookOpen, Leaf, Star, Flag, ToggleLeft, Tag,
  Wrench, Gauge as GaugeIcon, Building2 as B2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';

// ─── Category definitions (mirrors DashboardLayout NAV_GROUPS) ───────────────
const CATEGORIES = [
  {
    id: "money", label: "Money", icon: Wallet2,
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
    iconColor: "text-emerald-400",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
      { icon: Wallet2, label: "Wallet", path: "/wallet" },
      { icon: ArrowUpRight, label: "Send Money", path: "/send" },
      { icon: ArrowDownLeft, label: "Receive", path: "/receive" },
      { icon: Users, label: "Split Bill", path: "/split-bill" },
      { icon: List, label: "Transactions", path: "/transactions" },
      { icon: Users, label: "Beneficiaries", path: "/beneficiaries" },
      { icon: QrCode, label: "QR Pay", path: "/qr-code" },
      { icon: SplitSquareHorizontal, label: "Batch Payments", path: "/batch-payments" },
      { icon: Banknote, label: "Direct Debit", path: "/direct-debit" },
      { icon: Repeat, label: "Recurring", path: "/recurring" },
    ],
  },
  {
    id: "fx-rates", label: "FX & Rates", icon: RefreshCw,
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
    iconColor: "text-blue-400",
    items: [
      { icon: RefreshCw, label: "Exchange Rates", path: "/exchange" },
      { icon: Bell, label: "FX Alerts", path: "/fx-alerts" },
      { icon: Calculator, label: "Rate Calculator", path: "/calculator" },
      { icon: Layers, label: "Rate Lock", path: "/rate-lock" },
      { icon: TrendingDown, label: "FX Streaming", path: "/fx-streaming" },
      { icon: TrendingUp, label: "FX Hedging", path: "/fx-hedging" },
      { icon: TrendingUp, label: "FX Options Pricing", path: "/admin/fx-options" },
      { icon: Calculator, label: "FX Calculator", path: "/fx-calculator" },
      { icon: Bell, label: "Rate Alert History", path: "/rate-alert-history" },
    ],
  },
  {
    id: "payments", label: "Payments", icon: Landmark,
    color: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
    iconColor: "text-violet-400",
    items: [
      { icon: Landmark, label: "Payment Rails", path: "/payment-rails" },
      { icon: CreditCard, label: "Open Banking", path: "/open-banking" },
      { icon: Layers, label: "Bulk Payments", path: "/bulk-payments-v2" },
      { icon: Repeat2, label: "Settlement Netting", path: "/admin/settlement-netting" },
      { icon: Wallet2, label: "Multi-Currency Wallet", path: "/wallet/multi-currency-v2" },
      { icon: Receipt, label: "Bills", path: "/bills" },
      { icon: Smartphone, label: "Airtime & Data", path: "/airtime" },
      { icon: CalendarClock, label: "Scheduled Transfers", path: "/scheduled-transfers" },
      { icon: BarChart3, label: "Daily Volume", path: "/daily-volume" },
      { icon: Search, label: "Transaction Search", path: "/transactions/search" },
    ],
  },
  {
    id: "grow", label: "Grow & Invest", icon: TrendingUp,
    color: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
    iconColor: "text-amber-400",
    items: [
      { icon: PiggyBank, label: "Savings", path: "/savings" },
      { icon: Target, label: "Savings Goals", path: "/goals" },
      { icon: TrendingUp, label: "DiasporaVest", path: "/invest" },
      { icon: PieChart, label: "My Portfolio", path: "/invest/portfolio" },
      { icon: BarChart3, label: "NGX Stocks", path: "/invest/stocks" },
      { icon: Home, label: "Real Estate", path: "/invest/real-estate" },
      { icon: Rocket, label: "Startups", path: "/invest/startups" },
      { icon: LineChart, label: "BeyondRemittance", path: "/beyond-remittance" },
      { icon: CreditCard, label: "Cards", path: "/cards" },
      { icon: Coins, label: "BNPL", path: "/bnpl" },
      { icon: Landmark, label: "CBDC", path: "/cbdc" },
      { icon: Zap, label: "Stablecoin", path: "/stablecoin" },
      { icon: Route, label: "Corridors", path: "/corridors" },
    ],
  },
  {
    id: "community", label: "Community", icon: Heart,
    color: "from-rose-500/20 to-rose-600/10 border-rose-500/30",
    iconColor: "text-rose-400",
    items: [
      { icon: Heart, label: "Community Funds", path: "/community" },
      { icon: Globe, label: "Community Hub", path: "/community-hub" },
      { icon: Trophy, label: "Leaderboard", path: "/community/leaderboard" },
      { icon: Users, label: "Family Dashboard", path: "/family" },
      { icon: Briefcase, label: "TalentBridge", path: "/talent" },
      { icon: Gift, label: "Referral", path: "/referral" },
      { icon: Gift, label: "Referral Dashboard", path: "/referral-dashboard" },
      { icon: ShoppingBag, label: "AfriMarket", path: "/marketplace" },
      { icon: Building2, label: "POS & Agents", path: "/pos" },
      { icon: Network, label: "Agent Network", path: "/agents" },
    ],
  },
  {
    id: "compliance", label: "Compliance", icon: ShieldAlert,
    color: "from-orange-500/20 to-orange-600/10 border-orange-500/30",
    iconColor: "text-orange-400",
    items: [
      { icon: Shield, label: "KYC Verification", path: "/kyc" },
      { icon: FileText, label: "GDPR & Privacy", path: "/gdpr" },
      { icon: AlertTriangle, label: "Travel Rule", path: "/travel-rule" },
      { icon: Scale, label: "Disputes", path: "/disputes" },
      { icon: AlertOctagon, label: "Fraud Detection", path: "/fraud-detection-v2" },
      { icon: ShieldAlert, label: "Sanctions Screening", path: "/sanctions-screening" },
      { icon: FileText, label: "Regulatory Reporting", path: "/admin/regulatory-reporting" },
      { icon: Shield, label: "AML Batch Engine", path: "/admin/aml-batch" },
      { icon: Globe, label: "Cross-Border Compliance", path: "/admin/cross-border-compliance" },
      { icon: Building2, label: "Merchant KYB", path: "/admin/merchant-kyb" },
      { icon: FileText, label: "Document OCR", path: "/admin/document-ocr" },
      { icon: ShieldAlert, label: "Compliance Scoring", path: "/compliance-scoring" },
      { icon: Shield, label: "Compliance Reports", path: "/compliance-reporting" },
      { icon: FileCheck, label: "KYC Lifecycle", path: "/kyc-lifecycle" },
      { icon: ListFilter, label: "Watchlist", path: "/admin/compliance-watchlist" },
      { icon: Shield, label: "Compliance Metrics", path: "/admin/compliance-metrics" },
      { icon: UserCog, label: "KYC Admin Queue", path: "/admin/kyc-queue" },
      { icon: GitBranch, label: "KYC Lifecycle Admin", path: "/admin/kyc-lifecycle" },
    ],
  },
  {
    id: "account", label: "Account", icon: User,
    color: "from-slate-500/20 to-slate-600/10 border-slate-500/30",
    iconColor: "text-slate-400",
    items: [
      { icon: Settings2, label: "Settings", path: "/settings" },
      { icon: HelpCircle, label: "Support", path: "/support" },
      { icon: MessageCircle, label: "Live Chat", path: "/live-chat" },
      { icon: CheckCircle2, label: "User Onboarding", path: "/onboarding" },
      { icon: FileText, label: "Document Vault", path: "/document-vault" },
      { icon: FileText, label: "Document Vault v2", path: "/document-vault-v2" },
      { icon: Receipt, label: "Stripe Receipts", path: "/stripe-receipts" },
    ],
  },
  {
    id: "partners", label: "Partners", icon: Building2,
    color: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30",
    iconColor: "text-cyan-400",
    items: [
      { icon: FileText, label: "Apply as Partner", path: "/partners/apply" },
      { icon: LayoutDashboard, label: "Partner Portal", path: "/partner/portal" },
      { icon: DollarSign, label: "Revenue Share PWA", path: "/partner/revenue-share" },
      { icon: ShieldAlert, label: "Partner Applications", path: "/admin/partner-applications" },
      { icon: Palette, label: "Branding Preview", path: "/partner/branding-preview" },
      { icon: DollarSign, label: "Partner Payouts", path: "/admin/partner-payouts" },
      { icon: DollarSign, label: "Partner Payouts v2", path: "/partner-payouts-v2" },
      { icon: Store, label: "Merchant Onboarding", path: "/merchant-onboarding" },
    ],
  },
  {
    id: "treasury", label: "Treasury & Risk", icon: Landmark,
    color: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30",
    iconColor: "text-indigo-400",
    items: [
      { icon: Landmark, label: "Treasury", path: "/treasury" },
      { icon: TrendingDown, label: "Liquidity Stress Test", path: "/admin/liquidity-stress" },
      { icon: Droplets, label: "Liquidity Monitor", path: "/liquidity" },
      { icon: Activity, label: "SLA Monitor", path: "/sla-monitor" },
      { icon: ShieldAlert, label: "Chargebacks", path: "/chargebacks" },
      { icon: Shield, label: "Security Events", path: "/security-events" },
      { icon: Calculator, label: "Fee Rules Engine", path: "/fee-rules" },
      { icon: Sliders, label: "Fee Rules CRUD", path: "/fee-rules-crud" },
      { icon: Sliders, label: "Fee Negotiation", path: "/fee-negotiation" },
      { icon: Sliders, label: "Fee Rules V2", path: "/fee-rules-v2" },
      { icon: GitBranch, label: "Transfer Audit Trail", path: "/transfer-audit" },
      { icon: Route, label: "Smart Routing", path: "/smart-routing" },
      { icon: Route, label: "Smart Routing v2", path: "/smart-routing-v2" },
      { icon: Sliders, label: "Multi-Hop Routing", path: "/multi-hop-routing" },
      { icon: TrendingUp, label: "Transfer Limits", path: "/transfer-limits" },
      { icon: Sliders, label: "Transfer Limits V2", path: "/transfer-limits-v2" },
      { icon: Sliders, label: "Reconciliation V2", path: "/reconciliation-v2" },
      { icon: Sliders, label: "System Health V2", path: "/system-health-v2" },
    ],
  },
  {
    id: "admin", label: "Admin", icon: ShieldCheck,
    color: "from-red-500/20 to-red-600/10 border-red-500/30",
    iconColor: "text-red-400",
    items: [
      { icon: LayoutDashboard, label: "Overview", path: "/admin" },
      { icon: BarChart3, label: "Analytics", path: "/admin/analytics" },
      { icon: UserCog, label: "Users", path: "/admin/users" },
      { icon: ShieldAlert, label: "KYC Review", path: "/admin/kyc" },
      { icon: Shield, label: "Compliance", path: "/admin/compliance" },
      { icon: Activity, label: "Audit Log", path: "/admin/audit-log" },
      { icon: FileText, label: "Audit Logs", path: "/admin/audit-logs" },
      { icon: Cpu, label: "Microservices", path: "/admin/microservices" },
      { icon: Route, label: "Corridor Pricing", path: "/admin/corridor-pricing" },
      { icon: BarChart2, label: "Nav Analytics", path: "/admin/nav-analytics" },
      { icon: Flag, label: "Feature Flags", path: "/admin/feature-flags" },
      { icon: ToggleLeft, label: "Feature Flags v2", path: "/admin/feature-flags-v2" },
      { icon: Building2, label: "Tenants", path: "/admin/tenants" },
      { icon: Palette, label: "White Label", path: "/admin/white-label" },
      { icon: DollarSign, label: "Revenue Share", path: "/admin/revenue-share" },
      { icon: MessageSquare, label: "Chat Agent", path: "/admin/chat-agent" },
      { icon: FileCheck, label: "Digital Agreements", path: "/admin/digital-agreements" },
      { icon: Sliders, label: "System Config", path: "/admin/system-config" },
      { icon: Sliders, label: "System Config v2", path: "/admin/system-config-v2" },
      { icon: Users, label: "Bulk Actions", path: "/admin/bulk-actions" },
      { icon: Users, label: "Beneficiary Manager", path: "/admin/beneficiaries" },
      { icon: Tag, label: "Promo Codes", path: "/admin/promo-codes" },
      { icon: Webhook, label: "Webhooks Admin", path: "/admin/webhooks" },
      { icon: Key, label: "API Keys Admin", path: "/admin/api-keys" },
      { icon: Zap, label: "Velocity Checks", path: "/admin/velocity-checks" },
      { icon: Receipt, label: "Payment History", path: "/payments/history" },
      { icon: ShieldAlert, label: "Security Audit", path: "/admin/security-audit" },
      { icon: Database, label: "Lakehouse Analytics", path: "/admin/lakehouse-analytics" },
      { icon: ShieldAlert, label: "Attack Simulator", path: "/admin/attack-simulator" },
      { icon: Bell, label: "Compliance Email", path: "/admin/compliance-email" },
      { icon: BarChart2, label: "A/B Testing", path: "/ab-testing" },
    ],
  },
  {
    id: "developer", label: "Developer", icon: Cpu,
    color: "from-teal-500/20 to-teal-600/10 border-teal-500/30",
    iconColor: "text-teal-400",
    items: [
      { icon: Webhook, label: "Webhooks", path: "/developer/webhooks" },
      { icon: Key, label: "API Keys", path: "/developer/api-keys" },
      { icon: Smartphone, label: "Mobile SDK", path: "/pwa-features" },
      { icon: Zap, label: "Developer Sandbox", path: "/developer-sandbox" },
      { icon: BarChart3, label: "API Usage", path: "/api-usage" },
      { icon: Bell, label: "Push Notifications", path: "/push-notifications" },
      { icon: FlaskConical, label: "Sandbox Scenarios", path: "/sandbox-scenarios" },
    ],
  },
  {
    id: "ai", label: "AI / ML", icon: BrainCircuit,
    color: "from-fuchsia-500/20 to-fuchsia-600/10 border-fuchsia-500/30",
    iconColor: "text-fuchsia-400",
    items: [
      { icon: BrainCircuit, label: "AI Hub", path: "/ai-hub" },
      { icon: Database, label: "Vector Search", path: "/vector-search" },
      { icon: Network, label: "Knowledge Graph", path: "/knowledge-graph" },
      { icon: Cpu, label: "Ollama Chat", path: "/ollama-chat" },
      { icon: Brain, label: "ART Agent", path: "/art-agent" },
      { icon: MessageSquare, label: "KGQA", path: "/kgqa" },
      { icon: Layers, label: "Lakehouse", path: "/lakehouse" },
      { icon: RefreshCw, label: "CocoIndex", path: "/cocoindex" },
      { icon: Zap, label: "Similar Transactions", path: "/similar-transactions" },
      { icon: BarChart3, label: "AI Metrics", path: "/ai-metrics" },
    ],
  },
  {
    id: "monitoring", label: "Monitoring & Ops", icon: Gauge,
    color: "from-lime-500/20 to-lime-600/10 border-lime-500/30",
    iconColor: "text-lime-400",
    items: [
      { icon: Radio, label: "Real-Time Monitor", path: "/realtime-monitor" },
      { icon: Tv2, label: "Grafana Dashboards", path: "/grafana" },
      { icon: BarChart, label: "Revenue Analytics", path: "/revenue-analytics" },
      { icon: BarChart2, label: "Analytics", path: "/analytics" },
      { icon: Webhook, label: "Webhook Retry Queue", path: "/webhook-retry" },
      { icon: Palette, label: "Tenant Config", path: "/tenant-config" },
      { icon: Globe, label: "SWIFT Tracker", path: "/swift-tracker" },
      { icon: Star, label: "Loyalty V2", path: "/loyalty-v2" },
      { icon: Leaf, label: "Carbon Offset", path: "/carbon-offset" },
      { icon: Bell, label: "Notification Center", path: "/notification-center" },
      { icon: Activity, label: "Audit Trail v2", path: "/audit-trail-v2" },
      { icon: Wind, label: "NiFi / dbt / Airflow", path: "/data-pipelines" },
      { icon: BookOpen, label: "Multi-Currency Ledger", path: "/ledger" },
    ],
  },
];

const TOTAL_ROUTES = CATEGORIES.reduce((sum, c) => sum + c.items.length, 0);

export default function PWADashboard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { user } = useAuth();
  const { data: walletData, isLoading, isError } = trpc.wallet.balance.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const { data: recentTx } = trpc.transfers.list.useQuery(
    { limit: 3, offset: 0 },
    { enabled: !!user, refetchInterval: 60_000 }
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return CATEGORIES;
    const q = search.toLowerCase();
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.path.toLowerCase().includes(q) ||
          cat.label.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [search]);

  const totalFiltered = filtered.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">PWA Navigation Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              {CATEGORIES.length} categories &nbsp;·&nbsp; {TOTAL_ROUTES} routes total
              {search && ` · ${totalFiltered} matching`}
            </p>
            {user && walletData && (
              <p className="text-xs text-emerald-500 mt-0.5 font-medium">
                Balance: {(walletData as any).currency ?? "USD"} {Number((walletData as any).balance ?? 0).toLocaleString("en", { minimumFractionDigits: 2 })}
                {Array.isArray(recentTx) && recentTx.length > 0 && (
                  <span className="text-muted-foreground ml-2">· Last transfer: {new Date((recentTx[0] as any).created_at ?? Date.now()).toLocaleDateString()}</span>
                )}
              </p>
            )}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search routes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* ── Category grid ── */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {filtered.map((cat) => {
          const Icon = cat.icon;
          const isExpanded = expandedId === cat.id || !!search.trim();
          const PREVIEW_COUNT = 8;
          const shown = isExpanded ? cat.items : cat.items.slice(0, PREVIEW_COUNT);
          const hidden = cat.items.length - PREVIEW_COUNT;

          return (
            <div
              key={cat.id}
              className={`rounded-xl border bg-gradient-to-br ${cat.color} p-4`}
            >
              {/* Category header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg bg-background/40 ${cat.iconColor}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="font-semibold text-sm">{cat.label}</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                    {cat.items.length}
                  </Badge>
                </div>
                {!search.trim() && hidden > 0 && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? "Show less" : `+${hidden} more`}
                  </button>
                )}
              </div>

              {/* Route tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {shown.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className="flex flex-col items-start gap-1.5 rounded-lg bg-background/60 hover:bg-background/90 border border-border/50 hover:border-border px-3 py-2.5 text-left transition-all hover:shadow-sm group"
                    >
                      <ItemIcon className={`h-4 w-4 ${cat.iconColor} group-hover:scale-110 transition-transform`} />
                      <span className="text-xs font-medium leading-tight line-clamp-2">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono truncate w-full">
                        {item.path}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
