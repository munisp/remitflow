import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle, XCircle, FileText, RefreshCw } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
  expired: "bg-gray-500/20 text-gray-400",
};

export default function KYCLifecyclePage() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [rejectDialog, setRejectDialog] = useState<{ id: number } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const statsQuery = trpc.kycLifecycle.getMyLifecycle.useQuery();
  const docsQuery = trpc.kycLifecycle.getMyLifecycle.useQuery();

  const approveMutation = trpc.kycLifecycle.approve.useMutation({
    onSuccess: (data) => {
      toast.success(`Document approved${data.userKycUpdated ? " — User KYC status updated" : ""}`);
      docsQuery.refetch(); statsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = trpc.kycLifecycle.reject.useMutation({
    onSuccess: () => {
      toast.success("Document rejected");
      setRejectDialog(null); setRejectReason("");
      docsQuery.refetch(); statsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;
  const docs = docsQuery.data?.documents ?? [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">KYC Lifecycle Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Review, approve, and reject KYC documents</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { docsQuery.refetch(); statsQuery.refetch(); }}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats?.total ?? 0, color: "text-foreground" },
          { label: "Pending Review", value: stats?.pending ?? 0, color: "text-yellow-400" },
          { label: "Approved", value: stats?.approved ?? 0, color: "text-green-400" },
          { label: "Rejected", value: stats?.rejected ?? 0, color: "text-red-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-border">
        {["all", "pending", "approved", "rejected"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${statusFilter === s ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {s}
          </button>
        ))}
      </div>

      {/* Documents Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-400" /> KYC Documents ({docsQuery.data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">ID</th>
                  <th className="p-3 text-left">User</th>
                  <th className="p-3 text-left">Doc Type</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Expires</th>
                  <th className="p-3 text-left">Submitted</th>
                  <th className="p-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docsQuery.isPending ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : docs.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400 opacity-50" />
                    No documents in this status
                  </td></tr>
                ) : docs.map((doc) => (
                  <tr key={doc.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs text-muted-foreground">#{doc.id}</td>
                    <td className="p-3 text-sm">User #{doc.userId}</td>
                    <td className="p-3 capitalize text-sm">{doc.docType?.replace("_", " ")}</td>
                    <td className="p-3">
                      <Badge className={STATUS_COLORS[doc.status ?? "pending"] ?? "bg-gray-500/20 text-gray-400"}>
                        {doc.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</td>
                    <td className="p-3">
                      {doc.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-400 border-green-500/30"
                            onClick={() => approveMutation.mutate({ userId: doc.userId ?? 0 })}
                            disabled={approveMutation.isPending}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-500/30"
                            onClick={() => setRejectDialog({ id: doc.id })}>
                            <XCircle className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </div>
                      )}
                      {doc.status === "rejected" && doc.rejectionReason && (
                        <span className="text-xs text-muted-foreground italic">{doc.rejectionReason.substring(0, 40)}...</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!rejectDialog} onOpenChange={(open) => !open && setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Document #{rejectDialog?.id}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Rejection Reason (min 10 characters)</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Document is expired, blurry, or does not match user information..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectReason.length < 10 || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ userId: rejectDialog?.id ?? 0, rejectionReason: rejectReason })}>
              Reject Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
