import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  ShieldAlert, ShieldCheck, ShieldX, AlertTriangle, TrendingUp,
  Download, RefreshCw, Eye, CheckCircle, XCircle, ArrowUpRight,
  Search, Filter, Clock, DollarSign, Activity, Cpu, Wifi, WifiOff, Zap,
  Trash2, UserX
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-green-100 text-green-800 border-green-200",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800",
  reviewed: "bg-purple-100 text-purple-800",
  approved: "bg-green-100 text-green-800",
  blocked: "bg-red-100 text-red-800",
  escalated: "bg-orange-100 text-orange-800",
};

type AlertStatus = "all" | "pending" | "reviewed" | "approved" | "blocked" | "escalated";
type RiskLevel = "all" | "low" | "medium" | "high" | "critical";

export default function FraudMonitor() {
  const { t } = useTranslation();
  
  const [statusFilter, setStatusFilter] = useState<AlertStatus>("all");
  const [riskFilter, setRiskFilter] = useState<RiskLevel>("all");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [reviewModal, setReviewModal] = useState<{ open: boolean; alertId: number | null; action: string }>({ open: false, alertId: null, action: "" });
  const [reviewNotes, setReviewNotes] = useState("");
  const [sseConnected, setSseConnected] = useState(false);
  const [liveAlertCount, setLiveAlertCount] = useState(0);
  const sseRef = useRef<EventSource | null>(null);

  const utils = trpc.useUtils();

  // Real-time SSE connection for live fraud alert updates
  useEffect(() => {
    const es = new EventSource("/api/admin/sse", { withCredentials: true });
    sseRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "fraud_alert") {
          setLiveAlertCount(c => c + 1);
          utils.fraudMonitor.alerts.invalidate();
          utils.fraudMonitor.stats.invalidate();
          toast.warning(`🚨 New fraud alert: ${data.payload?.riskLevel ?? "unknown"} risk — ${data.payload?.alertType ?? ""} `, { duration: 6000 });
        } else if (data.type === "fraud_alert_reviewed") {
          utils.fraudMonitor.alerts.invalidate();
          utils.fraudMonitor.stats.invalidate();
        }
      } catch { /* ignore parse errors */ }
    };
    return () => { es.close(); setSseConnected(false); };
  }, [utils]);

  const { data: statsData, isLoading: statsLoading } = trpc.fraudMonitor.stats.useQuery();
  const { data: workerHealth, isLoading: workerLoading, refetch: refetchWorker } = trpc.system.workerHealth.useQuery(
    undefined, { refetchInterval: 30000 }
  );
  const { data: alertsData, isLoading: alertsLoading } = trpc.fraudMonitor.alerts.useQuery({
    status: statusFilter,
    riskLevel: riskFilter,
    page,
    limit: 15,
  });
  const { data: exportData } = trpc.fraudMonitor.exportAlerts.useQuery({ format: "json" }, { enabled: false });

  const reviewMutation = trpc.fraudMonitor.reviewAlert.useMutation({
    onSuccess: () => {
      toast.success("Alert reviewed successfully");
      utils.fraudMonitor.alerts.invalidate();
      utils.fraudMonitor.stats.invalidate();
      setReviewModal({ open: false, alertId: null, action: "" });
      setReviewNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAction = (alertId: number, action: string) => {
    setReviewModal({ open: true, alertId, action });
  };

  const handleReviewSubmit = () => {
    if (!reviewModal.alertId) return;
    reviewMutation.mutate({
      alertId: reviewModal.alertId,
      action: reviewModal.action as "approve" | "block" | "escalate" | "review",
      notes: reviewNotes,
    });
  };

  const handleExport = () => {
    utils.fraudMonitor.exportAlerts.fetch({ format: "json" }).then((data) => {
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fraud-alerts-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    });
  };

  const filteredAlerts = (alertsData?.alerts ?? []).filter((a: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (a.recipient_name ?? "").toLowerCase().includes(q) ||
      (a.user_name ?? "").toLowerCase().includes(q) ||
      (a.recipient_country ?? "").toLowerCase().includes(q) ||
      (a.ip_address ?? "").includes(q)
    );
  });

  const stats = statsData ?? { totalAlerts: 0, pendingReview: 0, blockedToday: 0, amountBlocked: 0, avgRiskScore: 0, riskDistribution: [], recentActivity: [] };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-7 w-7 text-red-500" />
              Fraud Monitoring Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Real-time fraud detection and AML screening alerts</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${sseConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                {sseConnected ? 'Live' : 'Connecting...'}
              </span>
              {liveAlertCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  <Zap className="h-3 w-3" /> {liveAlertCount} new since load
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { utils.fraudMonitor.stats.invalidate(); utils.fraudMonitor.alerts.invalidate(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Alerts</p>
                  <p className="text-2xl font-bold mt-1">{statsLoading ? "—" : stats.totalAlerts}</p>
                </div>
                <Activity className="h-8 w-8 text-blue-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-yellow-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Review</p>
                  <p className="text-2xl font-bold mt-1 text-yellow-600">{statsLoading ? "—" : stats.pendingReview}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Blocked Today</p>
                  <p className="text-2xl font-bold mt-1 text-red-600">{statsLoading ? "—" : stats.blockedToday}</p>
                </div>
                <ShieldX className="h-8 w-8 text-red-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Amount Blocked</p>
                  <p className="text-2xl font-bold mt-1 text-orange-600">
                    ${statsLoading ? "—" : Number(stats.amountBlocked).toLocaleString()}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-orange-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Temporal Worker Health Card */}
        <Card className={`border-l-4 ${workerHealth?.online ? "border-l-emerald-500" : "border-l-slate-400"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Temporal Worker</span>
              <button onClick={() => refetchWorker()} className="p-1 rounded hover:bg-muted transition-colors" title="Refresh">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workerLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Checking…</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                  {workerHealth?.online ? <Wifi className="h-5 w-5 text-emerald-500" /> : <WifiOff className="h-5 w-5 text-slate-400" />}
                  <div>
                    <div className="text-xs text-muted-foreground">Status</div>
                    <div className={`text-sm font-semibold capitalize ${workerHealth?.online ? "text-emerald-600" : "text-slate-500"}`}>{workerHealth?.status ?? "—"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-400" />
                  <div>
                    <div className="text-xs text-muted-foreground">Workflows</div>
                    <div className="text-sm font-semibold">{workerHealth?.workflowsRunning ?? 0} running</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-purple-400" />
                  <div>
                    <div className="text-xs text-muted-foreground">Activities</div>
                    <div className="text-sm font-semibold">{workerHealth?.activitiesRunning ?? 0} active</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-400" />
                  <div>
                    <div className="text-xs text-muted-foreground">Latency</div>
                    <div className="text-sm font-semibold">{workerHealth?.latencyMs ?? "—"} ms</div>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Task queue: <code className="bg-muted px-1 rounded">{workerHealth?.taskQueue ?? "remitflow-main"}</code></span>
              <span>Last checked: {workerHealth?.lastChecked ? new Date(workerHealth.lastChecked).toLocaleTimeString() : "—"}</span>
            </div>
            {!workerHealth?.online && (
              <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Worker offline — transfers use direct DB fallback. Deploy <code className="mx-1 bg-amber-100 px-1 rounded">Dockerfile.worker</code> to enable saga orchestration.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Risk Distribution */}
        {!statsLoading && stats.riskDistribution.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Risk Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                {stats.riskDistribution.map((item: any) => (
                  <div key={item.risk_level} className="flex items-center gap-2">
                    <Badge className={RISK_COLORS[item.risk_level] ?? "bg-gray-100 text-gray-800"}>
                      {item.risk_level}
                    </Badge>
                    <span className="text-sm font-semibold">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs mb-1 block">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Recipient, user, IP..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Status</Label>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as AlertStatus); setPage(1); }}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Risk Level</Label>
                <Select value={riskFilter} onValueChange={(v) => { setRiskFilter(v as RiskLevel); setPage(1); }}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setRiskFilter("all"); setSearchQuery(""); setPage(1); }}>
                <Filter className="h-4 w-4 mr-1" /> Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Alerts Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Fraud Alerts ({alertsData?.total ?? 0} total)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {alertsLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading alerts...</div>
            ) : filteredAlerts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-400" />
                <p className="font-medium">No alerts found</p>
                <p className="text-sm">Adjust filters or check back later</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Risk</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAlerts.map((alert: any) => (
                      <TableRow key={alert.id} className="hover:bg-muted/50">
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge className={`text-xs ${RISK_COLORS[alert.risk_level] ?? ""}`}>
                              {alert.risk_level}
                            </Badge>
                            <span className="text-xs text-muted-foreground font-mono">
                              {Number(alert.risk_score).toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{alert.recipient_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{alert.recipient_account?.slice(0, 16)}...</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">
                            {Number(alert.transaction_amount).toLocaleString()} {alert.transaction_currency}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(() => {
                              try {
                                const flags = typeof alert.flags === "string" ? JSON.parse(alert.flags) : alert.flags;
                                return (Array.isArray(flags) ? flags : []).slice(0, 2).map((flag: string) => (
                                  <Badge key={flag} variant="outline" className="text-xs px-1 py-0">
                                    {flag.replace(/_/g, " ")}
                                  </Badge>
                                ));
                              } catch { return null; }
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{alert.recipient_country}</span>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${STATUS_COLORS[alert.status] ?? ""}`}>
                            {alert.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {new Date(alert.created_at).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          {alert.status === "pending" && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => handleAction(alert.id, "approve")}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-red-700 border-red-300 hover:bg-red-50"
                                onClick={() => handleAction(alert.id, "block")}
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Block
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-orange-700 border-orange-300 hover:bg-orange-50"
                                onClick={() => handleAction(alert.id, "escalate")}
                              >
                                <ArrowUpRight className="h-3 w-3 mr-1" /> Escalate
                              </Button>
                            </div>
                          )}
                          {alert.status !== "pending" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleAction(alert.id, "review")}
                            >
                              <Eye className="h-3 w-3 mr-1" /> View
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {(alertsData?.total ?? 0) > 15 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {Math.ceil((alertsData?.total ?? 0) / 15)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= Math.ceil((alertsData?.total ?? 0) / 15)} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Review Modal */}
        <Dialog open={reviewModal.open} onOpenChange={(open) => setReviewModal(prev => ({ ...prev, open }))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {reviewModal.action === "approve" && <CheckCircle className="h-5 w-5 text-green-500" />}
                {reviewModal.action === "block" && <XCircle className="h-5 w-5 text-red-500" />}
                {reviewModal.action === "escalate" && <ArrowUpRight className="h-5 w-5 text-orange-500" />}
                {reviewModal.action === "review" && <Eye className="h-5 w-5 text-blue-500" />}
                {reviewModal.action.charAt(0).toUpperCase() + reviewModal.action.slice(1)} Alert #{reviewModal.alertId}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="notes">Reviewer Notes {reviewModal.action !== "review" && "(required)"}</Label>
                <Textarea
                  id="notes"
                  placeholder="Add your review notes, justification, or findings..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={4}
                  className="mt-1"
                />
              </div>
              {reviewModal.action === "block" && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                  <strong>Warning:</strong> Blocking this alert will prevent the transaction from proceeding and may freeze the user's account for review.
                </div>
              )}
              {reviewModal.action === "escalate" && (
                <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-sm text-orange-700">
                  This alert will be escalated to the compliance team for further investigation.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewModal({ open: false, alertId: null, action: "" })}>
                Cancel
              </Button>
              <Button
                onClick={handleReviewSubmit}
                disabled={reviewMutation.isPending}
                className={
                  reviewModal.action === "block" ? "bg-red-600 hover:bg-red-700" :
                  reviewModal.action === "approve" ? "bg-green-600 hover:bg-green-700" :
                  reviewModal.action === "escalate" ? "bg-orange-600 hover:bg-orange-700" : ""
                }
              >
                {reviewMutation.isPending ? "Processing..." : `Confirm ${reviewModal.action}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {/* GDPR Pending Erasures Section */}
      <div className="px-6 pb-6 border-t pt-6 space-y-4 max-w-7xl mx-auto">
        <GDPRErasuresSection />
      </div>
    </DashboardLayout>
  );
}

function GDPRErasuresSection() {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const { data: erasures } = trpc.gdpr.pendingErasures.useQuery(undefined, { retry: false });
  const executeMutation = trpc.gdpr.executeErasure.useMutation({
    onSuccess: () => { toast.success("User PII anonymized successfully"); utils.gdpr.pendingErasures.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (!erasures) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><UserX className="h-5 w-5 text-red-500" />GDPR Erasure Requests</h2>
          <p className="text-sm text-muted-foreground">Pending: {erasures.pending ?? 0} · Executed: {erasures.executed ?? 0} · Total: {erasures.total ?? 0}</p>
        </div>
      </div>
      {erasures.requests.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No erasure requests found.</CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {erasures.requests.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.userName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.userEmail ?? "—"}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{r.reason ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs">{r.scheduledAt ? new Date(r.scheduledAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={r.status === "pending" ? "text-yellow-600 border-yellow-300" : r.status === "executed" ? "text-green-600 border-green-300" : "text-gray-500"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" && (
                      confirmId === r.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={() => { executeMutation.mutate({ requestId: r.id }); setConfirmId(null); }} disabled={executeMutation.isPending}>
                            <Trash2 className="h-3 w-3 mr-1" />Execute
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirmId(r.id)}>
                          <Trash2 className="h-3 w-3 mr-1" />Erase
                        </Button>
                      )
                    )}
                    {r.status === "executed" && <span className="text-xs text-green-600">Anonymized</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
