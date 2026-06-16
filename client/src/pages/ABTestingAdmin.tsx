import { toast } from 'sonner';
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Plus, Play, Pause, BarChart2, CheckCircle, Clock, Layers } from "lucide-react";
import { useTranslation } from 'react-i18next';

const statusColor: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  running: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
};

export default function ABTestingAdmin() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    targetPage: "/",
    variants: [
      { id: "control", name: "Control", weight: 50, description: "Original version" },
      { id: "variant_a", name: "Variant A", weight: 50, description: "New version" },
    ],
  });

  const { data: expData, isLoading } = trpc.abTesting.listExperiments.useQuery();
  const { data: resultsData } = trpc.abTesting.getResults.useQuery(
    { experimentId: selectedExp! },
    { enabled: !!selectedExp }
  );

  const createMutation = trpc.abTesting.createExperiment.useMutation({
    onSuccess: () => {
      toast.success("Experiment created");
      utils.abTesting.listExperiments.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error("Error"),
  });

  const updateStatusMutation = trpc.abTesting.updateExperimentStatus.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      utils.abTesting.listExperiments.invalidate();
    },
  });

  const totalWeight = form.variants.reduce((s, v) => s + v.weight, 0);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="w-6 h-6 text-purple-500" /> A/B Testing Framework</h1>
            <p className="text-muted-foreground text-sm mt-1">Run controlled experiments to optimize conversion rates and user experience</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> New Experiment</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Create A/B Experiment</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Experiment Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Landing Page Hero CTA" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What are you testing?" />
                </div>
                <div>
                  <Label>Target Page</Label>
                  <Input value={form.targetPage} onChange={e => setForm(f => ({ ...f, targetPage: e.target.value }))} placeholder="/" />
                </div>
                <div>
                  <Label>Variants (weights must sum to 100)</Label>
                  <div className="space-y-2 mt-2">
                    {form.variants.map((v, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="w-32" value={v.id} onChange={e => setForm(f => { const vs = [...f.variants]; vs[i] = { ...vs[i], id: e.target.value }; return { ...f, variants: vs }; })} placeholder="ID" />
                        <Input className="flex-1" value={v.name} onChange={e => setForm(f => { const vs = [...f.variants]; vs[i] = { ...vs[i], name: e.target.value }; return { ...f, variants: vs }; })} placeholder="Name" />
                        <Input className="w-20" type="number" value={v.weight} onChange={e => setForm(f => { const vs = [...f.variants]; vs[i] = { ...vs[i], weight: Number(e.target.value) }; return { ...f, variants: vs }; })} placeholder="%" />
                        {form.variants.length > 2 && (
                          <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, variants: f.variants.filter((_, j) => j !== i) }))}>×</Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, variants: [...f.variants, { id: `variant_${f.variants.length}`, name: `Variant ${f.variants.length}`, weight: 0, description: "" }] }))}>+ Add Variant</Button>
                    <span className={`text-sm ${totalWeight === 100 ? "text-green-600" : "text-red-500"}`}>Total: {totalWeight}%</span>
                  </div>
                </div>
                <Button className="w-full" disabled={createMutation.isPending || totalWeight !== 100} onClick={() => createMutation.mutate(form)}>
                  {createMutation.isPending ? "Creating..." : "Create Experiment"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total", value: expData?.experiments.length ?? 0, icon: <Layers className="w-5 h-5 text-blue-500" /> },
            { label: "Running", value: expData?.experiments.filter((e: any) => e.status === "running").length ?? 0, icon: <Play className="w-5 h-5 text-green-500" /> },
            { label: "Completed", value: expData?.experiments.filter((e: any) => e.status === "completed").length ?? 0, icon: <CheckCircle className="w-5 h-5 text-purple-500" /> },
            { label: "Draft", value: expData?.experiments.filter((e: any) => e.status === "draft").length ?? 0, icon: <Clock className="w-5 h-5 text-gray-500" /> },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Experiments List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isLoading ? (
            <div className="col-span-2 text-center py-8 text-muted-foreground">Loading experiments...</div>
          ) : expData?.experiments.length === 0 ? (
            <div className="col-span-2 text-center py-8 text-muted-foreground">No experiments yet. Create your first A/B test.</div>
          ) : expData?.experiments.map((exp: any) => (
            <Card key={exp.id} className={`cursor-pointer transition-shadow hover:shadow-md ${selectedExp === exp.id ? "ring-2 ring-primary" : ""}`} onClick={() => setSelectedExp(exp.id)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{exp.name}</CardTitle>
                  <Badge className={`text-xs ${statusColor[exp.status]}`}>{exp.status}</Badge>
                </div>
                {exp.description && <p className="text-sm text-muted-foreground">{exp.description}</p>}
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1 mb-3">
                  {(exp.variants as any[]).map((v: any) => (
                    <Badge key={v.id} variant="outline" className="text-xs">{v.name} ({v.weight}%)</Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  {exp.status === "draft" && (
                    <Button size="sm" className="gap-1" onClick={e => { e.stopPropagation(); updateStatusMutation.mutate({ experimentId: exp.id, status: "running" }); }}>
                      <Play className="w-3 h-3" /> Start
                    </Button>
                  )}
                  {exp.status === "running" && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1" onClick={e => { e.stopPropagation(); updateStatusMutation.mutate({ experimentId: exp.id, status: "paused" }); }}>
                        <Pause className="w-3 h-3" /> Pause
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1" onClick={e => { e.stopPropagation(); updateStatusMutation.mutate({ experimentId: exp.id, status: "completed" }); }}>
                        <CheckCircle className="w-3 h-3" /> Complete
                      </Button>
                    </>
                  )}
                  {exp.status === "paused" && (
                    <Button size="sm" className="gap-1" onClick={e => { e.stopPropagation(); updateStatusMutation.mutate({ experimentId: exp.id, status: "running" }); }}>
                      <Play className="w-3 h-3" /> Resume
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1 ml-auto" onClick={e => { e.stopPropagation(); setSelectedExp(exp.id); }}>
                    <BarChart2 className="w-3 h-3" /> Results
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Results Panel */}
        {selectedExp && resultsData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BarChart2 className="w-5 h-5" /> Experiment Results: {resultsData.experiment.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Variant</th>
                      <th className="text-right py-2">Assignments</th>
                      <th className="text-right py-2">Impressions</th>
                      <th className="text-right py-2">Clicks</th>
                      <th className="text-right py-2">CTR</th>
                      <th className="text-right py-2">Conversions</th>
                      <th className="text-right py-2">Conv. Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultsData.results.map(r => (
                      <tr key={r.variantId} className="border-b hover:bg-muted/50">
                        <td className="py-2 font-medium">{r.variantName} <span className="text-muted-foreground text-xs">({r.weight}%)</span></td>
                        <td className="text-right py-2">{r.assignments}</td>
                        <td className="text-right py-2">{r.impressions}</td>
                        <td className="text-right py-2">{r.clicks}</td>
                        <td className="text-right py-2">{r.ctr}%</td>
                        <td className="text-right py-2">{r.conversions}</td>
                        <td className="text-right py-2 font-semibold text-green-600">{r.conversionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
