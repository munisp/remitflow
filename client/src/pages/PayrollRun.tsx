// PayrollRun — Global Payroll run management page
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Users, DollarSign, Play, CheckCircle, Plus } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  disbursing: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

type FrequencyType = "weekly" | "monthly" | "bi_weekly" | "semi_monthly";

interface PayrollFormState {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  frequency: FrequencyType;
}

export default function PayrollRun() {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<PayrollFormState>({
    companyId: "",
    periodStart: "",
    periodEnd: "",
    payDate: "",
    frequency: "monthly",
  });

  const utils = trpc.useUtils();
  const { data: companies } = trpc.globalPayroll.listCompanies.useQuery();
  const selectedCompanyId = form.companyId
    ? Number(form.companyId)
    : (companies as any[])?.[0]?.id;

  const { data: runs, isLoading } = trpc.globalPayroll.listRuns.useQuery(
    { companyId: selectedCompanyId ?? 0 },
    { enabled: !!selectedCompanyId }
  );
  const { data: stats } = trpc.globalPayroll.getCompanyStats.useQuery(
    { companyId: selectedCompanyId ?? 0 },
    { enabled: !!selectedCompanyId }
  );

  const createRun = trpc.globalPayroll.createRun.useMutation({
    onSuccess: () => {
      toast("Payroll run created", { description: "Review and approve the run before disbursing." });
      utils.globalPayroll.listRuns.invalidate();
      setCreateOpen(false);
      setForm({ companyId: "", periodStart: "", periodEnd: "", payDate: "", frequency: "monthly" });
    },
    onError: (e) => toast.error("Failed", { description: e.message }),
  });

  const approveRun = trpc.globalPayroll.approveRun.useMutation({
    onSuccess: () => {
      toast("Payroll run approved");
      utils.globalPayroll.listRuns.invalidate();
    },
    onError: (e) => toast.error("Failed", { description: e.message }),
  });

  const disburseRun = trpc.globalPayroll.disburseRun.useMutation({
    onSuccess: () => {
      toast("Payroll disbursement initiated", { description: "Payments are being processed." });
      utils.globalPayroll.listRuns.invalidate();
    },
    onError: (e) => toast.error("Failed", { description: e.message }),
  });

  const companyList = (companies as any[]) ?? [];
  const runList = (runs as any[]) ?? [];
  const statsData = stats as any;

  function handleCreateRun() {
    const cid = selectedCompanyId ?? Number(form.companyId);
    if (!cid) return;
    const input: {
      companyId: number;
      periodStart: string;
      periodEnd: string;
      payDate: string;
      frequency: FrequencyType;
    } = {
      companyId: cid,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      payDate: form.payDate,
      frequency: form.frequency,
    };
    createRun.mutate(input);
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll Run</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage payroll cycles — create, approve, and disburse employee payments
          </p>
        </div>
        <div className="flex gap-2">
          {companyList.length > 1 && (
            <Select
              value={form.companyId}
              onValueChange={(v) => setForm((f) => ({ ...f, companyId: v }))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companyList.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button disabled={!selectedCompanyId}>
                <Plus className="w-4 h-4 mr-2" />
                New Payroll Run
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create Payroll Run</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                {companyList.length > 1 && (
                  <div>
                    <Label className="text-xs">Company</Label>
                    <Select
                      value={form.companyId}
                      onValueChange={(v) => setForm((f) => ({ ...f, companyId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select company" />
                      </SelectTrigger>
                      <SelectContent>
                        {companyList.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Period Start</Label>
                  <Input
                    type="date"
                    value={form.periodStart}
                    onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Period End</Label>
                  <Input
                    type="date"
                    value={form.periodEnd}
                    onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Pay Date</Label>
                  <Input
                    type="date"
                    value={form.payDate}
                    onChange={(e) => setForm((f) => ({ ...f, payDate: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <Select
                    value={form.frequency}
                    onValueChange={(v: FrequencyType) =>
                      setForm((f) => ({ ...f, frequency: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="bi_weekly">Bi-Weekly</SelectItem>
                      <SelectItem value="semi_monthly">Semi-Monthly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="w-full mt-4"
                onClick={handleCreateRun}
                disabled={
                  createRun.isPending ||
                  !form.periodStart ||
                  !form.periodEnd ||
                  !form.payDate ||
                  !(selectedCompanyId ?? Number(form.companyId))
                }
              >
                {createRun.isPending ? "Creating..." : "Create Payroll Run"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Employees", value: String(statsData.totalEmployees ?? 0), icon: Users, color: "text-blue-600" },
            { label: "Monthly Payroll", value: `$${Number(statsData.monthlyPayroll ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
            { label: "Total Runs", value: String(statsData.totalRuns ?? 0), icon: Briefcase, color: "text-purple-600" },
            { label: "Completed Runs", value: String(statsData.completedRuns ?? 0), icon: CheckCircle, color: "text-emerald-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Icon className={`w-5 h-5 ${color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Payroll Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payroll Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedCompanyId ? (
            <div className="text-center py-10 text-muted-foreground">
              <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No company set up yet. Create a company in Global Payroll first.</p>
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : !runList.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <Play className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No payroll runs yet. Create your first run to get started.</p>
            </div>
          ) : (
            <div className="divide-y">
              {runList.map((run: any) => (
                <div key={run.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {run.periodStart ? new Date(run.periodStart).toLocaleDateString() : "—"} —{" "}
                      {run.periodEnd ? new Date(run.periodEnd).toLocaleDateString() : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pay date: {run.payDate ? new Date(run.payDate).toLocaleDateString() : "—"} ·{" "}
                      {run.employeeCount ?? 0} employees
                    </p>
                  </div>
                  <p className="font-semibold text-sm">
                    ${Number(run.totalGross ?? 0).toLocaleString()}
                  </p>
                  <Badge className={`text-xs ${STATUS_COLORS[run.status] ?? ""}`}>
                    {run.status?.replace(/_/g, " ")}
                  </Badge>
                  <div className="flex gap-1">
                    {run.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => approveRun.mutate({ runId: run.id })}
                        disabled={approveRun.isPending}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Approve
                      </Button>
                    )}
                    {run.status === "approved" && (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => disburseRun.mutate({ runId: run.id })}
                        disabled={disburseRun.isPending}
                      >
                        <Play className="w-3 h-3 mr-1" />
                        Disburse
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
