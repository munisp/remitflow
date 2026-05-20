import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle, XCircle, Eye, Clock, ChevronLeft, ChevronRight, FileText, User, Shield, AlertTriangle, CheckSquare, Calendar, AlertCircle, Activity } from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

type KycStatus = "pending" | "under_review" | "approved" | "rejected" | "all";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  under_review: "bg-blue-100 text-blue-800 border-blue-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

const TIER_LABELS: Record<string, string> = {
  tier0: "Tier 0 — Unverified",
  tier1: "Tier 1 — Basic",
  tier2: "Tier 2 — Standard",
  tier3: "Tier 3 — Enhanced",
};

const TIER_COLORS: Record<string, string> = {
  tier0: "bg-gray-100 text-gray-700",
  tier1: "bg-yellow-100 text-yellow-700",
  tier2: "bg-blue-100 text-blue-700",
  tier3: "bg-green-100 text-green-700",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  passport: "Passport",
  national_id: "National ID",
  drivers_license: "Driver's License",
  utility_bill: "Utility Bill",
  bank_statement: "Bank Statement",
  selfie: "Selfie / Liveness",
  proof_of_address: "Proof of Address",
};

export default function AdminKYC() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<KycStatus>("pending");
  const [page, setPage] = useState(1);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

  const utils = trpc.useUtils();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const toggleSelect = (id: number) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = (ids: number[]) => setSelectedIds(prev => prev.length === ids.length && ids.length > 0 ? [] : [...ids]);

  const { data, isLoading } = trpc.admin.listPendingKyc.useQuery(
    { page, limit: 15, status },
    { enabled: user?.role === "admin" }
  );

  const approveMutation = trpc.admin.approveKyc.useMutation({
    onSuccess: () => {
      toast.success("Document approved — KYC tier advanced.");
      utils.admin.listPendingKyc.invalidate();
      setSelectedDoc(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = trpc.admin.rejectKyc.useMutation({
    onSuccess: () => {
      toast.success("Document rejected.");
      utils.admin.listPendingKyc.invalidate();
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedDoc(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkApproveMutation = trpc.admin.bulkApproveKyc.useMutation({
    onSuccess: (res) => {
      toast.success(`Bulk approved ${res.approved} document(s).`);
      utils.admin.listPendingKyc.invalidate();
      setSelectedIds([]);
    },
    onError: (err) => toast.error(err.message),
  });

  const underReviewMutation = trpc.admin.setKycUnderReview.useMutation({
    onSuccess: () => {
      toast.success("Marked as under review.");
      utils.admin.listPendingKyc.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [historyUserId, setHistoryUserId] = useState<number | null>(null);
  const [historyDocType, setHistoryDocType] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: docHistoryData } = trpc.admin.getKycDocumentHistory.useQuery(
    { userId: historyUserId!, docType: historyDocType ?? undefined },
    { enabled: !!historyUserId }
  );
  const docHistory = docHistoryData?.docs;

  const [expiryPage, setExpiryPage] = useState(1);
  const [expiryDays, setExpiryDays] = useState(30);
  const [expiryDocId, setExpiryDocId] = useState<number | null>(null);
  const [newExpiryDate, setNewExpiryDate] = useState("");
  const [expiryEditOpen, setExpiryEditOpen] = useState(false);

  const { data: expiringData, isLoading: expiryLoading, refetch: refetchExpiry } = trpc.admin.listExpiringKyc.useQuery(
    { daysAhead: expiryDays, page: expiryPage, limit: 15 },
    { enabled: user?.role === "admin" }
  );

  const setKycExpiry = trpc.admin.setKycExpiry.useMutation({
    onSuccess: () => {
      toast.success("Expiry date updated.");
      refetchExpiry();
      setExpiryEditOpen(false);
      setNewExpiryDate("");
      setExpiryDocId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="w-12 h-12 text-destructive" />
        <p className="text-lg font-semibold">Admin access required</p>
        <Button variant="outline" onClick={() => navigate("/")}>Go to Dashboard</Button>
      </div>
    );
  }

  const docs = data?.docs ?? [];
  const totalPages = data?.pages ?? 1;
  const docIds = docs.map((d: any) => d.id);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            KYC Review Panel
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and approve identity verification documents
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => bulkApproveMutation.mutate({ docIds: selectedIds })}
              disabled={bulkApproveMutation.isPending}
            >
              <CheckSquare className="w-4 h-4" />
              Approve Selected ({selectedIds.length})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate("/admin/liveness-audit")}
          >
            <Activity className="w-4 h-4" />
            Liveness Audit
          </Button>
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <FileText className="w-4 h-4" />
            {data?.total ?? 0} total
          </span>
        </div>
      </div>

      {/* Status filter tabs */}
      <Tabs value={status} onValueChange={(v) => { setStatus(v as KycStatus); setPage(1); }}>
        <TabsList className="grid grid-cols-5 w-full max-w-xl">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="under_review">In Review</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Document list */}
        <div className="lg:col-span-1 space-y-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
            ))
          ) : docs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="w-8 h-8" />
                <p className="text-sm">No {status === "all" ? "" : status} documents</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  checked={selectedIds.length === docIds.length && docIds.length > 0}
                  onCheckedChange={() => toggleSelectAll(docIds)}
                  id="select-all-kyc"
                />
                <label htmlFor="select-all-kyc" className="text-xs text-muted-foreground cursor-pointer select-none">
                  {selectedIds.length === docIds.length && docIds.length > 0 ? "Deselect all" : `Select all (${docIds.length})`}
                </label>
              </div>
              {docs.map((doc: any) => (
              <div key={doc.id} className="flex items-start gap-2">
                <Checkbox
                  checked={selectedIds.includes(doc.id)}
                  onCheckedChange={() => toggleSelect(doc.id)}
                  className="mt-4 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
              <Card
                className={`flex-1 cursor-pointer transition-all hover:shadow-md ${selectedDoc?.id === doc.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => setSelectedDoc(doc)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{doc.userName ?? "Unknown User"}</p>
                      <p className="text-xs text-muted-foreground truncate">{doc.userEmail}</p>
                      <p className="text-xs text-muted-foreground mt-1">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[doc.status ?? "pending"]}`}>
                        {doc.status ?? "pending"}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[doc.userKycTier ?? "tier0"]}`}>
                        {doc.userKycTier ?? "tier0"}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
              </div>
            ))}
            </>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Document detail panel */}
        <div className="lg:col-span-2">
          {!selectedDoc ? (
            <Card className="h-full flex items-center justify-center">
              <CardContent className="flex flex-col items-center gap-3 text-muted-foreground py-16">
                <FileText className="w-12 h-12 opacity-30" />
                <p className="text-sm">Select a document to review</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <User className="w-5 h-5" />
                      {selectedDoc.userName ?? "Unknown User"}
                    </CardTitle>
                    <CardDescription>{selectedDoc.userEmail}</CardDescription>
                  </div>
                  <span className={`text-sm px-3 py-1 rounded-full border font-medium ${STATUS_COLORS[selectedDoc.status ?? "pending"]}`}>
                    {selectedDoc.status ?? "pending"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Document info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Document Type</p>
                    <p className="font-medium">{DOC_TYPE_LABELS[selectedDoc.docType] ?? selectedDoc.docType}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Current KYC Tier</p>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${TIER_COLORS[selectedDoc.userKycTier ?? "tier0"]}`}>
                      {TIER_LABELS[selectedDoc.userKycTier ?? "tier0"]}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Submitted</p>
                    <p className="font-medium">{new Date(selectedDoc.createdAt).toLocaleString()}</p>
                  </div>
                  {selectedDoc.reviewedAt && (
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Reviewed</p>
                      <p className="font-medium">{new Date(selectedDoc.reviewedAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {/* Document preview */}
                {selectedDoc.fileUrl ? (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Document Preview</span>
                      <Button variant="ghost" size="sm" onClick={() => setImageDialogOpen(true)}>
                        <Eye className="w-4 h-4 mr-1" /> Full View
                      </Button>
                    </div>
                    <div className="p-4 flex items-center justify-center bg-muted/30 min-h-[200px]">
                      {selectedDoc.fileUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <img
                          src={selectedDoc.fileUrl}
                          alt="KYC document"
                          className="max-h-48 max-w-full object-contain rounded cursor-pointer"
                          onClick={() => setImageDialogOpen(true)}
                        />
                      ) : (
                        <a href={selectedDoc.fileUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 text-primary hover:underline">
                          <FileText className="w-10 h-10" />
                          <span className="text-sm">View Document</span>
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-lg p-8 flex flex-col items-center gap-2 text-muted-foreground bg-muted/20">
                    <FileText className="w-8 h-8 opacity-40" />
                    <p className="text-sm">No file attached</p>
                  </div>
                )}

                {/* OCR Extracted Data */}
                {(selectedDoc as any).extractedData && (() => {
                  let parsed: Record<string, string> | null = null;
                  try { parsed = typeof (selectedDoc as any).extractedData === "string" ? JSON.parse((selectedDoc as any).extractedData) : (selectedDoc as any).extractedData; } catch {}
                  if (!parsed || Object.keys(parsed).length === 0) return null;
                  return (
                    <div className="border border-blue-200 rounded-lg overflow-hidden">
                      <div className="bg-blue-50 px-4 py-2 flex items-center gap-2">
                        <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">AI-Extracted Fields</span>
                        <span className="text-xs text-blue-500 ml-auto">Auto-extracted by OCR</span>
                      </div>
                      <div className="p-4 grid grid-cols-2 gap-3">
                        {Object.entries(parsed).map(([k, v]) => (
                          <div key={k}>
                            <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
                            <p className="text-sm font-medium">{String(v) || "—"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {/* Rejection reason */}
                {selectedDoc.rejectionReason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Rejection Reason</p>
                    <p className="text-sm text-red-800">{selectedDoc.rejectionReason}</p>
                  </div>
                )}

                {/* Action buttons */}
                {(selectedDoc.status === "pending" || selectedDoc.status === "under_review") && (
                  <div className="flex flex-wrap gap-3 pt-2">
                    {selectedDoc.status === "pending" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => underReviewMutation.mutate({ docId: selectedDoc.id })}
                        disabled={underReviewMutation.isPending}
                      >
                        <Clock className="w-4 h-4 mr-1" />
                        Mark Under Review
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => approveMutation.mutate({ docId: selectedDoc.id, advanceTier: true })}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Approve & Advance Tier
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-600 text-green-700 hover:bg-green-50"
                      onClick={() => approveMutation.mutate({ docId: selectedDoc.id, advanceTier: false })}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Approve Only
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRejectDialogOpen(true)}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}

                {selectedDoc.status === "approved" && (
                  <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                    <CheckCircle className="w-5 h-5" />
                    <span className="text-sm font-medium">Document approved</span>
                  </div>
                )}

                {/* Document Version History accordion */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium text-left"
                    onClick={() => {
                      if (historyUserId !== selectedDoc.userId) {
                        setHistoryUserId(selectedDoc.userId);
                        setHistoryDocType(selectedDoc.docType ?? null);
                        setHistoryOpen(true);
                      } else {
                        setHistoryOpen(o => !o);
                      }
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      Document Version History
                    </span>
                    <span className="text-muted-foreground text-xs">{historyOpen && historyUserId === selectedDoc.userId ? "Hide" : "Show"}</span>
                  </button>
                  {historyOpen && historyUserId === selectedDoc.userId && (
                    <div className="divide-y">
                      {!docHistory ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                      ) : docHistory.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">No previous versions for this document type.</div>
                      ) : (
                        docHistory.map((h: any) => (
                          <div key={h.id} className="px-4 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{DOC_TYPE_LABELS[h.docType] ?? h.docType}</p>
                              <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[h.status] ?? ""}`}>
                                {h.status}
                              </span>
                              {h.supersededAt && (
                                <span className="text-xs text-orange-600">Superseded {new Date(h.supersededAt).toLocaleDateString()}</span>
                              )}
                              {h.fileUrl && (
                                <a href={h.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
                                  View
                                </a>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Reject Document
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Provide a clear reason for rejection. This will be shown to the user.
            </p>
            <Textarea
              placeholder="e.g. Document is blurry or unreadable. Please resubmit a clear photo."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">{rejectReason.length}/500 characters (minimum 5)</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedDoc && rejectMutation.mutate({ docId: selectedDoc.id, reason: rejectReason })}
              disabled={rejectReason.length < 5 || rejectMutation.isPending}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* KYC Expiry Panel */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-orange-500" />
              Expiring KYC Documents
              {(expiringData?.total ?? 0) > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                  {expiringData?.total}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={String(expiryDays)} onValueChange={(v) => { setExpiryDays(Number(v)); setExpiryPage(1); }}>
                <SelectTrigger className="w-32 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Next 7 days</SelectItem>
                  <SelectItem value="14">Next 14 days</SelectItem>
                  <SelectItem value="30">Next 30 days</SelectItem>
                  <SelectItem value="60">Next 60 days</SelectItem>
                  <SelectItem value="90">Next 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {expiryLoading ? (
            <div className="flex justify-center py-8"><Clock className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (expiringData?.docs?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <CheckCircle className="h-8 w-8 mb-2 text-green-400" />
              <p className="text-sm">No documents expiring in the next {expiryDays} days</p>
            </div>
          ) : (
            <div className="divide-y">
              {expiringData?.docs?.map((doc: any) => {
                const daysLeft = doc.expiresAt
                  ? Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null;
                const urgent = daysLeft !== null && daysLeft <= 7;
                return (
                  <DashboardLayout>
                  <div key={doc.id} className={`flex items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors ${urgent ? "bg-red-50/50" : ""}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg ${urgent ? "bg-red-100" : "bg-orange-100"}`}>
                        <AlertCircle className={`h-4 w-4 ${urgent ? "text-red-600" : "text-orange-600"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{doc.userName ?? "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{doc.userEmail}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-xs h-4">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</Badge>
                          <span className={`text-xs font-medium ${urgent ? "text-red-600" : "text-orange-600"}`}>
                            Expires {doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString() : "—"}
                            {daysLeft !== null && ` (${daysLeft}d)`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => { setExpiryDocId(doc.id); setNewExpiryDate(doc.expiresAt ? new Date(doc.expiresAt).toISOString().slice(0, 10) : ""); setExpiryEditOpen(true); }}
                    >
                      <Calendar className="h-3 w-3 mr-1" />
                      Update Expiry
                    </Button>
                  </div>
                
                  </DashboardLayout>
                );
              })}
            </div>
          )}
          {expiringData && expiringData.pages > 1 && (
            <div className="flex items-center justify-center gap-3 p-4 border-t">
              <Button variant="outline" size="sm" disabled={expiryPage <= 1} onClick={() => setExpiryPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">Page {expiryPage} of {expiringData.pages}</span>
              <Button variant="outline" size="sm" disabled={expiryPage >= expiringData.pages} onClick={() => setExpiryPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expiry Edit Dialog */}
      <Dialog open={expiryEditOpen} onOpenChange={setExpiryEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update KYC Document Expiry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Set a new expiry date for document #{expiryDocId}.</p>
            <Input
              type="date"
              value={newExpiryDate}
              onChange={e => setNewExpiryDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpiryEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => expiryDocId && newExpiryDate && setKycExpiry.mutate({ docId: expiryDocId, expiresAt: newExpiryDate })}
              disabled={!newExpiryDate || setKycExpiry.isPending}
            >
              {setKycExpiry.isPending ? "Saving..." : "Save Expiry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full image dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Document Preview</DialogTitle>
          </DialogHeader>
          {selectedDoc?.fileUrl && (
            <div className="flex items-center justify-center bg-muted rounded-lg p-4 min-h-[400px]">
              <img
                src={selectedDoc.fileUrl}
                alt="KYC document full view"
                className="max-h-[70vh] max-w-full object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
