import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Receipt, TrendingUp, CheckCircle, XCircle, Plus, Upload, AlertCircle } from "lucide-react";


type FormState = {
  amountUsd: string;
  currency: string;
  category: string;
  merchant: string;
  description: string;
  expenseDate: string;
  receiptUrl: string;
};

const defaultForm: FormState = {
  amountUsd: "",
  currency: "USD",
  category: "travel",
  merchant: "",
  description: "",
  expenseDate: "",
  receiptUrl: "",
};
const CATEGORIES = ["travel", "accommodation", "meals", "software", "equipment", "marketing", "legal", "training", "other"];
const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS"];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  reimbursed: "bg-emerald-100 text-emerald-700",
};

export default function ExpenseManagement() {
  const [addOpen, setAddOpen] = useState(false);
  const companyId = 1;
  const [form, setForm] = useState<FormState>(defaultForm);


  const utils = trpc.useUtils();
  const { data: expenses, isLoading } = trpc.expenseManagement.listReports.useQuery({});
  const { data: summary } = trpc.expenseManagement.listReports.useQuery();
  const { data: policies } = trpc.expenseManagement.listPolicies.useQuery();

  const submitReport = trpc.expenseManagement.submitReport.useMutation({
    onSuccess: () => {
      toast("Expense submitted", { description: "Your expense has been submitted for approval." });
      utils.expenseManagement.listReports.invalidate();
      setAddOpen(false);
      setForm(defaultForm);
    },
    onError: (e) => toast.error("Submission failed", { description: e.message }),
  });

  const approveReport = trpc.expenseManagement.approveReport.useMutation({
    onSuccess: () => {
      toast("Expense approved");
      utils.expenseManagement.listReports.invalidate();
    },
    onError: (e) => toast.error("Approval failed", { description: e.message }),
  });

  const reimburse = trpc.expenseManagement.reimburse.useMutation({
    onSuccess: () => {
      toast("Expense rejected");
      utils.expenseManagement.listReports.invalidate();
    },
    onError: (e) => toast.error("Rejection failed", { description: e.message }),
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expense Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Track, submit, and reimburse business expenses across currencies</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Expense</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Submit Expense</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs">Amount</Label>
                <Input type="number" placeholder="250.00" value={form.amountUsd}
                  onChange={e => setForm(f => ({ ...f}))} />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.expenseDate}
                  onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Merchant</Label>
                <Input placeholder="e.g. Marriott Lagos" value={form.merchant}
                  onChange={e => setForm(f => ({ ...f, merchant: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <Input placeholder="Business travel to client meeting" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Receipt URL (optional)</Label>
                <Input placeholder="https://..." value={form.receiptUrl}
                  onChange={e => setForm(f => ({ ...f, receiptUrl: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full mt-4"
              onClick={() => submitReport.mutate({
                companyId,
                title: form.category + " — " + (form.merchant || "Expense"),
                description: form.description,
                items: [{
                  category: form.category as any,
                  description: form.description,
                  amountUsd: parseFloat(form.amountUsd) || 0,
                  expenseDate: form.expenseDate || new Date().toISOString().slice(0, 10),
                  currency: form.currency,
                  merchantName: form.merchant || undefined,
                  receiptUrl: form.receiptUrl || undefined,
                }],
              })}
              disabled={submitReport.isPending || !form.amountUsd}>
              {submitReport.isPending ? "Submitting..." : "Submit Expense"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Pending Approval", value: (Array.isArray(expenses) ? expenses : []).filter((r: any) => r.status === "submitted").length, icon: AlertCircle, color: "text-amber-600" },
          { label: "Approved", value: (Array.isArray(expenses) ? expenses : []).filter((r: any) => r.status === "approved").length, icon: CheckCircle, color: "text-green-600" },
          { label: "Reimbursed", value: (Array.isArray(expenses) ? expenses : []).filter((r: any) => r.status === "reimbursed").length, icon: TrendingUp, color: "text-blue-600" },
          { label: "Total Reports", value: (Array.isArray(expenses) ? expenses : []).length, icon: XCircle, color: "text-blue-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{String(value)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">My Expenses</TabsTrigger>
          <TabsTrigger value="policies">Expense Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Expense History</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
              ) : expenses?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No expenses yet. Submit your first expense.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {expenses?.map(exp => (
                    <div key={exp.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{exp.merchant || exp.description}</p>
                        <p className="text-xs text-muted-foreground capitalize">{exp.category} · {exp.expenseDate ? new Date(exp.expenseDate).toLocaleDateString() : "—"}</p>
                      </div>
                      <p className="font-semibold text-sm">{exp.currency} {Number(exp.amount).toLocaleString()}</p>
                      <Badge className={`text-xs ${STATUS_COLORS[exp.status] ?? ""}`}>{exp.status}</Badge>
                      {exp.status === "submitted" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => approveReport.mutate({ reportId: exp.id })}>
                            <CheckCircle className="w-3 h-3 mr-1" />Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-red-600"
                            onClick={() => reimburse.mutate({ reportId: exp.id })}>
                            <XCircle className="w-3 h-3 mr-1" />Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Expense Policies</CardTitle></CardHeader>
            <CardContent>
              {policies?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No policies configured. Contact your administrator.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {policies?.map(p => (
                    <div key={p.id} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{p.category} · Max {p.currency} {Number(p.maxAmount).toLocaleString()}</p>
                      </div>
                      <Badge variant={p.requiresReceipt ? "default" : "outline"}>
                        {p.requiresReceipt ? "Receipt required" : "No receipt needed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
