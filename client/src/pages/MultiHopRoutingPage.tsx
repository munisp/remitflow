import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Network, ArrowRight, Zap, TrendingDown, CheckCircle2, Clock, Globe, BarChart3 } from "lucide-react";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "UGX", "TZS"];

export default function MultiHopRoutingPage() {
  const { t } = useTranslation();
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [amount, setAmount] = useState("5000");
  const [enabled, setEnabled] = useState(false);

  const { data: routeData, isLoading } = trpc.v99.multiHopRouting.findOptimalRoute.useQuery(
    { fromCurrency, toCurrency, amount: parseFloat(amount) || 5000 },
    { enabled }
  );

  const { data: history } = trpc.v99.multiHopRouting.history.useQuery({ limit: 10 });

  const handleFind = () => {
    if (!parseFloat(amount) || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    setEnabled(true);
  };

  const routeColors = ["bg-blue-50 border-blue-200", "bg-emerald-50 border-emerald-200", "bg-purple-50 border-purple-200"];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Network className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Multi-Hop FX Routing</h1>
            <p className="text-muted-foreground text-sm">Optimize transfer routes across multiple currency hops to minimize fees</p>
          </div>
        </div>

        {/* Route Finder */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" /> Route Optimizer
            </CardTitle>
            <CardDescription>Find the cheapest multi-hop path for your transfer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>From</Label>
                <Select value={fromCurrency} onValueChange={(v) => { setFromCurrency(v); setEnabled(false); }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>To</Label>
                <Select value={toCurrency} onValueChange={(v) => { setToCurrency(v); setEnabled(false); }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount ({fromCurrency})</Label>
                <Input type="number" className="mt-1" value={amount} onChange={e => { setAmount(e.target.value); setEnabled(false); }} />
              </div>
            </div>
            <Button onClick={handleFind} disabled={isLoading} className="w-full">
              {isLoading ? "Finding optimal route..." : <><Network className="h-4 w-4 mr-2" /> Find Optimal Route</>}
            </Button>
          </CardContent>
        </Card>

        {/* Route Results */}
        {routeData && (
          <>
            {/* Optimal Route Banner */}
            <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span className="font-bold text-emerald-800">Optimal Route: {routeData.optimalRoute?.label}</span>
                </div>
                {routeData.savings > 0 && (
                  <Badge className="bg-emerald-600 text-white">Save ${routeData.savings.toFixed(2)} ({routeData.savingsPct}%)</Badge>
                )}
              </div>
              {/* Visual hop diagram */}
              <div className="flex items-center gap-2 flex-wrap">
                {routeData.optimalRoute?.hops.map((hop, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="rounded-lg bg-white border border-emerald-300 px-3 py-1.5 text-sm font-semibold">
                      {hop.from}
                    </div>
                    <div className="flex flex-col items-center">
                      <ArrowRight className="h-4 w-4 text-emerald-600" />
                      <span className="text-xs text-muted-foreground">{hop.provider}</span>
                    </div>
                    {i === (routeData.optimalRoute?.hops.length ?? 0) - 1 && (
                      <div className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm font-semibold">
                        {hop.to}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-3 text-sm">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <TrendingDown className="h-3.5 w-3.5" /> Fee: <strong>${routeData.optimalRoute?.totalFee.toFixed(2)}</strong>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> {routeData.optimalRoute?.estimatedDelivery}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Zap className="h-3.5 w-3.5" /> {Math.round((routeData.optimalRoute?.confidence ?? 0) * 100)}% confidence
                </span>
              </div>
            </div>

            {/* All Routes Comparison */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Available Routes</CardTitle>
                <CardDescription>Compare all routing options for {fromCurrency} → {toCurrency}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {routeData.routes.map((route, i) => route && (
                  <div key={i} className={`rounded-lg border p-3 ${routeColors[i % routeColors.length]} ${route.label === routeData.optimalRoute?.label ? "ring-2 ring-primary/30" : ""}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{route.label}</span>
                        {route.label === routeData.optimalRoute?.label && <Badge className="text-xs">Recommended</Badge>}
                      </div>
                      <span className="font-bold text-sm">${route.totalFee.toFixed(2)} fee</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {route.hops.map((hop, j) => (
                        <span key={j} className="flex items-center gap-1">
                          <span className="bg-white rounded px-1.5 py-0.5 border">{hop.from}</span>
                          <ArrowRight className="h-3 w-3" />
                          {j === route.hops.length - 1 && <span className="bg-white rounded px-1.5 py-0.5 border">{hop.to}</span>}
                        </span>
                      ))}
                      <span className="ml-2">· {route.estimatedDelivery}</span>
                      <span>· {Math.round(route.confidence * 100)}% confidence</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}

        {/* Corridor Analytics */}
        {history && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Corridor Routing Analytics
              </CardTitle>
              <CardDescription>Multi-hop usage and savings by corridor</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-semibold">Corridor</th>
                      <th className="text-right py-2 font-semibold">Direct Route %</th>
                      <th className="text-right py-2 font-semibold">Multi-Hop Savings</th>
                      <th className="text-right py-2 font-semibold">Avg Hops</th>
                      <th className="text-right py-2 font-semibold">30d Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 font-medium">{row.corridor}</td>
                        <td className="py-2 text-right">{row.directRouteUsagePct}%</td>
                        <td className="py-2 text-right text-emerald-600">${row.multiHopSavings.toLocaleString()}</td>
                        <td className="py-2 text-right">{row.avgHops}</td>
                        <td className="py-2 text-right">${row.volume30d.toLocaleString()}</td>
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
