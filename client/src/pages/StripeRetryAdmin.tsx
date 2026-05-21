import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, CreditCard, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const EVENT_COLORS: Record<string, string> = {
  "checkout.session.completed": "text-green-500",
  "payment_intent.succeeded": "text-green-500",
  "payment_intent.payment_failed": "text-red-500",
  "customer.subscription.created": "text-blue-500",
  "customer.subscription.deleted": "text-orange-500",
  "invoice.paid": "text-green-500",
  "invoice.payment_failed": "text-red-500",
};

export default function StripeRetryAdmin() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("");

  const { data: webhooks, refetch } = trpc.v98.stripeAdmin.listWebhooks.useQuery({
    status: statusFilter || undefined,
    limit: 50,
  });
  const { data: stats } = trpc.v98.stripeAdmin.webhookStats.useQuery();

  const retry = trpc.v98.stripeAdmin.retryWebhook.useMutation({
    onSuccess: (d) => {
      toast.success(d.message);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const retryAll = trpc.v98.stripeAdmin.retryAllFailed.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.queued} webhooks queued for retry`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stripe Webhook Admin</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor and retry failed Stripe webhook events
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => retryAll.mutate()}
          disabled={retryAll.isPending || (stats?.failed ?? 0) === 0}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${retryAll.isPending ? "animate-spin" : ""}`} />
          Retry All Failed ({stats?.failed ?? 0})
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Events", value: stats?.total ?? 0, icon: CreditCard, color: "text-foreground" },
          { label: "Delivered", value: stats?.delivered ?? 0, icon: CheckCircle, color: "text-green-500" },
          { label: "Failed", value: stats?.failed ?? 0, icon: AlertTriangle, color: "text-red-500" },
          { label: "Pending", value: stats?.pending ?? 0, icon: Clock, color: "text-yellow-500" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <s.icon className={`h-5 w-5 ${s.color}`} />
                <div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Webhook Events Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Webhook Events</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {!webhooks?.events.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-30 text-green-500" />
              <p>No webhook events found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3">Event ID</th>
                    <th className="text-left pr-3">Type</th>
                    <th className="text-left pr-3">Status</th>
                    <th className="text-right pr-3">Attempts</th>
                    <th className="text-left pr-3">Last Error</th>
                    <th className="text-left pr-3">Received</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.events.map((ev: any) => (
                    <tr key={ev.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-3 font-mono text-xs max-w-[120px] truncate">{ev.stripeEventId}</td>
                      <td className="pr-3">
                        <span className={`text-xs font-medium ${EVENT_COLORS[ev.eventType] ?? "text-foreground"}`}>
                          {ev.eventType}
                        </span>
                      </td>
                      <td className="pr-3">
                        <Badge
                          variant={ev.status === "delivered" ? "default" : ev.status === "failed" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {ev.status}
                        </Badge>
                      </td>
                      <td className="text-right pr-3">{ev.attemptCount}</td>
                      <td className="pr-3 text-xs text-muted-foreground max-w-[150px] truncate">
                        {ev.lastError ?? "—"}
                      </td>
                      <td className="pr-3 text-xs text-muted-foreground">
                        {new Date(ev.receivedAt).toLocaleString()}
                      </td>
                      <td className="text-right">
                        {ev.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate({ id: ev.id })}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Retry
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
    </div>
  

    </DashboardLayout>

  );
}
