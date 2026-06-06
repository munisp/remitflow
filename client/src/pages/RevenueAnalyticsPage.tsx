import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, BarChart2, Globe } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function RevenueAnalyticsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<"today"|"week"|"month"|"quarter"|"year">("month");
  const { data, isLoading, isError } = trpc.v90.revenueAnalytics.getSummary.useQuery({ period, currency: "USD" });
  const { data: daily } = trpc.v90.revenueAnalytics.getRevenueByDay.useQuery({ days: 30 });
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading revenue analytics...</div>;
  return (
    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Revenue Analytics</h1><p className="text-muted-foreground text-sm">Financial performance by period</p></div>
        <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{["today","week","month","quarter","year"].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Revenue", value: `$${data.totalRevenue.toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
              { label: "Fee Revenue", value: `$${data.feeRevenue.toLocaleString()}`, icon: BarChart2, color: "text-blue-600" },
              { label: "FX Spread Revenue", value: `$${data.fxSpreadRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-purple-600" },
              { label: "Revenue Growth", value: `+${(data.revenueGrowth * 100).toFixed(1)}%`, icon: Globe, color: "text-orange-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}><CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><span className="text-sm text-muted-foreground">{label}</span></div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </CardContent></Card>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <Card><CardHeader><CardTitle>Top Corridors</CardTitle></CardHeader>
              <CardContent><div className="space-y-3">{data.topCorridors.map(c => (
                <div key={c.corridor} className="flex items-center justify-between">
                  <span className="font-medium">{c.corridor}</span>
                  <div className="text-right"><p className="font-bold">${c.revenue.toLocaleString()}</p><p className="text-xs text-muted-foreground">{c.transactions.toLocaleString()} txns</p></div>
                </div>
              ))}</div></CardContent>
            </Card>
            <Card><CardHeader><CardTitle>Revenue by Product</CardTitle></CardHeader>
              <CardContent><div className="space-y-3">{data.revenueByProduct.map(p => (
                <div key={p.product}>
                  <div className="flex justify-between text-sm mb-1"><span>{p.product}</span><span>${p.revenue.toLocaleString()}</span></div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${p.share * 100}%` }} /></div>
                </div>
              ))}</div></CardContent>
            </Card>
          </div>
          {daily && (
            <Card><CardHeader><CardTitle>Daily Revenue (30 days)</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-32">
                  {daily.points.slice(-30).map((p: { date: string; revenue: number; transactions: number; feeRevenue: number; fxRevenue: number }, i: number) => {
                    const max = Math.max(...daily.points.map((x: { revenue: number }) => x.revenue));
                    return <div key={i} className="flex-1 bg-primary/70 rounded-t hover:bg-primary transition-colors" style={{ height: `${(p.revenue/max)*100}%` }} title={`${p.date}: $${p.revenue.toLocaleString()}`} />;
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  
    </DashboardLayout>
  );
}
