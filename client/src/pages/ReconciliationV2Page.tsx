import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Scale, Play, CheckCircle2, AlertTriangle, Clock, DollarSign, RefreshCw, FileText, TrendingUp } from "lucide-react";

export default function ReconciliationV2Page() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);

  const { data: history, refetch: refetchHistory } = trpc.v99.reconciliationV2.history.useQuery({ limit: 10 });

  const runMutation = trpc.v99.reconciliationV2.runCheck.useMutation({
    onSuccess: (data) => {
      if (data.status === "clean") {
        toast.success("Reconciliation complete — no discrepancies found!");
      } else {
        toast.warning(`Reconciliation found ${data.discrepancies.length} discrepancy/discrepancies`);
      }
      refetchHistory();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleRun = () => {
    runMutation.mutate({ fromDate, toDate });
  };

  const result = runMutation.data;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center">
            <Scale className="h-5 w-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Reconciliation Engine V2</h1>
            <p className="text-muted-foreground text-sm">Automated transaction reconciliation and discrepancy detection</p>
          </div>
        </div>

        {/* Run Reconciliation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-4 w-4 text-primary" /> Run Reconciliation Check
            </CardTitle>
            <CardDescription>Select a date range and run a full reconciliation audit</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From Date</Label>
                <Input type="date" className="mt-1" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label>To Date</Label>
                <Input type="date" className="mt-1" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleRun} disabled={runMutation.isPending} className="w-full">
              {runMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Running reconciliation...</>
              ) : (
                <><Play className="h-4 w-4 mr-2" /> Run Reconciliation</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Reconciliation Result */}
        {result && (
          <div className={`rounded-xl border-2 p-5 ${result.status === "clean" ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
            <div className="flex items-center gap-3 mb-4">
              {result.status === "clean" ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              )}
              <div>
                <p className="font-bold text-lg">
                  {result.status === "clean" ? "Clean — No Discrepancies Found" : `${result.discrepancies.length} Discrepancy Found`}
                </p>
                <p className="text-sm text-muted-foreground">
                  Period: {new Date(result.period.from).toLocaleDateString()} – {new Date(result.period.to).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xl font-bold">{result.summary.totalTransactions}</p>
                <p className="text-xs text-muted-foreground">Transactions</p>
              </div>
              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xl font-bold">${result.summary.totalVolume.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Volume</p>
              </div>
              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{result.summary.completedCount}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{result.summary.pendingCount}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>

            {result.discrepancies.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold text-sm">Discrepancies:</p>
                {result.discrepancies.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 bg-white/60 rounded-lg p-3 text-sm">
                    <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${d.severity === "high" ? "text-red-600" : "text-amber-600"}`} />
                    <div>
                      <Badge className={`text-xs mb-1 ${d.severity === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {d.severity.toUpperCase()}
                      </Badge>
                      <p>{d.message}</p>
                      {d.count && <p className="text-muted-foreground">Count: {d.count}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Run History */}
        {history && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Reconciliation History
              </CardTitle>
              <CardDescription>Recent reconciliation runs and their results</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 font-semibold">Run Date</th>
                      <th className="text-right p-3 font-semibold">Transactions</th>
                      <th className="text-right p-3 font-semibold">Volume</th>
                      <th className="text-center p-3 font-semibold">Discrepancies</th>
                      <th className="text-center p-3 font-semibold">Status</th>
                      <th className="text-right p-3 font-semibold">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((run) => (
                      <tr key={run.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3">{new Date(run.runAt).toLocaleDateString()}</td>
                        <td className="p-3 text-right">{run.txCount.toLocaleString()}</td>
                        <td className="p-3 text-right">${run.volume.toLocaleString()}</td>
                        <td className="p-3 text-center">
                          {run.discrepancies > 0 ? (
                            <Badge className="bg-amber-100 text-amber-700">{run.discrepancies}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={run.status === "clean" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                            {run.status === "clean" ? "✓ Clean" : "⚠ Issues"}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{(run.duration / 1000).toFixed(1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
