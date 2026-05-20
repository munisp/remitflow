import { toast } from 'sonner';
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Gift, Trophy, Copy, Share2, DollarSign, Clock, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-gray-100 text-gray-700",
};

export default function ReferralDashboard() {
  const [tab, setTab] = useState<"overview" | "bonuses" | "leaderboard">("overview");

  const { data: referralData } = trpc.referral.info.useQuery();
  const { data: bonusData } = trpc.referralBonus.list.useQuery();
  const { data: leaderboardData } = trpc.referralBonus.leaderboard.useQuery();

  const referralCode = referralData?.referralCode ?? "RF000001";
  const referralLink = `${window.location.origin}/?ref=${referralCode}`;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast.success("Referral link copied!");
  };

  const shareLink = () => {
    if (navigator.share) {
      navigator.share({ title: "Join RemitFlow", text: "Send money globally with zero hassle. Use my referral link:", url: referralLink });
    } else {
      copyLink();
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Gift className="w-6 h-6 text-pink-500" /> Referral Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Earn rewards for every friend you refer to RemitFlow</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Referrals", value: referralData?.totalReferrals ?? 0, icon: <Users className="w-5 h-5 text-blue-500" />, suffix: "" },
            { label: "Total Earned", value: bonusData?.totalEarned ?? 0, icon: <DollarSign className="w-5 h-5 text-green-500" />, suffix: " USD" },
            { label: "Pending", value: bonusData?.pendingAmount ?? 0, icon: <Clock className="w-5 h-5 text-yellow-500" />, suffix: " USD" },
            { label: "Tier", value: referralData?.totalReferrals ?? "Bronze", icon: <Trophy className="w-5 h-5 text-amber-500" />, suffix: "" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-xl font-bold">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}{s.suffix}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Referral Link */}
        <Card className="bg-gradient-to-r from-pink-50 to-purple-50 border-pink-200">
          <CardHeader><CardTitle className="text-lg">Your Referral Link</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input readOnly value={referralLink} className="bg-white font-mono text-sm" />
              <Button variant="outline" onClick={copyLink} className="gap-2 shrink-0"><Copy className="w-4 h-4" /> Copy</Button>
              <Button onClick={shareLink} className="gap-2 shrink-0"><Share2 className="w-4 h-4" /> Share</Button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-white rounded-lg p-3">
                <p className="font-semibold text-pink-600">$5</p>
                <p className="text-muted-foreground text-xs">You earn per referral</p>
              </div>
              <div className="bg-white rounded-lg p-3">
                <p className="font-semibold text-purple-600">$2</p>
                <p className="text-muted-foreground text-xs">Friend earns on signup</p>
              </div>
              <div className="bg-white rounded-lg p-3">
                <p className="font-semibold text-blue-600">Unlimited</p>
                <p className="text-muted-foreground text-xs">No referral cap</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          {(["overview", "bonuses", "leaderboard"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`pb-2 px-3 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">How It Works</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { step: "1", title: "Share Your Link", desc: "Share your unique referral link with friends and family" },
                    { step: "2", title: "Friend Signs Up", desc: "Your friend creates an account using your referral link" },
                    { step: "3", title: "Both Get Rewarded", desc: "You earn $5 and your friend gets $2 after their first transfer" },
                  ].map(s => (
                    <div key={s.step} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">{s.step}</div>
                      <div>
                        <p className="font-medium text-sm">{s.title}</p>
                        <p className="text-muted-foreground text-xs mt-1">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Tier Progress</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { name: "Bronze", min: 0, max: 5, color: "bg-amber-600" },
                    { name: "Silver", min: 5, max: 20, color: "bg-gray-400" },
                    { name: "Gold", min: 20, max: 50, color: "bg-yellow-500" },
                    { name: "Platinum", min: 50, max: 100, color: "bg-blue-400" },
                  ].map(tier => {
                    const refs = referralData?.totalReferrals ?? 0;
                    const progress = Math.min(100, ((refs - tier.min) / (tier.max - tier.min)) * 100);
                    const active = refs >= tier.min && refs < tier.max;
                    return (
                      <div key={tier.name} className={`p-3 rounded-lg border ${active ? "border-primary bg-primary/5" : ""}`}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{tier.name}</span>
                          <span className="text-muted-foreground">{tier.min}–{tier.max} referrals</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${tier.color} transition-all`} style={{ width: `${Math.max(0, progress)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "bonuses" && (
          <div className="space-y-3">
            {!bonusData?.bonuses.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Gift className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No referral bonuses yet. Share your link to start earning!</p>
              </div>
            ) : bonusData.bonuses.map(b => (
              <Card key={b.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {b.status === "paid" ? <CheckCircle className="w-5 h-5 text-green-500" /> : b.status === "rejected" ? <XCircle className="w-5 h-5 text-red-500" /> : <Clock className="w-5 h-5 text-yellow-500" />}
                      <div>
                        <p className="font-medium text-sm">Referral #{b.id}</p>
                        <p className="text-xs text-muted-foreground">Code: {b.referralCode} · {format(new Date(b.createdAt), "MMM d, yyyy")}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${Number(b.referrerBonus).toFixed(2)} {b.currency}</p>
                      <Badge className={`text-xs ${statusColor[b.status]}`}>{b.status}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "leaderboard" && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-500" /> Top Referrers</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {!leaderboardData?.leaders.length ? (
                  <p className="text-center text-muted-foreground py-8">No leaderboard data yet</p>
                ) : leaderboardData.leaders.map(l => (
                  <div key={l.userId} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${l.rank === 1 ? "bg-yellow-100 text-yellow-700" : l.rank === 2 ? "bg-gray-100 text-gray-700" : l.rank === 3 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                      {l.rank === 1 ? "🥇" : l.rank === 2 ? "🥈" : l.rank === 3 ? "🥉" : l.rank}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.totalReferrals} referrals</p>
                    </div>
                    <p className="font-semibold text-green-600">${l.totalEarned.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
