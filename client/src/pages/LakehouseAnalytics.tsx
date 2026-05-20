import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from "recharts";
import { Database, TrendingUp, Globe, Activity, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";

const RAIL_COLORS: Record<string, string> = {
  cips: "#ef4444",
  upi: "#f97316",
  pix: "#22c55e",
  mojaloop: "#3b82f6",
  swift: "#a855f7",
  sepa: "#6366f1",
  ach: "#0ea5e9",
  faster_payments: "#14b8a6",
};

const RAIL_FLAGS: Record<string, string> = {
  cips: "🇨🇳", upi: "🇮🇳", pix: "🇧🇷", mojaloop: "🌍",
  swift: "🌐", sepa: "🇪🇺", ach: "🇺🇸", faster_payments: "🇬🇧",
};

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

export default function LakehouseAnalytics() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "1y">("30d");
  const [selectedRail, setSelectedRail] = useState<string>("all");

  const { data, isLoading, refetch, isFetching } = trpc.v90.paymentRails.getAnalytics.useQuery({
    period,
    rail: selectedRail === "all" ? undefined : selectedRail,
  });

  const handleExport = () => {
    if (!data) return;
    const csv = [
      "Rail,Total Volume,Transactions,Avg Size,Success Rate,Settlement Time (s)",
      ...data.volumeByRail.map((r: any) =>
        `${r.rail},${r.totalVolume.toFixed(0)},${r.totalTransactions},${r.avgTransactionSize.toFixed(0)},${r.successRate.toFixed(2)},${r.avgSettlementTime}`
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `remitflow-analytics-${period}.csv`;
    a.click();
    toast.success("Analytics exported as CSV");
  };

  const pieData = data?.volumeByRail?.map((r: any) => ({
    name: r.rail.toUpperCase(),
    value: Math.round(r.totalVolume),
    color: RAIL_COLORS[r.rail] || "#888",
  })) || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6" />
              Lakehouse Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Transaction volume and trends across all payment rails · DuckDB + Apache Iceberg
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7d</SelectItem>
                <SelectItem value="30d">Last 30d</SelectItem>
                <SelectItem value="90d">Last 90d</SelectItem>
                <SelectItem value="1y">Last 1y</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedRail} onValueChange={setSelectedRail}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Rails</SelectItem>
                {["cips", "upi", "pix", "mojaloop", "swift", "sepa", "ach", "faster_payments"].map((r) => (
                  <SelectItem key={r} value={r}>{RAIL_FLAGS[r]} {r.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary KPIs */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total Volume</div>
                <div className="text-2xl font-bold mt-1">{formatCurrency(data.summary.totalVolume)}</div>
                <div className="text-xs text-green-600 mt-1">+12.4% vs prev period</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total Transactions</div>
                <div className="text-2xl font-bold mt-1">{formatNumber(data.summary.totalTransactions)}</div>
                <div className="text-xs text-green-600 mt-1">+8.7% vs prev period</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Avg Success Rate</div>
                <div className="text-2xl font-bold mt-1">{data.summary.avgSuccessRate.toFixed(1)}%</div>
                <div className="text-xs text-green-600 mt-1">+0.3% vs prev period</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Active Rails</div>
                <div className="text-2xl font-bold mt-1">{data.summary.activeRails}</div>
                <div className="text-xs text-muted-foreground mt-1">of 8 total</div>
              </CardContent>
            </Card>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mr-3" />
            Loading analytics from Lakehouse...
          </div>
        )}

        {data && (
          <Tabs defaultValue="volume">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="volume"><BarChart className="h-4 w-4 mr-2" />Volume</TabsTrigger>
              <TabsTrigger value="trend"><TrendingUp className="h-4 w-4 mr-2" />Daily Trend</TabsTrigger>
              <TabsTrigger value="share"><Globe className="h-4 w-4 mr-2" />Market Share</TabsTrigger>
              <TabsTrigger value="corridors"><Activity className="h-4 w-4 mr-2" />Corridors</TabsTrigger>
            </TabsList>

            {/* Volume by Rail */}
            <TabsContent value="volume" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Transaction Volume by Rail</CardTitle>
                  <CardDescription>Total USD volume processed per payment rail in {period}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={data.volumeByRail} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="rail" tickFormatter={(v) => v.toUpperCase()} className="text-xs" />
                      <YAxis tickFormatter={(v) => formatCurrency(v)} className="text-xs" />
                      <Tooltip
                        formatter={(v: number, name: string) => [formatCurrency(v), name === "totalVolume" ? "Volume" : name]}
                        labelFormatter={(l) => `${RAIL_FLAGS[l] || ""} ${l.toUpperCase()}`}
                      />
                      <Bar dataKey="totalVolume" name="Volume" radius={[4, 4, 0, 0]}>
                        {data.volumeByRail.map((r: any) => (
                          <Cell key={r.rail} fill={RAIL_COLORS[r.rail] || "#888"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Rail table */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2">Rail</th>
                          <th className="text-right py-2">Volume</th>
                          <th className="text-right py-2">Txns</th>
                          <th className="text-right py-2">Avg Size</th>
                          <th className="text-right py-2">Success</th>
                          <th className="text-right py-2">Settlement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.volumeByRail.map((r: any) => (
                          <tr key={r.rail} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2">
                              <span className="mr-1">{RAIL_FLAGS[r.rail]}</span>
                              <span className="font-medium">{r.rail.toUpperCase()}</span>
                            </td>
                            <td className="py-2 text-right font-mono">{formatCurrency(r.totalVolume)}</td>
                            <td className="py-2 text-right">{formatNumber(r.totalTransactions)}</td>
                            <td className="py-2 text-right">${r.avgTransactionSize.toFixed(0)}</td>
                            <td className="py-2 text-right">
                              <Badge variant={r.successRate >= 99 ? "default" : r.successRate >= 97 ? "secondary" : "destructive"}>
                                {r.successRate.toFixed(1)}%
                              </Badge>
                            </td>
                            <td className="py-2 text-right text-muted-foreground">
                              {r.avgSettlementTime < 60 ? `${r.avgSettlementTime}s` :
                               r.avgSettlementTime < 3600 ? `${Math.round(r.avgSettlementTime / 60)}m` :
                               `${Math.round(r.avgSettlementTime / 3600)}h`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Daily Trend */}
            <TabsContent value="trend" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Daily Transaction Volume Trend</CardTitle>
                  <CardDescription>Volume over time across all active rails</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={data.dailyTrend} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} className="text-xs" />
                      <YAxis tickFormatter={(v) => formatCurrency(v)} className="text-xs" />
                      <Tooltip
                        formatter={(v: number) => [formatCurrency(v), "Volume"]}
                        labelFormatter={(l) => `Date: ${l}`}
                      />
                      <Area type="monotone" dataKey="volume" stroke="#6366f1" fill="url(#volGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>

                  <div className="mt-4">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.dailyTrend} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip labelFormatter={(l) => `Date: ${l}`} />
                        <Bar dataKey="transactions" name="Transactions" fill="#22c55e" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Market Share Pie */}
            <TabsContent value="share" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Volume Market Share</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={110}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {pieData.map((entry: any, i: number) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rail Performance Matrix</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data.volumeByRail.map((r: any) => {
                        const share = (r.totalVolume / data.summary.totalVolume) * 100;
                        return (
                          <div key={r.rail}>
                            <div className="flex justify-between text-sm mb-1">
                              <span>{RAIL_FLAGS[r.rail]} {r.rail.toUpperCase()}</span>
                              <span className="text-muted-foreground">{share.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${share}%`, backgroundColor: RAIL_COLORS[r.rail] || "#888" }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Top Corridors */}
            <TabsContent value="corridors" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Payment Corridors</CardTitle>
                  <CardDescription>Highest volume currency pairs by rail</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.topCorridors.map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div className="text-lg font-bold text-muted-foreground w-6">{i + 1}</div>
                        <div className="flex-1">
                          <div className="font-medium">
                            {c.from} → {c.to}
                            <Badge variant="outline" className="ml-2 text-xs">
                              {RAIL_FLAGS[c.rail]} {c.rail.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatNumber(c.count)} transactions
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatCurrency(c.volume)}</div>
                          <div className="text-xs text-muted-foreground">volume</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Lakehouse Info */}
        <Card className="border-dashed">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Lakehouse Architecture:</span>{" "}
                Transaction data is ingested via Kafka → stored in Apache Iceberg format on S3 →
                queried in real-time by DuckDB (python-lakehouse-service on port 8086).
                Analytics are pre-aggregated hourly and cached in Redis for sub-100ms dashboard loads.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
