/**
 * OfficerWorkload.tsx
 * Compliance Officer Workload Dashboard
 * Shows per-officer open/escalated alert counts, avg resolution time, SAR count.
 */
import { useTranslation } from 'react-i18next';
import { useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Users, AlertTriangle, CheckCircle2, Clock, FileText, TrendingUp, Download
} from "lucide-react";

function DeadlineBadge({ deadline }: { deadline: string | null | undefined }) {
  if (!deadline) return null;
  const now = Date.now();
  const dl = new Date(deadline).getTime();
  const daysLeft = Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <Badge className="bg-red-600 text-white text-xs">Overdue {Math.abs(daysLeft)}d</Badge>;
  if (daysLeft <= 7) return <Badge className="bg-red-100 text-red-800 border border-red-300 text-xs">{daysLeft}d left</Badge>;
  if (daysLeft <= 14) return <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-300 text-xs">{daysLeft}d left</Badge>;
  return <Badge className="bg-green-100 text-green-800 border border-green-300 text-xs">{daysLeft}d left</Badge>;
}

export { DeadlineBadge };

export default function OfficerWorkload() {
  const { t } = useTranslation();
  const { data: officers, isLoading, isError } = trpc.complianceAlerts.officerWorkload.useQuery();

  const totals = useMemo(() => {
    if (!officers) return { total: 0, open: 0, escalated: 0, resolved: 0, sars: 0 };
    return {
      total: officers.reduce((s, o) => s + o.totalAssigned, 0),
      open: officers.reduce((s, o) => s + o.openCount, 0),
      escalated: officers.reduce((s, o) => s + o.escalatedCount, 0),
      resolved: officers.reduce((s, o) => s + o.resolvedCount, 0),
      sars: officers.reduce((s, o) => s + o.sarCount, 0),
    };
  }, [officers]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-500" />
            Officer Workload
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compliance officer alert assignments, resolution performance, and SAR filing activity.
          </p>
        </div>

        {/* CSV Export */}
        {officers && officers.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const header = ["Officer", "Email", "Total Assigned", "Open", "Escalated", "Resolved", "SARs Filed", "Avg Resolution (hrs)"];
                const rows = officers.map(o => [
                  (o as any).officerName ?? o.name ?? "Unknown",
                  (o as any).officerEmail ?? o.email ?? "",
                  o.totalAssigned,
                  o.openCount,
                  o.escalatedCount,
                  o.resolvedCount,
                  o.sarCount,
                  o.avgResolutionHours != null ? Number(o.avgResolutionHours).toFixed(1) : "N/A",
                ]);
                const csv = [header, ...rows].map(r => r.join(",")).join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `officer-workload-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        )}

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total Assigned", value: totals.total, icon: <Users className="h-4 w-4 text-blue-500" />, color: "text-blue-700" },
            { label: "Open / Active", value: totals.open, icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, color: "text-orange-700" },
            { label: "Escalated", value: totals.escalated, icon: <AlertTriangle className="h-4 w-4 text-red-500" />, color: "text-red-700" },
            { label: "Resolved", value: totals.resolved, icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, color: "text-green-700" },
            { label: "SARs Filed", value: totals.sars, icon: <FileText className="h-4 w-4 text-purple-500" />, color: "text-purple-700" },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">{kpi.icon}<span className="text-xs text-muted-foreground">{kpi.label}</span></div>
                <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Officer Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Per-Officer Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !officers?.length ? (
              <div className="py-12 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No compliance officers found. Promote users to admin role to see workload data.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4 font-medium">Officer</th>
                      <th className="text-right py-2 px-3 font-medium">Total</th>
                      <th className="text-right py-2 px-3 font-medium">Open</th>
                      <th className="text-right py-2 px-3 font-medium">Escalated</th>
                      <th className="text-right py-2 px-3 font-medium">Resolved</th>
                      <th className="text-right py-2 px-3 font-medium">SARs</th>
                      <th className="text-right py-2 pl-3 font-medium">Avg Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {officers.map(o => {
                      const workloadPct = totals.total > 0 ? Math.round((o.totalAssigned / totals.total) * 100) : 0;
                      return (
                        <tr key={o.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium">{o.name ?? `Officer #${o.id}`}</div>
                            <div className="text-xs text-muted-foreground">{o.email ?? "—"}</div>
                            {/* Workload bar */}
                            <div className="mt-1 h-1.5 w-32 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${workloadPct}%` }}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{workloadPct}% of total</div>
                          </td>
                          <td className="text-right py-3 px-3 font-semibold">{o.totalAssigned}</td>
                          <td className="text-right py-3 px-3">
                            {o.openCount > 0 ? (
                              <span className="text-orange-600 font-medium">{o.openCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="text-right py-3 px-3">
                            {o.escalatedCount > 0 ? (
                              <span className="text-red-600 font-semibold">{o.escalatedCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="text-right py-3 px-3">
                            <span className="text-green-600">{o.resolvedCount}</span>
                          </td>
                          <td className="text-right py-3 px-3">
                            {o.sarCount > 0 ? (
                              <span className="text-purple-600 font-medium">{o.sarCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="text-right py-3 pl-3">
                            {o.avgResolutionHours != null ? (
                              <span className={o.avgResolutionHours > 72 ? "text-red-600" : o.avgResolutionHours > 24 ? "text-yellow-600" : "text-green-600"}>
                                {o.avgResolutionHours < 1
                                  ? `${Math.round(o.avgResolutionHours * 60)}m`
                                  : `${o.avgResolutionHours.toFixed(1)}h`}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
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

        {/* Legend */}
        <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Avg resolution &lt;24h = good</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500 inline-block" /> 24–72h = acceptable</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> &gt;72h = needs attention</span>
        </div>
      </div>
    </DashboardLayout>
  );
}
