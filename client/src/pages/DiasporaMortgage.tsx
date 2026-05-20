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
import { Home, DollarSign, TrendingUp, Clock, Plus, Calculator } from "lucide-react";

const COUNTRIES = ["NG", "GH", "KE", "ZA", "GB", "US", "CA", "AE", "DE", "FR"];
const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR"];
const PROPERTY_TYPES = ["residential", "commercial", "land"] as const;

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  disbursed: "bg-emerald-100 text-emerald-700",
  closed: "bg-gray-100 text-gray-600",
};

export default function DiasporaMortgage() {
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({
    propertyCountry: "NG", propertyCity: "", propertyAddress: "",
    propertyType: "residential" as "residential" | "commercial" | "land",
    propertyValueUsd: "", loanAmountUsd: "",
    ltvRatioPct: "70", termYears: "20",
    applicantIncome: "", incomeCountry: "GB", incomeCurrency: "GBP",
  });

  const utils = trpc.useUtils();
  const { data: applications, isLoading } = trpc.diasporaMortgage.list.useQuery();

  // submitApplication: { propertyCountry, propertyCity, propertyAddress?, propertyType, propertyValueUsd, loanAmountUsd, ltvRatioPct, termYears, applicantIncome, incomeCountry, incomeCurrency }
  const submitApplication = trpc.diasporaMortgage.submitApplication.useMutation({
    onSuccess: () => {
      toast("Application submitted", { description: "Your mortgage application is under review. Typical approval: 5-10 business days." });
      utils.diasporaMortgage.list.invalidate();
      setApplyOpen(false);
      setForm({ propertyCountry: "NG", propertyCity: "", propertyAddress: "", propertyType: "residential", propertyValueUsd: "", loanAmountUsd: "", ltvRatioPct: "70", termYears: "20", applicantIncome: "", incomeCountry: "GB", incomeCurrency: "GBP" });
    },
    onError: (e) => toast.error("Application failed", { description: e.message }),
  });

  const totalLoan = applications?.reduce((sum: number, a: any) => sum + parseFloat(a.loanAmountUsd ?? 0), 0) ?? 0;
  const activeCount = applications?.filter((a: any) => ["approved", "disbursed"].includes(a.status)).length ?? 0;
  const pendingCount = applications?.filter((a: any) => ["submitted", "under_review"].includes(a.status)).length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Diaspora Mortgage</h1>
          <p className="text-muted-foreground text-sm mt-1">Home financing for diaspora — buy property in your home country using foreign income</p>
        </div>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Apply for Mortgage</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Diaspora Mortgage Application</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2 max-h-[65vh] overflow-y-auto pr-1">
              <div>
                <Label className="text-xs">Property Country</Label>
                <Select value={form.propertyCountry} onValueChange={v => setForm(f => ({ ...f, propertyCountry: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Property City</Label>
                <Input placeholder="Lagos" value={form.propertyCity}
                  onChange={e => setForm(f => ({ ...f, propertyCity: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Property Address (optional)</Label>
                <Input placeholder="12 Victoria Island, Lagos" value={form.propertyAddress}
                  onChange={e => setForm(f => ({ ...f, propertyAddress: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Property Type</Label>
                <Select value={form.propertyType} onValueChange={v => setForm(f => ({ ...f, propertyType: v as typeof form.propertyType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROPERTY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Property Value (USD)</Label>
                <Input type="number" placeholder="250000" value={form.propertyValueUsd}
                  onChange={e => setForm(f => ({ ...f, propertyValueUsd: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Loan Amount (USD)</Label>
                <Input type="number" placeholder="175000" value={form.loanAmountUsd}
                  onChange={e => setForm(f => ({ ...f, loanAmountUsd: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">LTV Ratio (%)</Label>
                <Input type="number" min="10" max="80" placeholder="70" value={form.ltvRatioPct}
                  onChange={e => setForm(f => ({ ...f, ltvRatioPct: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Term (Years)</Label>
                <Input type="number" min="5" max="30" placeholder="20" value={form.termYears}
                  onChange={e => setForm(f => ({ ...f, termYears: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Annual Income (USD equivalent)</Label>
                <Input type="number" placeholder="80000" value={form.applicantIncome}
                  onChange={e => setForm(f => ({ ...f, applicantIncome: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Income Country</Label>
                <Select value={form.incomeCountry} onValueChange={v => setForm(f => ({ ...f, incomeCountry: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Income Currency</Label>
                <Select value={form.incomeCurrency} onValueChange={v => setForm(f => ({ ...f, incomeCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-3 mt-3 text-xs text-blue-700 dark:text-blue-300">
              <strong>LTV limit:</strong> Max 80% of property value. Loan amount must not exceed {form.ltvRatioPct}% of property value (${form.propertyValueUsd ? (parseFloat(form.propertyValueUsd) * parseFloat(form.ltvRatioPct) / 100).toLocaleString() : "—"}).
            </div>
            <Button className="w-full mt-4"
              onClick={() => submitApplication.mutate({
                propertyCountry: form.propertyCountry,
                propertyCity: form.propertyCity,
                propertyAddress: form.propertyAddress || undefined,
                propertyType: form.propertyType,
                propertyValueUsd: parseFloat(form.propertyValueUsd) || 0,
                loanAmountUsd: parseFloat(form.loanAmountUsd) || 0,
                ltvRatioPct: parseFloat(form.ltvRatioPct) || 70,
                termYears: parseInt(form.termYears) || 20,
                applicantIncome: parseFloat(form.applicantIncome) || 0,
                incomeCountry: form.incomeCountry,
                incomeCurrency: form.incomeCurrency,
              })}
              disabled={submitApplication.isPending || !form.propertyCity || !form.propertyValueUsd || !form.loanAmountUsd || !form.applicantIncome}>
              {submitApplication.isPending ? "Submitting..." : "Submit Application"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Loan Value", value: `$${totalLoan.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "text-green-600" },
          { label: "Active Mortgages", value: String(activeCount), icon: Home, color: "text-blue-600" },
          { label: "Pending Review", value: String(pendingCount), icon: Clock, color: "text-amber-600" },
          { label: "Max LTV", value: "80%", icon: Calculator, color: "text-purple-600" },
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
        <CardHeader><CardTitle className="text-base">Mortgage Applications</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !applications?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No applications yet. Apply for a diaspora mortgage to buy property in your home country.</p>
            </div>
          ) : (
            <div className="divide-y">
              {applications?.map((app: any) => (
                <div key={app.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{app.propertyCity}, {app.propertyCountry} — {app.propertyType}</p>
                    <p className="text-xs text-muted-foreground">
                      Property: ${Number(app.propertyValueUsd ?? 0).toLocaleString()} · LTV: {Number(app.ltvPct ?? 0).toFixed(0)}% · {app.termYears}yr
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">${Number(app.loanAmountUsd ?? 0).toLocaleString()}</p>
                    {app.monthlyPaymentUsd && (
                      <p className="text-xs text-muted-foreground">${Number(app.monthlyPaymentUsd).toLocaleString()}/mo</p>
                    )}
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
