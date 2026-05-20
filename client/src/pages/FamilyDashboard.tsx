import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Users, Plus, Trash2, DollarSign, TrendingUp, Globe, Phone, Mail,
  Building2, Edit2, Wallet, AlertTriangle, Heart, ChevronRight, Loader2
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const RELATIONSHIPS = ["spouse", "parent", "child", "sibling", "grandparent", "grandchild", "uncle_aunt", "cousin", "other"];
const CURRENCIES = ["NGN", "KES", "GHS", "ZAR", "USD", "EUR", "GBP", "UGX", "TZS", "XOF"];

const REL_COLORS: Record<string, string> = {
  spouse: "bg-pink-100 text-pink-700",
  parent: "bg-amber-100 text-amber-700",
  child: "bg-blue-100 text-blue-700",
  sibling: "bg-purple-100 text-purple-700",
  grandparent: "bg-orange-100 text-orange-700",
  grandchild: "bg-cyan-100 text-cyan-700",
  uncle_aunt: "bg-lime-100 text-lime-700",
  cousin: "bg-teal-100 text-teal-700",
  other: "bg-gray-100 text-gray-700",
};

export default function FamilyDashboard() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [addOpen, setAddOpen] = useState(false);
  const [budgetDialog, setBudgetDialog] = useState<{ open: boolean; member: any | null }>({ open: false, member: null });
  const [editDialog, setEditDialog] = useState<{ open: boolean; member: any | null }>({ open: false, member: null });
  const [form, setForm] = useState({
    name: "", relationship: "other", country: "", phone: "", email: "",
    bankAccount: "", bankName: "", currency: "NGN", notes: ""
  });
  const [budgetForm, setBudgetForm] = useState({ monthlyLimit: "", currency: "USD", alertThreshold: "80" });

  const { data: dashboard, isLoading } = trpc.family.getDashboard.useQuery();
  const members = dashboard?.members ?? [];

  const addMember = trpc.family.addMember.useMutation({
    onSuccess: () => {
      toast.success("Family member added!");
      utils.family.getDashboard.invalidate();
      setAddOpen(false);
      setForm({ name: "", relationship: "other", country: "", phone: "", email: "", bankAccount: "", bankName: "", currency: "NGN", notes: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMember = trpc.family.deleteMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      utils.family.getDashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setBudget = trpc.family.setBudget.useMutation({
    onSuccess: () => {
      toast.success("Budget set successfully");
      utils.family.getDashboard.invalidate();
      setBudgetDialog({ open: false, member: null });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMember = trpc.family.updateMember.useMutation({
    onSuccess: () => {
      toast.success("Member updated");
      utils.family.getDashboard.invalidate();
      setEditDialog({ open: false, member: null });
    },
    onError: (e) => toast.error(e.message),
  });

  function openBudgetDialog(member: any) {
    setBudgetForm({
      monthlyLimit: member.budget?.monthlyLimit ?? "",
      currency: member.budget?.currency ?? "USD",
      alertThreshold: String(member.budget?.alertThreshold ?? 80),
    });
    setBudgetDialog({ open: true, member });
  }

  function openEditDialog(member: any) {
    setForm({
      name: member.name,
      relationship: member.relationship ?? "other",
      country: member.country ?? "",
      phone: member.phone ?? "",
      email: member.email ?? "",
      bankAccount: member.bankAccount ?? "",
      bankName: member.bankName ?? "",
      currency: member.currency ?? "NGN",
      notes: member.notes ?? "",
    });
    setEditDialog({ open: true, member });
  }

  const totalSentThisMonth = dashboard?.totalSentThisMonth ?? 0;
  const totalSentAllTime = dashboard?.totalSentAllTime ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Heart className="w-6 h-6 text-rose-500" />
              Family Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage your family network, set monthly budgets, and track spending for each member.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Family Member
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-rose-500" />
                <div>
                  <div className="text-2xl font-bold">{members.length}</div>
                  <div className="text-xs text-muted-foreground">Family Members</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-emerald-500" />
                <div>
                  <div className="text-2xl font-bold text-emerald-600">${totalSentThisMonth.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Sent This Month</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="text-2xl font-bold">${totalSentAllTime.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Total Sent (All Time)</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Family Members */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading family…
          </div>
        ) : members.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3 opacity-30" />
              <p className="font-medium text-muted-foreground">No family members yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                Add your family members to track remittances, set monthly budgets, and manage beneficiary details.
              </p>
              <Button className="mt-4" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add First Member
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {members.map((member: any) => {
              const budget = member.budget;
              const spent = parseFloat(String(budget?.currentMonthSpent ?? 0));
              const limit = parseFloat(String(budget?.monthlyLimit ?? 0));
              const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
              const isOverAlert = budget && pct >= (budget.alertThreshold ?? 80);

              return (
                <Card key={member.id} className="hover:shadow-sm transition-all">
                  <CardContent className="p-5 space-y-4">
                    {/* Member header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-sm font-bold text-primary">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">{member.name}</h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge variant="secondary" className={`text-xs ${REL_COLORS[member.relationship ?? "other"]}`}>
                              {member.relationship ?? "other"}
                            </Badge>
                            {member.country && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                <Globe className="w-3 h-3" /> {member.country}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditDialog(member)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteMember.mutate({ id: member.id })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Contact info */}
                    <div className="space-y-1">
                      {member.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {member.phone}
                        </p>
                      )}
                      {member.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="w-3 h-3" /> {member.email}
                        </p>
                      )}
                      {member.bankName && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Building2 className="w-3 h-3" /> {member.bankName} {member.bankAccount ? `· ${member.bankAccount}` : ""}
                        </p>
                      )}
                    </div>

                    {/* Budget */}
                    {budget ? (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Wallet className="w-3 h-3" /> Monthly Budget
                            {isOverAlert && <AlertTriangle className="w-3 h-3 text-amber-500 ml-1" />}
                          </span>
                          <span className={`font-medium ${isOverAlert ? "text-amber-600" : ""}`}>
                            {budget.currency} {spent.toLocaleString()} / {limit.toLocaleString()}
                          </span>
                        </div>
                        <Progress value={pct} className={`h-2 ${isOverAlert ? "[&>div]:bg-amber-500" : ""}`} />
                        <p className="text-xs text-muted-foreground">{pct.toFixed(0)}% of monthly limit used</p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No budget set</p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => openBudgetDialog(member)}>
                        <Wallet className="w-3 h-3 mr-1" />
                        {budget ? "Edit Budget" : "Set Budget"}
                      </Button>
                      <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => window.location.href = `/send?recipient=${encodeURIComponent(member.name)}`}>
                        <ChevronRight className="w-3 h-3 mr-1" /> Send Money
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Recent Transfers */}
        {(dashboard?.recentTransfers ?? []).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Family Transfers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(dashboard?.recentTransfers ?? []).slice(0, 8).map((txn: any) => (
                  <div key={txn.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{txn.description ?? "Transfer"}</p>
                      <p className="text-xs text-muted-foreground">{new Date(txn.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span className="text-sm font-semibold text-emerald-600">
                      {txn.fromCurrency} {parseFloat(String(txn.fromAmount)).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Family Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="space-y-1">
                <Label>Relationship</Label>
                <Select value={form.relationship} onValueChange={v => setForm(f => ({ ...f, relationship: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map(r => <SelectItem key={r} value={r}>{r.replace("_", "/")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Country</Label>
                <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Nigeria" />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+234..." />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Bank Name</Label>
                <Input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} placeholder="GTBank" />
              </div>
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="0123456789" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addMember.mutate({ name: form.name, relationship: form.relationship, country: form.country || undefined, phone: form.phone || undefined, email: form.email || undefined, bankAccount: form.bankAccount || undefined, bankName: form.bankName || undefined, currency: form.currency, notes: form.notes || undefined })}
              disabled={!form.name || addMember.isPending}
            >
              {addMember.isPending ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Member Dialog */}
      <Dialog open={editDialog.open} onOpenChange={(o) => !o && setEditDialog({ open: false, member: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Bank Name</Label>
                <Input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, member: null })}>Cancel</Button>
            <Button
              onClick={() => updateMember.mutate({ id: editDialog.member.id, name: form.name, phone: form.phone || undefined, email: form.email || undefined, bankAccount: form.bankAccount || undefined, bankName: form.bankName || undefined, notes: form.notes || undefined })}
              disabled={updateMember.isPending}
            >
              {updateMember.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget Dialog */}
      <Dialog open={budgetDialog.open} onOpenChange={(o) => !o && setBudgetDialog({ open: false, member: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Monthly Budget — {budgetDialog.member?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Monthly Limit</Label>
              <Input type="number" value={budgetForm.monthlyLimit} onChange={e => setBudgetForm(f => ({ ...f, monthlyLimit: e.target.value }))} placeholder="500" />
            </div>
            <div className="space-y-1">
              <Label>Currency</Label>
              <Select value={budgetForm.currency} onValueChange={v => setBudgetForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD", "EUR", "GBP", "NGN", "KES", "GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Alert Threshold (%)</Label>
              <Input type="number" min="10" max="100" value={budgetForm.alertThreshold} onChange={e => setBudgetForm(f => ({ ...f, alertThreshold: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Alert when spending reaches this % of the monthly limit</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBudgetDialog({ open: false, member: null })}>Cancel</Button>
            <Button
              onClick={() => setBudget.mutate({ familyMemberId: budgetDialog.member.id, monthlyLimit: parseFloat(budgetForm.monthlyLimit), currency: budgetForm.currency, alertThreshold: parseInt(budgetForm.alertThreshold) })}
              disabled={!budgetForm.monthlyLimit || setBudget.isPending}
            >
              {setBudget.isPending ? "Saving..." : "Set Budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
