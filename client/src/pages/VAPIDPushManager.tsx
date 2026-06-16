import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell, BellOff, Smartphone, Monitor, Trash2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const NOTIFICATION_CATEGORIES = [
  { id: "transfers", label: "Transfer Updates", description: "Sent, received, failed" },
  { id: "fx_alerts", label: "FX Rate Alerts", description: "When target rates are hit" },
  { id: "kyc", label: "KYC Status", description: "Verification approved/rejected" },
  { id: "security", label: "Security Alerts", description: "Login, suspicious activity" },
  { id: "promotions", label: "Promotions", description: "Offers and cashback" },
];

export default function VAPIDPushManager() {
  const { t } = useTranslation();
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIFICATION_CATEGORIES.map(c => [c.id, true]))
  );

  const { data, isLoading, refetch } = trpc.pushNotifications.listSubscriptions.useQuery(undefined);
  const savePreferencesMutation = trpc.notifPrefs.update.useMutation({
    onSuccess: () => toast.success("Preferences saved"),
    onError: (e: any) => toast.error(e.message),
  });

  const subscribeMutation = trpc.pushNotifications.subscribe.useMutation({
    onSuccess: () => { toast.success("Push notifications enabled"); refetch(); setIsSubscribed(true); },
    onError: (e) => toast.error(e.message),
  });

  const unsubscribeMutation = trpc.pushNotifications.unsubscribe.useMutation({
    onSuccess: () => { toast.success("Unsubscribed from push notifications"); refetch(); setIsSubscribed(false); },
    onError: (e) => toast.error(e.message),
  });

  const testMutation = trpc.pushNotifications.sendTest.useMutation({
    onSuccess: () => toast.success("Test notification sent — check your browser"),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    setSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === "granted") {
        // In production, generate a real VAPID subscription here
        subscribeMutation.mutate({
          endpoint: `https://fcm.googleapis.com/fcm/send/sandbox-${Date.now()}`,
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlTiESgX9QualityKey",
          auth: "tBHItJI5svbpez7KI4CCXg",
          deviceName: navigator.userAgent.includes("Mobile") ? "Mobile Browser" : "Desktop Browser",
        });
      } else {
        toast.error("Permission denied. Please enable notifications in browser settings.");
      }
    } catch (e: any) {
      toast.error(e.message);
    }
    setSubscribing(false);
  };

  const subscriptions = data?.subscriptions ?? [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            Push Notifications
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage browser push notification subscriptions and preferences</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Permission Status */}
      <Card className={permission === "granted" ? "border-green-500/20 bg-green-500/5" : permission === "denied" ? "border-red-500/20 bg-red-500/5" : ""}>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {permission === "granted" ? (
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              ) : permission === "denied" ? (
                <AlertCircle className="w-6 h-6 text-red-500" />
              ) : (
                <Bell className="w-6 h-6 text-yellow-500" />
              )}
              <div>
                <p className="font-medium">
                  {permission === "granted" ? "Notifications Enabled" : permission === "denied" ? "Notifications Blocked" : "Notifications Not Configured"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {permission === "granted"
                    ? "Your browser will receive push notifications from RemitFlow"
                    : permission === "denied"
                    ? "Please enable notifications in your browser settings to receive alerts"
                    : "Enable push notifications to get real-time alerts for transfers, FX rates, and security events"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {permission !== "denied" && !isSubscribed && (
                <Button onClick={requestPermission} disabled={subscribing}>
                  {subscribing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
                  Enable Notifications
                </Button>
              )}
              {(isSubscribed || subscriptions.length > 0) && (
                <Button variant="outline" onClick={() => testMutation.mutate()}>
                  Send Test
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {NOTIFICATION_CATEGORIES.map(cat => (
            <div key={cat.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{cat.label}</p>
                <p className="text-xs text-muted-foreground">{cat.description}</p>
              </div>
              <Switch
                checked={preferences[cat.id]}
                onCheckedChange={v => setPreferences(p => ({ ...p, [cat.id]: v }))}
              />
            </div>
          ))}
          <Button size="sm" className="mt-2" disabled={savePreferencesMutation.isPending} onClick={() => savePreferencesMutation.mutate({
            pushTransactions: preferences["transfers"] ?? true,
            fxAlertEnabled: preferences["fx_alerts"] ?? true,
            emailSecurity: preferences["security"] ?? true,
            pushMarketing: preferences["promotions"] ?? false,
          })}>
            {savePreferencesMutation.isPending ? "Saving…" : "Save Preferences"}
          </Button>
        </CardContent>
      </Card>

      {/* Active Subscriptions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>
          ) : subscriptions.length === 0 ? (
            <div className="p-8 text-center">
              <BellOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No active push subscriptions.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Subscribed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((sub: any) => (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {sub.deviceName?.includes("Mobile") ? (
                          <Smartphone className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Monitor className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">{sub.deviceName ?? "Browser"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={sub.isActive ? "default" : "secondary"}>
                        {sub.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {sub.lastUsedAt ? new Date(sub.lastUsedAt).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => unsubscribeMutation.mutate({ subscriptionId: sub.id })}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
