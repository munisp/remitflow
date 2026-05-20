import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Calculator, TrendingUp, Info, RefreshCw, Star } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["USD","GBP","EUR","NGN","KES","GHS","ZAR","TZS","UGX","RWF","XOF","EGP","SAR","AED","CNY","INR","CAD","AUD","MAD","ETB","MXN","BRL","JPY","SGD","HKD","CHF","SEK","NOK","DKK","PLN"];

const POPULAR_PAIRS = [
  { from: "GBP", to: "NGN", label: "UK → Nigeria" },
  { from: "USD", to: "NGN", label: "US → Nigeria" },
  { from: "EUR", to: "GHS", label: "EU → Ghana" },
  { from: "USD", to: "KES", label: "US → Kenya" },
  { from: "GBP", to: "GHS", label: "UK → Ghana" },
  { from: "CAD", to: "NGN", label: "Canada → Nigeria" },
];

export default function RateCalculator() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [history, setHistory] = useState<Array<{from:string;to:string;amount:string;result:string;rate:string}>>([]);

  const { data: rates, refetch, isFetching } = trpc.fx.liveRates.useQuery({ base: from });
  const rateMap: Record<string, number> = (rates as any)?.rates ?? {};
  const rate = rateMap[to] ?? 0;
  const converted = rate ? (parseFloat(amount || "0") * rate).toFixed(2) : "—";

  // Use transfer.quote for corridor-specific fee (replaces hardcoded 0.5%)
  const { data: quote } = trpc.transfer.quote.useQuery(
    { fromCurrency: from, toCurrency: to, amount: parseFloat(amount) || 0 },
    { enabled: !!amount && parseFloat(amount) > 0 && rate > 0 }
  );
  const fee = quote?.fee ?? parseFloat(amount || "0") * 0.005;
  const feeRate = parseFloat(amount || "0") > 0 ? ((fee / parseFloat(amount)) * 100).toFixed(2) : "0.50";
  const recipientGets = quote?.toAmount?.toFixed(2) ?? (rate ? ((parseFloat(amount || "0") - fee) * rate).toFixed(2) : "—");

  const swap = () => { setFrom(to); setTo(from); };

  const saveToHistory = () => {
    if (!rate || !amount) return;
    const entry = { from, to, amount, result: converted, rate: rate.toFixed(4) };
    setHistory(h => [entry, ...h.slice(0, 9)]);
    toast.success("Saved to history");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Calculator className="w-7 h-7 text-indigo-600" /> Rate Calculator</h1>
          <p className="text-muted-foreground">Real-time exchange rates with fee breakdown</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calculator */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Currency Converter</span>
                <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label>You send</Label>
                  <div className="flex gap-2">
                    <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="flex-1" />
                    <Select value={from} onValueChange={setFrom}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="outline" size="icon" onClick={swap} className="mb-0.5"><ArrowRightLeft className="w-4 h-4" /></Button>
                <div className="flex-1">
                  <Label>Recipient gets</Label>
                  <div className="flex gap-2">
                    <Input value={converted} readOnly className="flex-1 bg-muted font-semibold text-lg" />
                    <Select value={to} onValueChange={setTo}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Rate display */}
              {rate > 0 && (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
                    <TrendingUp className="w-4 h-4" />
                    <span className="font-semibold">1 {from} = {rate.toFixed(4)} {to}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-white dark:bg-gray-800 rounded p-2">
                      <p className="text-muted-foreground text-xs">Mid-market rate</p>
                      <p className="font-medium">{rate.toFixed(4)}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded p-2">
                      <p className="text-muted-foreground text-xs">Our rate ({feeRate}% fee)</p>
                      <p className="font-medium">{(rate * (1 - parseFloat(feeRate) / 100)).toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Fee breakdown */}
              {amount && rate > 0 && (
                <div className="border rounded-lg p-3 text-sm space-y-1.5">
                  <p className="font-medium flex items-center gap-1"><Info className="w-4 h-4 text-blue-500" /> Fee Breakdown</p>
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount you send</span><span>{parseFloat(amount).toFixed(2)} {from}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Transfer fee ({feeRate}%)</span><span>-{fee.toFixed(2)} {from}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount converted</span><span>{(parseFloat(amount) - fee).toFixed(2)} {from}</span></div>
                  <div className="flex justify-between font-semibold border-t pt-1.5"><span>Recipient gets</span><span className="text-green-600">{recipientGets} {to}</span></div>
                </div>
              )}

              <div className="flex gap-2">
                <Button className="flex-1" onClick={saveToHistory} disabled={!rate}>
                  <Star className="w-4 h-4 mr-2" /> Save to History
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => window.location.href = "/send-money"}>
                  Send Money Now
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Popular Pairs + History */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Popular Corridors</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {POPULAR_PAIRS.map(p => (
                  <button key={`${p.from}-${p.to}`} onClick={() => { setFrom(p.from); setTo(p.to); }}
                    className="w-full text-left p-2 rounded hover:bg-muted transition-colors text-sm flex justify-between items-center">
                    <span>{p.label}</span>
                    <span className="text-muted-foreground text-xs">{p.from} → {p.to}</span>
                  </button>
                ))}
              </CardContent>
            </Card>

            {history.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Recent Calculations</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {history.map((h, i) => (
                    <div key={i} className="text-xs p-2 bg-muted/50 rounded">
                      <p className="font-medium">{h.amount} {h.from} = {h.result} {h.to}</p>
                      <p className="text-muted-foreground">Rate: {h.rate}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
