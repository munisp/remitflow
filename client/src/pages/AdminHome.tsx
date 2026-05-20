import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, FileCheck, AlertTriangle, Clock, CheckCircle2,
  TrendingUp, ShieldAlert, Activity, Calendar, Database, CreditCard, Rocket, BarChart2,
  Key, Building2, Globe,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useTranslation } from 'react-i18next';

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800 border-red-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    info: "bg-blue-100 text-blue-800 border-blue-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${map[severity] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
      {severity}
    </span>
  );
}

export default function AdminHome() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const { data, isLoading } = trpc.admin.homeSummary.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 30_000,
  });

  if (authLoading) return <DashboardLayout><div className="p-8"><Skeleton className="h-64 w-full" /></div></DashboardLayout>;
  if (!user || user.role !== "admin") {
    navigate("/dashboard");
    return null;
  }

  const summaryCards = [
    {
      title: "Total Users",
      value: data?.totalUsers ?? 0,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
      href: "/admin/users",
    },
    {
      title: "Pending KYC",
      value: data?.pendingKyc ?? 0,
      icon: FileCheck,
      color: "text-amber-600",
      bg: "bg-amber-50",
      href: "/admin/kyc",
      alert: (data?.pendingKyc ?? 0) > 0,
    },
    {
      title: "Open Cases",
      value: data?.openComplianceCases ?? 0,
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50",
      href: "/admin/compliance",
      alert: (data?.openComplianceCases ?? 0) > 0,
    },
    {
      title: "Resolved Cases",
      value: data?.resolvedCases ?? 0,
      icon: CheckCircle2,
      color: "text-green-600",
      bg: "bg-green-50",
      href: "/admin/compliance",
    },
    {
      title: "Flagged Transfers",
      value: data?.flaggedTransfers ?? 0,
      icon: ShieldAlert,
      color: "text-purple-600",
      bg: "bg-purple-50",
      href: "/admin/compliance",
    },
    {
      title: "Expiring KYC Docs",
      value: data?.expiringKycDocs ?? 0,
      icon: Calendar,
      color: "text-orange-600",
      bg: "bg-orange-50",
      href: "/admin/kyc",
      alert: (data?.expiringKycDocs ?? 0) > 0,
    },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">Platform overview and recent activity</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {summaryCards.map((card) => (
            <button
              key={card.title}
              onClick={() => navigate(card.href)}
              className="text-left"
            >
              <Card className={`hover:shadow-md transition-shadow cursor-pointer ${card.alert ? "ring-2 ring-red-200" : ""}`}>
                <CardContent className="p-4">
                  <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-3`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-7 w-12 mb-1" />
                  ) : (
                    <div className="flex items-center gap-1">
                      <p className="text-2xl font-bold text-foreground">{card.value.toLocaleString()}</p>
                      {card.alert && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{card.title}</p>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cases by Day Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Cases — Last 7 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data?.casesByDay ?? []} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(val: number, name: string) => [val, name === "open" ? "Opened" : "Resolved"]}
                      labelFormatter={(l) => `Date: ${l}`}
                    />
                    <Legend formatter={(v) => v === "open" ? "Opened" : "Resolved"} />
                    <Bar dataKey="open" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="resolved" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Recent Admin Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (data?.recentActivity?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                  <Activity className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No admin actions recorded yet</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {data?.recentActivity?.map((item: any) => (
                    <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/40 transition-colors">
                      <SeverityBadge severity={item.severity ?? "info"} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.actorName ?? "System"} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Manage Users", href: "/admin/users", icon: Users },
            { label: "Review KYC", href: "/admin/kyc", icon: FileCheck },
            { label: "Compliance Cases", href: "/admin/compliance", icon: AlertTriangle },
            { label: "Audit Log", href: "/admin/audit-log", icon: Activity },
            { label: "Analytics", href: "/admin/analytics", icon: BarChart2 },
            { label: "Seed Demo Data", href: "/admin/seed-data", icon: Database },
            { label: "Stripe Testing", href: "/admin/stripe-test", icon: CreditCard },
            { label: "Readiness Check", href: "/admin/readiness", icon: Rocket },
            { label: "Scheduled Jobs", href: "/admin/scheduled-jobs", icon: Clock },
            { label: "Invite Codes", href: "/admin/invite-codes", icon: Key },
            { label: "Partner Analytics", href: "/admin/partner-analytics", icon: BarChart2 },
            { label: "Tenants", href: "/admin/tenants", icon: Building2 },
            { label: "White Label", href: "/admin/white-label", icon: Globe },
          ].map((link) => (
            <button
              key={link.href}
              onClick={() => navigate(link.href)}
              className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
            >
              <link.icon className="h-4 w-4 text-primary" />
              {link.label}
            </button>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
