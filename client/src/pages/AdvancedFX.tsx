import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, ArrowRight, Shield, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function AdvancedFX() {
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [amount, setAmount] = useState("1000");
  const comparison = trpc.advancedFx.rateComparison.useQuery({ fromCurrency: from, toCurrency: to, amount: Number(amount) || 1000 });
  const multiLeg = trpc.advancedFx.multiLegOptimization.useQuery({ fromCurrency: from, toCurrency: to, amount: Number(amount) || 1000 });
  const corridorHealth = trpc.advancedFx.corridorHealth.useQuery({ fromCurrency: from, toCurrency: to });
  const limitOrders = trpc.advancedFx.getActiveLimitOrders.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Advanced FX">
      <h1 className="text-2xl font-bold">Advanced FX Tools</h1>
      <div className="flex gap-3 flex-wrap">
        <Select value={from} onValueChange={setFrom}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="GBP">GBP</SelectItem><SelectItem value="EUR">EUR</SelectItem></SelectContent></Select>
        <ArrowRight className="h-5 w-5 self-center text-muted-foreground" />
        <Select value={to} onValueChange={setTo}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NGN">NGN</SelectItem><SelectItem value="KES">KES</SelectItem><SelectItem value="GHS">GHS</SelectItem></SelectContent></Select>
        <Input className="w-32" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" aria-label="Amount" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Rate Comparison</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {comparison.data?.comparisons.map((p: { provider: string; rate: number; fee: number; total: number; speed: string; highlight: boolean }, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <div><span className="font-medium">{p.provider}</span> {p.highlight && <Badge variant="default" className="ml-2">Best</Badge>}</div>
                <div className="text-right"><p className="font-medium">₦{p.total.toLocaleString()}</p><p className="text-xs text-muted-foreground">Fee: ${p.fee.toFixed(2)} · {p.speed}</p></div>
              </div>
            ))}
            {comparison.data && <p className="text-sm text-green-600 mt-2">{comparison.data.remitflowSavings}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" /> Multi-Leg Routes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {multiLeg.data && (
              <>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium">{multiLeg.data.bestRoute.path.join(" → ")}</span>
                  <Badge variant="default">Best</Badge>
                </div>
                {multiLeg.data.alternatives.map((r: { path: string[]; legs: number; estimatedFee: number; estimatedTime: string }, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm">{r.path.join(" → ")}</span>
                    <span className="text-xs text-muted-foreground">{r.estimatedTime}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Corridor Health</CardTitle></CardHeader>
          <CardContent>
            {corridorHealth.data && (
              <div className="space-y-2">
                <div className="flex justify-between"><span>Corridor</span><span className="font-medium">{corridorHealth.data.corridor}</span></div>
                <div className="flex justify-between"><span>Speed</span><Badge variant="outline">{corridorHealth.data.speed}</Badge></div>
                <div className="flex justify-between"><span>Volume</span><Badge variant="outline">{corridorHealth.data.volumeLevel}</Badge></div>
                <div className="flex justify-between"><span>24h Transactions</span><span>{corridorHealth.data.recentTransactions24h}</span></div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Active Limit Orders</CardTitle></CardHeader>
          <CardContent>
            {limitOrders.data?.length ? limitOrders.data.map((o: { id: number; fromCurrency: string; toCurrency: string; targetRate: string | null }, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <span>{o.fromCurrency}→{o.toCurrency}</span>
                <span className="font-medium">@ {o.targetRate}</span>
              </div>
            )) : <p className="text-muted-foreground">No active limit orders</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
