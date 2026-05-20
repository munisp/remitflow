import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Loader2, Search, FileText, Clock, CheckCircle2, XCircle,
  AlertTriangle, ChevronLeft, ChevronRight, Eye, RefreshCw,
  Info, ShieldCheck, TrendingUp
} from "lucide-react";
import { Link } from "wouter";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; description: string }> = {
  validated: {
    label: "Validated",
    variant: "default",
    icon: <CheckCircle2 className="h-3 w-3" />,
    description: "Passed automated CBN format and corridor checks",
  },
  approved: {
    label: "Approved",
    variant: "default",
    icon: <ShieldCheck className="h-3 w-3" />,
    description: "Manually approved by a compliance officer",
  },
  pending: {
    label: "Pending Review",
    variant: "secondary",
    icon: <Clock className="h-3 w-3" />,
    description: "Awaiting compliance officer review",
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    icon: <XCircle className="h-3 w-3" />,
    description: "Rejected — see validation errors for details",
  },
};

function ExpiryBadge({ validityDate }: { validityDate: string | Date | null }) {
  if (!validityDate) return <span className="text-muted-foreground text-xs">No expiry</span>;
  const d = new Date(validityDate);
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="destructive" className="text-xs">Expired</Badge>
        <span className="text-xs text-muted-foreground">{d.toLocaleDateString()}</span>
      </div>
    );
  }
  if (daysLeft <= 14) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
          <AlertTriangle className="h-3 w-3 mr-1" />{daysLeft}d left
        </Badge>
        <span className="text-xs text-muted-foreground">{d.toLocaleDateString()}</span>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm font-medium">{d.toLocaleDateString()}</p>
      <p className="text-xs text-muted-foreground">{daysLeft} days remaining</p>
    </div>
  );
}

function ValidationDetail({ result }: { result: Record<string, unknown> | null }) {
  if (!result) return <p className="text-sm text-muted-foreground">No validation data available</p>;
  const errors = (result.errors as string[]) ?? [];
  const warnings = (result.warnings as string[]) ?? [];
  const review = result.compliance_review as Record<string, unknown> | undefined;
  const isValid = result.is_valid as boolean;
  return (
    <div className="space-y-4 text-sm">
      {/* Summary */}
      <div className={`rounded-lg p-4 ${isValid ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
        <div className="flex items-center gap-2 mb-2">
          {isValid
            ? <CheckCircle2 className="h-5 w-5 text-green-600" />
            : <XCircle className="h-5 w-5 text-red-600" />}
          <span className={`font-semibold ${isValid ? "text-green-700" : "text-red-700"}`}>
            {isValid ? "Validation Passed" : "Validation Failed"}
          </span>
        </div>
        <p className={`text-xs ${isValid ? "text-green-600" : "text-red-600"}`}>
          Source: {String(result.validation_source ?? result.source ?? "automated")}
        </p>
      </div>

      {/* Key fields */}
      <div className="grid grid-cols-2 gap-3 bg-muted/30 rounded-lg p-3">
        <div>
          <p className="text-xs text-muted-foreground">Trade Corridor</p>
          <p className="font-medium">{String(result.corridor_code ?? "—")}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Transaction Value</p>
          <p className="font-medium">${Number(result.value_usd ?? 0).toLocaleString()} USD</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">CBN Reference</p>
          <p className="font-mono text-xs">{String(result.cbn_reference ?? "—")}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Validated At</p>
          <p className="text-xs">{result.validated_at ? new Date(result.validated_at as string).toLocaleString() : "—"}</p>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="font-semibold text-red-700 mb-2 flex items-center gap-1">
            <XCircle className="h-4 w-4" />Validation Errors ({errors.length})
          </p>
          <ul className="space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="text-xs text-red-700 flex items-start gap-1">
                <span className="mt-0.5">•</span>{e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
          <p className="font-semibold text-yellow-700 mb-2 flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />Warnings ({warnings.length})
          </p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-yellow-700 flex items-start gap-1">
                <span className="mt-0.5">•</span>{w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Compliance review note */}
      {review && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
          <p className="font-semibold text-blue-700 mb-2 flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" />Compliance Officer Review
          </p>
          <p className="text-xs text-blue-700">Reviewed: {new Date(review.reviewed_at as string).toLocaleString()}</p>
          <p className="text-xs text-blue-700">Decision: <strong>{String(review.new_status).toUpperCase()}</strong></p>
          {review.note && <p className="text-xs text-blue-700 mt-1 italic">"{String(review.note)}"</p>}
        </div>
      )}
    </div>
  );
}

export default function SmeTradeFormMHistory() {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "validated" | "approved" | "rejected">("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const LIMIT = 15;

  const { data, isLoading, refetch } = trpc.smeTrade.listFormMHistory.useQuery({
    limit: LIMIT,
    offset: page * LIMIT,
    status: statusFilter,
    search: search || undefined,
  });

  const { data: docDetail, isLoading: detailLoading } = trpc.smeTrade.getFormMDocument.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null }
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const validatedCount = rows.filter(r => r.status === "validated" || r.status === "approved").length;
  const rejectedCount = rows.filter(r => r.status === "rejected").length;
  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-purple-600" />
            Form M Validation History
          </h1>
          <p className="text-muted-foreground mt-1">
            Track all your CBN Form M submissions, validation results, and 90-day expiry dates
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Link href="/sme-trade">
            <Button size="sm">
              <TrendingUp className="h-4 w-4 mr-2" />
              SME Trade
            </Button>
          </Link>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 flex items-start gap-3">
        <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-700">
          <p className="font-medium mb-1">CBN Form M Requirements</p>
          <p>Form M is mandatory for all trade payments of <strong>USD 10,000 or above</strong>. Validated Form M documents are valid for <strong>90 days</strong> from the validation date. Ensure your Form M is approved before initiating batch payments.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Submissions</p>
            <p className="text-3xl font-bold mt-1">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Validated / Approved</p>
            <p className="text-3xl font-bold mt-1 text-green-600">{validatedCount}</p>
          </CardContent>
        </Card>
        <Card className={pendingCount > 0 ? "border-yellow-300" : ""}>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Review</p>
            <p className={`text-3xl font-bold mt-1 ${pendingCount > 0 ? "text-yellow-600" : ""}`}>{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className={rejectedCount > 0 ? "border-red-300" : ""}>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Rejected</p>
            <p className={`text-3xl font-bold mt-1 ${rejectedCount > 0 ? "text-red-600" : ""}`}>{rejectedCount}</p>
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
              <Label className="text-xs mb-1 block">Filter by Status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="validated">Validated</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(search || statusFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchInput(""); setStatusFilter("all"); setPage(0); }}>
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submission History</CardTitle>
          <CardDescription>Click "View" on any row to see full validation details and compliance notes</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 px-6">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">No Form M submissions yet</p>
              <p className="text-muted-foreground text-sm mb-4">
                {search || statusFilter !== "all"
                  ? "No submissions match your current filters."
                  : "Use the SME Trade page to validate a Form M number before submitting a batch payment."}
              </p>
              {!search && statusFilter === "all" && (
                <Link href="/sme-trade">
                  <Button>Go to SME Trade</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form M Number</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Value (USD)</TableHead>
                    <TableHead>CBN Reference</TableHead>
                    <TableHead>Valid Until</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const valResult = row.pythonValidationResult as Record<string, unknown> | null;
                    const corridorCode = valResult?.corridor_code ?? "—";
                    const valueUsd = valResult?.value_usd ?? 0;
                    const cfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.pending;
                    return (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell>
                          <span className="font-mono text-sm font-semibold">{row.formNumber ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{String(corridorCode)}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">${Number(valueUsd).toLocaleString()}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{row.cbnPortalRef ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <ExpiryBadge validityDate={row.validityDate} />
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
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="ghost" onClick={() => setSelectedId(row.id)}>
                                <Eye className="h-3 w-3 mr-1" />View
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg">
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  <FileText className="h-5 w-5 text-purple-600" />
                                  Form M — {row.formNumber}
                                </DialogTitle>
                              </DialogHeader>
                              {detailLoading ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader2 className="h-6 w-6 animate-spin" />
                                </div>
                              ) : docDetail ? (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-2 text-sm">
                                    <Badge variant={STATUS_CONFIG[docDetail.status]?.variant ?? "secondary"} className="flex items-center gap-1">
                                      {STATUS_CONFIG[docDetail.status]?.icon}
                                      {STATUS_CONFIG[docDetail.status]?.label ?? docDetail.status}
                                    </Badge>
                                    <span className="text-muted-foreground">
                                      {STATUS_CONFIG[docDetail.status]?.description}
                                    </span>
                                  </div>
                                  <ValidationDetail result={docDetail.pythonValidationResult as Record<string, unknown> | null} />
                                  <div className="text-xs text-muted-foreground border-t pt-3">
                                    Submission ID: #{docDetail.id} · Submitted: {new Date(docDetail.createdAt).toLocaleString()}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-muted-foreground text-sm">Could not load document details.</p>
                              )}
                            </DialogContent>
                          </Dialog>
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
