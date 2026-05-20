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
import { FileText, DollarSign, TrendingUp, Clock, Plus } from "lucide-react";

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS"];
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  funded: "bg-emerald-100 text-emerald-700",
  repaid: "bg-purple-100 text-purple-700",
  rejected: "bg-red-100 text-red-700",
};

export default function InvoiceFinancing() {
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({
    invoiceNumber: "", invoiceAmountUsd: "", debtorName: "",
    debtorCountry: "NG", dueDate: "",
  });

  const utils = trpc.useUtils();
  const { data: applications, isLoading } = trpc.invoiceFinancing.list.useQuery({});

  // applyForFinancing: { invoiceNumber, debtorName, debtorCountry?, invoiceAmountUsd, advanceRatePct?, invoiceDocUrl?, invoiceDueDate }
  const applyForFinancing = trpc.invoiceFinancing.applyForFinancing.useMutation({
    onSuccess: () => {
      toast("Application submitted", { description: "Invoice financing application under review. Typical approval: 24-48 hours." });
      utils.invoiceFinancing.list.invalidate();
      setApplyOpen(false);
      setForm({ invoiceNumber: "", invoiceAmountUsd: "", debtorName: "", debtorCountry: "NG", dueDate: "" });
    },
    onError: (e) => toast.error("Application failed", { description: e.message }),
  });

  const totalFinanced = applications?.reduce((sum: number, a: any) => sum + parseFloat(a.advanceAmountUsd ?? 0), 0) ?? 0;
  const outstanding = applications?.filter((a: any) => ["funded", "repaying"].includes(a.status)).length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoice Financing</h1>
          <p className="text-muted-foreground text-sm mt-1">Unlock working capital against outstanding invoices — advance up to 85%</p>
        </div>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Apply for Financing</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Invoice Financing Application</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs">Invoice Number</Label>
                <Input placeholder="INV-2026-001" value={form.invoiceNumber}
                  onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Invoice Amount (USD)</Label>
                <Input type="number" placeholder="50000" value={form.invoiceAmountUsd}
                  onChange={e => setForm(f => ({ ...f, invoiceAmountUsd: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Debtor / Buyer Name</Label>
                <Input placeholder="Acme Corporation UK" value={form.debtorName}
                  onChange={e => setForm(f => ({ ...f, debtorName: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Debtor Country (2-letter)</Label>
                <Input placeholder="GB" maxLength={2} value={form.debtorCountry}
                  onChange={e => setForm(f => ({ ...f, debtorCountry: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <Label className="text-xs">Invoice Due Date</Label>
                <Input type="date" value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-3 mt-3 text-xs text-blue-700 dark:text-blue-300">
              <strong>How it works:</strong> Submit your invoice → We verify with the debtor → Advance up to 85% within 48 hours → Repay when debtor pays.
            </div>
            <Button className="w-full mt-4"
              onClick={() => applyForFinancing.mutate({
                invoiceNumber: form.invoiceNumber,
                invoiceAmountUsd: parseFloat(form.invoiceAmountUsd) || 0,
                debtorName: form.debtorName,
                debtorCountry: form.debtorCountry || undefined,
                invoiceDueDate: form.dueDate,
              })}
              disabled={applyForFinancing.isPending || !form.invoiceNumber || !form.invoiceAmountUsd || !form.dueDate}>
              {applyForFinancing.isPending ? "Submitting..." : "Submit Application"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Financed", value: `$${totalFinanced.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "text-green-600" },
          { label: "Outstanding", value: String(outstanding), icon: Clock, color: "text-amber-600" },
          { label: "Applications", value: String(applications?.length ?? 0), icon: FileText, color: "text-blue-600" },
          { label: "Advance Rate", value: "80%", icon: TrendingUp, color: "text-purple-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Financing Applications</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          ) : !applications?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No applications yet. Apply for invoice financing to unlock working capital.</p>
            </div>
          ) : (
            <div className="divide-y">
              {applications?.map((app: any) => (
                <div key={app.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{app.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">{app.debtorName} · Due {app.invoiceDueDate ? new Date(app.invoiceDueDate).toLocaleDateString() : "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">${Number(app.invoiceAmountUsd ?? 0).toLocaleString()}</p>
                    {app.advanceAmountUsd && <p className="text-xs text-green-600">Advance: ${Number(app.advanceAmountUsd).toLocaleString()}</p>}
                  </div>
                  <Badge className={`text-xs ${STATUS_COLORS[app.status] ?? ""}`}>{app.status.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
