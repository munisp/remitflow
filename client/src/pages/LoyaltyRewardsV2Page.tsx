import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Star, Gift, Trophy, Zap, Award, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const TIER_COLORS: Record<string, string> = {
  Bronze: "text-orange-600",
  Silver: "text-gray-400",
  Gold: "text-yellow-500",
  Platinum: "text-blue-400",
};

const TIER_BG: Record<string, string> = {
  Bronze: "bg-orange-100 dark:bg-orange-950/30",
  Silver: "bg-gray-100 dark:bg-gray-800/30",
  Gold: "bg-yellow-100 dark:bg-yellow-950/30",
  Platinum: "bg-blue-100 dark:bg-blue-950/30",
};

export default function LoyaltyRewardsV2Page() {
  const { t } = useTranslation();
  const [redeemDialog, setRedeemDialog] = useState(false);
  const [redemptionType, setRedemptionType] = useState<"cashback"|"fee_waiver"|"gift_card">("cashback");
  const [pointsToRedeem, setPointsToRedeem] = useState("500");

  const { data: balance } = trpc.v100.loyaltyRewardsV2.getBalance.useQuery();
  const { data: history } = trpc.v100.loyaltyRewardsV2.getHistory.useQuery({ limit: 20 });

  const redeemMutation = trpc.v100.loyaltyRewardsV2.redeem.useMutation({
    onSuccess: (d) => {
      toast.success(d.message);
      setRedeemDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const tier = balance?.tier ?? "Bronze";

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Star className="w-6 h-6 text-yellow-500" />Loyalty Rewards</h1>
          <p className="text-muted-foreground">Earn points on every transfer, unlock exclusive rewards</p>
        </div>
        <Dialog open={redeemDialog} onOpenChange={setRedeemDialog}>
          <DialogTrigger asChild>
            <Button variant="outline"><Gift className="w-4 h-4 mr-2" />Redeem Points</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Redeem Points</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Redemption Type</Label>
                <Select value={redemptionType} onValueChange={(v) => setRedemptionType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashback">💵 Cashback</SelectItem>
                    <SelectItem value="fee_waiver">🎫 Fee Waiver</SelectItem>
                    <SelectItem value="gift_card">🎁 Gift Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Points to Redeem</Label>
                <Input value={pointsToRedeem} onChange={e => setPointsToRedeem(e.target.value)} type="number" min="100" step="100" />
                <p className="text-xs text-muted-foreground mt-1">Value: ${(Number(pointsToRedeem) * 0.01).toFixed(2)} USD</p>
              </div>
              <Button className="w-full" onClick={() => redeemMutation.mutate({ points: Number(pointsToRedeem), redemptionType })} disabled={redeemMutation.isPending}>
                {redeemMutation.isPending ? "Processing..." : `Redeem ${pointsToRedeem} Points`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Balance Card */}
      {balance && (
        <>
          <div className={`p-6 rounded-xl ${TIER_BG[tier] ?? "bg-muted"}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className={`w-6 h-6 ${TIER_COLORS[tier] ?? "text-primary"}`} />
                  <span className={`text-xl font-bold ${TIER_COLORS[tier] ?? "text-primary"}`}>{tier} Member</span>
                </div>
                <p className="text-3xl font-bold">{balance.points.toLocaleString()} pts</p>
                <p className="text-sm text-muted-foreground">Cash value: ${balance.cashValue.toFixed(2)}</p>
              </div>
              {balance.nextTier && (
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Next tier: {balance.nextTier}</p>
                  <p className="font-semibold">{balance.pointsToNextTier.toLocaleString()} pts needed</p>
                  <div className="w-48 bg-muted rounded-full h-2 mt-2">
                    <div className={`h-2 rounded-full ${TIER_COLORS[tier]?.replace("text-", "bg-") ?? "bg-primary"}`}
                      style={{ width: `${Math.min(100, (balance.points / (balance.points + balance.pointsToNextTier)) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
            {balance.expiringPoints > 0 && (
              <div className="mt-3 p-2 bg-orange-100 dark:bg-orange-950/50 rounded text-sm text-orange-700 dark:text-orange-300">
                ⚠️ {balance.expiringPoints.toLocaleString()} points expiring on {balance.expiringDate ? new Date(balance.expiringDate).toLocaleDateString() : "soon"}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" />Available Points</p>
              <p className="text-2xl font-bold">{balance.points.toLocaleString()}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Gift className="w-3 h-3" />Cash Value</p>
              <p className="text-2xl font-bold">${balance.cashValue.toFixed(2)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" />Points to Next Tier</p>
              <p className="text-2xl font-bold text-green-500">{balance.pointsToNextTier.toLocaleString()}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Award className="w-3 h-3" />Tier</p>
              <p className={`text-2xl font-bold ${TIER_COLORS[tier] ?? ""}`}>{tier}</p>
            </CardContent></Card>
          </div>
        </>
      )}

      {/* Points History */}
      <Card>
        <CardHeader><CardTitle>Points History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(history ?? []).map((h: any) => (
              <div key={h.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">{h.description}</p>
                  <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()} · {h.type}</p>
                </div>
                <span className={`font-bold ${h.points > 0 ? "text-green-500" : "text-red-500"}`}>
                  {h.points > 0 ? "+" : ""}{h.points.toLocaleString()} pts
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
