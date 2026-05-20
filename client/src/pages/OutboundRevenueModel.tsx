import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Loader2, TrendingUp } from "lucide-react";

export default function OutboundRevenueModel() {
  const { isAuthenticated } = useAuth();
  const [dailyVolume, setDailyVolume] = useState("500000000");
  const [fxRate, setFxRate] = useState("1600");
  const [years, setYears] = useState("5");
  const [scenario, setScenario] = useState("base");

  const scenarioQuery = trpc.outbound.analytics.scenarioModel.useQuery({
    base_daily_volume_ngn:parseFloat(dailyVolume)||500000000,
    growth_scenarios:{bear:0.10,base:0.25,bull:0.45},
    segment_mix:{labor:0.55,education:0.20,medical:0.10,sme:0.10,hnw:0.05},
    years:parseInt(years)||5,
    fx_rate_ngn_usd:parseFloat(fxRate)||1600,
  });

  const floatQuery = trpc.outbound.floatIncome.project.useQuery({
    daily_volume_ngn:parseFloat(dailyVolume)||500000000,
    projection_years:parseInt(years)||5,
  });

  if (!isAuthenticated) return <div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Admin access required.</p></div>;

  const scenarios = (scenarioQuery.data as any)?.scenarios??[];
  const filtered = scenarios.filter((s:any)=>s.scenario===scenario);
  const floatData = (floatQuery.data as any)?.projections??[];

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg"><BarChart3 className="h-6 w-6 text-purple-600"/></div>
        <div>
          <h1 className="text-3xl font-bold">Outbound Revenue Scenario Model</h1>
          <p className="text-muted-foreground">5-year revenue projections across bear / base / bull scenarios</p>
        </div>
      </div>
      <Card>
        <CardHeader><h2 className="text-base font-semibold">Model Parameters</h2></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-2"><Label>Daily Volume (NGN)</Label><Input type="number" value={dailyVolume} onChange={e=>setDailyVolume(e.target.value)}/></div>
          <div className="space-y-2"><Label>FX Rate (NGN/USD)</Label><Input type="number" value={fxRate} onChange={e=>setFxRate(e.target.value)}/></div>
          <div className="space-y-2"><Label>Projection Years</Label><Input type="number" min="1" max="10" value={years} onChange={e=>setYears(e.target.value)}/></div>
          <div className="space-y-2"><Label>Scenario</Label>
            <Select value={scenario} onValueChange={setScenario}><SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="bear">Bear (10% growth)</SelectItem>
                <SelectItem value="base">Base (25% growth)</SelectItem>
                <SelectItem value="bull">Bull (45% growth)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      {scenarioQuery.isPending&&<div className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4"/><span>Running model...</span></div>}
      {filtered.length>0&&(
        <Card>
          <CardHeader><CardTitle>Revenue Projections - {scenario.charAt(0).toUpperCase()+scenario.slice(1)} Case</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2">Year</th>
                  <th className="text-right py-2">Volume (USD)</th>
                  <th className="text-right py-2">Fee Revenue</th>
                  <th className="text-right py-2">FX Spread</th>
                  <th className="text-right py-2">Float Income</th>
                  <th className="text-right py-2">Total Revenue</th>
                </tr></thead>
                <tbody>
                  {filtered.map((s:any)=>(
                    <tr key={s.year} className="border-b last:border-0">
                      <td className="py-2">Y{s.year}</td>
                      <td className="text-right">${(s.volume_usd/1e6).toFixed(1)}M</td>
                      <td className="text-right">${(s.fee_revenue_usd/1e3).toFixed(0)}K</td>
                      <td className="text-right">${(s.fx_spread_revenue_usd/1e3).toFixed(0)}K</td>
                      <td className="text-right">${(s.float_income_usd/1e3).toFixed(0)}K</td>
                      <td className="text-right font-bold">${(s.total_revenue_usd/1e6).toFixed(2)}M</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {floatData.length>0&&(
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4"/>Float Income Detail (Rust Engine)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2">Year</th>
                  <th className="text-right py-2">Avg Float (NGN)</th>
                  <th className="text-right py-2">MPR Rate</th>
                  <th className="text-right py-2">Annual Income (USD)</th>
                </tr></thead>
                <tbody>
                  {floatData.map((f:any)=>(
                    <tr key={f.year} className="border-b last:border-0">
                      <td className="py-2">Y{f.year}</td>
                      <td className="text-right">NGN {(f.average_float_ngn/1e9).toFixed(2)}B</td>
                      <td className="text-right">{(f.mpr_rate*100).toFixed(1)}%</td>
                      <td className="text-right font-bold">${(f.annual_float_income/1e3).toFixed(0)}K</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">Segment mix: Labor 55% / Edu 20% / Med 10% / SME 10% / HNW 5%</Badge>
        <Badge variant="outline">Settlement: 48h float cycle</Badge>
        <Badge variant="outline">CBN MPR: 26.25%</Badge>
      </div>
    </div>
  );
}
