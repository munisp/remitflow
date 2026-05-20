import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Shield, Search, Plus, AlertTriangle, XCircle, CheckCircle, Eye } from "lucide-react";

const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  clear: { color: "text-green-400 bg-green-500/10 border-green-500/30", icon: CheckCircle, label: "Clear" },
  flagged: { color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30", icon: AlertTriangle, label: "Flagged" },
  blocked: { color: "text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle, label: "Blocked" },
  under_review: { color: "text-blue-400 bg-blue-500/10 border-blue-500/30", icon: Eye, label: "Under Review" },
};

export default function ComplianceWatchlistPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  const [addForm, setAddForm] = useState({
    name: "", dateOfBirth: "", nationality: "", idNumber: "",
    status: "under_review" as const, riskScore: 50, notes: "",
  });
  const [screenForm, setScreenForm] = useState({ name: "", dateOfBirth: "", nationality: "" });

  const { data: stats } = trpc.complianceWatchlist.stats.useQuery();
  const { data: listData, isLoading } = trpc.complianceWatchlist.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as any,
    search: search || undefined,
    limit: LIMIT, offset,
  });
  const { data: screenResult, refetch: runScreen } = trpc.complianceWatchlist.screen.useQuery(
    { name: screenForm.name, dateOfBirth: screenForm.dateOfBirth || undefined, nationality: screenForm.nationality || undefined },
    { enabled: false }
  );

  const addMutation = trpc.complianceWatchlist.add.useMutation({
    onSuccess: () => {
      toast.success("Entry added to watchlist");
      utils.complianceWatchlist.list.invalidate();
      utils.complianceWatchlist.stats.invalidate();
      setAddOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.complianceWatchlist.update.useMutation({
    onSuccess: () => { toast.success("Entry updated"); utils.complianceWatchlist.list.invalidate(); utils.complianceWatchlist.stats.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Admin access required.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Compliance Watchlist</h1>
            <p className="text-muted-foreground text-sm mt-1">AML screening and sanctions monitoring</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={screenOpen} onOpenChange={setScreenOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2"><Search className="w-4 h-4" /> Screen Name</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Screen Individual</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div>
                    <Label>Full Name *</Label>
                    <Input value={screenForm.name} onChange={e => setScreenForm(f => ({ ...f, name: e.target.value }))} placeholder="Enter full name" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Date of Birth</Label>
                      <Input type="date" value={screenForm.dateOfBirth} onChange={e => setScreenForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Nationality (ISO-2)</Label>
                      <Input maxLength={2} placeholder="NG" value={screenForm.nationality} onChange={e => setScreenForm(f => ({ ...f, nationality: e.target.value.toUpperCase() }))} />
                    </div>
                  </div>
                  <Button onClick={() => runScreen()} disabled={!screenForm.name} className="w-full">Run Screen</Button>
                  {screenResult && (
                    <div className={`p-3 rounded-lg border ${STATUS_CONFIG[screenResult.status]?.color ?? ""}`}>
                      <p className="font-semibold">Result: {screenResult.status.toUpperCase()}</p>
                      <p className="text-sm">Risk Score: {screenResult.riskScore}/100</p>
                      <p className="text-sm">{screenResult.matches.length} match(es) found</p>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="w-4 h-4" /> Add Entry</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Add Watchlist Entry</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div>
                    <Label>Full Name *</Label>
                    <Input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Date of Birth</Label>
                      <Input type="date" value={addForm.dateOfBirth} onChange={e => setAddForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Nationality</Label>
                      <Input maxLength={2} placeholder="NG" value={addForm.nationality} onChange={e => setAddForm(f => ({ ...f, nationality: e.target.value.toUpperCase() }))} />
                    </div>
                  </div>
                  <div>
                    <Label>ID Number</Label>
                    <Input value={addForm.idNumber} onChange={e => setAddForm(f => ({ ...f, idNumber: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Status</Label>
                      <Select value={addForm.status} onValueChange={v => setAddForm(f => ({ ...f, status: v as any }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Risk Score (0-100)</Label>
                      <Input type="number" min="0" max="100" value={addForm.riskScore} onChange={e => setAddForm(f => ({ ...f, riskScore: Number(e.target.value) }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>
                  <Button onClick={() => addMutation.mutate({ ...addForm, dateOfBirth: addForm.dateOfBirth || undefined, nationality: addForm.nationality || undefined, idNumber: addForm.idNumber || undefined, notes: addForm.notes || undefined })}
                    disabled={addMutation.isPending || !addForm.name} className="w-full">
                    {addMutation.isPending ? "Adding..." : "Add to Watchlist"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Entries", value: stats?.total ?? 0, color: "text-foreground" },
            { label: "Flagged", value: stats?.flagged ?? 0, color: "text-yellow-400" },
            { label: "Blocked", value: stats?.blocked ?? 0, color: "text-red-400" },
            { label: "Under Review", value: stats?.underReview ?? 0, color: "text-blue-400" },
          ].map(({ label, value, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name..." value={search}
              onChange={e => { setSearch(e.target.value); setOffset(0); }} />
          </div>
          <div className="flex gap-2">
            {["all", "clear", "flagged", "blocked", "under_review"].map(s => (
              <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm"
                onClick={() => { setStatusFilter(s); setOffset(0); }}>
                {s === "all" ? "All" : STATUS_CONFIG[s]?.label ?? s}
              </Button>
            ))}
          </div>
        </div>

        {/* Table */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />)}</div>
            ) : (listData?.entries?.length ?? 0) === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No watchlist entries found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left p-4">Name</th>
                      <th className="text-left p-4">Nationality</th>
                      <th className="text-left p-4">ID Number</th>
                      <th className="text-center p-4">Risk Score</th>
                      <th className="text-left p-4">Status</th>
                      <th className="text-left p-4">Matched Lists</th>
                      <th className="text-right p-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listData?.entries?.map((entry: any) => {
                      const cfg = STATUS_CONFIG[entry.status];
                      const Icon = cfg?.icon ?? Shield;
                      return (
                        <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="p-4 font-medium">{entry.name}</td>
                          <td className="p-4 text-muted-foreground">{entry.nationality ?? "—"}</td>
                          <td className="p-4 font-mono text-xs text-muted-foreground">{entry.idNumber ?? "—"}</td>
                          <td className="p-4 text-center">
                            <span className={`font-bold ${entry.riskScore >= 80 ? "text-red-400" : entry.riskScore >= 50 ? "text-yellow-400" : "text-green-400"}`}>
                              {entry.riskScore}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg?.color}`}>
                              <Icon className="w-3 h-3" /> {cfg?.label ?? entry.status}
                            </span>
                          </td>
                          <td className="p-4 text-xs text-muted-foreground">
                            {(entry.matchedLists as string[]).join(", ") || "—"}
                          </td>
                          <td className="p-4 text-right">
                            <Select value={entry.status} onValueChange={v => updateMutation.mutate({ id: entry.id, status: v as any })}>
                              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between p-4 text-sm text-muted-foreground">
                  <span>Showing {offset + 1}–{Math.min(offset + LIMIT, listData?.total ?? 0)} of {listData?.total ?? 0}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={offset + LIMIT >= (listData?.total ?? 0)} onClick={() => setOffset(offset + LIMIT)}>Next</Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
