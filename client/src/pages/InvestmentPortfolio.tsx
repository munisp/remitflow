import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  TrendingUp, Home, Rocket, BarChart3, DollarSign,
  ArrowRight, PieChart, Activity, RefreshCw
} from "lucide-react";

function formatUSD(val: string | number | null | undefined) {
  if (!val) return "$0";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatNGN(val: string | number | null | undefined) {
  if (!val) return "₦0";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(2)}M`;
  return `₦${n.toLocaleString("en-NG")}`;
}

export default function InvestmentPortfolio() {
  const [, navigate] = useLocation();
  const { data: summary, isLoading, refetch } = trpc.investmentPortfolio.summary.useQuery();

  const totalUSD = summary
    ? parseFloat(summary.stocks?.totalUsd ?? "0") +
      parseFloat(summary.realEstate?.totalUsd ?? "0") +
      parseFloat(summary.startups?.totalUsd ?? "0")
    : 0;

  const allocations = summary
    ? [
        { label: "NGX Stocks", value: parseFloat(summary.stocks?.totalUsd ?? "0"), color: "bg-blue-500", icon: BarChart3, path: "/invest/stocks" },
        { label: "Real Estate", value: parseFloat(summary.realEstate?.totalUsd ?? "0"), color: "bg-emerald-500", icon: Home, path: "/invest/real-estate" },
        { label: "Startups", value: parseFloat(summary.startups?.totalUsd ?? "0"), color: "bg-purple-500", icon: Rocket, path: "/invest/startups" },
      ]
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <PieChart className="h-6 w-6 text-emerald-500" />
              Investment Portfolio
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Your complete Nigerian investment overview — stocks, real estate & startups
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : (
          <>
            {/* Total Portfolio Value */}
            <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent">
              <CardContent className="pt-6 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Portfolio Value</p>
                    <p className="text-4xl font-bold mt-1">{formatUSD(totalUSD)}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {summary?.stocks?.count ?? 0} stock positions ·{" "}
                      {summary?.realEstate?.count ?? 0} properties ·{" "}
                      {summary?.startups?.count ?? 0} startups
                    </p>
                  </div>
                  <Activity className="h-16 w-16 text-emerald-500/20" />
                </div>
              </CardContent>
            </Card>

            {/* Asset Class Breakdown */}
            <div className="grid md:grid-cols-3 gap-4">
              {allocations.map((asset) => {
                const pct = totalUSD > 0 ? (asset.value / totalUSD) * 100 : 0;
                return (
                  <Card key={asset.label} className="hover:shadow-lg transition-shadow cursor-pointer group"
                    onClick={() => navigate(asset.path)}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <asset.icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        {asset.label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-2xl font-bold">{formatUSD(asset.value)}</p>
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Portfolio allocation</span>
                          <span>{pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${asset.color} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="w-full justify-between">
                        View Details <ArrowRight className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  label: "NGX Stock Orders",
                  value: summary?.stocks?.count ?? 0,
                  sub: formatUSD(summary?.stocks?.totalUsd),
                  color: "text-blue-600",
                },
                {
                  label: "Properties Owned",
                  value: summary?.realEstate?.count ?? 0,
                  sub: formatUSD(summary?.realEstate?.totalUsd),
                  color: "text-emerald-600",
                },
                {
                  label: "Startup Investments",
                  value: summary?.startups?.count ?? 0,
                  sub: formatUSD(summary?.startups?.totalUsd),
                  color: "text-purple-600",
                },
                {
                  label: "Total Deployed",
                  value: formatUSD(totalUSD),
                  sub: "across all asset classes",
                  color: "text-foreground",
                },
              ].map((stat) => (
                <Card key={stat.label}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Investment Hub Navigation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Investment Hubs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-3">
                  {[
                    {
                      title: "NGX Stock Market",
                      description: "Buy and sell shares on the Nigerian Exchange Group. Access 150+ listed companies.",
                      icon: BarChart3,
                      color: "bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20",
                      iconColor: "text-blue-500",
                      path: "/invest/stocks",
                      badge: "Live Prices",
                    },
                    {
                      title: "Real Estate Hub",
                      description: "Fractional property investment from $500. Earn rental income quarterly in USD.",
                      icon: Home,
                      color: "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20",
                      iconColor: "text-emerald-500",
                      path: "/invest/real-estate",
                      badge: "From $500",
                    },
                    {
                      title: "Startup Deal Room",
                      description: "Invest in vetted Nigerian startups at pre-seed to growth stage via SAFE notes.",
                      icon: Rocket,
                      color: "bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20",
                      iconColor: "text-purple-500",
                      path: "/invest/startups",
                      badge: "Vetted Deals",
                    },
                  ].map((hub) => (
                    <button
                      key={hub.title}
                      className={`p-4 rounded-lg border text-left transition-colors ${hub.color}`}
                      onClick={() => navigate(hub.path)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <hub.icon className={`h-6 w-6 ${hub.iconColor}`} />
                        <Badge variant="outline" className="text-xs">{hub.badge}</Badge>
                      </div>
                      <p className="font-semibold text-sm">{hub.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{hub.description}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Diaspora Investment Guide */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                  Diaspora Investment Guide: US to Nigeria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div className="space-y-2">
                    <p className="font-semibold text-blue-600">📈 Nigerian Stock Market (NGX)</p>
                    <ul className="space-y-1 text-muted-foreground text-xs">
                      <li>• Open a SEC-registered stockbroker account (e.g., Stanbic, CardinalStone)</li>
                      <li>• Fund via RemitFlow wallet → NGN conversion</li>
                      <li>• Access 150+ listed companies: Dangote, GTBank, MTN Nigeria, Zenith</li>
                      <li>• Dividends paid in NGN; repatriate via RemitFlow</li>
                      <li>• Capital gains tax: 10% on disposal</li>
                      <li>• Regulated by SEC Nigeria and NGX</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <p className="font-semibold text-emerald-600">🏠 Real Estate</p>
                    <ul className="space-y-1 text-muted-foreground text-xs">
                      <li>• Fractional ownership from $500 via RemitFlow</li>
                      <li>• Full property purchase from $50K–$500K+</li>
                      <li>• Lagos Ikoyi/VI: 8–12% rental yield</li>
                      <li>• Abuja Maitama: 6–9% rental yield</li>
                      <li>• Title deed held by CBN-licensed trustee</li>
                      <li>• Rental income repatriated quarterly in USD</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <p className="font-semibold text-purple-600">🚀 Startups</p>
                    <ul className="space-y-1 text-muted-foreground text-xs">
                      <li>• Pre-seed to Series B deals on RemitFlow</li>
                      <li>• SAFE notes or equity rounds from $1,000</li>
                      <li>• Sectors: Fintech, Agritech, Healthtech, Logistics</li>
                      <li>• All startups CAC-registered and SEC-compliant</li>
                      <li>• Exit via acquisition, NGX IPO, or secondary</li>
                      <li>• Diversify across 5–10 deals minimum</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
