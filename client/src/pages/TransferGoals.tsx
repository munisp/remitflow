import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Target, Plus, Trash2, TrendingUp, Home, GraduationCap, Briefcase, Heart, Building, Leaf, AlertCircle, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const PURPOSE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  land: { label: "Land Purchase", icon: <Home className="h-4 w-4" />, color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" },
  education: { label: "Education", icon: <GraduationCap className="h-4 w-4" />, color: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
  business: { label: "Business Capital", icon: <Briefcase className="h-4 w-4" />, color: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300" },
  healthcare: { label: "Healthcare", icon: <Heart className="h-4 w-4" />, color: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" },
  construction: { label: "Construction", icon: <Building className="h-4 w-4" />, color: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300" },
  emergency: { label: "Emergency Fund", icon: <AlertCircle className="h-4 w-4" />, color: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300" },
  climate: { label: "Climate Resilience", icon: <Leaf className="h-4 w-4" />, color: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" },
  other: { label: "Other", icon: <Target className="h-4 w-4" />, color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" },
};

export default function TransferGoals() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [contributeGoal, setContributeGoal] = useState<any>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [form, setForm] = useState({ name: "", targetAmount: "", currency: "USD", purpose: "other", targetDate: "" });

  const { data: goals, isLoading } = trpc.savings.list.useQuery();

  const createGoal = trpc.savings.create.useMutation({
    onSuccess: () => {
      toast.success("Goal created!");
      utils.savings.list.invalidate();
      setCreateOpen(false);
      setForm({ name: "", targetAmount: "", currency: "USD", purpose: "other", targetDate: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const contribute = trpc.savings.topup.useMutation({
    onSuccess: (data) => {
      toast.success(`Funds added — new total: ${data.newAmount}`);
      utils.savings.list.invalidate();
      setContributeGoal(null);
      setContributeAmount("");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteGoal = trpc.savings.remove.useMutation({
    onSuccess: () => {
      toast.success("Goal deleted");
      utils.savings.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const activeGoals = (goals ?? []).filter((g: any) => g.status === "active");
  const completedGoals = (goals ?? []).filter((g: any) => g.status === "completed");
  const totalSaved = activeGoals.reduce((sum: number, g: any) => sum + parseFloat(g.currentAmount ?? "0"), 0);
  const totalTarget = activeGoals.reduce((sum: number, g: any) => sum + parseFloat(g.targetAmount ?? "0"), 0);

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Savings Goals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Purpose-tag your savings — direct every dollar toward what matters most.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Goal
        </Button>
      </div>

      {activeGoals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-primary/5 to-primary/10">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Active Goals</div>
              <div className="text-2xl font-bold">{activeGoals.length}</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Total Saved</div>
              <div className="text-2xl font-bold text-green-600">${totalSaved.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Overall Progress</div>
              <div className="text-2xl font-bold">{totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%</div>
              <Progress value={totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0} className="h-1 mt-2" />
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : activeGoals.length === 0 && completedGoals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="font-medium text-muted-foreground">No savings goals yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Create a goal to start directing your savings toward land, education, business capital, or any other purpose.
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create First Goal
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeGoals.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Active Goals</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeGoals.map((goal: any) => {
                  const cfg = PURPOSE_CONFIG[goal.purpose ?? "other"] ?? PURPOSE_CONFIG.other;
                  const current = parseFloat(goal.currentAmount ?? "0");
                  const target = parseFloat(goal.targetAmount ?? "0");
                  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
                  return (
                    <Card key={goal.id} className="hover:shadow-sm transition-all">
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${cfg.color}`}>{cfg.icon}</div>
                            <div>
                              <h3 className="font-semibold text-sm">{goal.name}</h3>
                              <p className="text-xs text-muted-foreground">{cfg.label}</p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteGoal.mutate({ id: goal.id })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Progress</span>
                            <span className="font-medium">{pct}%</span>
                          </div>
                          <Progress value={pct} className="h-2" />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">${current.toLocaleString()} {goal.currency}</span>
                            <span>of ${target.toLocaleString()}</span>
                          </div>
                        </div>
                        {goal.targetDate && (
                          <p className="text-xs text-muted-foreground">
                            Target: {new Date(goal.targetDate).toLocaleDateString()}
                          </p>
                        )}
                        <Button
                          size="sm"
                          className="w-full h-8 text-xs"
                          onClick={() => { setContributeGoal(goal); setContributeAmount(""); }}
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Add Funds
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {completedGoals.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-500" />
                Completed Goals
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {completedGoals.map((goal: any) => {
                  const cfg = PURPOSE_CONFIG[goal.purpose ?? "other"] ?? PURPOSE_CONFIG.other;
                  return (
                    <DashboardLayout>
                    <Card key={goal.id} className="opacity-75 border-green-200 dark:border-green-800">
                      <CardContent className="p-5">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${cfg.color}`}>{cfg.icon}</div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-sm">{goal.name}</h3>
                            <p className="text-xs text-green-600 font-medium">✓ Goal reached — ${parseFloat(goal.targetAmount).toLocaleString()} {goal.currency}</p>
                          </div>
                          <Badge variant="outline" className="text-xs border-green-300 text-green-700">Done</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  
                    </DashboardLayout>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* Create Goal Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              New Savings Goal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Goal Name</Label>
              <Input placeholder="e.g. Land in Accra" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Purpose</Label>
              <Select value={form.purpose} onValueChange={v => setForm(f => ({ ...f, purpose: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PURPOSE_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Target Amount</Label>
                <Input type="number" placeholder="5000" value={form.targetAmount} onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Target Date (optional)</Label>
              <Input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createGoal.mutate({ name: form.name, targetAmount: parseFloat(form.targetAmount), currency: form.currency, targetDate: form.targetDate || undefined })}
              disabled={!form.name || !form.targetAmount || createGoal.isPending}
            >
              {createGoal.isPending ? "Creating..." : "Create Goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contribute Dialog */}
      <Dialog open={!!contributeGoal} onOpenChange={() => setContributeGoal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Funds to Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Adding funds to: <span className="font-medium text-foreground">{contributeGoal?.name}</span>
            </p>
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input type="number" placeholder="100" value={contributeAmount} onChange={e => setContributeAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributeGoal(null)}>Cancel</Button>
            <Button
              onClick={() => contribute.mutate({ id: contributeGoal.id, amount: parseFloat(contributeAmount) })}
              disabled={!contributeAmount || contribute.isPending}
            >
              {contribute.isPending ? "Adding..." : "Add Funds"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
