import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Activity, Users, Award } from "lucide-react";

const PERIOD_OPTIONS = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 14 days", value: 14 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 60 days", value: 60 },
  { label: "Last 90 days", value: 90 },
];

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-semibold mb-1">{formatDate(label)}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.name === "Transactions" ? p.value : formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function DailyVolumeWidget() {
  const [days, setDays] = useState(30);
  const [chartType, setChartType] = useState<"area" | "bar" | "line">("area");

  const { data, isLoading } = trpc.volumeWidget.daily.useQuery({ days });

  const chartData = data?.data.map((d: any) => ({
    date: d.date,
    "Volume ($)": d.volumeUsd,
    "Fees ($)": d.feesUsd,
    "Transactions": d.transactions,
  })) ?? [];

  const summary = data?.summary;

  // Calculate trend (compare last 7 days vs previous 7 days)
  const recentData = data?.data.slice(-7) ?? [];
  const prevData = data?.data.slice(-14, -7) ?? [];
  const recentVolume = recentData.reduce((s: any, d: any) => s + d.volumeUsd, 0);
  const prevVolume = prevData.reduce((s: any, d: any) => s + d.volumeUsd, 0);
  const trend = prevVolume > 0 ? ((recentVolume - prevVolume) / prevVolume) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Transaction Volume</h1>
            <p className="text-muted-foreground">Daily transaction volume and transfer amounts</p>
          </div>
          <div className="flex gap-2">
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex border rounded-md overflow-hidden">
              {(["area", "bar", "line"] as const).map(t => (
                <Button key={t} variant={chartType === t ? "default" : "ghost"} size="sm" className="rounded-none capitalize" onClick={() => setChartType(t)}>{t}</Button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">Total Volume</span>
              </div>
              <p className="text-2xl font-bold">{isLoading ? "—" : formatCurrency(summary?.totalVolume ?? 0)}</p>
              <div className="flex items-center gap-1 mt-1">
                {trend >= 0 ? <TrendingUp className="h-3 w-3 text-green-500" /> : <TrendingDown className="h-3 w-3 text-red-500" />}
                <span className={`text-xs ${trend >= 0 ? "text-green-500" : "text-red-500"}`}>{trend >= 0 ? "+" : ""}{trend.toFixed(1)}% vs prev week</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">Total Transactions</span>
              </div>
              <p className="text-2xl font-bold">{isLoading ? "—" : (summary?.totalTxns ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Over {days} days</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-purple-500" />
                <span className="text-sm text-muted-foreground">Avg Daily Volume</span>
              </div>
              <p className="text-2xl font-bold">{isLoading ? "—" : formatCurrency(summary?.avgDailyVolume ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Per day average</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Award className="h-4 w-4 text-orange-500" />
                <span className="text-sm text-muted-foreground">Peak Day</span>
              </div>
              <p className="text-lg font-bold">{isLoading ? "—" : (summary?.peakDay ? formatCurrency(summary.peakDay.volumeUsd) : "$0")}</p>
              <p className="text-xs text-muted-foreground mt-1">{summary?.peakDay ? formatDate(summary.peakDay.date) : "No data"}</p>
            </CardContent>
          </Card>
        </div>

        {/* Volume Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Daily Volume & Fees
              {!isLoading && <Badge variant="outline" className="ml-auto">{days} day view</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">Loading chart data...</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                {chartType === "area" ? (
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="volumeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="feesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="Volume ($)" stroke="hsl(var(--primary))" fill="url(#volumeGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="Fees ($)" stroke="#f59e0b" fill="url(#feesGrad)" strokeWidth={2} />
                  </AreaChart>
                ) : chartType === "bar" ? (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="Volume ($)" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Fees ($)" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  </BarChart>
                ) : (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="Volume ($)" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Fees ($)" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Transaction Count Chart */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Daily Transaction Count</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Transactions" fill="#6366f1" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Data Table */}
        <Card>
          <CardHeader><CardTitle>Daily Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="text-left p-3">Date</th>
                    <th className="text-right p-3">Transactions</th>
                    <th className="text-right p-3">Volume</th>
                    <th className="text-right p-3">Fees</th>
                    <th className="text-right p-3">Fee Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.data ?? []).slice().reverse().slice(0, 14).map((d: any) => (
                    <tr key={d.date} className="border-b hover:bg-muted/20">
                      <td className="p-3 font-medium">{formatDate(d.date)}</td>
                      <td className="p-3 text-right">{d.transactions.toLocaleString()}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(d.volumeUsd)}</td>
                      <td className="p-3 text-right text-orange-600">{formatCurrency(d.feesUsd)}</td>
                      <td className="p-3 text-right text-muted-foreground">{d.volumeUsd > 0 ? ((d.feesUsd / d.volumeUsd) * 100).toFixed(2) : "0.00"}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
