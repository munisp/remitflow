import { useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart,
} from "recharts";
import {
  Key, Users, Building2, TrendingUp, RefreshCw, CheckCircle2, Clock,
  XCircle, Activity, ArrowUpRight, Zap, Globe, ChevronRight,
  DollarSign, Download, BarChart2, Award,
} from "lucide-react";
import { toast } from "sonner";

const PLAN_COLORS: Record<string, string> = {
  starter: "#6366f1",
  growth: "#10b981",
  enterprise: "#f59e0b",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "#10b981",
  in_progress: "#6366f1",
  abandoned: "#ef4444",
};

const STEP_LABELS: Record<number, string> = {
  1: "Code Verified",
  2: "Company Info",
  3: "Branding",
  4: "Corridors",
  5: "Review",
  6: "Launched",
};

const REVENUE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6"];

export default function PartnerAnalytics() {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [feeMonths, setFeeMonths] = useState(6);

  const { data, isLoading, refetch, dataUpdatedAt } = trpc.adminInviteCodes.analytics.useQuery(undefined, {
    refetchInterval: autoRefresh ? 15_000 : false,
  });
  const { data: feeData, isLoading: feeLoading, refetch: feeRefetch } = trpc.adminInviteCodes.feeRevenue.useQuery(
    { months: feeMonths },
    { refetchInterval: autoRefresh ? 30_000 : false }
  );

  const summary = data?.summary;
  const codePerformance = data?.codePerformance ?? [];
  const funnel = data?.funnel ?? [];
  const recentActivity = data?.recentActivity ?? [];

  // Build funnel chart data
  const funnelByStep = [1,2,3,4,5,6].map((step) => {
    const entries = funnel.filter((f: any) => f.step === step);
    const total = entries.reduce((s: any, e: any) => s + e.count, 0);
    return { step: STEP_LABELS[step] ?? `Step ${step}`, total };
  }).filter(s => s.total > 0);

  // Build plan distribution pie data
  const planDist: Record<string, number> = {};
  for (const c of codePerformance) {
    planDist[c.plan] = (planDist[c.plan] ?? 0) + c.usedCount;
  }
  const planPieData = Object.entries(planDist).map(([name, value]) => ({ name, value }));

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  // CSV export for fee revenue
  const exportFeeCSV = useCallback(() => {
    if (!feeData?.byPartner?.length) { toast.info("No fee revenue data to export"); return; }
    const header = "Tenant,Plan,Invite Code,Total Fee (USD),Transactions,Revenue Share %";
    const rows = feeData.byPartner.map(p =>
      `"${p.tenantName}","${p.plan}","${p.inviteCode}",${p.totalFee},${p.txCount},${p.revenueShare}`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `remitflow-fee-revenue-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Fee revenue report exported");
  }, [feeData]);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Activity className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Partner Analytics</h1>
              <p className="text-muted-foreground text-sm">Invite codes, onboarding funnel & fee revenue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Updated: {lastUpdated}</span>
            <Button
              size="sm"
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(v => !v)}
            >
              <Zap className={`h-3.5 w-3.5 mr-1.5 ${autoRefresh ? "text-yellow-300" : ""}`} />
              {autoRefresh ? "Live" : "Auto-refresh"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { refetch(); feeRefetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary KPI Cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Codes", value: summary?.totalCodes ?? 0, sub: `${summary?.activeCodes ?? 0} active`, icon: Key, color: "text-indigo-600", bg: "bg-indigo-50" },
              { label: "Onboarding Sessions", value: summary?.totalSessions ?? 0, sub: `${summary?.completedSessions ?? 0} completed`, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Conversion Rate", value: `${summary?.conversionRate ?? 0}%`, sub: "sessions → tenants", icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-50" },
              { label: "Active Tenants", value: summary?.activeTenants ?? 0, sub: `${summary?.totalTenants ?? 0} total`, icon: Building2, color: "text-purple-600", bg: "bg-purple-50" },
            ].map(({ label, value, sub, icon: Icon, color, bg }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <div className="text-2xl font-bold">{value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="funnel" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="funnel"><ChevronRight className="h-3.5 w-3.5 mr-1" /> Onboarding</TabsTrigger>
            <TabsTrigger value="revenue"><DollarSign className="h-3.5 w-3.5 mr-1" /> Fee Revenue</TabsTrigger>
            <TabsTrigger value="codes"><Key className="h-3.5 w-3.5 mr-1" /> Invite Codes</TabsTrigger>
            <TabsTrigger value="activity"><Activity className="h-3.5 w-3.5 mr-1" /> Activity</TabsTrigger>
          </TabsList>

          {/* ── Onboarding Tab ── */}
          <TabsContent value="funnel" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ChevronRight className="h-4 w-4 text-indigo-500" />
                    Onboarding Funnel
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {funnelByStep.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No sessions yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={funnelByStep} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Globe className="h-4 w-4 text-emerald-500" />
                    Plan Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {planPieData.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No usage data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={planPieData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {planPieData.map((entry) => (
                            <Cell key={entry.name} fill={PLAN_COLORS[entry.name] ?? "#94a3b8"} />
                          ))}
                        </Pie>
                        <Legend />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Fee Revenue Tab ── */}
          <TabsContent value="revenue" className="space-y-4">
            {/* Revenue KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Fee Revenue", value: `$${(feeData?.totalRevenue ?? 0).toLocaleString()}`, sub: `Last ${feeMonths} months`, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
                { label: "Revenue Transactions", value: (feeData?.totalTransactions ?? 0).toLocaleString(), sub: "with fees > $0", icon: BarChart2, color: "text-indigo-600", bg: "bg-indigo-50" },
                { label: "Top Partner Revenue", value: `$${(feeData?.topPartners?.[0]?.totalFee ?? 0).toLocaleString()}`, sub: feeData?.topPartners?.[0]?.tenantName ?? "—", icon: Award, color: "text-amber-600", bg: "bg-amber-50" },
                { label: "Active Partners", value: (feeData?.byPartner?.filter(p => p.txCount > 0).length ?? 0).toString(), sub: "generating revenue", icon: Building2, color: "text-purple-600", bg: "bg-purple-50" },
              ].map(({ label, value, sub, icon: Icon, color, bg }) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                        <Icon className={`h-4 w-4 ${color}`} />
                      </div>
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <div className="text-xl font-bold">{feeLoading ? <Skeleton className="h-6 w-16" /> : value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Month filter + export */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">Time range:</span>
              {[3, 6, 12, 24].map(m => (
                <Button key={m} size="sm" variant={feeMonths === m ? "default" : "outline"} onClick={() => setFeeMonths(m)}>
                  {m}M
                </Button>
              ))}
              <Button size="sm" variant="outline" className="ml-auto" onClick={exportFeeCSV}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
              </Button>
            </div>

            {/* Monthly trend chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  Monthly Fee Revenue Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                {feeLoading ? <Skeleton className="h-48" /> : (feeData?.monthly?.length ?? 0) === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    No fee revenue data yet. Transactions with fees will appear here.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={feeData!.monthly} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="feeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Fee Revenue"]} />
                      <Area type="monotone" dataKey="totalFee" stroke="#10b981" fill="url(#feeGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Top Revenue Partners Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-500" />
                  Top Revenue-Generating Partners
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {feeLoading ? (
                  <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10" />)}</div>
                ) : (feeData?.topPartners?.length ?? 0) === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No partner fee revenue yet. Revenue will appear once tenants start processing transactions.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">#</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Partner</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Plan</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Invite Code</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Fee Revenue</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Transactions</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeData!.topPartners.map((partner, idx) => (
                          <tr key={partner.tenantId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">#{idx + 1}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                  style={{ backgroundColor: REVENUE_COLORS[idx % REVENUE_COLORS.length] }}>
                                  {partner.tenantName.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-medium text-sm">{partner.tenantName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" style={{ borderColor: PLAN_COLORS[partner.plan], color: PLAN_COLORS[partner.plan] }} className="capitalize text-xs">
                                {partner.plan}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{partner.inviteCode}</td>
                            <td className="px-4 py-3 text-right font-semibold text-emerald-600">${partner.totalFee.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-sm">{partner.txCount.toLocaleString()}</td>
                            <td className="px-4 py-3 min-w-[120px]">
                              <div className="flex items-center gap-2">
                                <Progress value={partner.revenueShare} className="h-1.5 w-16" />
                                <span className="text-xs text-muted-foreground">{partner.revenueShare}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Invite Codes Tab ── */}
          <TabsContent value="codes">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Key className="h-4 w-4 text-indigo-500" />
                  Invite Code Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10" />)}</div>
                ) : codePerformance.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No invite codes generated yet</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Code</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Plan</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Usage</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {codePerformance.map((code: any) => {
                          const usagePct = code.maxUses > 0 ? Math.round((code.usedCount / code.maxUses) * 100) : 0;
                          const isExpired = code.expiresAt && new Date() > new Date(code.expiresAt);
                          return (
                            <tr key={code.code} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-3">
                                <div className="font-mono text-xs font-semibold">{code.code}</div>
                                {code.description && <div className="text-xs text-muted-foreground truncate max-w-[180px]">{code.description}</div>}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" style={{ borderColor: PLAN_COLORS[code.plan], color: PLAN_COLORS[code.plan] }} className="capitalize text-xs">
                                  {code.plan}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 min-w-[120px]">
                                <div className="flex items-center gap-2">
                                  <Progress value={usagePct} className="h-1.5 w-16" />
                                  <span className="text-xs text-muted-foreground">{code.usedCount}/{code.maxUses}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={code.isActive && !isExpired ? "default" : "secondary"} className="text-xs">
                                  {!code.isActive ? "Inactive" : isExpired ? "Expired" : "Active"}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString() : "Never"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Activity Tab ── */}
          <TabsContent value="activity">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-purple-500" />
                  Recent Onboarding Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}</div>
                ) : recentActivity.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No onboarding sessions yet. Share your invite codes to get started!</div>
                ) : (
                  <div className="divide-y">
                    {recentActivity.map((session: any) => {
                      const StatusIcon = session.status === "completed" ? CheckCircle2 : session.status === "abandoned" ? XCircle : Clock;
                      const statusColor = STATUS_COLORS[session.status] ?? "#94a3b8";
                      return (
                        <div key={session.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                          <StatusIcon className="h-4 w-4 flex-shrink-0" style={{ color: statusColor }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{session.userName ?? session.userEmail ?? "Anonymous"}</span>
                              {session.tenantName && (
                                <span className="text-xs text-muted-foreground">→ {session.tenantName}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono text-xs text-muted-foreground">{session.inviteCode}</span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1 capitalize">{session.plan}</Badge>
                              <span className="text-xs text-muted-foreground">Step {session.step}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <Badge variant="outline" className="text-xs capitalize" style={{ borderColor: statusColor, color: statusColor }}>
                              {session.status.replace("_", " ")}
                            </Badge>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {new Date(session.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
