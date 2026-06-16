import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, Clock, AlertTriangle, Search, RefreshCw, Eye, FileText, User, Shield } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const TIER_LABELS: Record<string, string> = { tier1: "Tier 1 (Basic)", tier2: "Tier 2 (Enhanced)", tier3: "Tier 3 (Full)" };
const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  pending: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: Clock, label: "Pending" },
  under_review: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", icon: Eye, label: "Under Review" },
  approved: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2, label: "Approved" },
  rejected: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: XCircle, label: "Rejected" },
  info_requested: { color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400", icon: AlertTriangle, label: "Info Requested" },
};

export default function KYCAdminQueue() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [actionDialog, setActionDialog] = useState<"approve" | "reject" | "info" | null>(null);
  const [reason, setReason] = useState("");
  const [tierOverride, setTierOverride] = useState("");

  const { data, isLoading, refetch } = trpc.kycAdmin.queue.useQuery({ status: tab === "all" ? undefined : tab as any, search: search || undefined });

  const reviewMutation = trpc.kycAdmin.approve.useMutation({
    onSuccess: () => { toast.success("Review started"); refetch(); },
  });
  const approveMutation = trpc.kycAdmin.approve.useMutation({
    onSuccess: () => { toast.success("KYC approved"); setActionDialog(null); setSelected(null); refetch(); },
  });
  const rejectMutation = trpc.kycAdmin.reject.useMutation({
    onSuccess: () => { toast.success("KYC rejected"); setActionDialog(null); setSelected(null); refetch(); },
  });
  const requestInfoMutation = trpc.kycAdmin.reject.useMutation({
    onSuccess: () => { toast.success("Info requested from user"); setActionDialog(null); setSelected(null); refetch(); },
  });

  const docs = data?.submissions ?? [];
  const stats = data ? { pending: data.total, under_review: 0, approved: 0, rejected: 0, info_requested: 0 } : undefined;

  const handleAction = () => {
    if (!selected) return;
    if (actionDialog === "approve") {
      approveMutation.mutate({ submissionId: selected.id, tier: tierOverride as any || selected.tier, reviewNotes: reason });
    } else if (actionDialog === "reject") {
      if (!reason.trim()) { toast.error("Rejection reason is required"); return; }
      rejectMutation.mutate({ submissionId: selected.id, rejectionReason: reason });
    } else if (actionDialog === "info") {
      if (!reason.trim()) { toast.error("Please specify what information is needed"); return; }
      requestInfoMutation.mutate({ submissionId: selected.id, rejectionReason: "Additional information requested: " + reason });
    }
  };

  const isPending = approveMutation.isPending || rejectMutation.isPending || requestInfoMutation.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-purple-500" />
              KYC Admin Queue
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Review and approve identity verification documents</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Pending", value: stats.pending, color: "text-yellow-600" },
              { label: "Under Review", value: stats.under_review, color: "text-blue-600" },
              { label: "Approved", value: stats.approved, color: "text-green-600" },
              { label: "Rejected", value: stats.rejected, color: "text-red-600" },
              { label: "Info Requested", value: stats.info_requested, color: "text-purple-600" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-4 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Search + Tabs */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name, email, document type..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="under_review">Under Review</TabsTrigger>
            <TabsTrigger value="info_requested">Info Requested</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="py-16 text-center"><div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto" /></div>
                ) : docs.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No KYC documents in this queue</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">User</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Document</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Tier</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Submitted</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((doc: any) => {
                          const statusCfg = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.pending;
                          const StatusIcon = statusCfg.icon;
                          return (
                            <tr key={doc.id} className="border-b hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                                    <User className="w-4 h-4 text-purple-600" />
                                  </div>
                                  <div>
                                    <p className="font-medium">{doc.user_name ?? "Unknown"}</p>
                                    <p className="text-xs text-muted-foreground">{doc.user_email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium capitalize">{doc.doc_type?.replace(/_/g, " ")}</p>
                                {doc.doc_number && <p className="text-xs text-muted-foreground">{doc.doc_number}</p>}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" className="text-xs">{TIER_LABELS[doc.tier] ?? doc.tier}</Badge>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                                  <StatusIcon className="w-3 h-3" />
                                  {statusCfg.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {doc.status === "pending" && (
                                    <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ submissionId: doc.id , tier: "tier1" })}>
                                      Start Review
                                    </Button>
                                  )}
                                  {(doc.status === "under_review" || doc.status === "info_requested") && (
                                    <>
                                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { setSelected(doc); setActionDialog("approve"); setReason(""); setTierOverride(""); }}>
                                        <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                                      </Button>
                                      <Button size="sm" variant="destructive" onClick={() => { setSelected(doc); setActionDialog("reject"); setReason(""); }}>
                                        <XCircle className="w-3 h-3 mr-1" /> Reject
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => { setSelected(doc); setActionDialog("info"); setReason(""); }}>
                                        <AlertTriangle className="w-3 h-3 mr-1" /> Request Info
                                      </Button>
                                    </>
                                  )}
                                  {(doc.status === "approved" || doc.status === "rejected") && (
                                    <span className="text-xs text-muted-foreground">{doc.reviewed_by ?? "—"}</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Action Dialog */}
        <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {actionDialog === "approve" && "Approve KYC Document"}
                {actionDialog === "reject" && "Reject KYC Document"}
                {actionDialog === "info" && "Request Additional Information"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {selected && (
                <div className="p-3 bg-muted/30 rounded-lg text-sm">
                  <p><span className="font-medium">User:</span> {selected.user_name} ({selected.user_email})</p>
                  <p><span className="font-medium">Document:</span> {selected.doc_type?.replace(/_/g, " ")}</p>
                  <p><span className="font-medium">Tier:</span> {TIER_LABELS[selected.tier] ?? selected.tier}</p>
                </div>
              )}
              {actionDialog === "approve" && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Tier to Grant</label>
                  <Select value={tierOverride || selected?.tier || ""} onValueChange={setTierOverride}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tier1">Tier 1 (Basic — $500/day limit)</SelectItem>
                      <SelectItem value="tier2">Tier 2 (Enhanced — $5,000/day limit)</SelectItem>
                      <SelectItem value="tier3">Tier 3 (Full — $50,000/day limit)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {actionDialog === "approve" ? "Notes (optional)" : actionDialog === "reject" ? "Rejection Reason *" : "Information Needed *"}
                </label>
                <Textarea
                  placeholder={
                    actionDialog === "approve" ? "Any notes for the record..." :
                    actionDialog === "reject" ? "Explain why the document was rejected (visible to user)..." :
                    "Describe what additional information or documents are needed..."
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
              <Button
                onClick={handleAction}
                disabled={isPending}
                className={actionDialog === "approve" ? "bg-green-600 hover:bg-green-700" : actionDialog === "reject" ? "bg-red-600 hover:bg-red-700" : ""}
              >
                {isPending ? "Processing..." : actionDialog === "approve" ? "Approve" : actionDialog === "reject" ? "Reject" : "Send Request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
