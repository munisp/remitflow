import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Activity, CheckCircle, AlertTriangle, XCircle, Clock, Zap } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function SLAMonitor() {
  const { t } = useTranslation();
  const { data: overview, isLoading } = trpc.slaMonitoring.overview.useQuery();
  const { data: incidents } = trpc.slaMonitoring.incidents.useQuery();
  const { data: targets } = trpc.slaMonitoring.slaTargets.useQuery();

  const statusIcon = (s: string) => s === "operational" ? <CheckCircle className="w-4 h-4 text-green-400" /> : s === "degraded" ? <AlertTriangle className="w-4 h-4 text-yellow-400" /> : <XCircle className="w-4 h-4 text-red-400" />;
  const severityBadge = (s: string) => s === "high" ? "destructive" : s === "medium" ? "secondary" : "outline";

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Activity className="w-6 h-6 text-green-400" /> SLA Monitoring</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time service health, incident tracking, and SLA compliance</p>
      </div>

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Overall Uptime", value: `${overview.overallUptime}%`, color: "text-green-400" },
            { label: "P50 Latency", value: `${overview.p50Latency}ms`, color: "text-blue-400" },
            { label: "P99 Latency", value: `${overview.p99Latency}ms`, color: "text-yellow-400" },
            { label: "Error Rate", value: `${overview.errorRate}%`, color: "text-red-400" },
          ].map(({ label, value, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4" /> Service Status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(overview?.services ?? []).map((svc: any) => (
              <div key={svc.name} className="flex items-center justify-between py-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  {statusIcon(svc.status)}
                  <span className="text-sm text-foreground">{svc.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{svc.uptime}% uptime</span>
                  <span className="text-blue-400">{svc.latency}ms</span>
                  <Badge variant={svc.status === "operational" ? "default" : "secondary"} className="text-xs">{svc.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" /> SLA Targets</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(targets ?? []).map((t: any) => (
              <div key={t.metric} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-foreground">{t.metric}</span>
                  <span className={t.status === "met" ? "text-green-400" : "text-red-400"}>
                    {t.current}{t.unit} / target {t.target}{t.unit}
                  </span>
                </div>
                <Progress value={Math.min(100, (t.current / t.target) * 100)} className={`h-1.5 ${t.status === "met" ? "[&>div]:bg-green-500" : "[&>div]:bg-red-500"}`} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Recent Incidents</CardTitle></CardHeader>
        <CardContent>
          {(incidents ?? []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" /><p>No incidents in the last 30 days</p></div>
          ) : (
            <div className="space-y-3">
              {(incidents ?? []).map((inc: any) => (
                <div key={inc.id} className="p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{inc.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">Duration: {inc.duration} · Root cause: {inc.rootCause}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={severityBadge(inc.severity) as any}>{inc.severity}</Badge>
                      <Badge variant="outline">{inc.status}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(inc.startedAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
