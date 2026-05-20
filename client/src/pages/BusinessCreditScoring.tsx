import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TrendingUp, DollarSign, Star, Clock, Plus, RefreshCw } from "lucide-react";

const GRADE_COLORS: Record<string, string> = {
  AAA: "bg-emerald-100 text-emerald-800",
  AA: "bg-green-100 text-green-800",
  A: "bg-lime-100 text-lime-800",
  BBB: "bg-yellow-100 text-yellow-800",
  BB: "bg-orange-100 text-orange-800",
  B: "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  disbursed: "bg-emerald-100 text-emerald-700",
};

export default function BusinessCreditScoring() {
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyForm, setApplyForm] = useState({ requestedUsd: "", termMonths: "12", purpose: "" });

  const utils = trpc.useUtils();
  const companyId = 1; // default company
  const { data: score, isLoading: loadingScore } = trpc.businessCreditScoring.getScore.useQuery({ companyId });
  const { data: applications, isLoading: loadingApps } = trpc.businessCreditScoring.listApplications.useQuery({ companyId: undefined });

  // requestScore: { companyId }
  const requestScore = trpc.businessCreditScoring.requestScore.useMutation({
    onSuccess: () => {
      toast("Score requested", { description: "Credit score calculation initiated. Results available shortly." });
      utils.businessCreditScoring.getScore.invalidate();
    },
    onError: (e) => toast.error("Failed", { description: e.message }),
  });

  // applyForCredit: { companyId, requestedUsd, termMonths, purpose? }
  const applyForCredit = trpc.businessCreditScoring.applyForCredit.useMutation({
    onSuccess: () => {
      toast("Credit application submitted", { description: "Application under review. Typical decision: 24-48 hours." });
      utils.businessCreditScoring.listApplications.invalidate();
      setApplyOpen(false);
      setApplyForm({ requestedUsd: "", termMonths: "12", purpose: "" });
    },
    onError: (e) => toast.error("Application failed", { description: e.message }),
  });

  const creditScore = score as any;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Business Credit Scoring</h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered credit assessment for SMEs — get scored and access credit facilities</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => requestScore.mutate({ companyId })} disabled={requestScore.isPending}>
            <RefreshCw className={`w-4 h-4 mr-2 ${requestScore.isPending ? "animate-spin" : ""}`} />
            {requestScore.isPending ? "Scoring..." : "Request Score"}
          </Button>
          <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
            <DialogTrigger asChild>
              <Button disabled={!creditScore}><Plus className="w-4 h-4 mr-2" />Apply for Credit</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Credit Application</DialogTitle></DialogHeader>
              {creditScore && (
                <div className="bg-muted rounded-lg p-3 text-sm mb-3">
                  <p>Your credit grade: <Badge className={`${GRADE_COLORS[creditScore.grade] ?? ""} ml-1`}>{creditScore.grade}</Badge></p>
                  <p className="text-muted-foreground text-xs mt-1">Max limit: ${Number(creditScore.maxCreditLimitUsd ?? 0).toLocaleString()}</p>
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Requested Amount (USD)</Label>
                  <Input type="number" placeholder="50000" value={applyForm.requestedUsd}
                    onChange={e => setApplyForm(f => ({ ...f, requestedUsd: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Term (Months)</Label>
                  <Input type="number" min="3" max="60" placeholder="12" value={applyForm.termMonths}
                    onChange={e => setApplyForm(f => ({ ...f, termMonths: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Purpose (optional)</Label>
                  <Input placeholder="Working capital, equipment purchase..." value={applyForm.purpose}
                    onChange={e => setApplyForm(f => ({ ...f, purpose: e.target.value }))} />
                </div>
              </div>
              <Button className="w-full mt-4"
                onClick={() => applyForCredit.mutate({
                  companyId,
                  requestedUsd: parseFloat(applyForm.requestedUsd) || 0,
                  termMonths: parseInt(applyForm.termMonths) || 12,
                  purpose: applyForm.purpose || undefined,
                })}
                disabled={applyForCredit.isPending || !applyForm.requestedUsd}>
                {applyForCredit.isPending ? "Submitting..." : "Submit Application"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Credit Score Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader><CardTitle className="text-base">Credit Score</CardTitle></CardHeader>
          <CardContent>
            {loadingScore ? (
              <div className="h-24 bg-muted animate-pulse rounded" />
            ) : !creditScore ? (
              <div className="text-center py-6 text-muted-foreground">
                <Star className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No score yet.</p>
                <Button size="sm" className="mt-3" onClick={() => requestScore.mutate({ companyId })} disabled={requestScore.isPending}>
                  Request Score
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`text-4xl font-black px-4 py-2 rounded-xl ${GRADE_COLORS[creditScore.grade] ?? "bg-gray-100"}`}>
                    {creditScore.grade}
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{creditScore.score}</p>
                    <p className="text-xs text-muted-foreground">out of 1000</p>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Max credit limit: <span className="font-semibold text-foreground">${Number(creditScore.maxCreditLimitUsd ?? 0).toLocaleString()}</span></p>
                  <p>Interest rate: <span className="font-semibold text-foreground">{Number(creditScore.interestRatePct ?? 0).toFixed(1)}% p.a.</span></p>
                  <p>Expires: {creditScore.expiresAt ? new Date(creditScore.expiresAt).toLocaleDateString() : "—"}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          {[
            { label: "Applications", value: String((applications as any[])?.length ?? 0), icon: TrendingUp, color: "text-blue-600" },
            { label: "Approved Credit", value: `$${((applications as any[])?.filter((a: any) => a.status === "approved").reduce((s: number, a: any) => s + parseFloat(a.approvedUsd ?? a.requestedUsd ?? 0), 0) ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
            { label: "Pending", value: String((applications as any[])?.filter((a: any) => ["submitted", "under_review"].includes(a.status)).length ?? 0), icon: Clock, color: "text-amber-600" },
            { label: "Credit Grade", value: creditScore?.grade ?? "—", icon: Star, color: "text-purple-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Applications */}
      <Card>
        <CardHeader><CardTitle className="text-base">Credit Applications</CardTitle></CardHeader>
        <CardContent>
          {loadingApps ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          ) : !(applications as any[])?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No credit applications yet. Get your credit score first, then apply for a credit facility.</p>
            </div>
          ) : (
            <div className="divide-y">
              {(applications as any[])?.map((app: any) => (
                <div key={app.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">${Number(app.requestedUsd ?? 0).toLocaleString()} requested</p>
                    <p className="text-xs text-muted-foreground">{app.purpose ?? "General purpose"} · {app.termMonths} months · {Number(app.interestRatePct ?? 0).toFixed(1)}% p.a.</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(app.createdAt).toLocaleDateString()}</p>
                  <Badge className={`text-xs ${STATUS_COLORS[app.status] ?? ""}`}>{app.status.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
