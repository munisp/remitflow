import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Shield, TrendingUp, AlertTriangle, CheckCircle2, Edit2, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";

const TIER_INFO = [
  { tier: "tier1", label: "Tier 1 — Basic", dailyLimit: 500, monthlyLimit: 2000, singleLimit: 200, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20", desc: "Email verified only. Suitable for small personal transfers." },
  { tier: "tier2", label: "Tier 2 — Enhanced", dailyLimit: 5000, monthlyLimit: 20000, singleLimit: 2000, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-900/20", desc: "Government ID verified. Suitable for regular remittances." },
  { tier: "tier3", label: "Tier 3 — Full", dailyLimit: 50000, monthlyLimit: 200000, singleLimit: 10000, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20", desc: "Full KYC + source of funds. For high-volume senders." },
];

export default function TransferLimits() {
  const [editDialog, setEditDialog] = useState(false);
  const [selectedTier, setSelectedTier] = useState("tier1");
  const [dailyOverride, setDailyOverride] = useState("");
  const [monthlyOverride, setMonthlyOverride] = useState("");
  const [singleOverride, setSingleOverride] = useState("");

  const { data: usage, isLoading, refetch } = trpc.transferLimits.getMyUsage.useQuery();
  const { data: adminLimits, refetch: refetchAdmin } = trpc.transferLimits.getAdminLimits.useQuery();

  const updateMutation = trpc.transferLimits.updateTierLimits.useMutation({
    onSuccess: () => {
      toast.success("Transfer limits updated");
      setEditDialog(false);
      refetchAdmin();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleEdit = (tier: string) => {
    setSelectedTier(tier);
    const existing = adminLimits?.limits?.find((l: any) => l.tier === tier);
    if (existing) {
      setDailyOverride(String(existing.daily_limit));
      setMonthlyOverride(String(existing.monthly_limit));
      setSingleOverride(String(existing.single_limit));
    } else {
      const def = TIER_INFO.find(t => t.tier === tier);
      setDailyOverride(String(def?.dailyLimit ?? ""));
      setMonthlyOverride(String(def?.monthlyLimit ?? ""));
      setSingleOverride(String(def?.singleLimit ?? ""));
    }
    setEditDialog(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      tier: selectedTier as any,
      dailyLimit: parseFloat(dailyOverride),
      monthlyLimit: parseFloat(monthlyOverride),
      singleLimit: parseFloat(singleOverride),
    });
  };

  const myTier = usage?.tier ?? "tier1";
  const tierDef = TIER_INFO.find(t => t.tier === myTier) ?? TIER_INFO[0];
  const dailyUsed = usage?.dailyUsed ?? 0;
  const monthlyUsed = usage?.monthlyUsed ?? 0;
  const dailyLimit = usage?.dailyLimit ?? tierDef.dailyLimit;
  const monthlyLimit = usage?.monthlyLimit ?? tierDef.monthlyLimit;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-purple-500" />
              Transfer Limits
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Your current limits and usage based on KYC tier</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* My Current Usage */}
        {!isLoading && usage && (
          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>My Current Usage</span>
                <Badge className={`${tierDef.bg} ${tierDef.color} border-0`}>{tierDef.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Daily */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Daily Usage</span>
                  </div>
                  <span className="text-sm">
                    <span className={dailyUsed / dailyLimit > 0.8 ? "text-red-600 font-semibold" : "font-medium"}>
                      ${dailyUsed.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground"> / ${dailyLimit.toLocaleString()}</span>
                  </span>
                </div>
                <Progress value={(dailyUsed / dailyLimit) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  ${(dailyLimit - dailyUsed).toLocaleString()} remaining today
                  {dailyUsed / dailyLimit > 0.8 && <span className="text-amber-600 ml-2">⚠ Approaching limit</span>}
                </p>
              </div>
              {/* Monthly */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Monthly Usage</span>
                  </div>
                  <span className="text-sm">
                    <span className={monthlyUsed / monthlyLimit > 0.8 ? "text-red-600 font-semibold" : "font-medium"}>
                      ${monthlyUsed.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground"> / ${monthlyLimit.toLocaleString()}</span>
                  </span>
                </div>
                <Progress value={(monthlyUsed / monthlyLimit) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">${(monthlyLimit - monthlyUsed).toLocaleString()} remaining this month</p>
              </div>
              {/* Single Transaction */}
              <div className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">Max single transfer</span>
                </div>
                <span className="font-semibold">${(usage?.singleLimit ?? tierDef.singleLimit).toLocaleString()}</span>
              </div>
              {/* Upgrade CTA */}
              {myTier !== "tier3" && (
                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-purple-800 dark:text-purple-300">Increase your limits</p>
                    <p className="text-xs text-purple-600 dark:text-purple-400">Complete KYC to unlock higher transfer limits</p>
                  </div>
                  <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => window.location.href = "/kyc"}>
                    Upgrade KYC
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tier Comparison Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tier Limit Schedule</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Tier</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Daily Limit</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Monthly Limit</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Single Transfer</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Requirements</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Admin Override</th>
                  </tr>
                </thead>
                <tbody>
                  {TIER_INFO.map((tier) => {
                    const override = adminLimits?.limits?.find((l: any) => l.tier === tier.tier);
                    const isActive = myTier === tier.tier;
                    return (
                      <tr key={tier.tier} className={`border-b hover:bg-muted/20 transition-colors ${isActive ? "bg-purple-50/50 dark:bg-purple-900/10" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isActive && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                            <div>
                              <p className={`font-medium ${tier.color}`}>{tier.label}</p>
                              <p className="text-xs text-muted-foreground">{tier.desc}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          ${(override?.daily_limit ?? tier.dailyLimit).toLocaleString()}
                          {override && <p className="text-xs text-purple-600">overridden</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          ${(override?.monthly_limit ?? tier.monthlyLimit).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          ${(override?.single_limit ?? tier.singleLimit).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {tier.tier === "tier1" && "Email verification"}
                          {tier.tier === "tier2" && "Government ID + selfie"}
                          {tier.tier === "tier3" && "Full KYC + source of funds"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => handleEdit(tier.tier)}>
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Compliance Note */}
        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Regulatory Compliance</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Transfer limits are set in accordance with FinCEN regulations, FCA guidelines, and AML/KYC requirements.
                  Transactions exceeding $10,000 in a single day automatically trigger Currency Transaction Reports (CTR).
                  Suspicious activity patterns trigger Suspicious Activity Reports (SAR) regardless of amount.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={editDialog} onOpenChange={setEditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Override Limits — {TIER_INFO.find(t => t.tier === selectedTier)?.label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                Admin overrides apply to all users in this tier. Changes take effect immediately.
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">Daily Limit (USD)</Label>
                <Input type="number" value={dailyOverride} onChange={(e) => setDailyOverride(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">Monthly Limit (USD)</Label>
                <Input type="number" value={monthlyOverride} onChange={(e) => setMonthlyOverride(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">Single Transaction Limit (USD)</Label>
                <Input type="number" value={singleOverride} onChange={(e) => setSingleOverride(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save Limits"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
