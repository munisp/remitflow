import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Shield, Download, Trash2, AlertTriangle, Clock, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

// ─── Cooling-off countdown ────────────────────────────────────────────────────
function CoolingOffCountdown({ scheduledAt }: { scheduledAt: string | Date }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const target = new Date(scheduledAt).getTime();
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setRemaining("Erasure imminent");
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setRemaining(`${days}d ${hours}h ${mins}m`);
    };
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [scheduledAt]);

  return (
    <div className="flex items-center gap-2 text-amber-400">
      <Clock className="h-4 w-4 flex-shrink-0" />
      <span className="text-sm font-mono font-semibold">{remaining}</span>
      <span className="text-xs text-muted-foreground">until erasure</span>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function ErasureStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending:   { label: "Pending — Cooling Off", variant: "secondary" },
    executed:  { label: "Executed", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "outline" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function GDPRData() {
  const { t } = useTranslation();
  
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [reason, setReason] = useState("");

  const { data: overview } = trpc.gdpr.overview.useQuery();
  const { data: erasureStatus, refetch: refetchStatus } = trpc.gdpr.erasureStatus.useQuery();

  const exportData = trpc.gdpr.exportData.useMutation({
    onSuccess: (d: any) => {
      toast.success("Data export requested. Check your email.");
      if (d?.downloadUrl) window.open(d.downloadUrl, "_blank");
    },
    onError: (err) => toast.error("Export failed", { description: err.message }),
  });

  const requestErasure = trpc.gdpr.requestErasure.useMutation({
    onSuccess: (res) => {
      if (res.alreadyPending) {
        toast.warning("Erasure already pending", { description: res.message });
      } else {
        toast.success("Erasure request submitted", { description: res.message });
      }
      setShowRequestDialog(false);
      setReason("");
      refetchStatus();
    },
    onError: (err) => toast.error("Failed to submit erasure request", { description: err.message }),
  });

  const cancelErasure = trpc.gdpr.cancelErasure.useMutation({
    onSuccess: (res) => {
      toast.success("Erasure cancelled", { description: res.message });
      setShowCancelDialog(false);
      refetchStatus();
    },
    onError: (err) => toast.error("Failed to cancel erasure", { description: err.message }),
  });

  const d = (overview as any) ?? {};
  const req = (erasureStatus as any)?.request;
  const hasPending = (erasureStatus as any)?.hasPendingRequest;

  const DATA_CATEGORIES = [
    { label: "Personal Information", count: d.profileRecords ?? 1, desc: "Name, email, phone, address" },
    { label: "Transaction History", count: d.transactionRecords ?? 0, desc: "All transfers and payments" },
    { label: "KYC Documents", count: d.kycRecords ?? 0, desc: "Identity documents uploaded" },
    { label: "Consent Records", count: d.consentRecords ?? 0, desc: "Marketing and data preferences" },
    { label: "Audit Logs", count: d.auditRecords ?? 0, desc: "Login and security events (retained for AML/CFT compliance)" },
  ];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Your Data (GDPR)</h1>
            <p className="text-muted-foreground text-sm">View, export, or request permanent erasure of your personal data</p>
          </div>
        </div>

        {/* Legal notice */}
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
            <p><strong className="text-foreground">GDPR Article 17 — Right to Erasure ("Right to be Forgotten")</strong></p>
            <p>You may request deletion of your personal data. Financial transaction records are retained for 7 years under AML/CFT regulations and cannot be deleted. All other personal data will be anonymised within 30 days of your request.</p>
            <p>You have a <strong className="text-foreground">30-day cooling-off period</strong> to cancel your request before erasure is executed.</p>
          </CardContent>
        </Card>

        {/* Data categories */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Data Categories</CardTitle>
            <CardDescription className="text-xs">Data we hold about you across all services</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DATA_CATEGORIES.map(cat => (
              <div key={cat.label} className="flex items-center justify-between p-3 border rounded-xl">
                <div>
                  <div className="font-medium text-sm">{cat.label}</div>
                  <div className="text-xs text-muted-foreground">{cat.desc}</div>
                </div>
                <Badge variant="outline" className="text-xs">{cat.count} records</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Active erasure request status */}
        {req && (
          <Card className={`border-2 ${
            req.status === "pending" ? "border-amber-500/40 bg-amber-500/5" :
            req.status === "executed" ? "border-red-500/40 bg-red-500/5" :
            "border-border"
          }`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {req.status === "pending" && <Clock className="h-4 w-4 text-amber-400" />}
                  {req.status === "executed" && <CheckCircle2 className="h-4 w-4 text-red-400" />}
                  {req.status === "cancelled" && <XCircle className="h-4 w-4 text-muted-foreground" />}
                  Erasure Request
                </CardTitle>
                <ErasureStatusBadge status={req.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Requested</span>
                  <div className="font-medium">{new Date(req.requestedAt).toLocaleDateString()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Scheduled Erasure</span>
                  <div className="font-medium">{new Date(req.scheduledAt).toLocaleDateString()}</div>
                </div>
                {req.reason && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Reason</span>
                    <div className="font-medium">{req.reason}</div>
                  </div>
                )}
              </div>

              {req.status === "pending" && (
                <>
                  <CoolingOffCountdown scheduledAt={req.scheduledAt} />
                  <p className="text-xs text-muted-foreground">
                    You can cancel this request at any time before the scheduled erasure date.
                    After erasure, your personal data will be anonymised and cannot be recovered.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => setShowCancelDialog(true)}
                    disabled={cancelErasure.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Erasure Request
                  </Button>
                </>
              )}

              {req.status === "executed" && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  Your personal data has been anonymised. Regulatory records are retained as required by law.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => exportData.mutate()}
            disabled={exportData.isPending}
          >
            {exportData.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export My Data
          </Button>
          <Button
            variant="outline"
            className="w-full text-red-400 border-red-500/30 hover:bg-red-500/10"
            onClick={() => setShowRequestDialog(true)}
            disabled={hasPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {hasPending ? "Erasure Pending" : "Request Erasure"}
          </Button>
        </div>

        {/* Request erasure dialog */}
        <AlertDialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
                Request Data Erasure
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>
                  This will schedule permanent erasure of your personal data in <strong>30 days</strong>.
                  You can cancel within this cooling-off period.
                </p>
                <p className="text-xs">
                  <strong>What will be erased:</strong> Profile, contact details, preferences, KYC documents, device data.
                </p>
                <p className="text-xs text-amber-400">
                  <strong>What is retained:</strong> Financial transaction records are kept for 7 years under AML/CFT regulations. Audit logs are retained for compliance.
                </p>
                <Textarea
                  placeholder="Optional: reason for erasure request (e.g. no longer using the service)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-2 text-sm"
                  rows={3}
                />
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setShowRequestDialog(false); setReason(""); }}>
                Keep My Account
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => requestErasure.mutate({ reason: reason || undefined })}
                disabled={requestErasure.isPending}
              >
                {requestErasure.isPending ? "Submitting..." : "Schedule Erasure"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Cancel erasure dialog */}
        <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-amber-400" />
                Cancel Erasure Request
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to cancel your erasure request? Your account will remain active and no data will be deleted. You can submit a new erasure request at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Erasure Request</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => cancelErasure.mutate()}
                disabled={cancelErasure.isPending}
              >
                {cancelErasure.isPending ? "Cancelling..." : "Yes, Cancel Erasure"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </DashboardLayout>
  );
}
