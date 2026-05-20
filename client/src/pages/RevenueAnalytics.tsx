import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, DollarSign, Users, BarChart3, ArrowUp, ArrowDown } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function RevenueAnalytics() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "1y">("30d");

  const { data: revenue } = trpc.v98.analytics.revenue.useQuery({ period });
  const { data: topCorridors } = trpc.v98.analytics.topCorridors.useQuery({ period, limit: 10 });
  const { data: userGrowth } = trpc.v98.analytics.userGrowth.useQuery({ period });

  const summary = revenue?.summary;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Revenue Analytics</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Platform revenue, volume, and growth metrics
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="1y">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Revenue",
            value: `$${(Number(summary?.totalRevenue ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            change: summary?.revenueChange ?? 0,
            icon: DollarSign,
            color: "text-green-500",
          },
          {
            label: "Transaction Volume",
            value: `$${(Number(summary?.totalVolume ?? 0) / 1000).toFixed(1)}K`,
            change: summary?.volumeChange ?? 0,
            icon: BarChart3,
            color: "text-blue-500",
          },
          {
            label: "Active Users",
            value: (summary?.activeUsers ?? 0).toLocaleString(),
            change: summary?.userChange ?? 0,
            icon: Users,
            color: "text-purple-500",
          },
          {
            label: "Avg Fee Rate",
            value: `${(Number(summary?.avgFeeRate ?? 0)).toFixed(2)}%`,
            change: summary?.feeRateChange ?? 0,
            icon: TrendingUp,
            color: "text-orange-500",
          },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {kpi.change >= 0 ? (
                      <ArrowUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-red-500" />
                    )}
                    <span className={`text-xs ${kpi.change >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {Math.abs(kpi.change).toFixed(1)}% vs prev period
                    </span>
                  </div>
                </div>
                <kpi.icon className={`h-8 w-8 ${kpi.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Revenue by Source */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Source</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(revenue?.bySource ?? []).map((s) => (
                <div key={s.source}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="capitalize">{s.source.replace("_", " ")}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">${Number(s.amount).toLocaleString()}</span>
                      <Badge variant="outline" className="text-xs">{s.percentage.toFixed(1)}%</Badge>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${s.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
              {!(revenue?.bySource?.length) && (
                <p className="text-sm text-muted-foreground text-center py-4">No data for selected period</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Corridors by Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(topCorridors ?? []).slice(0, 8).map((c: any, i: any) => (
                <div key={`${c.fromCurrency}-${c.toCurrency}`} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-5">{i + 1}.</span>
                    <span className="font-medium text-sm">{c.fromCurrency} → {c.toCurrency}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">${Number(c.volume).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{c.txCount} txns</p>
                  </div>
                </div>
              ))}
              {!(topCorridors?.length) && (
                <p className="text-sm text-muted-foreground text-center py-4">No corridor data yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Growth */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">User Growth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "New Signups", value: userGrowth?.newSignups ?? 0, color: "text-blue-500" },
              { label: "KYC Verified", value: userGrowth?.kycVerified ?? 0, color: "text-green-500" },
              { label: "First Transfer", value: userGrowth?.firstTransfer ?? 0, color: "text-purple-500" },
              { label: "Churned", value: userGrowth?.churned ?? 0, color: "text-red-500" },
            ].map((s) => (
              <div key={s.label} className="text-center p-3 border rounded-lg">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
