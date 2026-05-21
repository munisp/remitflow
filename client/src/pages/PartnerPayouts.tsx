import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DollarSign, Clock, CheckCircle, XCircle, Plus, RefreshCw, TrendingUp } from "lucide-react";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function PartnerPayouts() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  const [form, setForm] = useState({
    tenantId: "",
    amount: "",
    currency: "USD",
    method: "bank_transfer" as const,
    periodStart: "",
    periodEnd: "",
    feeRevenue: "",
    revenueShare: "0.3",
    notes: "",
  });

  const { data: summary } = trpc.partnerPayouts.summary.useQuery();
  const { data: tenantsData } = trpc.tenants.list.useQuery({ limit: 100, offset: 0 });
  const { data: payoutsData, isLoading } = trpc.partnerPayouts.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as any,
    limit: LIMIT,
    offset,
  });

  const createMutation = trpc.partnerPayouts.create.useMutation({
    onSuccess: () => {
      toast.success("Payout created successfully");
      utils.partnerPayouts.list.invalidate();
      utils.partnerPayouts.summary.invalidate();
      setCreateOpen(false);
      setForm({ tenantId: "", amount: "", currency: "USD", method: "bank_transfer", periodStart: "", periodEnd: "", feeRevenue: "", revenueShare: "0.3", notes: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = trpc.partnerPayouts.approve.useMutation({
    onSuccess: () => { toast.success("Payout approved"); utils.partnerPayouts.list.invalidate(); utils.partnerPayouts.summary.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const completeMutation = trpc.partnerPayouts.complete.useMutation({
    onSuccess: () => { toast.success("Payout marked as completed"); utils.partnerPayouts.list.invalidate(); utils.partnerPayouts.summary.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = trpc.partnerPayouts.cancel.useMutation({
    onSuccess: () => { toast.success("Payout cancelled"); utils.partnerPayouts.list.invalidate(); utils.partnerPayouts.summary.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Admin access required to view partner payouts.
        </div>
      </DashboardLayout>
    );
  }

  const handleCreate = () => {
    if (!form.tenantId || !form.amount || !form.periodStart || !form.periodEnd) {
      toast.error("Please fill in all required fields");
      return;
    }
    createMutation.mutate({
      tenantId: Number(form.tenantId),
      amount: Number(form.amount),
      currency: form.currency,
      method: form.method,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      feeRevenue: Number(form.feeRevenue) || 0,
      revenueShare: Number(form.revenueShare) || 0.3,
      notes: form.notes || undefined,
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Partner Payouts</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage revenue-share disbursements to partners</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> New Payout</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Partner Payout</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Partner / Tenant *</Label>
                  <Select value={form.tenantId} onValueChange={v => setForm(f => ({ ...f, tenantId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                    <SelectContent>
                      {tenantsData?.tenants?.map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount *</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["USD", "EUR", "GBP", "NGN", "KES", "GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="paypal">PayPal</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Period Start *</Label>
                    <Input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Period End *</Label>
                    <Input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Fee Revenue ($)</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.feeRevenue} onChange={e => setForm(f => ({ ...f, feeRevenue: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Revenue Share (0–1)</Label>
                    <Input type="number" min="0" max="1" step="0.01" placeholder="0.30" value={form.revenueShare} onChange={e => setForm(f => ({ ...f, revenueShare: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea placeholder="Optional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                </div>
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? "Creating..." : "Create Payout"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Pending Count", value: summary?.pendingCount ?? 0, icon: Clock, color: "text-yellow-400" },
            { label: "Pending Amount", value: `$${(summary?.pendingAmount ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-orange-400" },
            { label: "Completed", value: summary?.completedCount ?? 0, icon: CheckCircle, color: "text-green-400" },
            { label: "Total Paid Out", value: `$${(summary?.totalPaid ?? 0).toLocaleString()}`, icon: TrendingUp, color: "text-blue-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`w-8 h-8 ${color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold text-foreground">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground">Filter by status:</Label>
          {["all", "pending", "processing", "completed", "failed", "cancelled"].map(s => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm"
              onClick={() => { setStatusFilter(s); setOffset(0); }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        {/* Payouts Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              Payout Records
              <Button variant="ghost" size="sm" onClick={() => utils.partnerPayouts.list.invalidate()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />)}
              </div>
            ) : (payoutsData?.payouts?.length ?? 0) === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No payouts found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4">Reference</th>
                      <th className="text-left py-2 pr-4">Partner</th>
                      <th className="text-right py-2 pr-4">Amount</th>
                      <th className="text-left py-2 pr-4">Method</th>
                      <th className="text-left py-2 pr-4">Period</th>
                      <th className="text-left py-2 pr-4">Status</th>
                      <th className="text-right py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutsData?.payouts?.map((p: any) => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{p.reference}</td>
                        <td className="py-3 pr-4 font-medium">{p.tenantName ?? `Tenant #${p.tenantId}`}</td>
                        <td className="py-3 pr-4 text-right font-semibold">
                          {Number(p.amount).toLocaleString()} {p.currency}
                        </td>
                        <td className="py-3 pr-4 capitalize text-muted-foreground">{p.method.replace("_", " ")}</td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground">
                          {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[p.status]}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {p.status === "pending" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10"
                                onClick={() => approveMutation.mutate({ id: p.id })}>
                                Approve
                              </Button>
                            )}
                            {p.status === "processing" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                                onClick={() => completeMutation.mutate({ id: p.id })}>
                                Complete
                              </Button>
                            )}
                            {["pending", "processing"].includes(p.status) && (
                              <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                                onClick={() => cancelMutation.mutate({ id: p.id })}>
                                Cancel
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>Showing {offset + 1}–{Math.min(offset + LIMIT, payoutsData?.total ?? 0)} of {payoutsData?.total ?? 0}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={offset + LIMIT >= (payoutsData?.total ?? 0)} onClick={() => setOffset(offset + LIMIT)}>Next</Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
