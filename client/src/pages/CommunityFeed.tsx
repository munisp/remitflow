import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Heart, Plus, Globe, Trophy, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const ACTIVITY_ICONS: Record<string, string> = {
  transfer: "💸",
  investment: "📈",
  kyc_complete: "✅",
  referral: "🤝",
  savings_goal: "🎯",
  community_fund: "🌍",
};

const SDG_GOALS: Record<number, { name: string; color: string }> = {
  1: { name: "No Poverty", color: "bg-red-500" },
  2: { name: "Zero Hunger", color: "bg-yellow-600" },
  3: { name: "Good Health", color: "bg-green-500" },
  4: { name: "Quality Education", color: "bg-red-600" },
  5: { name: "Gender Equality", color: "bg-orange-500" },
  8: { name: "Decent Work", color: "bg-red-700" },
  10: { name: "Reduced Inequalities", color: "bg-pink-600" },
  17: { name: "Partnerships", color: "bg-blue-600" },
};

export default function CommunityFeed() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [activityType, setActivityType] = useState<any>("transfer");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [sdgGoal, setSdgGoal] = useState<string>("");
  const [leaderboardCategory, setLeaderboardCategory] = useState<"referrals" | "transfers" | "community">("community");

  const { data: feed, refetch } = trpc.v98.communityFeed.list.useQuery({ limit: 20 });
  const { data: sdgMetrics } = trpc.v98.communityFeed.sdgMetrics.useQuery();
  const { data: leaderboard } = trpc.v98.leaderboard.get.useQuery({ category: leaderboardCategory });

  const postMutation = trpc.v98.communityFeed.post.useMutation({
    onSuccess: () => {
      toast.success('Posted to community feed!');
      setOpen(false);
      setTitle(""); setDescription(""); setAmount(""); setSdgGoal("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const likeMutation = trpc.v98.communityFeed.like.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Community Impact Feed</h1>
          <p className="text-muted-foreground text-sm mt-1">
            See how RemitFlow users are making a difference across Africa and beyond
          </p>
        </div>
        {user && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Share Impact
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Share Your Impact</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Activity Type</Label>
                  <Select value={activityType} onValueChange={setActivityType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ACTIVITY_ICONS).map(([k, icon]) => (
                        <SelectItem key={k} value={k}>{icon} {k.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Title</Label>
                  <Input placeholder="e.g. Sent money home to support family" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Textarea placeholder="Share your story..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount (optional)</Label>
                    <Input type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["USD", "NGN", "GHS", "KES", "ZAR", "EUR", "GBP"].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>SDG Goal (optional)</Label>
                  <Select value={sdgGoal} onValueChange={setSdgGoal}>
                    <SelectTrigger><SelectValue placeholder="Select SDG goal" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SDG_GOALS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>SDG {k}: {v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => postMutation.mutate({
                    activityType,
                    title,
                    description: description || undefined,
                    amount: amount ? parseFloat(amount) : undefined,
                    currency: amount ? currency : undefined,
                    sdgGoal: sdgGoal ? parseInt(sdgGoal) : undefined,
                    isPublic: true,
                  })}
                  disabled={!title || postMutation.isPending}
                >
                  {postMutation.isPending ? "Posting..." : "Post to Community"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* SDG Impact Metrics */}
      {sdgMetrics && sdgMetrics.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <Globe className="h-4 w-4" /> SDG IMPACT METRICS
          </h2>
          <div className="flex flex-wrap gap-2">
            {sdgMetrics.map((m: any) => {
              const goal = SDG_GOALS[m.sdgGoal ?? 0];
              if (!goal) return null;
              return (
                <DashboardLayout>
                <div key={m.sdgGoal} className={`${goal.color} text-white text-xs px-3 py-1.5 rounded-full font-medium`}>
                  SDG {m.sdgGoal}: {goal.name} · {Number(m.count)} activities
                </div>
              
                </DashboardLayout>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feed */}
        <div className="lg:col-span-2 space-y-3">
          {!feed?.items.length ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Globe className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No community activity yet. Be the first to share your impact!</p>
              </CardContent>
            </Card>
          ) : (
            feed.items.map((item: any) => (
              <Card key={item.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {item.actorAvatar ? (
                        <img src={item.actorAvatar} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        item.actorName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{item.actorName}</span>
                        <span className="text-lg">{ACTIVITY_ICONS[item.activityType] ?? "📌"}</span>
                        {item.sdgGoal && SDG_GOALS[item.sdgGoal] && (
                          <span className={`${SDG_GOALS[item.sdgGoal].color} text-white text-xs px-2 py-0.5 rounded-full`}>
                            SDG {item.sdgGoal}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium mt-0.5">{item.title}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      )}
                      {item.amount && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-medium">
                          {Number(item.amount).toLocaleString()} {item.currency}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors"
                          onClick={() => likeMutation.mutate({ id: item.id })}
                        >
                          <Heart className="h-3.5 w-3.5" />
                          {item.likesCount}
                        </button>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                        {item.country && (
                          <span className="text-xs text-muted-foreground">📍 {item.country}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Leaderboard */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-1 mb-3">
                {(["community", "referrals", "transfers"] as const).map((c) => (
                  <button
                    key={c}
                    className={`text-xs px-2 py-1 rounded transition-colors ${leaderboardCategory === c ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                    onClick={() => setLeaderboardCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {!leaderboard?.length ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No data yet</p>
                ) : (
                  leaderboard.slice(0, 10).map((entry: any, i: any) => entry && (
                    <div key={entry.userId} className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-yellow-500 text-white" : i === 1 ? "bg-gray-400 text-white" : i === 2 ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground"}`}>
                        {i + 1}
                      </span>
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                        {entry.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{entry.name}</p>
                        <p className="text-xs text-muted-foreground">{entry.score} {leaderboardCategory === "transfers" ? "transfers" : leaderboardCategory === "referrals" ? "referrals" : "posts"}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
