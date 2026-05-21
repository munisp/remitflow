import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart2, Activity, ExternalLink, AlertTriangle, CheckCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const GRAFANA_URL = "http://localhost:3001";

export default function GrafanaDashboardPage() {
  const { t } = useTranslation();
  const { data: dashData, isLoading, isError } = trpc.v90.grafana.getDashboards.useQuery();
  const { data: alertData } = trpc.v90.grafana.getAlerts.useQuery();

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Grafana Dashboards</h1>
          <p className="text-muted-foreground text-sm">Live monitoring — Prometheus + Grafana + Loki</p>
        </div>
        <Button variant="outline" onClick={() => window.open(dashData?.grafanaUrl ?? GRAFANA_URL, "_blank")}>
          <ExternalLink className="w-4 h-4 mr-2" />Open Grafana
        </Button>
      </div>

      {alertData && alertData.activeAlerts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-600" />Active Alerts ({alertData.totalAlerts})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alertData.activeAlerts.map((a, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-white rounded border">
                  <div>
                    <span className="font-medium text-sm">{a.name}</span>
                    <p className="text-xs text-muted-foreground">Value: {a.value} / Threshold: {a.threshold}</p>
                  </div>
                  <Badge className={a.severity === "warning" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}>{a.state}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dashData?.dashboards.map(d => (
          <Card key={d.uid} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => window.open(d.url, "_blank")}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {d.tags.includes("ml") ? <Activity className="w-4 h-4" /> : <BarChart2 className="w-4 h-4" />}
                  {d.title}
                </CardTitle>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {d.tags.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Status</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {dashData?.status === "connected"
              ? <><CheckCircle className="w-5 h-5 text-green-600" /><span className="text-green-700 font-medium">Grafana connected at {dashData.grafanaUrl}</span></>
              : <><AlertTriangle className="w-5 h-5 text-orange-600" /><span className="text-orange-700">Start with: <code className="bg-muted px-1 rounded">docker compose -f docker-compose.monitoring.yml up -d</code></span></>
            }
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
