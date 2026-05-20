/**
 * MLRODashboard.tsx
 * Money Laundering Reporting Officer (MLRO) Dashboard
 * Shows escalated alerts, SAR submission form, and MLRO-specific KPIs.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, FileText, Clock, CheckCircle2, ShieldAlert, User, Calendar, DollarSign, RefreshCw, CheckSquare, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DeadlineBadge } from "./OfficerWorkload";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

const SAR_ACTIVITY_TYPES = [
  "Money Laundering",
  "Terrorist Financing",
  "Fraud",
  "Structuring / Smurfing",
  "Sanctions Evasion",
  "PEP Suspicious Activity",
  "Human Trafficking",
  "Drug Trafficking Proceeds",
  "Cybercrime",
  "Bribery / Corruption",
  "Tax Evasion",
  "Other",
];

interface SARFormState {
  alertId: number;
  alertTitle: string;
  sarNarrative: string;
  suspiciousActivityType: string;
  amountInvolved: string;
  currency: string;
  fiuReference: string;
  mlroNotes?: string;
}

export default function MLRODashboard() {
  const [sarOpen, setSarOpen] = useState(false);
  const [sarForm, setSarForm] = useState<SARFormState | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAlertId, setAssignAlertId] = useState<number | null>(null);
  const [selectedOfficer, setSelectedOfficer] = useState<string>("");
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkSAROpen, setBulkSAROpen] = useState(false);
  const [bulkSARForm, setBulkSARForm] = useState({ sarNarrative: "", suspiciousActivityType: "", fiuReference: "" });

  const utils = trpc.useUtils();

  // Fetch escalated alerts
  const { data: escalatedAlerts, isLoading: alertsLoading, refetch } = trpc.complianceAlerts.list.useQuery({
    status: "escalated",
    limit: 50,
    offset: 0,
  });

  // Fetch MLRO summary stats
  const { data: summary } = trpc.complianceAnalytics.summary.useQuery({ days: 30 });

  // Fetch SAR submission heatmap data (90 days)
  const { data: heatmapData } = trpc.complianceAlerts.sarSubmissionHeatmap.useQuery({ days: 90 });

  // Fetch compliance officers for assignment
  const { data: officers } = trpc.complianceAlerts.listComplianceOfficers.useQuery();

  // Fetch alerts with SAR deadlines within 7 days or overdue
  const { data: deadlineAlerts } = trpc.complianceAlerts.deadlineAlerts.useQuery();

  const submitSAR = trpc.complianceAlerts.submitSAR.useMutation({
    onSuccess: (data) => {
      toast.success(`SAR submitted successfully. Reference: ${data.sarReference}`);
      setSarOpen(false);
      setSarForm(null);
      utils.complianceAlerts.list.invalidate();
    },
    onError: (err) => toast.error(`SAR submission failed: ${err.message}`),
  });

  const assignAlert = trpc.complianceAlerts.assign.useMutation({
    onSuccess: () => {
      toast.success("Alert assigned successfully");
      setAssignOpen(false);
      setAssignAlertId(null);
      setSelectedOfficer("");
      utils.complianceAlerts.list.invalidate();
    },
    onError: (err) => toast.error(`Assignment failed: ${err.message}`),
  });

  const handleOpenSAR = (alert: { id: number; title: string; metadata?: string | null }) => {
    let amount = "";
    let currency = "USD";
    try {
      const meta = JSON.parse(alert.metadata ?? "{}");
      amount = meta.amount ? String(meta.amount) : "";
      currency = meta.currency ?? "USD";
    } catch {}
    setSarForm({
      alertId: alert.id,
      alertTitle: alert.title,
      sarNarrative: "",
      suspiciousActivityType: "",
      amountInvolved: amount,
      currency,
      fiuReference: "",
    });
    setSarOpen(true);
  };

  const handleSubmitSAR = () => {
    if (!sarForm) return;
    if (!sarForm.suspiciousActivityType) { toast.error("Select a suspicious activity type"); return; }
    if (sarForm.sarNarrative.length < 50) { toast.error("SAR narrative must be at least 50 characters"); return; }
    submitSAR.mutate({
      alertId: sarForm.alertId,
      sarNarrative: sarForm.sarNarrative,
      suspiciousActivityType: sarForm.suspiciousActivityType,
      amountInvolved: sarForm.amountInvolved ? Number(sarForm.amountInvolved) : undefined,
      currency: sarForm.currency || undefined,
      fiuReference: sarForm.fiuReference || undefined,
      mlroNotes: sarForm.mlroNotes || undefined,
    });
  };

  const handleOpenAssign = (alertId: number) => {
    setAssignAlertId(alertId);
    setSelectedOfficer("");
    setAssignOpen(true);
  };

  const bulkSubmitSAR = trpc.complianceAlerts.bulkSubmitSAR.useMutation({
    onSuccess: (data) => {
      toast.success(`Bulk SAR submitted for ${data.count} alert(s). Reference: ${data.sarReference}`);
      setBulkSAROpen(false);
      setBulkSelected(new Set());
      setBulkSARForm({ sarNarrative: "", suspiciousActivityType: "", fiuReference: "" });
      utils.complianceAlerts.list.invalidate();
    },
    onError: (err) => toast.error(`Bulk SAR failed: ${err.message}`),
  });

  const toggleBulkSelect = (id: number) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssign = () => {
    if (!assignAlertId) return;
    assignAlert.mutate({
      alertId: assignAlertId,
      assignedTo: selectedOfficer ? Number(selectedOfficer) : null,
    });
  };

  const alerts = escalatedAlerts?.alerts ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-red-500" />
              MLRO Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Money Laundering Reporting Officer — Escalated alerts requiring SAR review
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* SAR Deadline Warning Banner */}
        {deadlineAlerts && deadlineAlerts.length > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-800 text-sm">
                  {deadlineAlerts.filter(a => new Date(a.sarDeadline) < new Date()).length > 0
                    ? `⚠️ ${deadlineAlerts.filter(a => new Date(a.sarDeadline) < new Date()).length} SAR deadline(s) OVERDUE — immediate action required`
                    : `⏰ ${deadlineAlerts.length} SAR deadline(s) approaching within 7 days`}
                </p>
                <div className="mt-2 space-y-1">
                  {deadlineAlerts.slice(0, 5).map(a => {
                    const daysLeft = Math.ceil((new Date(a.sarDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    return (
                      <div key={a.id} className="flex items-center gap-2 text-xs text-red-700">
                        <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded">#{a.id}</span>
                        <span className="truncate max-w-[300px]">{a.title}</span>
                        <span className={`font-semibold ${daysLeft < 0 ? 'text-red-900' : 'text-red-700'}`}>
                          {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                        </span>
                        {a.assignedName && <span className="text-red-500">({a.assignedName})</span>}
                      </div>
                    );
                  })}
                  {deadlineAlerts.length > 5 && (
                    <p className="text-xs text-red-600">+{deadlineAlerts.length - 5} more deadline alerts</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-2xl font-bold">{alerts.length}</p>
                  <p className="text-xs text-muted-foreground">Escalated Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-8 w-8 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">{summary?.criticalOpen ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Critical Open (30d)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{summary?.resolved ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Resolved (30d)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold">{summary?.avgResolutionHours?.toFixed(1) ?? "—"}h</p>
                  <p className="text-xs text-muted-foreground">Avg Resolution (30d)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SAR Submission Heatmap */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-500" />
              SAR Submission Workload — Last 90 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              // Build a 90-day grid: 13 weeks × 7 days
              const today = new Date();
              const days: { date: string; count: number }[] = [];
              for (let i = 89; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                const found = (heatmapData ?? []).find(h => h.day === key);
                days.push({ date: key, count: found?.count ?? 0 });
              }
              const maxCount = Math.max(...days.map(d => d.count), 1);
              // Pad to start on Sunday
              const firstDow = new Date(days[0].date).getDay();
              const padded = [...Array(firstDow).fill(null), ...days];
              const weeks: (typeof days[0] | null)[][] = [];
              for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
              const DOW = ["S", "M", "T", "W", "T", "F", "S"];
              const getColor = (count: number) => {
                if (count === 0) return "bg-muted";
                const intensity = count / maxCount;
                if (intensity < 0.25) return "bg-blue-200";
                if (intensity < 0.5) return "bg-blue-400";
                if (intensity < 0.75) return "bg-blue-600";
                return "bg-blue-800";
              };
              return (
                <TooltipProvider>
                  <div className="flex gap-1">
                    {/* Day-of-week labels */}
                    <div className="flex flex-col gap-1 mr-1">
                      {DOW.map((d, i) => (
                        <div key={i} className="h-4 w-4 text-xs text-muted-foreground flex items-center justify-center">{d}</div>
                      ))}
                    </div>
                    {/* Week columns */}
                    {weeks.map((week, wi) => (
                      <div key={wi} className="flex flex-col gap-1">
                        {week.map((day, di) => (
                          day ? (
                            <Tooltip key={di}>
                              <TooltipTrigger asChild>
                                <div
                                  className={`h-4 w-4 rounded-sm cursor-default ${getColor(day.count)}`}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {day.date}: {day.count} SAR{day.count !== 1 ? "s" : ""}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div key={di} className="h-4 w-4" />
                          )
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                    <span>Less</span>
                    {["bg-muted", "bg-blue-200", "bg-blue-400", "bg-blue-600", "bg-blue-800"].map((c, i) => (
                      <div key={i} className={`h-3 w-3 rounded-sm ${c}`} />
                    ))}
                    <span>More</span>
                    <span className="ml-4">{(heatmapData ?? []).reduce((s, h) => s + h.count, 0)} total SARs in 90 days</span>
                  </div>
                </TooltipProvider>
              );
            })()}
          </CardContent>
        </Card>

        {/* Escalated Alerts Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Escalated Alerts — Pending SAR Review
            </CardTitle>
            {bulkSelected.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto text-xs"
                onClick={() => setBulkSAROpen(true)}
              >
                <FileText className="h-3 w-3 mr-1" />
                Submit Bulk SAR ({bulkSelected.size})
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {alertsLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading escalated alerts…</div>
            ) : alerts.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No escalated alerts pending review.</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[520px]">
                <div className="divide-y">
                  {alerts.map((alert) => {
                    let meta: Record<string, unknown> = {};
                    try { meta = JSON.parse((alert as any).metadata ?? "{}"); } catch {}
                    return (
                      <div key={alert.id} className="p-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start gap-3">
                          <button
                            className="mt-1 shrink-0 text-muted-foreground hover:text-primary transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleBulkSelect(alert.id); }}
                            title={bulkSelected.has(alert.id) ? "Deselect" : "Select for bulk SAR"}
                          >
                            {bulkSelected.has(alert.id)
                              ? <CheckSquare className="h-4 w-4 text-primary" />
                              : <Square className="h-4 w-4" />}
                          </button>
                        <div className="flex items-start justify-between gap-4 flex-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[alert.severity] ?? ""}`}>
                                {alert.severity.toUpperCase()}
                              </Badge>
                              <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                                ESCALATED
                              </Badge>
                              <span className="text-xs text-muted-foreground font-mono">#{alert.id}</span>
                              <DeadlineBadge deadline={(alert as any).sarDeadline} />
                            </div>
                            <p className="font-medium text-sm text-foreground truncate">{alert.title}</p>
                            {alert.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.description}</p>
                            )}
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(alert.createdAt).toLocaleDateString()}
                              </span>
                              {meta.amount && (
                                <span className="flex items-center gap-1">
                                  <DollarSign className="h-3 w-3" />
                                  {Number(meta.amount).toLocaleString()} {String(meta.currency ?? "USD")}
                                </span>
                              )}
                              {(alert as any).assignedTo && (
                                <span className="flex items-center gap-1 text-blue-600">
                                  <User className="h-3 w-3" />
                                  Assigned
                                </span>
                              )}
                              {(alert as any).sarSubmittedAt && (
                                <span className="flex items-center gap-1 text-green-600">
                                  <FileText className="h-3 w-3" />
                                  SAR: {(alert as any).sarReference}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            {!(alert as any).sarSubmittedAt && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="text-xs h-7 px-3"
                                onClick={() => handleOpenSAR(alert as any)}
                              >
                                <FileText className="h-3 w-3 mr-1" />
                                File SAR
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 px-3"
                              onClick={() => handleOpenAssign(alert.id)}
                            >
                              <User className="h-3 w-3 mr-1" />
                              Assign
                            </Button>
                          </div>
                        </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* SAR Submission Dialog */}
        <Dialog open={sarOpen} onOpenChange={setSarOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-red-500" />
                Submit Suspicious Activity Report (SAR)
              </DialogTitle>
            </DialogHeader>
            {sarForm && (
              <div className="space-y-4 py-2">
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <p className="font-medium text-foreground">Alert: {sarForm.alertTitle}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">ID #{sarForm.alertId}</p>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">Suspicious Activity Type *</Label>
                    <Select
                      value={sarForm.suspiciousActivityType}
                      onValueChange={(v) => setSarForm(f => f ? { ...f, suspiciousActivityType: v } : f)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select activity type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAR_ACTIVITY_TYPES.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm font-medium">Amount Involved</Label>
                      <Input
                        type="number"
                        className="mt-1"
                        placeholder="e.g. 15000"
                        value={sarForm.amountInvolved}
                        onChange={e => setSarForm(f => f ? { ...f, amountInvolved: e.target.value } : f)}
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Currency</Label>
                      <Input
                        className="mt-1"
                        placeholder="USD"
                        value={sarForm.currency}
                        onChange={e => setSarForm(f => f ? { ...f, currency: e.target.value } : f)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">FIU Reference (optional)</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g. FIU-2026-001234"
                      value={sarForm.fiuReference}
                      onChange={e => setSarForm(f => f ? { ...f, fiuReference: e.target.value } : f)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">
                      SAR Narrative * <span className="text-muted-foreground font-normal">(min 50 chars)</span>
                    </Label>
                    <Textarea
                      className="mt-1 min-h-[160px] font-mono text-sm"
                      placeholder="Describe the suspicious activity in detail: who, what, when, where, why it is suspicious, and any supporting evidence or patterns observed…"
                      value={sarForm.sarNarrative}
                      onChange={e => setSarForm(f => f ? { ...f, sarNarrative: e.target.value } : f)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {sarForm.sarNarrative.length} / 5000 characters
                      {sarForm.sarNarrative.length < 50 && (
                        <span className="text-red-500 ml-2">({50 - sarForm.sarNarrative.length} more required)</span>
                      )}
                    </p>
                  </div>
                </div>
                  <div>
                    <Label className="text-sm font-medium">MLRO Internal Notes (optional)</Label>
                    <Textarea
                      className="mt-1 text-sm"
                      rows={3}
                      placeholder="Internal notes for the compliance record — not included in the SAR filing…"
                      value={sarForm.mlroNotes ?? ""}
                      onChange={e => setSarForm(f => f ? { ...f, mlroNotes: e.target.value } : f)}
                    />
                  </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  <strong>Legal Notice:</strong> Submitting a SAR is a legal obligation under anti-money laundering regulations.
                  Tipping off the subject of a SAR is a criminal offence. This report will be automatically notified to the compliance team.
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSarOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleSubmitSAR}
                disabled={submitSAR.isPending || !sarForm?.suspiciousActivityType || (sarForm?.sarNarrative.length ?? 0) < 50}
              >
                {submitSAR.isPending ? "Submitting…" : "Submit SAR"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign Dialog */}
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Assign Alert
              </DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-3">
              <p className="text-sm text-muted-foreground">Assign alert #{assignAlertId} to a compliance officer:</p>
              <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassign">— Unassign —</SelectItem>
                  {(officers ?? []).map(o => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name ?? o.email ?? `Officer #${o.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button
                onClick={handleAssign}
                disabled={assignAlert.isPending || !selectedOfficer}
              >
                {assignAlert.isPending ? "Assigning…" : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk SAR Submission Dialog */}
        <Dialog open={bulkSAROpen} onOpenChange={setBulkSAROpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-red-500" />
                Submit Bulk SAR ({bulkSelected.size} alerts)
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Alert IDs: {Array.from(bulkSelected).join(', ')}
              </div>
              <div className="space-y-1.5">
                <Label>Suspicious Activity Type *</Label>
                <Select
                  value={bulkSARForm.suspiciousActivityType}
                  onValueChange={(v) => setBulkSARForm(f => ({ ...f, suspiciousActivityType: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select activity type" /></SelectTrigger>
                  <SelectContent>
                    {SAR_ACTIVITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>SAR Narrative * <span className="text-muted-foreground">(min 50 chars)</span></Label>
                <Textarea
                  rows={5}
                  placeholder="Describe the suspicious activity pattern across all selected alerts…"
                  value={bulkSARForm.sarNarrative}
                  onChange={(e) => setBulkSARForm(f => ({ ...f, sarNarrative: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{bulkSARForm.sarNarrative.length}/5000 chars</p>
              </div>
              <div className="space-y-1.5">
                <Label>FIU Reference (optional)</Label>
                <Input
                  placeholder="e.g. FIU-2026-XXXXX"
                  value={bulkSARForm.fiuReference}
                  onChange={(e) => setBulkSARForm(f => ({ ...f, fiuReference: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkSAROpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={bulkSubmitSAR.isPending || !bulkSARForm.suspiciousActivityType || bulkSARForm.sarNarrative.length < 50}
                onClick={() => bulkSubmitSAR.mutate({
                  alertIds: Array.from(bulkSelected),
                  sarNarrative: bulkSARForm.sarNarrative,
                  suspiciousActivityType: bulkSARForm.suspiciousActivityType,
                  fiuReference: bulkSARForm.fiuReference || undefined,
                })}
              >
                {bulkSubmitSAR.isPending ? "Submitting…" : `Submit SAR for ${bulkSelected.size} alerts`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
