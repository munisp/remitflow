import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {  Brain, Database, Network, Cpu, Activity, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, Zap, BarChart3, Search, MessageSquare,
  GitBranch, Layers, TrendingUp, Shield
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function AIHub() {
  
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResults, setDiagResults] = useState<any>(null);

  const { data: status, isLoading, refetch } = trpc.aiHub.status.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const diagMutation = trpc.aiHub.runDiagnostics.useMutation({
    onMutate: () => setDiagRunning(true),
    onSuccess: (data) => {
      setDiagResults(data);
      setDiagRunning(false);
      toast.success(`Diagnostics complete — ${Object.keys(data.results).length} services checked`);
    },
    onError: () => setDiagRunning(false),
  });

  const getStatusIcon = (available: boolean) =>
    available ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />;

  const getStatusBadge = (available: boolean) =>
    available ? <Badge className="bg-green-500/10 text-green-600 border-green-200">Online</Badge>
              : <Badge variant="destructive">Offline</Badge>;

  const serviceIcons: Record<string, React.ReactNode> = {
    qdrant: <Search className="h-5 w-5 text-blue-500" />,
    falkordb: <Network className="h-5 w-5 text-purple-500" />,
    ollama: <Brain className="h-5 w-5 text-orange-500" />,
    lakehouse: <Database className="h-5 w-5 text-cyan-500" />,
    cocoindex: <RefreshCw className="h-5 w-5 text-green-500" />,
  };

  const modelTypeColors: Record<string, string> = {
    "RandomForest + GradientBoosting": "bg-blue-500/10 text-blue-600",
    "GradientBoosting": "bg-purple-500/10 text-purple-600",
    "Ensemble (RF + GB + LR)": "bg-orange-500/10 text-orange-600",
    "IsolationForest + DBSCAN": "bg-red-500/10 text-red-600",
    "LLM (Ollama/Manus)": "bg-green-500/10 text-green-600",
    "Sentence Transformers": "bg-cyan-500/10 text-cyan-600",
    "GNN (Graph Neural Network)": "bg-pink-500/10 text-pink-600",
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-7 w-7 text-purple-500" />
            AI/ML Intelligence Hub
          </h1>
          <p className="text-muted-foreground mt-1">
            Qdrant · FalkorDB · Ollama · ART · EPR-KGQA · CocoIndex · Lakehouse
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => diagMutation.mutate()} disabled={diagRunning}>
            {diagRunning ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
            Run Diagnostics
          </Button>
        </div>
      </div>

      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services">Infrastructure</TabsTrigger>
          <TabsTrigger value="models">ML Models</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          {diagResults && <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>}
        </TabsList>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {status?.services && Object.entries(status.services).map(([name, svc]: [string, any]) => (
              <Card key={name} className="border-l-4" style={{ borderLeftColor: svc.available ? "#22c55e" : "#ef4444" }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {serviceIcons[name] || <Cpu className="h-5 w-5" />}
                      {name.charAt(0).toUpperCase() + name.slice(1)}
                    </span>
                    {getStatusBadge(svc.available)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {svc.available ? (
                    <>
                      {name === "qdrant" && (
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Collections: {svc.collections?.length || 0}</div>
                          <div>Total vectors: {svc.collections?.reduce((s: number, c: any) => s + c.vectorCount, 0) || 0}</div>
                          <div>Version: {svc.version || "N/A"}</div>
                        </div>
                      )}
                      {name === "falkordb" && (
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Nodes: {svc.nodeCount || 0}</div>
                          <div>Edges: {svc.edgeCount || 0}</div>
                          <div>Graphs: {svc.graphs?.join(", ") || "N/A"}</div>
                        </div>
                      )}
                      {name === "ollama" && (
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Models: {svc.models?.length || 0}</div>
                          <div>{svc.models?.slice(0, 2).join(", ") || "No models loaded"}</div>
                          <div>Version: {svc.version || "N/A"}</div>
                        </div>
                      )}
                      {name === "lakehouse" && (
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Tables: {svc.tableCount || 0}</div>
                          <div>Total rows: {svc.totalRows?.toLocaleString() || 0}</div>
                          <div>Last ETL: {svc.lastEtlAt ? new Date(svc.lastEtlAt).toLocaleString() : "Never"}</div>
                        </div>
                      )}
                      {name === "cocoindex" && (
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Status: {svc.status || "idle"}</div>
                          <div>Indexed: {svc.indexedCount?.toLocaleString() || 0} records</div>
                          <div>Last run: {svc.lastRunAt ? new Date(svc.lastRunAt).toLocaleString() : "Never"}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      <AlertCircle className="h-3 w-3 inline mr-1 text-amber-500" />
                      {svc.error || "Service unavailable — using fallback mode"}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Diagnostics results */}
          {diagResults && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Latest Diagnostics — {new Date(diagResults.timestamp).toLocaleString()}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {Object.entries(diagResults.results).map(([svc, r]: [string, any]) => (
                    <div key={svc} className="flex items-start gap-2 p-3 rounded-lg bg-muted/30">
                      {r.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" /> :
                       r.status === "degraded" ? <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5" /> :
                       <XCircle className="h-4 w-4 text-red-500 mt-0.5" />}
                      <div>
                        <div className="text-sm font-medium capitalize">{svc}</div>
                        <div className="text-xs text-muted-foreground">{r.latencyMs}ms — {r.details}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ML Models Tab */}
        <TabsContent value="models" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {status?.mlModels && Object.entries(status.mlModels).map(([name, model]: [string, any]) => (
              <Card key={name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-blue-500" />
                      {name.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <Badge className={modelTypeColors[model.type] || "bg-gray-100 text-gray-600"} variant="outline">
                      {model.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{model.type}</div>
                  <div className="text-xs text-muted-foreground">Library: {model.library}</div>
                  {model.features && (
                    <div className="text-xs text-muted-foreground">Features: {model.features}</div>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {model.type.includes("LLM") ? "Neural" : model.type.includes("GNN") ? "Graph Neural" : "Ensemble ML"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {status?.integrations && Object.entries(status.integrations).map(([name, desc]: [string, any]) => (
              <div key={name} className="flex items-start gap-3 p-4 rounded-lg border bg-card">
                <div className="mt-0.5">
                  {name === "qdrant" && <Search className="h-5 w-5 text-blue-500" />}
                  {name === "falkordb" && <Network className="h-5 w-5 text-purple-500" />}
                  {name === "ollama" && <Brain className="h-5 w-5 text-orange-500" />}
                  {name === "art" && <Zap className="h-5 w-5 text-yellow-500" />}
                  {name === "eprKgqa" && <MessageSquare className="h-5 w-5 text-green-500" />}
                  {name === "cocoindex" && <RefreshCw className="h-5 w-5 text-cyan-500" />}
                  {name === "lakehouse" && <Layers className="h-5 w-5 text-pink-500" />}
                </div>
                <div>
                  <div className="text-sm font-semibold capitalize">{name.replace(/([A-Z])/g, " $1").trim()}</div>
                  <div className="text-sm text-muted-foreground">{desc}</div>
                </div>
                <div className="ml-auto">
                  <Badge className="bg-green-500/10 text-green-600 border-green-200">Active</Badge>
                </div>
              </div>
            ))}
          </div>

          {/* Architecture diagram */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <GitBranch className="h-4 w-4" /> AI/ML Architecture
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                <div className="p-2 rounded bg-blue-500/10 text-blue-700 font-medium">PostgreSQL<br/><span className="font-normal">Source of Truth</span></div>
                <div className="p-2 rounded bg-green-500/10 text-green-700 font-medium">CocoIndex<br/><span className="font-normal">Incremental ETL</span></div>
                <div className="p-2 rounded bg-purple-500/10 text-purple-700 font-medium">Qdrant + FalkorDB<br/><span className="font-normal">Vector + Graph Store</span></div>
                <div className="p-2 rounded bg-orange-500/10 text-orange-700 font-medium">Ollama / Manus LLM<br/><span className="font-normal">Local + Cloud LLM</span></div>
                <div className="p-2 rounded bg-yellow-500/10 text-yellow-700 font-medium">ART Agent<br/><span className="font-normal">Adaptive Reasoning</span></div>
                <div className="p-2 rounded bg-cyan-500/10 text-cyan-700 font-medium">Lakehouse<br/><span className="font-normal">Bronze→Silver→Gold</span></div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground text-center">
                All components gracefully degrade to mock/fallback mode when external services are unavailable.
                Production deployment requires Qdrant, FalkorDB, and Ollama Docker services (see docker-compose.yml).
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Diagnostics Tab */}
        {diagResults && (
          <TabsContent value="diagnostics">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Full Diagnostics Report — {new Date(diagResults.timestamp).toLocaleString()}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(diagResults.results).map(([svc, r]: [string, any]) => (
                    <div key={svc} className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium capitalize">{svc}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{r.latencyMs}ms</span>
                          <Badge variant={r.status === "ok" ? "default" : r.status === "degraded" ? "secondary" : "destructive"}>
                            {r.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{r.details}</div>
                      <Progress value={r.status === "ok" ? 100 : r.status === "degraded" ? 50 : 0} className="h-1 mt-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
