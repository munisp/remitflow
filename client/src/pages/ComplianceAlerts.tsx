import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  AlertTriangle, Bell, BellOff, CheckCircle, Clock, Plus, RefreshCw, Shield,
  ChevronRight, FileText, User, Hash, Calendar, TrendingUp, Globe,
  MessageSquare, Send, Eye, UserCheck
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-800 border-blue-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  acknowledged: "bg-yellow-100 text-yellow-700",
  under_review: "bg-purple-100 text-purple-700",
  escalated: "bg-orange-100 text-orange-700",
  resolved: "bg-green-100 text-green-700",
  dismissed: "bg-gray-100 text-gray-600",
};

const ALERT_TYPES = ["CTR", "SAR", "OFAC_HIT", "HIGH_RISK", "PEP_MATCH", "VELOCITY", "SANCTIONS", "UNUSUAL_ACTIVITY"];

// ─── Alert Detail Drawer ──────────────────────────────────────────────────────
function AlertDetailDrawer({ alertId, open, onClose }: { alertId: number | null; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [noteText, setNoteText] = useState("");

  const { data: detail, isLoading } = trpc.complianceAlerts.getDetail.useQuery(
    { id: alertId! },
    { enabled: open && alertId != null }
  );

  const ackMut = trpc.complianceAlerts.acknowledge.useMutation({
    onSuccess: () => { utils.complianceAlerts.getDetail.invalidate({ id: alertId! }); utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); toast.success("Alert acknowledged"); },
    onError: (e) => toast.error(e.message),
  });

  const resolveMut = trpc.complianceAlerts.resolve.useMutation({
    onSuccess: () => { utils.complianceAlerts.getDetail.invalidate({ id: alertId! }); utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); toast.success("Alert resolved"); },
    onError: (e) => toast.error(e.message),
  });

  const addNoteMut = trpc.complianceAlerts.addNote.useMutation({
    onSuccess: () => {
      utils.complianceAlerts.getDetail.invalidate({ id: alertId! });
      setNoteText("");
      toast.success("Note added");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open || !alertId) return null;

  const meta = detail?.metadata as Record<string, unknown> | undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Alert #{alertId} — Detail View
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 pt-4">
            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}
          </div>
        ) : !detail ? (
          <p className="text-muted-foreground text-sm pt-4">Alert not found.</p>
        ) : (
          <div className="space-y-6">
            {/* Status + severity badges */}
            <div className="flex flex-wrap gap-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${SEVERITY_COLORS[detail.severity] ?? ""}`}>
                {detail.severity.toUpperCase()}
              </span>
              <Badge variant="outline" className="text-xs">{detail.alertType}</Badge>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[detail.status] ?? ""}`}>
                {detail.status.replace("_", " ")}
              </span>
            </div>

            {/* Title + description */}
            <div>
              <h3 className="font-semibold text-base leading-snug">{detail.title}</h3>
              {detail.description && (
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{detail.description}</p>
              )}
            </div>

            <Separator />

            {/* Metadata grid */}
            {meta && Object.keys(meta).length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-primary" /> Risk Metadata
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {meta.riskScore != null && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Risk Score</p>
                      <p className="text-lg font-bold text-orange-600">{String(meta.riskScore)}<span className="text-xs font-normal text-muted-foreground">/100</span></p>
                    </div>
                  )}
                  {meta.matchConfidence != null && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Match Confidence</p>
                      <p className="text-lg font-bold text-red-600">{String(meta.matchConfidence)}%</p>
                    </div>
                  )}
                  {meta.transactionAmount != null && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Transaction Amount</p>
                      <p className="text-sm font-semibold">{meta.currency as string} {Number(meta.transactionAmount).toLocaleString()}</p>
                    </div>
                  )}
                  {meta.corridor != null && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" /> Corridor</p>
                      <p className="text-sm font-semibold">{String(meta.corridor)}</p>
                    </div>
                  )}
                  {meta.reviewDeadline != null && (
                    <div className="bg-muted/50 rounded-lg p-3 col-span-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Review Deadline</p>
                      <p className="text-sm font-semibold">{new Date(meta.reviewDeadline as string).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Linked entities */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Hash className="h-4 w-4 text-primary" /> Linked Entities
              </h4>
              <div className="flex flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created: {new Date(detail.createdAt).toLocaleString()}</span>
                </div>
                {detail.relatedUserId && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    <span>User #{detail.relatedUserId}</span>
                  </div>
                )}
                {detail.relatedTransactionId && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    <span>Transaction #{detail.relatedTransactionId}</span>
                  </div>
                )}
                {detail.acknowledgedAt && (
                  <div className="flex items-center gap-1.5 text-yellow-600">
                    <Eye className="h-3.5 w-3.5" />
                    <span>Acknowledged: {new Date(detail.acknowledgedAt).toLocaleString()}</span>
                  </div>
                )}
                {detail.resolvedAt && (
                  <div className="flex items-center gap-1.5 text-green-600">
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Resolved: {new Date(detail.resolvedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              {(detail.status === "open" || detail.status === "under_review" || detail.status === "escalated") && (
                <Button size="sm" variant="outline" onClick={() => ackMut.mutate({ id: detail.id })} disabled={ackMut.isPending}>
                  {ackMut.isPending ? "..." : "Acknowledge"}
                </Button>
              )}
              {(detail.status === "open" || detail.status === "acknowledged" || detail.status === "under_review" || detail.status === "escalated") && (
                <Button size="sm" onClick={() => resolveMut.mutate({ id: detail.id })} disabled={resolveMut.isPending} className="bg-green-600 hover:bg-green-700 text-white">
                  {resolveMut.isPending ? "Resolving..." : "Resolve"}
                </Button>
              )}
            </div>

            <Separator />

            {/* Status Transition Timeline */}
            {detail.notes && detail.notes.filter((n: any) => n.isInternal && (
              n.content.includes('Status changed') ||
              n.content.includes('assigned to') ||
              n.content.includes('unassigned') ||
              n.content.includes('SAR submitted') ||
              n.content.includes('escalated')
            )).length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <span className="text-base">🕐</span> Status Timeline
                </h4>
                <div className="relative pl-5">
                  <div className="absolute left-1.5 top-0 bottom-0 w-px bg-border" />
                  {detail.notes
                    .filter((n: any) => n.isInternal && (
                      n.content.includes('Status changed') ||
                      n.content.includes('assigned to') ||
                      n.content.includes('unassigned') ||
                      n.content.includes('SAR submitted') ||
                      n.content.includes('escalated')
                    ))
                    .slice(0, 8)
                    .map((note: any, i: any) => (
                      <div key={i} className="relative mb-3 last:mb-0">
                        <div className="absolute -left-3.5 top-1 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background" />
                        <p className="text-xs text-foreground leading-snug">{note.content}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(note.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Audit trail / notes */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-primary" /> Audit Trail
                <Badge variant="secondary" className="text-xs">{detail.notes?.length ?? 0}</Badge>
              </h4>
              {detail.notes && detail.notes.length > 0 ? (
                <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                  {detail.notes.map((note: any) => (
                    <div key={note.id} className="bg-muted/40 rounded-lg p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs text-muted-foreground">
                          {note.authorName ?? `User #${note.authorId}`}
                          {note.isInternal && <span className="ml-1.5 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">internal</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-sm leading-relaxed">{note.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No notes yet.</p>
              )}

              {/* Add note */}
              <div className="mt-3 flex gap-2">
                <Textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add an internal note..."
                  rows={2}
                  className="text-sm resize-none"
                />
                <Button
                  size="sm"
                  className="shrink-0 self-end"
                  disabled={!noteText.trim() || addNoteMut.isPending}
                  onClick={() => addNoteMut.mutate({ alertId: detail.id, content: noteText.trim(), isInternal: true })}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ComplianceAlerts() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const sseRef = useRef<EventSource | null>(null);
  const [form, setForm] = useState({
    alertType: "CTR" as any,
    severity: "medium" as any,
    title: "",
    description: "",
    relatedUserId: "",
    relatedTransactionId: "",
  });

  const { data: alerts, isLoading, refetch } = trpc.complianceAlerts.list.useQuery({
    status: statusFilter as any,
    severity: severityFilter as any,
    limit: 100,
  });

  const { data: stats } = trpc.complianceAlerts.stats.useQuery();
  const { data: officers } = trpc.complianceAlerts.listComplianceOfficers.useQuery();
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"priority" | "date">("date");

  const assignMut = trpc.complianceAlerts.assign.useMutation({
    onSuccess: () => { utils.complianceAlerts.list.invalidate(); toast.success("Alert assigned"); setAssigningId(null); },
    onError: (e) => toast.error(e.message),
  });

  const createMut = trpc.complianceAlerts.create.useMutation({
    onSuccess: () => {
      utils.complianceAlerts.list.invalidate();
      utils.complianceAlerts.stats.invalidate();
      setCreateOpen(false);
      toast.success("Alert created");
      setForm({ alertType: "CTR", severity: "medium", title: "", description: "", relatedUserId: "", relatedTransactionId: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const ackMut = trpc.complianceAlerts.acknowledge.useMutation({
    onSuccess: () => { utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); toast.success("Alert acknowledged"); },
  });

  const resolveMut = trpc.complianceAlerts.resolve.useMutation({
    onSuccess: () => { utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); toast.success("Alert resolved"); },
  });

  const [snoozeId, setSnoozeId] = useState<number | null>(null);
  const [snoozeHours, setSnoozeHours] = useState("24");
  const snoozeMut = trpc.complianceAlerts.snooze.useMutation({
    onSuccess: () => { utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); toast.success("Alert snoozed"); setSnoozeId(null); },
    onError: (e) => toast.error(e.message),
  });
  const unsnoozeMut = trpc.complianceAlerts.unsnooze.useMutation({
    onSuccess: () => { utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); toast.success("Alert re-opened"); },
    onError: (e) => toast.error(e.message),
  });

  // SSE real-time listener — resilient with exponential backoff + polling fallback
  useEffect(() => {
    let es: EventSource | null = null;
    let retries = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    let mounted = true;
    let mode: "sse" | "polling" = "sse";

    const resetHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        if (es) { es.close(); es = null; }
        if (mounted) connectSSE();
      }, 45_000);
    };

    const startPolling = () => {
      mode = "polling";
      const poll = () => {
        if (!mounted || mode !== "polling") return;
        if (navigator.onLine) {
          utils.complianceAlerts.list.invalidate();
          utils.complianceAlerts.stats.invalidate();
        }
        pollTimer = setTimeout(poll, navigator.onLine ? 15_000 : 30_000);
      };
      poll();
    };

    const connectSSE = () => {
      if (!mounted) return;
      if (es) { es.close(); es = null; }
      es = new EventSource("/api/sse/admin", { withCredentials: true });
      sseRef.current = es;
      resetHeartbeat();
      es.onopen = () => { retries = 0; mode = "sse"; resetHeartbeat(); };
      es.addEventListener("compliance_alert", (e) => {
        if (!mounted) return;
        resetHeartbeat();
        const data = JSON.parse((e as MessageEvent).data);
        setLiveCount(c => c + 1);
        toast.warning(`New ${data.severity?.toUpperCase()} Alert: ${data.title}`, { duration: 8000 });
        utils.complianceAlerts.list.invalidate();
        utils.complianceAlerts.stats.invalidate();
      });
      es.addEventListener("compliance_alert_resolved", () => { if (!mounted) return; resetHeartbeat(); utils.complianceAlerts.list.invalidate(); utils.complianceAlerts.stats.invalidate(); });
      es.addEventListener("ping", () => { resetHeartbeat(); });
      es.onerror = () => {
        if (!mounted) return;
        es?.close(); es = null;
        retries++;
        if (retries >= 3) { startPolling(); return; }
        setTimeout(() => { if (mounted) connectSSE(); }, Math.min(1000 * Math.pow(2, retries - 1), 30_000));
      };
    };

    connectSSE();
    const handleOnline = () => { if (mode === "polling") { if (pollTimer) clearTimeout(pollTimer); mode = "sse"; retries = 0; connectSSE(); } };
    window.addEventListener("online", handleOnline);
    return () => { mounted = false; es?.close(); if (pollTimer) clearTimeout(pollTimer); if (heartbeatTimer) clearTimeout(heartbeatTimer); window.removeEventListener("online", handleOnline); };
  }, []);

  const openDrawer = (id: number) => { setSelectedAlertId(id); setDrawerOpen(true); };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-red-500" /> Compliance Alerts
              {liveCount > 0 && <Badge className="bg-red-500 text-white animate-pulse">{liveCount} new</Badge>}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Real-time compliance monitoring — CTR, SAR, OFAC, PEP, and velocity alerts</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetch(); setLiveCount(0); }} className="gap-1">
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="w-4 h-4" /> Create Alert</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Create Compliance Alert</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Alert Type</Label>
                      <Select value={form.alertType} onValueChange={v => setForm(f => ({ ...f, alertType: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{ALERT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Severity</Label>
                      <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["low","medium","high","critical"].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Title *</Label>
                    <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. High-value transaction flagged" />
                  </div>
                  <div className="space-y-1">
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Details about this alert..." />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Related User ID</Label>
                      <Input type="number" value={form.relatedUserId} onChange={e => setForm(f => ({ ...f, relatedUserId: e.target.value }))} placeholder="Optional" />
                    </div>
                    <div className="space-y-1">
                      <Label>Related Tx ID</Label>
                      <Input type="number" value={form.relatedTransactionId} onChange={e => setForm(f => ({ ...f, relatedTransactionId: e.target.value }))} placeholder="Optional" />
                    </div>
                  </div>
                  <Button
                    onClick={() => createMut.mutate({
                      ...form,
                      relatedUserId: form.relatedUserId ? parseInt(form.relatedUserId) : undefined,
                      relatedTransactionId: form.relatedTransactionId ? parseInt(form.relatedTransactionId) : undefined,
                    })}
                    disabled={createMut.isPending || !form.title}
                    className="w-full"
                  >
                    {createMut.isPending ? "Creating..." : "Create Alert"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "Open", value: stats.open, icon: <AlertTriangle className="w-4 h-4 text-red-500" />, color: "text-red-600" },
              { label: "Critical", value: stats.critical, icon: <Bell className="w-4 h-4 text-red-600" />, color: "text-red-700" },
              { label: "High", value: stats.high, icon: <AlertTriangle className="w-4 h-4 text-orange-500" />, color: "text-orange-600" },
              { label: "Medium", value: stats.medium, icon: <Clock className="w-4 h-4 text-yellow-500" />, color: "text-yellow-600" },
              { label: "Low", value: stats.low, icon: <CheckCircle className="w-4 h-4 text-blue-500" />, color: "text-blue-600" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2">{s.icon}<span className="text-sm text-muted-foreground">{s.label}</span></div>
                  <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters + Sort */}
        <div className="flex gap-3 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {["all","open","under_review","acknowledged","escalated","resolved","dismissed"].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All Status" : s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              {["all","critical","high","medium","low"].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All Severity" : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Sort by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Sort: Newest First</SelectItem>
              <SelectItem value="priority">Sort: Priority Score</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Alerts List */}
        {isLoading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
        ) : !alerts?.length ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground"><Shield className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No compliance alerts found</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {(sortBy === "priority"
              ? [...(alerts ?? [])].sort((a, b) => ((b as any).priorityScore ?? 0) - ((a as any).priorityScore ?? 0))
              : alerts ?? []
            ).map((alert: any) => (
              <Card
                key={alert.id}
                className={`border-l-4 cursor-pointer hover:shadow-md transition-shadow ${alert.severity === "critical" ? "border-l-red-500" : alert.severity === "high" ? "border-l-orange-500" : alert.severity === "medium" ? "border-l-yellow-500" : "border-l-blue-400"}`}
                onClick={() => openDrawer(alert.id)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${SEVERITY_COLORS[alert.severity] ?? ""}`}>{alert.severity.toUpperCase()}</span>
                        <Badge variant="outline" className="text-xs">{alert.alertType}</Badge>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[alert.status] ?? ""}`}>{alert.status.replace("_", " ")}</span>
                      </div>
                      <p className="font-semibold text-sm">{alert.title}</p>
                      {alert.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.description}</p>}
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span>#{alert.id}</span>
                        {alert.relatedUserId && <span>User: {alert.relatedUserId}</span>}
                        {alert.relatedTransactionId && <span>Tx: {alert.relatedTransactionId}</span>}
                        <span>{new Date(alert.createdAt).toLocaleString()}</span>
                        {(() => {
                          const ageMs = Date.now() - new Date(alert.createdAt).getTime();
                          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
                          const ageHrs = Math.floor(ageMs / (1000 * 60 * 60));
                          const label = ageDays > 0 ? `${ageDays}d old` : `${ageHrs}h old`;
                          const cls = ageDays >= 14 ? 'text-red-600 font-medium' : ageDays >= 7 ? 'text-orange-600' : 'text-muted-foreground';
                                 <span className={cls}>{label}</span>;
                        })()}
                        {(alert as any).priorityScore != null && (
                          <span className={`font-mono text-xs px-1.5 py-0.5 rounded border ${
                            (alert as any).priorityScore >= 60 ? 'bg-red-50 text-red-700 border-red-300' :
                            (alert as any).priorityScore >= 35 ? 'bg-orange-50 text-orange-700 border-orange-300' :
                            'bg-gray-50 text-gray-600 border-gray-200'
                          }`}>P:{(alert as any).priorityScore}</span>
                        )}
                        {(alert as any).assignedTo && (
                          <span className="flex items-center gap-1 text-blue-600">
                            <UserCheck className="h-3 w-3" />
                            Assigned
                          </span>
                        )}
                      </div>
                      {/* Inline assign dropdown */}
                      {assigningId === alert.id && (
                        <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <Select
                            onValueChange={(v) => {
                              assignMut.mutate({ alertId: alert.id, assignedTo: v === "unassign" ? null : Number(v) });
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-48">
                              <SelectValue placeholder="Select officer…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassign">— Unassign —</SelectItem>
                              {(officers ?? []).map((o: any) => (
                                <SelectItem key={o.id} value={String(o.id)}>
                                  {o.name ?? o.email ?? `Officer #${o.id}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAssigningId(null)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button
                        size="sm" variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => setAssigningId(assigningId === alert.id ? null : alert.id)}
                      >
                        <UserCheck className="h-3 w-3 mr-1" />
                        Assign
                      </Button>
                      {(alert.status === "open" || alert.status === "under_review" || alert.status === "escalated") && (
                        <Button size="sm" variant="outline" onClick={() => ackMut.mutate({ id: alert.id })} disabled={ackMut.isPending}>Acknowledge</Button>
                      )}
                      {(alert.status === "open" || alert.status === "acknowledged" || alert.status === "under_review" || alert.status === "escalated") && (
                        <Button size="sm" onClick={() => resolveMut.mutate({ id: alert.id })} disabled={resolveMut.isPending} className="bg-green-600 hover:bg-green-700 text-white">Resolve</Button>
                      )}
                      {alert.status !== "resolved" && alert.status !== "dismissed" && alert.status !== "snoozed" && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={(e) => { e.stopPropagation(); setSnoozeId(alert.id); }}>
                          <Bell className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {alert.status === "snoozed" && (
                        <Button size="sm" variant="ghost" className="text-yellow-600" onClick={(e) => { e.stopPropagation(); unsnoozeMut.mutate({ alertId: alert.id }); }}>
                          <BellOff className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <AlertDetailDrawer
        alertId={selectedAlertId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedAlertId(null); }}
      />

      {/* Snooze Dialog */}
      <Dialog open={snoozeId !== null} onOpenChange={o => { if (!o) setSnoozeId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-yellow-500" /> Snooze Alert
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">The alert will be hidden from the main list and re-opened automatically after the snooze period.</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Snooze duration</Label>
              <Select value={snoozeHours} onValueChange={setSnoozeHours}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 hours</SelectItem>
                  <SelectItem value="8">8 hours</SelectItem>
                  <SelectItem value="24">24 hours (1 day)</SelectItem>
                  <SelectItem value="48">48 hours (2 days)</SelectItem>
                  <SelectItem value="72">72 hours (3 days)</SelectItem>
                  <SelectItem value="168">1 week</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setSnoozeId(null)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-yellow-500 hover:bg-yellow-600 text-white"
                disabled={snoozeMut.isPending}
                onClick={() => snoozeId && snoozeMut.mutate({ alertId: snoozeId, hours: Number(snoozeHours) })}
              >
                {snoozeMut.isPending ? "Snoozing..." : `Snooze for ${snoozeHours}h`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
