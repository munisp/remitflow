import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle, XCircle, DollarSign, RefreshCw } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function PartnerPayoutsV2Page() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [rejectDialog, setRejectDialog] = useState<{ id: number } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const statsQuery = trpc.v89.partnerPayoutAutomation.getStats.useQuery();
  const pendingQuery = trpc.v89.partnerPayoutAutomation.getPendingPayouts.useQuery({ limit: 50, offset: 0 });
  const historyQuery = trpc.v89.partnerPayoutAutomation.getHistory.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as any, limit: 50, offset: 0,
  });

  const approveMutation = trpc.v89.partnerPayoutAutomation.approvePayouts.useMutation({
    onSuccess: (d) => { toast.success(`${d.approved} payouts approved`); setSelectedIds([]); pendingQuery.refetch(); statsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = trpc.v89.partnerPayoutAutomation.rejectPayout.useMutation({
    onSuccess: () => { toast.success("Payout rejected"); setRejectDialog(null); setRejectReason(""); pendingQuery.refetch(); statsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;
  const pending = pendingQuery.data?.payouts ?? [];
  const history = historyQuery.data?.payouts ?? [];

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    approved: "bg-green-500/20 text-green-400",
    rejected: "bg-red-500/20 text-red-400",
    paid: "bg-blue-500/20 text-blue-400",
  };

  const PayoutRow = ({ p, showActions }: { p: any; showActions: boolean }) => (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      {showActions && (
        <td className="p-3">
          <input type="checkbox" className="rounded" checked={selectedIds.includes(p.id)}
            onChange={() => setSelectedIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])} />
        </td>
      )}
      <td className="p-3 font-mono text-xs text-muted-foreground">#{p.id}</td>
      <td className="p-3 text-sm">{p.reference ?? "—"}</td>
      <td className="p-3 font-semibold text-green-400">${p.feeRevenue?.toFixed(2)}</td>
      <td className="p-3 text-sm">{(p.revenueShare * 100).toFixed(1)}%</td>
      <td className="p-3">
        <Badge className={STATUS_COLORS[p.status ?? "pending"]}>{p.status}</Badge>
      </td>
      <td className="p-3 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
      {showActions && (
        <td className="p-3">
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs text-green-400 border-green-500/30"
              onClick={() => approveMutation.mutate({ payoutIds: [p.id] })}>
              <CheckCircle className="w-3 h-3 mr-1" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-500/30"
              onClick={() => setRejectDialog({ id: p.id })}>
              <XCircle className="w-3 h-3 mr-1" /> Reject
            </Button>
          </div>
        </td>
      )}
    </tr>
  );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Partner Payout Automation</h1>
          <p className="text-muted-foreground text-sm mt-1">Approve, reject, and track partner revenue payouts</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { pendingQuery.refetch(); statsQuery.refetch(); }}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pending", value: stats?.totalPending ?? 0, color: "text-yellow-400" },
          { label: "Approved", value: stats?.totalApproved ?? 0, color: "text-green-400" },
          { label: "Rejected", value: stats?.totalRejected ?? 0, color: "text-red-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <DollarSign className={`w-8 h-8 ${color}`} />
              <div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 border-b border-border">
        {(["pending", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t === "pending" ? `Pending (${pending.length})` : "History"}
          </button>
        ))}
      </div>

      {tab === "pending" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Pending Payouts</CardTitle>
            {selectedIds.length > 0 && (
              <Button size="sm" onClick={() => approveMutation.mutate({ payoutIds: selectedIds })}
                disabled={approveMutation.isPending}>
                <CheckCircle className="w-4 h-4 mr-2" /> Approve {selectedIds.length} Selected
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="p-3 text-left w-8"><input type="checkbox" className="rounded"
                      checked={selectedIds.length === pending.length && pending.length > 0}
                      onChange={(e) => setSelectedIds(e.target.checked ? pending.map((p: any) => p.id) : [])} /></th>
                    <th className="p-3 text-left">ID</th><th className="p-3 text-left">Reference</th>
                    <th className="p-3 text-left">Revenue</th><th className="p-3 text-left">Share %</th>
                    <th className="p-3 text-left">Status</th><th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No pending payouts</td></tr>
                  ) : pending.map((p: any) => <PayoutRow key={p.id} p={p} showActions={true} />)}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "history" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Payout History</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="p-3 text-left">ID</th><th className="p-3 text-left">Reference</th>
                    <th className="p-3 text-left">Revenue</th><th className="p-3 text-left">Share %</th>
                    <th className="p-3 text-left">Status</th><th className="p-3 text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No history found</td></tr>
                  ) : history.map((p: any) => <PayoutRow key={p.id} p={p} showActions={false} />)}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!rejectDialog} onOpenChange={(open) => !open && setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Payout #{rejectDialog?.id}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Rejection Reason (min 10 characters)</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this payout is being rejected..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectReason.length < 10 || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ payoutId: rejectDialog!.id, reason: rejectReason })}>
              Reject Payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
