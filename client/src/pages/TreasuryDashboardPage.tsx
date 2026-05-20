import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { DollarSign, TrendingUp, Shield, BarChart3, PieChart, Activity } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function TreasuryDashboardPage() {
  const { data: positions } = trpc.v100.treasuryManagement.getPositions.useQuery();
  const { data: yield_ } = trpc.v100.treasuryManagement.getYieldAnalytics.useQuery();

  const formatM = (n: number) => n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : `$${(n / 1000).toFixed(0)}K`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Treasury Management</h1>
        <p className="text-muted-foreground">Asset positions, yield analytics, and liquidity ratios</p>
      </div>

      {positions && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" />Total Assets</p>
              <p className="text-2xl font-bold">{formatM(positions.totalAssets)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" />Annualized Yield</p>
              <p className="text-2xl font-bold text-green-500">{yield_?.annualizedYield ?? 4.8}%</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" />LCR</p>
              <p className="text-2xl font-bold">{positions.metrics.liquidityCoverageRatio}%</p>
              <p className="text-xs text-green-500">Min: 100%</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" />NSFR</p>
              <p className="text-2xl font-bold">{positions.metrics.netStableFundingRatio}%</p>
              <p className="text-xs text-green-500">Min: 100%</p>
            </CardContent></Card>
          </div>

          {/* Positions Table */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><PieChart className="w-4 h-4" />Asset Positions</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left p-2">Currency</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-right p-2">Value (USD)</th>
                      <th className="text-right p-2">Allocation</th>
                      <th className="text-right p-2">Yield</th>
                      <th className="text-left p-2">Instrument</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.positions.map(pos => (
                      <tr key={pos.currency} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-mono font-semibold">{pos.currency}</td>
                        <td className="p-2 text-right">{pos.amount.toLocaleString()}</td>
                        <td className="p-2 text-right font-semibold">{formatM(pos.valueUSD)}</td>
                        <td className="p-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-muted rounded-full h-1.5">
                              <div className="bg-primary h-1.5 rounded-full" style={{ width: `${pos.allocation}%` }} />
                            </div>
                            <span>{pos.allocation}%</span>
                          </div>
                        </td>
                        <td className="p-2 text-right text-green-500 font-semibold">{pos.yield}%</td>
                        <td className="p-2"><Badge variant="outline">{pos.instrument}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Liquidity Tiers */}
          <Card>
            <CardHeader><CardTitle>Liquidity Tiers</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Tier 1 (HQLA)", value: positions.liquidity.tier1, color: "bg-green-500", desc: "Cash & Central Bank Reserves" },
                  { label: "Tier 2A", value: positions.liquidity.tier2, color: "bg-blue-500", desc: "Sovereign Bonds (85% haircut)" },
                  { label: "Tier 2B", value: positions.liquidity.tier3, color: "bg-orange-500", desc: "Corporate Bonds (50% haircut)" },
                ].map(t => (
                  <div key={t.label} className="p-4 border rounded-lg">
                    <div className={`w-3 h-3 rounded-full ${t.color} mb-2`} />
                    <p className="font-semibold text-sm">{t.label}</p>
                    <p className="text-xl font-bold">{formatM(t.value)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Monthly Yield Chart */}
      {yield_ && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><BarChart3 className="w-4 h-4" />Monthly Yield</CardTitle>
              <span className="text-sm text-muted-foreground">Total: ${yield_.totalYield.toLocaleString()}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {yield_.monthlyYield.map(m => {
                const max = Math.max(...yield_.monthlyYield.map(x => x.yield));
                const h = Math.round((m.yield / max) * 100);
                return (
                  <DashboardLayout>
                  <div key={m.month} className="flex flex-col items-center flex-1">
                    <div className="w-full bg-green-500 rounded-t" style={{ height: `${h}%` }} />
                    <span className="text-xs mt-1">{m.month}</span>
                    <span className="text-xs font-semibold text-green-500">${(m.yield / 1000).toFixed(0)}K</span>
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
