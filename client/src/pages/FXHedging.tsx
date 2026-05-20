import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Plus, Shield, DollarSign, BarChart3, Clock } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

const CURRENCIES = ["USD", "NGN", "GBP", "EUR", "KES", "GHS", "ZAR", "TZS", "UGX"];

export default function FXHedging() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fromCurrency: "USD", toCurrency: "NGN", amount: "", settlementDays: "30" });

  const { data: contracts, isLoading } = trpc.fxHedging.forwardContracts.useQuery();
  const createMutation = trpc.fxHedging.createForward.useMutation({
    onSuccess: (data) => {
      utils.fxHedging.forwardContracts.invalidate();
      setOpen(false);
      toast.success(`Forward contract created — Ref: ${data.contractId} @ ${data.lockedRate}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const totalNotional = (contracts ?? []).reduce((sum: number, c: any) => sum + Number(c.amount ?? c.notionalAmount ?? 0), 0);
  const activeCount = (contracts ?? []).filter((c: any) => c.status === "active").length;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Shield className="w-6 h-6 text-purple-400" /> FX Hedging</h1>
          <p className="text-muted-foreground text-sm mt-1">Lock in exchange rates with forward contracts to protect against FX volatility</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Forward Contract</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Forward Contract</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From Currency</Label>
                  <Select value={form.fromCurrency} onValueChange={v => setForm(f => ({ ...f, fromCurrency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>To Currency</Label>
                  <Select value={form.toCurrency} onValueChange={v => setForm(f => ({ ...f, toCurrency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Amount ({form.fromCurrency})</Label>
                <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="10000" />
              </div>
              <div>
                <Label>Settlement (days from today)</Label>
                <Select value={form.settlementDays} onValueChange={v => setForm(f => ({ ...f, settlementDays: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["7", "14", "30", "60", "90", "180", "365"].map(d => <SelectItem key={d} value={d}>{d} days</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
                <p>• A 5% margin will be required to open the contract</p>
                <p>• Rate is locked at the current interbank mid-rate</p>
                <p>• Settlement occurs automatically on the maturity date</p>
              </div>
              <Button className="w-full" onClick={() => createMutation.mutate({ fromCurrency: form.fromCurrency, toCurrency: form.toCurrency, amount: parseFloat(form.amount), settlementDays: parseInt(form.settlementDays) })} disabled={!form.amount || createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Lock Rate & Create Contract"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Contracts", value: activeCount, icon: Shield, color: "text-green-400" },
          { label: "Total Notional", value: `$${totalNotional.toLocaleString()}`, icon: DollarSign, color: "text-blue-400" },
          { label: "Margin Required (5%)", value: `$${(totalNotional * 0.05).toLocaleString()}`, icon: BarChart3, color: "text-yellow-400" },
          { label: "Total Contracts", value: (contracts ?? []).length, icon: TrendingUp, color: "text-purple-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
              </div>
              <Icon className={`w-8 h-8 ${color} opacity-60`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Forward Contracts</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : (contracts ?? []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No forward contracts</p>
              <p className="text-sm mt-1">Create a forward contract to lock in today's exchange rate for a future transfer</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-border text-xs">
                    <th className="text-left py-2">Pair</th>
                    <th className="text-right py-2">Amount</th>
                    <th className="text-right py-2">Locked Rate</th>
                    <th className="text-right py-2">Settlement</th>
                    <th className="text-right py-2">Margin (5%)</th>
                    <th className="text-right py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(contracts ?? []).map((c: any) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 font-mono text-indigo-400">{c.fromCurrency ?? c.from_currency}/{c.toCurrency ?? c.to_currency}</td>
                      <td className="text-right py-2 font-medium">{Number(c.amount).toLocaleString()}</td>
                      <td className="text-right py-2 font-mono">{Number(c.lockedRate ?? c.locked_rate).toFixed(4)}</td>
                      <td className="text-right py-2 text-muted-foreground">
                        <span className="flex items-center justify-end gap-1"><Clock className="w-3 h-3" />{new Date(c.settlementDate ?? c.settlement_date).toLocaleDateString()}</span>
                      </td>
                      <td className="text-right py-2 text-yellow-400">${(Number(c.amount) * 0.05).toLocaleString()}</td>
                      <td className="text-right py-2"><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">About FX Forward Contracts</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>A <strong className="text-foreground">forward contract</strong> lets you lock in today's exchange rate for a transfer you plan to make in the future — protecting you from adverse currency movements.</p>
          <p><strong className="text-foreground">How it works:</strong> You agree to exchange a fixed amount at a fixed rate on a specific future date. A 5% margin is held as collateral and released on settlement.</p>
          <p><strong className="text-foreground">Best for:</strong> Businesses paying overseas suppliers, diaspora members sending regular support payments, or anyone with predictable future FX needs.</p>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
