import { toast } from 'sonner';
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, BellOff, Clock, CheckCircle, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  triggered: "bg-green-100 text-green-700",
  snoozed: "bg-yellow-100 text-yellow-700",
  dismissed: "bg-gray-100 text-gray-700",
};

export default function RateAlertHistoryPage() {
  const utils = trpc.useUtils();
  const [snoozeHours, setSnoozeHours] = useState<Record<number, string>>({});

  const { data, isLoading } = trpc.rateAlertHistory.list.useQuery();
  const { data: statsData } = trpc.rateAlertHistory.stats.useQuery();

  const snoozeMutation = trpc.rateAlertHistory.snooze.useMutation({
    onSuccess: (r) => {
      toast.success(`Alert snoozed until ${format(new Date(r.snoozedUntil!), "MMM d, h:mm a")}`);
      utils.rateAlertHistory.list.invalidate();
      utils.rateAlertHistory.stats.invalidate();
    },
  });

  const dismissMutation = trpc.rateAlertHistory.dismiss.useMutation({
    onSuccess: () => {
      toast.success("Alert dismissed");
      utils.rateAlertHistory.list.invalidate();
      utils.rateAlertHistory.stats.invalidate();
    },
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="w-6 h-6 text-amber-500" /> Rate Alert History</h1>
          <p className="text-muted-foreground text-sm mt-1">Track when your target exchange rates were hit and manage notifications</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Alerts", value: statsData?.total ?? 0, icon: <BarChart2 className="w-5 h-5 text-blue-500" /> },
            { label: "Triggered", value: statsData?.triggered ?? 0, icon: <CheckCircle className="w-5 h-5 text-green-500" /> },
            { label: "Snoozed", value: statsData?.snoozed ?? 0, icon: <Clock className="w-5 h-5 text-yellow-500" /> },
            { label: "Dismissed", value: statsData?.dismissed ?? 0, icon: <BellOff className="w-5 h-5 text-gray-500" /> },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Alert History */}
        <Card>
          <CardHeader><CardTitle>Alert History</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading history...</div>
            ) : !data?.history.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No rate alerts triggered yet.</p>
                <p className="text-sm mt-1">Set up rate alerts in the FX Alerts page to get notified when your target rate is hit.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.history.map((alert: any) => (
                  <div key={alert.id} className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/30 transition-colors">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${alert.direction === "above" ? "bg-green-100" : "bg-red-100"}`}>
                      {alert.direction === "above" ? <TrendingUp className="w-5 h-5 text-green-600" /> : <TrendingDown className="w-5 h-5 text-red-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{alert.fromCurrency} → {alert.toCurrency}</p>
                        <Badge className={`text-xs ${statusColor[alert.status]}`}>{alert.status}</Badge>
                        {alert.notificationSent && <Badge variant="outline" className="text-xs">Notified</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Target: {Number(alert.targetRate).toFixed(4)} · Actual: <span className="font-medium text-foreground">{Number(alert.actualRate).toFixed(4)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{format(new Date(alert.triggeredAt), "MMM d, yyyy 'at' h:mm a")}</p>
                      {alert.snoozedUntil && (
                        <p className="text-xs text-yellow-600">Snoozed until {format(new Date(alert.snoozedUntil), "MMM d, h:mm a")}</p>
                      )}
                    </div>
                    {alert.status === "triggered" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Select value={snoozeHours[alert.id] ?? "24"} onValueChange={v => setSnoozeHours(h => ({ ...h, [alert.id]: v }))}>
                          <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 hour</SelectItem>
                            <SelectItem value="6">6 hours</SelectItem>
                            <SelectItem value="24">24 hours</SelectItem>
                            <SelectItem value="72">3 days</SelectItem>
                            <SelectItem value="168">1 week</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                          onClick={() => snoozeMutation.mutate({ alertHistoryId: alert.id, snoozeHours: Number(snoozeHours[alert.id] ?? 24) })}>
                          <Clock className="w-3 h-3" /> Snooze
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground"
                          onClick={() => dismissMutation.mutate({ alertHistoryId: alert.id })}>
                          <BellOff className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
