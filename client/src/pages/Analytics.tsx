import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Users, ArrowUpRight, BarChart2, Activity, Calendar, Download } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

type DateRange = "1m" | "3m" | "6m" | "12m" | "custom";
const DATE_RANGE_OPTIONS: { label: string; value: DateRange; months: number }[] = [
  { label: "1M", value: "1m", months: 1 },
  { label: "3M", value: "3m", months: 3 },
  { label: "6M", value: "6m", months: 6 },
  { label: "12M", value: "12m", months: 12 },
];

// CSV export utility
function exportToCSV(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h];
        const s = v === null || v === undefined ? "" : String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CORRIDOR_COLORS: Record<string, string> = {
  NGN: "#f59e0b", KES: "#10b981", GHS: "#3b82f6", ZAR: "#8b5cf6",
  USD: "#06b6d4", GBP: "#ec4899", EUR: "#f97316", Other: "#6b7280",
};

function StatCard({ title, value, sub, icon: Icon, trend }: {
  title: string; value: string; sub?: string; icon: React.ElementType; trend?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${trend >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(trend)}% vs last period
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Analytics() {
  const { t } = useTranslation();
  
  const [dateRange, setDateRange] = useState<DateRange>("6m");
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const selectedMonths = useMemo(() => {
    if (dateRange === "custom") {
      const diff = Math.ceil((new Date(customTo).getTime() - new Date(customFrom).getTime()) / (30 * 86400000));
      return Math.max(1, Math.min(24, Math.round(diff / 30)));
    }
    return DATE_RANGE_OPTIONS.find(o => o.value === dateRange)?.months ?? 6;
  }, [dateRange, customFrom, customTo]);

  const overviewPeriod = selectedMonths <= 1 ? "7d" : selectedMonths <= 3 ? "30d" : "90d";

  const { data: overview, isLoading: loadingOverview } = trpc.analytics.overview.useQuery({ period: overviewPeriod });
  const { data: corridorData, isLoading: loadingCorridor } = trpc.analytics.spendByCorridorMonthly.useQuery();
  const { data: trendData, isLoading: loadingTrend } = trpc.analytics.transferTrend.useQuery();
  const { data: topRecipients, isLoading: loadingRecipients } = trpc.analytics.topRecipients.useQuery();

  const filteredCorridorData = useMemo(() => {
    if (!corridorData) return corridorData;
    const data = corridorData.data.slice(-selectedMonths);
    const months = corridorData.months.slice(-selectedMonths);
    return { ...corridorData, data, months };
  }, [corridorData, selectedMonths]);

  const filteredTrendData = useMemo(() => {
    if (!trendData) return trendData;
    return trendData.slice(-selectedMonths);
  }, [trendData, selectedMonths]);

  const formatAmount = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K`
    : `$${n.toFixed(0)}`;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header with date range filter */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-primary" />
              {'Spending Analytics'}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {'Insights into your transfer patterns and spending corridors'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-1">
              {DATE_RANGE_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={dateRange === opt.value ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setDateRange(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={dateRange === "custom" ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setDateRange("custom")}
              >
                Custom
              </Button>
            </div>
            {dateRange === "custom" && (
              <div className="flex items-center gap-1 text-xs">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground"
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground"
                />
              </div>
            )}
          </div>
        </div>

        {/* Overview Stats */}
        {loadingOverview ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title={'Total Volume (30d)'}
              value={formatAmount(overview?.totalVolume ?? 0)}
              icon={Activity}
              trend={8.4}
            />
            <StatCard
              title={'Total Sent'}
              value={formatAmount(overview?.totalSent ?? 0)}
              icon={ArrowUpRight}
              trend={12.1}
            />
            <StatCard
              title={'Transactions'}
              value={String(overview?.transactionCount ?? 0)}
              sub={'Last 30 days'}
              icon={BarChart2}
            />
            <StatCard
              title={'Success Rate'}
              value={`${(overview?.successRate ?? 0).toFixed(1)}%`}
              icon={TrendingUp}
              trend={2.3}
            />
          </div>
        )}

        {/* Spend by Corridor (Monthly Bar Chart) */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>{'Monthly Spend by Destination Currency'}</CardTitle>
                <CardDescription>{'Last 6 months — grouped by target currency'}</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs shrink-0"
                disabled={!filteredCorridorData?.data?.length}
                onClick={() => {
                  const rows = (filteredCorridorData?.data ?? []).map(row => ({ ...row }));
                  exportToCSV(`corridor-spend-${dateRange}.csv`, rows as Record<string, unknown>[]);
                }}
              >
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingCorridor ? (
              <Skeleton className="h-72 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredCorridorData?.data ?? []} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={v => formatAmount(Number(v))} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatAmount(v)} />
                  <Legend />
                  {(filteredCorridorData?.corridors ?? []).map(c => (
                    <Bar key={c} dataKey={c} stackId="a" fill={CORRIDOR_COLORS[c] ?? "#6b7280"} radius={c === (filteredCorridorData?.corridors?.at(-1) ?? "") ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Transfer Trend (Line Chart) */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>{'Average Transfer Size Trend'}</CardTitle>
                <CardDescription>{'Last 12 months — average and total per month'}</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs shrink-0"
                disabled={!filteredTrendData?.length}
                onClick={() => {
                  exportToCSV(`transfer-trend-${dateRange}.csv`, (filteredTrendData ?? []) as Record<string, unknown>[]);
                }}
              >
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingTrend ? (
              <Skeleton className="h-72 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={filteredTrendData ?? []} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tickFormatter={v => formatAmount(Number(v))} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [name === "count" ? v : formatAmount(v), name]} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="avgSize" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name={'Avg Size'} />
                  <Line yAxisId="left" type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name={'Total'} strokeDasharray="5 5" />
                  <Line yAxisId="right" type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name={'Count'} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top Recipients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              {'Top Recipients'}
            </CardTitle>
            <CardDescription>{'Your most frequent transfer recipients by total amount'}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRecipients ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : (topRecipients ?? []).length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>{'No transfer history yet'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(topRecipients ?? []).map((r) => (
                  <div key={r.rank} className="flex items-center gap-4 p-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                    <span className="text-lg font-bold text-muted-foreground w-6 text-center">#{r.rank}</span>
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                        {r.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.count} transfer{r.count !== 1 ? "s" : ""} · {r.currency}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatAmount(r.total)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.lastSent).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="secondary" className="ml-2 hidden sm:flex">
                      {r.currency}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
