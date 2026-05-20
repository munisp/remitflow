import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, RefreshCw, Database, GitBranch, Wind, CheckCircle, XCircle, Clock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500/20 text-blue-400",
  success: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  idle: "bg-gray-500/20 text-gray-400",
  queued: "bg-yellow-500/20 text-yellow-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <RefreshCw className="w-3 h-3 animate-spin" />,
  success: <CheckCircle className="w-3 h-3" />,
  failed: <XCircle className="w-3 h-3" />,
  idle: <Clock className="w-3 h-3" />,
  queued: <Clock className="w-3 h-3" />,
};

export default function DataPipelinesPage() {
  const [tab, setTab] = useState<"nifi" | "dbt" | "airflow">("nifi");

  // NiFi
  const nifiStatusQuery = trpc.dataPipelines.nifi.getStatus.useQuery();
  const nifiFlowsQuery = trpc.dataPipelines.nifi.getPipelines.useQuery();
  const nifiTriggerMutation = trpc.dataPipelines.nifi.triggerPipeline.useMutation({
    onSuccess: (d) => toast.success(`Flow triggered: ${d.pipelineId}`),
    onError: (e) => toast.error(e.message),
  });

  // dbt
  const dbtStatusQuery = trpc.dataPipelines.dbt.getStatus.useQuery();
  const dbtModelsQuery = trpc.dataPipelines.dbt.getModels.useQuery();
  const dbtRunMutation = trpc.dataPipelines.dbt.runModels.useMutation({
    onSuccess: (d) => toast.success(`dbt run started: ${d.runId}`),
    onError: (e) => toast.error(e.message),
  });

  // Airflow
  const airflowStatusQuery = trpc.dataPipelines.airflow.getStatus.useQuery();
  const airflowDagsQuery = trpc.dataPipelines.airflow.getDags.useQuery();
  const airflowTriggerMutation = trpc.dataPipelines.airflow.triggerDag.useMutation({
    onSuccess: (d) => toast.success(`DAG triggered: ${d.dagRunId}`),
    onError: (e) => toast.error(e.message),
  });

  const ServiceBadge = ({ status }: { status?: string }) => (
    <Badge className={STATUS_COLORS[status ?? "idle"] ?? "bg-gray-500/20 text-gray-400"}>
      <span className="flex items-center gap-1">
        {STATUS_ICONS[status ?? "idle"]}
        {status ?? "unknown"}
      </span>
    </Badge>
  );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Pipelines</h1>
        <p className="text-muted-foreground text-sm mt-1">Apache NiFi, dbt, and Apache Airflow pipeline management</p>
      </div>

      {/* Service Status Overview */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setTab("nifi")}>
          <CardContent className="p-4 flex items-center gap-3">
            <Wind className="w-8 h-8 text-blue-400" />
            <div>
              <p className="font-semibold text-sm">Apache NiFi</p>
              <ServiceBadge status={nifiStatusQuery.data?.available ? "RUNNING" : "STOPPED"} />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setTab("dbt")}>
          <CardContent className="p-4 flex items-center gap-3">
            <Database className="w-8 h-8 text-orange-400" />
            <div>
              <p className="font-semibold text-sm">dbt Core</p>
              <ServiceBadge status={dbtStatusQuery.data?.available ? "RUNNING" : "STOPPED"} />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setTab("airflow")}>
          <CardContent className="p-4 flex items-center gap-3">
            <GitBranch className="w-8 h-8 text-green-400" />
            <div>
              <p className="font-semibold text-sm">Apache Airflow</p>
              <ServiceBadge status={airflowStatusQuery.data?.available ? "RUNNING" : "STOPPED"} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(["nifi", "dbt", "airflow"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium uppercase border-b-2 transition-colors ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* NiFi Panel */}
      {tab === "nifi" && (
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">NiFi Flows ({nifiFlowsQuery.data?.length ?? 0})</CardTitle>
              <Button size="sm" variant="outline" onClick={() => nifiFlowsQuery.refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">Flow ID</th>
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Queued</th>
                  <th className="p-3 text-left">Actions</th>
                </tr></thead>
                <tbody>
                  {(nifiFlowsQuery.data ?? []).map((f) => (
                    <tr key={f.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{f.id}</td>
                      <td className="p-3 text-sm">{f.name}</td>
                      <td className="p-3"><ServiceBadge status={f.status} /></td>
                      <td className="p-3 text-sm">{((f as any).queuedCount ?? 0) ?? 0}</td>
                      <td className="p-3">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => nifiTriggerMutation.mutate({ pipelineId: f.id })}
                          disabled={nifiTriggerMutation.isPending}>
                          <Play className="w-3 h-3 mr-1" /> Trigger
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(nifiFlowsQuery.data ?? []).length === 0 && (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">
                      {nifiStatusQuery.data?.available ? "No flows configured" : "NiFi service not available — start with docker-compose.ai.yml"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* dbt Panel */}
      {tab === "dbt" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => dbtRunMutation.mutate({ select: undefined })}
              disabled={dbtRunMutation.isPending}>
              <Play className="w-4 h-4 mr-2" />
              {dbtRunMutation.isPending ? "Running..." : "Run All Models"}
            </Button>
          </div>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">dbt Models ({dbtModelsQuery.data?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">Model</th>
                  <th className="p-3 text-left">Layer</th>
                  <th className="p-3 text-left">Materialization</th>
                  <th className="p-3 text-left">Last Run</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Actions</th>
                </tr></thead>
                <tbody>
                  {(dbtModelsQuery.data ?? []).map((m) => (
                    <tr key={m.name} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs text-blue-400">{m.name}</td>
                      <td className="p-3"><Badge className="bg-purple-500/20 text-purple-400">{m.layer}</Badge></td>
                      <td className="p-3 text-xs capitalize">{((m as any).materialization)}</td>
                      <td className="p-3 text-xs text-muted-foreground">{m.lastRunAt ? new Date(m.lastRunAt).toLocaleString() : "Never"}</td>
                      <td className="p-3"><ServiceBadge status={m.status} /></td>
                      <td className="p-3">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => dbtRunMutation.mutate({ select: m.name })}
                          disabled={dbtRunMutation.isPending}>
                          <Play className="w-3 h-3 mr-1" /> Run
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(dbtModelsQuery.data ?? []).length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                      {dbtStatusQuery.data?.available ? "No models found" : "dbt service not available — configure dbt project path"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Airflow Panel */}
      {tab === "airflow" && (
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Airflow DAGs ({airflowDagsQuery.data?.length ?? 0})</CardTitle>
              <Button size="sm" variant="outline" onClick={() => airflowDagsQuery.refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">DAG ID</th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-left">Schedule</th>
                  <th className="p-3 text-left">Last Run</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Actions</th>
                </tr></thead>
                <tbody>
                  {(airflowDagsQuery.data ?? []).map((d) => (
                    <tr key={d.dagId} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs text-green-400">{d.dagId}</td>
                      <td className="p-3 text-xs text-muted-foreground max-w-48 truncate">{d.description}</td>
                      <td className="p-3 font-mono text-xs">{d.schedule}</td>
                      <td className="p-3 text-xs text-muted-foreground">{d.lastRunAt ? new Date(d.lastRunAt).toLocaleString() : "Never"}</td>
                      <td className="p-3"><ServiceBadge status={d.lastRunState} /></td>
                      <td className="p-3">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => airflowTriggerMutation.mutate({ dagId: d.dagId })}
                          disabled={airflowTriggerMutation.isPending}>
                          <Play className="w-3 h-3 mr-1" /> Trigger
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(airflowDagsQuery.data ?? []).length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                      {airflowStatusQuery.data?.available ? "No DAGs found" : "Airflow not available — start with docker-compose.ai.yml"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
