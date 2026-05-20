import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, XCircle, Activity, Database, Zap, Bell, CreditCard, HardDrive, Server, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const statusConfig: Record<string, { icon: any; color: string; badge: string }> = {
  healthy: { icon: CheckCircle2, color: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" },
  degraded: { icon: AlertTriangle, color: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
  critical: { icon: XCircle, color: "text-red-600", badge: "bg-red-100 text-red-700" },
};

const serviceIcons: Record<string, any> = {
  "API Server": Server,
  "Database": Database,
  "FX Rate Service": Activity,
  "KYC Service": CheckCircle2,
  "Notification Service": Bell,
  "Stripe Payments": CreditCard,
  "Kafka Broker": Activity,
  "Temporal Worker": Zap,
  "Redis Cache": HardDrive,
  "S3 Storage": HardDrive,
};

export default function SystemHealthDashboardV2() {
  const { data: health, isLoading, refetch, isFetching } = trpc.v99.systemHealth.getHealth.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );

  const { data: metrics } = trpc.v99.systemHealth.getMetrics.useQuery({ hours: 24 });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 flex items-center justify-center min-h-[400px]">
          <div className="text-center text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 animate-pulse" />
            <p>Loading system health...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!health) return null;

  const overallConfig = statusConfig[health.overallStatus] ?? statusConfig.healthy;
  const OverallIcon = overallConfig.icon;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              <Activity className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">System Health Dashboard</h1>
              <p className="text-muted-foreground text-sm">Real-time service monitoring and metrics</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Overall Status Banner */}
        <div className={`rounded-xl border-2 p-5 flex items-center justify-between ${
          health.overallStatus === "healthy" ? "bg-emerald-50 border-emerald-300" :
          health.overallStatus === "degraded" ? "bg-amber-50 border-amber-300" :
          "bg-red-50 border-red-300"
        }`}>
          <div className="flex items-center gap-3">
            <OverallIcon className={`h-8 w-8 ${overallConfig.color}`} />
            <div>
              <p className="font-bold text-lg capitalize">{health.overallStatus === "healthy" ? "All Systems Operational" : `System ${health.overallStatus.charAt(0).toUpperCase() + health.overallStatus.slice(1)}`}</p>
              <p className="text-sm text-muted-foreground">Last checked: {new Date(health.timestamp).toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black">{health.metrics.healthyServices}/{health.metrics.totalServices}</p>
            <p className="text-xs text-muted-foreground">Services healthy</p>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Uptime</p>
              <p className="text-2xl font-bold text-emerald-600">{health.metrics.uptimePct}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">DB Latency</p>
              <p className="text-2xl font-bold">{health.metrics.dbLatencyMs}ms</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Tx/Hour</p>
              <p className="text-2xl font-bold">{health.metrics.txPerHour}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Alerts</p>
              <p className={`text-2xl font-bold ${health.alerts.length > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {health.alerts.length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Services Grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service Status</CardTitle>
            <CardDescription>Real-time health of all platform services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {health.services.map((service) => {
                const config = statusConfig[service.status] ?? statusConfig.healthy;
                const StatusIcon = config.icon;
                const ServiceIcon = serviceIcons[service.name] ?? Server;
                return (
                  <div key={service.name} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <ServiceIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">{service.name}</p>
                        {service.note && <p className="text-xs text-muted-foreground">{service.note}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      {service.latencyMs > 0 && (
                        <span className="text-xs text-muted-foreground">{service.latencyMs}ms</span>
                      )}
                      <Badge className={`text-xs ${config.badge}`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {service.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        {health.alerts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Active Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {health.alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-amber-800">{alert.service}</p>
                    <p className="text-amber-700">{alert.message}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Historical Metrics Chart */}
        {metrics && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">24-Hour Metrics</CardTitle>
              <CardDescription>API latency, transaction volume, and error rate over the last 24 hours</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>API Latency (avg {Math.round(metrics.points.reduce((s, p) => s + p.apiLatencyMs, 0) / metrics.points.length)}ms)</span>
                    <span>Max: {Math.max(...metrics.points.map(p => p.apiLatencyMs))}ms</span>
                  </div>
                  <div className="flex items-end gap-0.5 h-16">
                    {metrics.points.slice(-48).map((p, i) => {
                      const max = Math.max(...metrics.points.map(x => x.apiLatencyMs));
                      const pct = max > 0 ? (p.apiLatencyMs / max) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 bg-primary/20 hover:bg-primary/40 rounded-sm transition-colors" style={{ height: `${pct}%` }} title={`${p.apiLatencyMs}ms`} />
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Transaction Volume</span>
                    <span>Peak: {Math.max(...metrics.points.map(p => p.txCount))} tx/hr</span>
                  </div>
                  <div className="flex items-end gap-0.5 h-16">
                    {metrics.points.slice(-48).map((p, i) => {
                      const max = Math.max(...metrics.points.map(x => x.txCount));
                      const pct = max > 0 ? (p.txCount / max) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 bg-emerald-500/30 hover:bg-emerald-500/50 rounded-sm transition-colors" style={{ height: `${pct}%` }} title={`${p.txCount} tx`} />
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
