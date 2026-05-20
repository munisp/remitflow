// @middleware-audit-patch v1
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Plus, Pause, Play, Trash2, Calendar, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslation } from 'react-i18next';
interface DirectDebitMandate {
  id: number;
  creditor: string;
  creditor_account?: string;
  amount: number;
  currency: string;
  frequency: string;
  status: string;
  next_debit_date?: string;
  mandate_ref?: string;
  created_at?: string;
  merchantName?: string;
  accountNumber?: string;
  bankCode?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}



export default function DirectDebit() {
  const { t } = useTranslation();
  const { data: mandatesRaw = [], refetch, isLoading } = trpc.directDebit.mandates.useQuery();
  const mandates = mandatesRaw as DirectDebitMandate[];
  const createMutation = trpc.directDebit.create.useMutation({
    onSuccess: () => { toast.success("Direct debit mandate created"); refetch(); setOpen(false); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancelMutation = trpc.directDebit.cancel.useMutation({
    onSuccess: () => { toast.success("Mandate cancelled"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const pauseMutation = trpc.directDebit.pause.useMutation({
    onSuccess: () => { toast.success("Mandate paused"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const resumeMutation = trpc.directDebit.resume.useMutation({
    onSuccess: () => { toast.success("Mandate resumed"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ merchantName: "", amount: "", currency: "NGN", frequency: "monthly", accountNumber: "", bankCode: "", startDate: "", endDate: "", description: "" });
  const resetForm = () => setForm({ merchantName: "", amount: "", currency: "NGN", frequency: "monthly", accountNumber: "", bankCode: "", startDate: "", endDate: "", description: "" });

  const mandateList: DirectDebitMandate[] = Array.isArray(mandates) ? mandates : [];

  const statusColor = (s: string) => ({
    active: "bg-green-100 text-green-800",
    paused: "bg-yellow-100 text-yellow-800",
    cancelled: "bg-red-100 text-red-800",
    pending: "bg-blue-100 text-blue-800",
  }[s] ?? "bg-gray-100 text-gray-800");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Direct Debit Mandates</h1>
            <p className="text-muted-foreground">Manage recurring payment authorizations</p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Mandate
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {["active", "paused", "pending", "cancelled"].map(s => (
            <Card key={s}>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground capitalize">{s}</p>
                <p className="text-2xl font-bold">{mandateList.filter((m) => m.status === s).length}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Mandates List */}
        <div className="space-y-3">
          {isLoading && <p className="text-muted-foreground text-center py-8">Loading mandates...</p>}
          {!isLoading && mandateList.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <CreditCard className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No direct debit mandates</p>
                <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>Create your first mandate</Button>
              </CardContent>
            </Card>
          )}
          {(mandateList as Array<{id: number; merchantName?: string; creditor?: string; status: string; frequency: string; description?: string; nextDebitDate?: string; currency: string; amount: number | string}>).map((m) => (
            <Card key={m.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{m.merchantName}</span>
                      <Badge className={`text-xs ${statusColor(m.status)}`}>{m.status}</Badge>
                      <Badge variant="outline" className="text-xs capitalize">{m.frequency}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{m.description}</p>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Next: {m.nextDebitDate ? format(new Date(m.nextDebitDate), "MMM d, yyyy") : "—"}</span>
                      <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3" /> {m.frequency}</span>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-semibold text-lg">{m.currency} {Number(m.amount).toLocaleString()}</p>
                    <div className="flex gap-1 mt-2 justify-end">
                      {m.status === "active" && (
                        <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate({ mandateId: m.id })}>
                          <Pause className="w-3 h-3" />
                        </Button>
                      )}
                      {m.status === "paused" && (
                        <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate({ mandateId: m.id })}>
                          <Play className="w-3 h-3" />
                        </Button>
                      )}
                      {m.status !== "cancelled" && (
                        <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => cancelMutation.mutate({ mandateId: m.id })}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Create Mandate Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Direct Debit Mandate</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Merchant Name *</Label>
                  <Input placeholder="e.g. Netflix, DSTV" value={form.merchantName} onChange={e => setForm(f => ({ ...f, merchantName: e.target.value }))} />
                </div>
                <div>
                  <Label>Amount *</Label>
                  <Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["NGN","GHS","KES","ZAR","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Account Number *</Label>
                  <Input placeholder="0123456789" value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
                </div>
                <div>
                  <Label>Bank Code *</Label>
                  <Input placeholder="058 (GTBank)" value={form.bankCode} onChange={e => setForm(f => ({ ...f, bankCode: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <Label>End Date (optional)</Label>
                  <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Input placeholder="Purpose of mandate" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
                <Button
                  disabled={!form.merchantName || !form.amount || !form.accountNumber || !form.bankCode || createMutation.isPending}
                  onClick={() => createMutation.mutate({ creditor: form.merchantName, amount: parseFloat(form.amount), currency: form.currency, frequency: form.frequency as any, creditorAccount: form.accountNumber, startDate: form.startDate || undefined })}
                >
                  {createMutation.isPending ? "Creating..." : "Create Mandate"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

