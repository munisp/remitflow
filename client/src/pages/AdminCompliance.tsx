import React, { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Shield, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, RefreshCw, User, FileText, UserCheck, MessageSquare, Send, Timer, BarChart3, Download, Lock, Globe, Search, X, Activity, GitBranch, Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from 'react-i18next';

type CaseStatus = "open" | "under_review" | "resolved" | "escalated" | "dismissed" | "all";
type CaseSeverity = "low" | "medium" | "high" | "critical" | "all";
type CaseType = "aml_flag" | "fraud_alert" | "sanctions_hit" | "pep_match" | "unusual_activity" | "high_risk_corridor" | "all";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  under_review: "bg-yellow-100 text-yellow-800",
  escalated: "bg-purple-100 text-purple-800",
  resolved: "bg-green-100 text-green-800",
  dismissed: "bg-gray-100 text-gray-600",
};

// SLA countdown helper
function getSlaStatus(dueAt: string | null | undefined): { label: string; className: string } | null {
  if (!dueAt) return null;
  const now = Date.now();
  const due = new Date(dueAt).getTime();
  const diffMs = due - now;
  if (diffMs < 0) {
    const overH = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
    const overD = Math.floor(overH / 24);
    return { label: overD > 0 ? `${overD}d overdue` : `${overH}h overdue`, className: "bg-red-100 text-red-800 border-red-300" };
  }
  const h = Math.floor(diffMs / (1000 * 60 * 60));
  const d = Math.floor(h / 24);
  if (d >= 2) return { label: `SLA: ${d}d left`, className: "bg-green-100 text-green-800 border-green-200" };
  if (h >= 4) return { label: `SLA: ${h}h left`, className: "bg-yellow-100 text-yellow-800 border-yellow-200" };
  return { label: `SLA: ${h}h left`, className: "bg-red-100 text-red-800 border-red-300" };
}

const CASE_TYPE_LABELS: Record<string, string> = {
  aml_flag: "AML Flag",
  fraud_alert: "Fraud Alert",
  sanctions_hit: "Sanctions Hit",
  pep_match: "PEP Match",
  unusual_activity: "Unusual Activity",
  high_risk_corridor: "High-Risk Corridor",
};

export default function AdminCompliance() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CaseStatus>("all");
  const [severity, setSeverity] = useState<CaseSeverity>("all");
  const [caseType, setCaseType] = useState<CaseType>("all");
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentIsInternal, setCommentIsInternal] = useState(true);
  const [commentsDialogOpen, setCommentsDialogOpen] = useState(false);
  const [commentsCase, setCommentsCase] = useState<any>(null);
  const [commentsTab, setCommentsTab] = useState<"comments" | "timeline">("comments");
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [slaDialogOpen, setSlaDialogOpen] = useState(false);
  const [slaCase, setSlaCase] = useState<any>(null);
  const [slaDueAt, setSlaDueAt] = useState("");
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSlaDialogOpen, setBulkSlaDialogOpen] = useState(false);
  const [bulkSlaDueAt, setBulkSlaDueAt] = useState("");
  const [bulkStatusDialogOpen, setBulkStatusDialogOpen] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState<string>("resolved");
  // Tabs
  const [activeTab, setActiveTab] = useState<"cases" | "sla-report">("cases");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical" | "all">("all");
  const [sortBy, setSortBy] = useState<"createdAt" | "priority" | "dueAt" | "riskScore">("createdAt");
  // Assign to admin dialog
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignCaseId, setAssignCaseId] = useState<number | null>(null);
  const [assignAdminId, setAssignAdminId] = useState<string>("");
  // Keyword search with debounce
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 350);
  };

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.admin.listComplianceCases.useQuery(
    { page, limit: 20, status, severity, caseType, priority, sortBy, search: search || undefined },
    { enabled: user?.role === "admin" }
  );

  const updateCase = trpc.admin.updateComplianceCase.useMutation({
    onSuccess: () => {
      toast.success("Case updated successfully.");
      utils.admin.listComplianceCases.invalidate();
      setActionDialogOpen(false);
      setSelectedCase(null);
      setNotes("");
      setAssignedTo("");
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: caseComments, isLoading: commentsLoading, refetch: refetchComments } = trpc.admin.getCaseComments.useQuery(
    { caseId: commentsCase?.id ?? 0 },
    { enabled: !!commentsCase?.id }
  );

  const addComment = trpc.admin.addCaseComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      setReplyText("");
      setReplyingToId(null);
      refetchComments();
      toast.success("Comment added");
    },
    onError: (err) => toast.error(err.message),
  });

  const setCaseDueAt = trpc.admin.setCaseDueAt.useMutation({
    onSuccess: () => {
      toast.success("SLA deadline set");
      utils.admin.listComplianceCases.invalidate();
      setSlaDialogOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkSetCaseDueAt = trpc.admin.bulkSetCaseDueAt.useMutation({
    onSuccess: (data) => {
      toast.success(`SLA set for ${data.updated} cases`);
      utils.admin.listComplianceCases.invalidate();
      setBulkSlaDialogOpen(false);
      setSelectedIds(new Set());
      setBulkSlaDueAt("");
    },
    onError: (err) => toast.error(err.message),
  });
  const bulkUpdateCaseStatus = trpc.admin.bulkUpdateCaseStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.updated} case${data.updated !== 1 ? "s" : ""} updated to "${bulkNewStatus.replace("_", " ")}"`);
      utils.admin.listComplianceCases.invalidate();
      setBulkStatusDialogOpen(false);
      setSelectedIds(new Set());
    },
    onError: (err) => toast.error(err.message),
  });
  const { data: slaReport } = trpc.admin.slaReport.useQuery(
    undefined,
    { enabled: user?.role === "admin" && activeTab === "sla-report" }
  );
  const [isExporting, setIsExporting] = useState(false);
  const exportCasesQuery = trpc.admin.exportComplianceCases.useQuery(
    { status, severity, caseType, priority, search: search || undefined },
    { enabled: false }
  );
  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const result = await exportCasesQuery.refetch();
      if (result.data?.csv) {
        const blob = new Blob([result.data.csv], { type: "text/csv" });
        const a = Object.assign(document.createElement("a"), {
          href: URL.createObjectURL(blob),
          download: `compliance-cases-${new Date().toISOString().slice(0, 10)}.csv`,
        });
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success(`Exported ${result.data.count} cases to CSV`);
      }
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  };
  const assignCase = trpc.admin.assignCase.useMutation({
    onSuccess: (data) => {
      toast.success(`Case assigned to ${data.assignedTo}`);
      utils.admin.listComplianceCases.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const { data: adminsData } = trpc.admin.listAdmins.useQuery();
  const assignCaseToAdmin = trpc.admin.assignCaseToAdmin.useMutation({
    onSuccess: (data) => {
      toast.success(`Case #${data.caseId} assigned to ${data.assignedTo}`);
      utils.admin.listComplianceCases.invalidate();
      setAssignDialogOpen(false);
      setAssignAdminId("");
    },
    onError: (err) => toast.error(err.message),
  });
  const setCasePriority = trpc.admin.setCasePriority.useMutation({
    onSuccess: (data) => {
      if (data.dueAt) {
        toast.success(`Priority set — SLA auto-assigned: ${new Date(data.dueAt).toLocaleString()}`);
      } else {
        toast.success("Priority updated");
      }
      utils.admin.listComplianceCases.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

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

  // Bulk helpers
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    if (!data?.cases.length) return;
    setSelectedIds(selectedIds.size === data.cases.length ? new Set() : new Set(data.cases.map((c: any) => c.id)));
  };
  const handleBulkSetSla = () => {
    if (!bulkSlaDueAt || selectedIds.size === 0) return;
    bulkSetCaseDueAt.mutate({ caseIds: Array.from(selectedIds), dueAt: new Date(bulkSlaDueAt).toISOString() });
  };
  const exportSlaReportCsv = () => {
    if (!slaReport) return;
    const rows = [["Status","Count"],["On Time",slaReport.onTime],["At Risk",slaReport.atRisk],["Overdue",slaReport.overdue],["Escalated",slaReport.escalated],["No SLA Set",slaReport.noDueDate]];
    const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `sla-report-${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };
  const openCommentsDialog = (c: any) => {
    setCommentsCase(c);
    setCommentsDialogOpen(true);
  };

  const handleAddComment = () => {
    if (!commentText.trim() || !commentsCase) return;
    addComment.mutate({ caseId: commentsCase.id, content: commentText.trim(), isInternal: commentIsInternal });
  };

  const handleAddReply = (parentId: number) => {
    if (!replyText.trim() || !commentsCase) return;
    addComment.mutate({ caseId: commentsCase.id, content: replyText.trim(), isInternal: commentIsInternal, parentId });
  };

  const openActionDialog = (c: any, defaultStatus: string) => {
    setSelectedCase(c);
    setActionStatus(defaultStatus);
    setNotes(c.notes ?? "");
    setAssignedTo(c.assignedTo ?? "");
    setActionDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedCase || !actionStatus) return;
    updateCase.mutate({
      caseId: selectedCase.id,
      status: actionStatus as any,
      notes: notes || undefined,
      assignedTo: assignedTo || undefined,
    });
  };

  const handleAssignToMe = (caseId: number) => {
    assignCase.mutate({ caseId });
  };

  // Stats
  const criticalCount = data?.cases.filter((c: any) => c.severity === "critical").length ?? 0;
  const escalatedCount = data?.cases.filter((c: any) => c.status === "escalated").length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Assign to Admin Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-indigo-500" />
              Assign Case #{assignCaseId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Select an admin to assign this case to. They will receive an in-app notification.</p>
            <div className="space-y-1">
              <Label className="text-xs">Admin</Label>
              <Select value={assignAdminId} onValueChange={setAssignAdminId}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select admin..." />
                </SelectTrigger>
                <SelectContent>
                  {(adminsData ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name ?? a.email ?? `Admin #${a.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!assignAdminId || assignCaseToAdmin.isPending}
              onClick={() => { if (assignCaseId && assignAdminId) assignCaseToAdmin.mutate({ caseId: assignCaseId, adminId: Number(assignAdminId) }); }}
            >
              {assignCaseToAdmin.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Status Update Dialog */}
      <Dialog open={bulkStatusDialogOpen} onOpenChange={setBulkStatusDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-blue-500" />
              Update Status for {selectedIds.size} case{selectedIds.size !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This will change the status of all {selectedIds.size} selected case{selectedIds.size !== 1 ? "s" : ""} to the chosen status. This action is logged.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">New Status</Label>
              <Select value={bulkNewStatus} onValueChange={setBulkNewStatus}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <strong>Confirm:</strong> {selectedIds.size} case{selectedIds.size !== 1 ? "s" : ""} will be set to "{bulkNewStatus.replace("_", " ")}". Cases set to "resolved" will also have their resolved timestamp updated.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkStatusDialogOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => bulkUpdateCaseStatus.mutate({ caseIds: Array.from(selectedIds), newStatus: bulkNewStatus as any })}
              disabled={bulkUpdateCaseStatus.isPending}
            >
              {bulkUpdateCaseStatus.isPending ? "Updating..." : `Update ${selectedIds.size} Case${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk SLA Dialog */}
      <Dialog open={bulkSlaDialogOpen} onOpenChange={setBulkSlaDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Timer className="h-5 w-5 text-amber-500" />Set SLA for {selectedIds.size} case{selectedIds.size !== 1 ? "s" : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Apply the same SLA deadline to all selected cases.</p>
            <div className="space-y-1"><Label className="text-xs">Due Date &amp; Time</Label>
              <Input type="datetime-local" value={bulkSlaDueAt} onChange={e => setBulkSlaDueAt(e.target.value)} className="text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkSlaDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleBulkSetSla} disabled={!bulkSlaDueAt || bulkSetCaseDueAt.isPending}>{bulkSetCaseDueAt.isPending ? "Setting..." : "Set Deadline"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Compliance Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">AML flags, fraud alerts, and sanctions screening cases</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="cases"><Shield className="h-4 w-4 mr-1.5" />Cases</TabsTrigger>
          <TabsTrigger value="sla-report"><BarChart3 className="h-4 w-4 mr-1.5" />SLA Report</TabsTrigger>
        </TabsList>
        <TabsContent value="sla-report" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">SLA Performance Breakdown</CardTitle>
                <Button variant="outline" size="sm" onClick={exportSlaReportCsv} disabled={!slaReport}><Download className="h-4 w-4 mr-1.5" />Export CSV</Button>
              </div>
            </CardHeader>
            <CardContent>
              {!slaReport ? <div className="flex items-center justify-center h-32"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {([{label:"On Time",value:slaReport.onTime,color:"bg-green-100 text-green-800 border-green-200"},{label:"At Risk",value:slaReport.atRisk,color:"bg-yellow-100 text-yellow-800 border-yellow-200"},{label:"Overdue",value:slaReport.overdue,color:"bg-red-100 text-red-800 border-red-200"},{label:"Escalated",value:slaReport.escalated,color:"bg-purple-100 text-purple-800 border-purple-200"},{label:"No SLA Set",value:slaReport.noDueDate,color:"bg-gray-100 text-gray-600 border-gray-200"}] as const).map(({label,value,color})=>(
                      <div key={label} className={`rounded-lg border p-3 text-center ${color}`}><p className="text-2xl font-bold">{value}</p><p className="text-xs mt-0.5">{label}</p></div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {([{label:"On Time",value:slaReport.onTime,color:"bg-green-500"},{label:"At Risk",value:slaReport.atRisk,color:"bg-yellow-400"},{label:"Overdue",value:slaReport.overdue,color:"bg-red-500"},{label:"Escalated",value:slaReport.escalated,color:"bg-purple-500"},{label:"No SLA Set",value:slaReport.noDueDate,color:"bg-gray-400"}] as const).map(({label,value,color})=>{
                      const total=slaReport.onTime+slaReport.atRisk+slaReport.overdue+slaReport.escalated+slaReport.noDueDate;
                      const pct=total>0?Math.round((value/total)*100):0;
                      return(<div key={label} className="flex items-center gap-3"><span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span><div className="flex-1 bg-muted rounded-full h-3 overflow-hidden"><div className={`h-3 rounded-full ${color} transition-all`} style={{width:`${pct}%`}} /></div><span className="text-xs font-medium w-10 text-right">{pct}%</span></div>);
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="cases" className="mt-4">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold text-red-700">{data?.total ?? 0}</p>
                <p className="text-sm text-red-600">Total Cases</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <XCircle className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold text-orange-700">{criticalCount}</p>
                <p className="text-sm text-orange-600">Critical Severity</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold text-purple-700">{escalatedCount}</p>
                <p className="text-sm text-purple-600">Escalated</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={(v) => { setStatus(v as CaseStatus); setPage(1); }}>
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["all", "open", "under_review", "escalated", "resolved", "dismissed"].map(s => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Severity</Label>
              <Select value={severity} onValueChange={(v) => { setSeverity(v as CaseSeverity); setPage(1); }}>
                <SelectTrigger className="w-32 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["all", "critical", "high", "medium", "low"].map(s => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All Severities" : s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Case Type</Label>
              <Select value={caseType} onValueChange={(v) => { setCaseType(v as CaseType); setPage(1); }}>
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(CASE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Priority</Label>
              <Select value={priority} onValueChange={(v) => { setPriority(v as any); setPage(1); }}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["all","critical","high","medium","low"].map(p => (
                    <SelectItem key={p} value={p}>{p === "all" ? "All Priorities" : p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort By</Label>
              <Select value={sortBy} onValueChange={(v) => { setSortBy(v as any); setPage(1); }}>
                <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">Date Created</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="dueAt">SLA Due Date</SelectItem>
                  <SelectItem value="riskScore">Risk Score</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Search title, notes..."
                  className="h-8 text-sm pl-7 pr-7"
                />
                {searchInput && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cases table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              {data?.total ?? 0} case{(data?.total ?? 0) !== 1 ? "s" : ""} found
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportCsv} disabled={isExporting}>
                <Download className="h-3 w-3 mr-1" />{isExporting ? "Exporting..." : "Export CSV"}
              </Button>
              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => setBulkStatusDialogOpen(true)}>
                    <CheckCircle className="h-3 w-3 mr-1" />Set Status
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => setBulkSlaDialogOpen(true)}>
                    <Timer className="h-3 w-3 mr-1" />Set SLA
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>Clear</Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.cases.length ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <CheckCircle className="h-10 w-10 mb-2 text-green-400" />
              <p>No cases match the current filters</p>
            </div>
          ) : (
            <div className="divide-y">
              {/* Select all row */}
              <div className="px-4 py-2 bg-muted/20 flex items-center gap-3 border-b">
                <Checkbox
                  checked={selectedIds.size === data.cases.length && data.cases.length > 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all cases"
                />
                <span className="text-xs text-muted-foreground">Select all on this page</span>
              </div>
              {data.cases.map((c: any) => (
                <div key={c.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 shrink-0 pt-0.5">
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggleSelect(c.id)}
                        aria-label={`Select case ${c.id}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm truncate">{c.title}</span>
                        <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[c.severity] ?? ""}`}>
                          {c.severity.toUpperCase()}
                        </Badge>
                        <Badge variant="secondary" className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>
                          {c.status.replace("_", " ")}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {CASE_TYPE_LABELS[c.caseType] ?? c.caseType}
                        </Badge>
                        {/* Priority badge */}
                        {(c as any).priority && (
                          <Badge variant="outline" className={`text-xs cursor-pointer ${{critical:"bg-red-100 text-red-800 border-red-300",high:"bg-orange-100 text-orange-800 border-orange-200",medium:"bg-yellow-100 text-yellow-800 border-yellow-200",low:"bg-blue-100 text-blue-800 border-blue-200"}[(c as any).priority as keyof { critical: string; high: string; medium: string; low: string }] ?? ""}`}
                            title="Click to cycle priority"
                            onClick={() => {
                              const order = ["low","medium","high","critical"];
                              const next = order[(order.indexOf((c as any).priority)+1)%order.length] as any;
                              setCasePriority.mutate({ caseId: c.id, priority: next });
                            }}>
                            ↑ {((c as any).priority as string).charAt(0).toUpperCase()+((c as any).priority as string).slice(1)}
                          </Badge>
                        )}
                        {!(c as any).priority && (
                          <Badge variant="outline" className="text-xs cursor-pointer text-muted-foreground" title="Set priority" onClick={() => setCasePriority.mutate({ caseId: c.id, priority: "medium" })}>Set Priority</Badge>
                        )}
                        {(() => {
                          const sla = getSlaStatus((c as any).dueAt);
                          if (!sla) return null;
                          return (
                            <Badge variant="outline" className={`text-xs flex items-center gap-1 ${sla.className}`}>
                              <Timer className="h-3 w-3" />
                              {sla.label}
                            </Badge>
                          );
                        })()}
                      </div>
                      {c.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{c.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {c.userName ?? "Unknown"} ({c.userEmail ?? "—"})
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          Risk Score: <strong className="text-foreground">{c.riskScore ?? 0}</strong>
                        </span>
                        {c.assignedTo ? (
                          <span className="flex items-center gap-1 text-blue-600 font-medium">
                            <UserCheck className="h-3 w-3" />
                            Assigned: {c.assignedTo}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                        <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => openCommentsDialog(c)}
                      >
                        <MessageSquare className="h-3 w-3 mr-1" />
                        Comments
                      </Button>
                      {(c.status === "open" || c.status === "under_review") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                          onClick={() => { setSlaCase(c); setSlaDueAt((c as any).dueAt ? new Date((c as any).dueAt).toISOString().slice(0, 16) : ""); setSlaDialogOpen(true); }}
                        >
                          <Timer className="h-3 w-3 mr-1" />
                          Set SLA
                        </Button>
                      )}
                      {/* Assign buttons */}
                      {(c.status === "open" || c.status === "under_review") && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                            onClick={() => handleAssignToMe(c.id)}
                            disabled={assignCase.isPending}
                          >
                            <UserCheck className="h-3 w-3 mr-1" />
                            Assign to me
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                            onClick={() => { setAssignCaseId(c.id); setAssignAdminId(""); setAssignDialogOpen(true); }}
                          >
                            <User className="h-3 w-3 mr-1" />
                            Assign to...
                          </Button>
                        </>
                      )}
                      {c.status === "open" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => openActionDialog(c, "under_review")}>
                          Review
                        </Button>
                      )}
                      {(c.status === "open" || c.status === "under_review") && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                            onClick={() => openActionDialog(c, "escalated")}>
                            Escalate
                          </Button>
                          <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700"
                            onClick={() => openActionDialog(c, "resolved")}>
                            Resolve
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                            onClick={() => openActionDialog(c, "dismissed")}>
                            Dismiss
                          </Button>
                        </>
                      )}
                      {(c.status === "resolved" || c.status === "dismissed" || c.status === "escalated") && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => openActionDialog(c, c.status)}>
                          Edit
                        </Button>
                      )}
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

      {/* Comments Dialog */}
      <Dialog open={commentsDialogOpen} onOpenChange={(open) => { setCommentsDialogOpen(open); if (!open) setCommentsTab("comments"); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Case Thread: {commentsCase?.title}
            </DialogTitle>
          </DialogHeader>
          <Tabs value={commentsTab} onValueChange={(v) => setCommentsTab(v as any)}>
            <TabsList className="w-full">
              <TabsTrigger value="comments" className="flex-1"><MessageSquare className="h-3.5 w-3.5 mr-1.5" />Comments</TabsTrigger>
              <TabsTrigger value="timeline" className="flex-1"><Activity className="h-3.5 w-3.5 mr-1.5" />Activity Timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="comments" className="mt-3">
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1 py-1">
                {commentsLoading ? (
                  <div className="flex justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (caseComments?.length ?? 0) === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                    <p className="text-sm">No comments yet. Start the investigation thread.</p>
                  </div>
                ) : (
                  (() => {
                    // Separate top-level and replies
                    const topLevel = (caseComments ?? []).filter((c: any) => !c.parentId);
                    const replies = (caseComments ?? []).filter((c: any) => !!c.parentId);
                    return topLevel.map((comment: any) => {
                      const commentReplies = replies.filter((r: any) => r.parentId === comment.id);
                      return (
                        <div key={comment.id}>
                          <div className={`flex gap-3 p-3 rounded-lg ${comment.isInternal ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'}`}>
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <User className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-xs font-medium text-foreground">{comment.authorName ?? "Admin"}</span>
                                <span className="text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleString()}</span>
                                {comment.isInternal ? (
                                  <span className="inline-flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                                    <Lock className="h-2.5 w-2.5" /> Internal
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                    <Globe className="h-2.5 w-2.5" /> External
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-foreground whitespace-pre-wrap">{comment.content}</p>
                              <button
                                className="mt-1 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                                onClick={() => setReplyingToId(replyingToId === comment.id ? null : comment.id)}
                              >
                                <MessageSquare className="h-3 w-3" />
                                {replyingToId === comment.id ? "Cancel" : `Reply${commentReplies.length > 0 ? ` (${commentReplies.length})` : ""}`}
                              </button>
                              {replyingToId === comment.id && (
                                <div className="mt-2 flex gap-2">
                                  <Textarea
                                    placeholder="Write a reply..."
                                    value={replyText}
                                    onChange={e => setReplyText(e.target.value)}
                                    rows={2}
                                    className="text-xs resize-none flex-1"
                                    onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) handleAddReply(comment.id); }}
                                    autoFocus
                                  />
                                  <Button
                                    size="sm"
                                    className="self-end"
                                    onClick={() => handleAddReply(comment.id)}
                                    disabled={addComment.isPending || !replyText.trim()}
                                  >
                                    <Send className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Threaded replies */}
                          {commentReplies.length > 0 && (
                            <div className="ml-8 mt-1 space-y-1.5">
                              {commentReplies.map((reply: any) => (
                                <div key={reply.id} className={`flex gap-2 p-2.5 rounded-lg border-l-2 ${reply.isInternal ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300' : 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-300'}`}>
                                  <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                    <User className="h-3 w-3 text-primary" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                      <span className="text-xs font-medium text-foreground">{reply.authorName ?? "Admin"}</span>
                                      <span className="text-xs text-muted-foreground/70">{new Date(reply.createdAt).toLocaleString()}</span>
                                    </div>
                                    <p className="text-xs text-foreground whitespace-pre-wrap">{reply.content}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()
                )}
              </div>
              <div className="flex gap-2 pt-2 border-t mt-2">
                <Textarea
                  placeholder="Add an investigation note..."
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                  onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) handleAddComment(); }}
                />
                <div className="flex flex-col gap-1 shrink-0 self-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className={`text-xs px-2 ${commentIsInternal ? 'bg-amber-100 dark:bg-amber-900 border-amber-300 text-amber-700' : 'bg-blue-100 dark:bg-blue-900 border-blue-300 text-blue-700'}`}
                    onClick={() => setCommentIsInternal(v => !v)}
                    title={commentIsInternal ? 'Internal (admin-only) — click to make external' : 'External (shareable) — click to make internal'}
                  >
                    {commentIsInternal ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddComment}
                    disabled={addComment.isPending || !commentText.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to submit · {commentIsInternal ? '🔒 Internal (admin-only)' : '🌐 External (shareable)'} · Use @name to notify a colleague</p>
            </TabsContent>
            <TabsContent value="timeline" className="mt-3">
              <CaseTimeline caseId={commentsCase?.id} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Case: {selectedCase?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>New Status</Label>
              <Select value={actionStatus} onValueChange={setActionStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["open", "under_review", "escalated", "resolved", "dismissed"].map(s => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Assign To (optional)</Label>
              <Input
                placeholder="compliance@example.com"
                value={assignedTo}
                onChange={e => setAssignedTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Add investigation notes, findings, or resolution details..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateCase.isPending}>
              {updateCase.isPending ? "Saving..." : "Update Case"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SLA Deadline Dialog */}
      <Dialog open={slaDialogOpen} onOpenChange={setSlaDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-amber-500" />
              Set SLA Deadline
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Case #{slaCase?.id}: <strong>{slaCase?.title}</strong>
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Due Date &amp; Time</Label>
              <Input
                type="datetime-local"
                value={slaDueAt}
                onChange={(e) => setSlaDueAt(e.target.value)}
                className="text-sm"
              />
            </div>
            {slaDueAt && (
              <p className="text-xs text-muted-foreground">
                {getSlaStatus(new Date(slaDueAt).toISOString())?.label ?? ""}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              if (!slaCase) return;
              setCaseDueAt.mutate({ caseId: slaCase.id, dueAt: null });
            }} disabled={setCaseDueAt.isPending}>
              Clear SLA
            </Button>
            <Button size="sm" onClick={() => {
              if (!slaCase || !slaDueAt) return;
              setCaseDueAt.mutate({ caseId: slaCase.id, dueAt: new Date(slaDueAt).toISOString() });
            }} disabled={!slaDueAt || setCaseDueAt.isPending}>
              Set Deadline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Case Activity Timeline Sub-Component ────────────────────────────────────
import DashboardLayout from "@/components/DashboardLayout";
function CaseTimeline({ caseId }: { caseId: number | undefined }) {
  const { data, isLoading } = trpc.admin.getCaseTimeline.useQuery(
    { caseId: caseId ?? 0 },
    { enabled: !!caseId }
  );

  const typeConfig: Record<string, { icon: React.ReactNode; color: string; dot: string }> = {
    created: {
      icon: <GitBranch className="h-3 w-3" />,
      color: "text-green-700 dark:text-green-400",
      dot: "bg-green-500",
    },
    audit: {
      icon: <Tag className="h-3 w-3" />,
      color: "text-blue-700 dark:text-blue-400",
      dot: "bg-blue-500",
    },
    comment: {
      icon: <MessageSquare className="h-3 w-3" />,
      color: "text-amber-700 dark:text-amber-400",
      dot: "bg-amber-500",
    },
  };

  if (!caseId) return null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Activity className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto pr-1 py-1">
      <ol className="relative border-l border-border ml-3 space-y-4">
        {data.map((event) => {
          const cfg = typeConfig[event.type] ?? typeConfig.audit;
          return (
            <DashboardLayout>
            <li key={event.id} className="ml-4">
              <span className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background ${cfg.dot}`} />
              <div className="flex items-start gap-2">
                <div className={`mt-0.5 shrink-0 ${cfg.color}`}>{cfg.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold capitalize ${cfg.color}`}>{event.label}</p>
                  {event.detail && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{event.detail}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    {event.actor && (
                      <span className="text-xs text-muted-foreground">{event.actor}</span>
                    )}
                    <span className="text-xs text-muted-foreground/60">{new Date(event.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </li>
          
            </DashboardLayout>
          );
        })}
      </ol>
    </div>
  );
}
