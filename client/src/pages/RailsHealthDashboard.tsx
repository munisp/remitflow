import { toast } from 'sonner';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Activity, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Clock, Zap, Globe, TrendingUp, Shield, ArrowLeft
} from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

const RAIL_META: Record<string, { label: string; region: string; type: string; color: string; description: string }> = {
  mojaloop:  { label: "Mojaloop",   region: "Pan-Africa",     type: "DFSP",       color: "#2563EB", description: "ISO 20022 interop hub — 14 African markets" },
  papss:     { label: "PAPSS",      region: "Africa",         type: "RTGS",       color: "#16A34A", description: "Pan-African Payment & Settlement System (Afreximbank)" },
  bricspay:  { label: "BRICSPay",   region: "BRICS+",         type: "Multilateral", color: "#DC2626", description: "BRICS+ cross-border settlement — 10 countries" },
  mbridge:   { label: "mBridge",    region: "Asia/Gulf",      type: "CBDC",       color: "#9333EA", description: "Multi-CBDC bridge — PBOC, HKMA, CBUAE, BOT, SAMA" },
  ghipss:    { label: "GhIPSS",     region: "West Africa",    type: "ACH/Mobile", color: "#EA580C", description: "Ghana Interbank Payment & Settlement System" },
  africbdc:  { label: "AfriCBDC",   region: "Africa",         type: "CBDC",       color: "#0891B2", description: "eNGN, eCedi, dZAR, AfriGo, eKES digital currencies" },
  cips:      { label: "CIPS",       region: "China/Global",   type: "SWIFT-alt",  color: "#BE185D", description: "Cross-Border Interbank Payment System (China)" },
  upi:       { label: "UPI",        region: "India/Global",   type: "RTP",        color: "#F59E0B", description: "Unified Payments Interface — UPI One World" },
  pix:       { label: "PIX",        region: "Brazil/LatAm",   type: "RTP",        color: "#10B981", description: "Banco Central do Brasil instant payment rail" },
};

type RailHealth = {
  rail: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latency_ms: number | null;
  uptime_pct: number | null;
  last_checked_at: Date | null;
  error_message: string | null;
};

function StatusIcon({ status }: { status: RailHealth["status"] }) {
  if (status === "healthy") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (status === "degraded") return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  if (status === "down") return <XCircle className="h-5 w-5 text-red-500" />;
  return <Clock className="h-5 w-5 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: RailHealth["status"] }) {
  const variants: Record<string, string> = {
    healthy: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
    degraded: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    down: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border " + (variants[status] ?? variants.unknown)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function LatencyBar({ ms }: { ms: number | null }) {
  if (ms === null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = ms < 200 ? "bg-green-500" : ms < 600 ? "bg-amber-500" : "bg-red-500";
  const width = Math.min(100, (ms / 1000) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={"h-full rounded-full " + color} style={{ width: width + "%" }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-14 text-right">{ms}ms</span>
    </div>
  );
}

function UptimePill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = pct >= 99 ? "text-green-600 dark:text-green-400" : pct >= 95 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  return <span className={"text-sm font-semibold " + color}>{pct.toFixed(2)}%</span>;
}

export default function RailsHealthDashboard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const { data, isLoading, refetch, isFetching } = trpc.newRails.railHealth.getAll.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const rawRails = (data as any[] | undefined) ?? [];
  const rails: RailHealth[] = rawRails.map((r: any) => ({ ...r, status: r.status === "offline" ? "down" : r.status, latency_ms: r.latencyMs ?? null }));

  const healthy = rails.filter(r => r.status === "healthy").length;
  const degraded = rails.filter(r => r.status === "degraded").length;
  const down = rails.filter(r => r.status === "down").length;
  const unknown = rails.filter(r => r.status === "unknown").length;
  const total = Object.keys(RAIL_META).length;

  const avgLatency = rails.filter(r => r.latency_ms !== null).length > 0
    ? Math.round(rails.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / rails.filter(r => r.latency_ms !== null).length)
    : null;

  // Build a map from rail name to health data
  const healthMap = new Map<string, RailHealth>(rails.map(r => [r.rail, r]));

  // Merge with RAIL_META so we always show all 9 rails even if no DB row yet
  const allRails = Object.entries(RAIL_META).map(([key, meta]) => ({
    key,
    meta,
    health: healthMap.get(key) ?? { rail: key, status: "unknown" as const, latency_ms: null, uptime_pct: null, last_checked_at: null, error_message: null },
  }));

  function handleRefresh() {
    refetch();
    setLastRefresh(new Date());
    toast("Refreshing rail health...", { description: "Pinging all 9 payment corridors." });
  }

  const overallStatus = down > 0 ? "Degraded" : degraded > 0 ? "Partial" : "Operational";
  const overallColor = down > 0 ? "text-red-500" : degraded > 0 ? "text-amber-500" : "text-green-500";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <div>
              <h1 className="font-semibold text-foreground">Payment Rails Health</h1>
              <p className="text-xs text-muted-foreground">Live status across 9 corridors · Auto-refresh every 30s</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className={"text-sm font-semibold " + overallColor}>{overallStatus}</span>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={"h-3.5 w-3.5 mr-1.5 " + (isFetching ? "animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Healthy", value: healthy, icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10" },
            { label: "Degraded", value: degraded, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
            { label: "Down", value: down, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
            { label: "Avg Latency", value: avgLatency !== null ? avgLatency + "ms" : "—", icon: Zap, color: "text-primary", bg: "bg-primary/10" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="border-border shadow-sm">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={"text-2xl font-bold " + color}>{value}</p>
                  </div>
                  <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + bg}>
                    <Icon className={"h-5 w-5 " + color} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Rail grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {allRails.map(({ key, meta, health }) => (
            <Card key={key} className={"border shadow-sm transition-all hover:shadow-md " + (health.status === "down" ? "border-red-500/30" : health.status === "degraded" ? "border-amber-500/30" : "border-border")}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: meta.color }}>
                      {meta.label.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold text-foreground">{meta.label}</CardTitle>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Globe className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{meta.region}</span>
                        <span className="text-muted-foreground">·</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">{meta.type}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <StatusIcon status={health.status} />
                    <StatusBadge status={health.status} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" />Latency</span>
                  </div>
                  <LatencyBar ms={health.latency_ms} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Uptime (30d)</span>
                  <UptimePill pct={health.uptime_pct} />
                </div>
                {health.last_checked_at && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Last check</span>
                    <span className="text-muted-foreground font-mono">{new Date(health.last_checked_at).toLocaleTimeString()}</span>
                  </div>
                )}
                {health.error_message && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-600 dark:text-red-400">{health.error_message}</p>
                  </div>
                )}
                {health.status === "unknown" && (
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground">No health data yet. Click Refresh to ping this rail.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Legend */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Middleware Stack</CardTitle>
            <CardDescription className="text-xs">All rails are wired to the full middleware stack</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {["Kafka", "Dapr", "Fluvio", "Temporal", "Keycloak", "Permify", "OpenSearch", "Redis", "APISix", "TigerBeetle", "Lakehouse"].map(m => (
                <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Last page refresh: {lastRefresh.toLocaleTimeString()} · {isLoading ? "Loading..." : `${rails.length} rails reporting`}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
