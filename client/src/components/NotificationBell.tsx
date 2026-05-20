import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, Check, CheckCheck, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPE_COLORS: Record<string, string> = {
  transaction: "bg-green-500",
  security: "bg-red-500",
  kyc: "bg-yellow-500",
  system: "bg-blue-500",
  promotion: "bg-purple-500",
  fx_alert: "bg-orange-500",
};

const TYPE_LABELS: Record<string, string> = {
  transaction: "Transaction",
  security: "Security",
  kyc: "KYC",
  system: "System",
  promotion: "Promo",
  fx_alert: "FX Alert",
};

function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data, refetch: refetchList } = trpc.notifications.list.useQuery(
    { limit: 10, offset: 0, unreadOnly: false },
    { refetchInterval: 120000 } // fallback poll every 2 min
  );

  const { data: countData, refetch: refetchCount } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 120000,
  });

  // ── Live SSE: invalidate on new notification events ─────────────────────────
  const sseRef = useRef<EventSource | null>(null);
  const stableRefetchList = useCallback(() => { refetchList(); }, [refetchList]);
  const stableRefetchCount = useCallback(() => { refetchCount(); }, [refetchCount]);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      const es = new EventSource("/api/sse/notifications", { withCredentials: true });
      sseRef.current = es;
      es.addEventListener("notification", () => {
        stableRefetchList();
        stableRefetchCount();
      });
      es.addEventListener("ping", () => { /* keep-alive, no-op */ });
      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type: string; payload: Record<string, unknown>; timestamp?: string };
          if (event.type === "ping") return;
          const title = (event.payload?.title as string) ?? "New notification";
          const message = (event.payload?.message as string) ?? "";
          if (event.type === "transfer_received") {
            toast.success(title, { description: message, duration: 5000 });
          } else if (event.type === "transfer_sent") {
            toast.success(title, { description: message, duration: 4000 });
          } else if (event.type === "transfer_failed") {
            toast.error(title, { description: message, duration: 6000 });
          } else if (event.type === "kyc_approved") {
            toast.success(title, { description: message, duration: 5000 });
          } else if (event.type === "kyc_rejected") {
            toast.error(title, { description: message, duration: 6000 });
          } else if (event.type === "low_balance") {
            toast.warning(title, { description: message, duration: 6000 });
          } else {
            toast.info(title, { description: message, duration: 4000 });
          }
          stableRefetchList();
          stableRefetchCount();
        } catch { /* ignore parse errors */ }
      };
      es.onerror = () => {
        es.close();
        retryTimer = setTimeout(connect, 15_000);
      };
    }
    connect();
    return () => {
      sseRef.current?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [stableRefetchList, stableRefetchCount]);

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const remove = trpc.notifications.remove.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const unreadCount = countData?.count ?? data?.unread ?? 0;
  const notifications = data?.notifications ?? [];

  const handleNotificationClick = (notif: any) => {
    if (!notif.isRead) {
      markRead.mutate({ id: notif.id });
    }
    if (notif.actionUrl) {
      setOpen(false);
      navigate(notif.actionUrl);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] font-bold rounded-full"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[380px] p-0 shadow-xl"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { setOpen(false); navigate("/notifications"); }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              View all
            </Button>
          </div>
        </div>

        {/* Notification List */}
        <ScrollArea className="h-[360px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notif: any) => (
                <div
                  key={notif.id}
                  className={cn(
                    "flex gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer group transition-colors",
                    !notif.isRead && "bg-primary/5"
                  )}
                  onClick={() => handleNotificationClick(notif)}
                >
                  {/* Type dot */}
                  <div className="mt-1.5 flex-shrink-0">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        TYPE_COLORS[notif.type] ?? "bg-gray-400"
                      )}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-sm leading-snug", !notif.isRead && "font-medium")}>
                        {notif.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {timeAgo(notif.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {notif.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-4"
                      >
                        {TYPE_LABELS[notif.type] ?? notif.type}
                      </Badge>
                      {!notif.isRead && (
                        <span className="text-[10px] text-primary font-medium">New</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!notif.isRead && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          markRead.mutate({ id: notif.id });
                        }}
                        title="Mark as read"
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove.mutate({ id: notif.id });
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="px-4 py-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground w-full"
                onClick={() => { setOpen(false); navigate("/notifications"); }}
              >
                See all notifications
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
