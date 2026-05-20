import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, Smartphone, Trash2, Send, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PREF_LABELS: Record<string, { label: string; description: string }> = {
  transfer_sent: { label: "Transfer Sent", description: "When you initiate a new transfer" },
  transfer_delivered: { label: "Transfer Delivered", description: "When your transfer reaches the recipient" },
  transfer_failed: { label: "Transfer Failed", description: "When a transfer fails or is rejected" },
  kyc_approved: { label: "KYC Approved", description: "When your identity verification is approved" },
  kyc_rejected: { label: "KYC Action Required", description: "When your KYC needs attention" },
  fx_rate_alert: { label: "FX Rate Alerts", description: "When exchange rates hit your target" },
  security_alert: { label: "Security Alerts", description: "Login attempts and suspicious activity" },
  compliance_flag: { label: "Compliance Flags", description: "Regulatory compliance notifications (admin only)" },
};

export default function NotificationSettings() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const { data: vapidData } = trpc.pushNotificationsV93.getVapidKey.useQuery();
  const { data: subscriptions, refetch: refetchSubs } = trpc.pushNotificationsV93.listSubscriptions.useQuery();
  const { data: preferences, refetch: refetchPrefs } = trpc.pushNotificationsV93.getPreferences.useQuery();

  const subscribeMutation = trpc.pushNotificationsV93.subscribe.useMutation({
    onSuccess: () => { toast.success("Push notifications enabled!"); refetchSubs(); setIsSubscribed(true); },
    onError: (e) => toast.error(e.message),
  });

  const unsubscribeMutation = trpc.pushNotificationsV93.unsubscribe.useMutation({
    onSuccess: () => { toast.success("Notifications disabled for this device"); refetchSubs(); setIsSubscribed(false); },
    onError: (e) => toast.error(e.message),
  });

  const updatePrefsMutation = trpc.pushNotificationsV93.updatePreferences.useMutation({
    onSuccess: () => { toast.success("Preferences saved"); refetchPrefs(); },
    onError: (e) => toast.error(e.message),
  });

  const testMutation = trpc.pushNotificationsV93.sendTest.useMutation({
    onSuccess: (r) => toast.success(`Test notification sent to ${r.sent} device(s)`),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    setIsSupported(supported);
    if (supported && Notification.permission === "granted") {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub);
        });
      });
    }
  }, []);

  const handleSubscribe = async () => {
    if (!vapidData?.publicKey) return;
    setSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notification permission denied. Please allow notifications in your browser settings.");
        setSubscribing(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });

      const subJson = sub.toJSON();
      await subscribeMutation.mutateAsync({
        endpoint: sub.endpoint,
        p256dhKey: (subJson.keys as any)?.p256dh ?? "",
        authKey: (subJson.keys as any)?.auth ?? "",
        deviceName: navigator.userAgent.includes("Mobile") ? "Mobile Browser" : "Desktop Browser",
      });
    } catch (err: any) {
      toast.error("Failed to enable notifications: " + err.message);
    } finally {
      setSubscribing(false);
    }
  };

  const handleUnsubscribe = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribeMutation.mutateAsync({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } catch (err: any) {
      toast.error("Failed to disable notifications: " + err.message);
    }
  };

  const togglePref = (key: string, value: boolean) => {
    updatePrefsMutation.mutate({ preferences: { [key]: value } });
  };

  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Push Notifications</h1>
            <p className="text-muted-foreground text-sm">Manage real-time alerts for transfers, KYC, and security events</p>
          </div>
        </div>

        {/* Browser Support Status */}
        {!isSupported && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-300">Push notifications not supported</p>
                <p className="text-xs text-muted-foreground">Your browser does not support Web Push. Try Chrome, Firefox, or Edge.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Subscription Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" />
              This Device
            </CardTitle>
            <CardDescription>Enable push notifications on this browser/device</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isSubscribed ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium">{isSubscribed ? "Notifications Active" : "Notifications Disabled"}</p>
                  <p className="text-xs text-muted-foreground">
                    {isSubscribed ? "You will receive push notifications on this device" : "Enable to receive real-time alerts"}
                  </p>
                </div>
              </div>
              {isSubscribed ? (
                <Button variant="outline" size="sm" onClick={handleUnsubscribe} disabled={unsubscribeMutation.isPending}>
                  {unsubscribeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable"}
                </Button>
              ) : (
                <Button size="sm" onClick={handleSubscribe} disabled={!isSupported || subscribing}>
                  {subscribing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bell className="h-4 w-4 mr-2" />}
                  Enable
                </Button>
              )}
            </div>

            {isSubscribed && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
                {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Send Test Notification
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Notification Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notification Preferences</CardTitle>
            <CardDescription>Choose which events trigger notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(PREF_LABELS).map(([key, { label, description }]) => (
              <div key={key} className="flex items-center justify-between py-1">
                <div className="flex-1 min-w-0">
                  <Label className="text-sm font-medium cursor-pointer">{label}</Label>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  checked={preferences?.[key] ?? true}
                  onCheckedChange={(v) => togglePref(key, v)}
                  disabled={updatePrefsMutation.isPending}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Registered Devices */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registered Devices</CardTitle>
            <CardDescription>Devices that will receive push notifications</CardDescription>
          </CardHeader>
          <CardContent>
            {!subscriptions || (Array.isArray(subscriptions) ? subscriptions.length : 0) === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No devices registered yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(Array.isArray(subscriptions) ? subscriptions : []).map((sub: any) => (
                  <div key={sub.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{sub.device_name || "Unknown Device"}</p>
                        <p className="text-xs text-muted-foreground">
                          Registered {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={sub.is_active ? "bg-green-500/20 text-green-300" : "bg-muted text-muted-foreground"}>
                        {sub.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => unsubscribeMutation.mutate({ endpoint: sub.endpoint })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
