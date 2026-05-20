import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Shield, FileText, Clock, CheckCircle2, XCircle, AlertTriangle, ChevronLeft, ChevronRight, Eye, RefreshCw } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  validated: { label: "Validated", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  approved: { label: "Approved", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  pending: { label: "Pending Review", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  rejected: { label: "Rejected", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
};

function ExpiryCountdown({ validityDate }: { validityDate: string | Date | null }) {
  if (!validityDate) return <span className="text-muted-foreground text-xs">—</span>;
  const d = new Date(validityDate);
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <Badge variant="destructive" className="text-xs">Expired</Badge>;
  if (daysLeft <= 14) return <Badge variant="outline" className="text-xs text-orange-600 border-orange-300"><AlertTriangle className="h-3 w-3 mr-1" />{daysLeft}d left</Badge>;
  return <span className="text-xs text-muted-foreground">{d.toLocaleDateString()} ({daysLeft}d)</span>;
}

function ValidationResultPanel({ result }: { result: Record<string, unknown> | null }) {
  if (!result) return <p className="text-muted-foreground text-sm">No validation data</p>;
  const errors = (result.errors as string[]) ?? [];
  const warnings = (result.warnings as string[]) ?? [];
  const review = result.compliance_review as Record<string, unknown> | undefined;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div><span className="text-muted-foreground">Source:</span> <span className="font-mono text-xs">{String(result.validation_source ?? result.source ?? "—")}</span></div>
        <div><span className="text-muted-foreground">Corridor:</span> <span className="font-medium">{String(result.corridor_code ?? "—")}</span></div>
        <div><span className="text-muted-foreground">Value (USD):</span> <span className="font-medium">${Number(result.value_usd ?? 0).toLocaleString()}</span></div>
        <div><span className="text-muted-foreground">CBN Ref:</span> <span className="font-mono text-xs">{String(result.cbn_reference ?? "—")}</span></div>
      </div>
      {errors.length > 0 && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
          <p className="font-medium text-destructive mb-1">Errors ({errors.length})</p>
          {errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
          <p className="font-medium text-yellow-700 mb-1">Warnings ({warnings.length})</p>
          {warnings.map((w, i) => <p key={i} className="text-xs text-yellow-700">{w}</p>)}
        </div>
      )}
      {review && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
          <p className="font-medium text-blue-700 mb-1">Compliance Review</p>
          <p className="text-xs text-blue-700">Reviewed: {new Date(review.reviewed_at as string).toLocaleString()}</p>
          <p className="text-xs text-blue-700">Status set to: <strong>{String(review.new_status)}</strong></p>
          {review.note ? <p className="text-xs text-blue-700 mt-1">Note: {String(review.note)}</p> : null}
        </div>
      )}
    </div>
  );
}

export default function ComplianceFormMAudit() {
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "validated" | "approved" | "rejected">("all");
  const [expiryFilter, setExpiryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<number | null>(null);
  const [reviewDocId, setReviewDocId] = useState<number | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"validated" | "approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const LIMIT = 25;

  const { data, isLoading, refetch } = trpc.smeTrade.listFormMDocumentsAdmin.useQuery({
    limit: LIMIT,
    offset: page * LIMIT,
    status: statusFilter,
    search: search || undefined,
    expiringWithinDays: expiryFilter === "7" ? 7 : expiryFilter === "30" ? 30 : undefined,
  }, { enabled: user?.role === "admin" });

  const { data: docDetail } = trpc.smeTrade.getFormMDocument.useQuery(
    { id: selectedDoc! },
    { enabled: selectedDoc !== null }
  );

  const updateStatus = trpc.smeTrade.updateFormMStatus.useMutation({
    onSuccess: () => {
      toast.success(`Form M status updated to ${reviewStatus}`);
      setReviewDocId(null);
      setReviewNote("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const pendingCount = rows.filter((r: any) => r.status === "pending").length;
  const expiringCount = rows.filter((r: any) => {
    if (!r.validityDate) return false;
    const d = new Date(r.validityDate);
    return d.getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000 && d.getTime() > Date.now();
  }).length;

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground">This page is only accessible to compliance officers and administrators.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-600" />
            Form M Compliance Audit
          </h1>
          <p className="text-muted-foreground mt-1">Review, approve, and manage all CBN Form M validation submissions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Submissions</p>
            <p className="text-3xl font-bold mt-1">{total}</p>
          </CardContent>
        </Card>
        <Card className={pendingCount > 0 ? "border-yellow-300" : ""}>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Review</p>
            <p className={`text-3xl font-bold mt-1 ${pendingCount > 0 ? "text-yellow-600" : ""}`}>{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className={expiringCount > 0 ? "border-orange-300" : ""}>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Expiring &lt;14 days</p>
            <p className={`text-3xl font-bold mt-1 ${expiringCount > 0 ? "text-orange-600" : ""}`}>{expiringCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Page</p>
            <p className="text-3xl font-bold mt-1">{page + 1} / {Math.max(totalPages, 1)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs mb-1 block">Search Form M Number</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. FM240001234"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(0); } }}
                  className="font-mono text-sm"
                />
                <Button size="sm" onClick={() => { setSearch(searchInput); setPage(0); }}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="min-w-[160px]">
              <Label className="text-xs mb-1 block">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="validated">Validated</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <Label className="text-xs mb-1 block">Expiry Filter</Label>
              <Select value={expiryFilter} onValueChange={(v) => { setExpiryFilter(v); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  <SelectItem value="7">Expiring in 7 days</SelectItem>
                  <SelectItem value="30">Expiring in 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(search || statusFilter !== "all" || expiryFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchInput(""); setStatusFilter("all"); setExpiryFilter("all"); setPage(0); }}>
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Form M Submissions
            {total > 0 && <Badge variant="secondary" className="ml-2">{total} total</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No Form M submissions found</p>
              {(search || statusFilter !== "all") && <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Form M Number</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Value (USD)</TableHead>
                    <TableHead>CBN Reference</TableHead>
                    <TableHead>Validity / Expiry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: any) => {
                    const valResult = row.pythonValidationResult as Record<string, unknown> | null;
                    const corridorCode = valResult?.corridor_code ?? "—";
                    const valueUsd = valResult?.value_usd ?? 0;
                    const cfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.pending;
                    return (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell className="text-muted-foreground text-xs">{row.id}</TableCell>
                        <TableCell>
                          <span className="font-mono text-sm font-medium">{row.formNumber ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{(row as any).userName ?? `User #${row.userId}`}</p>
                            <p className="text-xs text-muted-foreground">{(row as any).userEmail ?? ""}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{String(corridorCode)}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">${Number(valueUsd).toLocaleString()}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{row.cbnPortalRef ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <ExpiryCountdown validityDate={row.validityDate} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={cfg.variant} className="flex items-center gap-1 w-fit text-xs">
                            {cfg.icon}{cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {/* View detail */}
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="ghost" onClick={() => setSelectedDoc(row.id)}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-lg">
                                <DialogHeader>
                                  <DialogTitle>Form M Detail — {row.formNumber}</DialogTitle>
                                </DialogHeader>
                                {docDetail ? (
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                      <div><span className="text-muted-foreground">Form Type:</span> <strong>{docDetail.formType}</strong></div>
                                      <div><span className="text-muted-foreground">Status:</span> <Badge variant={STATUS_CONFIG[docDetail.status]?.variant ?? "secondary"} className="text-xs">{docDetail.status}</Badge></div>
                                      <div><span className="text-muted-foreground">Submitted:</span> {new Date(docDetail.createdAt).toLocaleString()}</div>
                                      <div><span className="text-muted-foreground">User:</span> {(docDetail as any).userName ?? `#${docDetail.userId}`}</div>
                                    </div>
                                    <ValidationResultPanel result={docDetail.pythonValidationResult as Record<string, unknown> | null} />
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                                )}
                              </DialogContent>
                            </Dialog>

                            {/* Review / update status */}
                            <Dialog open={reviewDocId === row.id} onOpenChange={(o) => { if (!o) setReviewDocId(null); }}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" onClick={() => { setReviewDocId(row.id); setReviewStatus("approved"); setReviewNote(""); }}>
                                  Review
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Review Form M — {row.formNumber}</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label>New Status</Label>
                                    <Select value={reviewStatus} onValueChange={(v) => setReviewStatus(v as any)}>
                                      <SelectTrigger><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="approved">Approved</SelectItem>
                                        <SelectItem value="validated">Validated</SelectItem>
                                        <SelectItem value="rejected">Rejected</SelectItem>
                                        <SelectItem value="pending">Pending (reset)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Compliance Note (optional)</Label>
                                    <Textarea
                                      value={reviewNote}
                                      onChange={(e) => setReviewNote(e.target.value)}
                                      placeholder="Add a note for the audit trail..."
                                      rows={3}
                                    />
                                  </div>
                                  <Button
                                    className="w-full"
                                    disabled={updateStatus.isPending}
                                    onClick={() => updateStatus.mutate({ id: row.id, status: reviewStatus, note: reviewNote || undefined })}
                                  >
                                    {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Save Review
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total} submissions
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Next<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
