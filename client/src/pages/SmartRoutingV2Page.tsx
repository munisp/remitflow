import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Route, Zap, DollarSign, Shield, RefreshCw } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function SmartRoutingV2Page() {
  const [tab, setTab] = useState<"simulate" | "decisions" | "stats">("simulate");
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [amount, setAmount] = useState("1000");
  const [priority, setPriority] = useState<"speed" | "cost" | "reliability">("cost");
  const [simResult, setSimResult] = useState<any | null>(null);

  const decisionsQuery = trpc.v89.smartRoutingV2.getDecisions.useQuery({ limit: 50, offset: 0 });
  const statsQuery = trpc.v89.smartRoutingV2.getStats.useQuery();

  const simulateMutation = trpc.v89.smartRoutingV2.simulateRoute.useMutation({
    onSuccess: (data) => setSimResult(data),
    onError: (e) => toast.error(e.message),
  });

  const handleSimulate = () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount"); return; }
    simulateMutation.mutate({ fromCurrency, toCurrency, amount: amt, priority });
  };

  const PRIORITY_ICONS = { speed: Zap, cost: DollarSign, reliability: Shield };
  const PriorityIcon = PRIORITY_ICONS[priority];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Smart Routing v2</h1>
        <p className="text-muted-foreground text-sm mt-1">AI-powered payment corridor optimization and routing decisions</p>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(["simulate", "decisions", "stats"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "simulate" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Route className="w-5 h-5 text-blue-400" /> Route Simulator</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>From Currency</Label>
                  <Select value={fromCurrency} onValueChange={setFromCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>To Currency</Label>
                  <Select value={toCurrency} onValueChange={setToCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["NGN", "KES", "GHS", "ZAR", "INR", "PHP", "MXN", "BRL"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
              </div>
              <div className="space-y-1">
                <Label>Optimization Priority</Label>
                <div className="flex gap-2">
                  {(["speed", "cost", "reliability"] as const).map((p) => {
                    const Icon = PRIORITY_ICONS[p];
                    return (
                      <DashboardLayout>
                      <button key={p} onClick={() => setPriority(p)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 text-sm rounded-lg border transition-colors ${priority === p ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                        <Icon className="w-3 h-3" />{p}
                      </button>
                    
                      </DashboardLayout>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full" onClick={handleSimulate} disabled={simulateMutation.isPending}>
                <PriorityIcon className="w-4 h-4 mr-2" />
                {simulateMutation.isPending ? "Simulating..." : "Simulate Route"}
              </Button>
            </CardContent>
          </Card>

          {simResult && (
            <div className="space-y-4">
              <Card className="bg-card border-primary/50 border-2">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-green-400">Recommended: {simResult.recommended.provider}</CardTitle>
                    <Badge className="bg-green-500/20 text-green-400">Best {priority}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-foreground">${simResult.recommended.fee.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Fee</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">
                      {simResult.recommended.estimatedMinutes < 60 ? `${simResult.recommended.estimatedMinutes}m` : `${Math.round(simResult.recommended.estimatedMinutes / 60)}h`}
                    </p>
                    <p className="text-xs text-muted-foreground">ETA</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{(simResult.recommended.successRate * 100).toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">Success Rate</p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Alternatives</p>
                {simResult.alternatives.map((alt: any) => (
                  <Card key={alt.provider} className="bg-card border-border">
                    <CardContent className="p-3 flex items-center justify-between">
                      <p className="font-medium text-sm">{alt.provider}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>${alt.fee.toFixed(2)} fee</span>
                        <span>{alt.estimatedMinutes < 60 ? `${alt.estimatedMinutes}m` : `${Math.round(alt.estimatedMinutes / 60)}h`}</span>
                        <span>{(alt.successRate * 100).toFixed(1)}%</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span>Model: {simResult.modelVersion}</span>
                <span>·</span>
                <span>Confidence: {(simResult.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "decisions" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Routing Decisions ({decisionsQuery.data?.total ?? 0})</CardTitle>
            <Button size="sm" variant="outline" onClick={() => decisionsQuery.refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="p-3 text-left">ID</th>
                    <th className="p-3 text-left">Corridor</th>
                    <th className="p-3 text-left">Amount</th>
                    <th className="p-3 text-left">Provider</th>
                    <th className="p-3 text-left">Est. Fee</th>
                    <th className="p-3 text-left">Score</th>
                    <th className="p-3 text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(decisionsQuery.data?.decisions ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-mono text-xs text-muted-foreground">#{d.id}</td>
                      <td className="p-3 font-mono text-xs">{d.fromCurrency}→{d.toCurrency}</td>
                      <td className="p-3">${d.amount.toFixed(2)}</td>
                      <td className="p-3 font-medium">{d.selectedProvider}</td>
                      <td className="p-3">${d.estimatedFee.toFixed(2)}</td>
                      <td className="p-3">
                        <Badge className={d.score >= 0.9 ? "bg-green-500/20 text-green-400" : d.score >= 0.7 ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}>
                          {(d.score * 100).toFixed(0)}%
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "stats" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">Overview</CardTitle></CardHeader>
            <CardContent>
              <p className="text-4xl font-bold text-foreground">{statsQuery.data?.totalDecisions ?? 0}</p>
              <p className="text-sm text-muted-foreground">Total Routing Decisions</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">Top Providers</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(statsQuery.data?.topProviders ?? []).map((p: any, i: number) => (
                <div key={p.provider} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4">#{i + 1}</span>
                    <span className="text-sm font-medium">{p.provider}</span>
                  </div>
                  <Badge className="bg-primary/20 text-primary">{p.count} decisions</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
