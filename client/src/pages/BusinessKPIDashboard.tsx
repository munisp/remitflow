import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export default function BusinessKPIDashboard() {
  const health = trpc.businessKpi.platformHealth.useQuery();
  const revenue = trpc.businessKpi.revenueMetrics.useQuery({ days: 30 });
  const corridors = trpc.businessKpi.corridorBreakdown.useQuery({ days: 30 });
  const funnel = trpc.businessKpi.conversionFunnel.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Business KPI Dashboard">
      <h1 className="text-2xl font-bold">Business KPI Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{health.data?.totalUsers ?? "—"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Volume (30d)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{revenue.data?.totalVolume ? `₦${Number(revenue.data.totalVolume).toLocaleString()}` : "—"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Revenue (30d)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{revenue.data?.totalFees ? `₦${Number(revenue.data.totalFees).toLocaleString()}` : "—"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Transactions/Hour</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{health.data?.transactionsLastHour ?? "—"}</p></CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Top Corridors</CardTitle></CardHeader>
          <CardContent>
            {corridors.data?.map((c: { corridor: string; count: number }, i: number) => (
              <div key={i} className="flex justify-between py-2 border-b last:border-0">
                <span>{c.corridor}</span>
                <span className="font-medium">{c.count} txns</span>
              </div>
            )) ?? <p className="text-muted-foreground">Loading corridors...</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Conversion Funnel</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between"><span>Signups</span><span className="font-medium">{funnel.data?.signups ?? "—"}</span></div>
              <div className="flex justify-between"><span>KYC Started</span><span className="font-medium">{funnel.data?.kycStarted ?? "—"}</span></div>
              <div className="flex justify-between"><span>First Transfer</span><span className="font-medium">{funnel.data?.firstTransfer ?? "—"}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
