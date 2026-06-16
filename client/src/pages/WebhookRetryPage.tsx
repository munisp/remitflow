import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, AlertCircle, CheckCircle, Clock, Zap } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  delivered: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  retrying: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function WebhookRetryPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const { data: statsData } = trpc.webhooks.listDeliveries.useQuery({ endpointId: 0, limit: 1 });
  const deliveriesQuery = trpc.webhooks.listDeliveries.useQuery({
    endpointId: 0,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const retryMutation = trpc.webhookRetry.queueRetry.useMutation({
    onSuccess: (data) => {
      toast(data.success ? "Delivery succeeded" : `Retry failed: ${data.message}`);
      deliveriesQuery.refetch();
      deliveriesQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkRetryMutation = trpc.webhookRetry.processPending.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.processed} deliveries queued for retry`);
      setSelectedIds([]);
      deliveriesQuery.refetch();
      deliveriesQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsData;
  const deliveries = deliveriesQuery.data?.deliveries ?? [];
  const total = deliveriesQuery.data?.total ?? 0;

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Webhook Retry Queue</h1>
          <p className="text-muted-foreground text-sm mt-1">Monitor and retry failed webhook deliveries</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { deliveriesQuery.refetch(); deliveriesQuery.refetch(); }}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total", value: total, icon: Zap, color: "text-purple-400" },
          { label: "Pending", value: 0, icon: Clock, color: "text-yellow-400" },
          { label: "Failed", value: 0, icon: AlertCircle, color: "text-red-400" },
          { label: "Retrying", value: 0, icon: RefreshCw, color: "text-blue-400" },
          { label: "Delivered", value: 0, icon: CheckCircle, color: "text-green-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters + Bulk Actions */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
          </SelectContent>
        </Select>
        {selectedIds.length > 0 && (
          <Button size="sm" onClick={() => bulkRetryMutation.mutate()}
            disabled={bulkRetryMutation.isPending}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry {selectedIds.length} Selected
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Deliveries ({total})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left w-8">
                    <input type="checkbox" className="rounded"
                      checked={selectedIds.length === deliveries.length && deliveries.length > 0}
                      onChange={(e) => setSelectedIds(e.target.checked ? deliveries.map((d: any) => d.id) : [])} />
                  </th>
                  <th className="p-3 text-left">ID</th>
                  <th className="p-3 text-left">Event Type</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Attempts</th>
                  <th className="p-3 text-left">Response</th>
                  <th className="p-3 text-left">Created</th>
                  <th className="p-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deliveriesQuery.isPending ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : deliveries.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No deliveries found</td></tr>
                ) : deliveries.map((d: any) => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <input type="checkbox" className="rounded" checked={selectedIds.includes(d.id)}
                        onChange={() => toggleSelect(d.id)} />
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">#{d.id}</td>
                    <td className="p-3 font-mono text-xs">{d.eventType}</td>
                    <td className="p-3">
                      <Badge className={STATUS_COLORS[d.status ?? "pending"]}>{d.status}</Badge>
                    </td>
                    <td className="p-3 text-center">{d.attemptCount}</td>
                    <td className="p-3 text-xs text-muted-foreground">{d.responseStatus ?? "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      {d.status !== "delivered" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => retryMutation.mutate({ deliveryId: Number(d.id), endpointId: Number(d.endpointId ?? 0), payload: (d.payload ?? {}) as Record<string, string> })}
                          disabled={retryMutation.isPending}>
                          <RefreshCw className="w-3 h-3 mr-1" /> Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
