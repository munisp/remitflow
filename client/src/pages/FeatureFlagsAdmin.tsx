import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { useTranslation } from 'react-i18next';

interface FlagForm {
  id?: number;
  key: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  rolloutPct: number;
  category: string;
  tags: string;
}

const emptyForm = (): FlagForm => ({
  key: "", name: "", description: "", defaultEnabled: true, rolloutPct: 100, category: "feature", tags: "",
});

export default function FeatureFlagsAdmin() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FlagForm>(emptyForm());

  const { data, isLoading, refetch } = trpc.featureFlags.list.useQuery({ search: search || undefined });
  const flags: any[] = (data as any)?.flags ?? (Array.isArray(data) ? data : []);

  const upsertMutation = trpc.featureFlags.upsert.useMutation({
    onSuccess: () => { toast.success(form.id ? "Flag updated" : "Flag created"); refetch(); setOpen(false); setForm(emptyForm()); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.featureFlags.delete.useMutation({
    onSuccess: () => { toast.success("Flag deleted"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMutation = trpc.featureFlags.toggle.useMutation({
    onSuccess: () => { toast.success("Flag toggled"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setForm(emptyForm()); setOpen(true); };
  const openEdit = (flag: any) => {
    setForm({
      id: Number(flag.id),
      key: flag.key ?? flag.flag_key ?? "",
      name: flag.name ?? flag.key ?? "",
      description: flag.description ?? "",
      defaultEnabled: flag.defaultEnabled ?? flag.default_enabled ?? true,
      rolloutPct: flag.rolloutPct ?? flag.rollout_pct ?? 100,
      category: flag.category ?? "feature",
      tags: Array.isArray(flag.tags) ? flag.tags.join(", ") : (flag.tags ?? ""),
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.key) return toast.error("Flag key is required");
    if (!form.name) return toast.error("Flag name is required");
    upsertMutation.mutate({
      id: form.id,
      key: form.key,
      name: form.name,
      description: form.description || undefined,
      defaultEnabled: form.defaultEnabled,
      rolloutPct: form.rolloutPct,
      category: form.category,
      tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Feature Flags</h1>
            <p className="text-purple-300 text-sm mt-1">Manage platform feature toggles and rollout percentages</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-purple-800 text-purple-300">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button onClick={openCreate} className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-2" /> New Flag
            </Button>
          </div>
        </div>

        <Input
          placeholder="Search flags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs bg-purple-900/20 border-purple-800 text-white"
        />

        {isLoading ? (
          <div className="text-purple-300">Loading flags...</div>
        ) : (
          <div className="grid gap-3">
            {flags.map((flag: any) => (
              <Card key={flag.id} className="bg-purple-900/20 border-purple-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-purple-200">{flag.key ?? flag.flag_key}</span>
                        <span className="text-white font-medium">{flag.name}</span>
                        {flag.category && (
                          <Badge variant="outline" className="text-xs border-purple-700 text-purple-300">{flag.category}</Badge>
                        )}
                        {(flag.rolloutPct ?? flag.rollout_pct ?? 100) < 100 && (
                          <Badge className="text-xs bg-yellow-900/40 text-yellow-300 border-yellow-700">
                            {flag.rolloutPct ?? flag.rollout_pct}% rollout
                          </Badge>
                        )}
                      </div>
                      {flag.description && <p className="text-purple-400 text-sm mt-1">{flag.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Switch
                        checked={flag.effectiveEnabled ?? flag.defaultEnabled ?? flag.default_enabled ?? false}
                        onCheckedChange={(enabled) =>
                          toggleMutation.mutate({ flagId: Number(flag.id), enabled })
                        }
                      />
                      <Button size="sm" variant="ghost" onClick={() => openEdit(flag)} className="text-purple-300 hover:text-white">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { if (confirm("Delete this flag?")) deleteMutation.mutate({ id: Number(flag.id) }); }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {flags.length === 0 && (
              <div className="text-center py-12 text-purple-400">
                No feature flags found. Create one to get started.
              </div>
            )}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit Feature Flag" : "Create Feature Flag"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-purple-300">Flag Key *</Label>
                  <Input
                    value={form.key}
                    onChange={(e) => setForm({ ...form, key: e.target.value })}
                    placeholder="my-feature-flag"
                    className="bg-purple-900/20 border-purple-800"
                    disabled={!!form.id}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-300">Display Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="My Feature Flag"
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-purple-300">Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What does this flag control?"
                  className="bg-purple-900/20 border-purple-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-purple-300">Category</Label>
                  <Input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="feature"
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-300">Rollout % (0–100)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.rolloutPct}
                    onChange={(e) => setForm({ ...form, rolloutPct: Number(e.target.value) })}
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-purple-300">Tags (comma-separated)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="billing, beta, experimental"
                  className="bg-purple-900/20 border-purple-800"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.defaultEnabled}
                  onCheckedChange={(v) => setForm({ ...form, defaultEnabled: v })}
                />
                <Label className="text-purple-300">Enabled by default</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} className="border-purple-800 text-purple-300">Cancel</Button>
              <Button onClick={handleSubmit} disabled={upsertMutation.isPending} className="bg-purple-600 hover:bg-purple-700">
                {upsertMutation.isPending ? "Saving..." : (form.id ? "Update Flag" : "Create Flag")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
