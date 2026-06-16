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
import { TrendingUp, TrendingDown, Plus, X, BarChart3, DollarSign, Activity } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function FXHedgingPage() {
  const { t } = useTranslation();
  const [openDialog, setOpenDialog] = useState(false);
  const [pair, setPair] = useState("USD/NGN");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [notional, setNotional] = useState("");
  const [duration, setDuration] = useState("7");

  const { data: positions, refetch } = trpc.v100.fxHedging.getPositions.useQuery();
  const { data: analytics } = trpc.v100.fxHedging.getAnalytics.useQuery();

  const openMutation = trpc.v100.fxHedging.openPosition.useMutation({
    onSuccess: () => { toast.success("Position opened successfully"); setOpenDialog(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const closeMutation = trpc.v100.fxHedging.closePosition.useMutation({
    onSuccess: () => { toast.success("Position closed"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleOpen = () => {
    if (!notional || isNaN(Number(notional))) return toast.error("Enter a valid notional amount");
    openMutation.mutate({ pair, direction, notional: Number(notional), durationDays: Number(duration) });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FX Hedging</h1>
          <p className="text-muted-foreground">Manage currency hedge positions and P&L</p>
        </div>
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Open Position</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Open Hedge Position</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Currency Pair</Label>
                <Select value={pair} onValueChange={setPair}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD/NGN","USD/GHS","USD/KES","EUR/USD","GBP/USD","USD/ZAR"].map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Direction</Label>
                <Select value={direction} onValueChange={(v) => setDirection(v as "long"|"short")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">Long (Buy)</SelectItem>
                    <SelectItem value="short">Short (Sell)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notional Amount (USD)</Label>
                <Input value={notional} onChange={e => setNotional(e.target.value)} placeholder="e.g. 50000" type="number" />
              </div>
              <div><Label>Duration (Days)</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,3,7,14,30,60,90].map(d => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
                  </SelectContent>

                </Select>
              </div>
              <Button className="w-full" onClick={handleOpen} disabled={openMutation.isPending}>
                {openMutation.isPending ? "Opening..." : "Open Position"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Analytics Summary */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Notional</p>
            <p className="text-2xl font-bold">${(analytics.totalNotional / 1000).toFixed(0)}K</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total P&L</p>
            <p className={`text-2xl font-bold ${analytics.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {analytics.totalPnl >= 0 ? "+" : ""}${analytics.totalPnl.toLocaleString()}
            </p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Active Positions</p>
            <p className="text-2xl font-bold">{analytics.activePositions}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Avg P&L %</p>
            <p className="text-2xl font-bold text-green-500">+{analytics.totalPnlPct}%</p>
          </CardContent></Card>
        </div>
      )}

      {/* Positions Table */}
      <Card>
        <CardHeader><CardTitle>Open Positions</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left p-2">Pair</th>
                  <th className="text-left p-2">Direction</th>
                  <th className="text-right p-2">Notional</th>
                  <th className="text-right p-2">Entry Rate</th>
                  <th className="text-right p-2">Current</th>
                  <th className="text-right p-2">P&L</th>
                  <th className="text-left p-2">Expires</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(positions ?? []).map(pos => (
                  <tr key={pos.id} className="border-b hover:bg-muted/30">
                    <td className="p-2 font-mono font-semibold">{pos.pair}</td>
                    <td className="p-2">
                      <Badge variant={pos.direction === "long" ? "default" : "secondary"}>
                        {pos.direction === "long" ? <TrendingUp className="w-3 h-3 mr-1 inline" /> : <TrendingDown className="w-3 h-3 mr-1 inline" />}
                        {pos.direction}
                      </Badge>
                    </td>
                    <td className="p-2 text-right">${pos.notional.toLocaleString()}</td>
                    <td className="p-2 text-right font-mono">{pos.entryRate.toFixed(4)}</td>
                    <td className="p-2 text-right font-mono">{pos.currentRate.toFixed(4)}</td>
                    <td className={`p-2 text-right font-semibold ${pos.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {pos.pnl >= 0 ? "+" : ""}${pos.pnl} ({pos.pnlPct}%)
                    </td>
                    <td className="p-2 text-xs">{new Date(pos.expiresAt).toLocaleDateString()}</td>
                    <td className="p-2">
                      <Badge variant={pos.status === "active" ? "default" : "destructive"}>
                        {pos.status}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Button size="sm" variant="outline" onClick={() => closeMutation.mutate({ positionId: pos.id })}>
                        <X className="w-3 h-3 mr-1" />Close
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Monthly P&L Chart */}
      {analytics && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="w-4 h-4" />Monthly P&L</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {analytics.monthlyPnl.map(m => {
                const max = Math.max(...analytics.monthlyPnl.map(x => Math.abs(x.pnl)));
                const h = Math.round((Math.abs(m.pnl) / max) * 100);
                return (
                  <DashboardLayout>
                  <div key={m.month} className="flex flex-col items-center flex-1">
                    <div className={`w-full rounded-t ${m.pnl >= 0 ? "bg-green-500" : "bg-red-500"}`} style={{ height: `${h}%` }} />
                    <span className="text-xs mt-1">{m.month}</span>
                    <span className={`text-xs font-semibold ${m.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {m.pnl >= 0 ? "+" : ""}${(m.pnl / 1000).toFixed(1)}K
                    </span>
                  </div>
                
                  </DashboardLayout>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
