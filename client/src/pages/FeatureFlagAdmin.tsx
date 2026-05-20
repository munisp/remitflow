import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Flag, Plus, Trash2, Edit } from "lucide-react";

interface FlagForm {
  id?: number;
  key: string;
  name: string;
  description: string;
  scope: "global" | "tenant" | "user";
  defaultEnabled: boolean;
  rolloutPct: number;
  category: string;
  tags: string[];
}

const defaultForm: FlagForm = {
  key: "", name: "", description: "", scope: "global",
  defaultEnabled: true, rolloutPct: 100, category: "feature", tags: [],
};

export default function FeatureFlagAdmin() {
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<FlagForm>(defaultForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.featureFlags.list.useQuery(
    search ? { search } : undefined
  );
  const flags = Array.isArray(data) ? data : [];

  const upsertMutation = trpc.featureFlags.upsert.useMutation({
    onSuccess: () => { toast.success("Feature flag saved"); setShowDialog(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = trpc.featureFlags.toggle.useMutation({
    onSuccess: () => { toast.success("Flag toggled"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.featureFlags.delete.useMutation({
    onSuccess: () => { toast.success("Flag deleted"); setDeleteId(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setForm(defaultForm); setShowDialog(true); };
  const openEdit = (flag: typeof flags[0]) => {
    setForm({
      id: flag.id,
      key: flag.key ?? "",
      name: flag.name ?? "",
      description: (flag as any).description ?? "",
      scope: ((flag as any).scope as "global" | "tenant" | "user") ?? "global",
      defaultEnabled: flag.defaultEnabled ?? true,
      rolloutPct: flag.rolloutPct ?? 100,
      category: (flag as any).category ?? "feature",
      tags: (flag as any).tags ?? [],
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!form.key || !form.name) { toast.error("Key and name are required"); return; }
    upsertMutation.mutate(form);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flag className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">Feature Flags</h1>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4 mr-1" /> New Flag
          </Button>
        </div>

        <div className="flex gap-3">
          <Input
            placeholder="Search flags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading flags...</div>
        ) : flags.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No feature flags found.</div>
        ) : (
          <div className="grid gap-3">
            {flags.map((flag) => (
              <Card key={flag.id} className="border border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Switch
                        checked={flag.defaultEnabled ?? false}
                        onCheckedChange={(enabled) =>
                          toggleMutation.mutate({ flagId: flag.id, enabled, rolloutPct: flag.rolloutPct ?? 100 })
                        }
                        disabled={toggleMutation.isPending}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{flag.name}</span>
                          <Badge variant="outline" className="text-xs">{flag.key}</Badge>
                          {(flag as any).category && (
                            <Badge variant="secondary" className="text-xs">{(flag as any).category}</Badge>
                          )}
                        </div>
                        {(flag as any).description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{(flag as any).description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-xs text-muted-foreground">{flag.rolloutPct ?? 100}%</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(flag)}>
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                        onClick={() => setDeleteId(flag.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Upsert Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit Feature Flag" : "New Feature Flag"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Key *</Label>
                <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="e.g. enable_new_dashboard" disabled={!!form.id} />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Human-readable name" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What does this flag control?" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Scope</Label>
                  <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Global</SelectItem>
                      <SelectItem value="tenant">Tenant</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rollout % (0–100)</Label>
                  <Input type="number" min={0} max={100} value={form.rolloutPct}
                    onChange={(e) => setForm({ ...form, rolloutPct: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.defaultEnabled}
                  onCheckedChange={(v) => setForm({ ...form, defaultEnabled: v })} />
                <Label>Enabled by default</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
                {form.id ? "Save Changes" : "Create Flag"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Delete Feature Flag</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the flag. This action cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" disabled={deleteMutation.isPending}
                onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
