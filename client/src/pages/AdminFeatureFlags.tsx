import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Search, Flag, Zap, Shield, Users, Globe, RefreshCw, Plus, Edit2, Trash2, ChevronDown, ChevronUp, Info } from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  core: <Zap className="h-4 w-4 text-yellow-500" />,
  payments: <Globe className="h-4 w-4 text-blue-500" />,
  savings: <Shield className="h-4 w-4 text-green-500" />,
  community: <Users className="h-4 w-4 text-purple-500" />,
  commerce: <Globe className="h-4 w-4 text-orange-500" />,
  credit: <Flag className="h-4 w-4 text-red-500" />,
  crypto: <Zap className="h-4 w-4 text-cyan-500" />,
  interop: <Globe className="h-4 w-4 text-teal-500" />,
  compliance: <Shield className="h-4 w-4 text-amber-500" />,
  ai: <Zap className="h-4 w-4 text-pink-500" />,
  insights: <Flag className="h-4 w-4 text-indigo-500" />,
  support: <Users className="h-4 w-4 text-slate-500" />,
  premium: <Shield className="h-4 w-4 text-violet-500" />,
  feature: <Flag className="h-4 w-4 text-gray-500" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  core: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  payments: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  savings: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  community: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  commerce: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  credit: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  crypto: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  interop: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  compliance: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  ai: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  insights: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  support: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  premium: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  feature: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

interface UpsertDialogProps {
  open: boolean;
  onClose: () => void;
  flag?: any;
}

function UpsertFlagDialog({ open, onClose, flag }: UpsertDialogProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    key: flag?.key ?? "",
    name: flag?.name ?? "",
    description: flag?.description ?? "",
    scope: flag?.scope ?? "global",
    defaultEnabled: flag?.defaultEnabled ?? true,
    rolloutPct: flag?.rolloutPct ?? 100,
    category: flag?.category ?? "feature",
  });

  const upsert = trpc.featureFlags.upsert.useMutation({
    onSuccess: () => {
      toast.success(flag ? "Flag updated" : "Flag created");
      utils.featureFlags.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{flag ? "Edit Feature Flag" : "Create Feature Flag"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Key (unique slug)</Label>
              <Input placeholder="e.g. my_feature" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))} disabled={!!flag} />
            </div>
            <div className="space-y-1">
              <Label>Display Name</Label>
              <Input placeholder="My Feature" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea placeholder="What does this flag control?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CATEGORY_ICONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Scope</Label>
              <Select value={form.scope} onValueChange={v => setForm(f => ({ ...f, scope: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Rollout Percentage: {form.rolloutPct}%</Label>
              <span className="text-xs text-muted-foreground">{form.rolloutPct === 100 ? "Fully enabled" : form.rolloutPct === 0 ? "Disabled" : "Partial rollout"}</span>
            </div>
            <Slider min={0} max={100} step={5} value={[form.rolloutPct]} onValueChange={([v]) => setForm(f => ({ ...f, rolloutPct: v }))} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.defaultEnabled} onCheckedChange={v => setForm(f => ({ ...f, defaultEnabled: v }))} />
            <Label>Enabled by default</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => upsert.mutate({ ...(flag ? { id: flag.id } : {}), ...form } as any)} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : flag ? "Update Flag" : "Create Flag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminFeatureFlags() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [expandedFlag, setExpandedFlag] = useState<number | null>(null);
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [editFlag, setEditFlag] = useState<any>(null);
  const utils = trpc.useUtils();

  const { data: flagsRaw, isLoading, refetch } = trpc.featureFlags.list.useQuery(
    { category: activeCategory !== "all" ? activeCategory : undefined, search: search || undefined },
    { refetchInterval: 30000 }
  );
  const flags: any[] = (flagsRaw as any[] | undefined) ?? [];
  const { data: categoriesRaw } = trpc.featureFlags.categories.useQuery();
  const categories: string[] = (categoriesRaw as string[] | undefined) ?? [];

  const toggle = trpc.featureFlags.toggle.useMutation({
    onMutate: async (vars: any) => {
      const { flagId, enabled } = vars as { flagId: number; enabled: boolean };
      await utils.featureFlags.list.cancel();
      const prev = utils.featureFlags.list.getData();
      utils.featureFlags.list.setData(undefined, (old: any) => old?.map((f: any) => f.id === flagId ? { ...f, defaultEnabled: enabled, effectiveEnabled: enabled } : f));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) utils.featureFlags.list.setData(undefined, ctx.prev); toast.error("Failed to toggle flag"); },
    onSuccess: () => toast.success("Flag updated"),
  });

  const deleteFlag = trpc.featureFlags.delete.useMutation({
    onSuccess: () => { toast.success("Flag deleted"); utils.featureFlags.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const enabledCount = flags.filter(f => f.effectiveEnabled).length;
  const disabledCount = flags.filter(f => !f.effectiveEnabled).length;
  const partialCount = flags.filter(f => f.rolloutPct > 0 && f.rolloutPct < 100).length;

  const grouped = flags.reduce((acc: Record<string, any[]>, f: any) => {
    const cat = f.category ?? "feature";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(f);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Flag className="h-6 w-6 text-primary" /> Feature Flags</h1>
          <p className="text-sm text-muted-foreground mt-1">Control which features are available globally, per tenant, or per user.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Button size="sm" onClick={() => { setEditFlag(null); setUpsertOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Flag</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Flags", value: flags.length, color: "text-foreground" },
          { label: "Enabled", value: enabledCount, color: "text-green-600" },
          { label: "Disabled", value: disabledCount, color: "text-red-600" },
          { label: "Partial Rollout", value: partialCount, color: "text-amber-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Category Filter */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search flags…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button variant={activeCategory === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveCategory("all")}>All</Button>
          {categories.map(cat => (
            <Button key={cat} variant={activeCategory === cat ? "default" : "outline"} size="sm" onClick={() => setActiveCategory(cat)}>
              {CATEGORY_ICONS[cat]} <span className="ml-1 capitalize">{cat}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Flags Table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : activeCategory === "all" ? (
        // Grouped view
        <div className="space-y-6">
          {(Object.entries(grouped) as [string, any[]][]).sort(([a], [b]) => a.localeCompare(b)).map(([cat, catFlags]: [string, any[]]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                {CATEGORY_ICONS[cat]}
                <h3 className="font-semibold capitalize">{cat}</h3>
                <Badge variant="secondary" className="text-xs">{catFlags.length}</Badge>
              </div>
              <div className="space-y-2">
                {catFlags.map(flag => <FlagRow key={flag.id} flag={flag} expanded={expandedFlag === flag.id} onExpand={() => setExpandedFlag(expandedFlag === flag.id ? null : flag.id)} onToggle={(enabled) => toggle.mutate({ flagId: flag.id, enabled })} onEdit={() => { setEditFlag(flag); setUpsertOpen(true); }} onDelete={() => { if (confirm(`Delete flag "${flag.name}"?`)) deleteFlag.mutate({ id: flag.id }); }} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Flat view for filtered category
        <div className="space-y-2">
          {flags.map(flag => <FlagRow key={flag.id} flag={flag} expanded={expandedFlag === flag.id} onExpand={() => setExpandedFlag(expandedFlag === flag.id ? null : flag.id)} onToggle={(enabled) => toggle.mutate({ flagId: flag.id, enabled })} onEdit={() => { setEditFlag(flag); setUpsertOpen(true); }} onDelete={() => { if (confirm(`Delete flag "${flag.name}"?`)) deleteFlag.mutate({ id: flag.id }); }} />)}
          {flags.length === 0 && <div className="text-center py-12 text-muted-foreground">No flags found</div>}
        </div>
      )}

      {/* Upsert Dialog */}
      {upsertOpen && <UpsertFlagDialog open={upsertOpen} onClose={() => { setUpsertOpen(false); setEditFlag(null); }} flag={editFlag} />}
    </div>
  );
}

function FlagRow({ flag, expanded, onExpand, onToggle, onEdit, onDelete }: {
  flag: any; expanded: boolean; onExpand: () => void;
  onToggle: (enabled: boolean) => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <DashboardLayout>
    <div className={`border rounded-lg transition-all ${expanded ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={onExpand}>
        <Switch checked={flag.effectiveEnabled} onCheckedChange={onToggle} onClick={e => e.stopPropagation()} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{flag.name}</span>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">{flag.key}</code>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[flag.category ?? "feature"]}`}>{flag.category}</span>
            {flag.rolloutPct < 100 && flag.rolloutPct > 0 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">{flag.rolloutPct}% rollout</Badge>
            )}
            {flag.tenantOverride !== null && (
              <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">tenant override</Badge>
            )}
          </div>
          {flag.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{flag.description}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); onEdit(); }}><Edit2 className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50 mt-1">
          <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
            <div><span className="text-muted-foreground">Scope:</span> <span className="font-medium capitalize">{flag.scope}</span></div>
            <div><span className="text-muted-foreground">Default:</span> <span className={`font-medium ${flag.defaultEnabled ? "text-green-600" : "text-red-600"}`}>{flag.defaultEnabled ? "Enabled" : "Disabled"}</span></div>
            <div><span className="text-muted-foreground">Rollout:</span> <span className="font-medium">{flag.rolloutPct}%</span></div>
            {flag.tenantOverride !== null && <div><span className="text-muted-foreground">Tenant override:</span> <span className={`font-medium ${flag.tenantOverride ? "text-green-600" : "text-red-600"}`}>{flag.tenantOverride ? "Enabled" : "Disabled"}</span></div>}
            {flag.userOverride !== null && <div><span className="text-muted-foreground">User override:</span> <span className={`font-medium ${flag.userOverride ? "text-green-600" : "text-red-600"}`}>{flag.userOverride ? "Enabled" : "Disabled"}</span></div>}
          </div>
          {flag.description && (
            <div className="mt-3 flex gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{flag.description}</p>
            </div>
          )}
        </div>
      )}
    </div>
  
    </DashboardLayout>
  );
}
