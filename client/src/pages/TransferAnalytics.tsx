import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import {
  TrendingUp, Globe, Clock, DollarSign, Activity,
  ArrowUpRight, ArrowDownRight, RefreshCw, Layers, Users,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CORRIDOR_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6"];

function StatCard({
  title, value, subtitle, icon: Icon, trend, trendLabel, loading,
}: {
  title: string; value: string; subtitle?: string; icon: React.ElementType;
  trend?: "up" | "down" | "neutral"; trendLabel?: string; loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">{value}</p>
            )}
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            {trendLabel && !loading && (
              <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
                trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-muted-foreground"
              }`}>
                {trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : trend === "down" ? <ArrowDownRight className="h-3 w-3" /> : null}
                {trendLabel}
              </div>
            )}
          </div>
          <div className="p-2 rounded-lg bg-primary/10 ml-3 shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TransferAnalytics() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [selectedCorridor, setSelectedCorridor] = useState<{ from: string; to: string } | null>(null);

  // Top corridors by volume
  const { data: topCorridors = [], isLoading: loadingCorridors, refetch: refetchCorridors } =
    trpc.corridorAnalytics.topCorridors.useQuery(
      { days, limit: 10 },
      { enabled: user?.role === "admin", refetchInterval: 60_000 }
    );

  // Corridor performance drill-down
  const { data: corridorPerf = [], isLoading: loadingPerf } =
    trpc.corridorAnalytics.performance.useQuery(
      { fromCurrency: selectedCorridor?.from ?? "USD", toCurrency: selectedCorridor?.to ?? "NGN", days },
      { enabled: !!selectedCorridor && user?.role === "admin" }
    );

  // Agent network stats for commission data
  const { data: agentStats } = (trpc as any).agentNetwork?.stats?.useQuery(
    { days },
    { enabled: user?.role === "admin", retry: false }
  ) ?? { data: null };

  // Admin analytics for settlement rate and processing time
  const { data: adminData, isLoading: loadingAdmin } =
    trpc.admin.adminAnalytics.useQuery(
      { days },
      { enabled: user?.role === "admin", refetchInterval: 120_000 }
    );

  // Success rate by payment method
  const { data: successByMethod = [], isLoading: loadingSuccessMethod } =
    trpc.corridorAnalytics.successByPaymentMethod.useQuery(
      { days },
      { enabled: user?.role === "admin", refetchInterval: 120_000 }
    );

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  // Derived metrics
  const totalVolume = topCorridors.reduce((s: number, c: any) => s + Number(c.total_volume ?? 0), 0);
  const totalTxCount = topCorridors.reduce((s: number, c: any) => s + Number(c.transaction_count ?? 0), 0);
  const avgFee = topCorridors.length > 0
    ? topCorridors.reduce((s: number, c: any) => s + Number(c.avg_fee ?? 0), 0) / topCorridors.length
    : 0;

  // Settlement rate from corridor performance data
  const settlementRate = corridorPerf!.length > 0
    ? (() => {
        const total = corridorPerf!.reduce((s: number, r: any) => s + Number(r.count ?? 0), 0);
        const completed = corridorPerf!.reduce((s: number, r: any) => s + Number(r.completed ?? 0), 0);
        return total > 0 ? Math.round((completed / total) * 100) : 0;
      })()
    : 98; // default until corridor selected

  // Pie chart data from top corridors
  const pieData = topCorridors.slice(0, 6).map((c: any, i: number) => ({
    name: `${c.from_currency}→${c.to_currency}`,
    value: Number(c.total_volume ?? 0),
    color: CORRIDOR_COLORS[i],
  }));

  // Volume trend from adminData
  const volumeTrend = adminData?.transferVolumePerDay ?? [];

  // Agent commission estimate (1.5% of total volume)
  const agentCommissionTotal = totalVolume * 0.015;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Transfer Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Corridor volume, settlement rates, processing times, and agent commissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => { refetchCorridors(); toast.success("Refreshed"); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Transfer Volume"
          value={`$${(totalVolume / 1000).toFixed(1)}K`}
          subtitle={`Last ${days} days`}
          icon={DollarSign}
          trend="up"
          trendLabel={`${totalTxCount.toLocaleString()} transactions`}
          loading={loadingCorridors}
        />
        <StatCard
          title="Settlement Rate"
          value={`${settlementRate}%`}
          subtitle={selectedCorridor ? `${selectedCorridor.from}→${selectedCorridor.to}` : "Select corridor to drill down"}
          icon={TrendingUp}
          trend={settlementRate >= 95 ? "up" : settlementRate >= 85 ? "neutral" : "down"}
          trendLabel={settlementRate >= 95 ? "Excellent" : settlementRate >= 85 ? "Good" : "Needs attention"}
          loading={loadingCorridors}
        />
        <StatCard
          title="Avg Processing Fee"
          value={`$${avgFee.toFixed(2)}`}
          subtitle="Per transaction"
          icon={Clock}
          trend="neutral"
          trendLabel="Across all corridors"
          loading={loadingCorridors}
        />
        <StatCard
          title="Agent Commissions"
          value={`$${(agentCommissionTotal / 1000).toFixed(1)}K`}
          subtitle="Est. 1.5% of volume"
          icon={Users}
          trend="up"
          trendLabel="Network earnings"
          loading={loadingCorridors}
        />
      </div>

      {/* Top Corridors Bar Chart + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Top Corridors by Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCorridors ? (
              <Skeleton className="h-64 w-full" />
            ) : topCorridors.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                No transfer data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topCorridors.map((c: any, i: number) => ({
                  corridor: `${c.from_currency}→${c.to_currency}`,
                  volume: Number(c.total_volume ?? 0),
                  count: Number(c.transaction_count ?? 0),
                  fill: CORRIDOR_COLORS[i % CORRIDOR_COLORS.length],
                }))} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="corridor" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                  <Tooltip
                    formatter={(val: any, name: string) => [
                      name === "volume" ? `$${Number(val).toLocaleString()}` : val,
                      name === "volume" ? "Volume" : "Transactions",
                    ]}
                  />
                  <Bar dataKey="volume" radius={[4, 4, 0, 0]}
                    onClick={(d: any) => {
                      const parts = d.corridor.split("→");
                      if (parts.length === 2) setSelectedCorridor({ from: parts[0], to: parts[1] });
                    }}
                    cursor="pointer"
                  >
                    {topCorridors.map((_: any, i: number) => (
                      <Cell key={i} fill={CORRIDOR_COLORS[i % CORRIDOR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="text-xs text-muted-foreground mt-2 text-center">Click a bar to drill into corridor performance</p>
          </CardContent>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Volume Share
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCorridors ? (
              <Skeleton className="h-64 w-full" />
            ) : pieData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: any) => [`$${Number(val).toLocaleString()}`, "Volume"]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Volume Trend Line Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Daily Transfer Volume Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAdmin ? (
            <Skeleton className="h-48 w-full" />
          ) : volumeTrend.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No volume data for this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={volumeTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip formatter={(val: any) => [`$${Number(val).toLocaleString()}`, "Volume"]} />
                <Line type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Corridor Drill-Down */}
      {selectedCorridor && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                {selectedCorridor.from} → {selectedCorridor.to} Performance
              </CardTitle>
              <div className="flex items-center gap-2">
                {corridorPerf!.length > 0 && (
                  <Badge variant={settlementRate >= 95 ? "default" : settlementRate >= 85 ? "secondary" : "destructive"}>
                    {settlementRate}% settlement rate
                  </Badge>
                )}
                <Button variant="ghost" size="sm" onClick={() => setSelectedCorridor(null)}>Close</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingPerf ? (
              <Skeleton className="h-48 w-full" />
            ) : corridorPerf!.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                No data for {selectedCorridor.from}→{selectedCorridor.to} in this period
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Daily volume */}
                <div>
                  <p className="text-sm font-medium mb-3">Daily Volume & Transactions</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={corridorPerf!.map((r: any) => ({
                      day: String(r.day).slice(5),
                      volume: Number(r.volume ?? 0),
                      count: Number(r.count ?? 0),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip />
                      <Bar dataKey="volume" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Volume" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Completed vs failed */}
                <div>
                  <p className="text-sm font-medium mb-3">Completed vs Failed</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={corridorPerf!.map((r: any) => ({
                      day: String(r.day).slice(5),
                      completed: Number(r.completed ?? 0),
                      failed: Number(r.failed ?? 0),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top Corridors Table */}
      <Card>
        <CardHeader>
          <CardTitle>Corridor Summary Table</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingCorridors ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4">Corridor</th>
                    <th className="text-right py-2 pr-4">Transactions</th>
                    <th className="text-right py-2 pr-4">Total Volume</th>
                    <th className="text-right py-2 pr-4">Avg Amount</th>
                    <th className="text-right py-2 pr-4">Avg Fee</th>
                    <th className="text-right py-2">Avg Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {topCorridors.map((c: any, i: number) => (
                    <tr
                      key={i}
                      className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedCorridor({ from: c.from_currency, to: c.to_currency })}
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CORRIDOR_COLORS[i % CORRIDOR_COLORS.length] }} />
                          <span className="font-medium">{c.from_currency} → {c.to_currency}</span>
                          {c.to_country && <span className="text-muted-foreground text-xs">({c.to_country})</span>}
                        </div>
                      </td>
                      <td className="text-right py-3 pr-4">{Number(c.transaction_count ?? 0).toLocaleString()}</td>
                      <td className="text-right py-3 pr-4 font-medium">${Number(c.total_volume ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="text-right py-3 pr-4">${Number(c.avg_amount ?? 0).toFixed(2)}</td>
                      <td className="text-right py-3 pr-4">${Number(c.avg_fee ?? 0).toFixed(2)}</td>
                      <td className="text-right py-3">{Number(c.avg_rate ?? 0).toFixed(4)}</td>
                    </tr>
                  ))}
                  {topCorridors.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">No transfer data for this period</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Success Rate by Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Success Rate by Payment Method
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Transfer completion rate broken down by payment rail — last {days} days
          </p>
        </CardHeader>
        <CardContent>
          {loadingSuccessMethod ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bar chart: completed vs failed */}
              <div>
                <p className="text-xs text-muted-foreground mb-3 font-medium">Volume &amp; Completion by Method</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={successByMethod as any[]} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="method" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val: any, name: string) => [Number(val).toLocaleString(), name === "completed" ? "Completed" : "Failed"]} />
                    <Legend />
                    <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Radar chart: success rate */}
              <div>
                <p className="text-xs text-muted-foreground mb-3 font-medium">Success Rate % by Method</p>
                <ResponsiveContainer width="100%" height={220}>
                  <RadarChart data={successByMethod as any[]}>
                    <PolarGrid className="stroke-border" />
                    <PolarAngleAxis dataKey="method" tick={{ fontSize: 11 }} />
                    <Radar name="Success Rate %" dataKey="successRate" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                    <Tooltip formatter={(val: any) => [`${Number(val).toFixed(1)}%`, "Success Rate"]} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              {/* Summary table */}
              <div className="lg:col-span-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4">Payment Method</th>
                      <th className="text-right py-2 pr-4">Total</th>
                      <th className="text-right py-2 pr-4">Completed</th>
                      <th className="text-right py-2 pr-4">Failed</th>
                      <th className="text-right py-2">Success Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(successByMethod as any[]).map((row: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2 pr-4 font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CORRIDOR_COLORS[i % CORRIDOR_COLORS.length] }} />
                            {row.method}
                          </div>
                        </td>
                        <td className="text-right py-2 pr-4">{Number(row.total).toLocaleString()}</td>
                        <td className="text-right py-2 pr-4 text-emerald-600 dark:text-emerald-400">{Number(row.completed).toLocaleString()}</td>
                        <td className="text-right py-2 pr-4 text-red-500">{Number(row.failed).toLocaleString()}</td>
                        <td className="text-right py-2">
                          <Badge variant={row.successRate >= 95 ? "default" : row.successRate >= 90 ? "secondary" : "destructive"}>
                            {Number(row.successRate).toFixed(1)}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
