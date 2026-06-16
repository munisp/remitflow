import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Shield, RefreshCw, Download } from "lucide-react";
import { useTranslation } from 'react-i18next';

const ACTION_COLORS: Record<string, string> = {
  login: "bg-blue-900/40 text-blue-300",
  logout: "bg-gray-900/40 text-gray-300",
  transfer_created: "bg-green-900/40 text-green-300",
  transfer_failed: "bg-red-900/40 text-red-300",
  kyc_approved: "bg-emerald-900/40 text-emerald-300",
  kyc_rejected: "bg-red-900/40 text-red-300",
  admin_action: "bg-orange-900/40 text-orange-300",
};

export default function AuditLogViewer() {
  const { t } = useTranslation();
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isError } = trpc.auditLog.list.useQuery({
    action: action || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    page,
    limit: 50,
  });

  const { data: stats } = trpc.auditLog.getStats.useQuery();
  const { data: security } = trpc.auditLog.getSecuritySummary.useQuery();

  const logs: any[] = (data as any)?.logs ?? [];
  const total: number = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const handleExport = () => {
    const csv = [
      ["ID", "Action", "User ID", "IP", "Timestamp", "Details"].join(","),
      ...logs.map((l: any) => [
        l.id, l.action, l.userId ?? "", l.ipAddress ?? "", 
        new Date(l.createdAt).toISOString(), 
        JSON.stringify(l.details ?? {}).replace(/,/g, ";")
      ].join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit log exported");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-purple-400" /> Audit Log
            </h1>
            <p className="text-purple-300 text-sm mt-1">Complete audit trail of all platform actions</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-purple-800 text-purple-300">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="border-purple-800 text-purple-300">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Events", value: (stats as any)?.total ?? 0 },
            { label: "Today", value: (stats as any)?.today ?? 0 },
            { label: "Failed Logins", value: (security as any)?.failedLogins ?? 0 },
            { label: "Admin Actions", value: (security as any)?.adminActions ?? 0 },
          ].map(s => (
            <Card key={s.label} className="bg-purple-900/20 border-purple-800">
              <CardContent className="pt-4">
                <p className="text-sm text-purple-400">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Filter by action..."
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="w-48 bg-purple-900/20 border-purple-800 text-white"
          />
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            className="w-40 bg-purple-900/20 border-purple-800 text-white"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            className="w-40 bg-purple-900/20 border-purple-800 text-white"
          />
        </div>

        {/* Log Table */}
        {isLoading ? (
          <div className="text-purple-300">Loading audit logs...</div>
        ) : (
          <div className="space-y-2">
            {logs.map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-purple-900/10 border border-purple-900/40">
                <Badge className={`text-xs shrink-0 ${ACTION_COLORS[log.action] ?? "bg-purple-900/40 text-purple-300"}`}>
                  {log.action}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {log.userId && <span className="text-xs text-purple-400">User #{log.userId}</span>}
                    {log.ipAddress && <span className="text-xs text-purple-500 font-mono">{log.ipAddress}</span>}
                    {log.userAgent && <span className="text-xs text-purple-600 truncate max-w-xs">{log.userAgent}</span>}
                  </div>
                  {log.details && (
                    <p className="text-xs text-purple-500 mt-0.5 font-mono truncate">
                      {typeof log.details === "string" ? log.details : JSON.stringify(log.details)}
                    </p>
                  )}
                </div>
                <span className="text-xs text-purple-500 shrink-0">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-center py-12 text-purple-400">No audit log entries found.</div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-purple-400">Page {page} of {totalPages} ({total} total)</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="border-purple-800 text-purple-300"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="border-purple-800 text-purple-300"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
