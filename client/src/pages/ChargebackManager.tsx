import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Plus, AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

type ReasonType = "unauthorized_transaction" | "goods_not_received" | "duplicate_charge" | "wrong_amount" | "subscription_cancelled" | "other";

const REASONS: { value: ReasonType; label: string }[] = [
  { value: "unauthorized_transaction", label: "Unauthorized Transaction" },
  { value: "goods_not_received", label: "Goods/Service Not Received" },
  { value: "duplicate_charge", label: "Duplicate Charge" },
  { value: "wrong_amount", label: "Wrong Amount Charged" },
  { value: "subscription_cancelled", label: "Subscription Already Cancelled" },
  { value: "other", label: "Other" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  submitted: { label: "Submitted", color: "bg-blue-500/20 text-blue-400" },
  under_review: { label: "Under Review", color: "bg-yellow-500/20 text-yellow-400" },
  resolved: { label: "Resolved", color: "bg-green-500/20 text-green-400" },
  rejected: { label: "Rejected", color: "bg-red-500/20 text-red-400" },
};

export default function ChargebackManager() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    transactionRef: "",
    reason: "unauthorized_transaction" as ReasonType,
    description: "",
    amount: "",
    currency: "USD",
    evidenceUrl: "",
  });

  const { data: chargebacks, isLoading } = trpc.chargebacks.list.useQuery();

  const raiseMutation = trpc.chargebacks.raise.useMutation({
    onSuccess: (data) => {
      utils.chargebacks.list.invalidate();
      setOpen(false);
      toast.success(`Dispute filed — Ref: ${data.chargebackRef}. Resolution in ${data.estimatedResolution}.`);
      setForm({ transactionRef: "", reason: "unauthorized_transaction", description: "", amount: "", currency: "USD", evidenceUrl: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const counts = {
    submitted: (chargebacks ?? []).filter((c: any) => c.status === "submitted").length,
    under_review: (chargebacks ?? []).filter((c: any) => c.status === "under_review").length,
    resolved: (chargebacks ?? []).filter((c: any) => c.status === "resolved").length,
    rejected: (chargebacks ?? []).filter((c: any) => c.status === "rejected").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-orange-400" /> Chargeback Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">File and track payment disputes and chargeback requests</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> File Dispute</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>File a Chargeback Dispute</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Transaction Reference</Label>
                <Input
                  value={form.transactionRef}
                  onChange={e => setForm(f => ({ ...f, transactionRef: e.target.value }))}
                  placeholder="TXN_20240115_001"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="250.00"
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["USD", "GBP", "EUR", "NGN", "KES"].map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v as ReasonType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description (min 20 characters)</Label>
                <Textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the issue in detail..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">{form.description.length}/1000</p>
              </div>
              <div>
                <Label>Evidence URL (optional)</Label>
                <Input
                  value={form.evidenceUrl}
                  onChange={e => setForm(f => ({ ...f, evidenceUrl: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
                <p>• Chargebacks are reviewed within 5-10 business days</p>
                <p>• You will receive email updates on status changes</p>
                <p>• Providing evidence increases resolution success rate</p>
              </div>
              <Button
                className="w-full"
                onClick={() => raiseMutation.mutate({
                  transactionRef: form.transactionRef,
                  amount: parseFloat(form.amount),
                  currency: form.currency,
                  reason: form.reason,
                  description: form.description,
                  evidenceUrl: form.evidenceUrl || undefined,
                })}
                disabled={!form.transactionRef || !form.amount || form.description.length < 20 || raiseMutation.isPending}
              >
                {raiseMutation.isPending ? "Submitting..." : "Submit Dispute"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(Object.entries(counts) as [string, number][]).map(([status, count]) => {
          const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-foreground" };
          return (
            <Card key={status} className="bg-card border-border">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{cfg.label}</p>
                <p className="text-2xl font-bold text-foreground">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Dispute History</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (chargebacks ?? []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No disputes filed</p>
              <p className="text-sm mt-1">If you believe a charge is incorrect, file a dispute above</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(chargebacks ?? []).map((c: any) => {
                const cfg = STATUS_CONFIG[c.status] ?? { label: c.status, color: "text-foreground" };
                const ref = c.transactionRef ?? c.transaction_ref;
                const createdAt = c.createdAt ?? c.created_at;
                return (
                  <DashboardLayout>
                  <div key={c.id} className="flex items-start justify-between p-4 rounded-lg border border-border bg-muted/10">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm text-foreground">{ref}</span>
                        <Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {REASONS.find(r => r.value === c.reason)?.label ?? c.reason}
                      </p>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>{c.currency} {Number(c.amount).toFixed(2)}</span>
                        <span>{new Date(createdAt).toLocaleDateString()}</span>
                        {c.resolution && (
                          <span className="text-green-400">
                            Resolution: {String(c.resolution).replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                
                  </DashboardLayout>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
