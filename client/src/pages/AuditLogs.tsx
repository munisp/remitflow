import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Search, Download, Shield, User, CreditCard, Settings } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const SEVERITY_COLORS: Record<string, string> = { critical: "destructive", high: "destructive", medium: "secondary", low: "outline", info: "outline" };
const ACTION_ICONS: Record<string, any> = { LOGIN: Shield, LOGOUT: Shield, TRANSFER: CreditCard, PROFILE_UPDATED: User, SETTINGS: Settings };

export default function AuditLogs() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const { data: logs = [], isLoading } = trpc.audit.list.useQuery({ limit: 100 });
  const logList = (Array.isArray(logs) ? logs : []).filter((l: any) => {
    const matchSearch = !search || (l.action ?? "").toLowerCase().includes(search.toLowerCase()) || (l.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchAction = action === "all" || (l.action ?? "").startsWith(action.toUpperCase());
    return matchSearch && matchAction;
  });

  const handleExport = () => {
    const csv = ["Action,Description,Severity,Date"].concat(
      logList.map((l: any) => `"${l.action}","${l.description ?? ""}","${l.severity ?? "info"}","${new Date(l.createdAt).toISOString()}"`)
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "audit-logs.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit logs exported");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-primary" />Audit Logs
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Complete activity history for your account</p>
          </div>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search logs..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="login">Authentication</SelectItem>
              <SelectItem value="transfer">Transfers</SelectItem>
              <SelectItem value="profile">Profile</SelectItem>
              <SelectItem value="kyc">KYC</SelectItem>
              <SelectItem value="security">Security</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
        ) : logList.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <ClipboardList className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-lg">No audit logs found</h3>
              <p className="text-muted-foreground text-sm mt-1">Activity will appear here as you use the platform</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {logList.map((log: any) => {
              const Icon = ACTION_ICONS[log.action] ?? Shield;
              return (
                <div key={log.id} className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">{log.action}</div>
                      <div className="text-xs text-muted-foreground flex-shrink-0">
                        {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{log.description}</div>
                  </div>
                  <Badge variant={(SEVERITY_COLORS[log.severity ?? "info"] as any) ?? "outline"} className="text-xs capitalize flex-shrink-0">
                    {log.severity ?? "info"}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
