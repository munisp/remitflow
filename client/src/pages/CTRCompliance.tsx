import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, FileText, Flag, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const STATUS_COLORS: Record<string, string> = {
  pending_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  filed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  dismissed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  escalated: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const FLAG_REASON_LABELS: Record<string, string> = {
  amount_threshold: ">$10,000 USD threshold",
  structuring_pattern: "Structuring pattern detected",
  velocity_breach: "Velocity rule breach",
};

export default function CTRCompliance() {
  const [statusFilter, setStatusFilter] = useState("");
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"filed" | "dismissed" | "escalated">("filed");
  const [reviewNotes, setReviewNotes] = useState("");

  const { data: statsRaw } = trpc.v98.ctr.stats.useQuery();
  const stats = statsRaw as any;
  const { data: flagsData, refetch } = trpc.v98.ctr.list.useQuery({
    status: statusFilter || undefined,
    limit: 50,
  });
  const reviewMutation = trpc.v98.ctr.review.useMutation({
    onSuccess: () => {
      toast.success(`Marked as ${reviewStatus}`);
      setReviewId(null);
      setReviewNotes("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedFlag = (flagsData as any)?.rows.find((f) => f.id === reviewId);

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">CTR Compliance</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Currency Transaction Reports — Auto-flagged transactions exceeding $10,000 USD
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Flags", value: stats?.total ?? 0, color: "text-foreground", icon: Flag },
          { label: "Pending Review", value: stats?.pending ?? 0, color: "text-yellow-500", icon: AlertTriangle },
          { label: "Filed", value: stats?.filed ?? 0, color: "text-blue-500", icon: FileText },
          { label: "Dismissed", value: stats?.dismissed ?? 0, color: "text-gray-500", icon: CheckCircle },
          { label: "Escalated", value: stats?.escalated ?? 0, color: "text-red-500", icon: TrendingUp },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <div>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter + Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">CTR Flags</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="pending_review">Pending</SelectItem>
              <SelectItem value="filed">Filed</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {!(flagsData as any)?.rows.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-30 text-green-500" />
              <p>No CTR flagsData found for the selected filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3">ID</th>
                    <th className="text-left pr-3">User</th>
                    <th className="text-right pr-3">Amount</th>
                    <th className="text-right pr-3">USD Equiv.</th>
                    <th className="text-left pr-3">Reason</th>
                    <th className="text-left pr-3">Status</th>
                    <th className="text-left pr-3">Date</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flagsData.rows.map((f) => (
                    <tr key={f.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-3 font-mono text-xs">#{f.id}</td>
                      <td className="pr-3 text-xs">User #{f.userId}</td>
                      <td className="text-right pr-3 font-medium">
                        {Number(f.amount).toLocaleString()} {f.currency}
                      </td>
                      <td className="text-right pr-3 text-muted-foreground">
                        ${Number(f.amountUsd ?? 0).toLocaleString()}
                      </td>
                      <td className="pr-3">
                        <span className="text-xs text-orange-600 dark:text-orange-400">
                          {FLAG_REASON_LABELS[f.flagReason] ?? f.flagReason}
                        </span>
                      </td>
                      <td className="pr-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[f.status] ?? ""}`}>
                          {f.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="pr-3 text-xs text-muted-foreground">
                        {new Date(f.createdAt).toLocaleDateString()}
                      </td>
                      <td className="text-right">
                        {f.status === "pending_review" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setReviewId(f.id)}
                          >
                            Review
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={reviewId !== null} onOpenChange={(o) => !o && setReviewId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review CTR Flag #{reviewId}</DialogTitle>
          </DialogHeader>
          {selectedFlag && (
            <div className="space-y-4 mt-2">
              <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Amount:</span> {Number(selectedFlag.amount).toLocaleString()} {selectedFlag.currency} (≈${Number(selectedFlag.amountUsd ?? 0).toLocaleString()} USD)</p>
                <p><span className="text-muted-foreground">Reason:</span> {FLAG_REASON_LABELS[selectedFlag.flagReason] ?? selectedFlag.flagReason}</p>
                <p><span className="text-muted-foreground">Transaction:</span> #{selectedFlag.transactionId}</p>
                <p><span className="text-muted-foreground">Flagged:</span> {new Date(selectedFlag.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <label className="text-sm font-medium">Decision</label>
                <Select value={reviewStatus} onValueChange={(v) => setReviewStatus(v as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="filed">File CTR Report</SelectItem>
                    <SelectItem value="dismissed">Dismiss (false positive)</SelectItem>
                    <SelectItem value="escalated">Escalate to SAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  className="mt-1"
                  placeholder="Add review notes..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => reviewMutation.mutate({ id: reviewId!, status: reviewStatus, notes: reviewNotes })}
                disabled={reviewMutation.isPending}
              >
                {reviewMutation.isPending ? "Submitting..." : "Submit Review"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
