import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function BulkPaymentsV2Page() {
  const [batchIdToCheck, setBatchIdToCheck] = useState("");
  const [checkedBatchId, setCheckedBatchId] = useState<string | null>(null);
  const { data: batchStatus } = trpc.v90.bulkPayments.getBatchStatus.useQuery(
    { batchId: checkedBatchId! },
    { enabled: !!checkedBatchId }
  );
  const createMutation = trpc.v90.bulkPayments.createBatch.useMutation({
    onSuccess: (d) => {
      toast.success(`Batch created: ${d.batchId} (${d.paymentCount} payments)`);
      setCheckedBatchId(d.batchId);
    },
    onError: () => toast.error("Batch creation failed"),
  });

  const statusIcon = (s: string) => {
    if (s === "completed") return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (s === "processing") return <Clock className="w-4 h-4 text-blue-600" />;
    if (s === "failed") return <AlertCircle className="w-4 h-4 text-red-600" />;
    return <Clock className="w-4 h-4 text-gray-400" />;
  };

  const statusColors: Record<string, string> = {
    pending_approval: "bg-yellow-100 text-yellow-800",
    queued: "bg-gray-100 text-gray-800",
    processing: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bulk Payments v2</h1>
          <p className="text-muted-foreground text-sm">Process up to 500 payments per batch with smart parallel routing</p>
        </div>
        <Button onClick={() => createMutation.mutate({
          batchName: `Batch-${Date.now()}`,
          payments: [
            { beneficiaryId: 1, amount: 100, currency: "USD", reference: "BULK-001" },
            { beneficiaryId: 2, amount: 200, currency: "GBP", reference: "BULK-002" },
            { beneficiaryId: 3, amount: 150, currency: "EUR", reference: "BULK-003" },
          ],
          approvalRequired: false,
        })} disabled={createMutation.isPending}>
          <Upload className="w-4 h-4 mr-2" />{createMutation.isPending ? "Creating..." : "Create Sample Batch"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Check Batch Status</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter batch ID (e.g. BATCH-ABC123)"
              value={batchIdToCheck}
              onChange={e => setBatchIdToCheck(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => setCheckedBatchId(batchIdToCheck)} disabled={!batchIdToCheck}>
              Check
            </Button>
          </div>
        </CardContent>
      </Card>

      {batchStatus && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {statusIcon(batchStatus.status)}
              <CardTitle>{batchStatus.batchId}</CardTitle>
              <Badge className={statusColors[batchStatus.status] || "bg-gray-100 text-gray-800"}>{batchStatus.status}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><p className="text-sm text-muted-foreground">Total</p><p className="text-xl font-bold">{batchStatus.totalPayments}</p></div>
              <div><p className="text-sm text-muted-foreground">Processed</p><p className="text-xl font-bold text-blue-600">{batchStatus.completed}</p></div>
              <div><p className="text-sm text-muted-foreground">Failed</p><p className="text-xl font-bold text-red-600">{batchStatus.failed}</p></div>
              <div><p className="text-sm text-muted-foreground">Progress</p><p className="text-xl font-bold">{batchStatus.successRate}%</p></div>
            </div>
            {batchStatus.status === "processing" && (
              <div className="mt-4">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${batchStatus.successRate}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">~{batchStatus.estimatedCompletionAt} minutes remaining</p>
              </div>
            )}
            {batchStatus.failures.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-red-600 mb-2">Errors ({batchStatus.failures.length})</p>
                <div className="space-y-1">
                  {batchStatus.failures.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{e.paymentIndex}: {e.reason}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Batch Limits &amp; Pricing</CardTitle></CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 border rounded-lg"><p className="font-medium">Standard</p><p className="text-muted-foreground">Up to 100 payments</p><p className="text-muted-foreground">$0.10 per payment</p></div>
            <div className="p-3 border rounded-lg border-blue-200 bg-blue-50"><p className="font-medium text-blue-700">Business</p><p className="text-muted-foreground">Up to 250 payments</p><p className="text-muted-foreground">$0.07 per payment</p></div>
            <div className="p-3 border rounded-lg"><p className="font-medium">Enterprise</p><p className="text-muted-foreground">Up to 500 payments</p><p className="text-muted-foreground">$0.05 per payment</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
