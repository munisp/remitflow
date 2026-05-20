/**
 * LivenessAuditPage — Admin compliance review for liveness & anti-spoofing pipeline
 *
 * Shows per-submission results from the three-layer liveness pipeline:
 *   Layer 1: Passive liveness (still image — EAR blink + depth + texture)
 *   Layer 2: Active liveness (video — blink count + head movement)
 *   Layer 3: Deepfake detection (ViT-L + DCT frequency + MediaPipe landmarks)
 */

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Eye,
  Video,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Filter,
  TrendingUp,
  RotateCcw,
  Globe,
  ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(Number(v) * 100)}%`;
}

function scoreColor(v: string | number | null | undefined, threshold = 0.55): string {
  if (v == null) return "text-muted-foreground";
  return Number(v) >= threshold ? "text-red-600 font-semibold" : "text-emerald-600";
}

function LiveBadge({ live }: { live: boolean | null | undefined }) {
  if (live == null) return <Badge variant="secondary">—</Badge>;
  return live ? (
    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
      <CheckCircle2 className="h-3 w-3 mr-1" /> LIVE
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-700 border-red-200">
      <XCircle className="h-3 w-3 mr-1" /> BLOCKED
    </Badge>
  );
}

function DeepfakeBadge({ score }: { score: string | number | null | undefined }) {
  if (score == null) return <Badge variant="secondary">—</Badge>;
  const s = Number(score);
  if (s >= 0.55) return <Badge className="bg-red-100 text-red-700 border-red-200"><ShieldAlert className="h-3 w-3 mr-1" /> HIGH {pct(s)}</Badge>;
  if (s >= 0.35) return <Badge className="bg-amber-100 text-amber-700 border-amber-200"><AlertTriangle className="h-3 w-3 mr-1" /> MED {pct(s)}</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><ShieldCheck className="h-3 w-3 mr-1" /> LOW {pct(s)}</Badge>;
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function AuditDetailDialog({
  id,
  open,
  onClose,
  onReviewQueued,
}: {
  id: number | null;
  open: boolean;
  onClose: () => void;
  onReviewQueued?: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = trpc.admin.getLivenessAuditDetail.useQuery(
    { id: id! },
    { enabled: open && id != null }
  );
  const markForReview = trpc.admin.markLivenessForReview.useMutation({
    onSuccess: () => {
      toast.success(`Audit #${id} queued for manual review.`);
      onReviewQueued?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Liveness Audit Record #{id}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : !data ? (
          <p className="text-center py-8 text-muted-foreground">Record not found.</p>
        ) : (
          <div className="space-y-5">
            {/* User + doc */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">User</p>
                <p className="font-medium">{data.user?.name ?? `#${data.userId}`}</p>
                <p className="text-muted-foreground">{data.user?.email ?? "—"}</p>
                <p className="text-xs mt-1">KYC Tier: <span className="font-medium">{data.user?.kycTier ?? "—"}</span></p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">KYC Document</p>
                <p className="font-medium">{data.kycDocument?.docType ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Status: {data.kycDocument?.status ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Source: {data.source}</p>
              </div>
            </div>

            {/* Overall verdict */}
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${
              data.overallLive
                ? "bg-emerald-50 border-emerald-200"
                : "bg-red-50 border-red-200"
            }`}>
              {data.overallLive
                ? <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                : <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
              }
              <div>
                <p className={`font-semibold ${data.overallLive ? "text-emerald-700" : "text-red-700"}`}>
                  {data.overallLive ? "Overall: LIVE — KYC Approved" : "Overall: BLOCKED — KYC Rejected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(data.createdAt).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Layer 1: Passive */}
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                <Eye className="h-4 w-4 text-blue-500" /> Layer 1 — Passive Liveness
              </h4>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Score</p>
                  <p className="font-semibold">{pct(data.passiveScore)}</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Result</p>
                  <LiveBadge live={data.passivePassed} />
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Spoofing Type</p>
                  <p className="font-medium">{data.passiveSpoofingType ?? "None detected"}</p>
                </div>
              </div>
            </div>

            {/* Layer 2: Active */}
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                <Video className="h-4 w-4 text-purple-500" /> Layer 2 — Active Liveness (Video)
              </h4>
              {data.activeBlinkCount == null && data.activeHeadMovementDeg == null ? (
                <p className="text-sm text-muted-foreground italic">No video submitted — active liveness skipped.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Blink Count</p>
                    <p className="font-semibold">{data.activeBlinkCount ?? "—"}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Head Movement</p>
                    <p className="font-semibold">{data.activeHeadMovementDeg != null ? `${Number(data.activeHeadMovementDeg).toFixed(1)}°` : "—"}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Result</p>
                    <LiveBadge live={data.activePassed} />
                  </div>
                </div>
              )}
            </div>

            {/* Layer 3: Deepfake */}
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                <ShieldAlert className="h-4 w-4 text-orange-500" /> Layer 3 — Deepfake Detection
              </h4>
              <div className="grid grid-cols-3 gap-3 text-sm mb-2">
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  <p className={`font-semibold ${scoreColor(data.deepfakeScore)}`}>{pct(data.deepfakeScore)}</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Detection Method</p>
                  <p className="font-medium text-xs">{data.deepfakeMethod ?? "—"}</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Result</p>
                  <DeepfakeBadge score={data.deepfakeScore} />
                </div>
              </div>
              {Array.isArray(data.deepfakeIndicators) && data.deepfakeIndicators.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  <span className="font-semibold">Indicators: </span>
                  {(data.deepfakeIndicators as string[]).join(", ")}
                </div>
              )}
            </div>

            {/* Re-review action */}
            {data.source !== "manual_review" && data.source !== "manual_approved" && data.source !== "manual_rejected" && (
              <div className="border-t pt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                  disabled={markForReview.isPending}
                  onClick={() => id != null && markForReview.mutate({ auditId: id })}
                >
                  <RotateCcw className="h-4 w-4" />
                  {markForReview.isPending ? "Queuing…" : "Send to Manual Review"}
                </Button>
              </div>
            )}
            {(data.source === "manual_review" || data.source === "manual_approved" || data.source === "manual_rejected") && (
              <div className="border-t pt-4">
                <Badge className={`text-xs ${
                  data.source === "manual_approved" ? "bg-emerald-100 text-emerald-700" :
                  data.source === "manual_rejected" ? "bg-red-100 text-red-700" :
                  "bg-amber-100 text-amber-700"
                }`}>
                  {data.source === "manual_review" ? "⏳ Awaiting Manual Review" :
                   data.source === "manual_approved" ? "✓ Manually Approved" : "✗ Manually Rejected"}
                </Badge>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LivenessAuditPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"audit" | "corridors" | "review">("audit");
  const [page, setPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [overallLiveFilter, setOverallLiveFilter] = useState<string>("all");
  const [deepfakeOnly, setDeepfakeOnly] = useState(false);
  const [userIdSearch, setUserIdSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [chartHours, setChartHours] = useState(24);
  const [chartCorridor, setChartCorridor] = useState("");
  const [corridorDays, setCorridorDays] = useState(7);
  const [histogramCorridor, setHistogramCorridor] = useState<string | undefined>(undefined);

  const filters = {
    page,
    limit: 25,
    overallLive: overallLiveFilter === "all" ? undefined : overallLiveFilter === "live",
    deepfakeOnly,
    userId: userIdSearch ? parseInt(userIdSearch, 10) : undefined,
  };

  const { data, isLoading, refetch } = trpc.admin.listLivenessAudit.useQuery(filters);
  const { data: stats } = trpc.admin.livenessAuditStats.useQuery();
  const { data: hourlyRaw } = trpc.admin.livenessHourlyStats.useQuery(
    { hours: chartHours, corridor: chartCorridor || undefined },
    { refetchInterval: 60_000 }
  );
  const { data: corridorStats, isLoading: corridorLoading } = trpc.admin.livenessCorridorStats.useQuery(
    { days: corridorDays },
    { enabled: activeTab === "corridors" }
  );
  const { data: histogramData } = trpc.admin.livenessScoreHistogram.useQuery(
    { days: corridorDays, corridor: histogramCorridor },
    { enabled: activeTab === "corridors" }
  );
  const utils = trpc.useUtils();
  const { data: reviewQueue, isLoading: reviewLoading, refetch: refetchReview } = trpc.admin.listManualReviewQueue.useQuery(
    { limit: 25, offset: (reviewPage - 1) * 25 },
    { enabled: activeTab === "review" }
  );
  const resolveReview = trpc.admin.resolveManualReview.useMutation({
    onSuccess: (res) => {
      toast.success(`Audit #${res.auditId} ${res.approved ? "approved" : "rejected"}.`);
      refetchReview();
      utils.admin.livenessAuditStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Sort ascending by bucket for the chart
  const hourlyData = useMemo(() => {
    if (!hourlyRaw) return [];
    return [...hourlyRaw]
      .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime())
      .map(r => ({
        ...r,
        label: new Date(r.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }));
  }, [hourlyRaw]);

  const openDetail = useCallback((id: number) => {
    setSelectedId(id);
    setDetailOpen(true);
  }, []);

  const pendingReviewCount = reviewQueue?.total ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Liveness Audit Trail
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Per-submission results from the three-layer liveness & anti-spoofing pipeline.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b">
          {[
            { id: "audit" as const, label: "Audit Trail", icon: Shield },
            { id: "corridors" as const, label: "Corridor Breakdown", icon: Globe },
            { id: "review" as const, label: "Manual Review", icon: ClipboardList, badge: pendingReviewCount },
          ].map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {badge != null && badge > 0 && (
                <span className="ml-1 rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5 leading-none">{badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Stats Cards — always visible */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Total Checks", value: stats?.total ?? 0, icon: Shield, color: "text-primary" },
            { label: "Passed", value: stats?.passed ?? 0, icon: CheckCircle2, color: "text-emerald-600" },
            { label: "Blocked", value: stats?.failed ?? 0, icon: XCircle, color: "text-red-600" },
            { label: "Pass Rate", value: `${stats?.passRate ?? 0}%`, icon: Eye, color: "text-blue-600" },
            { label: "Deepfakes", value: stats?.deepfakeDetected ?? 0, icon: ShieldAlert, color: "text-orange-600" },
            { label: "Spoofing", value: stats?.spoofingDetected ?? 0, icon: AlertTriangle, color: "text-amber-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-0 shadow-sm">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Audit Trail Tab ── */}
        {activeTab === "audit" && (<>
        {/* Hourly Trend Chart */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Hourly Trend — Pass Rate &amp; Deepfake Rate
              </CardTitle>
              <div className="flex items-center gap-2">
                <Select value={String(chartHours)} onValueChange={(v) => setChartHours(Number(v))}>
                  <SelectTrigger className="w-28 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">Last 6 h</SelectItem>
                    <SelectItem value="24">Last 24 h</SelectItem>
                    <SelectItem value="48">Last 48 h</SelectItem>
                    <SelectItem value="168">Last 7 d</SelectItem>
                    <SelectItem value="720">Last 30 d</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Corridor (e.g. NG)"
                  value={chartCorridor}
                  onChange={(e) => setChartCorridor(e.target.value.toUpperCase())}
                  className="w-32 h-7 text-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {hourlyData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                No data yet — liveness checks will appear here once submissions arrive.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={hourlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="rate"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    width={40}
                  />
                  <YAxis
                    yAxisId="count"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    width={36}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === "Pass Rate" || name === "Deepfake Rate") return [`${value}%`, name];
                      return [value, name];
                    }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="passRate"
                    name="Pass Rate"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="deepfakeRate"
                    name="Deepfake Rate"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    yAxisId="count"
                    type="monotone"
                    dataKey="total"
                    name="Total Checks"
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Filter by User ID"
                value={userIdSearch}
                onChange={(e) => { setUserIdSearch(e.target.value); setPage(1); }}
                className="w-40"
              />
              <Select value={overallLiveFilter} onValueChange={(v) => { setOverallLiveFilter(v); setPage(1); }}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Overall result" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All results</SelectItem>
                  <SelectItem value="live">Passed (LIVE)</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={deepfakeOnly ? "default" : "outline"}
                size="sm"
                onClick={() => { setDeepfakeOnly(!deepfakeOnly); setPage(1); }}
                className="gap-2"
              >
                <ShieldAlert className="h-4 w-4" />
                Deepfakes only
              </Button>
              {(overallLiveFilter !== "all" || deepfakeOnly || userIdSearch) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setOverallLiveFilter("all"); setDeepfakeOnly(false); setUserIdSearch(""); setPage(1); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-12">ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Doc ID</TableHead>
                    <TableHead>
                      <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> Passive</span>
                    </TableHead>
                    <TableHead>
                      <span className="flex items-center gap-1"><Video className="h-3 w-3" /> Active</span>
                    </TableHead>
                    <TableHead>
                      <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> Deepfake</span>
                    </TableHead>
                    <TableHead>Overall</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted/50 rounded animate-pulse w-16" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : !data?.rows.length ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                        No liveness audit records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row: any) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => openDetail(row.id)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">#{row.id}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{row.userName ?? `User #${row.userId}`}</p>
                            <p className="text-xs text-muted-foreground">{row.userEmail ?? ""}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.kycDocId ? `#${row.kycDocId}` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {row.passivePassed == null ? (
                              <span className="text-muted-foreground text-xs">—</span>
                            ) : row.passivePassed ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className="text-xs">{pct(row.passiveScore)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.activePassed == null ? (
                            <span className="text-xs text-muted-foreground italic">skipped</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {row.activePassed ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className="text-xs">
                                {row.activeBlinkCount != null ? `${row.activeBlinkCount} blinks` : ""}
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <DeepfakeBadge score={row.deepfakeScore} />
                        </TableCell>
                        <TableCell>
                          <LiveBadge live={row.overallLive} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-normal">
                            {row.source ?? "trpc_extract"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {data && data.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-sm text-muted-foreground">
                  Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, data.total)} of {data.total} records
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {page} of {data.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.pages}
                    onClick={() => setPage(p => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </>)}

        {/* ── Corridor Breakdown Tab ── */}
        {activeTab === "corridors" && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" /> Corridor Risk Breakdown
                </CardTitle>
                <Select value={String(corridorDays)} onValueChange={(v) => setCorridorDays(Number(v))}>
                  <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Last 24 h</SelectItem>
                    <SelectItem value="7">Last 7 d</SelectItem>
                    <SelectItem value="30">Last 30 d</SelectItem>
                    <SelectItem value="90">Last 90 d</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Corridor</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Passed</TableHead>
                    <TableHead className="text-right">Blocked</TableHead>
                    <TableHead className="text-right">Pass Rate</TableHead>
                    <TableHead className="text-right">Deepfakes</TableHead>
                    <TableHead className="text-right">Deepfake Rate</TableHead>
                    <TableHead className="text-right">Spoofing</TableHead>
                    <TableHead className="text-right">Avg Passive</TableHead>
                    <TableHead className="text-right">Avg Deepfake</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corridorLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse w-12" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : !corridorStats?.length ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                        No corridor data yet — liveness checks will appear here once submissions arrive.
                      </TableCell>
                    </TableRow>
                  ) : (
                    corridorStats.map((row: any) => (
                      <TableRow key={row.corridorCode}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono font-semibold">{row.corridorCode}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{row.total}</TableCell>
                        <TableCell className="text-right text-emerald-600">{row.passed}</TableCell>
                        <TableCell className="text-right text-red-600">{row.failed}</TableCell>
                        <TableCell className="text-right">
                          <span className={row.passRate < 80 ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                            {row.passRate}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={row.deepfakeCount > 0 ? "text-orange-600 font-semibold" : "text-muted-foreground"}>
                            {row.deepfakeCount}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={row.deepfakeRate >= 5 ? "text-red-600 font-semibold" : row.deepfakeRate >= 2 ? "text-amber-600" : "text-muted-foreground"}>
                            {row.deepfakeRate}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{row.spoofingCount}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.avgPassiveScore != null ? pct(row.avgPassiveScore) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.avgDeepfakeScore != null ? (
                            <span className={scoreColor(row.avgDeepfakeScore)}>{pct(row.avgDeepfakeScore)}</span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* ── Liveness Score Histogram ── */}
        {activeTab === "corridors" && histogramData && histogramData.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" /> Passive Liveness Score Distribution
                </CardTitle>
                <Select
                  value={histogramCorridor ?? "all"}
                  onValueChange={(v) => setHistogramCorridor(v === "all" ? undefined : v)}
                >
                  <SelectTrigger className="w-32 h-7 text-xs"><SelectValue placeholder="All corridors" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All corridors</SelectItem>
                    {corridorStats?.map((c: any) => (
                      <SelectItem key={c.corridorCode} value={c.corridorCode}>{c.corridorCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {(histogramCorridor
                  ? histogramData.filter(d => d.corridorCode === histogramCorridor)
                  : histogramData.slice(0, 8)
                ).map((corridorHist: any) => (
                  <div key={corridorHist.corridorCode} className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      <Badge variant="outline" className="font-mono text-xs">{corridorHist.corridorCode}</Badge>
                    </p>
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart data={corridorHist.buckets} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
                        <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                          formatter={(v: number) => [v, "Count"]}
                        />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                          {corridorHist.buckets.map((b: any, idx: number) => (
                            <Cell
                              key={b.label}
                              fill={parseFloat(b.label.split("-")[0]) >= 0.5
                                ? `hsl(142 ${60 + idx * 4}% 45%)`
                                : `hsl(0 ${60 + (9 - idx) * 4}% 50%)`
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Score buckets 0.0–0.5 (red) indicate likely spoofing; 0.5–1.0 (green) indicate live.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Manual Review Queue Tab ── */}
        {activeTab === "review" && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-primary" /> Manual Review Queue
                  {reviewQueue && <Badge variant="secondary">{reviewQueue.total} pending</Badge>}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => refetchReview()}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-12">ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Passive</TableHead>
                    <TableHead>Deepfake</TableHead>
                    <TableHead>Queued At</TableHead>
                    <TableHead className="w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse w-16" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : !reviewQueue?.rows.length ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                        No submissions pending manual review.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reviewQueue.rows.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">#{row.id}</TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">User #{row.userId}</p>
                          <p className="text-xs text-muted-foreground">{row.kycDocId ? `KYC #${row.kycDocId}` : "—"}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{row.corridorCode ?? "—"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {row.passivePassed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                            <span className="text-xs">{pct(row.passiveScore)}</span>
                          </div>
                        </TableCell>
                        <TableCell><DeepfakeBadge score={row.deepfakeScore} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => openDetail(row.id)}
                            >
                              View
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={resolveReview.isPending}
                              onClick={() => resolveReview.mutate({ auditId: row.id, approve: true })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2 text-xs"
                              disabled={resolveReview.isPending}
                              onClick={() => resolveReview.mutate({ auditId: row.id, approve: false })}
                            >
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {reviewQueue && reviewQueue.total > 25 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {(reviewPage - 1) * 25 + 1}–{Math.min(reviewPage * 25, reviewQueue.total)} of {reviewQueue.total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={reviewPage <= 1} onClick={() => setReviewPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={reviewPage * 25 >= reviewQueue.total} onClick={() => setReviewPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detail Dialog */}
      <AuditDetailDialog
        id={selectedId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onReviewQueued={() => { utils.admin.listManualReviewQueue.invalidate(); setActiveTab("review"); }}
      />
    </DashboardLayout>
  );
}
