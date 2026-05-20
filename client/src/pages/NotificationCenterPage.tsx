import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Bell, BellOff, Check, CheckCheck, Trash2, Settings } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const TYPE_COLORS: Record<string, string> = {
  transfer: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  security: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  promo: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
  system: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
};

export default function NotificationCenterPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const { data: notifData, refetch } = trpc.v100.notificationsV2.list.useQuery({ unreadOnly, limit: 50 });
  const { data: preferences } = trpc.v100.notificationsV2.getPreferences.useQuery();

  const markReadMutation = trpc.v100.notificationsV2.markRead.useMutation({
    onSuccess: () => refetch(),
  });
  const markAllReadMutation = trpc.v100.notificationsV2.markRead.useMutation({
    onSuccess: () => { toast.success("All marked as read"); refetch(); },
  });
  const updatePrefMutation = trpc.v100.notificationsV2.updatePreferences.useMutation({
    onSuccess: () => toast.success("Preferences saved"),
  });

  const notifications = notifData?.items ?? [];
  const unreadCount = notifData?.unreadCount ?? 0;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6" />Notification Center
            {unreadCount > 0 && <Badge className="ml-1">{unreadCount}</Badge>}
          </h1>
          <p className="text-muted-foreground">Manage all your alerts and notification preferences</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPrefs(!showPrefs)}>
            <Settings className="w-4 h-4 mr-2" />{showPrefs ? "Hide" : "Preferences"}
          </Button>
          <Button variant="outline" onClick={() => markAllReadMutation.mutate({ markAll: true })} disabled={markAllReadMutation.isPending}>
            <CheckCheck className="w-4 h-4 mr-2" />Mark All Read
          </Button>
        </div>
      </div>

      {/* Preferences Panel */}
      {showPrefs && preferences && (
        <Card>
          <CardHeader><CardTitle>Notification Preferences</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="font-semibold mb-3">Channels</p>
                {Object.entries(preferences.channels).map(([channel, enabled]) => (
                  <div key={channel} className="flex items-center justify-between p-2 border rounded mb-2">
                    <span className="capitalize">{channel}</span>
                    <Switch checked={enabled} onCheckedChange={(checked) => {
                      updatePrefMutation.mutate({ channels: { ...preferences.channels, [channel]: checked } });
                    }} />
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold mb-3">Quiet Hours</p>
                <div className="p-3 border rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span>Enable Quiet Hours</span>
                    <Switch checked={preferences.quietHours.enabled} onCheckedChange={(checked) => {
                      updatePrefMutation.mutate({ quietHours: { ...preferences.quietHours, enabled: checked } });
                    }} />
                  </div>
                  <p className="text-sm text-muted-foreground">{preferences.quietHours.start} – {preferences.quietHours.end} ({preferences.quietHours.timezone})</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
        <span className="text-sm">Unread only</span>
        <span className="text-sm text-muted-foreground ml-auto">{notifications.length} notifications</span>
      </div>

      {/* Notifications List */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="transfer">Transfers</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="promo">Promotions</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        {["all", "transfer", "security", "promo", "system"].map(tab => (
          <TabsContent key={tab} value={tab}>
            <div className="space-y-2">
              {notifications.filter(n => tab === "all" || (n as any).type === tab).length === 0 ? (
                <Card><CardContent className="p-8 text-center">
                  <BellOff className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">No notifications</p>
                </CardContent></Card>
              ) : (
                notifications.filter(n => tab === "all" || (n as any).type === tab).map(n => (
                  <Card key={n.id} className={!(n as any).isRead ? "border-primary/30 bg-primary/5" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${!(n as any).isRead ? "bg-primary" : "bg-muted"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-semibold text-sm ${!(n as any).isRead ? "" : "text-muted-foreground"}`}>{n.title}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[(n as any).type] ?? ""}`}>{(n as any).type}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{(n as any).message}</p>
                          <p className="text-xs text-muted-foreground mt-1">{new Date((n as any).createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {!(n as any).isRead && (
                            <Button size="sm" variant="ghost" onClick={() => markReadMutation.mutate({ notificationId: n.id })}>
                              <Check className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
