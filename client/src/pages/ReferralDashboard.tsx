import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Gift, Share2, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function ReferralDashboard() {
  const dashboard = trpc.quickWins.referralDashboard.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Referral Dashboard">
      <h1 className="text-2xl font-bold">Referral Program</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Referrals</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{dashboard.data?.totalReferrals ?? 0}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Completed</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-green-600">{dashboard.data?.completedReferrals ?? 0}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-amber-600">{dashboard.data?.pendingReferrals ?? 0}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Earned</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">₦{(dashboard.data?.totalEarned ?? 0).toLocaleString()}</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Share2 className="h-5 w-5" /> Share Your Link</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <input className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted" value={dashboard.data?.shareLink ?? ""} readOnly aria-label="Referral link" />
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(dashboard.data?.shareLink ?? "")}>Copy</Button>
          </div>
          <p className="text-sm text-muted-foreground">Earn ₦1,000 for every friend who completes their first transfer</p>
        </CardContent>
      </Card>
      {dashboard.data?.nextRewardTier && (
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <Trophy className="h-8 w-8 text-yellow-600" />
            <div>
              <p className="font-medium">Next Milestone: {dashboard.data.nextRewardTier.target} referrals</p>
              <p className="text-sm text-muted-foreground">Reward: {dashboard.data.nextRewardTier.reward}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
