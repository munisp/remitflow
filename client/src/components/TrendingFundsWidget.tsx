/**
 * TrendingFundsWidget
 * Surfaces the 3 most-visited community fund pages using Python analytics topFeatures data.
 * Combines analytics engagement scores with live fund data (raised, goal, contributors).
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, TrendingUp, Users, Heart, ArrowRight, Loader2, Zap } from "lucide-react";
import { Link } from "wouter";

const TREND_COLORS = [
  { bg: "from-rose-500/20 to-pink-500/10", border: "border-rose-500/30", badge: "bg-rose-500/20 text-rose-300 border-rose-500/30", bar: "bg-rose-500" },
  { bg: "from-amber-500/20 to-orange-500/10", border: "border-amber-500/30", badge: "bg-amber-500/20 text-amber-300 border-amber-500/30", bar: "bg-amber-500" },
  { bg: "from-violet-500/20 to-purple-500/10", border: "border-violet-500/30", badge: "bg-violet-500/20 text-violet-300 border-violet-500/30", bar: "bg-violet-500" },
];

const TREND_LABELS = ["🔥 Hot", "📈 Rising", "⭐ Popular"];

interface TrendingFundsWidgetProps {
  /** Dark mode (for CommunityHub dark bg) or light mode */
  dark?: boolean;
}

export function TrendingFundsWidget({ dark = false }: TrendingFundsWidgetProps) {
  const { data: topFeatures, isLoading: analyticsLoading } =
    trpc.navAnalytics.topFeatures.useQuery({ hours: 168 }, { refetchInterval: 60000 });

  const { data: funds, isLoading: fundsLoading } =
    trpc.community.listFunds.useQuery(undefined, { refetchInterval: 30000 });

  const isLoading = analyticsLoading || fundsLoading;

  // Get the funds tab engagement score from analytics
  const fundsEngagement = (topFeatures as any)?.topFeatures?.find(
    (f: any) => f.tab === "funds"
  );
  const engagementCount: number = fundsEngagement?.count ?? 0;
  const growthPct: number = fundsEngagement?.growthPct ?? 0;

  // Sort funds by a composite score: (raised/goal * 0.6) + (contributorCount * 0.4)
  const fundsList = (funds as any[]) ?? [];
  const scoredFunds = fundsList
    .map((f: any) => {
      const goal = Number(f.goal ?? 1);
      const raised = Number(f.totalRaised ?? 0);
      const contributors = Number(f.contributorCount ?? 0);
      const progress = goal > 0 ? raised / goal : 0;
      const score = progress * 0.6 + (contributors / Math.max(contributors + 1, 10)) * 0.4;
      return { ...f, score, progress, raised, goal, contributors };
    })
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 3);

  const textClass = dark ? "text-white" : "text-foreground";
  const subTextClass = dark ? "text-slate-400" : "text-muted-foreground";
  const cardClass = dark
    ? "bg-slate-800/50 border-slate-700/50"
    : "border-border/50";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-rose-400" />
          <h2 className={`text-xl font-bold ${textClass}`}>Trending Funds</h2>
          {growthPct > 0 && (
            <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs gap-1">
              <TrendingUp className="w-2.5 h-2.5" />
              +{growthPct.toFixed(0)}% this week
            </Badge>
          )}
        </div>
        <Link href="/community">
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1 text-xs ${dark ? "text-slate-400 hover:text-white" : "text-muted-foreground"}`}
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>

      {/* Analytics context badge */}
      {engagementCount > 0 && (
        <div className={`flex items-center gap-1.5 text-xs ${subTextClass}`}>
          <Zap className="w-3 h-3 text-amber-400" />
          <span>
            <strong className="text-amber-400">{engagementCount.toLocaleString()}</strong> community fund visits in the last 7 days
          </span>
        </div>
      )}

      {/* Fund cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : scoredFunds.length === 0 ? (
        <div className={`text-center py-8 ${subTextClass} text-sm`}>
          <Heart className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No community funds yet. Be the first to create one!
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          {scoredFunds.map((fund: any, i: number) => {
            const colors = TREND_COLORS[i] ?? TREND_COLORS[2];
            const progressPct = Math.min(100, Math.round(fund.progress * 100));
            return (
              <Link key={fund.id} href="/community">
                <div
                  className={`relative rounded-2xl border bg-gradient-to-br ${colors.bg} ${colors.border} p-4 cursor-pointer hover:scale-[1.02] transition-all duration-300 hover:shadow-lg ${dark ? "hover:shadow-black/20" : ""}`}
                >
                  {/* Trend badge */}
                  <div className="flex items-start justify-between mb-3">
                    <Badge className={`text-[10px] px-2 py-0.5 ${colors.badge}`}>
                      {TREND_LABELS[i]}
                    </Badge>
                    <span className={`text-xs font-bold ${dark ? "text-white" : "text-foreground"}`}>
                      #{i + 1}
                    </span>
                  </div>

                  {/* Fund name */}
                  <h3 className={`font-semibold text-sm mb-1 line-clamp-2 ${textClass}`}>
                    {fund.name}
                  </h3>
                  {fund.description && (
                    <p className={`text-xs mb-3 line-clamp-2 ${subTextClass}`}>
                      {fund.description}
                    </p>
                  )}

                  {/* Progress bar */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={subTextClass}>Progress</span>
                      <span className={`font-bold ${textClass}`}>{progressPct}%</span>
                    </div>
                    <div className={`h-1.5 rounded-full overflow-hidden ${dark ? "bg-slate-700" : "bg-muted"}`}>
                      <div
                        className={`h-full ${colors.bar} rounded-full transition-all duration-700`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className={subTextClass}>
                      ${Number(fund.raised).toLocaleString()} raised
                    </span>
                    <div className={`flex items-center gap-1 ${subTextClass}`}>
                      <Users className="w-3 h-3" />
                      <span>{fund.contributors}</span>
                    </div>
                  </div>

                  {/* Status */}
                  {fund.status && (
                    <div className="mt-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          fund.status === "active"
                            ? dark ? "border-green-500/40 text-green-400" : "border-green-500 text-green-600"
                            : dark ? "border-slate-600 text-slate-400" : "border-muted text-muted-foreground"
                        }`}
                      >
                        {fund.status}
                      </Badge>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
