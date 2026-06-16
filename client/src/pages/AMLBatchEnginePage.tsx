import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, Play, CheckCircle2, AlertTriangle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function AMLBatchEnginePage() {
  const { t } = useTranslation();
  const [batchSize, setBatchSize] = useState(100);
  const [riskThreshold, setRiskThreshold] = useState(70);

  const { data: queue, isLoading, refetch } = trpc.v101.amlBatchEngine.getScreeningQueue.useQuery();

  const runBatch = trpc.v101.amlBatchEngine.runBatch.useMutation({
    onSuccess: (d) => {
      toast.success(
        `Batch complete — ${d.flagged} flagged, ${d.cleared} cleared out of ${d.batchSize}`
      );
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const resolve = trpc.v101.amlBatchEngine.resolveScreening.useMutation({
    onSuccess: () => {
      toast.success("Screening resolved");
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const riskColor = (level: string) => {
    if (level === "high" || level === "critical") return "bg-red-100 text-red-800";
    if (level === "medium") return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AML Batch Screening Engine</h1>
        <p className="text-muted-foreground">
          Automated anti-money laundering batch screening with risk scoring and sanctions checking
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="w-5 h-5" />
              Run Batch Screening
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Batch Size</Label>
                <Input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  min={10}
                  max={1000}
                />
              </div>
              <div>
                <Label>Risk Threshold (0–100)</Label>
                <Input
                  type="number"
                  value={riskThreshold}
                  onChange={(e) => setRiskThreshold(Number(e.target.value))}
                  min={0}
                  max={100}
                />
              </div>
            </div>
            <Button
              onClick={() => runBatch.mutate({ batchSize, riskThreshold })}
              disabled={runBatch.isPending}
            >
              <Play className="w-4 h-4 mr-2" />
              {runBatch.isPending ? "Running..." : "Run Batch"}
            </Button>

            {runBatch.data && (
              <div className="p-4 bg-muted rounded-lg grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{runBatch.data.batchSize}</div>
                  <div className="text-xs text-muted-foreground">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{runBatch.data.flagged}</div>
                  <div className="text-xs text-muted-foreground">Flagged</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{runBatch.data.cleared}</div>
                  <div className="text-xs text-muted-foreground">Cleared</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{runBatch.data.riskThreshold}</div>
                  <div className="text-xs text-muted-foreground">Threshold</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Queue Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground text-sm">Pending Review</span>
                <span className="font-bold">{queue?.total ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground text-sm">High Risk</span>
                <span className="font-bold text-red-600">
                  {queue?.queue.filter((q: any) => q.riskLevel === "high" || q.riskLevel === "critical").length ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground text-sm">Medium Risk</span>
                <span className="font-bold text-yellow-600">
                  {queue?.queue.filter((q: any) => q.riskLevel === "medium").length ?? 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Screening Queue — Pending Review</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Risk Level</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(queue?.queue ?? []).map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.id}</TableCell>
                    <TableCell>{item.userId}</TableCell>
                    <TableCell>
                      <Badge className={riskColor(item.riskLevel ?? "low")}>
                        {item.riskLevel ?? "low"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.result}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600"
                          onClick={() =>
                            resolve.mutate({
                              screeningId: item.id,
                              resolution: "clear",
                              notes: "Manually cleared",
                            })
                          }
                          disabled={resolve.isPending}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Clear
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() =>
                            resolve.mutate({
                              screeningId: item.id,
                              resolution: "escalate",
                              notes: "Escalated for review",
                            })
                          }
                          disabled={resolve.isPending}
                        >
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Escalate
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(queue?.queue ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No items in screening queue
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
