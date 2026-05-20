import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PiggyBank, Lock, Unlock, Plus, ArrowDownLeft, ArrowUpRight, Target, Calendar, Percent, Info } from "lucide-react";
import { useTranslation } from 'react-i18next';

const LOCK_PERIODS = [
  { days: 30, label: "1 Month", apy: 4.0 },
  { days: 90, label: "3 Months", apy: 5.0 },
  { days: 180, label: "6 Months", apy: 5.5 },
  { days: 365, label: "1 Year", apy: 6.0 },
];

export default function Savings() {
  const { t } = useTranslation();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositType, setDepositType] = useState<"flex" | "locked">("flex");
  const [lockPeriod, setLockPeriod] = useState("90");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDeadline, setGoalDeadline] = useState("");
  const [calcAmount, setCalcAmount] = useState("1000");
  const [calcPeriod, setCalcPeriod] = useState("365");

  const { data: savingsData, refetch } = trpc.savings.getAccount.useQuery(undefined, { retry: false });
  const { data: transactions } = trpc.savings.getTransactions.useQuery({ limit: 20 }, { retry: false });
  const { data: goals, refetch: refetchGoals } = trpc.savings.getGoals.useQuery(undefined, { retry: false });

  const depositMutation = trpc.savings.deposit.useMutation({
    onSuccess: () => { toast.success("Deposit successful!"); setDepositOpen(false); setDepositAmount(""); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const withdrawMutation = trpc.savings.withdraw.useMutation({
    onSuccess: () => { toast.success("Withdrawal initiated!"); setWithdrawOpen(false); setWithdrawAmount(""); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const createGoalMutation = trpc.savings.createGoal.useMutation({
    onSuccess: () => { toast.success("Goal created!"); setCreateGoalOpen(false); setGoalName(""); setGoalTarget(""); setGoalDeadline(""); refetchGoals(); },
    onError: (e) => toast.error(e.message),
  });

  const flexBalance = (savingsData as any)?.flexBalance ?? 0;
  const lockedBalance = (savingsData as any)?.lockedBalance ?? 0;
  const totalBalance = flexBalance + lockedBalance;
  const totalInterestEarned = (savingsData as any)?.totalInterestEarned ?? 0;
  const calcAPY = depositType === "flex" ? 3.0 : LOCK_PERIODS.find(p => p.days === parseInt(lockPeriod))?.apy ?? 6.0;
  const calcInterest = parseFloat(calcAmount || "0") * (calcAPY / 100) * (parseInt(calcPeriod || "365") / 365);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><PiggyBank className="h-6 w-6 text-primary" />Savings</h1>
            <p className="text-muted-foreground text-sm mt-1">Earn up to 6% APY on your savings</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setWithdrawOpen(true)}><ArrowUpRight className="h-4 w-4 mr-2" />Withdraw</Button>
            <Button onClick={() => setDepositOpen(true)}><Plus className="h-4 w-4 mr-2" />Deposit</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Balance</p>
              <p className="text-3xl font-bold">${totalBalance.toFixed(2)}</p>
              <p className="text-xs text-green-500 mt-1">+${totalInterestEarned.toFixed(2)} interest earned</p>
            </CardContent>
          </Card>
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><Unlock className="h-3 w-3" />Flex Savings</p>
            <p className="text-2xl font-bold">${flexBalance.toFixed(2)}</p>
            <Badge variant="secondary" className="mt-1">3.0% APY</Badge>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Locked Savings</p>
            <p className="text-2xl font-bold">${lockedBalance.toFixed(2)}</p>
            <Badge variant="secondary" className="mt-1">Up to 6.0% APY</Badge>
          </CardContent></Card>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="goals">Goals</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="calculator">Calculator</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Unlock className="h-4 w-4" />Flex Savings</CardTitle>
                  <CardDescription>Withdraw anytime, earn 3.0% APY</CardDescription></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold mb-2">${flexBalance.toFixed(2)}</div>
                  <div className="text-sm text-muted-foreground mb-3">Monthly interest: ~${(flexBalance * 0.03 / 12).toFixed(2)}</div>
                  <Button size="sm" className="w-full" onClick={() => { setDepositType("flex"); setDepositOpen(true); }}>Add to Flex Savings</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" />Locked Savings</CardTitle>
                  <CardDescription>Lock for higher returns</CardDescription></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold mb-2">${lockedBalance.toFixed(2)}</div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {LOCK_PERIODS.map(p => (
                      <div key={p.days} className="text-center p-2 rounded-lg bg-muted">
                        <div className="text-xs text-muted-foreground">{p.label}</div>
                        <div className="font-semibold text-primary">{p.apy}%</div>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" className="w-full" variant="outline" onClick={() => { setDepositType("locked"); setDepositOpen(true); }}>Lock Savings</Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="goals" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Savings Goals</h3>
              <Button size="sm" onClick={() => setCreateGoalOpen(true)}><Target className="h-4 w-4 mr-2" />New Goal</Button>
            </div>
            {!goals || (goals as any[]).length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Target className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium">No savings goals yet</p>
                <p className="text-sm text-muted-foreground mb-4">Create a goal to track your progress</p>
                <Button onClick={() => setCreateGoalOpen(true)}>Create First Goal</Button>
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(goals as any[]).map((goal) => {
                  const progress = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
                  const daysLeft = goal.deadline ? Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000)) : null;
                  const r = 28; const circ = 2 * Math.PI * r;
                  const dash = (progress / 100) * circ;
                  return (
                    <Card key={goal.id} className="hover:shadow-md transition-shadow"><CardContent className="pt-4">
                      <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                          <svg width="72" height="72" className="-rotate-90">
                            <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/30" />
                            <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="5"
                              className={progress >= 100 ? "text-green-500" : "text-primary"}
                              strokeDasharray={`${dash} ${circ}`}
                              strokeLinecap="round"
                              style={{ transition: "stroke-dasharray 0.6s ease" }}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-xs font-bold ${progress >= 100 ? "text-green-600" : "text-foreground"}`}>
                              {progress >= 100 ? "✓" : `${Math.round(progress)}%`}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{goal.name}</p>
                          <div className="flex justify-between text-xs mt-1">
                            <span className="text-muted-foreground">${parseFloat(goal.currentAmount).toFixed(2)} saved</span>
                            <span className="font-medium">${parseFloat(goal.targetAmount).toFixed(2)} goal</span>
                          </div>
                          {daysLeft !== null && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Calendar className="h-3 w-3" />
                              {daysLeft === 0 ? "Due today" : `${daysLeft} days left`}
                            </p>
                          )}
                          {progress >= 100 && (
                            <Badge className="mt-1 text-[10px] bg-green-100 text-green-700 border-green-200">Goal Achieved!</Badge>
                          )}
                        </div>
                      </div>
                    </CardContent></Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <Card><CardHeader><CardTitle className="text-base">Transaction History</CardTitle></CardHeader>
              <CardContent>
                {!transactions || (transactions as any[]).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No transactions yet</div>
                ) : (
                  <div className="space-y-2">
                    {(transactions as any[]).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50">
                        <div className="flex items-center gap-3">
                          {tx.type === "deposit" ? <ArrowDownLeft className="h-4 w-4 text-green-500" /> : <ArrowUpRight className="h-4 w-4 text-red-500" />}
                          <div>
                            <p className="text-sm font-medium capitalize">{tx.type}</p>
                            <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className={`font-semibold ${tx.type === "deposit" ? "text-green-500" : "text-red-500"}`}>
                          {tx.type === "deposit" ? "+" : "-"}${parseFloat(tx.amount).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calculator">
            <Card><CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Percent className="h-4 w-4" />APY Calculator</CardTitle>
              <CardDescription>Estimate your earnings</CardDescription>
            </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Amount (USD)</Label>
                    <Input type="number" value={calcAmount} onChange={e => setCalcAmount(e.target.value)} placeholder="1000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={depositType} onValueChange={v => setDepositType(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flex">Flex (3.0% APY)</SelectItem>
                        <SelectItem value="locked">Locked (up to 6.0% APY)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {depositType === "locked" ? (
                    <div className="space-y-2">
                      <Label>Lock Period</Label>
                      <Select value={lockPeriod} onValueChange={setLockPeriod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LOCK_PERIODS.map(p => <SelectItem key={p.days} value={String(p.days)}>{p.label} ({p.apy}%)</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Duration (days)</Label>
                      <Input type="number" value={calcPeriod} onChange={e => setCalcPeriod(e.target.value)} placeholder="365" />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg text-center">
                  <div><p className="text-xs text-muted-foreground">Principal</p><p className="text-xl font-bold">${parseFloat(calcAmount || "0").toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Interest</p><p className="text-xl font-bold text-green-500">+${calcInterest.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold text-primary">${(parseFloat(calcAmount || "0") + calcInterest).toFixed(2)}</p></div>
                </div>
                <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg text-sm">
                  <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">APY calculated on simple interest basis. Early withdrawal from locked savings incurs a 2% fee.</p>
                </div>
                <Button className="w-full" onClick={() => setDepositOpen(true)}>Start Saving Now</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Deposit to Savings</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Savings Type</Label>
                <Select value={depositType} onValueChange={v => setDepositType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flex">Flex Savings (3.0% APY)</SelectItem>
                    <SelectItem value="locked">Locked Savings (up to 6.0% APY)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {depositType === "locked" && (
                <div className="space-y-2">
                  <Label>Lock Period</Label>
                  <Select value={lockPeriod} onValueChange={setLockPeriod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOCK_PERIODS.map(p => <SelectItem key={p.days} value={String(p.days)}>{p.label} — {p.apy}% APY</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Amount (USD)</Label>
                <Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="Min $5" min={5} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDepositOpen(false)}>Cancel</Button>
              <Button disabled={!depositAmount || parseFloat(depositAmount) < 5 || depositMutation.isPending}
                onClick={() => depositMutation.mutate({ amount: parseFloat(depositAmount), type: depositType, lockDays: depositType === "locked" ? parseInt(lockPeriod) : undefined })}>
                {depositMutation.isPending ? "Processing..." : "Confirm Deposit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Withdraw from Flex Savings</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg"><p className="text-sm text-muted-foreground">Available (Flex)</p><p className="text-xl font-bold">${flexBalance.toFixed(2)}</p></div>
              <div className="space-y-2"><Label>Amount (USD)</Label>
                <Input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} placeholder="Enter amount" max={flexBalance} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWithdrawOpen(false)}>Cancel</Button>
              <Button disabled={!withdrawAmount || parseFloat(withdrawAmount) > flexBalance || withdrawMutation.isPending}
                onClick={() => withdrawMutation.mutate({ amount: parseFloat(withdrawAmount) })}>
                {withdrawMutation.isPending ? "Processing..." : "Withdraw"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={createGoalOpen} onOpenChange={setCreateGoalOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Goal Name</Label>
                <Input value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="e.g. Emergency Fund, Holiday" />
              </div>
              <div className="space-y-2"><Label>Target Amount (USD)</Label>
                <Input type="number" value={goalTarget} onChange={e => setGoalTarget(e.target.value)} placeholder="5000" min="1" />
              </div>
              <div className="space-y-2"><Label>Target Date (optional)</Label>
                <Input type="date" value={goalDeadline} onChange={e => setGoalDeadline(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateGoalOpen(false)}>Cancel</Button>
              <Button disabled={!goalName || !goalTarget || createGoalMutation.isPending}
                onClick={() => createGoalMutation.mutate({ name: goalName, targetAmount: parseFloat(goalTarget), deadline: goalDeadline || undefined })}>
                {createGoalMutation.isPending ? "Creating..." : "Create Goal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
