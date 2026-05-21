import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Database, Layers, ArrowDown, Play, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function LakehousePage() {
  const { t } = useTranslation();
  const [etlLimit, setEtlLimit] = useState("1000");
  const [bronzeTable, setBronzeTable] = useState("transactions");
  const [bronzeLimit, setBronzeLimit] = useState("500");
  const [goldLimit, setGoldLimit] = useState("1000");
  const [etlResult, setEtlResult] = useState<any>(null);
  const [bronzeResult, setBronzeResult] = useState<any>(null);
  const [goldResult, setGoldResult] = useState<any>(null);

  const { data: statusData } = trpc.lakehouse.status.useQuery();

  const etlMutation = trpc.lakehouse.runETL.useMutation({
    onSuccess: (data) => {
      setEtlResult(data);
      toast.success(`ETL complete: ${data.totalRows} rows processed in ${data.durationMs}ms`);
    },
    onError: (err) => toast.error(err.message),
  });

  const bronzeMutation = trpc.lakehouse.ingestBronze.useMutation({
    onSuccess: (data) => {
      setBronzeResult(data);
      toast.success(`Bronze ingestion: ${data.rowCount} rows → ${data.key}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const goldMutation = trpc.lakehouse.buildGold.useMutation({
    onSuccess: (data) => {
      setGoldResult(data);
      toast.success("Gold aggregates built successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const LAYERS = [
    { name: "Bronze", desc: "Raw event log — immutable, append-only", color: "text-amber-600", bg: "bg-amber-500/10 border-amber-200 dark:border-amber-800" },
    { name: "Silver", desc: "Cleaned, deduplicated, normalized", color: "text-slate-500", bg: "bg-slate-500/10 border-slate-200 dark:border-slate-700" },
    { name: "Gold", desc: "Business-ready aggregates for ML & dashboards", color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-200 dark:border-yellow-800" },
  ];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-yellow-500" />
            Data Lakehouse
          </h1>
          <p className="text-muted-foreground mt-1">
            3-layer lakehouse: Bronze → Silver → Gold (NDJSON + Delta Log, S3/MinIO)
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          Delta Lake Architecture
        </Badge>
      </div>

      {/* Layer Architecture */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {LAYERS.map((layer, i) => (
          <div key={layer.name} className="relative">
            <Card className={`border ${layer.bg}`}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Database className={`h-4 w-4 ${layer.color}`} />
                  <span className={`font-bold ${layer.color}`}>{layer.name} Layer</span>
                </div>
                <p className="text-xs text-muted-foreground">{layer.desc}</p>
              </CardContent>
            </Card>
            {i < LAYERS.length - 1 && (
              <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                <ArrowDown className="h-5 w-5 text-muted-foreground rotate-[-90deg]" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Integrations */}
      {statusData?.aiIntegrations && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI/ML Integrations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(statusData.aiIntegrations).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-sm">
                  <Badge variant="outline" className="text-xs flex-shrink-0">{k}</Badge>
                  <span className="text-muted-foreground text-xs">{String(v)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ETL Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Full ETL */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Play className="h-4 w-4 text-green-500" />
              Full ETL Pipeline
            </CardTitle>
            <CardDescription className="text-xs">Bronze → Silver → Gold in one run</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Limit:</label>
              <Input
                type="number"
                value={etlLimit}
                onChange={(e) => setEtlLimit(e.target.value)}
                className="w-24 h-8 text-sm"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => etlMutation.mutate({ limit: parseInt(etlLimit) || 1000 })}
              disabled={etlMutation.isPending}
            >
              {etlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              Run Full ETL
            </Button>
            {etlResult && (
              <div className="text-xs space-y-1">
                <p className="text-green-600 font-medium">✓ Complete</p>
                <p className="text-muted-foreground">{etlResult.totalRows} rows, {etlResult.durationMs}ms</p>
                <p className="text-muted-foreground truncate">Bronze: {etlResult.bronze?.key}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bronze Ingest */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-amber-600" />
              Bronze Ingestion
            </CardTitle>
            <CardDescription className="text-xs">Raw data → Bronze layer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={bronzeTable} onValueChange={setBronzeTable}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["transactions", "users", "beneficiaries", "compliance_cases"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Limit:</label>
              <Input
                type="number"
                value={bronzeLimit}
                onChange={(e) => setBronzeLimit(e.target.value)}
                className="w-24 h-8 text-sm"
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => bronzeMutation.mutate({ table: bronzeTable, limit: parseInt(bronzeLimit) || 500 })}
              disabled={bronzeMutation.isPending}
            >
              {bronzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowDown className="h-4 w-4 mr-2" />}
              Ingest to Bronze
            </Button>
            {bronzeResult && (
              <div className="text-xs space-y-1">
                <p className="text-green-600 font-medium">✓ {bronzeResult.rowCount} rows ingested</p>
                <p className="text-muted-foreground truncate">{bronzeResult.key}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gold Aggregates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-yellow-500" />
              Gold Aggregates
            </CardTitle>
            <CardDescription className="text-xs">Build ML features + business aggregates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Limit:</label>
              <Input
                type="number"
                value={goldLimit}
                onChange={(e) => setGoldLimit(e.target.value)}
                className="w-24 h-8 text-sm"
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => goldMutation.mutate({ limit: parseInt(goldLimit) || 1000 })}
              disabled={goldMutation.isPending}
            >
              {goldMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BarChart3 className="h-4 w-4 mr-2" />}
              Build Gold
            </Button>
            {goldResult && (
              <div className="text-xs space-y-1">
                <p className="text-green-600 font-medium">✓ Gold built</p>
                <p className="text-muted-foreground">Daily volume, corridors, ML features</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      {statusData?.tables && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Managed Tables</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.values(statusData.tables).map((t) => (
                <Badge key={String(t)} variant="outline" className="font-mono text-xs">{String(t)}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
