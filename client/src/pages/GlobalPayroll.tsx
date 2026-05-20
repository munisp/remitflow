import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Building2, Users, PlayCircle, CheckCircle2, DollarSign, Globe2,
  Plus, Send, Eye, XCircle, ChevronRight, TrendingUp, AlertTriangle,
  Download, Calendar, Briefcase, MapPin, CreditCard, FileText, RefreshCw
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

const JURISDICTIONS = [
  { code: "NG", name: "Nigeria", flag: "🇳🇬", currency: "NGN" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", currency: "GBP" },
  { code: "US", name: "United States", flag: "🇺🇸", currency: "USD" },
  { code: "CA", name: "Canada", flag: "🇨🇦", currency: "CAD" },
  { code: "DE", name: "Germany", flag: "🇩🇪", currency: "EUR" },
  { code: "AE", name: "UAE", flag: "🇦🇪", currency: "AED" },
  { code: "GH", name: "Ghana", flag: "🇬🇭", currency: "GHS" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", currency: "KES" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", currency: "ZAR" },
];

const RUN_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700", icon: <FileText className="w-3 h-3" /> },
  pending_approval: { label: "Pending Approval", color: "bg-yellow-100 text-yellow-700", icon: <AlertTriangle className="w-3 h-3" /> },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-700", icon: <CheckCircle2 className="w-3 h-3" /> },
  processing: { label: "Processing", color: "bg-purple-100 text-purple-700", icon: <RefreshCw className="w-3 h-3 animate-spin" /> },
  disbursed: { label: "Disbursed", color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700", icon: <XCircle className="w-3 h-3" /> },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">{icon}</div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaxPreviewBadge({ jurisdiction, grossSalary, currency }: { jurisdiction: string; grossSalary: number; currency: string }) {
  const { data, isLoading } = trpc.globalPayroll.getTaxPreview.useQuery(
    { grossSalary, salaryCurrency: currency, jurisdiction, employmentType: "full_time" },
    { enabled: grossSalary > 0 && !!jurisdiction, staleTime: 60_000 }
  );
  if (isLoading) return <span className="text-xs text-muted-foreground">Calculating...</span>;
  if (!data) return null;
  return (
    <div className="mt-2 p-3 rounded-lg bg-slate-50 border text-xs space-y-1">
      <div className="font-medium text-slate-700">Tax Preview ({jurisdiction})</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-600">
        <span>Gross:</span><span className="font-mono">{Number(data.gross_salary).toLocaleString()} {data.gross_currency}</span>
        <span>Income Tax:</span><span className="font-mono text-red-600">{Number(data.income_tax).toLocaleString()} {data.gross_currency}</span>
        <span>Pension:</span><span className="font-mono text-red-600">{Number(data.pension).toLocaleString()} {data.gross_currency}</span>
        <span>Net Pay:</span><span className="font-mono text-green-600 font-bold">{Number(data.net_pay).toLocaleString()} {data.gross_currency}</span>
        <span>Effective Rate:</span><span className="font-mono">{(Number(data.effective_tax_rate) * 100).toFixed(1)}%</span>
        <span>Net USD:</span><span className="font-mono">${Number(data.net_usd).toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Add Employee Dialog ───────────────────────────────────────────────────────

function AddEmployeeDialog({ companyId, onSuccess }: { companyId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employeeCode: "", firstName: "", lastName: "", email: "", phone: "",
    jobTitle: "", department: "", employmentType: "full_time",
    jurisdiction: "NG", country: "NG", grossSalary: "", salaryCurrency: "NGN",
    bankName: "", bankAccount: "", mobileMoneyNum: "", preferredChannel: "bank",
    taxCode: "", nationalId: "",
  });

  const addEmployee = trpc.globalPayroll.addEmployee.useMutation({
    onSuccess: () => {
      toast("Employee added", { description: `${form.firstName} ${form.lastName} has been added to payroll.` });
      setOpen(false);
      onSuccess();
    },
    onError: (e) => toast.error("Error"),
  });

  const selectedJur = JURISDICTIONS.find((j) => j.code === form.jurisdiction);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> Add Employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Employee to Global Payroll</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div><Label>Employee Code *</Label><Input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="EMP001" /></div>
          <div>
            <Label>Employment Type</Label>
            <Select value={form.employmentType} onValueChange={(v) => setForm({ ...form, employmentType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
                <SelectItem value="intern">Intern</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>First Name *</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
          <div><Label>Last Name *</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
          <div className="col-span-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Job Title</Label><Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div>
            <Label>Jurisdiction *</Label>
            <Select value={form.jurisdiction} onValueChange={(v) => {
              const jur = JURISDICTIONS.find((j) => j.code === v);
              setForm({ ...form, jurisdiction: v, country: v, salaryCurrency: jur?.currency ?? "USD" });
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {JURISDICTIONS.map((j) => (
                  <SelectItem key={j.code} value={j.code}>{j.flag} {j.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Gross Salary ({selectedJur?.currency}) *</Label>
            <Input type="number" value={form.grossSalary} onChange={(e) => setForm({ ...form, grossSalary: e.target.value, salaryCurrency: selectedJur?.currency ?? "USD" })} />
          </div>
          {form.grossSalary && Number(form.grossSalary) > 0 && (
            <div className="col-span-2">
              <TaxPreviewBadge jurisdiction={form.jurisdiction} grossSalary={Number(form.grossSalary)} currency={form.salaryCurrency} />
            </div>
          )}
          <div><Label>Bank Name</Label><Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
          <div><Label>Bank Account</Label><Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} /></div>
          <div><Label>Mobile Money Number</Label><Input value={form.mobileMoneyNum} onChange={(e) => setForm({ ...form, mobileMoneyNum: e.target.value })} placeholder="+2348012345678" /></div>
          <div>
            <Label>Preferred Payment Channel</Label>
            <Select value={form.preferredChannel} onValueChange={(v) => setForm({ ...form, preferredChannel: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">Bank Transfer</SelectItem>
                <SelectItem value="mobile_money">Mobile Money</SelectItem>
                <SelectItem value="wallet">RemitFlow Wallet</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Tax Code</Label><Input value={form.taxCode} onChange={(e) => setForm({ ...form, taxCode: e.target.value })} placeholder="e.g. 1257L (UK), W4 (US)" /></div>
          <div><Label>National ID / BVN / NIN</Label><Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={addEmployee.isPending}
            onClick={() => addEmployee.mutate({
              companyId,
              employeeCode: form.employeeCode,
              firstName: form.firstName,
              lastName: form.lastName,
              email: form.email,
              phone: form.phone || undefined,
              jobTitle: form.jobTitle || undefined,
              department: form.department || undefined,
              employmentType: form.employmentType as any,
              jurisdiction: form.jurisdiction as any,
              country: form.country,
              grossSalary: Number(form.grossSalary),
              salaryCurrency: form.salaryCurrency,
              bankName: form.bankName || undefined,
              bankAccount: form.bankAccount || undefined,
              mobileMoneyNum: form.mobileMoneyNum || undefined,
              preferredChannel: form.preferredChannel as any,
              taxCode: form.taxCode || undefined,
              nationalId: form.nationalId || undefined,
            })}
          >
            {addEmployee.isPending ? "Adding..." : "Add Employee"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Run Dialog ─────────────────────────────────────────────────────────

function CreateRunDialog({ companyId, onSuccess }: { companyId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split("T")[0];
  const payDay = new Date(today.getFullYear(), today.getMonth() + 1, 5).toISOString().split("T")[0];

  const [form, setForm] = useState({
    periodStart: firstDay, periodEnd: lastDay, payDate: payDay,
    frequency: "monthly" as "weekly" | "bi_weekly" | "semi_monthly" | "monthly", notes: "",
  });

  const createRun = trpc.globalPayroll.createRun.useMutation({
    onSuccess: (data) => {
      toast("Payroll run created", { description: `${data.itemCount} employees included. Total: $${Number(data.run.totalNetUsd).toLocaleString()} USD net.` });
      setOpen(false);
      onSuccess();
    },
    onError: (e) => toast.error("Error"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PlayCircle className="w-4 h-4 mr-1" /> New Payroll Run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Payroll Run</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Period Start</Label><Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></div>
            <div><Label>Period End</Label><Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Pay Date</Label><Input type="date" value={form.payDate} onChange={(e) => setForm({ ...form, payDate: e.target.value })} /></div>
            <div>
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as "weekly" | "bi_weekly" | "semi_monthly" | "monthly" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="bi_weekly">Bi-Weekly</SelectItem>
                  <SelectItem value="semi_monthly">Semi-Monthly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Notes (optional)</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. May 2026 payroll" /></div>
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
            <strong>All active employees</strong> will be included in this run. Tax calculations will be performed per jurisdiction via the payroll engine.
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={createRun.isPending}
            onClick={() => createRun.mutate({ companyId, ...form, frequency: form.frequency })}
          >
            {createRun.isPending ? "Calculating..." : "Create Run"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Run Detail Dialog ─────────────────────────────────────────────────────────

function RunDetailDialog({ runId, onRefresh }: { runId: number; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.globalPayroll.getRunDetail.useQuery({ runId }, { enabled: open });
  const approveRun = trpc.globalPayroll.approveRun.useMutation({
    onSuccess: () => { toast("Run approved"); onRefresh(); },
    onError: (e) => toast.error("Error"),
  });
  const disburseRun = trpc.globalPayroll.disburseRun.useMutation({
    onSuccess: (d) => { toast("Disbursed!", { description: `${d.itemsProcessed} employees paid.` }); onRefresh(); },
    onError: (e) => toast.error("Error"),
  });
  const cancelRun = trpc.globalPayroll.cancelRun.useMutation({
    onSuccess: () => { toast("Run cancelled"); onRefresh(); },
    onError: (e) => toast.error("Error"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Eye className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payroll Run Detail</DialogTitle>
        </DialogHeader>
        {isLoading && <div className="py-8 text-center text-muted-foreground">Loading...</div>}
        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 text-center">
                <div className="text-xs text-muted-foreground">Employees</div>
                <div className="text-xl font-bold">{data.run.employeeCount}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 text-center">
                <div className="text-xs text-muted-foreground">Gross (USD)</div>
                <div className="text-xl font-bold">${Number(data.run.totalGrossUsd).toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-lg bg-red-50 text-center">
                <div className="text-xs text-muted-foreground">Tax (USD)</div>
                <div className="text-xl font-bold text-red-600">${Number(data.run.totalTaxUsd).toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-lg bg-green-50 text-center">
                <div className="text-xs text-muted-foreground">Net Pay (USD)</div>
                <div className="text-xl font-bold text-green-600">${Number(data.run.totalNetUsd).toLocaleString()}</div>
              </div>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Employee</TableHead>
                    <TableHead>Jurisdiction</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                    <TableHead className="text-right">Net USD</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map(({ item, employee }) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{employee?.firstName} {employee?.lastName}</TableCell>
                      <TableCell>
                        {JURISDICTIONS.find((j) => j.code === employee?.jurisdiction)?.flag} {employee?.jurisdiction}
                      </TableCell>
                      <TableCell className="text-right font-mono">{Number(item.grossSalary).toLocaleString()} {item.grossCurrency}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{Number(item.totalDeductions).toLocaleString()} {item.grossCurrency}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{Number(item.netPay).toLocaleString()} {item.netCurrency}</TableCell>
                      <TableCell className="text-right font-mono">${Number(item.netUsd).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${item.status === "paid" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}`}>
                          {item.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2 justify-end">
              {data.run.status === "draft" && (
                <>
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => cancelRun.mutate({ runId })}>
                    <XCircle className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => approveRun.mutate({ runId })} disabled={approveRun.isPending}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Approve Run
                  </Button>
                </>
              )}
              {data.run.status === "approved" && (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => disburseRun.mutate({ runId })} disabled={disburseRun.isPending}>
                  <Send className="w-4 h-4 mr-1" /> {disburseRun.isPending ? "Disbursing..." : "Disburse Payroll"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GlobalPayroll() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newCompanyForm, setNewCompanyForm] = useState({ name: "", registrationNumber: "", taxId: "", country: "NG", baseCurrency: "USD" });
  const [activeTab, setActiveTab] = useState("employees");

  const { data: companies, refetch: refetchCompanies } = trpc.globalPayroll.listCompanies.useQuery();
  const { data: employees, refetch: refetchEmployees } = trpc.globalPayroll.listEmployees.useQuery(
    { companyId: selectedCompanyId!, activeOnly: true },
    { enabled: !!selectedCompanyId }
  );
  const { data: runs, refetch: refetchRuns } = trpc.globalPayroll.listRuns.useQuery(
    { companyId: selectedCompanyId! },
    { enabled: !!selectedCompanyId }
  );
  const { data: stats } = trpc.globalPayroll.getCompanyStats.useQuery(
    { companyId: selectedCompanyId! },
    { enabled: !!selectedCompanyId }
  );

  const createCompany = trpc.globalPayroll.createCompany.useMutation({
    onSuccess: (c) => {
      toast("Company created", { description: `${c.name} is ready for payroll.` });
      setShowNewCompany(false);
      setSelectedCompanyId(c.id);
      refetchCompanies();
    },
    onError: (e) => toast.error("Error"),
  });

  const selectedCompany = companies?.find((c) => c.id === selectedCompanyId);

  const jurisdictionBreakdown = useMemo(() => {
    if (!employees) return [];
    const map: Record<string, number> = {};
    employees.forEach((e) => { map[e.jurisdiction] = (map[e.jurisdiction] ?? 0) + 1; });
    return Object.entries(map).map(([code, count]) => ({
      ...JURISDICTIONS.find((j) => j.code === code),
      count,
    }));
  }, [employees]);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe2 className="w-6 h-6 text-emerald-600" /> Global Payroll
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Multi-jurisdiction payroll with automatic tax calculation — NG, UK, US, CA, DE, AE, GH, KE, ZA
            </p>
          </div>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowNewCompany(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Company
          </Button>
        </div>

        {/* New Company Form */}
        {showNewCompany && (
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardHeader><CardTitle className="text-base">Register New Company</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div><Label>Company Name *</Label><Input value={newCompanyForm.name} onChange={(e) => setNewCompanyForm({ ...newCompanyForm, name: e.target.value })} /></div>
                <div><Label>Registration Number</Label><Input value={newCompanyForm.registrationNumber} onChange={(e) => setNewCompanyForm({ ...newCompanyForm, registrationNumber: e.target.value })} /></div>
                <div><Label>Tax ID</Label><Input value={newCompanyForm.taxId} onChange={(e) => setNewCompanyForm({ ...newCompanyForm, taxId: e.target.value })} /></div>
                <div>
                  <Label>Country</Label>
                  <Select value={newCompanyForm.country} onValueChange={(v) => setNewCompanyForm({ ...newCompanyForm, country: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{JURISDICTIONS.map((j) => <SelectItem key={j.code} value={j.code}>{j.flag} {j.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Base Currency</Label>
                  <Select value={newCompanyForm.baseCurrency} onValueChange={(v) => setNewCompanyForm({ ...newCompanyForm, baseCurrency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["USD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "AED", "CAD"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowNewCompany(false)}>Cancel</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={createCompany.isPending} onClick={() => createCompany.mutate(newCompanyForm as any)}>
                  {createCompany.isPending ? "Creating..." : "Create Company"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Company Selector */}
        {companies && companies.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCompanyId(c.id)}
                className={`flex-shrink-0 px-4 py-3 rounded-xl border text-left transition-all ${
                  selectedCompanyId === c.id
                    ? "border-emerald-500 bg-emerald-50 shadow-sm"
                    : "border-border hover:border-emerald-300 bg-card"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-medium text-sm">{c.name}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.country} · {c.baseCurrency}</div>
              </button>
            ))}
          </div>
        )}

        {/* Empty State */}
        {(!companies || companies.length === 0) && !showNewCompany && (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <Globe2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No companies yet</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-4">Register your first company to start running global payroll.</p>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowNewCompany(true)}>
                <Plus className="w-4 h-4 mr-1" /> Register Company
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Company Dashboard */}
        {selectedCompany && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard icon={<Users className="w-5 h-5" />} label="Active Employees" value={String(stats?.activeEmployees ?? 0)} sub={`across ${jurisdictionBreakdown.length} jurisdictions`} />
              <StatCard icon={<PlayCircle className="w-5 h-5" />} label="Total Runs" value={String(stats?.totalRuns ?? 0)} sub={`${stats?.disbursedRuns ?? 0} disbursed`} />
              <StatCard icon={<DollarSign className="w-5 h-5" />} label="Total Disbursed" value={`$${Number(stats?.totalDisbursedUsd ?? 0).toLocaleString()}`} sub="USD equivalent" />
              <StatCard icon={<Globe2 className="w-5 h-5" />} label="Jurisdictions" value={String(jurisdictionBreakdown.length)} sub={jurisdictionBreakdown.map((j) => j?.flag).join(" ")} />
            </div>

            {/* Jurisdiction Breakdown */}
            {jurisdictionBreakdown.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {jurisdictionBreakdown.map((j) => (
                  <div key={j?.code} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-sm">
                    <span>{j?.flag}</span>
                    <span className="font-medium">{j?.name}</span>
                    <Badge variant="secondary" className="text-xs">{j.count}</Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="employees"><Users className="w-4 h-4 mr-1" /> Employees</TabsTrigger>
                  <TabsTrigger value="runs"><PlayCircle className="w-4 h-4 mr-1" /> Payroll Runs</TabsTrigger>
                </TabsList>
                <div className="flex gap-2">
                  {activeTab === "employees" && <AddEmployeeDialog companyId={selectedCompanyId!} onSuccess={() => refetchEmployees()} />}
                  {activeTab === "runs" && <CreateRunDialog companyId={selectedCompanyId!} onSuccess={() => refetchRuns()} />}
                </div>
              </div>

              {/* Employees Tab */}
              <TabsContent value="employees">
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-0">
                    {!employees || employees.length === 0 ? (
                      <div className="py-12 text-center text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p>No employees yet. Add your first employee to get started.</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Employee</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Title / Dept</TableHead>
                            <TableHead>Jurisdiction</TableHead>
                            <TableHead className="text-right">Gross Salary</TableHead>
                            <TableHead>Payment</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employees.map((emp) => {
                            const jur = JURISDICTIONS.find((j) => j.code === emp.jurisdiction);
                            return (
                              <TableRow key={emp.id}>
                                <TableCell>
                                  <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                                  <div className="text-xs text-muted-foreground">{emp.email}</div>
                                </TableCell>
                                <TableCell className="font-mono text-sm">{emp.employeeCode}</TableCell>
                                <TableCell>
                                  <div className="text-sm">{emp.jobTitle || "—"}</div>
                                  <div className="text-xs text-muted-foreground">{emp.department || "—"}</div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1.5">
                                    <span>{jur?.flag}</span>
                                    <span className="text-sm">{emp.jurisdiction}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {Number(emp.grossSalary).toLocaleString()} {emp.salaryCurrency}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs capitalize">{emp.preferredChannel?.replace("_", " ")}</Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge className={`text-xs ${emp.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                                    {emp.isActive ? "Active" : "Terminated"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Runs Tab */}
              <TabsContent value="runs">
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-0">
                    {!runs || runs.length === 0 ? (
                      <div className="py-12 text-center text-muted-foreground">
                        <PlayCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p>No payroll runs yet. Create your first run to calculate and disburse payroll.</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Reference</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Pay Date</TableHead>
                            <TableHead className="text-right">Employees</TableHead>
                            <TableHead className="text-right">Gross (USD)</TableHead>
                            <TableHead className="text-right">Net (USD)</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {runs.map((run) => {
                            const sc = RUN_STATUS_CONFIG[run.status] ?? RUN_STATUS_CONFIG.draft;
                            return (
                              <TableRow key={run.id}>
                                <TableCell className="font-mono text-xs">{run.runReference}</TableCell>
                                <TableCell className="text-sm">
                                  {new Date(run.periodStart).toLocaleDateString()} – {new Date(run.periodEnd).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-sm">{new Date(run.payDate).toLocaleDateString()}</TableCell>
                                <TableCell className="text-right">{run.employeeCount}</TableCell>
                                <TableCell className="text-right font-mono">${Number(run.totalGrossUsd).toLocaleString()}</TableCell>
                                <TableCell className="text-right font-mono text-green-600">${Number(run.totalNetUsd).toLocaleString()}</TableCell>
                                <TableCell>
                                  <Badge className={`text-xs flex items-center gap-1 w-fit ${sc.color}`}>
                                    {sc.icon} {sc.label}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <RunDetailDialog runId={run.id} onRefresh={refetchRuns} />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
