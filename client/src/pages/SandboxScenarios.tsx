import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Play, Plus, Pencil, Trash2, FlaskConical, Globe, Lock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const SCENARIO_TYPES = ["transfer", "fx", "kyc", "webhook", "payment", "compliance"] as const;
type ScenarioType = typeof SCENARIO_TYPES[number];

const TYPE_COLORS: Record<ScenarioType, string> = {
  transfer: "bg-blue-100 text-blue-800",
  fx: "bg-green-100 text-green-800",
  kyc: "bg-purple-100 text-purple-800",
  webhook: "bg-orange-100 text-orange-800",
  payment: "bg-pink-100 text-pink-800",
  compliance: "bg-red-100 text-red-800",
};

const DEFAULT_PAYLOADS: Record<ScenarioType, object> = {
  transfer: { amount: 500, currency: "USD", targetCurrency: "NGN", recipientName: "Test User", recipientAccount: "0123456789", recipientBank: "GTBank" },
  fx: { fromCurrency: "USD", toCurrency: "NGN", amount: 1000 },
  kyc: { name: "John Doe", documentType: "passport", documentNumber: "A12345678" },
  webhook: { event: "payment.completed", payload: { txId: "TX_TEST_001", amount: 500 } },
  payment: { amount: 2500, currency: "NGN", description: "Test payment" },
  compliance: { userId: 1, transactionAmount: 15000, currency: "USD", country: "NG" },
};

export default function SandboxScenarios() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [filterType, setFilterType] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editScenario, setEditScenario] = useState<any>(null);
  const [runResult, setRunResult] = useState<{ scenarioName: string; result: any } | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    scenarioType: "transfer" as ScenarioType,
    payload: JSON.stringify(DEFAULT_PAYLOADS.transfer, null, 2),
    tags: "",
    isPublic: false,
  });

  const { data: scenarios, isLoading } = trpc.sandboxScenarios.list.useQuery(
    filterType !== "all" ? { type: filterType } : undefined
  );

  const createMut = trpc.sandboxScenarios.create.useMutation({
    onSuccess: () => { utils.sandboxScenarios.list.invalidate(); setCreateOpen(false); toast.success("Scenario created"); resetForm(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.sandboxScenarios.update.useMutation({
    onSuccess: () => { utils.sandboxScenarios.list.invalidate(); setEditScenario(null); toast.success("Scenario updated"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.sandboxScenarios.delete.useMutation({
    onSuccess: () => { utils.sandboxScenarios.list.invalidate(); toast.success("Scenario deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const runMut = trpc.sandboxScenarios.run.useMutation({
    onSuccess: (data) => { setRunResult(data); utils.sandboxScenarios.list.invalidate(); toast.success(`Scenario "${data.scenarioName}" executed`); },
    onError: (e) => toast.error(e.message),
  });

  function resetForm() {
    setForm({ name: "", description: "", scenarioType: "transfer", payload: JSON.stringify(DEFAULT_PAYLOADS.transfer, null, 2), tags: "", isPublic: false });
  }

  function handleTypeChange(type: ScenarioType) {
    setForm(f => ({ ...f, scenarioType: type, payload: JSON.stringify(DEFAULT_PAYLOADS[type], null, 2) }));
  }

  function handleCreate() {
    let payload: any;
    try { payload = JSON.parse(form.payload); } catch { toast.error("Invalid JSON payload"); return; }
    createMut.mutate({ name: form.name, description: form.description || undefined, scenarioType: form.scenarioType, payload, tags: form.tags ? form.tags.split(",").map(t => t.trim()) : undefined, isPublic: form.isPublic });
  }

  function handleUpdate() {
    if (!editScenario) return;
    let payload: any;
    try { payload = JSON.parse(form.payload); } catch { toast.error("Invalid JSON payload"); return; }
    updateMut.mutate({ id: editScenario.id, name: form.name, description: form.description || undefined, payload, tags: form.tags ? form.tags.split(",").map(t => t.trim()) : undefined, isPublic: form.isPublic });
  }

  function openEdit(s: any) {
    setEditScenario(s);
    setForm({ name: s.name, description: s.description ?? "", scenarioType: s.scenarioType, payload: s.payload, tags: s.tags ?? "", isPublic: s.isPublic });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="w-6 h-6 text-purple-500" /> Sandbox Scenarios</h1>
          <p className="text-muted-foreground text-sm mt-1">Save, load, and run reusable testing scenarios for the developer sandbox</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" /> New Scenario</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Scenario</DialogTitle></DialogHeader>
            <ScenarioForm form={form} setForm={setForm} onTypeChange={handleTypeChange} onSubmit={handleCreate} loading={createMut.isPending} submitLabel="Create" />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <Button variant={filterType === "all" ? "default" : "outline"} size="sm" onClick={() => setFilterType("all")}>All</Button>
        {SCENARIO_TYPES.map(t => (
          <Button key={t} variant={filterType === t ? "default" : "outline"} size="sm" onClick={() => setFilterType(t)} className="capitalize">{t}</Button>
        ))}
      </div>

      {/* Scenarios Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : !scenarios?.length ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No scenarios yet. Create your first testing scenario.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {scenarios.map((s: any) => (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold line-clamp-1">{s.name}</CardTitle>
                  <div className="flex gap-1 shrink-0">
                    {s.isPublic ? <Globe className="w-3.5 h-3.5 text-green-500" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${TYPE_COLORS[s.scenarioType as ScenarioType] ?? "bg-gray-100 text-gray-700"}`}>{s.scenarioType}</span>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.description && <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>}
                {s.tags && <div className="flex flex-wrap gap-1">{s.tags.split(",").map((t: any) => <Badge key={t} variant="secondary" className="text-xs">{t.trim()}</Badge>)}</div>}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Runs: {s.runCount}</span>
                  {s.lastRunAt && <span>Last: {new Date(s.lastRunAt).toLocaleDateString()}</span>}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => runMut.mutate({ id: s.id })} disabled={runMut.isPending}>
                    <Play className="w-3.5 h-3.5" /> Run
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => deleteMut.mutate({ id: s.id })}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editScenario} onOpenChange={(o) => !o && setEditScenario(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Scenario</DialogTitle></DialogHeader>
          <ScenarioForm form={form} setForm={setForm} onTypeChange={handleTypeChange} onSubmit={handleUpdate} loading={updateMut.isPending} submitLabel="Save Changes" />
        </DialogContent>
      </Dialog>

      {/* Run Result Dialog */}
      <Dialog open={!!runResult} onOpenChange={(o) => !o && setRunResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Run Result: {runResult?.scenarioName}</DialogTitle></DialogHeader>
          <div className="bg-muted rounded-lg p-4 overflow-auto max-h-80">
            <pre className="text-sm font-mono whitespace-pre-wrap">{JSON.stringify(runResult?.result, null, 2)}</pre>
          </div>
          <Button onClick={() => setRunResult(null)}>Close</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScenarioForm({ form, setForm, onTypeChange, onSubmit, loading, submitLabel }: any) {
  return (
    <DashboardLayout>
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Name *</Label>
        <Input value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. High-value USD→NGN transfer" />
      </div>
      <div className="space-y-1">
        <Label>Type</Label>
        <Select value={form.scenarioType} onValueChange={onTypeChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{["transfer","fx","kyc","webhook","payment","compliance"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Input value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
      </div>
      <div className="space-y-1">
        <Label>Payload (JSON)</Label>
        <Textarea value={form.payload} onChange={e => setForm((f: any) => ({ ...f, payload: e.target.value }))} rows={6} className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <Label>Tags (comma-separated)</Label>
        <Input value={form.tags} onChange={e => setForm((f: any) => ({ ...f, tags: e.target.value }))} placeholder="e.g. high-value, africa, test" />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.isPublic} onCheckedChange={v => setForm((f: any) => ({ ...f, isPublic: v }))} />
        <Label>Make public (visible to all users)</Label>
      </div>
      <Button onClick={onSubmit} disabled={loading || !form.name} className="w-full">{loading ? "Saving..." : submitLabel}</Button>
    </div>
  
    </DashboardLayout>
  );
}
