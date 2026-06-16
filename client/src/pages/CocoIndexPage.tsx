import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Zap, Users, FileText, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function CocoIndexPage() {
  const { t } = useTranslation();
  const [txBatchSize, setTxBatchSize] = useState("100");
  const [benefBatchSize, setBenefBatchSize] = useState("200");
  const [fullResult, setFullResult] = useState<any>(null);
  const [txResult, setTxResult] = useState<any>(null);
  const [benefResult, setBenefResult] = useState<any>(null);

  const { data: statusData, refetch: refetchStatus } = trpc.cocoindex.status.useQuery();

  const fullMutation = trpc.cocoindex.runFull.useMutation({
    onSuccess: (data) => {
      setFullResult(data);
      refetchStatus();
      const total = (data.transactions?.processed ?? 0) + (data.beneficiaries?.processed ?? 0) + (data.users?.processed ?? 0) + (data.kb?.processed ?? 0);
      toast.success(`Full pipeline complete: ${total} items indexed in ${data.totalDurationMs}ms`);
    },
    onError: (err) => toast.error(err.message),
  });

  const txMutation = trpc.cocoindex.runTransactions.useMutation({
    onSuccess: (data) => {
      setTxResult(data);
      refetchStatus();
      toast.success(`Transactions indexed: ${data.processed} items`);
    },
    onError: (err) => toast.error(err.message),
  });

  const benefMutation = trpc.cocoindex.runBeneficiaries.useMutation({
    onSuccess: (data) => {
      setBenefResult(data);
      refetchStatus();
      toast.success(`Beneficiaries indexed: ${data.processed} items`);
    },
    onError: (err) => toast.error(err.message),
  });

  const status = statusData;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RefreshCw className="h-6 w-6 text-teal-500" />
            CocoIndex Pipeline
          </h1>
          <p className="text-muted-foreground mt-1">
            Incremental indexing: PostgreSQL → Qdrant (vectors) + FalkorDB (graph)
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          Incremental ETL
        </Badge>
      </div>

      {/* Pipeline Status */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Transactions", value: (status.pipelines as any)?.transactions?.itemsProcessed ?? 0, icon: Zap, color: "text-teal-500" },
            { label: "Beneficiaries", value: (status.pipelines as any)?.beneficiaries?.itemsProcessed ?? 0, icon: Users, color: "text-blue-500" },
            { label: "KB Articles", value: (status.pipelines as any)?.kb_articles?.itemsProcessed ?? 0, icon: FileText, color: "text-purple-500" },
            { label: "Last Run", value: (status.pipelines as any)?.transactions?.lastRunAt ? new Date((status.pipelines as any).transactions.lastRunAt).toLocaleTimeString() : "Never", icon: Clock, color: "text-muted-foreground" },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                </div>
                <p className="text-xl font-bold mt-1">{String(stat.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pipeline Architecture */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Pipeline Architecture</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {[
              { label: "PostgreSQL", color: "bg-blue-500/10 text-blue-600 border-blue-200" },
              { label: "→" },
              { label: "CocoIndex", color: "bg-teal-500/10 text-teal-600 border-teal-200" },
              { label: "→" },
              { label: "Qdrant Vectors", color: "bg-purple-500/10 text-purple-600 border-purple-200" },
              { label: "+" },
              { label: "FalkorDB Graph", color: "bg-orange-500/10 text-orange-600 border-orange-200" },
            ].map((item, i) => (
              item.color ? (
                <Badge key={i} variant="outline" className={`${item.color} text-xs`}>{item.label}</Badge>
              ) : (
                <span key={i} className="text-muted-foreground font-bold">{item.label}</span>
              )
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="border rounded p-2">
              <p className="font-medium text-foreground mb-1">Transactions</p>
              <p>Embeds: amount, currency, destination, status, risk_score</p>
              <p>→ Qdrant: semantic search + anomaly detection</p>
            </div>
            <div className="border rounded p-2">
              <p className="font-medium text-foreground mb-1">Beneficiaries</p>
              <p>Embeds: name, account number, country, bank</p>
              <p>→ Qdrant: duplicate detection + fraud networks</p>
            </div>
            <div className="border rounded p-2">
              <p className="font-medium text-foreground mb-1">Knowledge Base</p>
              <p>Embeds: article title + content chunks</p>
              <p>→ Qdrant: RAG for customer support</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Full Pipeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4 text-teal-500" />
              Full Pipeline
            </CardTitle>
            <CardDescription className="text-xs">Index all collections in one run</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => fullMutation.mutate()}
              disabled={fullMutation.isPending}
            >
              {fullMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Run Full Index
            </Button>
            {fullResult && (
              <div className="text-xs space-y-1">
                <p className="text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Complete
                </p>
                <p className="text-muted-foreground">Total: {((fullResult.transactions?.processed ?? 0) + (fullResult.beneficiaries?.processed ?? 0) + (fullResult.users?.processed ?? 0) + (fullResult.kb?.processed ?? 0))} items</p>
                <p className="text-muted-foreground">Duration: {fullResult.totalDurationMs}ms</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transactions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-teal-500" />
              Transactions
            </CardTitle>
            <CardDescription className="text-xs">Index transaction vectors</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Batch:</label>
              <Input
                type="number"
                value={txBatchSize}
                onChange={(e) => setTxBatchSize(e.target.value)}
                className="w-20 h-8 text-sm"
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => txMutation.mutate({ batchSize: parseInt(txBatchSize) || 100 })}
              disabled={txMutation.isPending}
            >
              {txMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Index Transactions
            </Button>
            {txResult && (
              <div className="text-xs space-y-1">
                <p className="text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {txResult.processed} indexed
                </p>
                {txResult.errors > 0 && <p className="text-red-500">{txResult.errors} errors</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Beneficiaries */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-blue-500" />
              Beneficiaries
            </CardTitle>
            <CardDescription className="text-xs">Index beneficiary vectors</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Batch:</label>
              <Input
                type="number"
                value={benefBatchSize}
                onChange={(e) => setBenefBatchSize(e.target.value)}
                className="w-20 h-8 text-sm"
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => benefMutation.mutate({ batchSize: parseInt(benefBatchSize) || 200 })}
              disabled={benefMutation.isPending}
            >
              {benefMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Users className="h-4 w-4 mr-2" />}
              Index Beneficiaries
            </Button>
            {benefResult && (
              <div className="text-xs space-y-1">
                <p className="text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {benefResult.processed} indexed
                </p>
                {benefResult.errors > 0 && <p className="text-red-500">{benefResult.errors} errors</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  

    </DashboardLayout>

  );
}
