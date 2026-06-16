import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Plus, Search, Download } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-yellow-500/10 text-yellow-400", approved: "bg-green-500/10 text-green-400",
  rejected: "bg-red-500/10 text-red-400", review: "bg-blue-500/10 text-blue-400",
};
const RISK_COLOR: Record<string, string> = {
  low: "bg-green-500/10 text-green-400", medium: "bg-yellow-500/10 text-yellow-400", high: "bg-red-500/10 text-red-400",
};
type DPIAItem = { id: number; title: string; status: string; riskLevel: string; createdAt: string; owner: string; description: string };

export default function DPIA() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewItem, setViewItem] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { data: complianceData, refetch, isLoading } = trpc.compliance.dpia.useQuery();
  const exportData = trpc.gdpr.exportData.useMutation({
    onSuccess: () => { toast.success("DPIA created"); setCreateOpen(false); setTitle(""); setDescription(""); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const backendDpias: DPIAItem[] = ((complianceData as any)?.assessments ?? []).map((a: any, i: number) => ({
    id: a.id ?? i + 1,
    title: a.title ?? "Untitled",
    status: a.status === "in_review" ? "review" : (a.status ?? "draft"),
    riskLevel: a.risk ?? a.riskLevel ?? "medium",
    createdAt: a.lastReview ? new Date(a.lastReview).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    owner: a.owner ?? "Compliance Team",
    description: a.description ?? "",
  }));
  const dpias = backendDpias.filter(d => !search || d.title?.toLowerCase().includes(search.toLowerCase()) || d.description?.toLowerCase().includes(search.toLowerCase()));
  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3"><FileText className="h-6 w-6 text-primary" /><div><h1 className="text-2xl font-bold">DPIA Records</h1><p className="text-muted-foreground text-sm">Data Protection Impact Assessments (GDPR Article 35)</p></div></div>
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />New DPIA</Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[{label:"Total",value:dpias.length,color:"text-foreground"},{label:"Approved",value:dpias.filter(d=>d.status==="approved").length,color:"text-green-400"},{label:"High Risk",value:dpias.filter(d=>d.riskLevel==="high").length,color:"text-red-400"}].map(s=>(
            <Card key={s.label} className="bg-card/60"><CardContent className="p-4 text-center"><div className={`text-2xl font-bold ${s.color}`}>{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
          ))}
        </div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search DPIAs..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} /></div>
        {dpias.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground"><FileText className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="text-sm">No DPIA records found</p></CardContent></Card> : (
          <div className="space-y-3">
            {dpias.map((d: any) => (
              <Card key={d.id} className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setViewItem(d)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm mb-1">{d.title}</div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{d.description}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">{d.createdAt ? new Date(d.createdAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : ""}</span>
                        {d.owner && <span className="text-xs text-muted-foreground">· {d.owner}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge className={`text-xs capitalize ${STATUS_COLOR[d.status] ?? "bg-muted text-muted-foreground"}`}>{d.status}</Badge>
                      {d.riskLevel && <Badge className={`text-xs capitalize ${RISK_COLOR[d.riskLevel] ?? ""}`}>{d.riskLevel} risk</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent><DialogHeader><DialogTitle>Create New DPIA</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div><Label>Title</Label><Input placeholder="e.g. Customer Profiling Assessment" value={title} onChange={e => setTitle(e.target.value)} /></div>
              <div><Label>Description</Label><Textarea placeholder="Describe the data processing activity..." value={description} onChange={e => setDescription(e.target.value)} rows={4} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => exportData.mutate()} disabled={!title || exportData.isPending}>{exportData.isPending ? "Creating..." : "Create DPIA"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
          <DialogContent><DialogHeader><DialogTitle>{viewItem?.title}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex gap-2"><Badge className={`text-xs capitalize ${STATUS_COLOR[viewItem?.status] ?? ""}`}>{viewItem?.status}</Badge>{viewItem?.riskLevel && <Badge className={`text-xs capitalize ${RISK_COLOR[viewItem?.riskLevel] ?? ""}`}>{viewItem?.riskLevel} risk</Badge>}</div>
              <p className="text-sm text-muted-foreground">{viewItem?.description}</p>
              {viewItem?.owner && <div className="text-xs text-muted-foreground">Owner: {viewItem.owner}</div>}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { const content = `DPIA REPORT\n${'='.repeat(60)}\n\nTitle: ${viewItem?.title}\nStatus: ${viewItem?.status?.toUpperCase()}\nRisk Level: ${viewItem?.riskLevel?.toUpperCase()}\nOwner: ${viewItem?.owner}\nDate: ${viewItem?.createdAt ? new Date(viewItem.createdAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')}\n\nDescription:\n${viewItem?.description}\n\n${'='.repeat(60)}\nGenerated by RemitFlow Compliance Platform\n${new Date().toISOString()}`; const blob = new Blob([content], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `DPIA-${viewItem?.id ?? Date.now()}.txt`; a.click(); URL.revokeObjectURL(url); toast.success('DPIA report downloaded'); }}><Download className="h-4 w-4 mr-2" />Download PDF</Button><Button onClick={() => setViewItem(null)}>Close</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
