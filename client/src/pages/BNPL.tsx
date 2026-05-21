import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CreditCard, CheckCircle, Clock, AlertCircle, Sparkles, ChevronRight, ShieldCheck } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function BNPL() {
  const { t } = useTranslation();
  const [planName, setPlanName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installmentCount, setInstallmentCount] = useState(3);
  const [merchantName, setMerchantName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  const eligibilityQ = trpc.bnplFull.eligibility.useQuery();
  const myPlansQ = trpc.bnplFull.myPlans.useQuery();
  const installmentsQ = trpc.bnplFull.installments.useQuery(
    { planId: selectedPlanId! },
    { enabled: !!selectedPlanId }
  );

  const createMutation = trpc.bnplFull.createPlan.useMutation({
    onSuccess: (d) => {
      toast.success(d.message);
      setApplyOpen(false);
      setPlanName(""); setTotalAmount(""); setMerchantName(""); setPurpose("");
      myPlansQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const payMutation = trpc.bnplFull.payInstallment.useMutation({
    onSuccess: (d) => {
      toast.success(d.message);
      installmentsQ.refetch();
      myPlansQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const elig = eligibilityQ.data;
  const totalNgn = parseFloat(totalAmount) || 0;
  const installmentAmt = totalNgn > 0 ? Math.ceil(totalNgn * 1.025 / installmentCount) : 0;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { active: "default", completed: "secondary", paused: "outline", cancelled: "destructive" };
    return <Badge variant={(map[status] ?? "outline") as any} className="capitalize">{status}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-950 rounded-lg">
              <CreditCard className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Buy Now, Pay Later</h1>
              <p className="text-muted-foreground">Split your payments into manageable installments</p>
            </div>
          </div>
          <Button onClick={() => setApplyOpen(true)} disabled={!elig?.eligible}>
            <Sparkles className="h-4 w-4 mr-2" />New Plan
          </Button>
        </div>

        {/* Eligibility Card */}
        {eligibilityQ.isPending ? (
          <div className="h-24 bg-muted animate-pulse rounded-xl" />
        ) : elig && (
          <Card className={elig.eligible ? "border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30" : "border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30"}>
            <CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <ShieldCheck className={`h-8 w-8 ${elig.eligible ? "text-purple-600" : "text-orange-500"}`} />
                <div>
                  <p className="font-semibold">{elig.eligible ? `Credit Score: ${elig.creditScore}` : "KYC Required"}</p>
                  <p className="text-sm text-muted-foreground">{elig.reason}</p>
                </div>
              </div>
              {elig.eligible && (
                <div className="text-right">
                  <p className="text-2xl font-bold text-purple-600">₦{elig.creditLimit.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Credit Limit · {elig.interestRate}% monthly</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">My Plans ({myPlansQ.data?.length ?? 0})</TabsTrigger>
            {selectedPlanId && <TabsTrigger value="schedule">Installment Schedule</TabsTrigger>}
          </TabsList>

          <TabsContent value="plans" className="space-y-3 mt-4">
            {myPlansQ.isPending ? (
              <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}</div>
            ) : (myPlansQ.data as any[])?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No BNPL plans yet.</p>
                  <Button className="mt-4" onClick={() => setApplyOpen(true)} disabled={!elig?.eligible}>
                    Create Your First Plan
                  </Button>
                </CardContent>
              </Card>
            ) : (
              (myPlansQ.data as any[])?.map((plan: any) => {
                const paidCount = Number(plan.paid_count ?? 0);
                const totalInstallments = Number(plan.installment_count ?? 1);
                const progress = Math.round((paidCount / totalInstallments) * 100);
                return (
                  <Card key={plan.id} className="hover:border-purple-300 transition-colors cursor-pointer" onClick={() => setSelectedPlanId(plan.id)}>
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold">{plan.plan_name}</p>
                          <p className="text-sm text-muted-foreground">{plan.merchant_name || "Personal"} · {plan.purpose || "General"}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(plan.status)}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="flex justify-between text-sm mb-2">
                        <span>₦{Number(plan.installment_amount_ngn).toLocaleString()} × {totalInstallments} months</span>
                        <span className="text-muted-foreground">{paidCount}/{totalInstallments} paid</span>
                      </div>
                      <Progress value={progress} className="h-2" />
                      {plan.next_payment_date && plan.status === "active" && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Next payment: {new Date(plan.next_payment_date).toLocaleDateString()}
                          {Number(plan.overdue_count) > 0 && <span className="text-red-500 ml-2">· {plan.overdue_count} overdue</span>}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          {selectedPlanId && (
            <TabsContent value="schedule" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Installment Schedule</CardTitle>
                  <CardDescription>
                    {(myPlansQ.data as any[])?.find((p: any) => p.id === selectedPlanId)?.plan_name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {installmentsQ.isPending ? (
                    <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
                  ) : (
                    <div className="space-y-2">
                      {(installmentsQ.data as any[])?.map((inst: any) => (
                        <div key={inst.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            {inst.status === "paid" ? <CheckCircle className="h-4 w-4 text-green-500" /> :
                              inst.status === "overdue" ? <AlertCircle className="h-4 w-4 text-red-500" /> :
                              <Clock className="h-4 w-4 text-muted-foreground" />}
                            <div>
                              <p className="text-sm font-medium">Installment #{inst.installment_number}</p>
                              <p className="text-xs text-muted-foreground">Due: {new Date(inst.due_date).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">₦{Number(inst.amount_ngn).toLocaleString()}</span>
                            {inst.status === "pending" && (
                              <Button size="sm" onClick={() => payMutation.mutate({ installmentId: inst.id })} disabled={payMutation.isPending}>
                                Pay Now
                              </Button>
                            )}
                            {inst.status === "paid" && <Badge variant="secondary">Paid</Badge>}
                            {inst.status === "overdue" && <Badge variant="destructive">Overdue</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>

        {/* Create Plan Dialog */}
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create BNPL Plan</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Plan Name</Label>
                <Input placeholder="e.g., School Fees Q3 2026" value={planName} onChange={e => setPlanName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Total Amount (₦)</Label>
                <Input type="number" placeholder="50000" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} min={5000} max={elig?.creditLimit ?? 5000000} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">Max: ₦{(elig?.creditLimit ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <Label>Number of Installments</Label>
                <div className="flex gap-2 mt-1">
                  {[1, 2, 3, 6, 9, 12].map(n => (
                    <button key={n} onClick={() => setInstallmentCount(n)}
                      className={"px-3 py-1.5 rounded-lg border text-sm font-medium transition-all " + (installmentCount === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50")}>
                      {n}mo
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Merchant / Purpose</Label>
                <Input placeholder="e.g., Lagos Business School" value={merchantName} onChange={e => setMerchantName(e.target.value)} className="mt-1" />
              </div>
              {totalNgn > 0 && (
                <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span>Monthly payment:</span><span className="font-bold text-purple-600">₦{installmentAmt.toLocaleString()}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Total (2.5% interest):</span><span>₦{(installmentAmt * installmentCount).toLocaleString()}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Interest rate:</span><span>2.5% per month</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!planName || !totalAmount || createMutation.isPending}
                onClick={() => createMutation.mutate({ planName, totalAmountNgn: totalNgn, installmentCount, merchantName: merchantName || undefined, purpose: purpose || undefined })}>
                {createMutation.isPending ? "Creating..." : "Create Plan"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
