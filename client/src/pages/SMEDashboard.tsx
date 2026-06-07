import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownRight, ArrowUpRight, TrendingUp, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function SMEDashboard() {
  const cashFlow = trpc.smeDashboard.cashFlowOverview.useQuery({ days: 30 });
  const payables = trpc.smeDashboard.payablesReceivables.useQuery();
  const fxExposure = trpc.smeDashboard.fxExposure.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="SME Dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Business Dashboard</h1>
        <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> Export Statement</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Net Cash Flow</CardTitle></CardHeader>
          <CardContent><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-green-600" /><span className="text-2xl font-bold">₦{(cashFlow.data?.netCashFlow ?? 0).toLocaleString()}</span></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Inflow (30d)</CardTitle></CardHeader>
          <CardContent><div className="flex items-center gap-2"><ArrowDownRight className="h-5 w-5 text-green-600" /><span className="text-2xl font-bold">₦{(cashFlow.data?.inflow ?? 0).toLocaleString()}</span></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Outflow (30d)</CardTitle></CardHeader>
          <CardContent><div className="flex items-center gap-2"><ArrowUpRight className="h-5 w-5 text-red-600" /><span className="text-2xl font-bold">₦{(cashFlow.data?.outflow ?? 0).toLocaleString()}</span></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Runway</CardTitle></CardHeader>
          <CardContent><span className="text-2xl font-bold">{cashFlow.data?.runwayDays ?? "—"} days</span></CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Payables & Receivables</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between"><span className="text-muted-foreground">Payables Due</span><span className="font-medium text-red-600">₦{(payables.data?.payables?.amount ?? 0).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Receivables Due</span><span className="font-medium text-green-600">₦{(payables.data?.receivables?.amount ?? 0).toLocaleString()}</span></div>
            <div className="flex justify-between border-t pt-2"><span className="font-medium">Net Position</span><span className="font-bold">₦{(payables.data?.netPosition ?? 0).toLocaleString()}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>FX Exposure</CardTitle></CardHeader>
          <CardContent>
            {fxExposure.data?.currencies?.map((c: { currency: string; balance: number; percentage: string }, i: number) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span>{c.currency}</span>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-20 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${c.percentage}%` }} /></div>
                  <span className="text-sm font-medium w-10 text-right">{c.percentage}%</span>
                </div>
              </div>
            )) ?? <p className="text-muted-foreground">No FX exposure data</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
