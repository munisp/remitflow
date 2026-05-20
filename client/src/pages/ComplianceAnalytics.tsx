import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, PieChart, Pie
} from "recharts";
import {
  TrendingUp, AlertTriangle, Clock, CheckCircle, Shield, BarChart2, PieChart as PieIcon
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
};

const BUCKET_COLORS = ["#22c55e", "#84cc16", "#eab308", "#f97316", "#ef4444"];

export default function ComplianceAnalytics() {
  const [days, setDays] = useState(30);

  const { data: summary } = trpc.complianceAnalytics.summary.useQuery({ days });
  const { data: timeSeries } = trpc.complianceAnalytics.timeSeries.useQuery({ days });
  const { data: severityTrend } = trpc.complianceAnalytics.severityTrend.useQuery({ days });
  const { data: resolutionTime } = trpc.complianceAnalytics.resolutionTime.useQuery({ days });
  const { data: falsePositiveRate } = trpc.complianceAnalytics.falsePositiveRate.useQuery({ days });
  const { data: alertTypeDistribution } = trpc.complianceAnalytics.alertTypeDistribution.useQuery({ days });
  const { data: officerTrend } = trpc.complianceAnalytics.officerPerformanceTrend.useQuery();

  const PIE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

  const dayOptions = [
    { value: 7, label: "Last 7 days" },
    { value: 14, label: "Last 14 days" },
    { value: 30, label: "Last 30 days" },
    { value: 60, label: "Last 60 days" },
    { value: 90, label: "Last 90 days" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="w-6 h-6 text-primary" /> Compliance Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Alert volume, resolution times, and false-positive rates across all compliance workflows
            </p>
          </div>
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dayOptions.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* KPI Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Total Alerts", value: summary.total, icon: <Shield className="w-4 h-4 text-primary" />, color: "text-foreground" },
              { label: "Open", value: summary.open, icon: <AlertTriangle className="w-4 h-4 text-red-500" />, color: "text-red-600" },
              { label: "Resolved", value: summary.resolved, icon: <CheckCircle className="w-4 h-4 text-green-500" />, color: "text-green-600" },
              { label: "Escalated", value: summary.escalated, icon: <TrendingUp className="w-4 h-4 text-orange-500" />, color: "text-orange-600" },
              { label: "Critical Open", value: summary.criticalOpen, icon: <AlertTriangle className="w-4 h-4 text-red-700" />, color: "text-red-700" },
              { label: "Avg Resolution", value: summary.avgResolutionHours ? `${summary.avgResolutionHours}h` : "—", icon: <Clock className="w-4 h-4 text-blue-500" />, color: "text-blue-600" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-muted-foreground">{s.label}</span></div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Alert Volume Time-Series */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Daily Alert Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            {timeSeries && timeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeSeries} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    labelFormatter={d => `Date: ${d}`}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="total" name="Total" stroke="hsl(var(--primary))" fill="url(#totalGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data for this period</div>
            )}
          </CardContent>
        </Card>

        {/* Severity Trend + Resolution Time side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Severity Trend (stacked bar) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" /> Alerts by Severity (Daily)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {severityTrend && severityTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={severityTrend} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="critical" name="Critical" stackId="a" fill={SEVERITY_COLORS.critical} radius={[0,0,0,0]} />
                    <Bar dataKey="high" name="High" stackId="a" fill={SEVERITY_COLORS.high} />
                    <Bar dataKey="medium" name="Medium" stackId="a" fill={SEVERITY_COLORS.medium} />
                    <Bar dataKey="low" name="Low" stackId="a" fill={SEVERITY_COLORS.low} radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>

          {/* Resolution Time Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Resolution Time Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {resolutionTime && resolutionTime.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={resolutionTime} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => [v, "Alerts"]} />
                    <Bar dataKey="count" name="Alerts" radius={[4,4,0,0]}>
                      {resolutionTime.map((_, i) => (
                        <Cell key={i} fill={BUCKET_COLORS[i % BUCKET_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No resolved alerts in this period</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Alert Type Distribution Pie + Officer Performance Trend side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Alert Type Distribution Pie */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <PieIcon className="h-4 w-4 text-primary" /> Alert Type Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertTypeDistribution && alertTypeDistribution.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie
                        data={alertTypeDistribution}
                        dataKey="count"
                        nameKey="alertType"
                        cx="50%" cy="50%"
                        outerRadius={70}
                        innerRadius={40}
                      >
                        {alertTypeDistribution.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                        formatter={(v: number, name: string) => [v, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    {alertTypeDistribution.map((row, i) => (
                      <div key={row.alertType} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="truncate text-muted-foreground">{row.alertType}</span>
                        <span className="ml-auto font-medium">{row.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>

          {/* Officer Performance Trend */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Officer Resolution Rate (4-week trend)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {officerTrend && !Array.isArray(officerTrend) && officerTrend.weeks && officerTrend.weeks.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={officerTrend.weeks} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                    <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => [`${v}%`, "Resolution Rate"]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    {officerTrend.officers.map((officer: any, i: any) => (
                      <Line
                        key={officer}
                        type="monotone"
                        dataKey={officer}
                        name={officer}
                        stroke={PIE_COLORS[i % PIE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No assigned alerts in the last 28 days</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* False-Positive Rate by Alert Type */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <PieIcon className="h-4 w-4 text-primary" /> False-Positive Rate by Alert Type
              <span className="text-xs text-muted-foreground font-normal ml-1">(dismissed / total)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {falsePositiveRate && falsePositiveRate.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 font-medium">Alert Type</th>
                      <th className="text-right py-2 font-medium">Total</th>
                      <th className="text-right py-2 font-medium">Resolved</th>
                      <th className="text-right py-2 font-medium">Escalated</th>
                      <th className="text-right py-2 font-medium">Dismissed</th>
                      <th className="text-right py-2 font-medium">False Positive %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {falsePositiveRate.map(row => (
                      <tr key={row.alertType} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2.5">
                          <Badge variant="outline" className="font-mono text-xs">{row.alertType}</Badge>
                        </td>
                        <td className="text-right py-2.5 font-medium">{row.total}</td>
                        <td className="text-right py-2.5 text-green-600">{row.resolved}</td>
                        <td className="text-right py-2.5 text-orange-600">{row.escalated}</td>
                        <td className="text-right py-2.5 text-gray-500">{row.dismissed}</td>
                        <td className="text-right py-2.5">
                          <span className={`font-semibold ${row.falsePositivePct > 30 ? "text-red-600" : row.falsePositivePct > 15 ? "text-yellow-600" : "text-green-600"}`}>
                            {row.falsePositivePct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-sm">No data for this period</div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
