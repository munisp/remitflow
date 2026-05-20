import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Edit, Trash2, DollarSign } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

interface FeeRuleForm {
  corridor: string; minAmount: string; maxAmount: string;
  feeType: "percentage" | "fixed" | "hybrid";
  feePercentage: string; feeFixed: string; minFee: string; maxFee: string; isActive: boolean;
}

const defaultForm: FeeRuleForm = {
  corridor: "", minAmount: "0", maxAmount: "", feeType: "percentage",
  feePercentage: "1.5", feeFixed: "0", minFee: "0", maxFee: "", isActive: true,
};

export default function FeeRulesCRUDPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<any | null>(null);
  const [form, setForm] = useState<FeeRuleForm>(defaultForm);
  const [filterActive, setFilterActive] = useState<boolean | undefined>(undefined);

  const rulesQuery = trpc.v89.fraudRulesCrud.getAll.useQuery({ limit: 100, offset: 0, isActive: filterActive });

  const createMutation = trpc.v89.fraudRulesCrud.create.useMutation({
    onSuccess: () => { toast.success("Fee rule created"); setShowCreate(false); setForm(defaultForm); rulesQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.v89.fraudRulesCrud.update.useMutation({
    onSuccess: () => { toast.success("Fee rule updated"); setEditRule(null); rulesQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.v89.fraudRulesCrud.delete.useMutation({
    onSuccess: () => { toast.success("Fee rule deleted"); rulesQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rules = rulesQuery.data?.rules ?? [];
  const total = rulesQuery.data?.total ?? 0;

  const handleCreate = () => {
    createMutation.mutate({
      corridor: form.corridor,
      minAmount: parseFloat(form.minAmount) || 0,
      maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : undefined,
      feeType: form.feeType,
      feePercentage: parseFloat(form.feePercentage) || 0,
      feeFixed: parseFloat(form.feeFixed) || 0,
      minFee: parseFloat(form.minFee) || 0,
      maxFee: form.maxFee ? parseFloat(form.maxFee) : undefined,
      isActive: form.isActive,
    });
  };

  const handleUpdate = () => {
    if (!editRule) return;
    updateMutation.mutate({
      id: editRule.id,
      feePercentage: parseFloat(form.feePercentage) || undefined,
      feeFixed: parseFloat(form.feeFixed) || undefined,
      isActive: form.isActive,
    });
  };

  const openEdit = (r: any) => {
    setEditRule(r);
    setForm({ ...defaultForm, corridor: r.corridor, feePercentage: String(r.feePercentage), feeFixed: String(r.feeFixed), isActive: r.isActive });
  };

  const FeeRuleForm = () => (
    <div className="space-y-4">
      {!editRule && (
        <div className="space-y-1">
          <Label>Corridor (e.g. USD-NGN)</Label>
          <Input value={form.corridor} onChange={(e) => setForm((f) => ({ ...f, corridor: e.target.value.toUpperCase() }))} placeholder="USD-NGN" />
        </div>
      )}
      <div className="space-y-1">
        <Label>Fee Type</Label>
        <Select value={form.feeType} onValueChange={(v) => setForm((f) => ({ ...f, feeType: v as any }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="percentage">Percentage</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="hybrid">Hybrid</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(form.feeType === "percentage" || form.feeType === "hybrid") && (
        <div className="space-y-1">
          <Label>Fee Percentage (%)</Label>
          <Input type="number" step="0.01" value={form.feePercentage} onChange={(e) => setForm((f) => ({ ...f, feePercentage: e.target.value }))} />
        </div>
      )}
      {(form.feeType === "fixed" || form.feeType === "hybrid") && (
        <div className="space-y-1">
          <Label>Fixed Fee ($)</Label>
          <Input type="number" step="0.01" value={form.feeFixed} onChange={(e) => setForm((f) => ({ ...f, feeFixed: e.target.value }))} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
        <Label>Active</Label>
      </div>
    </div>
  );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fee Rules CRUD</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage corridor-based fee rules for transactions</p>
        </div>
        <Button onClick={() => { setForm(defaultForm); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" /> New Rule
        </Button>
      </div>

      <div className="flex gap-2">
        {[{ label: "All", value: undefined }, { label: "Active", value: true }, { label: "Inactive", value: false }].map(({ label, value }) => (
          <button key={label} onClick={() => setFilterActive(value)}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterActive === value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-400" /> Fee Rules ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">Corridor</th>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">Fee %</th>
                  <th className="p-3 text-left">Fixed Fee</th>
                  <th className="p-3 text-left">Min Fee</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rulesQuery.isPending ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rules.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No fee rules found</td></tr>
                ) : rules.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono font-bold">{r.corridor}</td>
                    <td className="p-3 capitalize">{r.feeType}</td>
                    <td className="p-3">{r.feePercentage}%</td>
                    <td className="p-3">${r.feeFixed}</td>
                    <td className="p-3">${r.minFee}</td>
                    <td className="p-3">
                      <Badge className={r.isActive ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}>
                        {r.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(r)}>
                          <Edit className="w-3 h-3 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-500/30"
                          onClick={() => { if (confirm("Delete this rule?")) deleteMutation.mutate({ id: r.id }); }}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Fee Rule</DialogTitle></DialogHeader>
          <FeeRuleForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || !form.corridor}>
              {createMutation.isPending ? "Creating..." : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRule} onOpenChange={(open) => !open && setEditRule(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Rule: {editRule?.corridor}</DialogTitle></DialogHeader>
          <FeeRuleForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRule(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
