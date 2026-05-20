import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Building2, TrendingUp, RefreshCw, DollarSign, Layers } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function TreasuryManagement() {
  const utils = trpc.useUtils();
  const { data: positions, isLoading: posLoading } = trpc.treasury.positions.useQuery();
  const { data: pools, isLoading: poolLoading } = trpc.treasury.liquidityPools.useQuery();
  const { data: summary } = trpc.treasury.dailySummary.useQuery();

  const rebalanceMutation = trpc.treasury.rebalance.useMutation({
    onSuccess: (data) => {
      utils.treasury.liquidityPools.invalidate();
      toast.success(`Rebalance initiated — Ref: ${data.transactionRef}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const statusBadge = (s: string): "default" | "secondary" | "destructive" =>
    s === "healthy" ? "default" : s === "warning" ? "secondary" : "destructive";

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-indigo-400" /> Treasury Management
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Nostro/vostro positions, liquidity pools, and settlement management
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "24h Volume", value: `$${(summary as any).totalVolume24h}`, icon: DollarSign, color: "text-blue-400" },
            { label: "24h Fees", value: `$${(summary as any).totalFees24h}`, icon: TrendingUp, color: "text-green-400" },
            { label: "Net Revenue", value: `$${(summary as any).netRevenue24h}`, icon: TrendingUp, color: "text-emerald-400" },
            { label: "Liquidity Util.", value: `${(summary as any).liquidityUtilization}%`, icon: Layers, color: "text-purple-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-foreground">{value}</p>
                  </div>
                  <Icon className={`w-8 h-8 ${color} opacity-80`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="positions">
        <TabsList>
          <TabsTrigger value="positions">Currency Positions</TabsTrigger>
          <TabsTrigger value="pools">Liquidity Pools</TabsTrigger>
        </TabsList>

        <TabsContent value="positions">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-sm">Nostro / Vostro Positions</CardTitle></CardHeader>
            <CardContent>
              {posLoading ? (
                <p className="text-muted-foreground text-sm">Loading...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left py-2">Currency</th>
                        <th className="text-right py-2">Nostro</th>
                        <th className="text-right py-2">Vostro</th>
                        <th className="text-right py-2">Net Position</th>
                        <th className="text-right py-2">Required Reserve</th>
                        <th className="text-right py-2">Utilization</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(positions ?? []).map((p: any) => (
                        <tr key={p.currency} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 font-mono font-bold text-indigo-400">{p.currency}</td>
                          <td className="text-right py-2 text-green-400">{Number(p.nostroBalance).toLocaleString()}</td>
                          <td className="text-right py-2 text-blue-400">{Number(p.vostroBalance).toLocaleString()}</td>
                          <td className={`text-right py-2 font-medium ${Number(p.netPosition) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {Number(p.netPosition) >= 0 ? "+" : ""}{Number(p.netPosition).toLocaleString()}
                          </td>
                          <td className="text-right py-2 text-muted-foreground">{Number(p.requiredReserve).toLocaleString()}</td>
                          <td className="text-right py-2">
                            <div className="flex items-center justify-end gap-2">
                              <Progress value={parseFloat(p.utilizationPct)} className="w-16 h-1.5" />
                              <span className="text-xs">{p.utilizationPct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pools">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {poolLoading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : (
              (pools ?? []).map((pool: any) => (
                <Card key={pool.poolId} className="bg-card border-border">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{pool.corridor}</p>
                        <p className="text-xs text-muted-foreground">{pool.providers} liquidity providers · APY {pool.apy}%</p>
                      </div>
                      <Badge variant={statusBadge(pool.status)}>{pool.status}</Badge>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Utilization</span><span>{pool.utilizationPct}%</span>
                      </div>
                      <Progress
                        value={pool.utilizationPct}
                        className={`h-2 ${pool.utilizationPct > 85 ? "[&>div]:bg-red-500" : pool.utilizationPct > 70 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}`}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Total: <span className="text-foreground font-medium">${pool.totalLiquidity}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rebalanceMutation.mutate({
                          poolId: pool.poolId,
                          targetAmount: 1000000,
                          currency: String(pool.corridor).split("→")[0],
                        })}
                        disabled={rebalanceMutation.isPending}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Rebalance
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
