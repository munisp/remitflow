import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, Mail, Smartphone, CheckCircle2, ArrowRightLeft, Shield, TrendingUp, CheckCheck, Trash2, Filter, RefreshCw, Info, DollarSign, Star } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function Notifications() {
  const { t } = useTranslation();
  
  
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [prefs, setPrefs] = useState({ emailTx: true, emailSecurity: true, emailMarketing: false, pushTx: true, pushSecurity: true, pushMarketing: true });
  const utils = trpc.useUtils();

  const { data: listData, isLoading, refetch } = trpc.notifications.list.useQuery({ limit: 50, offset: 0, unreadOnly });
  const notifs = Array.isArray(listData) ? listData : (listData as any)?.notifications ?? [];
  const { data: countData } = trpc.notifications.unreadCount.useQuery();
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => utils.notifications.list.invalidate() });
  const markAllRead = trpc.notifications.markAllRead.useMutation({ onSuccess: () => { utils.notifications.list.invalidate(); utils.notifications.unreadCount.invalidate(); toast.success("All notifications marked as read"); } });
  const remove = trpc.notifications.remove.useMutation({ onSuccess: () => utils.notifications.list.invalidate() });

  const ICONS: Record<string, any> = { transfer: ArrowRightLeft, fx_alert: TrendingUp, kyc: CheckCircle2, security: Shield, promo: Bell, system: Bell };
  const COLORS: Record<string, string> = { transfer: "bg-blue-500/10 text-blue-400", fx_alert: "bg-yellow-500/10 text-yellow-400", kyc: "bg-purple-500/10 text-purple-400", security: "bg-red-500/10 text-red-400", promo: "bg-emerald-500/10 text-emerald-400", system: "bg-gray-500/10 text-gray-400" };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6" /> Notifications
              {(countData?.count ?? 0) > 0 && <Badge className="bg-red-500 text-white border-0">{countData?.count}</Badge>}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{(notifs as any[]).length} notifications</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" /><span>Unread</span>
              <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
            {(countData?.count ?? 0) > 0 && (
              <Button size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending} className="bg-emerald-500 hover:bg-emerald-600">
                <CheckCheck className="h-4 w-4 mr-1" />Mark All Read
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-muted/20 rounded-lg animate-pulse" />)}</div>
        ) : (notifs as any[]).length === 0 ? (
          <Card><CardContent className="py-16 text-center"><Bell className="h-12 w-12 mx-auto text-muted-foreground mb-3" /><p className="text-muted-foreground">No notifications{unreadOnly ? " unread" : ""}</p></CardContent></Card>
        ) : (
          <div className="space-y-2">
            {(notifs as any[]).map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <Card key={n.id} className={`transition-all ${!n.isRead ? "border-primary/30 bg-primary/5" : ""}`}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${COLORS[n.type] ?? COLORS.system}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium ${!n.isRead ? "" : "text-muted-foreground"}`}>{n.title}</p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</span>
                      </div>
                      {n.message && <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      {!n.isRead && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => markRead.mutate({ id: n.id })}><CheckCircle2 className="h-3 w-3" /></Button>}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove.mutate({ id: n.id })}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Notification Preferences</CardTitle>
              <a href="/notification-preferences" className="text-xs text-primary hover:underline">Advanced Settings →</a>
            </div>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            {[
              { key: "emailTx", label: "Email: Transactions", icon: Mail },
              { key: "emailSecurity", label: "Email: Security alerts", icon: Shield },
              { key: "emailMarketing", label: "Email: Promotions", icon: Bell },
              { key: "pushTx", label: "Push: Transactions", icon: Smartphone },
              { key: "pushSecurity", label: "Push: Security alerts", icon: Smartphone },
              { key: "pushMarketing", label: "Push: Promotions", icon: Smartphone },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                <span className="text-sm">{item.label}</span>
                <Switch checked={(prefs as any)[item.key]} onCheckedChange={v => { setPrefs(p => ({ ...p, [item.key]: v })); toast.success("Preference saved"); }} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
