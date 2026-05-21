import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle, CheckCircle, Clock, RefreshCw, Search, Shield, XCircle,
  FileText, Image as ImageIcon, Download, MessageSquare, Paperclip, Copy, Check,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  under_review: "secondary",
  resolved: "default",
  closed: "outline",
};

const REASON_LABELS: Record<string, string> = {
  unauthorized: "Unauthorized",
  duplicate: "Duplicate",
  not_received: "Not Received",
  wrong_amount: "Wrong Amount",
  other: "Other",
};

// ─── Inline Evidence Viewer ────────────────────────────────────────────────────
function EvidenceViewer({ evidenceUrl, evidenceType }: { evidenceUrl?: string | null; evidenceType?: string | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!evidenceUrl) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded p-3">
        <Paperclip className="h-4 w-4 opacity-50" />
        <span>No evidence attached</span>
      </div>
    );
  }

  const isPdf = evidenceType?.includes("pdf") || evidenceUrl.toLowerCase().endsWith(".pdf");
  const isImage = !isPdf && (
    evidenceType?.startsWith("image/") ||
    /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(evidenceUrl)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {isPdf ? <FileText className="h-4 w-4 text-red-500" /> : <ImageIcon className="h-4 w-4 text-blue-500" />}
          <span>{isPdf ? "PDF Evidence" : "Image Evidence"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Collapse" : "View Inline"}
          </Button>
          <a href={evidenceUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Download className="h-3 w-3 mr-1" />
              Open
            </Button>
          </a>
        </div>
      </div>

      {expanded && (
        <div className="rounded-lg border overflow-hidden bg-muted/20">
          {isPdf ? (
            <iframe
              src={evidenceUrl}
              className="w-full h-96 border-0"
              title="Dispute Evidence PDF"
            />
          ) : isImage ? (
            <img
              src={evidenceUrl}
              alt="Dispute Evidence"
              className="w-full max-h-96 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                toast.error("Failed to load evidence image");
              }}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              <Paperclip className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Preview not available for this file type.</p>
              <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Download to view
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SMS Status Badge ──────────────────────────────────────────────────────────
function SmsBadge({ sent }: { sent?: boolean }) {
  if (sent === undefined) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <MessageSquare className={`h-3.5 w-3.5 ${sent ? "text-emerald-500" : "text-muted-foreground"}`} />
      <span className={sent ? "text-emerald-600" : "text-muted-foreground"}>
        {sent ? "SMS sent to user" : "SMS not sent"}
      </span>
    </div>
  );
}

// ─── Copy-to-clipboard button ─────────────────────────────────────────────────
function CopyIdButton({ value, label }: { value: string | number | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value && value !== 0) return null;
  const handleCopy = () => {
    navigator.clipboard.writeText(String(value)).then(() => {
      setCopied(true);
      toast.success(`${label ?? "ID"} copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error("Clipboard access denied"));
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 w-6 p-0 ml-1 opacity-60 hover:opacity-100"
      onClick={handleCopy}
      title={`Copy ${label ?? "ID"}`}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export default function AdminDisputes() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "under_review" | "resolved" | "closed">("all");
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);
  const [resolution, setResolution] = useState("");
  const [newStatus, setNewStatus] = useState<"under_review" | "resolved" | "closed">("under_review");
  const [lastSmsSent, setLastSmsSent] = useState<boolean | undefined>(undefined);

  const { data: stats, isLoading: loadingStats } = trpc.transferDispute.adminStats.useQuery(
    undefined,
    { enabled: user?.role === "admin", refetchInterval: 30_000 }
  );

  const { data: disputeData, isLoading: loadingDisputes, refetch } = trpc.transferDispute.adminList.useQuery(
    { status: statusFilter, limit: 50, offset: 0 },
    { enabled: user?.role === "admin", refetchInterval: 30_000 }
  );

  const updateMutation = trpc.transferDispute.adminUpdate.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Dispute updated to ${newStatus}`);
      setLastSmsSent(data?.smsSent);
      setSelectedDispute(null);
      setResolution("");
      utils.transferDispute.adminList.invalidate();
      utils.transferDispute.adminStats.invalidate();
    },
    onError: (err) => toast.error(err.message || "Update failed"),
  });

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const disputes = (disputeData?.disputes ?? []) as any[];
  const total = disputeData?.total ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Transfer Disputes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and resolve user-raised transfer disputes
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSmsSent !== undefined && (
            <SmsBadge sent={lastSmsSent} />
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {loadingStats ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : (
          <>
            <Card className="border-red-200 dark:border-red-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Open</p>
                    <p className="text-2xl font-bold text-red-500">{stats?.open ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-amber-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Under Review</p>
                    <p className="text-2xl font-bold text-amber-500">{stats?.under_review ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Resolved</p>
                    <p className="text-2xl font-bold text-emerald-500">{stats?.resolved ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <XCircle className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Resolution</p>
                    <p className="text-2xl font-bold">{stats?.avgResolutionHours ?? 0}h</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Filter + table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Disputes ({total})
            </CardTitle>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadingDisputes ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : disputes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No disputes found for this filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4">ID</th>
                    <th className="text-left py-2 pr-4">User</th>
                    <th className="text-left py-2 pr-4">Reason</th>
                    <th className="text-left py-2 pr-4">Transaction</th>
                    <th className="text-left py-2 pr-4">Evidence</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Raised</th>
                    <th className="text-right py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.map((d: any) => (
                    <tr key={d.id} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs">#{d.id}</td>
                      <td className="py-3 pr-4">
                        <div>
                          <p className="font-medium truncate max-w-[140px]">{d.user_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[140px]">{d.user_email ?? ""}</p>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="outline" className="text-xs">
                          {REASON_LABELS[d.type] ?? d.type}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {d.transactionId ? (
                          <span>
                            #{d.transactionId}
                            {d.from_currency && (
                              <span className="text-muted-foreground ml-1">
                                {d.from_currency} {Number(d.from_amount ?? 0).toLocaleString()}
                              </span>
                            )}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        {d.evidenceUrl ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Paperclip className="h-3 w-3" />
                            Attached
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={STATUS_COLORS[d.status] ?? "outline"}>
                          {d.status?.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedDispute(d);
                            setNewStatus(d.status === "open" ? "under_review" : "resolved");
                            setResolution(d.resolution ?? "");
                            setLastSmsSent(undefined);
                          }}
                          disabled={d.status === "closed"}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review dialog with inline evidence viewer */}
      <Dialog open={!!selectedDispute} onOpenChange={(open) => { if (!open) { setSelectedDispute(null); setLastSmsSent(undefined); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1">
              Review Dispute #{selectedDispute?.id}
              <CopyIdButton value={selectedDispute?.id} label="Dispute ID" />
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="details" className="mt-2">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
              <TabsTrigger value="evidence" className="flex-1">
                Evidence
                {selectedDispute?.evidenceUrl && (
                  <Badge variant="secondary" className="ml-2 text-xs px-1.5 py-0">1</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="resolve" className="flex-1">Resolve</TabsTrigger>
            </TabsList>

            {/* Details tab */}
            <TabsContent value="details" className="space-y-4 pt-2">
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">User</p>
                    <p className="font-medium">{selectedDispute?.user_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{selectedDispute?.user_email ?? ""}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Transaction</p>
                    <div className="flex items-center">
                      <p className="font-medium font-mono">#{selectedDispute?.transactionId ?? "—"}</p>
                      <CopyIdButton value={selectedDispute?.transactionId} label="Transaction ID" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedDispute?.from_currency} {Number(selectedDispute?.from_amount ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Reason</p>
                    <Badge variant="outline" className="text-xs mt-1">
                      {REASON_LABELS[selectedDispute?.type] ?? selectedDispute?.type}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Current Status</p>
                    <Badge variant={STATUS_COLORS[selectedDispute?.status] ?? "outline"} className="mt-1">
                      {selectedDispute?.status?.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">User Description</p>
                <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                  {selectedDispute?.description ?? "No description provided."}
                </p>
              </div>
              {selectedDispute?.resolution && (
                <div>
                  <p className="text-sm font-medium mb-2">Previous Resolution Notes</p>
                  <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap">
                    {selectedDispute.resolution}
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Evidence tab */}
            <TabsContent value="evidence" className="space-y-4 pt-2">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Paperclip className="h-4 w-4" />
                  <span>Evidence submitted by user</span>
                </div>
                <EvidenceViewer
                  evidenceUrl={selectedDispute?.evidenceUrl}
                  evidenceType={selectedDispute?.evidenceType}
                />
                {selectedDispute?.evidenceUrl && (
                  <p className="text-xs text-muted-foreground">
                    Uploaded: {selectedDispute?.evidenceUploadedAt
                      ? new Date(selectedDispute.evidenceUploadedAt).toLocaleString()
                      : "Unknown date"}
                  </p>
                )}
              </div>
            </TabsContent>

            {/* Resolve tab */}
            <TabsContent value="resolve" className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Update Status</label>
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  An SMS notification will be sent to the user when status changes.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Resolution Notes</label>
                <Textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="Describe the outcome or action taken…"
                  rows={4}
                  className="resize-none"
                />
              </div>
              {lastSmsSent !== undefined && (
                <div className="rounded-lg border p-3">
                  <SmsBadge sent={lastSmsSent} />
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setSelectedDispute(null); setLastSmsSent(undefined); }}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                updateMutation.mutate({
                  disputeId: selectedDispute.id,
                  status: newStatus,
                  resolution: resolution || undefined,
                })
              }
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
