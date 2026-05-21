import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, BellOff, CheckCheck, Settings, Trash2, Mail, Smartphone, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function NotificationCenter() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const { data: notifData, isLoading, isError } = trpc.notificationCenter.list.useQuery({ type: "all", limit: 50, offset: 0 });
  const { data: prefs } = trpc.notificationCenter.preferences.useQuery();

  const markReadMutation = trpc.notificationCenter.markRead.useMutation({
    onSuccess: () => utils.notificationCenter.list.invalidate(),
  });
  const markAllReadMutation = trpc.notificationCenter.markRead.useMutation({
    onSuccess: () => { utils.notificationCenter.list.invalidate(); toast.success("All notifications marked as read"); },
  });
  const deleteMutation = trpc.notificationCenter.delete.useMutation({
    onSuccess: () => utils.notificationCenter.list.invalidate(),
  });
  const updatePrefMutation = trpc.notificationCenter.updatePreference.useMutation({
    onSuccess: () => { utils.notificationCenter.preferences.invalidate(); toast.success("Preference saved"); },
  });

  const items = (notifData as any)?.items ?? [];
  const unreadCount = (notifData as any)?.unreadCount ?? 0;
  const total = (notifData as any)?.total ?? 0;

  const typeIcon = (type: string) => {
    const icons: Record<string, string> = { transaction: "💸", security: "🔐", kyc: "🪪", system: "⚙️", promotion: "🎁", fx_alert: "📈" };
    return icons[type] ?? "🔔";
  };

  const PREF_CHANNELS = [
    { channel: "push", eventType: "transfer.completed", label: "Transfer Alerts", desc: "Push notification on every send/receive", icon: <Smartphone className="w-4 h-4" /> },
    { channel: "email", eventType: "kyc.approved", label: "KYC Updates", desc: "Email when your KYC status changes", icon: <Mail className="w-4 h-4" /> },
    { channel: "push", eventType: "fx.alert", label: "FX Rate Alerts", desc: "Push when target rates are reached", icon: <Bell className="w-4 h-4" /> },
    { channel: "email", eventType: "security.login", label: "Security Alerts", desc: "Email on new device login or suspicious activity", icon: <Mail className="w-4 h-4" /> },
    { channel: "push", eventType: "promotion", label: "Promotions", desc: "Push for offers and product updates", icon: <Smartphone className="w-4 h-4" /> },
    { channel: "sms", eventType: "transfer.completed", label: "SMS Alerts", desc: "Text message on completed transfers", icon: <MessageSquare className="w-4 h-4" /> },
  ];

  const isPrefEnabled = (channel: string, eventType: string) => {
    if (!prefs) return false;
    if (Array.isArray(prefs)) {
      const match = (prefs as any[]).find((p: any) => p.channel === channel && p.event_type === eventType);
      return match ? match.enabled : false;
    }
    return false;
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Bell className="w-6 h-6 text-blue-400" /> Notification Center</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage all your alerts, preferences, and delivery channels</p>
        </div>
        <Button variant="outline" onClick={() => markAllReadMutation.mutate({})} disabled={markAllReadMutation.isPending}>
          <CheckCheck className="w-4 h-4 mr-2" /> Mark All Read
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: "Total", value: total, color: "text-foreground" },
          { label: "Unread", value: unreadCount, color: "text-blue-400" },
          { label: "Preferences", value: Array.isArray(prefs) ? prefs.length : 0, color: "text-purple-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox {unreadCount > 0 && <span className="ml-1.5 bg-blue-500 text-white text-xs rounded-full px-1.5">{unreadCount}</span>}</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : items.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BellOff className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No notifications</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((n: any) => (
                    <div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${n.isRead ? "border-border/50 bg-muted/10" : "border-blue-500/30 bg-blue-500/5"}`}>
                      <span className="text-xl mt-0.5">{typeIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}>{n.title}</p>
                          {!n.isRead && <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.message}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex gap-1">
                        {!n.isRead && (
                          <Button size="sm" variant="ghost" onClick={() => markReadMutation.mutate({ ids: [n.id] })}>
                            <CheckCheck className="w-3 h-3" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => deleteMutation.mutate({ id: n.id })}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Settings className="w-4 h-4" /> Notification Preferences</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {PREF_CHANNELS.map(({ channel, eventType, label, desc, icon }) => (
                  <div key={`${channel}-${eventType}`} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{icon}</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                    </div>
                    <Switch
                      checked={isPrefEnabled(channel, eventType)}
                      onCheckedChange={(checked) => updatePrefMutation.mutate({ channel, eventType, enabled: checked })}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
