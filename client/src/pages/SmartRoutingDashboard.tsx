import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Route, Zap, TrendingDown, Clock, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const PROVIDERS = [
  { id: "wise", name: "Wise", fee: 0.5, time: 60, reliability: 99.8, color: "bg-green-500" },
  { id: "ripple", name: "Ripple ODL", fee: 0.3, time: 30, reliability: 99.5, color: "bg-blue-500" },
  { id: "swift", name: "SWIFT", fee: 2.5, time: 86400, reliability: 99.9, color: "bg-purple-500" },
  { id: "mojaloop", name: "Mojaloop", fee: 0.1, time: 120, reliability: 98.5, color: "bg-orange-500" },
  { id: "paypal", name: "PayPal", fee: 1.5, time: 300, reliability: 99.2, color: "bg-yellow-500" },
];

export default function SmartRoutingDashboard() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("1000");
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [priority, setPriority] = useState<"speed" | "cost" | "balanced">("balanced");
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);

  const { data: routeData, isLoading, isError } = trpc.smartRouting.getRoute.useQuery(
    { fromCurrency, toCurrency, amount: parseFloat(amount) || 1000, priority: priority === "balanced" ? "cost" : priority },
    { enabled: parseFloat(amount) > 0 }
  );
  const { data: corridorData } = trpc.smartRouting.corridorHealth.useQuery();

  const decisions: any[] = [];

  const simulateRouting = () => {
    setSimLoading(true);
    setTimeout(() => {
      const amt = parseFloat(amount) || 1000;
      const scored = PROVIDERS.map(p => {
        const feeCost = (p.fee / 100) * amt;
        const timeScore = priority === "speed" ? (1 - p.time / 90000) * 50 : priority === "cost" ? 0 : (1 - p.time / 90000) * 25;
        const costScore = priority === "cost" ? (1 - feeCost / (amt * 0.03)) * 50 : priority === "speed" ? 0 : (1 - feeCost / (amt * 0.03)) * 25;
        const relScore = p.reliability * 0.25;
        return { ...p, feeCost, score: Math.max(0, Math.min(100, timeScore + costScore + relScore)) };
      }).sort((a, b) => b.score - a.score);
      setSimResult({ providers: scored, selected: scored[0], amount: amt });
      setSimLoading(false);
      toast.success(`Best route: ${scored[0].name} (score: ${scored[0].score.toFixed(1)})`);
    }, 800);
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Route className="w-6 h-6 text-primary" />
            Smart Routing Engine
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered transfer routing optimization across all payment corridors</p>
        </div>
      </div>

      {/* Routing Simulator */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Route Simulator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
              <Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">From</label>
              <Select value={fromCurrency} onValueChange={setFromCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD", "GBP", "EUR", "CAD", "AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">To</label>
              <Select value={toCurrency} onValueChange={setToCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NGN", "GHS", "KES", "ZAR", "INR", "PHP", "MXN"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
              <Select value={priority} onValueChange={v => setPriority(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="speed">Fastest</SelectItem>
                  <SelectItem value="cost">Cheapest</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={simulateRouting} disabled={simLoading}>
                {simLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Simulate"}
              </Button>
            </div>
          </div>

          {simResult && (
            <div className="space-y-3 mt-4">
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Recommended: {simResult.selected.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Fee: ${simResult.selected.feeCost.toFixed(2)} · 
                    Time: {simResult.selected.time < 3600 ? `${simResult.selected.time / 60}min` : `${simResult.selected.time / 3600}h`} · 
                    Reliability: {simResult.selected.reliability}% · 
                    Score: {simResult.selected.score.toFixed(1)}/100
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {simResult.providers.map((p: any, i: number) => (
                  <div key={p.id} className={`flex items-center gap-3 p-2 rounded-lg ${i === 0 ? "bg-muted" : ""}`}>
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <div className={`w-2 h-2 rounded-full ${p.color}`} />
                    <span className="text-sm font-medium w-28">{p.name}</span>
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div className={`h-2 rounded-full ${p.color}`} style={{ width: `${p.score}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-16 text-right">{p.score.toFixed(1)}/100</span>
                    <span className="text-xs text-muted-foreground w-20 text-right">${p.feeCost.toFixed(2)} fee</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Routing History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Routing Decisions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading history...</div>
          ) : decisions.length === 0 ? (
            <div className="p-8 text-center">
              <Route className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No routing decisions yet. Use the simulator above to test routes.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corridor</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Est. Fee</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.fromCurrency} → {d.toCurrency}</TableCell>
                    <TableCell>${parseFloat(d.amount).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{d.selectedProvider}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.estimatedFee ? `$${parseFloat(d.estimatedFee).toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell>
                      <span className={parseFloat(d.score) >= 80 ? "text-green-600" : parseFloat(d.score) >= 60 ? "text-yellow-600" : "text-red-600"}>
                        {parseFloat(d.score).toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
