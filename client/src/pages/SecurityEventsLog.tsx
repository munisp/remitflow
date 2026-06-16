import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Shield, AlertTriangle, Info, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";

import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';
const SEVERITY_ICONS: Record<string, React.ReactElement> = {
  info: <Info className="w-4 h-4 text-blue-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  critical: <AlertTriangle className="w-4 h-4 text-red-500" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-50 border-blue-200",
  warning: "bg-yellow-50 border-yellow-200",
  critical: "bg-red-50 border-red-200",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  login_success: "Login Success",
  login_failed: "Login Failed",
  mfa_enabled: "MFA Enabled",
  mfa_disabled: "MFA Disabled",
  password_changed: "Password Changed",
  api_key_created: "API Key Created",
  api_key_revoked: "API Key Revoked",
  account_suspended: "Account Suspended",
  suspicious_ip: "Suspicious IP",
  kyc_submitted: "KYC Submitted",
  kyc_approved: "KYC Approved",
  large_transfer: "Large Transfer",
};

export default function SecurityEventsLog() {
  const { t } = useTranslation();
  const [severity, setSeverity] = useState<string>("all");
  const [eventType, setEventType] = useState<string>("");
  const [limit, setLimit] = useState(50);

  const { data: events, isLoading, refetch, isError } = trpc.securityEvents.list.useQuery({
    severity: severity as any,
    eventType: eventType || undefined,
    limit,
  });

  const { data: stats } = trpc.securityEvents.stats.useQuery();

  function exportCSV() {
    if (!events?.length) return;
    const header = "id,userId,eventType,severity,ipAddress,location,createdAt";
    const rows = events.map((e: any) => `${e.id},${e.userId ?? ""},${e.eventType},${e.severity},"${e.ipAddress ?? ""}","${e.location ?? ""}","${new Date(e.createdAt).toISOString()}"`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `security-events-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="w-6 h-6 text-indigo-500" /> Security Events Log</h1>
          <p className="text-muted-foreground text-sm mt-1">Audit trail of all security-relevant events across the platform</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1"><RefreshCw className="w-4 h-4" /> Refresh</Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1"><Download className="w-4 h-4" /> Export CSV</Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total Events", value: stats.total, color: "text-foreground" },
            { label: "Critical", value: stats.critical, color: "text-red-600" },
            { label: "Warning", value: stats.warning, color: "text-yellow-600" },
            { label: "Info", value: stats.info, color: "text-blue-600" },
            { label: "Last 24h", value: stats.last24h, color: "text-purple-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            {["all","critical","warning","info"].map(s => <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All Severity" : s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          className="w-48"
          placeholder="Filter by event type..."
          value={eventType}
          onChange={e => setEventType(e.target.value)}
        />
        <Select value={String(limit)} onValueChange={v => setLimit(parseInt(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[25, 50, 100, 200].map(n => <SelectItem key={n} value={String(n)}>Last {n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Events List */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
      ) : !events?.length ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground"><Shield className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No security events found</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {events.map((event: any) => (
            <div key={event.id} className={`flex items-start gap-3 p-3 rounded-lg border ${SEVERITY_COLORS[event.severity] ?? "bg-muted"}`}>
              <div className="mt-0.5">{SEVERITY_ICONS[event.severity] ?? <Info className="w-4 h-4" />}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}</span>
                  <Badge variant="outline" className="text-xs capitalize">{event.severity}</Badge>
                  {event.userId && <span className="text-xs text-muted-foreground">User #{event.userId}</span>}
                </div>
                <div className="flex gap-4 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  {event.ipAddress && <span>IP: {event.ipAddress}</span>}
                  {event.location && <span>📍 {event.location}</span>}
                  <span>{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                {event.details && (() => { try { const d = JSON.parse(event.details!); return <pre className="text-xs text-muted-foreground mt-1 font-mono">{JSON.stringify(d, null, 2)}</pre>; } catch { return null; } })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
