import { toast } from 'sonner';
/**
 * MyTransfers — Real-time transfer tracking page
 * Shows all user transfers with:
 *  - Status timeline (pending → processing → settled)
 *  - Corridor used (PAPSS, Mojaloop, BRICSPay, etc.)
 *  - Estimated delivery time
 *  - Batch ID for PAPSS/multilateral rails
 *  - Search and filter by status, corridor, date
 *  - Cancel pending transfers
 *  - Download receipt PDF
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  ArrowLeft, Search, RefreshCw, CheckCircle2, Clock, XCircle,
  AlertTriangle, ArrowRight, Globe, Zap, Download, Eye,
  Filter, TrendingUp, DollarSign, Calendar, ChevronDown, ChevronUp
} from "lucide-react";
import { useLocation } from "wouter";

const RAIL_LABELS: Record<string, string> = {
  papss: "PAPSS", mojaloop: "Mojaloop", bricspay: "BRICSPay",
  mbridge: "mBridge", ghipss: "GhIPSS", africbdc: "AfriCBDC",
  cips: "CIPS", upi: "UPI", pix: "PIX", swift: "SWIFT", sepa: "SEPA",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending:    { label: "Pending",    color: "text-amber-500",  icon: Clock },
  processing: { label: "Processing", color: "text-blue-500",   icon: RefreshCw },
  settled:    { label: "Settled",    color: "text-green-500",  icon: CheckCircle2 },
  completed:  { label: "Completed",  color: "text-green-500",  icon: CheckCircle2 },
  failed:     { label: "Failed",     color: "text-red-500",    icon: XCircle },
  cancelled:  { label: "Cancelled",  color: "text-muted-foreground", icon: XCircle },
  on_hold:    { label: "On Hold",    color: "text-amber-600",  icon: AlertTriangle },
};

const TIMELINE_STEPS = ["pending", "processing", "settled"];

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const bg = cfg.color.replace("text-", "bg-").replace("500", "500/10").replace("600", "600/10");
  return (
    <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-current/20 " + cfg.color + " " + bg}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function TransferTimeline({ status }: { status: string }) {
  const currentIdx = TIMELINE_STEPS.indexOf(status === "completed" ? "settled" : status);
  return (
    <div className="flex items-center gap-1">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i <= currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${done ? "bg-green-500" : "bg-muted"} ${active ? "ring-2 ring-green-500/30" : ""}`} />
            {i < TIMELINE_STEPS.length - 1 && (
              <div className={`h-px w-6 ${done && i < currentIdx ? "bg-green-500" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TransferCard({ tx, onCancel }: { tx: any; onCancel: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[tx.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  return (
    <Card className={`border shadow-sm transition-all ${tx.status === "failed" ? "border-red-500/20" : tx.status === "on_hold" ? "border-amber-500/20" : "border-border"}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Rail icon */}
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
              {(RAIL_LABELS[tx.gateway] ?? tx.gateway ?? "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground">
                  {tx.currency} {Number(tx.amount).toLocaleString()} → {tx.toCurrency}
                </span>
                <StatusBadge status={tx.status} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {RAIL_LABELS[tx.gateway] ?? tx.gateway ?? "Unknown rail"}
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(tx.createdAt).toLocaleDateString()}
                </span>
                {tx.batchId && (
                  <>
                    <span>·</span>
                    <span className="font-mono text-xs">{tx.batchId}</span>
                  </>
                )}
              </div>
              <div className="mt-2">
                <TransferTimeline status={tx.status} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-sm font-semibold text-foreground">
                {tx.toAmount ? `${tx.toCurrency} ${Number(tx.toAmount).toLocaleString()}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">recipient gets</p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              {[
                ["Transfer ID", `#${tx.id}`],
                ["Exchange Rate", tx.exchangeRate ? `1 ${tx.currency} = ${Number(tx.exchangeRate).toFixed(4)} ${tx.toCurrency}` : "—"],
                ["Fee", tx.fee ? `${tx.currency} ${Number(tx.fee).toLocaleString()}` : "—"],
                ["Recipient", tx.recipientName ?? tx.recipientAccount ?? "—"],
                ["Reference", tx.reference ?? "—"],
                ["Estimated Delivery", tx.estimatedDelivery ?? (tx.status === "settled" ? "Delivered" : "1-2 business days")],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-muted-foreground">{k}</p>
                  <p className="font-medium text-foreground truncate">{v}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs gap-1 h-7">
                <Download className="h-3 w-3" />
                Receipt
              </Button>
              <Button variant="outline" size="sm" className="text-xs gap-1 h-7">
                <Eye className="h-3 w-3" />
                Track
              </Button>
              {tx.status === "pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1 h-7 text-red-500 hover:text-red-600 border-red-500/20"
                  onClick={() => onCancel(tx.id)}
                >
                  <XCircle className="h-3 w-3" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyTransfers() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [railFilter, setRailFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const { data, isLoading, refetch, isFetching } = trpc.transfers.list.useQuery(
    { limit: 100, offset: 0 },
    { enabled: !!user, refetchInterval: 30_000, staleTime: 15_000 }
  );

  const cancelMutation = trpc.transfers.cancel.useMutation({
    onError: (_err: unknown) => toast.error("Cancel failed"),
  });

  const transfers: any[] = (data as any)?.transfers ?? (data as any) ?? [];

  const filtered = useMemo(() => {
    return transfers.filter(tx => {
      if (statusFilter !== "all" && tx.status !== statusFilter) return false;
      if (railFilter !== "all" && tx.gateway !== railFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          String(tx.id).includes(q) ||
          (tx.recipientName ?? "").toLowerCase().includes(q) ||
          (tx.reference ?? "").toLowerCase().includes(q) ||
          (tx.batchId ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transfers, statusFilter, railFilter, search]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Summary stats
  const totalVolume = transfers.reduce((s, t) => s + Number(t.amount ?? 0), 0);
  const completedCount = transfers.filter(t => ["settled", "completed"].includes(t.status)).length;
  const pendingCount = transfers.filter(t => ["pending", "processing"].includes(t.status)).length;

  const rails = [...Array.from(new Set(transfers.map(t => t.gateway).filter(Boolean)))];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-semibold text-foreground">My Transfers</h1>
            <p className="text-xs text-muted-foreground">Real-time tracking across all corridors</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/transactions/export")}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={"h-3.5 w-3.5 " + (isFetching ? "animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Sent", value: `$${totalVolume.toLocaleString("en", { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "text-primary" },
            { label: "Completed", value: String(completedCount), icon: CheckCircle2, color: "text-green-500" },
            { label: "In Progress", value: String(pendingCount), icon: Clock, color: "text-amber-500" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-border shadow-sm">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={"text-lg font-bold " + color}>{value}</p>
                  </div>
                  <Icon className={"h-5 w-5 " + color} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by ID, recipient, reference..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={railFilter} onValueChange={v => { setRailFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="Rail" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rails</SelectItem>
              {rails.map(r => (
                <SelectItem key={r} value={r}>{RAIL_LABELS[r] ?? r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Transfer list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Card key={i} className="border-border">
                <CardContent className="pt-4 pb-4">
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                    <div className="h-2 bg-muted rounded w-1/4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : paginated.length === 0 ? (
          <Card className="border-border">
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">
                {transfers.length === 0 ? "No transfers yet" : "No transfers match your filters"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {transfers.length === 0
                  ? "Send your first transfer to see it here."
                  : "Try adjusting your search or filters."}
              </p>
              {transfers.length === 0 && (
                <Button className="mt-4 gap-2" onClick={() => navigate("/send")}>
                  <ArrowRight className="h-4 w-4" />
                  Send Money
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {paginated.map(tx => (
              <TransferCard
                key={tx.id}
                tx={tx}
                onCancel={(id) => cancelMutation.mutate({ id })}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
