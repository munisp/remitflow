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
import { DollarSign, Users, FileText, Send, Plus, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  paid: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "CAD", "AUD"];

export default function ContractorPayments() {
  const [createOpen, setAddContractorOpen] = useState(false);
  const [addInvoiceOpen, setAddInvoiceOpen] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<number | null>(null);

  // Contractor form
  const [contractorForm, setContractorForm] = useState({
    name: "", email: "", country: "", currency: "USD", taxId: "", bankName: "", accountNumber: "", routingCode: "",
  });

  // Invoice form
  const [invoiceForm, setInvoiceForm] = useState({
    contractorId: "", amount: "", currency: "USD", description: "", dueDate: "", serviceFrom: "", serviceTo: "",
  });

  const utils = trpc.useUtils();

  const { data: contractors, isLoading: loadingContractors } = trpc.contractorPayments.list.useQuery();
  const { data: invoices, isLoading: loadingInvoices } = trpc.contractorPayments.listInvoices.useQuery({
    contractorId: selectedContractor ?? undefined,
  });

  const create = trpc.contractorPayments.create.useMutation({
    onSuccess: () => {
      toast("Contractor added", { description: "Contractor profile created successfully." });
      utils.contractorPayments.listInvoices.invalidate();
      setAddContractorOpen(false);
      setContractorForm({ name: "", email: "", country: "", currency: "USD", taxId: "", bankName: "", accountNumber: "", routingCode: "" });
    },
    onError: (e) => toast.error("Failed to add contractor", { description: e.message }),
  });

  const createInvoice = trpc.contractorPayments.submitInvoice.useMutation({
    onSuccess: () => {
      toast("Invoice created", { description: "Invoice submitted for approval." });
      utils.contractorPayments.listInvoices.invalidate();
      setAddInvoiceOpen(false);
    },
    onError: (e) => toast.error("Failed to create invoice", { description: e.message }),
  });

  const approveInvoice = trpc.contractorPayments.approveAndPay.useMutation({
    onSuccess: () => {
      toast("Invoice approved", { description: "Invoice approved and queued for payment." });
      utils.contractorPayments.listInvoices.invalidate();
    },
    onError: (e) => toast.error("Approval failed", { description: e.message }),
  });

  const approveAndPay = trpc.contractorPayments.approveAndPay.useMutation({
    onSuccess: () => {
      toast("Payment initiated", { description: "Cross-border payment dispatched via optimal rail." });
      utils.contractorPayments.listInvoices.invalidate();
      utils.contractorPayments.listInvoices.invalidate();
    },
    onError: (e) => toast.error("Payment failed", { description: e.message }),
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contractor Payments</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage global freelancers and contractors — multi-currency, cross-border</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={setAddContractorOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Users className="w-4 h-4 mr-2" />Add Contractor</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Contractor</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  { label: "Full Name", key: "name", placeholder: "Jane Doe" },
                  { label: "Email", key: "email", placeholder: "jane@example.com" },
                  { label: "Country", key: "country", placeholder: "NG" },
                  { label: "Tax ID", key: "taxId", placeholder: "Optional" },
                  { label: "Bank Name", key: "bankName", placeholder: "GTBank" },
                  { label: "Account Number", key: "accountNumber", placeholder: "0123456789" },
                  { label: "Routing / Sort Code", key: "routingCode", placeholder: "Optional" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key} className={key === "name" || key === "email" ? "col-span-2" : ""}>
                    <Label className="text-xs">{label}</Label>
                    <Input placeholder={placeholder} value={(contractorForm as any)[key]}
                      onChange={e => setContractorForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <Label className="text-xs">Default Currency</Label>
                  <Select value={contractorForm.currency} onValueChange={v => setContractorForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button className="w-full mt-4" onClick={() => create.mutate(contractorForm)} disabled={create.isPending}>
                {create.isPending ? "Adding..." : "Add Contractor"}
              </Button>
            </DialogContent>
          </Dialog>

          <Dialog open={addInvoiceOpen} onOpenChange={setAddInvoiceOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />New Invoice</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="col-span-2">
                  <Label className="text-xs">Contractor</Label>
                  <Select value={invoiceForm.contractorId} onValueChange={v => setInvoiceForm(f => ({ ...f, contractorId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
                    <SelectContent>
                      {(contractors??[]).map((c:any) => <SelectItem key={c.id} value={String(c.id)}>{c.name} — {c.country}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" placeholder="1500.00" value={invoiceForm.amount}
                    onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={invoiceForm.currency} onValueChange={v => setInvoiceForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Description</Label>
                  <Input placeholder="Web development — May 2026" value={invoiceForm.description}
                    onChange={e => setInvoiceForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Service From</Label>
                  <Input type="date" value={invoiceForm.serviceFrom}
                    onChange={e => setInvoiceForm(f => ({ ...f, serviceFrom: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Service To</Label>
                  <Input type="date" value={invoiceForm.serviceTo}
                    onChange={e => setInvoiceForm(f => ({ ...f, serviceTo: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Due Date</Label>
                  <Input type="date" value={invoiceForm.dueDate}
                    onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
              </div>
              <Button className="w-full mt-4"
                onClick={() => createInvoice.mutate({
                contractorId: Number(invoiceForm.contractorId),
                description: invoiceForm.description,
                lineItems: [{ description: invoiceForm.description, quantity: 1, unitPrice: parseFloat(invoiceForm.amount) || 0, total: parseFloat(invoiceForm.amount) || 0 }],
                currency: invoiceForm.currency,
                dueDate: invoiceForm.dueDate || undefined,
              })}
                disabled={createInvoice.isPending || !invoiceForm.contractorId}>
                {createInvoice.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Contractors", value: contractors?.length ?? "—", icon: Users, color: "text-blue-600" },
          { label: "Pending Invoices", value: (invoices??[]).filter((i:any)=>i.status==="submitted").length ?? "—", icon: Clock, color: "text-amber-600" },
          { label: "Paid This Month", value: "—", icon: CheckCircle, color: "text-green-600" },
          { label: "Total Outstanding", value: "—", icon: AlertCircle, color: "text-red-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted`}><Icon className={`w-5 h-5 ${color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{String(value)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="contractors">Contractors</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Invoice Queue</CardTitle>
                <Select value={selectedContractor ? String(selectedContractor) : "all"}
                  onValueChange={v => setSelectedContractor(v === "all" ? null : Number(v))}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="All contractors" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All contractors</SelectItem>
                    {contractors?.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loadingInvoices ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
              ) : invoices?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No invoices yet. Create one to get started.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {invoices?.map((inv: any) => (
                    <div key={inv.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{inv.description}</p>
                        <p className="text-xs text-muted-foreground">Due {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-sm">{inv.currency} {Number(inv.amount).toLocaleString()}</p>
                      </div>
                      <Badge className={`text-xs ${STATUS_COLORS[inv.status] ?? ""}`}>{inv.status}</Badge>
                      <div className="flex gap-1">
                        {inv.status === "submitted" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => approveAndPay.mutate({ invoiceId: inv.id })}>
                            <CheckCircle className="w-3 h-3 mr-1" />Approve
                          </Button>
                        )}
                        {inv.status === "approved" && (
                          <Button size="sm" className="h-7 text-xs"
                            onClick={() => approveAndPay.mutate({ invoiceId: inv.id })}>
                            <Send className="w-3 h-3 mr-1" />Pay
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contractors" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Contractor Directory</CardTitle></CardHeader>
            <CardContent>
              {loadingContractors ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
              ) : contractors?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No contractors yet. Add one to get started.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {contractors?.map((c: any) => (
                    <div key={c.id} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.email} · {c.country}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{c.currency}</p>
                        <p className="text-xs text-muted-foreground">{c.bankName ?? "No bank"}</p>
                      </div>
                      <Badge variant="outline" className="ml-4">{c.status}</Badge>
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
