import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Settings, Plus, Edit, Trash2, Play, DollarSign, Percent, Layers } from "lucide-react";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["*", "USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR"];

export default function FeeRulesCRUDV2Page() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [simFrom, setSimFrom] = useState("USD");
  const [simTo, setSimTo] = useState("NGN");
  const [simAmount, setSimAmount] = useState("1000");
  const [simEnabled, setSimEnabled] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: "", fromCurrency: "USD", toCurrency: "NGN",
    feeType: "percentage" as "percentage" | "flat" | "tiered",
    feeValue: 1.5, minFee: 2.99, maxFee: 50, active: true, priority: 50,
  });

  const { data: rules, refetch } = trpc.v99.feeRulesEngine.list.useQuery();
  const { data: simResult } = trpc.v99.feeRulesEngine.simulate.useQuery(
    { fromCurrency: simFrom, toCurrency: simTo, amount: parseFloat(simAmount) || 1000 },
    { enabled: simEnabled && parseFloat(simAmount) > 0 }
  );

  const createMutation = trpc.v99.feeRulesEngine.create.useMutation({
    onSuccess: () => { toast.success("Fee rule created"); setShowCreate(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.v99.feeRulesEngine.update.useMutation({
    onSuccess: () => { toast.success("Fee rule updated"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.v99.feeRulesEngine.delete.useMutation({
    onSuccess: () => { toast.success("Fee rule deleted"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    createMutation.mutate(form);
  };

  const handleToggle = (id: number, active: boolean) => {
    updateMutation.mutate({ id, active });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this fee rule?")) return;
    deleteMutation.mutate({ id });
  };

  const feeTypeIcon = { percentage: Percent, flat: DollarSign, tiered: Layers };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <Settings className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Fee Rules Engine</h1>
              <p className="text-muted-foreground text-sm">CRUD management for corridor fee rules with simulation</p>
            </div>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Rule
          </Button>
        </div>

        {/* Fee Simulator */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-4 w-4 text-primary" /> Fee Simulator
            </CardTitle>
            <CardDescription>Test how fee rules apply to a transfer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Select value={simFrom} onValueChange={(v) => { setSimFrom(v); setSimEnabled(false); }}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.filter(c => c !== "*").map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Select value={simTo} onValueChange={(v) => { setSimTo(v); setSimEnabled(false); }}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.filter(c => c !== "*").map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Amount</Label>
                <Input className="mt-1 h-8 text-sm" type="number" value={simAmount} onChange={e => { setSimAmount(e.target.value); setSimEnabled(false); }} />
              </div>
            </div>
            <Button size="sm" onClick={() => setSimEnabled(true)} disabled={!parseFloat(simAmount)}>
              <Play className="h-3.5 w-3.5 mr-1.5" /> Simulate
            </Button>
            {simResult && simEnabled && (
              <div className="rounded-lg border bg-muted/30 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Applied Rule</p>
                  <p className="font-semibold">{simResult.appliedRule}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fee</p>
                  <p className="font-bold text-primary">${simResult.fee.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fee Rate</p>
                  <p className="font-semibold">{simResult.feeRate}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net Amount</p>
                  <p className="font-semibold text-emerald-600">${simResult.netAmount.toFixed(2)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rules Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fee Rules ({rules?.length ?? 0})</CardTitle>
            <CardDescription>All active and inactive fee rules, ordered by priority</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-semibold">Name</th>
                    <th className="text-left p-3 font-semibold">Corridor</th>
                    <th className="text-left p-3 font-semibold">Type</th>
                    <th className="text-right p-3 font-semibold">Rate/Value</th>
                    <th className="text-right p-3 font-semibold">Min Fee</th>
                    <th className="text-right p-3 font-semibold">Max Fee</th>
                    <th className="text-center p-3 font-semibold">Priority</th>
                    <th className="text-center p-3 font-semibold">Active</th>
                    <th className="text-center p-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(rules ?? []).map((rule) => {
                    const FeeIcon = feeTypeIcon[rule.feeType as keyof typeof feeTypeIcon] ?? DollarSign;
                    return (
                      <tr key={rule.id} className={`border-b last:border-0 hover:bg-muted/30 ${!rule.active ? "opacity-50" : ""}`}>
                        <td className="p-3 font-medium">{rule.name}</td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-xs font-mono">{rule.fromCurrency}→{rule.toCurrency}</Badge>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <FeeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="capitalize">{rule.feeType}</span>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono">
                          {rule.feeType === "percentage" ? `${rule.feeValue}%` : `$${rule.feeValue}`}
                        </td>
                        <td className="p-3 text-right font-mono">${rule.minFee}</td>
                        <td className="p-3 text-right font-mono">${rule.maxFee}</td>
                        <td className="p-3 text-center">
                          <Badge variant="outline" className="text-xs">{rule.priority}</Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Switch
                            checked={rule.active}
                            onCheckedChange={(v) => handleToggle(rule.id, v)}
                          />
                        </td>
                        <td className="p-3 text-center">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600 hover:text-red-700" onClick={() => handleDelete(rule.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Create Rule Dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Fee Rule</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Rule Name</Label>
                <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard USD→NGN" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">From Currency</Label>
                  <Select value={form.fromCurrency} onValueChange={v => setForm(f => ({ ...f, fromCurrency: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">To Currency</Label>
                  <Select value={form.toCurrency} onValueChange={v => setForm(f => ({ ...f, toCurrency: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Fee Type</Label>
                <Select value={form.feeType} onValueChange={v => setForm(f => ({ ...f, feeType: v as any }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="flat">Flat Fee</SelectItem>
                    <SelectItem value="tiered">Tiered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Value {form.feeType === "percentage" ? "(%)" : "($)"}</Label>
                  <Input className="mt-1" type="number" value={form.feeValue} onChange={e => setForm(f => ({ ...f, feeValue: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">Min Fee ($)</Label>
                  <Input className="mt-1" type="number" value={form.minFee} onChange={e => setForm(f => ({ ...f, minFee: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">Max Fee ($)</Label>
                  <Input className="mt-1" type="number" value={form.maxFee} onChange={e => setForm(f => ({ ...f, maxFee: parseFloat(e.target.value) }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Priority (lower = higher priority)</Label>
                <Input className="mt-1" type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) }))} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
                <Label className="text-sm">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending || !form.name}>
                {createMutation.isPending ? "Creating..." : "Create Rule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
