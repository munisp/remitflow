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
import { FileText, CheckCircle, Clock, AlertCircle, Plus } from "lucide-react";
import { useTranslation } from 'react-i18next';

const JURISDICTIONS = [
  { code: "NG", name: "Nigeria (FIRS)", authority: "FIRS" },
  { code: "GB", name: "United Kingdom (HMRC)", authority: "HMRC" },
  { code: "KE", name: "Kenya (KRA)", authority: "KRA" },
  { code: "GH", name: "Ghana (GRA)", authority: "GRA" },
  { code: "US", name: "United States (IRS)", authority: "IRS" },
  { code: "CA", name: "Canada (CRA)", authority: "CRA" },
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  calculated: "bg-blue-100 text-blue-700",
  submitted: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  amended: "bg-purple-100 text-purple-700",
};

export default function PayrollTaxFiling() {
  const { t } = useTranslation();
  const [newFilingOpen, setNewFilingOpen] = useState(false);
  const [form, setForm] = useState({
    jurisdiction: "NG",
    periodStart: "",
    periodEnd: "",
  });

  const utils = trpc.useUtils();
  const { data: filings, isLoading } = trpc.payrollTaxFiling.list.useQuery({ companyId: 1 });

  // calculate: { companyId, payrollRunId?, jurisdiction, periodStart, periodEnd }
  const createFiling = trpc.payrollTaxFiling.calculate.useMutation({
    onSuccess: () => {
      toast("Filing created", { description: "Tax filing calculated. Review and submit to the tax authority." });
      utils.payrollTaxFiling.list.invalidate();
      setNewFilingOpen(false);
      setForm({ jurisdiction: "NG", periodStart: "", periodEnd: "" });
    },
    onError: (e) => toast.error("Failed to create filing", { description: e.message }),
  });

  // submit: { filingId, filingReference?, filingDocUrl? }
  const submitFiling = trpc.payrollTaxFiling.submit.useMutation({
    onSuccess: () => {
      toast("Filing submitted", { description: "Tax filing submitted to the authority. Confirmation reference generated." });
      utils.payrollTaxFiling.list.invalidate();
    },
    onError: (e) => toast.error("Submission failed", { description: e.message }),
  });

  const totalFiled = filings?.length ?? 0;
  const totalTaxPaid = filings?.filter((f: any) => f.status === "paid").reduce((sum: number, f: any) => sum + parseFloat(f.totalTaxUsd ?? 0), 0) ?? 0;
  const pendingSubmission = filings?.filter((f: any) => f.status === "calculated").length ?? 0;
  const overdue = filings?.filter((f: any) => f.status === "overdue").length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll Tax Filing</h1>
          <p className="text-muted-foreground text-sm mt-1">Multi-jurisdiction PAYE, NHIS, pension, and statutory deduction filings</p>
        </div>
        <Dialog open={newFilingOpen} onOpenChange={setNewFilingOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Filing</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Create Tax Filing</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="col-span-2">
                <Label className="text-xs">Jurisdiction</Label>
                <Select value={form.jurisdiction} onValueChange={v => setForm(f => ({ ...f, jurisdiction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{JURISDICTIONS.map(j => <SelectItem key={j.code} value={j.code}>{j.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Period Start</Label>
                <Input type="date" value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Period End</Label>
                <Input type="date" value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
              </div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-3 mt-3 text-xs text-amber-700 dark:text-amber-300">
              <strong>Auto-calculated:</strong> PAYE, pension (8% employer + 8% employee), NHIS (2.5%), NHF (2.5%), and ITF (1%) are computed based on the selected jurisdiction's current rates.
            </div>
            <Button className="w-full mt-4"
              onClick={() => createFiling.mutate({
                companyId: 1,
                jurisdiction: form.jurisdiction,
                periodStart: form.periodStart,
                periodEnd: form.periodEnd,
              })}
              disabled={createFiling.isPending || !form.periodStart || !form.periodEnd}>
              {createFiling.isPending ? "Calculating..." : "Calculate & Create Filing"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Filed", value: String(totalFiled), icon: FileText, color: "text-blue-600" },
          { label: "Total Tax Paid", value: `$${totalTaxPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: CheckCircle, color: "text-green-600" },
          { label: "Pending Submission", value: String(pendingSubmission), icon: Clock, color: "text-amber-600" },
          { label: "Overdue", value: String(overdue), icon: AlertCircle, color: "text-red-600" },
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
        <CardHeader><CardTitle className="text-base">Tax Filings</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !filings?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No tax filings yet. Create your first filing to stay compliant.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-4">Period</th>
                    <th className="text-left py-2 pr-4">Jurisdiction</th>
                    <th className="text-right py-2 pr-4">Gross Payroll</th>
                    <th className="text-right py-2 pr-4">Total Tax</th>
                    <th className="text-right py-2 pr-4">Pension</th>
                    <th className="text-right py-2 pr-4">Status</th>
                    <th className="text-right py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filings?.map((f: any) => (
                    <tr key={f.id} className="hover:bg-muted/30">
                      <td className="py-3 pr-4 font-medium">
                        {f.periodStart ? new Date(f.periodStart).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        {JURISDICTIONS.find(j => j.code === f.jurisdiction)?.authority ?? f.jurisdiction}
                      </td>
                      <td className="py-3 pr-4 text-right">${Number(f.totalGrossUsd ?? 0).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-amber-600">${Number(f.totalTaxUsd ?? 0).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right text-blue-600">${Number(f.totalPensionUsd ?? 0).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right">
                        <Badge className={`text-xs ${STATUS_COLORS[f.status] ?? ""}`}>{f.status}</Badge>
                      </td>
                      <td className="py-3 text-right">
                        {f.status === "calculated" && (
                          <Button size="sm" className="h-7 text-xs"
                            onClick={() => submitFiling.mutate({ filingId: f.id })}
                            disabled={submitFiling.isPending}>Submit</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
