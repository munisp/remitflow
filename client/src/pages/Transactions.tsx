import { useState, useCallback, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ArrowUpRight, ArrowDownLeft, Search, Download, RefreshCw, Copy,
  ChevronDown, FileText, FileJson, TrendingUp, TrendingDown,
  Activity, Clock, CheckCircle, XCircle, ChevronLeft, ChevronRight,
  CalendarDays, BarChart3, Filter, X
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const statusColor: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
};

const PAGE_SIZE = 20;

// Date range preset helpers
const DATE_PRESETS = [
  { label: "Today", getDates: () => { const d = new Date().toISOString().slice(0, 10); return { from: d, to: d }; } },
  { label: "Last 7 days", getDates: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 6); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; } },
  { label: "Last 30 days", getDates: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 29); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; } },
  { label: "This month", getDates: () => { const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), 1); return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }; } },
  { label: "Last 3 months", getDates: () => { const to = new Date(); const from = new Date(); from.setMonth(from.getMonth() - 3); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; } },
];

export default function Transactions() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [showAnalytics, setShowAnalytics] = useState(true);

  // Server-side pagination: fetch only current page
  const { data, isLoading, refetch } = trpc.transactions.list.useQuery({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    type: typeFilter,
    status: statusFilter,
    search: search || undefined,
  });
  const { data: stats } = trpc.transactions.stats.useQuery();
  const utils = trpc.useUtils();

  const txns = Array.isArray(data) ? data : [];
  const filtered = txns; // server already filters

  // Pagination: use stats.total for page count when no filters, else use returned count
  const totalFromStats = stats?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFromStats / PAGE_SIZE));

  // Analytics computed from current page (summary cards use stats endpoint)
  const analytics = useMemo(() => {
    const sent = txns.filter((t: any) => t.type === "send" && t.status === "completed");
    const received = txns.filter((t: any) => t.type === "receive" && t.status === "completed");
    const totalSent = sent.reduce((s: number, t: any) => s + Number(t.fromAmount ?? 0), 0);
    const totalReceived = received.reduce((s: number, t: any) => s + Number(t.fromAmount ?? 0), 0);
    const totalFees = txns.reduce((s: number, t: any) => s + Number(t.fee ?? 0), 0);
    const failedCount = txns.filter((t: any) => t.status === "failed").length;
    const pendingCount = txns.filter((t: any) => t.status === "pending" || t.status === "processing").length;
    const dayMap: Record<string, number> = {};
    txns.forEach((t: any) => {
      const day = new Date(t.createdAt).toISOString().slice(0, 10);
      dayMap[day] = (dayMap[day] ?? 0) + Number(t.fromAmount ?? 0);
    });
    const days = Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).slice(-14);
    const maxVol = Math.max(...days.map(([, v]) => v), 1);
    return { totalSent, totalReceived, totalFees, failedCount, pendingCount, days, maxVol };
  }, [txns]);

  const hasFilters = search || statusFilter !== "all" || typeFilter !== "all" || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const handleExport = useCallback(async (format: "csv" | "json") => {
    setExporting(true);
    try {
      const result = await utils.client.transactions.export.query({
        format,
        type: typeFilter,
        status: statusFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      const date = new Date().toISOString().slice(0, 10);
      if (format === "csv" && result.csv) {
        const blob = new Blob([result.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `remitflow-transactions-${date}.csv`; a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${result.count} transactions as CSV`);
      } else if (format === "json" && result.data) {
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `remitflow-transactions-${date}.json`; a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${result.count} transactions as JSON`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }, [utils, typeFilter, statusFilter, dateFrom, dateTo]);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Transaction History
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {stats ? `${stats.total} total transactions` : "Your complete payment history"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(v => !v)}>
              <BarChart3 className="h-4 w-4 mr-1" />
              {showAnalytics ? "Hide" : "Show"} Analytics
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={exporting}>
                  {exporting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Export <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("csv")}>
                  <FileText className="h-4 w-4 mr-2" />Download CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("json")}>
                  <FileJson className="h-4 w-4 mr-2" />Download JSON
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {DATE_PRESETS.map(p => (
                  <DropdownMenuItem key={p.label} onClick={() => { const d = p.getDates(); setDateFrom(d.from); setDateTo(d.to); setPage(1); }}>
                    <CalendarDays className="h-4 w-4 mr-2 text-muted-foreground" />{p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Analytics Cards */}
        {showAnalytics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Total Sent</span>
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xl font-bold tabular-nums">{analytics.totalSent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{filtered.filter((t: any) => t.type === "send").length} transfers</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Total Received</span>
                  <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
                </div>
                <p className="text-xl font-bold tabular-nums text-emerald-600">{analytics.totalReceived.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{filtered.filter((t: any) => t.type === "receive").length} receipts</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Fees Paid</span>
                  <TrendingDown className="h-4 w-4 text-orange-500" />
                </div>
                <p className="text-xl font-bold tabular-nums">{analytics.totalFees.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground mt-0.5">across {filtered.length} transactions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Pending / Failed</span>
                  <Clock className="h-4 w-4 text-yellow-500" />
                </div>
                <p className="text-xl font-bold tabular-nums">
                  <span className="text-yellow-600">{analytics.pendingCount}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-red-600">{analytics.failedCount}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">awaiting / failed</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Mini bar chart */}
        {showAnalytics && analytics.days.length > 1 && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm text-muted-foreground font-medium">Volume by Day</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="flex items-end gap-1 h-16">
                {analytics.days.map(([day, vol]) => (
                  <div key={day} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${day}: ${vol.toLocaleString()}`}>
                    <div
                      className="w-full bg-primary/70 rounded-t hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(4, (vol / analytics.maxVol) * 56)}px` }}
                    />
                    <span className="text-[9px] text-muted-foreground hidden group-hover:block absolute -mt-5 bg-card border px-1 rounded shadow text-xs">
                      {vol.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-muted-foreground">{analytics.days[0]?.[0]}</span>
                <span className="text-xs text-muted-foreground">{analytics.days[analytics.days.length - 1]?.[0]}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search recipient, reference, currency..."
                  className="pl-9"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="send">Send</SelectItem>
                  <SelectItem value="receive">Receive</SelectItem>
                  <SelectItem value="exchange">Exchange</SelectItem>
                  <SelectItem value="bill">Bill Payment</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-end gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" className="h-9 w-36 text-sm" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" className="h-9 w-36 text-sm" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
                </div>
                {/* Date presets */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9">
                      <CalendarDays className="h-3.5 w-3.5 mr-1" /> Presets
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {DATE_PRESETS.map(p => (
                      <DropdownMenuItem key={p.label} onClick={() => { const d = p.getDates(); setDateFrom(d.from); setDateTo(d.to); setPage(1); }}>
                        {p.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}>
                      Clear dates
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="flex items-center gap-1 text-muted-foreground">
                  <X className="h-3.5 w-3.5" /> Clear all
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Transaction List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
                {hasFilters && <Badge variant="secondary" className="text-xs">Filtered</Badge>}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                Page {page} of {totalPages}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : txns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No transactions found</p>
                {hasFilters && (
                  <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {txns.map((t: any) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelected(t)}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      t.type === "receive" ? "bg-emerald-100 dark:bg-emerald-900/40" :
                      t.status === "failed" ? "bg-red-100 dark:bg-red-900/40" : "bg-primary/10"
                    }`}>
                      {t.type === "receive"
                        ? <ArrowDownLeft className="h-5 w-5 text-emerald-600" />
                        : t.status === "failed"
                        ? <XCircle className="h-5 w-5 text-red-500" />
                        : <ArrowUpRight className="h-5 w-5 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.recipientName ?? t.description ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.reference} · {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {t.toCurrency && t.toCurrency !== t.fromCurrency && (
                          <span className="ml-1 text-muted-foreground/70">→ {t.toCurrency}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-semibold tabular-nums ${t.type === "receive" ? "text-emerald-600" : t.status === "failed" ? "text-red-500 line-through opacity-60" : ""}`}>
                        {t.type === "receive" ? "+" : "−"}{t.fromCurrency} {Number(t.fromAmount).toLocaleString()}
                      </div>
                      <Badge className={`text-xs border-0 ${statusColor[t.status] ?? ""}`} variant="secondary">{t.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                  return (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "ghost"}
                      size="sm"
                      className="w-8 h-8 p-0 text-xs"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Transaction Details</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-3 ${
                  selected.type === "receive" ? "bg-emerald-100 dark:bg-emerald-900/40" :
                  selected.status === "failed" ? "bg-red-100 dark:bg-red-900/40" : "bg-primary/10"
                }`}>
                  {selected.type === "receive"
                    ? <ArrowDownLeft className="h-8 w-8 text-emerald-600" />
                    : selected.status === "failed"
                    ? <XCircle className="h-8 w-8 text-red-500" />
                    : selected.status === "completed"
                    ? <CheckCircle className="h-8 w-8 text-primary" />
                    : <ArrowUpRight className="h-8 w-8 text-primary" />}
                </div>
                <div className="text-3xl font-bold tabular-nums">{selected.fromCurrency} {Number(selected.fromAmount).toLocaleString()}</div>
                <Badge className={`mt-2 border-0 ${statusColor[selected.status] ?? ""}`} variant="secondary">{selected.status}</Badge>
              </div>
              <div className="space-y-3 text-sm">
                {[
                  ["Recipient", selected.recipientName ?? selected.description ?? "—"],
                  ["Reference", selected.reference],
                  ["Type", selected.type],
                  ["Date", new Date(selected.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })],
                  ["Fee", `${selected.fromCurrency} ${Number(selected.fee ?? 0).toFixed(2)}`],
                  ...(selected.toCurrency && selected.toCurrency !== selected.fromCurrency ? [["Converted", `${selected.toCurrency} ${Number(selected.toAmount ?? 0).toLocaleString()}`]] : []),
                  ...(selected.fxRate ? [["FX Rate", Number(selected.fxRate).toFixed(6)]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { navigator.clipboard.writeText(selected.reference); toast.success("Reference copied"); }}>
                  <Copy className="h-4 w-4 mr-2" />Copy Reference
                </Button>
                {selected.status === "completed" && (
                  <>
                    <Button variant="outline" className="flex-1" onClick={() => handleExport("csv")}>
                      <Download className="h-4 w-4 mr-2" />Export CSV
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={() => {
                      const link = document.createElement("a");
                      link.href = `/api/receipt/${selected.reference}`;
                      link.download = `receipt-${selected.reference}.pdf`;
                      link.click();
                      toast.success("Downloading receipt PDF...");
                    }}>
                      <FileText className="h-4 w-4 mr-2" />Receipt PDF
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
