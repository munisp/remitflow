import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Target, Plus, TrendingUp, Calendar, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function SavingsGoals() {
  const { t } = useTranslation();
  
  const utils = trpc.useUtils();
  const { data: goals, isLoading } = trpc.savingsGoals.list.useQuery();
  const createMutation = trpc.savingsGoals.create.useMutation({ onSuccess: () => { toast.success("Goal created!"); utils.savingsGoals.list.invalidate(); setOpen(false); } });
  const topupMutation = trpc.savingsGoals.topup.useMutation({ onSuccess: (d: any) => { toast.success(`Top-up successful! Balance: ${d.newAmount?.toFixed(2)}`); utils.savingsGoals.list.invalidate(); setTopupGoal(null); setTopupAmt(""); }, onError: (e) => toast.error(e.message) });
  const removeMutation = trpc.savingsGoals.remove.useMutation({ onSuccess: () => { toast.success("Goal removed"); utils.savingsGoals.list.invalidate(); }, onError: (e) => toast.error(e.message) });
  const [open, setOpen] = useState(false);
  const [topupGoal, setTopupGoal] = useState<any>(null);
  const [topupAmt, setTopupAmt] = useState("");
  const [form, setForm] = useState({ name: "", emoji: "🎯", targetAmount: "", currency: "NGN", targetDate: "", autoSave: false, autoSaveAmount: "" });

  const ICONS = ["🏠", "✈️", "🎓", "🚗", "💍", "💻", "🏖️", "💰", "🎯", "🛡️", "📱", "🌍"];
  const totalSaved = (goals as any[] ?? []).reduce((s: number, g: any) => s + Number(g.currentAmount ?? 0), 0);
  const totalTarget = (goals as any[] ?? []).reduce((s: number, g: any) => s + Number(g.targetAmount ?? 0), 0);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Target className="h-5 w-5 text-emerald-600" /></div>
            <div><h1 className="text-2xl font-bold">Savings Goals</h1><p className="text-muted-foreground text-sm">Save towards your goals</p></div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Goal</Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Saved</p><p className="text-xl font-bold">{totalSaved.toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Target</p><p className="text-xl font-bold">{totalTarget.toLocaleString()}</p></CardContent></Card>
        </div>

        {isLoading ? <p className="text-muted-foreground text-sm">Loading goals...</p> : null}

        <div className="grid gap-4">
          {((goals as any[]) ?? []).map((g: any) => {
            const pct = Math.min(100, Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100));
            return (
              <Card key={g.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="text-3xl">{g.emoji ?? "💰"}</div>
                    <div className="flex-1">
                      <div className="font-bold">{g.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Target: {g.targetDate ? new Date(g.targetDate).toLocaleDateString() : "Not set"}</div>
                    </div>
                    <Badge variant={pct >= 100 ? "default" : "secondary"} className="text-xs">{pct >= 100 ? "🎉 Achieved!" : `${pct}%`}</Badge>
                  </div>
                  <Progress value={pct} className="h-2 mb-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{g.currency} {Number(g.currentAmount ?? 0).toLocaleString()}</span>
                    <span className="text-muted-foreground">of {g.currency} {Number(g.targetAmount ?? 0).toLocaleString()}</span>
                  </div>
                  {g.autoSave && (
                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3 text-emerald-500" />Auto-saving {g.currency} {Number(g.autoSaveAmount ?? 0).toLocaleString()} monthly</div>
                  )}
                  <div className="flex gap-2 mt-3">
                    {g.status !== "completed" && (
                      <Button size="sm" className="flex-1" variant="outline" onClick={() => { setTopupGoal(g); setTopupAmt(""); }}><PiggyBank className="h-4 w-4 mr-1" />Top Up</Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeMutation.mutate({ id: g.id })}>Remove</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Top-up Dialog */}
        <Dialog open={!!topupGoal} onOpenChange={open => { if (!open) setTopupGoal(null); }}>
          <DialogContent className="max-w-xs">
            <DialogHeader><DialogTitle>Top Up — {topupGoal?.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input type="number" placeholder="Amount" value={topupAmt} onChange={e => setTopupAmt(e.target.value)} />
              <Button className="w-full" disabled={topupMutation.isPending || !topupAmt}
                onClick={() => topupMutation.mutate({ id: topupGoal.id, amount: parseFloat(topupAmt) })}>
                {topupMutation.isPending ? "Processing..." : "Add Funds"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Goal name (e.g. New Car)" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Input type="number" placeholder="Target amount" value={form.targetAmount} onChange={e => setForm(p => ({ ...p, targetAmount: e.target.value }))} />
            <Input type="date" placeholder="Target date" value={form.targetDate} onChange={e => setForm(p => ({ ...p, targetDate: e.target.value }))} />
            <Button className="w-full" disabled={!form.name || !form.targetAmount || createMutation.isPending}
              onClick={() => createMutation.mutate({ ...form, targetAmount: parseFloat(form.targetAmount), autoSaveAmount: parseFloat(form.autoSaveAmount || "0") })}>
              {createMutation.isPending ? "Creating..." : "Create Goal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
