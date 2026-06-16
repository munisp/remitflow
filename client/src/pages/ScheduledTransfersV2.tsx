import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Clock, Play, Pause, Trash2, Calendar, RefreshCw, Tag, CalendarClock } from "lucide-react";
import { useTranslation } from 'react-i18next';

const FREQUENCIES = ["once", "daily", "weekly", "monthly"] as const;
const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "UGX", "TZS"];

export default function ScheduledTransfersV2() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    beneficiaryId: "",
    amount: "",
    fromCurrency: "USD",
    toCurrency: "NGN",
    frequency: "monthly" as typeof FREQUENCIES[number],
    startDate: new Date().toISOString().split("T")[0],
    description: "",
    promoCode: "",
  });

  const { data, isLoading } = trpc.scheduledTransfersV2.list.useQuery();
  const { data: promoResult } = trpc.promoValidate.validate.useQuery(
    { code: form.promoCode, amount: Number(form.amount) || 100, fromCurrency: form.fromCurrency },
    { enabled: !!(form.promoCode && form.promoCode.length >= 3) }
  );

  const createMutation = trpc.scheduledTransfersV2.create.useMutation({
    onSuccess: () => {
      toast.success("Scheduled transfer created");
      utils.scheduledTransfersV2.list.invalidate();
      setCreateOpen(false);
      setForm({ beneficiaryId: "", amount: "", fromCurrency: "USD", toCurrency: "NGN", frequency: "monthly", startDate: new Date().toISOString().split("T")[0], description: "", promoCode: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const pauseMutation = trpc.scheduledTransfersV2.pause.useMutation({
    onSuccess: () => { toast.success("Transfer paused"); utils.scheduledTransfersV2.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const resumeMutation = trpc.scheduledTransfersV2.resume.useMutation({
    onSuccess: () => { toast.success("Transfer resumed"); utils.scheduledTransfersV2.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = trpc.scheduledTransfersV2.cancel.useMutation({
    onSuccess: () => { toast.success("Transfer cancelled"); utils.scheduledTransfersV2.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.amount) { toast.error("Amount is required"); return; }
    createMutation.mutate({
      beneficiaryId: form.beneficiaryId ? Number(form.beneficiaryId) : undefined,
      amount: Number(form.amount),
      fromCurrency: form.fromCurrency,
      toCurrency: form.toCurrency,
      frequency: form.frequency,
      startDate: form.startDate,
      description: form.description || undefined,
      promoCode: form.promoCode || undefined,
    });
  };

  const statusColor: Record<string, string> = {
    active: "bg-green-500",
    paused: "bg-yellow-500",
    completed: "bg-blue-500",
    cancelled: "bg-red-500",
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-primary" />
              Scheduled Transfers
            </h1>
            <p className="text-muted-foreground">Automate recurring international transfers with promo codes</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Schedule Transfer
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active", count: (data ?? []).filter((t: any) => t.status === "active").length, color: "text-green-500" },
            { label: "Paused", count: (data ?? []).filter((t: any) => t.status === "paused").length, color: "text-yellow-500" },
            { label: "Completed", count: (data ?? []).filter((t: any) => t.status === "completed").length, color: "text-blue-500" },
            { label: "Total", count: (data ?? []).length, color: "text-primary" },
          ].map(({ label, count, color }) => (
            <Card key={label}>
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${color}`}>{count}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Promo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : !(data ?? []).length ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No scheduled transfers yet</TableCell></TableRow>
                ) : (data as any[]).map(t => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">{t.fromCurrency} → {t.toCurrency}</div>
                      {t.beneficiaryName && <div className="text-xs text-muted-foreground">To: {t.beneficiaryName}</div>}
                      {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                    </TableCell>
                    <TableCell className="font-semibold">{Number(t.amount).toFixed(2)} {t.fromCurrency}</TableCell>
                    <TableCell className="capitalize">
                      <div className="flex items-center gap-1">
                        <RefreshCw className="h-3 w-3 text-muted-foreground" />
                        {t.frequency}
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.nextRunAt ? (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {new Date(t.nextRunAt).toLocaleDateString()}
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {t.promoCode ? (
                        <Badge variant="outline" className="gap-1 text-green-600 border-green-500">
                          <Tag className="h-3 w-3" />{t.promoCode}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${statusColor[t.status] ?? "bg-gray-500"} text-white capitalize`}>{t.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {t.status === "active" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => pauseMutation.mutate({ id: t.id })} title="Pause">
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {t.status === "paused" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => resumeMutation.mutate({ id: t.id })} title="Resume">
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {t.status !== "cancelled" && t.status !== "completed" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Cancel this scheduled transfer?")) cancelMutation.mutate({ id: t.id }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Schedule a Transfer</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Amount *</Label>
                  <Input type="number" placeholder="100.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>From Currency</Label>
                  <Select value={form.fromCurrency} onValueChange={v => setForm(f => ({ ...f, fromCurrency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>To Currency</Label>
                  <Select value={form.toCurrency} onValueChange={v => setForm(f => ({ ...f, toCurrency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v as typeof FREQUENCIES[number] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FREQUENCIES.map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Start Date *</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input placeholder="Monthly rent payment" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <Label>Promo Code (optional)</Label>
                <Input placeholder="SAVE20" value={form.promoCode} onChange={e => setForm(f => ({ ...f, promoCode: e.target.value.toUpperCase() }))} className="font-mono" />
                {promoResult && (
                  <div className={`mt-1 text-sm flex items-center gap-1 ${promoResult.valid ? "text-green-600" : "text-red-500"}`}>
                    {promoResult.valid ? <><Tag className="h-3.5 w-3.5" /> Valid promo code</> : <>{promoResult.message}</>}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                <Clock className="h-4 w-4 mr-2" />
                {createMutation.isPending ? "Creating..." : "Schedule Transfer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
