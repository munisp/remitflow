import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, Server, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Search, Wifi, WifiOff, Clock, Database, Zap, Signal
} from "lucide-react";

type ServiceStatus = "healthy" | "degraded" | "unavailable";
interface ServiceHealth { name: string; url: string; status: ServiceStatus; latencyMs?: number; error?: string; checkedAt?: string; }
interface WsHealthUpdate { type: "health_update"; timestamp: string; services: ServiceHealth[]; summary: { total: number; healthy: number; degraded: number; unavailable: number; status: string }; }
interface WsCircuitTrip { type: "circuit_trip"; timestamp: string; service: string; previousStatus: string; currentStatus: string; }
type WsMessage = WsHealthUpdate | WsCircuitTrip | { type: "pong"; timestamp: string };

const STATUS_CONFIG: Record<ServiceStatus, { color: string; icon: React.ReactNode; badge: string }> = {
  healthy: { color: "text-green-500", icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, badge: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  degraded: { color: "text-yellow-500", icon: <AlertTriangle className="h-4 w-4 text-yellow-500" />, badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  unavailable: { color: "text-red-500", icon: <XCircle className="h-4 w-4 text-red-500" />, badge: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};
const SERVICE_CATEGORIES: Record<string, string[]> = {
  "Core Platform": ["mainApp", "redis", "database"],
  "Go Services": ["goSecuritySidecar", "goRatelimitSidecar", "goExportService", "goFxEngine", "goTransferEngine", "goDaprService", "goTemporalWorker", "goPermifyService", "goKafkaService", "goCipsAdapter"],
  "Rust Services": ["rustCryptoGuard", "rustAuditService", "rustRedisService", "rustTigerBeetle", "rustFluvioService", "rustPdfReceipt", "rustPgService", "rustUpiAdapter", "rustDeviceFingerprint"],
  "Python Services": ["pythonAnomalyDetector", "pythonComplianceSvc", "pythonOpenSearch", "pythonLakehouse", "pythonKycLiveness", "pythonSanctionsUpdater", "pythonFraudMl"],
  "Middleware": ["kafka", "temporal", "keycloak", "permify", "tigerBeetle", "openSearch", "lakehouse", "fluvio", "dapr"],
  "External APIs": ["amlEngine", "fraudMl", "transferEngine", "pdfReceipt", "searchIndexer", "rateLimiter", "mojaloopConnector"],
};

/**
 * Resilient services health hook — SSE primary, HTTP polling fallback.
 * Replaces WebSocket which is unreliable on African 2G/CGNAT/proxy networks.
 *
 * Transport hierarchy:
 *   1. SSE /api/sse/services-health  (proxy-friendly, Last-Event-ID reconnect)
 *   2. HTTP polling via tRPC         (exponential backoff, 15s–60s interval)
 *
 * Heartbeat: if no SSE event in 45s, reconnect.
 * Upgrades back to SSE automatically when navigator.online fires.
 */
function useServicesHealthSSE() {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [summary, setSummary] = useState<WsHealthUpdate["summary"] | null>(null);
  const [connStatus, setConnStatus] = useState<"connecting" | "live" | "polling" | "offline">("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [circuitTrips, setCircuitTrips] = useState<WsCircuitTrip[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const modeRef = useRef<"sse" | "polling">("sse");
  const pollIntervalRef = useRef(15_000);
  const mountedRef = useRef(true);

  const applyUpdate = useCallback((msg: WsMessage) => {
    if (msg.type === "health_update") {
      setServices(msg.services);
      setSummary(msg.summary);
      setLastUpdate(new Date(msg.timestamp));
    } else if (msg.type === "circuit_trip") {
      setCircuitTrips(prev => [msg as WsCircuitTrip, ...prev].slice(0, 50));
    }
  }, []);

  const startPolling = useCallback(() => {
    modeRef.current = "polling";
    setConnStatus(navigator.onLine ? "polling" : "offline");
    const poll = async () => {
      if (!mountedRef.current || modeRef.current !== "polling") return;
      try {
        if (navigator.onLine) {
          const res = await fetch("/api/trpc/svcHealth.list", { signal: AbortSignal.timeout(8_000) });
          if (res.ok) {
            const json = await res.json();
            const data = json?.result?.data;
            if (data) {
              applyUpdate({ type: "health_update", timestamp: new Date().toISOString(), services: data.services ?? [], summary: data.summary ?? null });
            }
            pollIntervalRef.current = 15_000;
            setConnStatus("polling");
          }
        } else {
          setConnStatus("offline");
          pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, 60_000);
        }
      } catch {
        pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, 60_000);
        setConnStatus(navigator.onLine ? "polling" : "offline");
      }
      if (mountedRef.current && modeRef.current === "polling") {
        pollTimerRef.current = setTimeout(poll, pollIntervalRef.current);
      }
    };
    poll();
  }, [applyUpdate]);

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setConnStatus("connecting");

    const resetHeartbeat = () => {
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = setTimeout(() => {
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        if (mountedRef.current) connectSSE();
      }, 45_000);
    };

    const es = new EventSource("/api/sse/services-health", { withCredentials: true });
    esRef.current = es;
    resetHeartbeat();

    es.onopen = () => {
      if (!mountedRef.current) return;
      retriesRef.current = 0;
      modeRef.current = "sse";
      setConnStatus("live");
      resetHeartbeat();
    };

    es.addEventListener("health_update", (e) => {
      if (!mountedRef.current) return;
      resetHeartbeat();
      try { applyUpdate(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
    });
    es.addEventListener("circuit_trip", (e) => {
      if (!mountedRef.current) return;
      resetHeartbeat();
      try { applyUpdate(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
    });
    es.addEventListener("ping", () => { resetHeartbeat(); });

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close(); esRef.current = null;
      retriesRef.current++;
      if (retriesRef.current >= 3) { startPolling(); return; }
      // Exponential backoff: 1s, 2s, 4s, cap 30s
      const delay = Math.min(1000 * Math.pow(2, retriesRef.current - 1), 30_000);
      setConnStatus(navigator.onLine ? "connecting" : "offline");
      setTimeout(() => { if (mountedRef.current) connectSSE(); }, delay);
    };
  }, [applyUpdate, startPolling]);

  useEffect(() => {
    mountedRef.current = true;
    connectSSE();
    const handleOnline = () => {
      if (modeRef.current === "polling") {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        modeRef.current = "sse"; retriesRef.current = 0;
        connectSSE();
      }
    };
    const handleOffline = () => setConnStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [connectSSE]);

  const forceRefresh = useCallback(() => {
    retriesRef.current = 0;
    modeRef.current = "sse";
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    connectSSE();
  }, [connectSSE]);

  return { services, summary, connStatus, lastUpdate, circuitTrips, forceRefresh };
}

export default function ServicesHealthDashboard() {
  const [search, setSearch] = useState("");
  const { services, summary, connStatus, lastUpdate, circuitTrips, forceRefresh } = useServicesHealthSSE();
  const { data: registry } = trpc.svcHealth.registry.useQuery();
  const filteredServices = services.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()));
  const getServicesByCategory = (category: string) => { const names = SERVICE_CATEGORIES[category] ?? []; return filteredServices.filter((s) => names.some((n) => s.name.toLowerCase().includes(n.toLowerCase()))); };

  const connStatusConfig = {
    connecting: { label: "Connecting...", color: "text-yellow-500", icon: <Wifi className="h-4 w-4 text-yellow-500" /> },
    live:       { label: "Live (SSE)", color: "text-green-500", icon: <Zap className="h-4 w-4 text-green-500" /> },
    polling:    { label: "Polling fallback", color: "text-amber-500", icon: <Signal className="h-4 w-4 text-amber-500" /> },
    offline:    { label: "Offline", color: "text-red-500", icon: <WifiOff className="h-4 w-4 text-red-500" /> },
  }[connStatus];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="h-6 w-6 text-primary" />Services Health Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time health monitoring for all {summary?.total ?? 50} microservices</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs flex items-center gap-1 ${connStatusConfig.color}`}>{connStatusConfig.icon}{connStatusConfig.label}</span>
          {lastUpdate && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{lastUpdate.toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={forceRefresh}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500"><CardContent className="pt-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Total Services</p><p className="text-2xl font-bold">{summary?.total ?? "—"}</p></div><Server className="h-8 w-8 text-blue-500 opacity-70" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-green-500"><CardContent className="pt-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Healthy</p><p className="text-2xl font-bold text-green-600">{summary?.healthy ?? "—"}</p></div><CheckCircle2 className="h-8 w-8 text-green-500 opacity-70" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-yellow-500"><CardContent className="pt-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Degraded</p><p className="text-2xl font-bold text-yellow-600">{summary?.degraded ?? "—"}</p></div><AlertTriangle className="h-8 w-8 text-yellow-500 opacity-70" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-red-500"><CardContent className="pt-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Unavailable</p><p className="text-2xl font-bold text-red-600">{summary?.unavailable ?? "—"}</p></div><XCircle className="h-8 w-8 text-red-500 opacity-70" /></div></CardContent></Card>
      </div>
      {summary && (
        <div className={`rounded-lg p-4 flex items-center gap-3 ${summary.status === "healthy" ? "bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800" : summary.status === "degraded" ? "bg-yellow-50 border border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800" : "bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800"}`}>
          {STATUS_CONFIG[summary.status as ServiceStatus]?.icon}
          <div>
            <p className="font-semibold capitalize">Platform Status: {summary.status}</p>
            <p className="text-sm text-muted-foreground">{summary.healthy}/{summary.total} services healthy{summary.degraded > 0 && ` · ${summary.degraded} degraded`}{summary.unavailable > 0 && ` · ${summary.unavailable} unavailable`}</p>
          </div>
        </div>
      )}
      {circuitTrips.length > 0 && (
        <Card className="border-orange-300 dark:border-orange-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-orange-600"><Zap className="h-4 w-4" />Circuit-Breaker Events ({circuitTrips.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {circuitTrips.map((trip, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                  <span className="text-muted-foreground">{new Date(trip.timestamp).toLocaleTimeString()}</span>
                  <span className="font-mono font-medium">{trip.service}</span>
                  <Badge variant="outline" className="text-xs px-1 py-0">{trip.previousStatus}</Badge>
                  <span>to</span>
                  <Badge variant="outline" className={`text-xs px-1 py-0 ${trip.currentStatus === "healthy" ? "border-green-500 text-green-600" : trip.currentStatus === "degraded" ? "border-yellow-500 text-yellow-600" : "border-red-500 text-red-600"}`}>{trip.currentStatus}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search services by name or URL..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <Tabs defaultValue="all">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="all">All Services</TabsTrigger>
          {Object.keys(SERVICE_CATEGORIES).map((cat) => <TabsTrigger key={cat} value={cat}>{cat}</TabsTrigger>)}
          <TabsTrigger value="registry">URL Registry</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4"><ServiceGrid services={filteredServices} isLoading={connStatus === "connecting" && services.length === 0} /></TabsContent>
        {Object.keys(SERVICE_CATEGORIES).map((cat) => <TabsContent key={cat} value={cat} className="mt-4"><ServiceGrid services={getServicesByCategory(cat)} isLoading={connStatus === "connecting" && services.length === 0} /></TabsContent>)}
        <TabsContent value="registry" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" />Service URL Registry ({registry?.length ?? 0} services)</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {registry?.map((svc) => (
                  <div key={svc.name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="font-mono text-sm font-medium">{svc.name}</span>
                    <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">{svc.url}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServiceGrid({ services, isLoading }: { services: ServiceHealth[]; isLoading: boolean }) {
  if (isLoading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 12 }).map((_, i) => <Card key={i} className="animate-pulse"><CardContent className="pt-4"><div className="h-4 bg-muted rounded w-3/4 mb-2" /><div className="h-3 bg-muted rounded w-1/2" /></CardContent></Card>)}
    </div>
  );
  if (services.length === 0) return (
    <div className="text-center py-12 text-muted-foreground"><WifiOff className="h-12 w-12 mx-auto mb-3 opacity-30" /><p>No services found</p></div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {services.map((svc) => {
        const cfg = STATUS_CONFIG[svc.status] ?? STATUS_CONFIG.unavailable;
        return (
          <Card key={svc.name} className={`border-l-4 ${svc.status === "healthy" ? "border-l-green-500" : svc.status === "degraded" ? "border-l-yellow-500" : "border-l-red-500"}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">{cfg.icon}<span className="font-medium text-sm">{svc.name}</span></div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>{svc.status}</span>
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate mb-2">{svc.url}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {svc.latencyMs !== undefined && <span className="flex items-center gap-1"><Activity className="h-3 w-3" />{svc.latencyMs}ms</span>}
                {svc.error && <span className="text-red-500 truncate max-w-[200px]" title={svc.error}>{svc.error}</span>}
                {svc.checkedAt && <span className="flex items-center gap-1 ml-auto"><Clock className="h-3 w-3" />{new Date(svc.checkedAt).toLocaleTimeString()}</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
