import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Calculator, Plus, Pencil, DollarSign, Percent } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const CORRIDORS = ["USD-NGN","GBP-NGN","EUR-NGN","USD-KES","GBP-KES","USD-GHS","USD-ZAR","USD-TZS","USD-UGX","GBP-GHS","EUR-KES","USD-EGP","USD-MAD","USD-XOF","USD-XAF","USD-ETB","USD-RWF","GBP-ZAR","USD-INR","USD-PHP"];

function emptyForm() {
  return { corridor: "USD-NGN", minAmount: "0", maxAmount: "", feeType: "percentage" as "percentage"|"fixed"|"mixed", feePercentage: "0.015", feeFixed: "0", minFee: "1", maxFee: "" };
}

export default function FeeRulesEngine() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRule, setEditRule] = useState<any>(null);
  const [form, setForm] = useState(emptyForm());
  const [calcFrom, setCalcFrom] = useState("USD");
  const [calcTo, setCalcTo] = useState("NGN");
  const [calcAmount, setCalcAmount] = useState("500");

  const { data: rules, isLoading } = trpc.feeEngine.listRules.useQuery();
  const { data: calcResult } = trpc.feeEngine.calculate.useQuery({ fromCurrency: calcFrom, toCurrency: calcTo, amount: parseFloat(calcAmount) || 500 });

  const upsertMut = trpc.feeEngine.upsertRule.useMutation({
    onSuccess: () => { utils.feeEngine.listRules.invalidate(); setCreateOpen(false); setEditRule(null); setForm(emptyForm()); toast.success("Fee rule saved"); },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit() {
    upsertMut.mutate({
      id: editRule?.id,
      corridor: form.corridor,
      minAmount: parseFloat(form.minAmount) || 0,
      maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : undefined,
      feeType: form.feeType,
      feePercentage: parseFloat(form.feePercentage) || 0,
      feeFixed: parseFloat(form.feeFixed) || 0,
      minFee: parseFloat(form.minFee) || 0,
      maxFee: form.maxFee ? parseFloat(form.maxFee) : undefined,
    });
  }

  function openEdit(rule: any) {
    setEditRule(rule);
    setForm({
      corridor: rule.corridor,
      minAmount: rule.minAmount ?? "0",
      maxAmount: rule.maxAmount ?? "",
      feeType: rule.feeType,
      feePercentage: rule.feePercentage ?? "0.015",
      feeFixed: rule.feeFixed ?? "0",
      minFee: rule.minFee ?? "1",
      maxFee: rule.maxFee ?? "",
    });
    setCreateOpen(true);
  }

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Calculator className="w-6 h-6 text-green-500" /> Fee Rules Engine</h1>
          <p className="text-muted-foreground text-sm mt-1">Configure tiered fee structures by corridor and transaction volume</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditRule(null); setForm(emptyForm()); } else setCreateOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" /> Add Rule</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editRule ? "Edit Fee Rule" : "Create Fee Rule"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Corridor</Label>
                <Select value={form.corridor} onValueChange={v => setForm(f => ({ ...f, corridor: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CORRIDORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Min Amount ($)</Label>
                  <Input type="number" value={form.minAmount} onChange={e => setForm(f => ({ ...f, minAmount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Max Amount ($)</Label>
                  <Input type="number" value={form.maxAmount} onChange={e => setForm(f => ({ ...f, maxAmount: e.target.value }))} placeholder="No limit" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Fee Type</Label>
                <Select value={form.feeType} onValueChange={v => setForm(f => ({ ...f, feeType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                    <SelectItem value="mixed">Mixed (% + Fixed)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(form.feeType === "percentage" || form.feeType === "mixed") && (
                <div className="space-y-1">
                  <Label>Fee % (e.g. 0.015 = 1.5%)</Label>
                  <Input type="number" step="0.001" value={form.feePercentage} onChange={e => setForm(f => ({ ...f, feePercentage: e.target.value }))} />
                </div>
              )}
              {(form.feeType === "fixed" || form.feeType === "mixed") && (
                <div className="space-y-1">
                  <Label>Fixed Fee ($)</Label>
                  <Input type="number" step="0.01" value={form.feeFixed} onChange={e => setForm(f => ({ ...f, feeFixed: e.target.value }))} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Min Fee ($)</Label>
                  <Input type="number" step="0.01" value={form.minFee} onChange={e => setForm(f => ({ ...f, minFee: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Max Fee ($)</Label>
                  <Input type="number" step="0.01" value={form.maxFee} onChange={e => setForm(f => ({ ...f, maxFee: e.target.value }))} placeholder="No cap" />
                </div>
              </div>
              <Button onClick={handleSubmit} disabled={upsertMut.isPending} className="w-full">{upsertMut.isPending ? "Saving..." : (editRule ? "Update Rule" : "Create Rule")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Fee Calculator */}
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" /> Live Fee Calculator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input className="w-24" value={calcFrom} onChange={e => setCalcFrom(e.target.value.toUpperCase())} maxLength={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input className="w-24" value={calcTo} onChange={e => setCalcTo(e.target.value.toUpperCase())} maxLength={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input className="w-32" type="number" value={calcAmount} onChange={e => setCalcAmount(e.target.value)} />
            </div>
            {calcResult && (
              <div className="flex gap-4 text-sm ml-2">
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Fee</p>
                  <p className="font-bold text-green-700">${calcResult.fee}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Total</p>
                  <p className="font-bold">${calcResult.totalAmount}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Network</p>
                  <p className="font-bold text-muted-foreground">${calcResult.breakdown.networkFee}</p>
                </div>
                {calcResult.breakdown.regulatoryFee > 0 && (
                  <div className="text-center">
                    <p className="text-muted-foreground text-xs">Regulatory</p>
                    <p className="font-bold text-orange-600">${calcResult.breakdown.regulatoryFee}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rules Table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
      ) : !rules?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No fee rules configured. Using default 1.5% fee structure.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {["Corridor", "Amount Range", "Fee Type", "Rate", "Min/Max Fee", "Status", "Actions"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rules.map((rule: any) => (
                    <tr key={rule.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono font-semibold text-xs">{rule.corridor}</td>
                      <td className="px-4 py-3 text-xs">
                        ${parseFloat(rule.minAmount ?? "0").toLocaleString()} — {rule.maxAmount ? `$${parseFloat(rule.maxAmount).toLocaleString()}` : "∞"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">{rule.feeType}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {rule.feeType !== "fixed" && <span className="flex items-center gap-0.5"><Percent className="w-3 h-3" />{(parseFloat(rule.feePercentage ?? "0") * 100).toFixed(2)}%</span>}
                        {rule.feeType !== "percentage" && <span className="flex items-center gap-0.5"><DollarSign className="w-3 h-3" />{parseFloat(rule.feeFixed ?? "0").toFixed(2)}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        ${parseFloat(rule.minFee ?? "0").toFixed(2)} — {rule.maxFee ? `$${parseFloat(rule.maxFee).toFixed(2)}` : "∞"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={rule.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}>{rule.isActive ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(rule)}><Pencil className="w-3.5 h-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
