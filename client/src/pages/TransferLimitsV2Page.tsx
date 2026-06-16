import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link } from "wouter";
import { Shield, TrendingUp, AlertCircle, CheckCircle2, ArrowUpRight, DollarSign, Calendar, Clock } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function TransferLimitsV2Page() {
  const { t } = useTranslation();
  const [increaseOpen, setIncreaseOpen] = useState(false);
  const [increaseForm, setIncreaseForm] = useState({ reason: "", requestedDailyLimit: "", requestedMonthlyLimit: "" });
  const { data: limits, isLoading } = trpc.v99.transferLimitsV2.getMyLimits.useQuery();
  const requestIncreaseMutation = trpc.v99.transferLimitsV2.requestIncrease.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.message} Ref: ${data.ticketRef}`);
      setIncreaseOpen(false);
      setIncreaseForm({ reason: "", requestedDailyLimit: "", requestedMonthlyLimit: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 flex items-center justify-center min-h-[400px]">
          <div className="text-center text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 animate-pulse" />
            <p>Loading transfer limits...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!limits) return null;

  const kycBadge = limits.kycStatus === "approved"
    ? { label: "KYC Verified", className: "bg-emerald-100 text-emerald-700" }
    : limits.kycStatus === "pending"
    ? { label: "KYC Pending", className: "bg-amber-100 text-amber-700" }
    : { label: "KYC Required", className: "bg-red-100 text-red-700" };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Shield className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Transfer Limits</h1>
              <p className="text-muted-foreground text-sm">Your current transfer limits and usage</p>
            </div>
          </div>
          <Badge className={kycBadge.className}>{kycBadge.label}</Badge>
        </div>

        {/* KYC Upgrade Banner */}
        {limits.upgradeRequired && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800">Increase your limits with KYC verification</p>
              <p className="text-sm text-amber-700 mt-1">
                Complete identity verification to unlock up to $50,000/day and $500,000/month transfer limits.
              </p>
            </div>
            <Link href="/kyc">
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white flex-shrink-0">
                Verify Now <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        )}

        {/* Single Transfer Limit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" /> Single Transfer Limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-4xl font-black">${limits.limits.single.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Maximum per transaction</p>
              </div>
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            </div>
          </CardContent>
        </Card>

        {/* Daily & Monthly Usage */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Daily */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Daily Limit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span className="font-semibold">${limits.usage.daily.toLocaleString()}</span>
              </div>
              <Progress value={limits.utilizationPct.daily} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{limits.utilizationPct.daily}% used</span>
                <span>${limits.remaining.daily.toLocaleString()} remaining</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Daily Limit</span>
                <span className="font-bold">${limits.limits.daily.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          {/* Monthly */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" /> Monthly Limit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span className="font-semibold">${limits.usage.monthly.toLocaleString()}</span>
              </div>
              <Progress value={limits.utilizationPct.monthly} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{limits.utilizationPct.monthly}% used</span>
                <span>${limits.remaining.monthly.toLocaleString()} remaining</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Monthly Limit</span>
                <span className="font-bold">${limits.limits.monthly.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tier Comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Limit Tiers
            </CardTitle>
            <CardDescription>Compare limits across KYC verification tiers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Tier</th>
                    <th className="text-right py-2 font-semibold">Single</th>
                    <th className="text-right py-2 font-semibold">Daily</th>
                    <th className="text-right py-2 font-semibold">Monthly</th>
                    <th className="text-right py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { tier: "Unverified", single: 250, daily: 500, monthly: 5000, kyc: "none" },
                    { tier: "KYC Pending", single: 1000, daily: 2000, monthly: 20000, kyc: "pending" },
                    { tier: "KYC Verified", single: 25000, daily: 50000, monthly: 500000, kyc: "approved" },
                  ].map((row) => (
                    <tr key={row.tier} className={`border-b last:border-0 ${row.kyc === limits.kycStatus ? "bg-primary/5 font-semibold" : ""}`}>
                      <td className="py-2">
                        {row.tier}
                        {row.kyc === limits.kycStatus && <Badge className="ml-2 text-xs bg-primary text-primary-foreground">Current</Badge>}
                      </td>
                      <td className="py-2 text-right">${row.single.toLocaleString()}</td>
                      <td className="py-2 text-right">${row.daily.toLocaleString()}</td>
                      <td className="py-2 text-right">${row.monthly.toLocaleString()}</td>
                      <td className="py-2 text-right">
                        {row.kyc === "approved" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto" />
                        ) : row.kyc === limits.kycStatus ? (
                          <Badge className="text-xs bg-amber-100 text-amber-700">Active</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Request Limit Increase */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-primary" /> Request Limit Increase
            </CardTitle>
            <CardDescription>Submit a request to our compliance team for a higher transfer limit</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setIncreaseOpen(true)} className="w-full sm:w-auto">
              <ArrowUpRight className="h-4 w-4 mr-2" /> Request Higher Limits
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Request Increase Dialog */}
      <Dialog open={increaseOpen} onOpenChange={setIncreaseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Limit Increase</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Requested Daily Limit (USD)</label>
              <Input
                type="number"
                placeholder="e.g. 100000"
                value={increaseForm.requestedDailyLimit}
                onChange={e => setIncreaseForm(p => ({ ...p, requestedDailyLimit: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Requested Monthly Limit (USD)</label>
              <Input
                type="number"
                placeholder="e.g. 1000000"
                value={increaseForm.requestedMonthlyLimit}
                onChange={e => setIncreaseForm(p => ({ ...p, requestedMonthlyLimit: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reason for Increase</label>
              <Textarea
                placeholder="Explain your business need for higher limits (min 10 characters)"
                value={increaseForm.reason}
                onChange={e => setIncreaseForm(p => ({ ...p, reason: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncreaseOpen(false)}>Cancel</Button>
            <Button
              disabled={
                !increaseForm.reason ||
                increaseForm.reason.length < 10 ||
                !increaseForm.requestedDailyLimit ||
                !increaseForm.requestedMonthlyLimit ||
                requestIncreaseMutation.isPending
              }
              onClick={() => requestIncreaseMutation.mutate({
                reason: increaseForm.reason,
                requestedDailyLimit: Number(increaseForm.requestedDailyLimit),
                requestedMonthlyLimit: Number(increaseForm.requestedMonthlyLimit),
              })}
            >
              {requestIncreaseMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
