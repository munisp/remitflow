import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings, Plus, Trash2, Eye, EyeOff, Search, Edit2 } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function SystemConfigPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [editForm, setEditForm] = useState({ key: "", value: "", description: "", isSecret: false });
  const [isEditing, setIsEditing] = useState(false);

  const { data: configs, isLoading } = trpc.systemConfig.list.useQuery();

  const setMutation = trpc.systemConfig.set.useMutation({
    onSuccess: () => {
      toast.success(isEditing ? "Config updated" : "Config created");
      utils.systemConfig.list.invalidate();
      setEditOpen(false);
      setEditForm({ key: "", value: "", description: "", isSecret: false });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.systemConfig.delete.useMutation({
    onSuccess: () => { toast.success("Config deleted"); utils.systemConfig.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">Admin access required.</div>
      </DashboardLayout>
    );
  }

  const filtered = (configs ?? []).filter((c: any) =>
    c.key.includes(search.toLowerCase()) || c.description?.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setIsEditing(false);
    setEditForm({ key: "", value: "", description: "", isSecret: false });
    setEditOpen(true);
  };

  const openEdit = (config: any) => {
    setIsEditing(true);
    setEditForm({ key: config.key, value: config.value, description: config.description ?? "", isSecret: config.isSecret });
    setEditOpen(true);
  };

  const handleSave = () => {
    if (!editForm.key.trim() || !editForm.value.trim()) { toast.error("Key and value are required"); return; }
    setMutation.mutate(editForm);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Configuration</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage runtime configuration key-value pairs</p>
          </div>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <Button className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> New Config</Button>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{isEditing ? "Edit Config" : "New Config"}</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Key * (lowercase, underscores only)</Label>
                  <Input value={editForm.key} onChange={e => setEditForm(f => ({ ...f, key: e.target.value }))}
                    placeholder="e.g., max_transfer_limit" disabled={isEditing} />
                </div>
                <div>
                  <Label>Value *</Label>
                  <Textarea value={editForm.value} onChange={e => setEditForm(f => ({ ...f, value: e.target.value }))}
                    placeholder="Config value..." rows={3} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What does this config do?" />
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={editForm.isSecret} onCheckedChange={v => setEditForm(f => ({ ...f, isSecret: v }))} />
                  <Label>Mark as secret (value will be masked in UI)</Label>
                </div>
                <Button onClick={handleSave} disabled={setMutation.isPending} className="w-full">
                  {setMutation.isPending ? "Saving..." : isEditing ? "Update Config" : "Create Config"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search configs..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Config Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configuration ({filtered.length} entries)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{search ? "No configs match your search" : "No configs yet"}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left p-3">Key</th>
                      <th className="text-left p-3">Value</th>
                      <th className="text-left p-3">Description</th>
                      <th className="text-left p-3">Updated</th>
                      <th className="text-right p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((config: any) => (
                      <tr key={config.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono text-primary">{config.key}</code>
                            {config.isSecret && <span className="text-xs bg-orange-500/20 text-orange-400 rounded px-1">secret</span>}
                          </div>
                        </td>
                        <td className="p-3 max-w-xs">
                          {config.isSecret ? (
                            <div className="flex items-center gap-2">
                              <code className="text-xs font-mono text-muted-foreground">
                                {showSecrets[config.key] ? config.value : "•".repeat(Math.min(config.value.length, 20))}
                              </code>
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                                onClick={() => setShowSecrets(s => ({ ...s, [config.key]: !s[config.key] }))}>
                                {showSecrets[config.key] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </Button>
                            </div>
                          ) : (
                            <code className="text-xs font-mono text-muted-foreground truncate block max-w-48">{config.value}</code>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground max-w-xs truncate">{config.description ?? "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{new Date(config.updatedAt).toLocaleDateString()}</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(config)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                              onClick={() => { if (confirm(`Delete config "${config.key}"?`)) deleteMutation.mutate({ key: config.key }); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Default Config Suggestions */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-muted-foreground">Suggested Configuration Keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
              {[
                ["max_transfer_limit_usd", "Maximum single transfer amount in USD"],
                ["min_transfer_limit_usd", "Minimum single transfer amount in USD"],
                ["kyc_required_above_usd", "KYC required for transfers above this amount"],
                ["fee_percentage", "Default fee percentage (e.g., 0.015 for 1.5%)"],
                ["maintenance_mode", "Set to 'true' to enable maintenance mode"],
                ["allowed_corridors", "JSON array of enabled currency corridors"],
                ["fraud_score_threshold", "Risk score above which transactions are blocked"],
                ["referral_reward_ngn", "Referral reward amount in NGN"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-start gap-2 p-2 rounded hover:bg-muted/30">
                  <code className="text-primary">{key}</code>
                  <span>— {desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
