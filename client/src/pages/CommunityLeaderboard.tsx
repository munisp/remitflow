import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, ThumbsUp, FileText, Users, Star, TrendingUp } from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const MEDAL_COLORS = ["text-yellow-500", "text-gray-400", "text-amber-600"];
const MEDAL_BG = ["bg-yellow-50 border-yellow-200", "bg-gray-50 border-gray-200", "bg-amber-50 border-amber-200"];

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    const emojis = ["🥇", "🥈", "🥉"];
    return <span className="text-2xl">{emojis[rank - 1]}</span>;
  }
  return (
    <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
      {rank}
    </span>
  );
}

function LeaderRow({ rank, name, score, label }: { rank: number; name: string; score: number; label: string }) {
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div className={`flex items-center gap-4 p-3 rounded-lg border ${rank <= 3 ? MEDAL_BG[rank - 1] : "border-transparent"}`}>
      <div className="w-10 flex items-center justify-center">
        <RankBadge rank={rank} />
      </div>
      <Avatar className="h-9 w-9">
        <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{name}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <div className="text-right">
        <p className="font-bold text-primary">{score.toLocaleString()}</p>
      </div>
    </div>
  );
}

export default function CommunityLeaderboard() {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.community.communityLeaderboard.useQuery();

  return (

    <DashboardLayout>
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-yellow-100 text-yellow-600">
          <Trophy className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Community Leaderboard</h1>
          <p className="text-muted-foreground text-sm">Recognising the most active diaspora contributors</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: ThumbsUp, label: "Total Votes Cast", value: data?.topVoters.reduce((s, v) => s + v.votes, 0) ?? 0, color: "text-blue-600 bg-blue-50" },
          { icon: FileText, label: "Proposals Funded", value: data?.topProposers.reduce((s, p) => s + p.funded, 0) ?? 0, color: "text-green-600 bg-green-50" },
          { icon: Users, label: "Active Members", value: (data?.topVoters.length ?? 0) + (data?.topProposers.length ?? 0), color: "text-purple-600 bg-purple-50" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leaderboard tabs */}
      <Tabs defaultValue="voters">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="voters" className="flex items-center gap-1">
            <ThumbsUp className="h-4 w-4" /> Top Voters
          </TabsTrigger>
          <TabsTrigger value="proposers" className="flex items-center gap-1">
            <FileText className="h-4 w-4" /> Top Proposers
          </TabsTrigger>
          <TabsTrigger value="contributors" className="flex items-center gap-1">
            <Star className="h-4 w-4" /> Top Contributors
          </TabsTrigger>
        </TabsList>

        <TabsContent value="voters">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-blue-500" />
                Most Active Voters
                <Badge variant="secondary" className="ml-auto">{data?.topVoters.length ?? 0} members</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                ))
              ) : data?.topVoters.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ThumbsUp className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No votes cast yet. Be the first!</p>
                </div>
              ) : (
                data?.topVoters.map((v, i) => (
                  <LeaderRow key={v.userId} rank={i + 1} name={v.name} score={v.votes} label={`${v.votes} vote${v.votes !== 1 ? "s" : ""} cast`} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proposers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-green-500" />
                Top Proposal Submitters
                <Badge variant="secondary" className="ml-auto">{data?.topProposers.length ?? 0} members</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                ))
              ) : data?.topProposers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No proposals submitted yet.</p>
                </div>
              ) : (
                data?.topProposers.map((p, i) => (
                  <LeaderRow key={p.userId} rank={i + 1} name={p.name} score={p.funded} label={`${p.funded} funded / ${p.total} total proposals`} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contributors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-yellow-500" />
                Top Fund Contributors
                <Badge variant="secondary" className="ml-auto">{data?.topContributors.length ?? 0} members</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                ))
              ) : data?.topContributors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Star className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No contributions yet. Start contributing!</p>
                </div>
              ) : (
                data?.topContributors.map((c, i) => (
                  <LeaderRow key={c.userId} rank={i + 1} name={c.name} score={c.votes} label="community engagement score" />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* How to climb */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-semibold text-sm">How to climb the leaderboard</p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                <li>• Vote on fund proposals to earn voter points</li>
                <li>• Submit proposals and get them funded to earn proposer points</li>
                <li>• Contribute to community funds to earn contributor points</li>
                <li>• Refer new members to earn bonus engagement points</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
