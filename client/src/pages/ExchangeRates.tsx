import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Lock, RefreshCw, Calculator } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function ExchangeRates() {
  const { t } = useTranslation();
  const [fromCcy, setFromCcy] = useState("USD");
  const [toCcy, setToCcy] = useState("NGN");
  const [amount, setAmount] = useState("100");
  const { data, isLoading, refetch, isError } = trpc.fx.rates.useQuery();
  const lockMutation = trpc.fx.lockRate.useMutation({ onSuccess: () => toast.success("Rate locked for 15 minutes!") });

  // API returns a flat array: [{ currency, rate, change, trend, source }]
  // These are all rates vs USD base. Build from→to pairs for display.
  const rawRates = Array.isArray(data) ? data : [];

  // Build a lookup: currency → rate (vs USD)
  const rateMap: Record<string, number> = {};
  rawRates.forEach((r: any) => { rateMap[r.currency] = Number(r.rate); });

  // Cross-rate: from → to = rateMap[to] / rateMap[from]
  const getCrossRate = (from: string, to: string): number => {
    const fromRate = rateMap[from] ?? 1;
    const toRate = rateMap[to] ?? 1;
    return toRate / fromRate;
  };

  const crossRate = getCrossRate(fromCcy, toCcy);
  const converted = (parseFloat(amount || "0") * crossRate).toFixed(2);

  const currencies = ["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF"];

  // Show only the currencies we care about in the list
  const displayRates = rawRates.filter((r: any) =>
    ["NGN", "KES", "GHS", "ZAR", "EUR", "GBP", "TZS", "UGX", "XOF", "AED"].includes(r.currency)
  );

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Exchange Rates</h1>
            <p className="text-muted-foreground text-sm">Live FX rates and currency calculator</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Calculator */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" /> Rate Calculator</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">From</label>
                <div className="flex gap-2">
                  <Select value={fromCcy} onValueChange={setFromCcy}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" type="number" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">To</label>
                <div className="flex gap-2">
                  <Select value={toCcy} onValueChange={setToCcy}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={converted} readOnly className="bg-muted font-semibold" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <span className="text-sm text-muted-foreground">
                1 {fromCcy} = <span className="font-bold text-foreground">{crossRate.toFixed(4)} {toCcy}</span>
              </span>
              <div className="flex gap-2">
                <Badge variant="secondary" className="text-xs">Fee: {(crossRate * 0.01).toFixed(2)}%</Badge>
                <Button size="sm" onClick={() => lockMutation.mutate({ from: fromCcy, to: toCcy, amount: parseFloat(amount || "0"), duration: 15 })}>
                  <Lock className="h-3 w-3 mr-1" /> Lock Rate
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* All Rates vs USD */}
        <Card>
          <CardHeader><CardTitle>Exchange Rates vs USD</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-24"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="divide-y">
                {displayRates.map((r: any) => (
                  <div key={r.currency} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xs">{r.currency}</div>
                      <div>
                        <div className="font-semibold">USD → {r.currency}</div>
                        <div className="text-xs text-muted-foreground">{r.source ?? "Live"}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">{Number(r.rate).toFixed(4)}</div>
                      <div className={`text-xs flex items-center gap-1 ${Number(r.change) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {Number(r.change) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {Number(r.change) >= 0 ? "+" : ""}{Number(r.change).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
