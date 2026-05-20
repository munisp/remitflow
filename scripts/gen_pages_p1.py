#!/usr/bin/env python3
"""Generate all remaining page files for RemitFlow - Part 1: Bills, Cards, KYC, Savings, Beneficiaries, FXAlerts"""
import os

D = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(D, exist_ok=True)

pages = {}

pages["Bills"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Zap, Wifi, Tv, Droplets, Phone, Building2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const ICONS: Record<string, any> = { electricity: Zap, internet: Wifi, cable: Tv, water: Droplets, phone: Phone, other: Building2 };

export default function Bills() {
  const { data: categories } = trpc.bills.categories.useQuery();
  const payMutation = trpc.bills.pay.useMutation({ onSuccess: () => toast.success("Bill payment successful!") });
  const [selected, setSelected] = useState<any>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">Pay Bills</h1><p className="text-muted-foreground text-sm">Pay utilities and services instantly</p></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(categories ?? []).map((cat: any) => {
            const Icon = ICONS[cat.id] ?? Building2;
            return (
              <button key={cat.id} onClick={() => setSelected(cat)}
                className={"p-4 rounded-xl border-2 text-left transition-all hover:shadow-md " + (selected?.id === cat.id ? "border-primary bg-primary/5" : "border-border")}>
                <Icon className="h-6 w-6 mb-2 text-primary" />
                <div className="font-medium text-sm">{cat.name}</div>
                <div className="text-xs text-muted-foreground">{cat.providers?.length ?? 0} providers</div>
              </button>
            );
          })}
        </div>
        {selected && (
          <Card>
            <CardHeader><CardTitle className="text-base">Pay {selected.name}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm">
                  {(selected.providers ?? []).map((p: string) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Account / Meter Number</label>
                <Input placeholder="Enter account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Amount (₦)</label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <Button className="w-full" disabled={!accountNumber || !amount || payMutation.isPending}
                onClick={() => payMutation.mutate({ category: selected.id, provider: selected.providers?.[0] ?? "", accountNumber, amount: parseFloat(amount), currency: "NGN" })}>
                {payMutation.isPending ? "Processing..." : `Pay ₦${parseFloat(amount || "0").toLocaleString()}`}
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Bill Payments</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[
              { id: 1, type: "Electricity", provider: "EKEDC", amount: 15000, date: "Mar 16", status: "success" },
              { id: 2, type: "Internet", provider: "Spectranet", amount: 8000, date: "Mar 10", status: "success" },
              { id: 3, type: "Cable TV", provider: "DSTV", amount: 4200, date: "Mar 5", status: "success" },
            ].map(b => (
              <div key={b.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <div><div className="text-sm font-medium">{b.type} — {b.provider}</div><div className="text-xs text-muted-foreground">{b.date}</div></div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">₦{b.amount.toLocaleString()}</span>
                  <Badge variant="secondary" className="text-xs text-emerald-600">{b.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

pages["Cards"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CreditCard, Plus, Snowflake, Eye, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

const BRAND_COLORS: Record<string, string> = {
  visa: "from-blue-600 to-blue-800",
  mastercard: "from-red-500 to-orange-600",
  verve: "from-emerald-600 to-teal-700",
};

export default function Cards() {
  const { data: cards, refetch } = trpc.cards.list.useQuery();
  const freezeMutation = trpc.cards.freeze.useMutation({ onSuccess: () => { toast.success("Card frozen"); refetch(); } });
  const unfreezeMutation = trpc.cards.unfreeze.useMutation({ onSuccess: () => { toast.success("Card unfrozen"); refetch(); } });
  const createMutation = trpc.cards.create.useMutation({ onSuccess: () => { toast.success("New virtual card created!"); refetch(); } });
  const [showNumbers, setShowNumbers] = useState<Record<number, boolean>>({});

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">My Cards</h1><p className="text-muted-foreground text-sm">Manage your virtual and physical cards</p></div>
          <Button size="sm" onClick={() => createMutation.mutate({ type: "virtual", currency: "USD" })}>
            <Plus className="h-4 w-4 mr-1" />New Card
          </Button>
        </div>
        <div className="space-y-4">
          {(cards ?? []).map((card: any) => (
            <div key={card.id} className="space-y-3">
              <div className={`relative rounded-2xl p-6 text-white bg-gradient-to-br ${BRAND_COLORS[card.brand] ?? "from-gray-700 to-gray-900"} shadow-lg`}>
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <div className="text-xs opacity-70 uppercase tracking-wider">{card.type} Card</div>
                    <div className="font-bold text-lg capitalize">{card.brand}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20"
                      onClick={() => setShowNumbers(p => ({ ...p, [card.id]: !p[card.id] }))}>
                      {showNumbers[card.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    {card.status === "active"
                      ? <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => freezeMutation.mutate({ id: card.id })}><Snowflake className="h-4 w-4" /></Button>
                      : <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => unfreezeMutation.mutate({ id: card.id })}><Snowflake className="h-4 w-4 text-blue-300" /></Button>
                    }
                  </div>
                </div>
                <div className="text-xl font-mono tracking-widest mb-4">
                  {showNumbers[card.id] ? `4242 4242 4242 ${card.last4}` : `•••• •••• •••• ${card.last4}`}
                </div>
                <div className="flex justify-between items-end">
                  <div><div className="text-xs opacity-70">Cardholder</div><div className="font-medium text-sm">{card.cardholderName}</div></div>
                  <div><div className="text-xs opacity-70">Expires</div><div className="font-medium text-sm">{card.expiryMonth}/{card.expiryYear}</div></div>
                  <Badge className={`${card.status === "active" ? "bg-emerald-500" : "bg-blue-500"} text-white border-0`}>{card.status}</Badge>
                </div>
              </div>
              <Card>
                <CardContent className="p-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Spend Limit</span>
                    <span className="font-medium">{card.currency} {card.spent?.toLocaleString()} / {card.spendLimit?.toLocaleString()}</span>
                  </div>
                  <Progress value={card.spendLimit > 0 ? (card.spent / card.spendLimit) * 100 : 0} className="h-2" />
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

pages["KYC"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Clock, AlertCircle, Upload, Shield, User, FileText, Camera } from "lucide-react";
import { toast } from "sonner";

const TIER_LIMITS: Record<number, { daily: string; monthly: string }> = {
  0: { daily: "₦50,000", monthly: "₦200,000" },
  1: { daily: "₦500,000", monthly: "₦2,000,000" },
  2: { daily: "₦5,000,000", monthly: "₦20,000,000" },
  3: { daily: "Unlimited", monthly: "Unlimited" },
};

export default function KYC() {
  const { data: kycStatus } = trpc.kyc.status.useQuery();
  const submitMutation = trpc.kyc.submit.useMutation({ onSuccess: () => toast.success("Document submitted for review!") });
  const [activeDoc, setActiveDoc] = useState<string | null>(null);

  const tier = kycStatus?.level ?? 0;
  const steps = [
    { id: "bvn", label: "BVN Verification", icon: User, done: tier >= 1 },
    { id: "id", label: "Government ID", icon: FileText, done: tier >= 2 },
    { id: "selfie", label: "Selfie / Liveness", icon: Camera, done: tier >= 2 },
    { id: "address", label: "Proof of Address", icon: Shield, done: tier >= 3 },
  ];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">KYC Verification</h1><p className="text-muted-foreground text-sm">Complete verification to unlock higher limits</p></div>

        {/* Current Tier */}
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm text-muted-foreground">Current Tier</div>
                <div className="text-3xl font-bold">Tier {tier}</div>
              </div>
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <Progress value={(tier / 3) * 100} className="h-3 mb-3" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-muted-foreground">Daily Limit</div><div className="font-semibold">{TIER_LIMITS[tier]?.daily}</div></div>
              <div><div className="text-muted-foreground">Monthly Limit</div><div className="font-semibold">{TIER_LIMITS[tier]?.monthly}</div></div>
            </div>
          </CardContent>
        </Card>

        {/* Verification Steps */}
        <div className="space-y-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <Card key={step.id} className={step.done ? "border-emerald-200 bg-emerald-50/50" : ""}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.done ? "bg-emerald-100" : "bg-muted"}`}>
                    {step.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Icon className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{step.label}</div>
                    <div className="text-xs text-muted-foreground">Step {i + 1} of {steps.length}</div>
                  </div>
                  {step.done
                    ? <Badge className="bg-emerald-100 text-emerald-700 border-0">Verified</Badge>
                    : <Button size="sm" variant="outline" onClick={() => { setActiveDoc(step.id); submitMutation.mutate({ docType: step.id, fileUrl: "https://example.com/doc.pdf" }); }}>
                        <Upload className="h-4 w-4 mr-1" />Upload
                      </Button>
                  }
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Documents */}
        <Card>
          <CardHeader><CardTitle className="text-base">Submitted Documents</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(kycStatus?.documents ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div><div className="text-sm font-medium">{doc.type}</div><div className="text-xs text-muted-foreground">{doc.submittedAt}</div></div>
                </div>
                <Badge variant={doc.status === "approved" ? "default" : doc.status === "pending" ? "secondary" : "destructive"} className="text-xs capitalize">{doc.status}</Badge>
              </div>
            ))}
            {(!kycStatus?.documents || kycStatus.documents.length === 0) && (
              <div className="text-center py-4 text-muted-foreground text-sm">No documents submitted yet</div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

pages["Savings"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PiggyBank, Plus, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function Savings() {
  const { data: goals, refetch } = trpc.savings.list.useQuery();
  const createMutation = trpc.savings.create.useMutation({ onSuccess: () => { toast.success("Savings goal created!"); refetch(); setOpen(false); } });
  const topupMutation = trpc.savings.topup.useMutation({ onSuccess: () => { toast.success("Added to savings!"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", targetAmount: "", currency: "NGN", targetDate: "", autoSave: false, autoSaveAmount: "" });

  const totalSaved = (goals ?? []).reduce((s: number, g: any) => s + (g.currency === "NGN" ? g.currentAmount : g.currentAmount * 1538), 0);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Savings Goals</h1><p className="text-muted-foreground text-sm">Save towards your dreams</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Goal</Button>
        </div>

        <Card className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-0">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1"><PiggyBank className="h-5 w-5 opacity-80" /><span className="text-sm opacity-80">Total Saved (NGN equiv.)</span></div>
            <div className="text-3xl font-bold">₦{totalSaved.toLocaleString()}</div>
            <div className="text-sm opacity-70 mt-1">{(goals ?? []).length} active goals</div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {(goals ?? []).map((goal: any) => {
            const pct = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
            return (
              <Card key={goal.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{goal.emoji ?? "🎯"}</span>
                      <div>
                        <div className="font-semibold">{goal.name}</div>
                        <div className="text-xs text-muted-foreground">Target: {goal.targetDate ?? "No deadline"}</div>
                      </div>
                    </div>
                    <Badge variant={goal.status === "completed" ? "default" : "secondary"} className="text-xs capitalize">{goal.status}</Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{goal.currency} {goal.currentAmount.toLocaleString()} / {goal.targetAmount.toLocaleString()}</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <div className="text-xs text-muted-foreground text-right">{pct.toFixed(1)}% complete</div>
                  </div>
                  {goal.status !== "completed" && (
                    <Button size="sm" variant="outline" className="mt-3 w-full"
                      onClick={() => topupMutation.mutate({ id: goal.id, amount: 10000 })}>
                      <TrendingUp className="h-4 w-4 mr-1" />Add Funds
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Savings Goal</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Goal name (e.g. Emergency Fund)" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Input type="number" placeholder="Target amount" value={form.targetAmount} onChange={e => setForm(p => ({ ...p, targetAmount: e.target.value }))} />
            <Input type="date" value={form.targetDate} onChange={e => setForm(p => ({ ...p, targetDate: e.target.value }))} />
            <Button className="w-full" disabled={!form.name || !form.targetAmount || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: form.name, targetAmount: parseFloat(form.targetAmount), currency: form.currency, targetDate: form.targetDate, autoSave: false, autoSaveAmount: 0 })}>
              {createMutation.isPending ? "Creating..." : "Create Goal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

pages["Beneficiaries"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Plus, Star, Trash2, Send, Search } from "lucide-react";
import { toast } from "sonner";

export default function Beneficiaries() {
  const { data: beneficiaries, refetch } = trpc.beneficiaries.list.useQuery();
  const addMutation = trpc.beneficiaries.add.useMutation({ onSuccess: () => { toast.success("Beneficiary added!"); refetch(); setOpen(false); } });
  const removeMutation = trpc.beneficiaries.remove.useMutation({ onSuccess: () => { toast.success("Removed"); refetch(); } });
  const favMutation = trpc.beneficiaries.toggleFavorite.useMutation({ onSuccess: () => refetch() });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", accountNumber: "", bankName: "", bankCode: "", currency: "NGN", country: "Nigeria" });

  const filtered = (beneficiaries ?? []).filter((b: any) =>
    b.name.toLowerCase().includes(search.toLowerCase()) || b.accountNumber.includes(search)
  );

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Beneficiaries</h1><p className="text-muted-foreground text-sm">Saved recipients for quick transfers</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search beneficiaries..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="space-y-2">
          {filtered.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">{b.name[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.bankName} · {b.accountNumber}</div>
                  <div className="text-xs text-muted-foreground">{b.country} · {b.currency}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => favMutation.mutate({ id: b.id })}>
                    <Star className={"h-4 w-4 " + (b.isFavorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground")} />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-primary"><Send className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeMutation.mutate({ id: b.id })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && <div className="text-center py-8 text-muted-foreground">No beneficiaries found</div>}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Beneficiary</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Input placeholder="Account number" value={form.accountNumber} onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))} />
            <Input placeholder="Bank name" value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
            <Button className="w-full" disabled={!form.name || !form.accountNumber || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}>
              {addMutation.isPending ? "Saving..." : "Add Beneficiary"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

pages["FXAlerts"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

export default function FXAlerts() {
  const { data: alerts, refetch } = trpc.fx.alerts.useQuery();
  const createMutation = trpc.fx.createAlert.useMutation({ onSuccess: () => { toast.success("Alert created!"); refetch(); setOpen(false); } });
  const deleteMutation = trpc.fx.deleteAlert.useMutation({ onSuccess: () => { toast.success("Alert deleted"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fromCurrency: "USD", toCurrency: "NGN", targetRate: "", direction: "above" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">FX Rate Alerts</h1><p className="text-muted-foreground text-sm">Get notified when rates hit your target</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Alert</Button>
        </div>
        <div className="space-y-3">
          {(alerts ?? []).map((alert: any) => (
            <Card key={alert.id} className={alert.triggered ? "border-emerald-300 bg-emerald-50/50" : ""}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${alert.direction === "above" ? "bg-emerald-100" : "bg-red-50"}`}>
                  {alert.direction === "above" ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{alert.fromCurrency}/{alert.toCurrency}</div>
                  <div className="text-sm text-muted-foreground">
                    Alert when rate goes {alert.direction} {alert.targetRate.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Current: {alert.currentRate.toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  {alert.triggered && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Triggered!</Badge>}
                  <Badge variant={alert.isActive ? "default" : "secondary"} className="text-xs">{alert.isActive ? "Active" : "Paused"}</Badge>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate({ id: alert.id })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!alerts || alerts.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No alerts set. Create one to get notified when rates move.</p>
            </div>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Rate Alert</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">From</label>
                <Select value={form.fromCurrency} onValueChange={v => setForm(p => ({ ...p, fromCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["USD","GBP","EUR","CAD","AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">To</label>
                <Select value={form.toCurrency} onValueChange={v => setForm(p => ({ ...p, toCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["NGN","KES","GHS","ZAR","TZS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Target Rate</label>
              <Input type="number" placeholder="e.g. 1600" value={form.targetRate} onChange={e => setForm(p => ({ ...p, targetRate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Alert Direction</label>
              <Select value={form.direction} onValueChange={v => setForm(p => ({ ...p, direction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="above">Rate goes above target</SelectItem><SelectItem value="below">Rate goes below target</SelectItem></SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={!form.targetRate || createMutation.isPending}
              onClick={() => createMutation.mutate({ fromCurrency: form.fromCurrency, toCurrency: form.toCurrency, targetRate: parseFloat(form.targetRate), direction: form.direction })}>
              {createMutation.isPending ? "Creating..." : "Create Alert"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

for name, content in pages.items():
    path = os.path.join(D, f"{name}.tsx")
    with open(path, "w") as f:
        f.write(content)
    print(f"Written: {name}.tsx")

print(f"\nDone! Written {len(pages)} pages.")
