import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Droplets, AlertTriangle, ArrowRightLeft, RefreshCw, CheckCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function LiquidityMonitorPage() {
  const [rebalanceDialog, setRebalanceDialog] = useState(false);
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("GHS");
  const [amount, setAmount] = useState("");

  const { data, refetch } = trpc.v100.liquidityEngine.getPoolStatus.useQuery(undefined, { refetchInterval: 30000 });
  const rebalanceMutation = trpc.v100.liquidityEngine.rebalance.useMutation({
    onSuccess: (d) => {
      toast.success(`Rebalanced ${d.amount.toLocaleString()} ${d.from} → ${d.to}`);
      setRebalanceDialog(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusColor = (status: string) => {
    if (status === "healthy") return "text-green-500";
    if (status === "warning") return "text-orange-500";
    return "text-red-500";
  };

  const statusBadge = (status: string) => {
    if (status === "healthy") return "default";
    if (status === "warning") return "secondary";
    return "destructive";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Liquidity Monitor</h1>
          <p className="text-muted-foreground">Real-time liquidity pool management across currencies</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Dialog open={rebalanceDialog} onOpenChange={setRebalanceDialog}>
            <DialogTrigger asChild>
              <Button><ArrowRightLeft className="w-4 h-4 mr-2" />Rebalance</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Rebalance Liquidity Pool</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>From Currency</Label>
                  <Select value={fromCurrency} onValueChange={setFromCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["USD","EUR","GBP","NGN","GHS","KES"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>To Currency</Label>
                  <Select value={toCurrency} onValueChange={setToCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["USD","EUR","GBP","NGN","GHS","KES"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Amount ({fromCurrency})</Label>
                  <Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 500000" type="number" />
                </div>
                <Button className="w-full" onClick={() => {
                  if (!amount) return toast.error("Enter amount");
                  rebalanceMutation.mutate({ fromCurrency, toCurrency, amount: Number(amount) });
                }} disabled={rebalanceMutation.isPending}>
                  {rebalanceMutation.isPending ? "Executing..." : "Execute Rebalance"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Alerts */}
      {data?.alerts && data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
              <div>
                <p className="font-medium text-sm">{alert.currency} — {alert.type.replace(/_/g, " ").toUpperCase()}</p>
                <p className="text-xs text-muted-foreground">{alert.message}</p>
              </div>
              <Badge variant="secondary" className="ml-auto">{alert.severity}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Pool Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data?.pools ?? []).map(pool => {
          const usedPct = ((pool.reserved / pool.total) * 100).toFixed(1);
          const availablePct = ((pool.available / pool.total) * 100).toFixed(1);
          const atRisk = pool.available < pool.minRequired;
          return (
            <DashboardLayout>
            <Card key={pool.currency} className={atRisk ? "border-orange-400" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Droplets className={`w-5 h-5 ${statusColor(pool.status)}`} />
                    <span className="font-bold text-lg">{pool.currency}</span>
                  </div>
                  <Badge variant={statusBadge(pool.status) as any}>{pool.status}</Badge>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Available</span>
                    <span className="font-semibold text-green-500">{pool.available.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reserved</span>
                    <span className="font-semibold text-orange-500">{pool.reserved.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold">{pool.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Min Required</span>
                    <span className={`font-semibold ${atRisk ? "text-red-500" : "text-muted-foreground"}`}>{pool.minRequired.toLocaleString()}</span>
                  </div>
                </div>

                {/* Utilization Bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Utilization</span>
                    <span>{pool.utilizationPct}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className={`h-2 rounded-full ${pool.utilizationPct > 80 ? "bg-red-500" : pool.utilizationPct > 60 ? "bg-orange-500" : "bg-green-500"}`}
                      style={{ width: `${pool.utilizationPct}%` }} />
                  </div>
                </div>

                {atRisk && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-orange-500">
                    <AlertTriangle className="w-3 h-3" />
                    Below minimum threshold — rebalance recommended
                  </div>
                )}
                {!atRisk && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-green-500">
                    <CheckCircle className="w-3 h-3" />
                    Pool healthy
                  </div>
                )}
              </CardContent>
            </Card>
          
            </DashboardLayout>
          );
        })}
      </div>
    </div>
  );
}
