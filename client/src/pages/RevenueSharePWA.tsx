import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, Calendar, Bell, BellOff, Download, Share2,
  CheckCircle, Clock, AlertCircle, ChevronRight, Wifi, WifiOff,
  BarChart3, FileText, Users, Zap, Shield, Star, ArrowUpRight,
  Smartphone, RefreshCw, Package
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ─── Offline Banner ───────────────────────────────────────────────────────────
function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return (
    <div className="flex items-center gap-2 bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-sm px-4 py-2 rounded-lg mb-4">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>You're offline. Showing cached data.</span>
    </div>
  );
}

// ─── Install Prompt ───────────────────────────────────────────────────────────
function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("pwa-install-dismissed") === "1");

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
      toast.success("App installed!", { description: "RemitFlow Partner is now on your home screen." });
    }
    setPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("pwa-install-dismissed", "1");
  };

  if (installed || dismissed || !prompt) return null;

  return (
    <div className="bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/40 rounded-xl p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shrink-0">
          <Smartphone className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">Install Partner App</p>
          <p className="text-xs text-slate-400 mt-0.5">Add to home screen for instant access to your earnings dashboard — works offline too.</p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleInstall} className="bg-violet-600 hover:bg-violet-700 text-white text-xs h-8">
              <Download className="w-3 h-3 mr-1.5" /> Install App
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismiss} className="text-slate-400 text-xs h-8">
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Notification Permission ──────────────────────────────────────────────────
function NotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(
    "Notification" in window ? Notification.permission : "denied"
  );

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      toast.success("Notifications enabled!", { description: "You'll be notified when payouts are processed." });
      // Show a test notification
      new Notification("RemitFlow Partner", {
        body: "Payout notifications are now active. You'll be alerted when payments land.",
        icon: "/manus-storage/icon-192_d0405887.png",
        badge: "/manus-storage/icon-192_d0405887.png",
      });
    }
  };

  if (permission === "granted") {
    return (
      <div className="flex items-center gap-2 text-xs text-green-400 mb-4">
        <Bell className="w-3.5 h-3.5" />
        <span>Payout notifications active</span>
      </div>
    );
  }

  if (permission === "denied") return null;

  return (
    <div className="bg-indigo-600/10 border border-indigo-500/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-indigo-400" />
        <span className="text-sm text-slate-300">Get payout alerts</span>
      </div>
      <Button size="sm" variant="outline" onClick={requestPermission} className="text-xs h-7 border-indigo-500/50 text-indigo-300">
        Enable
      </Button>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, sub, color = "violet" }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    violet: "from-violet-600/20 to-purple-600/20 border-violet-500/30",
    green: "from-green-600/20 to-emerald-600/20 border-green-500/30",
    blue: "from-blue-600/20 to-cyan-600/20 border-blue-500/30",
    amber: "from-amber-600/20 to-orange-600/20 border-amber-500/30",
  };
  const iconColors: Record<string, string> = {
    violet: "bg-violet-600 text-white",
    green: "bg-green-600 text-white",
    blue: "bg-blue-600 text-white",
    amber: "bg-amber-600 text-white",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconColors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <ArrowUpRight className="w-4 h-4 text-slate-500" />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Earnings Chart (SVG sparkline) ──────────────────────────────────────────
function EarningsSparkline({ data }: { data: number[] }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 280; const h = 60;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${pts} ${w},${h}`}
        fill="url(#sparkGrad)"
      />
      <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
import DashboardLayout from "@/components/DashboardLayout";
export default function RevenueSharePWA() {
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "earnings";
  });
  const [refreshing, setRefreshing] = useState(false);

  // tRPC queries
  const { data: myAgreement, isLoading: agreementLoading, refetch: refetchAgreement } =
    trpc.revenueShare.myAgreement.useQuery(undefined, { enabled: isAuthenticated });

  const { data: myEarnings, isLoading: earningsLoading, refetch: refetchEarnings } =
    trpc.revenueShare.myEarnings.useQuery(undefined, { enabled: isAuthenticated });

  const applyMutation = trpc.revenueShare.applyAsPartner.useMutation({
    onSuccess: () => {
      toast.success("Application submitted!", { description: "We'll review your application within 2 business days." });
      refetchAgreement();
    },
    onError: (err) => toast.error("Application failed", { description: err.message }),
  });

  // Pull-to-refresh simulation
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchAgreement(), refetchEarnings()]);
    setRefreshing(false);
    toast.success("Data refreshed");
  }, [refetchAgreement, refetchEarnings]);

  // Share earnings
  const handleShare = async () => {
    const text = `I've earned $${((myEarnings as any)?.totalEarned ?? 0).toFixed(2)} through RemitFlow's Partner Revenue Share program! 🚀`;
    if (navigator.share) {
      await navigator.share({ title: "My RemitFlow Earnings", text, url: window.location.href });
    } else {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard!");
    }
  };

  const earnings = myEarnings as any;
  const agreement = myAgreement as any;

  // Build sparkline data from monthly breakdown
  const sparkData: number[] = earnings?.monthlyBreakdown
    ? earnings.monthlyBreakdown.map((m: any) => m.earned ?? 0)
    : [120, 180, 145, 220, 310, 280, 390, 420, 380, 510, 480, 560];

  const tierColors: Record<string, string> = {
    bronze: "text-amber-600",
    silver: "text-slate-400",
    gold: "text-yellow-400",
    platinum: "text-cyan-400",
  };

  const statusIcon = (status: string) => {
    if (status === "paid") return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (status === "pending") return <Clock className="w-4 h-4 text-yellow-400" />;
    return <AlertCircle className="w-4 h-4 text-red-400" />;
  };

  return (

    <DashboardLayout>
    <div className="min-h-screen bg-[#0f172a] text-white">
      {/* PWA Header */}
      <div className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-3 max-w-lg mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none">Partner Portal</p>
              <p className="text-xs text-violet-400 leading-none mt-0.5">Revenue Share</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-8 h-8 text-slate-400 hover:text-white"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleShare}
              className="w-8 h-8 text-slate-400 hover:text-white"
            >
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-24">
        <OfflineBanner />
        <InstallPrompt />
        <NotificationPermission />

        {/* Partner greeting */}
        {isAuthenticated && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
              {user?.name?.charAt(0)?.toUpperCase() ?? "P"}
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Welcome back, {user?.name?.split(" ")[0] ?? "Partner"}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {agreement?.tier && (
                  <span className={`text-xs font-medium capitalize ${tierColors[agreement.tier] ?? "text-violet-400"}`}>
                    <Star className="w-3 h-3 inline mr-0.5" />
                    {agreement.tier} Partner
                  </span>
                )}
                {agreement?.status === "active" && (
                  <Badge className="bg-green-500/20 text-green-300 text-xs px-1.5 py-0 h-4">Active</Badge>
                )}
              </div>
            </div>
          </div>
        )}

        {/* KPI Grid */}
        {!earningsLoading && earnings && (
          <div className="grid grid-cols-2 gap-3">
            <KPICard
              icon={DollarSign}
              label="Total Earned"
              value={`$${(earnings.totalEarned ?? 0).toFixed(2)}`}
              sub="All time"
              color="violet"
            />
            <KPICard
              icon={TrendingUp}
              label="This Month"
              value={`$${(earnings.thisMonth ?? 0).toFixed(2)}`}
              sub={`${earnings.monthlyGrowth ?? 0}% vs last month`}
              color="green"
            />
            <KPICard
              icon={Calendar}
              label="Next Payout"
              value={`$${(earnings.pendingPayout ?? 0).toFixed(2)}`}
              sub={earnings.nextPayoutDate ? new Date(earnings.nextPayoutDate).toLocaleDateString() : "End of month"}
              color="blue"
            />
            <KPICard
              icon={Users}
              label="Referrals"
              value={String(earnings.totalReferrals ?? 0)}
              sub={`${earnings.activeReferrals ?? 0} active`}
              color="amber"
            />
          </div>
        )}

        {/* Earnings sparkline */}
        {!earningsLoading && (
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-violet-400" />
                  Earnings Trend
                </CardTitle>
                <span className="text-xs text-slate-400">Last 12 months</span>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <EarningsSparkline data={sparkData} />
              <div className="flex justify-between mt-1">
                {["Jan", "Mar", "May", "Jul", "Sep", "Nov"].map((m) => (
                  <span key={m} className="text-xs text-slate-600">{m}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 bg-white/5 border border-white/10 h-9">
            <TabsTrigger value="earnings" className="text-xs data-[state=active]:bg-violet-600 data-[state=active]:text-white">
              Earnings
            </TabsTrigger>
            <TabsTrigger value="payouts" className="text-xs data-[state=active]:bg-violet-600 data-[state=active]:text-white">
              Payouts
            </TabsTrigger>
            <TabsTrigger value="agreement" className="text-xs data-[state=active]:bg-violet-600 data-[state=active]:text-white">
              Agreement
            </TabsTrigger>
          </TabsList>

          {/* ── Earnings Tab ── */}
          <TabsContent value="earnings" className="space-y-3 mt-3">
            {earningsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : earnings?.monthlyBreakdown?.length ? (
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-white">Monthly Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {earnings.monthlyBreakdown.slice(0, 6).map((month: any, i: number) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400">{month.month ?? `Month ${i + 1}`}</span>
                        <span className="text-sm font-semibold text-white">${(month.earned ?? 0).toFixed(2)}</span>
                      </div>
                      <Progress
                        value={sparkData[i] ? (sparkData[i] / Math.max(...sparkData)) * 100 : 0}
                        className="h-1.5 bg-white/10"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 space-y-3">
                <div className="w-16 h-16 bg-violet-600/20 rounded-full flex items-center justify-center mx-auto">
                  <TrendingUp className="w-8 h-8 text-violet-400" />
                </div>
                <p className="text-white font-medium">No earnings yet</p>
                <p className="text-sm text-slate-400">Start referring customers to earn revenue share.</p>
                {!agreement && (
                  <Button
                    onClick={() => applyMutation.mutate({ companyName: user?.name ?? "Partner", contactEmail: user?.email ?? "", contactName: user?.name ?? "Partner", country: "US", agreedToTerms: true, signatureName: user?.name ?? "Partner" })}
                    disabled={applyMutation.isPending}
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {applyMutation.isPending ? "Applying..." : "Apply as Partner"}
                  </Button>
                )}
              </div>
            )}

            {/* Tier Progress */}
            {agreement && (
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    Tier Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-semibold capitalize ${tierColors[agreement.tier] ?? "text-violet-400"}`}>
                      {agreement.tier ?? "Bronze"} Tier
                    </span>
                    <span className="text-xs text-slate-400">
                      {agreement.commissionRate ?? 0}% commission
                    </span>
                  </div>
                  <Progress value={agreement.tierProgress ?? 45} className="h-2 bg-white/10" />
                  <p className="text-xs text-slate-500 mt-1.5">
                    {100 - (agreement.tierProgress ?? 45)}% more volume to reach next tier
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Payouts Tab ── */}
          <TabsContent value="payouts" className="space-y-3 mt-3">
            {earnings?.payoutHistory?.length ? (
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-white">Payout History</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-2">
                  {earnings.payoutHistory.map((payout: any, i: number) => (
                    <div key={i}>
                      <div className="flex items-center gap-3 py-3">
                        {statusIcon(payout.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white">
                            ${(payout.amount ?? 0).toFixed(2)}
                          </p>
                          <p className="text-xs text-slate-400">
                            {payout.period ?? `Period ${i + 1}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge
                            className={
                              payout.status === "paid"
                                ? "bg-green-500/20 text-green-300 text-xs"
                                : payout.status === "pending"
                                ? "bg-yellow-500/20 text-yellow-300 text-xs"
                                : "bg-red-500/20 text-red-300 text-xs"
                            }
                          >
                            {payout.status}
                          </Badge>
                          {payout.paidAt && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {new Date(payout.paidAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      {i < earnings.payoutHistory.length - 1 && <Separator className="bg-white/5" />}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 space-y-3">
                <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto">
                  <Package className="w-8 h-8 text-blue-400" />
                </div>
                <p className="text-white font-medium">No payouts yet</p>
                <p className="text-sm text-slate-400">Payouts are processed at the end of each month.</p>
              </div>
            )}

            {/* Payout schedule info */}
            <Card className="bg-indigo-600/10 border-indigo-500/30">
              <CardContent className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Calendar className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white">Monthly Payout Schedule</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Payouts are processed on the 1st of each month for the previous month's earnings. Minimum payout threshold: $50.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Agreement Tab ── */}
          <TabsContent value="agreement" className="space-y-3 mt-3">
            {agreementLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}
              </div>
            ) : agreement ? (
              <>
                <Card className="bg-white/5 border-white/10">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-violet-400" />
                        Agreement Details
                      </CardTitle>
                      <Badge
                        className={
                          agreement.status === "active"
                            ? "bg-green-500/20 text-green-300 text-xs"
                            : "bg-yellow-500/20 text-yellow-300 text-xs"
                        }
                      >
                        {agreement.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {[
                      { label: "Agreement ID", value: `#${agreement.id}` },
                      { label: "Commission Rate", value: `${agreement.commissionRate ?? 0}%` },
                      { label: "Tier", value: agreement.tier ?? "Bronze" },
                      { label: "Start Date", value: agreement.startDate ? new Date(agreement.startDate).toLocaleDateString() : "—" },
                      { label: "Currency", value: agreement.currency ?? "USD" },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{label}</span>
                        <span className="text-sm font-medium text-white capitalize">{value}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Terms summary */}
                <Card className="bg-white/5 border-white/10">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <Shield className="w-4 h-4 text-green-400" />
                      Key Terms
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {[
                      "Revenue share calculated on net transaction fees",
                      "Payouts processed monthly, minimum $50 threshold",
                      "30-day notice required for agreement termination",
                      "Platform reserves right to adjust rates with 60-day notice",
                      "Fraud or policy violations result in immediate suspension",
                    ].map((term, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                        <span className="text-xs text-slate-300">{term}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Button
                  variant="outline"
                  className="w-full border-white/20 text-white hover:bg-white/10"
                  onClick={() => window.open("/admin/revenue-share", "_blank")}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  View Full Agreement
                  <ChevronRight className="w-4 h-4 ml-auto" />
                </Button>
              </>
            ) : (
              <div className="text-center py-12 space-y-4">
                <div className="w-16 h-16 bg-violet-600/20 rounded-full flex items-center justify-center mx-auto">
                  <FileText className="w-8 h-8 text-violet-400" />
                </div>
                <div>
                  <p className="text-white font-semibold">No Active Agreement</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Apply to become a revenue share partner and start earning commissions on every transaction you refer.
                  </p>
                </div>
                <div className="bg-white/5 rounded-xl p-4 text-left space-y-2">
                  <p className="text-xs font-semibold text-violet-300 uppercase tracking-wide">Partner Benefits</p>
                  {[
                    "Up to 40% revenue share on referred transactions",
                    "Monthly automated payouts to your bank",
                    "Real-time earnings dashboard",
                    "Dedicated partner support",
                  ].map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      <span className="text-xs text-slate-300">{b}</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => applyMutation.mutate({ companyName: user?.name ?? "Partner", contactEmail: user?.email ?? "", contactName: user?.name ?? "Partner", country: "US", agreedToTerms: true, signatureName: user?.name ?? "Partner" })}
                  disabled={applyMutation.isPending}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {applyMutation.isPending ? "Submitting..." : "Apply as Partner"}
                </Button>
              </div>
            )}
          </TabsContent>
          <TabsContent value="alerts" className="space-y-3 mt-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <h3 className="font-semibold text-sm text-white">Payout Alerts</h3>
              <p className="text-xs text-slate-400">Configure when you receive notifications about your revenue share payouts.</p>
              <div className="space-y-3">
                {[
                  { label: "Payout processed", desc: "When a payout is sent to your account" },
                  { label: "Payout threshold reached", desc: "When your balance exceeds the payout minimum" },
                  { label: "Commission earned", desc: "When a referred user completes a transaction" },
                  { label: "Tier upgrade", desc: "When you move to a higher commission tier" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="text-xs text-slate-400">{item.desc}</p>
                    </div>
                    <div className="w-10 h-5 rounded-full bg-violet-600 flex items-center justify-end px-0.5 cursor-pointer">
                      <div className="w-4 h-4 rounded-full bg-white" />
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="w-full mt-2 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors"
                onClick={() => window.location.href = "/push-notifications"}
              >
                Manage Notification Settings
              </button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Bottom nav bar (PWA-style) */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0f172a]/95 backdrop-blur-sm border-t border-white/10 safe-area-inset-bottom">
        <div className="max-w-lg mx-auto grid grid-cols-4 py-2">
          {[
            { icon: BarChart3, label: "Earnings", tab: "earnings" },
            { icon: DollarSign, label: "Payouts", tab: "payouts" },
            { icon: FileText, label: "Agreement", tab: "agreement" },
            { icon: Bell, label: "Alerts", tab: "alerts" },
          ].map(({ icon: Icon, label, tab }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center gap-1 py-1 transition-colors ${
                activeTab === tab ? "text-violet-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  

    </DashboardLayout>

  );
}
