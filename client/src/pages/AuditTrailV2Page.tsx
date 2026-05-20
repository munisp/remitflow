import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Search, Activity, RefreshCw } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/20 text-blue-400",
  warning: "bg-yellow-500/20 text-yellow-400",
  error: "bg-red-500/20 text-red-400",
  critical: "bg-red-700/30 text-red-300",
};

export default function AuditTrailV2Page() {
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const logsQuery = trpc.v89.auditTrailV2.search.useQuery({
    userId: userId ? parseInt(userId, 10) : undefined,
    action: action || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const statsQuery = trpc.v89.auditTrailV2.getStats.useQuery();

  const exportMutation = trpc.v89.auditTrailV2.exportCsv.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `audit-trail-${new Date().toISOString().split("T")[0]}.csv`;
      a.click(); URL.revokeObjectURL(url);
      toast.success(`Exported ${data.rowCount} records`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleExport = () => {
    if (!dateFrom || !dateTo) { toast.error("Select date range for export"); return; }
    exportMutation.mutate({ dateFrom, dateTo, userId: userId ? parseInt(userId, 10) : undefined });
  };

  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;
  const stats = statsQuery.data;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Trail v2</h1>
          <p className="text-muted-foreground text-sm mt-1">Immutable audit log of all platform actions</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exportMutation.isPending}>
          <Download className="w-4 h-4 mr-2" />
          {exportMutation.isPending ? "Exporting..." : "Export CSV"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-foreground">{stats?.total?.toLocaleString() ?? 0}</p>
            <p className="text-xs text-muted-foreground">Total Audit Events</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-blue-400">{stats?.today ?? 0}</p>
            <p className="text-xs text-muted-foreground">Events Today</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Top Actions</p>
            {(stats?.topActions ?? []).slice(0, 3).map((a: any) => (
              <div key={a.action} className="flex items-center justify-between text-xs">
                <span className="text-foreground font-mono">{a.action}</span>
                <Badge className="bg-primary/20 text-primary">{a.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">User ID</Label>
          <Input type="number" placeholder="Filter by user" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(0); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Action</Label>
          <Input placeholder="e.g. transfer.send" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From Date</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To Date</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
        </div>
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" /> Audit Events ({total.toLocaleString()})
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => logsQuery.refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">ID</th>
                  <th className="p-3 text-left">User</th>
                  <th className="p-3 text-left">Action</th>
                  <th className="p-3 text-left">Target</th>
                  <th className="p-3 text-left">Severity</th>
                  <th className="p-3 text-left">IP</th>
                  <th className="p-3 text-left">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {logsQuery.isPending ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No audit events found</td></tr>
                ) : logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs text-muted-foreground">#{log.id}</td>
                    <td className="p-3 text-sm">User #{log.userId}</td>
                    <td className="p-3 font-mono text-xs text-blue-400">{log.action}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {log.targetType ? `${log.targetType}#${log.targetId}` : "—"}
                    </td>
                    <td className="p-3">
                      <Badge className={SEVERITY_COLORS[log.severity ?? "info"] ?? "bg-blue-500/20 text-blue-400"}>
                        {log.severity}
                      </Badge>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{log.ipAddress ?? "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
