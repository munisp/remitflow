import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Shield, RefreshCw, ChevronLeft, ChevronRight, Activity, User, FileText, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-100 text-blue-800",
  warning: "bg-yellow-100 text-yellow-800",
  critical: "bg-red-100 text-red-800",
};

const ACTION_LABELS: Record<string, string> = {
  promoteUser: "Promote User",
  approveKyc: "Approve KYC",
  rejectKyc: "Reject KYC",
  updateComplianceCase: "Update Case",
  assignCase: "Assign Case",
  login: "Login",
  logout: "Logout",
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  promoteUser: <User className="h-4 w-4 text-purple-500" />,
  approveKyc: <FileText className="h-4 w-4 text-green-500" />,
  rejectKyc: <FileText className="h-4 w-4 text-red-500" />,
  updateComplianceCase: <AlertTriangle className="h-4 w-4 text-orange-500" />,
  assignCase: <User className="h-4 w-4 text-blue-500" />,
};

const ADMIN_ACTIONS = ["", "promoteUser", "approveKyc", "rejectKyc", "updateComplianceCase", "assignCase"];
const TARGET_TYPES = ["", "user", "kycDocument", "complianceCase"];

export default function AdminAuditLog() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, refetch } = trpc.admin.listAdminAuditLogs.useQuery(
    {
      page,
      limit: 30,
      action: actionFilter || undefined,
      targetType: targetTypeFilter || undefined,
    },
    { enabled: user?.role === "admin" }
  );

  const exportQuery = trpc.admin.exportAuditLog.useQuery(
    { action: actionFilter || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { enabled: false }
  );

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportQuery.refetch();
      if (result.data?.csv) {
        const blob = new Blob([result.data.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${result.data.count} audit log entries`);
      }
    } catch { toast.error("Export failed"); }
    finally { setIsExporting(false); }
  };

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Admin access required</p>
        </div>
      </div>
    );
  }

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Admin Audit Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tamper-evident record of all privileged admin actions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Action</Label>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v === "__all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All Actions</SelectItem>
                  {ADMIN_ACTIONS.filter(Boolean).map(a => (
                    <SelectItem key={a} value={a}>{ACTION_LABELS[a] ?? a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target Type</Label>
              <Select value={targetTypeFilter} onValueChange={(v) => { setTargetTypeFilter(v === "__all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-40 h-8 text-sm">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All Types</SelectItem>
                  {TARGET_TYPES.filter(Boolean).map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From Date</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To Date</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit log table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {data?.total ?? 0} audit entr{(data?.total ?? 0) !== 1 ? "ies" : "y"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.logs.length ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Activity className="h-10 w-10 mb-2 opacity-30" />
              <p>No audit entries match the current filters</p>
            </div>
          ) : (
            <div className="divide-y">
              {data.logs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-muted/20 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {ACTION_ICONS[log.action] ?? <Activity className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm">
                          {ACTION_LABELS[log.action] ?? log.action}
                        </span>
                        <Badge variant="secondary" className={`text-xs ${SEVERITY_COLORS[log.severity ?? "info"] ?? ""}`}>
                          {log.severity ?? "info"}
                        </Badge>
                        {log.targetType && (
                          <Badge variant="outline" className="text-xs">
                            {log.targetType} #{log.targetId}
                          </Badge>
                        )}
                      </div>
                      {log.description && (
                        <p className="text-sm text-muted-foreground mb-1">{log.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {log.actorName ?? log.actorEmail ?? `User #${log.userId}`}
                        </span>
                        {log.metadata && (
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">
                            {JSON.stringify(log.metadata).slice(0, 80)}
                            {JSON.stringify(log.metadata).length > 80 ? "…" : ""}
                          </span>
                        )}
                        <span className="ml-auto">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {data.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
