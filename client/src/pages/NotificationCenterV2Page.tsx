import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bell, BellOff, Check, CheckCheck, Trash2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const TYPE_COLORS: Record<string, string> = {
  system: "bg-blue-500/20 text-blue-400",
  transaction: "bg-green-500/20 text-green-400",
  security: "bg-red-500/20 text-red-400",
  kyc: "bg-yellow-500/20 text-yellow-400",
  promo: "bg-purple-500/20 text-purple-400",
};

export default function NotificationCenterV2Page() {
  const allQuery = trpc.v89.notificationCenterV2.getAll.useQuery({ limit: 50, offset: 0 });
  const unreadQuery = trpc.v89.notificationCenterV2.getUnreadCount.useQuery();

  const markReadMutation = trpc.v89.notificationCenterV2.markRead.useMutation({
    onSuccess: () => { allQuery.refetch(); unreadQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const markAllReadMutation = trpc.v89.notificationCenterV2.markAllRead.useMutation({
    onSuccess: () => { toast.success("All notifications marked as read"); allQuery.refetch(); unreadQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.v89.notificationCenterV2.deleteNotification.useMutation({
    onSuccess: () => { allQuery.refetch(); unreadQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const notifications = allQuery.data?.notifications ?? [];
  const unread = unreadQuery.data?.count ?? 0;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Notification Center</h1>
          {unread > 0 && <Badge className="bg-red-500 text-white">{unread} unread</Badge>}
        </div>
        {unread > 0 && (
          <Button size="sm" variant="outline" onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}>
            <CheckCheck className="w-4 h-4 mr-2" /> Mark All Read
          </Button>
        )}
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0 divide-y divide-border">
          {allQuery.isPending ? (
            <div className="p-8 text-center text-muted-foreground">Loading notifications...</div>
          ) : notifications.length === 0 ? (
            <div className="p-16 text-center text-muted-foreground">
              <BellOff className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No notifications</p>
              <p className="text-sm mt-1">You're all caught up!</p>
            </div>
          ) : notifications.map((n: any) => (
            <div key={n.id} className={`flex items-start gap-4 p-4 hover:bg-muted/20 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}>
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!n.isRead ? "bg-primary" : "bg-transparent"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-sm font-medium ${!n.isRead ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge className={TYPE_COLORS[n.type ?? "system"] ?? "bg-gray-500/20 text-gray-400"}>
                      {n.type}
                    </Badge>
                    {!n.isRead && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={() => markReadMutation.mutate({ notificationIds: [n.id] })}>
                        <Check className="w-3 h-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                      onClick={() => deleteMutation.mutate({ notificationId: n.id })}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
