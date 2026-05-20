import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Search, RefreshCw, FileText, Download } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  LOGIN: "bg-purple-100 text-purple-800",
  LOGOUT: "bg-gray-100 text-gray-800",
  TRANSFER: "bg-orange-100 text-orange-800",
  KYC: "bg-yellow-100 text-yellow-800",
  ADMIN: "bg-pink-100 text-pink-800",
};

export default function AuditLogAdmin() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading, refetch } = trpc.auditLog.list.useQuery({
    action: actionFilter !== "all" ? actionFilter : undefined,
    page,
    limit,
  });

  const logs = (data as any)?.logs ?? data ?? [];
  const total = (data as any)?.total ?? logs.length;
  const totalPages = Math.ceil(total / limit);

  const getActionColor = (action: string) => {
    const key = Object.keys(ACTION_COLORS).find(k => action?.toUpperCase().includes(k));
    return key ? ACTION_COLORS[key] : "bg-gray-100 text-gray-800";
  };

  const exportCSV = () => {
    const rows = [["ID", "User ID", "Action", "Description", "IP", "Created At"]];
    logs.forEach((l: any) => {
      rows.push([l.id, l.userId ?? l.user_id, l.action, l.description ?? "", l.ipAddress ?? l.ip_address ?? "", l.createdAt ?? l.created_at]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "audit-log.csv"; a.click();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6" /> Audit Log</h1>
            <p className="text-muted-foreground">Complete audit trail of all system actions</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}><Download className="w-4 h-4 mr-2" /> Export CSV</Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-10" placeholder="Search by user, action, or description..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Filter by action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="CREATE">Create</SelectItem>
              <SelectItem value="UPDATE">Update</SelectItem>
              <SelectItem value="DELETE">Delete</SelectItem>
              <SelectItem value="LOGIN">Login</SelectItem>
              <SelectItem value="TRANSFER">Transfer</SelectItem>
              <SelectItem value="KYC">KYC</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(ACTION_COLORS).slice(0, 4).map(([action, color]) => (
            <Card key={action}>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{action}</p>
                <p className="text-2xl font-bold">{logs.filter((l: any) => l.action?.toUpperCase().includes(action)).length}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Log Table */}
        <Card>
          <CardHeader><CardTitle>Audit Entries ({total})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <p className="text-center py-8 text-muted-foreground">Loading...</p> : (
              <div className="space-y-1">
                {logs.length === 0 && <p className="text-center py-8 text-muted-foreground">No audit log entries found</p>}
                {logs.map((log: any, i: number) => (
                  <div key={log.id ?? i} className="flex items-start gap-3 p-3 border rounded-lg text-sm hover:bg-muted/30">
                    <Badge className={`text-xs shrink-0 ${getActionColor(log.action)}`}>{log.action}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{log.description ?? "—"}</p>
                      <p className="text-muted-foreground text-xs">User: {log.userId ?? log.user_id ?? "system"} · IP: {log.ipAddress ?? log.ip_address ?? "—"}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {log.createdAt ? format(new Date(log.createdAt), "MMM d, HH:mm") : log.created_at ? format(new Date(log.created_at), "MMM d, HH:mm") : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
