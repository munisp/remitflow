import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, RefreshCw, Bell } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "UGX", "TZS", "XOF", "MAD", "EGP", "ETB", "EUR", "GBP", "CAD", "AUD"];

export default function FXStreamingPage() {
  const { t } = useTranslation();
  const [base, setBase] = useState("USD");
  const [alertCurrency, setAlertCurrency] = useState("NGN");
  const [alertRate, setAlertRate] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const { data: rates, refetch, isLoading } = trpc.v90.fxStream.getLatestRates.useQuery(
    { baseCurrency: base, targetCurrencies: CURRENCIES },
    { refetchInterval: 5000 }
  );

  const { data: historical } = trpc.v90.fxStream.getHistoricalRates.useQuery(
    { fromCurrency: base, toCurrency: alertCurrency, days: 30 }
  );

  const alertMutation = trpc.v90.fxStream.getRateAlert.useMutation({
    onSuccess: (data) => toast.success(data.message),
    onError: () => toast.error("Failed to set alert"),
  });

  useEffect(() => {
    if (rates) setLastUpdate(new Date());
  }, [rates]);

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live FX Rates</h1>
          <p className="text-muted-foreground text-sm">Real-time exchange rates with 5-second refresh · Last updated: {lastUpdate.toLocaleTimeString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={base} onValueChange={setBase}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{["USD", "EUR", "GBP", "CAD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* Live Rates Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {isLoading ? Array.from({ length: 10 }).map((_, i) => (
          <Card key={i} className="animate-pulse"><CardContent className="pt-4 h-20 bg-muted/30 rounded" /></Card>
        )) : rates && Object.entries(rates.rates).map(([currency, data]) => (
          <Card key={currency} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm">{base}/{currency}</span>
                {data.change24h >= 0
                  ? <TrendingUp className="w-3 h-3 text-green-500" />
                  : <TrendingDown className="w-3 h-3 text-red-500" />}
              </div>
              <p className="text-xl font-mono font-bold">{data.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
              <p className={`text-xs mt-1 ${data.change24h >= 0 ? "text-green-600" : "text-red-600"}`}>
                {data.change24h >= 0 ? "+" : ""}{data.change24h.toFixed(4)} (24h)
              </p>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Bid: {data.bid.toFixed(2)}</span>
                <span>Ask: {data.ask.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rate Alert Setup */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Set Rate Alert</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-sm font-medium">Currency Pair</label>
              <Select value={alertCurrency} onValueChange={setAlertCurrency}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Direction</label>
              <Select value={alertDirection} onValueChange={(v) => setAlertDirection(v as "above" | "below")}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Goes Above</SelectItem>
                  <SelectItem value="below">Goes Below</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Target Rate</label>
              <Input className="w-32" type="number" placeholder="e.g. 1600" value={alertRate} onChange={e => setAlertRate(e.target.value)} />
            </div>
            <Button
              onClick={() => alertMutation.mutate({ fromCurrency: base, toCurrency: alertCurrency, targetRate: parseFloat(alertRate), direction: alertDirection })}
              disabled={!alertRate || alertMutation.isPending}
            >
              <Bell className="w-4 h-4 mr-2" /> Set Alert
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Historical Chart Summary */}
      {historical && (
        <Card>
          <CardHeader><CardTitle>{base}/{alertCurrency} — 30-Day History</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div><p className="text-muted-foreground text-xs">Current</p><p className="text-xl font-bold">{historical.points[historical.points.length - 1]?.rate.toFixed(2)}</p></div>
              <div><p className="text-muted-foreground text-xs">30-Day High</p><p className="text-xl font-bold text-green-600">{Math.max(...historical.points.map(p => p.rate)).toFixed(2)}</p></div>
              <div><p className="text-muted-foreground text-xs">30-Day Low</p><p className="text-xl font-bold text-red-600">{Math.min(...historical.points.map(p => p.rate)).toFixed(2)}</p></div>
              <div><p className="text-muted-foreground text-xs">Avg Volume</p><p className="text-xl font-bold">{(historical.points.reduce((s, p) => s + p.volume, 0) / historical.points.length / 1000).toFixed(0)}K</p></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
