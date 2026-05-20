import { useState } from "react";
import { Bell, Mail, Smartphone, Zap, Shield, TrendingUp, RefreshCw, Settings, Info, Wallet, CreditCard, Users, CheckCircle, Gift, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";

const CATEGORY_META: Record<string, { icon: React.ElementType; label: string; description: string; color: string; badge?: string; group: string }> = {
  // Core Financial
  transaction: { icon: Zap, label: "Transactions", description: "Transfer confirmations, receipts, and payment status updates", color: "text-blue-500", badge: "Recommended", group: "Financial" },
  walletTopup: { icon: Wallet, label: "Wallet Top-ups", description: "Confirmations when funds are added via Stripe, PayPal, Flutterwave, or bank transfer", color: "text-cyan-500", group: "Financial" },
  bnpl: { icon: CreditCard, label: "BNPL & Installments", description: "Buy Now Pay Later plan approvals, payment reminders, and upcoming due dates", color: "text-indigo-500", group: "Financial" },
  recurringTransfer: { icon: RefreshCw, label: "Recurring Transfers", description: "Scheduled transfer execution results and failures", color: "text-purple-500", group: "Financial" },
  // Rates & Alerts
  fxAlert: { icon: TrendingUp, label: "FX Rate Alerts", description: "Notifications when your target exchange rates are reached", color: "text-green-500", group: "Rates & Alerts" },
  // Identity & Compliance
  kyc: { icon: CheckCircle, label: "KYC & Compliance", description: "Identity verification status, document approvals, and tier upgrades", color: "text-teal-500", badge: "Recommended", group: "Compliance" },
  security: { icon: Shield, label: "Security Alerts", description: "Login attempts, password changes, and suspicious activity", color: "text-red-500", badge: "Required", group: "Compliance" },
  // Growth & Partners
  referral: { icon: Gift, label: "Referral Rewards", description: "Referral sign-ups, reward credits, and milestone bonuses", color: "text-yellow-500", group: "Growth" },
  partner: { icon: Users, label: "Partner & White-label", description: "Tenant onboarding completions, invite code usage, and partner milestones", color: "text-violet-500", group: "Growth" },
  // Platform
  system: { icon: Settings, label: "System Updates", description: "Platform announcements, maintenance windows, and feature updates", color: "text-orange-500", group: "Platform" },
  promotion: { icon: Info, label: "Promotions & Offers", description: "Special offers, cashback rewards, and referral bonuses", color: "text-pink-500", group: "Platform" },
};

const GROUPS = ["Financial", "Rates & Alerts", "Compliance", "Growth", "Platform"];

type PrefRow = { category: string; emailEnabled: boolean; inAppEnabled: boolean; pushEnabled: boolean };

export default function NotificationPreferences() {
  const utils = trpc.useUtils();
  const { data: prefs, isLoading } = trpc.notifications.getPreferences.useQuery();
  const updateMutation = trpc.notifications.updatePreference.useMutation({
    onSuccess: () => {
      utils.notifications.getPreferences.invalidate();
    },
    onError: () => {
      toast.error("Failed to update preference. Please try again.");
    },
  });

  const [optimistic, setOptimistic] = useState<Record<string, PrefRow>>({});

  const getRow = (cat: string): PrefRow => {
    if (optimistic[cat]) return optimistic[cat];
    const found = (prefs as PrefRow[] | undefined)?.find(p => p.category === cat);
    return found ?? { category: cat, emailEnabled: true, inAppEnabled: true, pushEnabled: false };
  };

  const handleToggle = (category: string, field: "emailEnabled" | "inAppEnabled" | "pushEnabled", value: boolean) => {
    // Security alerts: email and in-app cannot be disabled
    if (category === "security" && (field === "emailEnabled" || field === "inAppEnabled") && !value) {
      toast.warning("Security alerts cannot be disabled for your account protection.");
      return;
    }
    const current = getRow(category);
    const updated = { ...current, [field]: value };
    setOptimistic(prev => ({ ...prev, [category]: updated }));
    updateMutation.mutate({
      category,
      emailEnabled: updated.emailEnabled,
      inAppEnabled: updated.inAppEnabled,
      pushEnabled: updated.pushEnabled,
    }, {
      onSuccess: () => toast.success(`${CATEGORY_META[category]?.label ?? category} preference updated`),
    });
  };

  const handleEnableAll = () => {
    Object.keys(CATEGORY_META).forEach(cat => {
      const current = getRow(cat);
      const updated = { ...current, emailEnabled: true, inAppEnabled: true };
      setOptimistic(prev => ({ ...prev, [cat]: updated }));
      updateMutation.mutate({ category: cat, emailEnabled: true, inAppEnabled: true, pushEnabled: current.pushEnabled });
    });
    toast.success("All notifications enabled");
  };

  const handleDisableMarketing = () => {
    ["promotion", "partner"].forEach(cat => {
      const current = getRow(cat);
      const updated = { ...current, emailEnabled: false };
      setOptimistic(prev => ({ ...prev, [cat]: updated }));
      updateMutation.mutate({ category: cat, emailEnabled: false, inAppEnabled: current.inAppEnabled, pushEnabled: current.pushEnabled });
    });
    toast.success("Marketing emails disabled");
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Bell className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Notification Preferences</h1>
              <p className="text-muted-foreground text-sm">Control how and when RemitFlow notifies you across {Object.keys(CATEGORY_META).length} event types</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDisableMarketing}>
              Disable Marketing
            </Button>
            <Button size="sm" onClick={handleEnableAll}>
              <Save className="h-4 w-4 mr-1" />
              Enable All
            </Button>
          </div>
        </div>

        {/* Channel legend */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Notification Channels</CardTitle>
            <CardDescription>Choose how you receive each type of notification</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Mail className="h-4 w-4 text-blue-500 shrink-0" />
                <div>
                  <p className="font-medium">Email</p>
                  <p className="text-muted-foreground text-xs">Sent to your registered email address</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <Bell className="h-4 w-4 text-green-500 shrink-0" />
                <div>
                  <p className="font-medium">In-App</p>
                  <p className="text-muted-foreground text-xs">Notification bell in dashboard + real-time toasts</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <Smartphone className="h-4 w-4 text-purple-500 shrink-0" />
                <div>
                  <p className="font-medium">Push</p>
                  <p className="text-muted-foreground text-xs">Mobile push (requires RemitFlow app)</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preferences grouped by category */}
        {GROUPS.map(group => {
          const groupCategories = Object.entries(CATEGORY_META).filter(([, meta]) => meta.group === group).map(([cat]) => cat);
          return (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{group}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <span>Event Type</span>
                    <span className="w-16 text-center">Email</span>
                    <span className="w-16 text-center">In-App</span>
                    <span className="w-16 text-center">Push</span>
                  </div>

                  {isLoading
                    ? groupCategories.map(cat => (
                        <div key={cat} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-4 items-center">
                          <div className="space-y-1">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-48" />
                          </div>
                          <Skeleton className="h-6 w-11 rounded-full" />
                          <Skeleton className="h-6 w-11 rounded-full" />
                          <Skeleton className="h-6 w-11 rounded-full" />
                        </div>
                      ))
                    : groupCategories.map(cat => {
                        const meta = CATEGORY_META[cat];
                        const row = getRow(cat);
                        const Icon = meta.icon;
                        const isRequired = meta.badge === "Required";
                        return (
                          <div key={cat} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-4 items-center hover:bg-muted/30 transition-colors">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className={`mt-0.5 shrink-0 ${meta.color}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium text-sm">{meta.label}</p>
                                  {meta.badge && (
                                    <Badge
                                      variant={isRequired ? "destructive" : "secondary"}
                                      className="text-xs py-0 px-1.5"
                                    >
                                      {meta.badge}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{meta.description}</p>
                              </div>
                            </div>
                            <div className="w-16 flex justify-center">
                              <Switch
                                checked={row.emailEnabled}
                                onCheckedChange={v => handleToggle(cat, "emailEnabled", v)}
                                disabled={updateMutation.isPending || (isRequired)}
                                aria-label={`${meta.label} email`}
                              />
                            </div>
                            <div className="w-16 flex justify-center">
                              <Switch
                                checked={row.inAppEnabled}
                                onCheckedChange={v => handleToggle(cat, "inAppEnabled", v)}
                                disabled={updateMutation.isPending || (isRequired)}
                                aria-label={`${meta.label} in-app`}
                              />
                            </div>
                            <div className="w-16 flex justify-center">
                              <Switch
                                checked={row.pushEnabled}
                                onCheckedChange={v => handleToggle(cat, "pushEnabled", v)}
                                disabled={updateMutation.isPending}
                                aria-label={`${meta.label} push`}
                              />
                            </div>
                          </div>
                        );
                      })}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center">
          Security alerts are always enabled to protect your account. Push notifications require the RemitFlow mobile app.
          Changes are saved automatically.
        </p>
      </div>
    </DashboardLayout>
  );
}
