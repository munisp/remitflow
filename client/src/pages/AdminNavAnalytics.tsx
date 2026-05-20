/**
 * AdminNavAnalytics
 * Dashboard for community navigation analytics powered by the Python FastAPI microservice.
 * Shows page-view events, session durations, mobile vs desktop split, and top community pages.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, BarChart2, Smartphone, Monitor, Globe, TrendingUp,
  Users, Clock, RefreshCw, Activity, Zap, Star, Target,
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const COMMUNITY_PAGES = [
  { tab: "hub", label: "Community Hub", icon: "🌍", path: "/community-hub" },
  { tab: "funds", label: "Community Funds", icon: "❤️", path: "/community" },
  { tab: "market", label: "AfriMarket", icon: "🛒", path: "/afrimarket" },
  { tab: "talent", label: "TalentBridge", icon: "💼", path: "/talent-bridge" },
  { tab: "invest", label: "DiasporaVest", icon: "📈", path: "/diaspora-invest" },
  { tab: "family", label: "Family Dashboard", icon: "👨‍👩‍👧", path: "/family" },
] as const;

type TabKey = typeof COMMUNITY_PAGES[number]["tab"];

export default function AdminNavAnalytics() {
  const { t } = useTranslation();
  const [hours, setHours] = useState(168); // 7 days default
  const [retentionDays, setRetentionDays] = useState(7);

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } =
    trpc.navAnalytics.summary.useQuery({ hours }, { refetchInterval: 30000 });

  const { data: topFeatures, isLoading: topLoading } =
    trpc.navAnalytics.topFeatures.useQuery({ hours }, { refetchInterval: 30000 });

  const { data: heatmap, isLoading: heatmapLoading } =
    trpc.navAnalytics.heatmap.useQuery({ hours }, { refetchInterval: 60000 });

  const { data: recommendations } =
    trpc.navAnalytics.recommendations.useQuery({ segment: "new_user" }, { refetchInterval: 60000 });

  const { data: retention, isLoading: retentionLoading } =
    trpc.navAnalytics.retention.useQuery({ days: retentionDays }, { refetchInterval: 60000 });

  const { data: healthData } =
    trpc.navAnalytics.health.useQuery(undefined, { refetchInterval: 15000 });

  const isFallback = (summary as any)?._fallback;
  const totalTaps = (summary as any)?.totalTaps ?? 0;
  const uniqueUsers = (summary as any)?.uniqueUsers ?? 0;
  const tabs: { tab: string; count: number; pct: number }[] = (summary as any)?.tabs ?? [];
  const platforms: Record<string, number> = (summary as any)?.platforms ?? {};
  const topCountries: string[] = (summary as any)?.topCountries ?? [];

  const mobileCount = platforms["mobile"] ?? platforms["Mobile"] ?? 0;
  const desktopCount = platforms["desktop"] ?? platforms["Desktop"] ?? 0;
  const tabletCount = platforms["tablet"] ?? platforms["Tablet"] ?? 0;
  const totalDevices = mobileCount + desktopCount + tabletCount || 1;

  const topFeaturesList: { tab: string; count: number; growthPct: number }[] =
    (topFeatures as any)?.topFeatures ?? [];

  const retentionData: { day: number; retained: number; pct: number }[] =
    (retention as any)?.retention ?? [];

  const heatmapData: Record<string, Record<string, number>> =
    (heatmap as any)?.heatmap ?? {};
  const heatmapLabels: Record<string, string> =
    (heatmap as any)?.labels ?? {};

  const timeOptions = [
    { value: 24, label: "Last 24h" },
    { value: 168, label: "Last 7 days" },
    { value: 720, label: "Last 30 days" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-violet-400" />
              Community Nav Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time navigation analytics for all community pages — powered by Python FastAPI microservice on :8086.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Service health indicator */}
            <Badge
              variant="outline"
              className={`gap-1.5 ${(healthData as any)?.online ? "border-green-500/50 text-green-400" : "border-amber-500/50 text-amber-400"}`}
            >
              <span className={`relative flex h-1.5 w-1.5`}>
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${(healthData as any)?.online ? "bg-green-400" : "bg-amber-400"}`} />
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${(healthData as any)?.online ? "bg-green-500" : "bg-amber-500"}`} />
              </span>
              {(healthData as any)?.online ? "Service Online" : isFallback ? "Fallback Mode" : "Connecting…"}
            </Badge>
            <Select
              value={String(hours)}
              onValueChange={(v) => setHours(Number(v))}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeOptions.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetchSummary()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Total Tab Taps",
              value: summaryLoading ? "—" : totalTaps.toLocaleString(),
              icon: BarChart2,
              color: "text-violet-400",
              bg: "bg-violet-500/10",
            },
            {
              label: "Unique Users",
              value: summaryLoading ? "—" : uniqueUsers.toLocaleString(),
              icon: Users,
              color: "text-blue-400",
              bg: "bg-blue-500/10",
            },
            {
              label: "Mobile Share",
              value: summaryLoading ? "—" : `${Math.round((mobileCount / totalDevices) * 100)}%`,
              icon: Smartphone,
              color: "text-emerald-400",
              bg: "bg-emerald-500/10",
            },
            {
              label: "Top Country",
              value: summaryLoading ? "—" : topCountries[0] ?? "—",
              icon: Globe,
              color: "text-amber-400",
              bg: "bg-amber-500/10",
            },
          ].map((stat) => (
            <Card key={stat.label} className="border-border/50">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${stat.bg}`}>
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <div>
                    <div className="text-xl font-bold">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Page Traffic from summary.tabs */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-violet-400" />
                Community Page Traffic
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {COMMUNITY_PAGES.map((page) => {
                    const tabStat = tabs.find((t) => t.tab === page.tab);
                    const count = tabStat?.count ?? 0;
                    const pct = tabStat?.pct ?? 0;
                    return (
                      <div key={page.tab} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5">
                            <span>{page.icon}</span>
                            <span className="font-medium">{page.label}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs">{count.toLocaleString()} taps</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {pct.toFixed(1)}%
                            </Badge>
                          </div>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {tabs.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No navigation events yet. Use the community pages to generate data.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Device Breakdown */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-400" />
                Platform Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {[
                    { label: "Mobile", count: mobileCount, icon: Smartphone, color: "bg-emerald-500", textColor: "text-emerald-400" },
                    { label: "Desktop", count: desktopCount, icon: Monitor, color: "bg-blue-500", textColor: "text-blue-400" },
                    { label: "Tablet", count: tabletCount, icon: Monitor, color: "bg-amber-500", textColor: "text-amber-400" },
                  ].map((device) => {
                    const pct = Math.round((device.count / totalDevices) * 100);
                    return (
                      <div key={device.label} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5">
                            <device.icon className={`w-3.5 h-3.5 ${device.textColor}`} />
                            <span className="font-medium">{device.label}</span>
                          </span>
                          <span className={`font-bold ${device.textColor}`}>{pct}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${device.color} rounded-full transition-all duration-700`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{device.count.toLocaleString()} sessions</p>
                      </div>
                    );
                  })}

                  {/* Top countries */}
                  {topCountries.length > 0 && (
                    <div className="pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Top Countries</p>
                      <div className="flex flex-wrap gap-1.5">
                        {topCountries.slice(0, 6).map((country) => (
                          <Badge key={country} variant="outline" className="text-xs gap-1">
                            <Globe className="w-2.5 h-2.5" />
                            {country}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Features with Growth */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                Top Features by Engagement
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : topFeaturesList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No feature data yet.</p>
              ) : (
                <div className="space-y-3">
                  {topFeaturesList.slice(0, 6).map((f, i) => {
                    const page = COMMUNITY_PAGES.find((p) => p.tab === f.tab);
                    return (
                      <div key={f.tab} className="flex items-center gap-3">
                        <span className="text-muted-foreground font-mono text-xs w-4 shrink-0">#{i + 1}</span>
                        <span className="text-base shrink-0">{page?.icon ?? "📄"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{page?.label ?? f.tab}</p>
                          <p className="text-xs text-muted-foreground">{f.count.toLocaleString()} interactions</p>
                        </div>
                        {f.growthPct !== 0 && (
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 ${f.growthPct > 0 ? "border-green-500/50 text-green-400" : "border-red-500/50 text-red-400"}`}
                          >
                            {f.growthPct > 0 ? "+" : ""}{Number(f.growthPct).toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Retention Curve */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  User Retention
                </CardTitle>
                <Select value={String(retentionDays)} onValueChange={(v) => setRetentionDays(Number(v))}>
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {retentionLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : retentionData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No retention data yet.</p>
              ) : (
                <div className="space-y-2">
                  {retentionData.map((r) => (
                    <div key={r.day} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Day {r.day}</span>
                        <span className={`font-medium ${r.pct >= 50 ? "text-emerald-400" : r.pct >= 25 ? "text-amber-400" : "text-red-400"}`}>
                          {Number(r.pct).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${r.pct >= 50 ? "bg-emerald-500" : r.pct >= 25 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${r.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI Recommendations */}
        {recommendations && !(recommendations as any)._fallback && (
          <Card className="border-border/50 border-violet-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-400" />
                AI-Recommended Nav Order
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/50 text-violet-400">
                  {(recommendations as any).model ?? "ML Model"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {((recommendations as any).recommendedOrder as TabKey[])?.map((tab: TabKey, i: number) => {
                  const page = COMMUNITY_PAGES.find((p) => p.tab === tab);
                  return (
                    <div key={tab} className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-1.5 text-sm">
                      <span className="text-muted-foreground font-mono text-xs">#{i + 1}</span>
                      <span>{page?.icon ?? "📄"}</span>
                      <span className="font-medium">{page?.label ?? tab}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Based on {(recommendations as any).totalEventsAnalyzed?.toLocaleString() ?? 0} navigation events for the <strong>{(recommendations as any).segment}</strong> segment.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Heatmap */}
        {!heatmapLoading && Object.keys(heatmapData).length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-rose-400" />
                Navigation Heatmap (by Hour)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="grid gap-1" style={{ gridTemplateColumns: `80px repeat(${Object.keys(heatmapData).length}, 1fr)` }}>
                  {/* Header row */}
                  <div />
                  {Object.keys(heatmapData).map((hour) => (
                    <div key={hour} className="text-center text-[10px] text-muted-foreground font-mono">{hour}h</div>
                  ))}
                  {/* Tab rows */}
                  {COMMUNITY_PAGES.map((page) => {
                    const maxVal = Math.max(...Object.values(heatmapData).map((h: any) => h[page.tab] ?? 0), 1);
                    return (
                      <>
                        <div key={`label-${page.tab}`} className="text-xs text-muted-foreground flex items-center gap-1 pr-2">
                          <span>{page.icon}</span>
                          <span className="truncate">{page.label.split(" ")[0]}</span>
                        </div>
                        {Object.entries(heatmapData).map(([hour, tabData]: [string, any]) => {
                          const val = tabData[page.tab] ?? 0;
                          const intensity = Math.round((val / maxVal) * 100);
                          return (
                            <div
                              key={`${page.tab}-${hour}`}
                              className="h-5 rounded-sm transition-all"
                              style={{
                                backgroundColor: `oklch(0.5 0.15 280 / ${Math.max(0.05, intensity / 100)})`,
                              }}
                              title={`${page.label} at ${hour}h: ${val} taps`}
                            />
                          );
                        })}
                      </>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Service info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="w-3.5 h-3.5" />
          <span>
            Analytics powered by Python FastAPI microservice on port 8086 ·
            {(healthData as any)?.totalEvents != null && ` ${(healthData as any).totalEvents.toLocaleString()} total events tracked ·`}
            Auto-refreshes every 30s
          </span>
        </div>
      </div>
    </DashboardLayout>
  );
}
