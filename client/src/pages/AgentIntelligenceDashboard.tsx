import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

const TIER_COLORS: Record<string, string> = { platinum: "bg-purple-100 text-purple-700", gold: "bg-yellow-100 text-yellow-700", silver: "bg-gray-100 text-gray-700", bronze: "bg-orange-100 text-orange-700" };

export default function AgentIntelligenceDashboard() {
  const heatmap = trpc.agentIntelligence.demandHeatmap.useQuery({ days: 7 });
  const scores = trpc.agentIntelligence.performanceScoring.useQuery({ days: 30 });

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Agent Intelligence Dashboard">
      <h1 className="text-2xl font-bold">Agent Network Intelligence</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Demand Heatmap</CardTitle></CardHeader>
          <CardContent>
            {heatmap.data?.hotspots?.map((a: { agentId: string; intensity: string; transactionCount: number; volume: number }, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <span>{a.agentId}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={a.intensity === "critical" ? "destructive" : "outline"}>{a.intensity}</Badge>
                  <span className="text-sm">{a.transactionCount} txns</span>
                </div>
              </div>
            )) ?? <p className="text-muted-foreground">Loading...</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Performance Rankings</CardTitle></CardHeader>
          <CardContent>
            {scores.data?.map((s: { rank: number; agentId: string; overallScore: number; tier: string }, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-lg w-8">#{s.rank}</span>
                  <span>{s.agentId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.overallScore.toFixed(1)}</span>
                  <Badge className={TIER_COLORS[s.tier] || ""}>{s.tier}</Badge>
                </div>
              </div>
            )) ?? <p className="text-muted-foreground">Loading...</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
