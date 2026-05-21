import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Play, RotateCcw, Eye } from "lucide-react";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/40 text-gray-300",
  processing: "bg-blue-900/40 text-blue-300",
  completed: "bg-green-900/40 text-green-300",
  partial: "bg-yellow-900/40 text-yellow-300",
  failed: "bg-red-900/40 text-red-300",
};

export default function BatchPaymentAdmin() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchName, setBatchName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [recipientsText, setRecipientsText] = useState("");

  const { data: listData, isLoading: listLoading, refetch: refetchList } = trpc.batchPaymentV97.getWithItems.useQuery({ batchId: 0 }, { enabled: false });
  const batches: any[] = (listData as any)?.batches ?? (Array.isArray(listData) ? listData : []);

  const { data: batchDetail } = trpc.batchPaymentV97.getWithItems.useQuery(
    { batchId: selectedBatchId! },
    { enabled: selectedBatchId !== null }
  );

  const createMutation = trpc.batchPaymentV97.createWithItems.useMutation({
    onSuccess: () => { toast.success("Batch created"); refetchList(); setCreateOpen(false); setBatchName(""); setRecipientsText(""); },
    onError: (e) => toast.error(e.message),
  });

  const processMutation = trpc.batchPaymentV97.process.useMutation({
    onSuccess: () => { toast.success("Batch processing started"); refetchList(); },
    onError: (e) => toast.error(e.message),
  });

  const retryMutation = trpc.batchPaymentV97.retryFailed.useMutation({
    onSuccess: () => { toast.success("Failed items retried"); refetchList(); },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!batchName.trim()) return toast.error("Batch name is required");
    const lines = recipientsText.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return toast.error("At least one recipient is required");
    const recipients = lines.map((line, i) => {
      const parts = line.split(",").map(p => p.trim());
      return {
        recipientName: parts[0] || `Recipient ${i + 1}`,
        recipientAccount: parts[1] || undefined,
        amount: parseFloat(parts[2] || "0") || 0,
        recipientCountry: parts[3] || undefined,
      };
    });
    if (recipients.some(r => r.amount <= 0)) return toast.error("All amounts must be positive");
    createMutation.mutate({ name: batchName.trim(), currency, recipients });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Batch Payments</h1>
            <p className="text-purple-300 text-sm mt-1">Manage bulk payment batches with partial failure handling</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-2" /> New Batch
          </Button>
        </div>

        {listLoading ? (
          <div className="text-purple-300">Loading batches...</div>
        ) : (
          <div className="grid gap-3">
            {batches.map((batch: any) => (
              <Card key={batch.id} className="bg-purple-900/20 border-purple-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{batch.name}</span>
                        <Badge className={`text-xs ${STATUS_COLORS[batch.status] ?? "bg-purple-900/40 text-purple-300"}`}>
                          {batch.status}
                        </Badge>
                      </div>
                      <div className="flex gap-4 mt-1 text-sm text-purple-400">
                        <span>{batch.totalRecipients ?? 0} recipients</span>
                        <span>{batch.currency} {Number(batch.totalAmount ?? 0).toFixed(2)}</span>
                        <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedBatchId(batch.id)}
                        className="text-purple-300 hover:text-white"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {batch.status === "draft" && (
                        <Button
                          size="sm"
                          onClick={() => processMutation.mutate({ batchId: Number(batch.id) })}
                          disabled={processMutation.isPending}
                          className="bg-green-700 hover:bg-green-600 text-white"
                        >
                          <Play className="w-4 h-4 mr-1" /> Process
                        </Button>
                      )}
                      {(batch.status === "partial" || batch.status === "failed") && (
                        <Button
                          size="sm"
                          onClick={() => retryMutation.mutate({ batchId: Number(batch.id) })}
                          disabled={retryMutation.isPending}
                          className="bg-orange-700 hover:bg-orange-600 text-white"
                        >
                          <RotateCcw className="w-4 h-4 mr-1" /> Retry Failed
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {batches.length === 0 && (
              <div className="text-center py-12 text-purple-400">No batches yet. Create one to send bulk payments.</div>
            )}
          </div>
        )}

        {/* Batch Detail Dialog */}
        <Dialog open={selectedBatchId !== null} onOpenChange={(v) => { if (!v) setSelectedBatchId(null); }}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Batch Details</DialogTitle>
            </DialogHeader>
            {batchDetail && (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {((batchDetail as any)?.items ?? []).map((item: any, i: number) => (
                  <div key={item.id ?? i} className="flex items-center justify-between p-2 rounded bg-purple-900/20">
                    <div>
                      <span className="text-white text-sm">{item.recipientName}</span>
                      {item.recipientAccount && <span className="text-purple-400 text-xs ml-2">{item.recipientAccount}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm">{(batchDetail as any).currency} {Number(item.amount).toFixed(2)}</span>
                      <Badge className={`text-xs ${STATUS_COLORS[item.status] ?? "bg-purple-900/40 text-purple-300"}`}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedBatchId(null)} className="border-purple-800 text-purple-300">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Batch Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-purple-300">Batch Name *</Label>
                  <Input
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="Payroll March 2026"
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-300">Currency</Label>
                  <Input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    placeholder="USD"
                    maxLength={3}
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-purple-300">Recipients (one per line: Name, Account, Amount, Country)</Label>
                <textarea
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  placeholder={"John Doe, ACC123456, 500, NG\nJane Smith, ACC789012, 750, GH"}
                  rows={6}
                  className="w-full rounded-md border border-purple-800 bg-purple-900/20 text-white text-sm p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-purple-600"
                />
                <p className="text-xs text-purple-500">Format: Name, Account (optional), Amount, Country (optional)</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-purple-800 text-purple-300">Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-purple-600 hover:bg-purple-700">
                {createMutation.isPending ? "Creating..." : "Create Batch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
