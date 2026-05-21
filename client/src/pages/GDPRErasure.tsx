import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Trash2, Shield, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function GDPRErasure() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [requestType, setRequestType] = useState<"erasure" | "portability" | "restriction">("erasure");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { data: requests, refetch } = trpc.v98.gdpr.listMyRequests.useQuery();

  const submitRequest = trpc.v98.gdpr.submitRequest.useMutation({
    onSuccess: (d) => {
      toast.success('Request submitted');
      setConfirmOpen(false);
      setReason("");
      setConfirmText("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelRequest = trpc.v98.gdpr.cancelRequest.useMutation({
    onSuccess: () => {
      toast.success('Request cancelled');
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const REQUEST_TYPE_INFO = {
    erasure: {
      title: "Right to Erasure (Right to be Forgotten)",
      description: "Request deletion of all your personal data from our systems. This includes your profile, transaction history, and associated records.",
      warning: "This action is irreversible. Once completed, your account and all associated data will be permanently deleted.",
      icon: Trash2,
      color: "text-red-500",
    },
    portability: {
      title: "Right to Data Portability",
      description: "Request a copy of all your personal data in a machine-readable format (JSON/CSV).",
      warning: "Your data export will be ready within 30 days and sent to your registered email.",
      icon: Shield,
      color: "text-blue-500",
    },
    restriction: {
      title: "Right to Restriction of Processing",
      description: "Request that we restrict how we process your personal data while you contest its accuracy or object to processing.",
      warning: "Your account will be placed in restricted mode. You may not be able to use all features.",
      icon: Clock,
      color: "text-yellow-500",
    },
  };

  const info = REQUEST_TYPE_INFO[requestType];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Privacy & Data Rights</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Exercise your GDPR rights — Article 17 (Erasure), Article 20 (Portability), Article 18 (Restriction)
        </p>
      </div>

      {/* Request Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Submit a Data Rights Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Request Type</Label>
            <Select value={requestType} onValueChange={(v) => setRequestType(v as any)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="erasure">Right to Erasure (Delete my data)</SelectItem>
                <SelectItem value="portability">Right to Portability (Export my data)</SelectItem>
                <SelectItem value="restriction">Right to Restriction (Limit processing)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Info Box */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <info.icon className={`h-5 w-5 ${info.color}`} />
              <p className="font-medium text-sm">{info.title}</p>
            </div>
            <p className="text-sm text-muted-foreground">{info.description}</p>
            <div className="flex items-start gap-2 mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 rounded border border-yellow-200 dark:border-yellow-800">
              <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-700 dark:text-yellow-300">{info.warning}</p>
            </div>
          </div>

          <div>
            <Label>Reason (optional)</Label>
            <Textarea
              placeholder="Please describe why you are making this request..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>

          <Button
            variant={requestType === "erasure" ? "destructive" : "default"}
            onClick={() => setConfirmOpen(true)}
          >
            <info.icon className="h-4 w-4 mr-2" />
            Submit {requestType.charAt(0).toUpperCase() + requestType.slice(1)} Request
          </Button>
        </CardContent>
      </Card>

      {/* Existing Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Data Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {!requests?.length ? (
            <div className="text-center py-6 text-muted-foreground">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-30 text-green-500" />
              <p className="text-sm">No requests submitted yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm capitalize">{r.requestType}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Ref #{r.id} · Submitted {new Date(r.createdAt).toLocaleDateString()}
                      {r.completedAt && ` · Completed ${new Date(r.completedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  {r.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => cancelRequest.mutate({ id: r.id })}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirm {requestType.charAt(0).toUpperCase() + requestType.slice(1)} Request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">{info.warning}</p>
            {requestType === "erasure" && (
              <div>
                <Label>Type "DELETE MY DATA" to confirm</Label>
                <input
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="DELETE MY DATA"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={requestType === "erasure" ? "destructive" : "default"}
                className="flex-1"
                disabled={
                  submitRequest.isPending ||
                  (requestType === "erasure" && confirmText !== "DELETE MY DATA")
                }
                onClick={() => submitRequest.mutate({ requestType, reason: reason || undefined })}
              >
                {submitRequest.isPending ? "Submitting..." : "Confirm Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
