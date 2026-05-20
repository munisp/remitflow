import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Clock, AlertCircle, Search, Eye,
  MessageSquare, ChevronRight, Building2, Users, TrendingUp, FileText
} from "lucide-react";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  under_review: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  additional_info_required: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  approved: "bg-green-500/20 text-green-300 border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
  suspended: "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function AdminPartnerApplications() {
  const [statusFilter, setStatusFilter] = useState<any>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<number | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showInfoDialog, setShowInfoDialog] = useState(false);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [infoRequest, setInfoRequest] = useState("");
  const [comment, setComment] = useState("");
  const [commentInternal, setCommentInternal] = useState(true);

  const utils = trpc.useUtils();

  const { data: stats } = trpc.partnerApplications.adminStats.useQuery();
  const { data: listData, isLoading } = trpc.partnerApplications.adminList.useQuery({
    status: statusFilter,
    page,
    limit: 20,
    search: search || undefined,
  });
  const { data: detail } = trpc.partnerApplications.adminGetDetail.useQuery(
    { id: selectedApp! },
    { enabled: !!selectedApp }
  );

  const startReview = trpc.partnerApplications.startReview.useMutation({
    onSuccess: () => { toast.success("Application moved to Under Review"); utils.partnerApplications.adminList.invalidate(); utils.partnerApplications.adminGetDetail.invalidate(); },
  });
  const approve = trpc.partnerApplications.approve.useMutation({
    onSuccess: (data) => { toast.success(`Application approved! Tenant ID: ${data.tenantId}, Invite: ${data.inviteCode}`); utils.partnerApplications.adminList.invalidate(); utils.partnerApplications.adminGetDetail.invalidate(); utils.partnerApplications.adminStats.invalidate(); },
  });
  const reject = trpc.partnerApplications.reject.useMutation({
    onSuccess: () => { toast.success("Application rejected"); setShowRejectDialog(false); utils.partnerApplications.adminList.invalidate(); utils.partnerApplications.adminGetDetail.invalidate(); utils.partnerApplications.adminStats.invalidate(); },
  });
  const requestInfo = trpc.partnerApplications.requestAdditionalInfo.useMutation({
    onSuccess: () => { toast.success("Additional info requested"); setShowInfoDialog(false); utils.partnerApplications.adminList.invalidate(); utils.partnerApplications.adminGetDetail.invalidate(); },
  });
  const addComment = trpc.partnerApplications.addComment.useMutation({
    onSuccess: () => { toast.success("Comment added"); setShowCommentDialog(false); setComment(""); utils.partnerApplications.adminGetDetail.invalidate(); },
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Partner Applications</h1>
          <p className="text-muted-foreground">Review and manage white-label partner applications</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Total", value: stats?.total ?? 0, icon: FileText, color: "text-blue-400" },
            { label: "Pending", value: stats?.pending ?? 0, icon: Clock, color: "text-amber-400" },
            { label: "Under Review", value: stats?.under_review ?? 0, icon: AlertCircle, color: "text-orange-400" },
            { label: "Approved", value: stats?.approved ?? 0, icon: CheckCircle2, color: "text-green-400" },
            { label: "Rejected", value: stats?.rejected ?? 0, icon: XCircle, color: "text-red-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Applications List */}
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by company, email..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="additional_info_required">Info Required</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* List */}
            <div className="space-y-2">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : !listData?.applications.length ? (
                <div className="text-center py-8 text-muted-foreground">No applications found</div>
              ) : (
                listData.applications.map((app: any) => (
                  <Card
                    key={app.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 ${selectedApp === app.id ? "border-primary bg-primary/5" : ""}`}
                    onClick={() => setSelectedApp(app.id)}
                  >
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-sm truncate">{app.company_name}</p>
                            <Badge className={`text-xs ${STATUS_BADGE[app.status] ?? STATUS_BADGE.submitted}`}>
                              {app.status?.replace("_", " ")}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{app.contact_email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{app.requested_plan?.replace("_", " ")}</Badge>
                            {app.submitted_at && <span className="text-xs text-muted-foreground">{new Date(app.submitted_at).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {/* Pagination */}
            {listData && listData.total > listData.limit && (
              <div className="flex justify-between items-center text-sm text-muted-foreground">
                <span>Showing {((page - 1) * listData.limit) + 1}–{Math.min(page * listData.limit, listData.total)} of {listData.total}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button variant="outline" size="sm" disabled={page * listData.limit >= listData.total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div>
            {!selectedApp ? (
              <Card className="h-full flex items-center justify-center min-h-[300px]">
                <div className="text-center text-muted-foreground">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Select an application to review</p>
                </div>
              </Card>
            ) : !detail ? (
              <Card className="h-full flex items-center justify-center min-h-[300px]">
                <p className="text-muted-foreground">Loading...</p>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{detail.company_name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{detail.brand_name} · {detail.slug}</p>
                    </div>
                    <Badge className={STATUS_BADGE[detail.status] ?? STATUS_BADGE.submitted}>
                      {detail.status?.replace("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      ["Contact", detail.contact_name],
                      ["Email", detail.contact_email],
                      ["Country", detail.country],
                      ["Plan", detail.requested_plan?.replace("_", " ")],
                      ["Type", detail.application_type?.replace("_", " ")],
                      ["Volume", detail.expected_monthly_volume ? `$${Number(detail.expected_monthly_volume).toLocaleString()}` : "—"],
                      ["Users", detail.expected_user_count?.toLocaleString() ?? "—"],
                      ["AML Policy", detail.has_aml_policy ? "Yes" : "No"],
                      ["KYC Process", detail.has_kyc_process ? "Yes" : "No"],
                      ["Regulated", detail.is_regulated ? "Yes" : "No"],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-muted/30 rounded p-2">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="font-medium capitalize">{value ?? "—"}</p>
                      </div>
                    ))}
                  </div>

                  {/* Business description */}
                  {detail.business_description && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Business Description</p>
                      <p className="text-sm bg-muted/30 rounded p-2">{detail.business_description}</p>
                    </div>
                  )}

                  {/* Corridors */}
                  {detail.target_corridors?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Target Corridors</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.target_corridors.map((c: string) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {detail.status === "submitted" && (
                      <Button size="sm" variant="outline" onClick={() => startReview.mutate({ id: detail.id })} disabled={startReview.isPending}>
                        <Eye className="w-3 h-3 mr-1" /> Start Review
                      </Button>
                    )}
                    {["submitted", "under_review", "additional_info_required"].includes(detail.status) && (
                      <>
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => approve.mutate({ id: detail.id })} disabled={approve.isPending}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setShowInfoDialog(true); }}>
                          <AlertCircle className="w-3 h-3 mr-1" /> Request Info
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setShowRejectDialog(true)}>
                          <XCircle className="w-3 h-3 mr-1" /> Reject
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setShowCommentDialog(true)}>
                      <MessageSquare className="w-3 h-3 mr-1" /> Comment
                    </Button>
                  </div>

                  {/* Comments */}
                  {detail.comments?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Comments ({detail.comments.length})</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {detail.comments.map((c: any) => (
                          <div key={c.id} className={`text-xs rounded p-2 ${c.is_internal ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/30"}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium">{c.author_name}</span>
                              <div className="flex items-center gap-1">
                                {c.is_internal && <Badge className="text-[10px] bg-amber-500/20 text-amber-300">Internal</Badge>}
                                <span className="text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <p>{c.comment}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Application</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Rejection Reason *</Label>
            <Textarea placeholder="Explain why the application is being rejected..." value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => reject.mutate({ id: selectedApp!, rejectionReason })} disabled={!rejectionReason.trim() || reject.isPending}>
              {reject.isPending ? "Rejecting..." : "Reject Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Info Dialog */}
      <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Additional Information</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Information Required *</Label>
            <Textarea placeholder="Describe what additional information you need from the applicant..." value={infoRequest} onChange={e => setInfoRequest(e.target.value)} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInfoDialog(false)}>Cancel</Button>
            <Button onClick={() => requestInfo.mutate({ id: selectedApp!, request: infoRequest })} disabled={!infoRequest.trim() || requestInfo.isPending}>
              {requestInfo.isPending ? "Sending..." : "Send Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comment Dialog */}
      <Dialog open={showCommentDialog} onOpenChange={setShowCommentDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Comment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="internal" checked={commentInternal} onChange={e => setCommentInternal(e.target.checked)} />
              <Label htmlFor="internal">Internal comment (not visible to applicant)</Label>
            </div>
            <Textarea placeholder="Add your comment..." value={comment} onChange={e => setComment(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommentDialog(false)}>Cancel</Button>
            <Button onClick={() => addComment.mutate({ applicationId: selectedApp!, comment, isInternal: commentInternal })} disabled={!comment.trim() || addComment.isPending}>
              {addComment.isPending ? "Adding..." : "Add Comment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
