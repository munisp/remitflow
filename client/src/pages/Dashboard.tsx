import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell
} from "recharts";
import {
  Send, Download, ArrowLeftRight, Phone, CreditCard, PiggyBank,
  Smartphone, Globe, TrendingUp, TrendingDown, ArrowUpRight,
  Lightbulb, CheckCircle2, AlertCircle, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, X, ChevronRight } from "lucide-react";
import { useLocation } from 'wouter';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import BeneficiaryOnboarding from "@/components/BeneficiaryOnboarding";
import { OnboardingTour } from "@/components/OnboardingTour";
import { useTranslation } from 'react-i18next';

function QuickSendBeneficiaries() {
  const [, navigate] = useLocation();
  const { data: topSenders, isLoading } = trpc.beneficiaries.topSenders.useQuery();

  if (!isLoading && (!topSenders || topSenders.length === 0)) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Send</h2>
        <Link href="/beneficiaries">
          <Button variant="ghost" size="sm" className="text-primary gap-1 text-xs">
            Manage <ChevronRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-1">
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2 min-w-[64px]">
              <Skeleton className="w-14 h-14 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))
        ) : (
          (Array.isArray(topSenders) ? topSenders : []).map(b => (
            <button
              key={b.id}
              onClick={() => navigate(`/send?beneficiaryId=${b.id}&name=${encodeURIComponent(b.name)}&currency=${b.currency ?? 'USD'}`)}
              className="flex flex-col items-center gap-2 min-w-[64px] group cursor-pointer"
            >
              <div className="relative">
                <Avatar className="w-14 h-14 ring-2 ring-transparent group-hover:ring-primary/40 transition-all">
                  <AvatarFallback className="bg-gradient-to-br from-primary/20 to-violet-200 text-primary font-bold text-lg">
                    {b.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {b.isFavorite && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[9px]">★</span>
                )}
              </div>
              <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight max-w-[64px] truncate">
                {b.name.split(' ')[0]}
              </span>
              <span className="text-[10px] text-muted-foreground/70">{b.currency ?? 'USD'}</span>
            </button>
          ))
        )}
        {/* Add new beneficiary shortcut */}
        <button
          onClick={() => navigate('/beneficiaries')}
          className="flex flex-col items-center gap-2 min-w-[64px] group cursor-pointer"
        >
          <div className="w-14 h-14 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center group-hover:border-primary/50 transition-colors">
            <span className="text-2xl text-muted-foreground/50 group-hover:text-primary/60 transition-colors">+</span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Add New</span>
        </button>
      </div>
    </div>
  );
}

const QUICK_ACTIONS = [
  { label: "Send", href: "/send", icon: <Send className="h-5 w-5" />, color: "bg-blue-500" },
  { label: "Receive", href: "/receive", icon: <Download className="h-5 w-5" />, color: "bg-emerald-500" },
  { label: "Exchange", href: "/exchange", icon: <ArrowLeftRight className="h-5 w-5" />, color: "bg-violet-500" },
  { label: "Airtime", href: "/airtime", icon: <Phone className="h-5 w-5" />, color: "bg-orange-500" },
  { label: "Cards", href: "/cards", icon: <CreditCard className="h-5 w-5" />, color: "bg-pink-500" },
  { label: "Savings", href: "/savings", icon: <PiggyBank className="h-5 w-5" />, color: "bg-teal-500" },
  { label: "M-Pesa", href: "/mpesa", icon: <Smartphone className="h-5 w-5" />, color: "bg-green-600" },
  { label: "Wise", href: "/wise", icon: <Globe className="h-5 w-5" />, color: "bg-cyan-500" },
];

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-600",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  send: <Send className="h-4 w-4 text-red-500" />,
  receive: <Download className="h-4 w-4 text-emerald-500" />,
  exchange: <ArrowLeftRight className="h-4 w-4 text-violet-500" />,
  airtime: <Phone className="h-4 w-4 text-orange-500" />,
  bill: <CreditCard className="h-4 w-4 text-blue-500" />,
  topup: <Download className="h-4 w-4 text-teal-500" />,
};

// ── KYC Banner ────────────────────────────────────────────────────────────────
const KYC_BANNER_DISMISSED_KEY = "remitflow_kyc_banner_dismissed_v1";

function KYCBanner({ currentTier }: { currentTier: string }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(KYC_BANNER_DISMISSED_KEY) === currentTier; }
    catch { return false; }
  });

  if (dismissed) return null;

  const tierNum = parseInt(currentTier.replace("tier", "") || "0", 10);

  if (tierNum >= 2) {
    // Tier 2+ — show a subtle success badge, not a banner
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span className="text-sm font-medium">Identity verified — Tier {tierNum} access unlocked</span>
        <button onClick={() => { setDismissed(true); try { localStorage.setItem(KYC_BANNER_DISMISSED_KEY, currentTier); } catch {} }}
          className="ml-auto text-emerald-500 hover:text-emerald-700 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (tierNum === 1) {
    return (
      <div className="flex items-start sm:items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
        <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">Complete identity verification to unlock higher limits</p>
          <p className="text-xs text-amber-700 mt-0.5">You're on Tier 1 — verify your ID to send up to $10,000/day and access all features.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/kyc-verification">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white h-8 text-xs gap-1">
              Verify now <ChevronRight className="h-3 w-3" />
            </Button>
          </Link>
          <button onClick={() => { setDismissed(true); try { localStorage.setItem(KYC_BANNER_DISMISSED_KEY, currentTier); } catch {} }}
            className="text-amber-400 hover:text-amber-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Tier 0 — unverified
  return (
    <div className="flex items-start sm:items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
      <ShieldX className="h-5 w-5 text-red-600 shrink-0 mt-0.5 sm:mt-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-900">Verify your identity to start sending money</p>
        <p className="text-xs text-red-700 mt-0.5">Your account is unverified. Complete KYC to unlock transfers, higher limits, and all RemitFlow features.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/kyc-verification">
          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white h-8 text-xs gap-1">
            Start verification <ChevronRight className="h-3 w-3" />
          </Button>
        </Link>
        <button onClick={() => { setDismissed(true); try { localStorage.setItem(KYC_BANNER_DISMISSED_KEY, currentTier); } catch {} }}
          className="text-red-400 hover:text-red-600 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.dashboard.summary.useQuery();
  const { data: kycData } = trpc.kyc.status.useQuery();
  const { data: beneficiaries } = trpc.beneficiaries.list.useQuery();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Show beneficiary onboarding once for users with no saved recipients
  useEffect(() => {
    if (beneficiaries !== undefined && beneficiaries.length === 0) {
      const dismissed = localStorage.getItem("remitflow_beneficiary_onboarding_dismissed");
      if (!dismissed) setShowOnboarding(true);
    }
  }, [beneficiaries]);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Welcome back, {data?.user?.name?.split(" ")[0] ?? "there"} 👋
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Here's your financial overview</p>
          </div>
          <Badge variant="secondary" className="text-emerald-600 bg-emerald-50 border-emerald-200 hidden sm:flex">
            <CheckCircle2 className="h-3 w-3 mr-1" /> All systems operational
          </Badge>
        </div>

        {/* KYC Status Banner */}
        {kycData?.currentTier !== undefined && (
          <KYCBanner currentTier={kycData.currentTier} />
        )}

        {/* Portfolio Hero Card */}
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-violet-700 p-6 text-primary-foreground">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/20 -translate-y-1/2 translate-x-1/4" />
            <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-white/10 translate-y-1/2 -translate-x-1/4" />
          </div>
          <div className="relative">
            <p className="text-primary-foreground/70 text-sm font-medium mb-1">Total Portfolio Balance</p>
            {isLoading ? (
              <Skeleton className="h-10 w-48 bg-white/20 mb-2" />
            ) : (
              <div className="text-4xl font-extrabold mb-1">
                ₦{data?.totalBalance?.toLocaleString() ?? "0"}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <span className="text-primary-foreground/70">≈ ${data?.totalBalanceUSD?.toLocaleString() ?? "0"} USD</span>
              <span className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium">
                <TrendingUp className="h-3 w-3" /> +{data?.monthlyChange ?? 0}% this month
              </span>
            </div>
            <div className="flex gap-2 mt-4">
              {data?.currencies?.map((c: any) => (
                <Badge key={c} variant="secondary" className="bg-white/20 text-primary-foreground border-0 text-xs">
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Quick Actions</h2>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {QUICK_ACTIONS.map(action => (
              <Link key={action.label} href={action.href}>
                <div className="flex flex-col items-center gap-2 cursor-pointer group">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-sm",
                    "group-hover:scale-110 transition-transform",
                    action.color
                  )}>
                    {action.icon}
                  </div>
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                    {action.label}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick-Send Beneficiaries */}
        <QuickSendBeneficiaries />

        {/* Chart + AI Insight */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Portfolio Growth</CardTitle>
                <Badge variant="outline" className="text-xs">12 months</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={data?.chartData ?? []}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => `₦${(v / 1000000).toFixed(1)}M`} />
                    <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Balance"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* AI Insight + Stats */}
          <div className="space-y-4">
            {data?.aiInsight && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                      <Lightbulb className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-amber-900">{data.aiInsight.title}</p>
                      <p className="text-xs text-amber-700 mt-1 leading-relaxed">{data.aiInsight.body}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Sent this month</span>
                  <span className="font-semibold text-red-600 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" /> ₦{(data?.sentThisMonth ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Received this month</span>
                  <span className="font-semibold text-emerald-600 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> ₦{(data?.receivedThisMonth ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Savings goals</span>
                  <span className="font-semibold">{0} active</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Spend by Category */}
        {(() => {
          const cats = [
            { name: "Remittances", value: data?.sentThisMonth ?? 0, color: "#6366f1" },
            { name: "Bills", value: (data?.sentThisMonth ?? 0) * 0.18, color: "#f59e0b" },
            { name: "Savings", value: (data?.sentThisMonth ?? 0) * 0.22, color: "#10b981" },
            { name: "Exchange", value: (data?.sentThisMonth ?? 0) * 0.12, color: "#06b6d4" },
            { name: "Other", value: (data?.sentThisMonth ?? 0) * 0.08, color: "#8b5cf6" },
          ].filter(c => c.value > 0);
          const total = cats.reduce((s, c) => s + c.value, 0);
          if (!total) return null;
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Spend by Category — This Month</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={cats} cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={3} dataKey="value">
                        {cats.map((c, i) => <Cell key={i} fill={c.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, ""]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 flex-1">
                    {cats.map(c => (
                      <div key={c.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="text-xs text-muted-foreground flex-1">{c.name}</span>
                        <span className="text-xs font-semibold">{((c.value / total) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Recent Transactions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Transactions</CardTitle>
              <Link href="/transactions">
                <Button variant="ghost" size="sm" className="text-primary gap-1">
                  View all <ArrowUpRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="space-y-1">
                {data?.recentTransactions?.map((txn: any) => (
                  <div key={txn.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {TYPE_ICONS[txn.type] ?? <ArrowLeftRight className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {txn.description ?? txn.recipientName ?? txn.type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {txn.recipientName && `To ${txn.recipientName} · `}
                        {new Date(txn.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-semibold", txn.type === "receive" || txn.type === "topup" ? "text-emerald-600" : "text-foreground")}>
                        {txn.type === "receive" || txn.type === "topup" ? "+" : "-"}
                        {txn.currency === "NGN" ? "₦" : txn.currency + " "}
                        {Number(txn.amount).toLocaleString()}
                      </p>
                      <Badge className={cn("text-xs mt-0.5", STATUS_COLORS[txn.status])}>
                        {txn.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Beneficiary quick-start onboarding for first-time users */}
      <BeneficiaryOnboarding
        open={showOnboarding}
        onClose={() => {
          setShowOnboarding(false);
          localStorage.setItem("remitflow_beneficiary_onboarding_dismissed", "true");
        }}
        onSuccess={() => navigate("/send-money")}
      />
      {/* First-login onboarding tour */}
      <OnboardingTour />
    </DashboardLayout>
  );
}
