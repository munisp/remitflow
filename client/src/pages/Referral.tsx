import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Gift, Copy, Users, Trophy, DollarSign, Star, Share2, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const TIER_CONFIG = {
  bronze: { color: "text-amber-700 bg-amber-100", icon: "🥉", nextAt: 100, label: "Bronze" },
  silver: { color: "text-slate-600 bg-slate-100", icon: "🥈", nextAt: 500, label: "Silver" },
  gold: { color: "text-yellow-600 bg-yellow-100", icon: "🥇", nextAt: null, label: "Gold" },
};

export default function Referral() {
  const { t } = useTranslation();
  const [applyCode, setApplyCode] = useState("");
  const { data: stats, refetch } = trpc.referralEngine.myStats.useQuery();
  const { data: leaderboard } = trpc.referralEngine.leaderboard.useQuery();
  const applyMutation = trpc.referralEngine.applyCode.useMutation({
    onSuccess: (d) => { toast.success(d.message); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const copyCode = () => {
    if (stats?.code) { navigator.clipboard.writeText(stats.code); toast.success("Referral code copied!"); }
  };
  const shareCode = () => {
    if (navigator.share && stats?.code) {
      navigator.share({ title: "Join RemitFlow", text: `Use my referral code ${stats.code} to sign up and we both earn $10!`, url: `https://remitflow.app/signup?ref=${stats.code}` });
    } else copyCode();
  };

  const tier = stats?.tier as keyof typeof TIER_CONFIG ?? "bronze";
  const tierConfig = TIER_CONFIG[tier];

  return (

    <DashboardLayout>
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-pink-100 rounded-lg"><Gift className="h-6 w-6 text-pink-600" /></div>
        <div>
          <h1 className="text-2xl font-bold">Referral Program</h1>
          <p className="text-muted-foreground">Earn $10 for every friend you refer who completes a transfer</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-pink-500 to-rose-600 text-white">
            <CardContent className="p-4">
              <DollarSign className="h-5 w-5 mb-1 opacity-80" />
              <div className="text-2xl font-bold">${stats.totalEarned}</div>
              <div className="text-sm opacity-80">Total Earned</div>
            </CardContent>
          </Card>
          <Card><CardContent className="p-4"><Users className="h-5 w-5 mb-1 text-muted-foreground" /><div className="text-2xl font-bold">{stats.referrals.length}</div><div className="text-sm text-muted-foreground">Referrals</div></CardContent></Card>
          <Card><CardContent className="p-4"><DollarSign className="h-5 w-5 mb-1 text-muted-foreground" /><div className="text-2xl font-bold">${stats.pendingEarnings}</div><div className="text-sm text-muted-foreground">Pending</div></CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-2xl">{tierConfig.icon}</div>
            <Badge className={`mt-1 ${tierConfig.color}`}>{tierConfig.label} Tier</Badge>
            {tierConfig.nextAt && <div className="text-xs text-muted-foreground mt-1">Earn ${tierConfig.nextAt} to upgrade</div>}
          </CardContent></Card>
        </div>
      )}

      <Tabs defaultValue="share">
        <TabsList>
          <TabsTrigger value="share">Share & Earn</TabsTrigger>
          <TabsTrigger value="referrals">My Referrals</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="apply">Apply a Code</TabsTrigger>
        </TabsList>

        <TabsContent value="share" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Your Referral Code</CardTitle>
              <CardDescription>Share this code with friends. You earn $10 when they complete their first transfer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={stats?.code ?? "Loading..."} readOnly className="font-mono text-lg font-bold tracking-widest text-center" />
                <Button variant="outline" onClick={copyCode}><Copy className="h-4 w-4" /></Button>
                <Button onClick={shareCode}><Share2 className="h-4 w-4 mr-2" />Share</Button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                {[["1", "Share your code", "Send it to friends via WhatsApp, email, or social media"],["2","Friend signs up","They create an account using your referral code"],["3","Both earn $10","When they complete their first transfer, you both get rewarded"]].map(([n,title,desc]) => (
                  <div key={n} className="p-3 bg-muted rounded-lg">
                    <div className="text-2xl font-bold text-pink-600 mb-1">{n}</div>
                    <div className="font-medium">{title}</div>
                    <div className="text-muted-foreground text-xs mt-1">{desc}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="referrals" className="mt-4 space-y-3">
          {!stats?.referrals.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No referrals yet. Share your code to get started!</CardContent></Card>
          ) : (stats.referrals as any[]).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <div className="font-medium">{r.referee_name ?? "Anonymous"}</div>
                  <div className="text-sm text-muted-foreground">{r.referee_email} · Joined {new Date(r.joined_at).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-green-600">+${r.reward_amount}</div>
                  <Badge className={r.status === "paid" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>{r.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-500" />Top Referrers</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(leaderboard as any[] ?? []).map((entry: any, i: number) => (
                  <div key={entry.id} className={`flex items-center gap-3 p-2 rounded-lg ${i < 3 ? "bg-yellow-50" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? "bg-yellow-400 text-yellow-900" : i === 1 ? "bg-slate-300 text-slate-700" : i === 2 ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground"}`}>
                      {i + 1}
                    </div>
                    <div className="flex-1"><div className="font-medium">{entry.name}</div></div>
                    <div className="text-right">
                      <div className="font-semibold">{entry.referral_count} referrals</div>
                      <div className="text-sm text-green-600">${entry.total_earned} earned</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="apply" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Apply a Referral Code</CardTitle>
              <CardDescription>Enter a friend's referral code to give them credit for referring you</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input placeholder="Enter referral code (e.g. RF001234ABC)" value={applyCode} onChange={e => setApplyCode(e.target.value.toUpperCase())} className="font-mono" />
                <Button disabled={applyMutation.isPending || applyCode.length < 6} onClick={() => applyMutation.mutate({ code: applyCode })}>
                  {applyMutation.isPending ? "Applying..." : "Apply Code"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">Each account can only apply one referral code. The referrer earns $10 when you complete your first transfer.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
