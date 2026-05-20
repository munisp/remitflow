import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Search, Package, CheckCircle2, Clock, AlertCircle, XCircle,
  Loader2, RefreshCw, Workflow, ShieldCheck, Banknote,
  Bell, BookOpen, HelpCircle, ChevronRight,
} from "lucide-react";
import { useTranslation } from 'react-i18next';

// ── Saga step config ────────────────────────────────────────────────────────────────
const SAGA_STEP_ICONS: Record<string, React.ElementType> = {
  validate: ShieldCheck,
  reserve: Banknote,
  fraud: ShieldCheck,
  execute: Workflow,
  notify: Bell,
  audit: BookOpen,
};

const SAGA_STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  completed:  { color: "text-emerald-600 bg-emerald-100 border-emerald-200", icon: CheckCircle2, label: "Completed" },
  processing: { color: "text-blue-600 bg-blue-100 border-blue-200",         icon: Loader2,      label: "Processing" },
  pending:    { color: "text-gray-400 bg-gray-100 border-gray-200",         icon: Clock,        label: "Pending" },
  failed:     { color: "text-red-600 bg-red-100 border-red-200",            icon: XCircle,      label: "Failed" },
  skipped:    { color: "text-gray-300 bg-gray-50 border-gray-100",          icon: HelpCircle,   label: "Skipped" },
  unknown:    { color: "text-gray-400 bg-gray-100 border-gray-200",         icon: HelpCircle,   label: "Unknown" },
};

const TRANSFER_STATUS_BADGE: Record<string, string> = {
  completed:  "bg-emerald-100 text-emerald-700 border-emerald-200",
  pending:    "bg-amber-100 text-amber-700 border-amber-200",
  processing: "bg-blue-100 text-blue-700 border-blue-200",
  failed:     "bg-red-100 text-red-700 border-red-200",
  cancelled:  "bg-gray-100 text-gray-600 border-gray-200",
};

// ── Temporal Saga Panel ────────────────────────────────────────────────────────────────
function TemporalSagaPanel({ workflowId }: { workflowId: string }) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, refetch, dataUpdatedAt } = trpc.transfer.getWorkflowStatus.useQuery(
    { workflowId },
    { refetchInterval: autoRefresh ? 5000 : false, enabled: !!workflowId }
  );

  useEffect(() => {
    if (data?.status === "COMPLETED" || data?.status === "FAILED" || data?.status === "TEMPORAL_UNAVAILABLE") {
      setAutoRefresh(false);
    }
  }, [data?.status]);

  const isTerminal = data?.status === "COMPLETED" || data?.status === "FAILED";
  const isFallback = data?.isFallback;

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
              <Workflow className="h-4 w-4 text-violet-600" />
            </div>
            <CardTitle className="text-base text-violet-900">Temporal Saga Orchestration</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {!isTerminal && !isFallback && (
              <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200 gap-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> Live
              </Badge>
            )}
            {isTerminal && (
              <Badge className={cn("text-xs", data.status === "COMPLETED"
                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : "bg-red-100 text-red-700 border-red-200")}>
                {data.status}
              </Badge>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 text-violet-600" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-1 truncate">Workflow: {workflowId}</p>
      </CardHeader>

      <CardContent className="p-4 pt-0">
        {isFallback && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
            Temporal server not connected in dev mode — showing saga structure. In production, live step tracking is available.
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-4 bottom-4 w-px bg-violet-200" />
            <div className="space-y-3">
              {(data?.sagaSteps ?? []).map((step) => {
                const cfg = SAGA_STATUS_CONFIG[step.status] ?? SAGA_STATUS_CONFIG.unknown;
                const StepIcon = SAGA_STEP_ICONS[step.step] ?? ChevronRight;
                const StatusIcon = cfg.icon;
                const isProcessing = step.status === "processing";
                return (
                  <div key={step.step} className="flex gap-3 relative">
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border z-10 bg-white", cfg.color)}>
                      {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <StatusIcon className="h-4 w-4" />}
                    </div>
                    <div className={cn(
                      "flex-1 rounded-lg px-3 py-2 border text-sm",
                      step.status === "processing" ? "border-blue-200 bg-blue-50"
                        : step.status === "completed" ? "border-emerald-100 bg-emerald-50/50"
                        : step.status === "failed" ? "border-red-200 bg-red-50"
                        : "border-gray-100 bg-white/60"
                    )}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <StepIcon className={cn("h-3.5 w-3.5", step.status === "completed" ? "text-emerald-600" : "text-muted-foreground")} />
                          <span className={cn("font-medium", step.status === "skipped" || step.status === "pending" ? "text-muted-foreground" : "text-foreground")}>
                            {step.label}
                          </span>
                        </div>
                        <Badge variant="outline" className={cn("text-xs", cfg.color)}>{cfg.label}</Badge>
                      </div>
                      {step.description && <p className="text-xs text-muted-foreground mt-0.5 ml-5">{step.description}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {dataUpdatedAt > 0 && (
          <p className="text-xs text-muted-foreground mt-3 text-right">
            Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}
            {autoRefresh && !isTerminal && " · Auto-refreshing every 5s"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function TransferTracking() {
  const { t } = useTranslation();
  
  const [ref, setRef] = useState("");
  const [query, setQuery] = useState("");

  const { data: tracking, isLoading, error } = trpc.transfer.tracking.useQuery(
    { reference: query },
    { enabled: !!query, retry: false }
  );

  const handleSearch = () => { if (ref.trim()) setQuery(ref.trim()); };

  const workflowId = (tracking as any)?.workflowId ?? null;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
            <Package className="h-5 w-5 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Track Transfer</h1>
            <p className="text-muted-foreground text-sm">Real-time status and Temporal saga timeline</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Enter reference number…"
            value={ref}
            onChange={e => setRef(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={isLoading || !ref.trim()}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-900">Transfer not found</p>
                <p className="text-xs text-red-700 mt-0.5">Check the reference number and try again.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {tracking && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Reference</div>
                    <div className="font-mono font-bold text-sm">{(tracking as any).reference ?? query}</div>
                  </div>
                  <Badge className={cn("capitalize text-xs", TRANSFER_STATUS_BADGE[(tracking as any).status] ?? TRANSFER_STATUS_BADGE.pending)}>
                    {(tracking as any).status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Amount sent</div>
                    <div className="font-semibold">{(tracking as any).fromCurrency ?? "NGN"} {Number((tracking as any).fromAmount ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Recipient gets</div>
                    <div className="font-semibold">{(tracking as any).toCurrency ?? "—"} {Number((tracking as any).toAmount ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Recipient</div>
                    <div className="font-semibold">{(tracking as any).recipientName ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Initiated</div>
                    <div className="font-semibold">{(tracking as any).createdAt ? new Date((tracking as any).createdAt).toLocaleString() : "—"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" /> Transfer Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {((tracking as any).timeline ?? []).map((step: any, i: number) => {
                    const cfg = SAGA_STATUS_CONFIG[step.status] ?? SAGA_STATUS_CONFIG.unknown;
                    const StatusIcon = cfg.icon;
                    return (
                      <div key={i} className="flex gap-4">
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border", cfg.color)}>
                          <StatusIcon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 pb-4 border-b last:border-0">
                          <div className="font-medium text-sm">{step.label ?? step.message ?? step.status}</div>
                          {step.description && <div className="text-xs text-muted-foreground">{step.description}</div>}
                          {step.timestamp && <div className="text-xs text-muted-foreground mt-1">{new Date(step.timestamp).toLocaleString()}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {workflowId
              ? <TemporalSagaPanel workflowId={workflowId} />
              : (
                <Card className="border-dashed border-violet-200 bg-violet-50/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Workflow className="h-5 w-5 text-violet-400 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Temporal saga tracking is available for transfers initiated after v9. The workflow ID is stored on the transaction record.
                    </p>
                  </CardContent>
                </Card>
              )
            }
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
