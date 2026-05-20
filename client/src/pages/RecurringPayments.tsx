import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  RefreshCw, Plus, Pause, Play, XCircle, Calendar, Clock,
  DollarSign, TrendingUp, CheckCircle, AlertCircle, History,
  ChevronDown, ChevronUp
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-red-100 text-red-800",
  completed: "bg-blue-100 text-blue-800",
};

const EXEC_STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-yellow-100 text-yellow-800",
  skipped: "bg-gray-100 text-gray-800",
};

const FREQ_LABELS: Record<string, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly",
};

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR", "XOF", "EGP"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function RecurringPayments() {
  const { t } = useTranslation();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const [form, setForm] = useState({
    recipientName: "", recipientAccount: "", recipientBank: "",
    amount: "", currency: "NGN", frequency: "monthly" as "daily" | "weekly" | "monthly" | "quarterly",
    startDate: new Date().toISOString().slice(0, 10), endDate: "",
    description: "", dayOfWeek: "1", dayOfMonth: "1",
  });

  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.scheduler.list.useQuery();

  const createMutation = trpc.scheduler.create.useMutation({
    onSuccess: () => { toast.success("Recurring payment created"); utils.scheduler.list.invalidate(); setCreateOpen(false); resetForm(); },
    onError: (err) => toast.error(err.message),
  });
  const pauseMutation = trpc.scheduler.pause.useMutation({
    onSuccess: () => { toast.success("Payment paused"); utils.scheduler.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const resumeMutation = trpc.scheduler.resume.useMutation({
    onSuccess: () => { toast.success("Payment resumed"); utils.scheduler.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const cancelMutation = trpc.scheduler.cancel.useMutation({
    onSuccess: () => { toast.success("Payment cancelled"); utils.scheduler.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const { data: executions } = trpc.scheduler.executions.useQuery(
    { paymentId: expandedId! }, { enabled: expandedId !== null }
  );

  const resetForm = () => setForm({
    recipientName: "", recipientAccount: "", recipientBank: "",
    amount: "", currency: "NGN", frequency: "monthly",
    startDate: new Date().toISOString().slice(0, 10), endDate: "",
    description: "", dayOfWeek: "1", dayOfMonth: "1",
  });

  const handleCreate = () => {
    if (!form.recipientName || !form.recipientAccount || !form.recipientBank || !form.amount) {
      toast.error("Please fill in all required fields"); return;
    }
    createMutation.mutate({
      recipientName: form.recipientName, recipientAccount: form.recipientAccount,
      recipientBank: form.recipientBank, amount: Number(form.amount), currency: form.currency,
      frequency: form.frequency, startDate: form.startDate,
      endDate: form.endDate || undefined, description: form.description || undefined,
      dayOfWeek: form.frequency === "weekly" ? Number(form.dayOfWeek) : undefined,
      dayOfMonth: form.frequency === "monthly" ? Number(form.dayOfMonth) : undefined,
    });
  };

  const payments = data?.payments ?? [];
  const allExecutions = data?.executions ?? [];
  const filteredPayments = payments.filter((p: any) => {
    if (activeTab === "active") return p.status === "active";
    if (activeTab === "paused") return p.status === "paused";
    if (activeTab === "cancelled") return p.status === "cancelled";
    return true;
  });
  const totalActiveAmount = payments.filter((p: any) => p.status === "active").reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const successRate = allExecutions.length > 0 ? Math.round((allExecutions.filter((e: any) => e.status === "success").length / allExecutions.length) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="h-7 w-7 text-blue-500" /> Recurring Payments
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Schedule and manage automated recurring transfers</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Schedule</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Schedules</p>
                  <p className="text-2xl font-bold mt-1 text-green-600">{payments.filter((p: any) => p.status === "active").length}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Volume</p>
                  <p className="text-2xl font-bold mt-1">{totalActiveAmount.toLocaleString()}</p>
                </div>
                <DollarSign className="h-8 w-8 text-blue-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Success Rate</p>
                  <p className="text-2xl font-bold mt-1 text-purple-600">{successRate}%</p>
                </div>
                <CheckCircle className="h-8 w-8 text-purple-400 opacity-80" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="active">Active ({payments.filter((p: any) => p.status === "active").length})</TabsTrigger>
                <TabsTrigger value="paused">Paused ({payments.filter((p: any) => p.status === "paused").length})</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled ({payments.filter((p: any) => p.status === "cancelled").length})</TabsTrigger>
                <TabsTrigger value="all">All ({payments.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading schedules...</div>
            ) : filteredPayments.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-medium">No {activeTab !== "all" ? activeTab : ""} schedules</p>
                <p className="text-sm">Create a new recurring payment to get started</p>
                <Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Create Schedule</Button>
              </div>
            ) : (
              <div className="divide-y">
                {filteredPayments.map((payment: any) => (
                  <div key={payment.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm">{payment.recipient_name}</h3>
                          <Badge className={`text-xs ${STATUS_COLORS[payment.status] ?? ""}`}>{payment.status}</Badge>
                          <Badge variant="outline" className="text-xs">{FREQ_LABELS[payment.frequency] ?? payment.frequency}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{payment.recipient_bank} · {payment.recipient_account}</p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{Number(payment.amount).toLocaleString()} {payment.currency}</span>
                          {payment.next_run && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Next: {new Date(payment.next_run).toLocaleDateString()}</span>}
                          {payment.description && <span className="truncate max-w-[200px]">{payment.description}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {payment.status === "active" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                            onClick={() => pauseMutation.mutate({ id: payment.id })} disabled={pauseMutation.isPending}>
                            <Pause className="h-3 w-3 mr-1" /> Pause
                          </Button>
                        )}
                        {payment.status === "paused" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-green-700 border-green-300"
                            onClick={() => resumeMutation.mutate({ id: payment.id })} disabled={resumeMutation.isPending}>
                            <Play className="h-3 w-3 mr-1" /> Resume
                          </Button>
                        )}
                        {payment.status !== "cancelled" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700 border-red-300"
                            onClick={() => { if (confirm("Cancel this recurring payment?")) cancelMutation.mutate({ id: payment.id }); }}
                            disabled={cancelMutation.isPending}>
                            <XCircle className="h-3 w-3 mr-1" /> Cancel
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => setExpandedId(expandedId === payment.id ? null : payment.id)}>
                          <History className="h-3 w-3 mr-1" />
                          {expandedId === payment.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                    {expandedId === payment.id && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Execution History</p>
                        {!executions || executions.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No executions yet</p>
                        ) : (
                          <div className="space-y-1">
                            {executions.slice(0, 10).map((exec: any) => (
                              <div key={exec.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/50">
                                <div className="flex items-center gap-2">
                                  {exec.status === "success" ? <CheckCircle className="h-3 w-3 text-green-500" /> : <AlertCircle className="h-3 w-3 text-red-500" />}
                                  <span>{new Date(exec.executed_at).toLocaleDateString()}</span>
                                  {exec.error_message && <span className="text-red-500">{exec.error_message}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{Number(exec.amount).toLocaleString()} {exec.currency}</span>
                                  <Badge className={`text-xs ${EXEC_STATUS_COLORS[exec.status] ?? ""}`}>{exec.status}</Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {allExecutions.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4" /> Recent Executions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allExecutions.slice(0, 5).map((exec: any) => (
                    <TableRow key={exec.id}>
                      <TableCell className="text-sm">{new Date(exec.executed_at).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium text-sm">{Number(exec.amount).toLocaleString()} {exec.currency}</TableCell>
                      <TableCell><Badge className={`text-xs ${EXEC_STATUS_COLORS[exec.status] ?? ""}`}>{exec.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{exec.error_message ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New Recurring Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Recipient Name *</Label>
                  <Input placeholder="John Doe" value={form.recipientName}
                    onChange={(e) => setForm(f => ({ ...f, recipientName: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Account Number *</Label>
                  <Input placeholder="0123456789" value={form.recipientAccount}
                    onChange={(e) => setForm(f => ({ ...f, recipientAccount: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Bank Name *</Label>
                  <Input placeholder="First Bank" value={form.recipientBank}
                    onChange={(e) => setForm(f => ({ ...f, recipientBank: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Amount *</Label>
                  <Input type="number" placeholder="5000" value={form.amount}
                    onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={(v) => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={form.frequency} onValueChange={(v) => setForm(f => ({ ...f, frequency: v as any }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.frequency === "weekly" && (
                  <div>
                    <Label>Day of Week</Label>
                    <Select value={form.dayOfWeek} onValueChange={(v) => setForm(f => ({ ...f, dayOfWeek: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {form.frequency === "monthly" && (
                  <div>
                    <Label>Day of Month</Label>
                    <Select value={form.dayOfMonth} onValueChange={(v) => setForm(f => ({ ...f, dayOfMonth: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{Array.from({ length: 28 }, (_, i) => i + 1).map(d => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label>Start Date *</Label>
                  <Input type="date" value={form.startDate}
                    onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>End Date (optional)</Label>
                  <Input type="date" value={form.endDate}
                    onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className="mt-1" />
                </div>
                <div className="col-span-2">
                  <Label>Description (optional)</Label>
                  <Input placeholder="Monthly rent payment" value={form.description}
                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
