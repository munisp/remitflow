import { useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowLeft, CheckCircle, FileText, Upload, Paperclip, RefreshCw, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
type AllowedMime = typeof ALLOWED_MIME[number];

const REASON_LABELS: Record<string, string> = {
  unauthorized: "Unauthorized Transaction",
  duplicate: "Duplicate Charge",
  not_received: "Funds Not Received",
  wrong_amount: "Wrong Amount",
  other: "Other Issue",
};

const REASON_HINTS: Record<string, string> = {
  unauthorized: "I did not authorise this transfer. Someone may have accessed my account without permission.",
  duplicate: "This transfer was charged twice. I can see two identical transactions in my history.",
  not_received: "The recipient has not received the funds despite the transfer showing as completed.",
  wrong_amount: "The amount debited does not match the amount I intended to send.",
  other: "Please describe the issue in detail below.",
};

export default function TransferDisputeForm() {
  const [, params] = useRoute("/transfers/:id/dispute");
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const transactionId = Number((params as any)?.id ?? 0);

  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState<string>("");
  const [evidenceFileName, setEvidenceFileName] = useState<string>("");
  const [evidenceMimeType, setEvidenceMimeType] = useState<string>("");
  const [evidenceLocalPreview, setEvidenceLocalPreview] = useState<string>("");  // data URL for image thumbnail
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [disputeId, setDisputeId] = useState<number | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load transaction details for context
  const { data: txData, isLoading: loadingTx } = trpc.transfers.list.useQuery(
    { limit: 100, offset: 0 },
    { enabled: !!user }
  );
  const transaction = ((txData as any)?.transfers as unknown as any[] ?? (txData as unknown as any[]) ?? [])?.find((t: any) => t.id === transactionId);

  const uploadEvidenceMutation = trpc.transferDispute.uploadEvidenceFile.useMutation({
    onSuccess: (data) => {
      setEvidenceUrl(data.url);
      setEvidenceFileName(data.fileName);
      setUploading(false);
      setUploadProgress(100);
      toast.success(`Evidence uploaded: ${data.fileName}`);
    },
    onError: (err) => {
      setUploading(false);
      setUploadProgress(0);
      toast.error(err.message || "Failed to upload evidence");
    },
  });

  const raiseMutation = trpc.transferDispute.raise.useMutation({
    onSuccess: (data) => {
      setDisputeId(data.disputeId);
      setSubmitted(true);
      toast.success("Dispute submitted successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to submit dispute");
    },
  });

  const refundMutation = trpc.transferDispute.requestRefund.useMutation({
    onSuccess: (data) => {
      toast.success(`Refund request #${data.refundId} submitted. Processing in 3–5 business days.`);
      setShowRefund(false);
      setRefundReason("");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to submit refund request");
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 10 MB.");
      return;
    }
    if (!ALLOWED_MIME.includes(file.type as AllowedMime)) {
      toast.error("Only JPEG, PNG, WebP, or PDF files are accepted.");
      return;
    }
    setUploading(true);
    setUploadProgress(10);
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadProgress(Math.round((ev.loaded / ev.total) * 60) + 10);
      }
    };
    reader.onload = () => {
      setUploadProgress(75);
      const base64 = (reader.result as string).split(",")[1];
      uploadEvidenceMutation.mutate({
        fileBase64: base64,
        fileName: file.name,
        mimeType: file.type as AllowedMime,
      });
    };
    reader.onerror = () => {
      toast.error("Failed to read file");
      setUploading(false);
      setUploadProgress(0);
    };
    // Store local preview for image types
    if (file.type.startsWith("image/")) {
      const previewReader = new FileReader();
      previewReader.onload = (ev) => setEvidenceLocalPreview(ev.target?.result as string ?? "");
      previewReader.readAsDataURL(file);
    } else {
      setEvidenceLocalPreview("");
    }
    setEvidenceMimeType(file.type);
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { toast.error("Please select a reason"); return; }
    if (description.length < 10) { toast.error("Please provide more detail (at least 10 characters)"); return; }
    raiseMutation.mutate({
      transactionId,
      reason: reason as any,
      description,
      ...(evidenceUrl ? { evidenceUrl } : {}),
    });
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please log in to raise a dispute.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-bold">Dispute Submitted</h2>
            <p className="text-muted-foreground text-sm">
              Your dispute #{disputeId} has been submitted. Our compliance team will review it within
              2 business days and notify you by SMS and email when the status changes.
            </p>
            {transaction && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg text-sm text-left">
                <p className="font-medium mb-1">Transaction #{transactionId}</p>
                <p className="text-muted-foreground text-xs">
                  {transaction.from_currency} {Number(transaction.from_amount ?? 0).toLocaleString()}
                  {transaction.to_currency ? ` → ${transaction.to_currency}` : ""}
                </p>
              </div>
            )}
            {/* Refund option */}
            {!showRefund ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowRefund(true)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Also Request a Refund
              </Button>
            ) : (
              <div className="text-left space-y-3 mt-2">
                <p className="text-sm font-medium">Refund Request</p>
                <Textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Briefly explain why you are requesting a refund…"
                  rows={3}
                  className="resize-none text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowRefund(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={refundMutation.isPending || refundReason.length < 10}
                    onClick={() => refundMutation.mutate({
                      transactionId,
                      disputeId: disputeId ?? undefined,
                      reason: refundReason,
                    })}
                  >
                    {refundMutation.isPending ? "Submitting…" : "Submit Refund"}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={() => navigate("/transfers")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                My Transfers
              </Button>
              <Button onClick={() => navigate("/support/tickets")}>
                <FileText className="h-4 w-4 mr-2" />
                View Support Tickets
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/transfers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Raise a Transfer Dispute
          </h1>
          <p className="text-sm text-muted-foreground">
            Transaction #{transactionId} — our team will review within 2 business days
          </p>
        </div>
      </div>

      {/* Transaction summary */}
      {loadingTx ? (
        <Skeleton className="h-20 w-full" />
      ) : transaction ? (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-medium">Transaction Details</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {transaction.from_currency} {Number(transaction.from_amount ?? 0).toLocaleString()}
                  {transaction.to_currency ? ` → ${transaction.to_currency}` : ""}
                  {transaction.to_country ? ` (${transaction.to_country})` : ""}
                </p>
              </div>
              <Badge variant={transaction.status === "completed" ? "default" : "secondary"}>
                {transaction.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-destructive/30">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Transaction #{transactionId}</p>
          </CardContent>
        </Card>
      )}

      {/* Dispute form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispute Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Reason */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason for Dispute *</label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REASON_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reason && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  {REASON_HINTS[reason]}
                </p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Description *
                <span className="text-muted-foreground font-normal ml-1">
                  ({description.length}/2000 characters)
                </span>
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe the issue in detail. Include dates, amounts, and any relevant reference numbers…"
                rows={5}
                maxLength={2000}
                className="resize-none"
              />
            </div>

            {/* Evidence upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Evidence
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
              {uploading && (
                <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    <span className="text-sm text-muted-foreground">Uploading to secure storage…</span>
                  </div>
                  <Progress value={uploadProgress} className="h-1.5" />
                </div>
              )}
              {!uploading && evidenceFileName ? (
                <div className="space-y-2">
                  {/* Thumbnail preview for images */}
                  {evidenceLocalPreview && evidenceMimeType.startsWith("image/") && (
                    <div className="relative w-full max-h-40 overflow-hidden rounded-lg border border-emerald-200 dark:border-emerald-800 bg-muted/30">
                      <img
                        src={evidenceLocalPreview}
                        alt="Evidence preview"
                        className="w-full object-contain max-h-40"
                      />
                      <div className="absolute top-2 right-2">
                        <Badge className="bg-emerald-600 text-white text-xs">Preview</Badge>
                      </div>
                    </div>
                  )}
                  {/* PDF badge */}
                  {evidenceMimeType === "application/pdf" && (
                    <div className="flex items-center gap-2 p-2 bg-muted/30 border rounded-lg">
                      <FileText className="h-5 w-5 text-red-500 shrink-0" />
                      <span className="text-sm text-muted-foreground">PDF document ready to submit</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                    <Paperclip className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="text-sm text-emerald-700 dark:text-emerald-400 truncate flex-1">{evidenceFileName}</span>
                    <Badge variant="secondary" className="text-xs shrink-0">Uploaded ✓</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => { setEvidenceUrl(""); setEvidenceFileName(""); setUploadProgress(0); setEvidenceLocalPreview(""); setEvidenceMimeType(""); }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : !uploading ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Attach screenshot, receipt, or PDF (max 10 MB)
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Accepted: JPEG, PNG, WebP, PDF. Evidence is stored securely and helps our team resolve disputes faster.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/transfers")}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={raiseMutation.isPending || uploading || !reason || description.length < 10}
              >
                {raiseMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</>
                  : "Submit Dispute"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Policy note */}
      <p className="text-xs text-muted-foreground text-center">
        Disputes are reviewed by our compliance team. You will receive an SMS notification when your
        dispute status changes. Submitting a false dispute may result in account suspension.
        For urgent issues, contact support directly.
      </p>
    </div>
  );
}
