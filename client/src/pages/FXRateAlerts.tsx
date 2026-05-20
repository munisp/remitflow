import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bell, BellOff, TrendingUp, TrendingDown, RefreshCw, Plus,
  Trash2, Edit2, CheckCircle, AlertCircle, Zap, MessageSquare,
  Mail, Smartphone, ArrowUp, ArrowDown, Wifi, WifiOff, Activity
} from "lucide-react";
import { useTranslation } from 'react-i18next';

type FxTick = {
  rate: number;
  change: number;
  changePercent: number;
  bid: number;
  ask: number;
  trend: "up" | "down" | "flat";
};

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "XOF", "EGP", "UGX", "TZS", "ETB", "MAD", "XAF"];

const DEFAULT_PAIRS = [
  "USD/NGN", "GBP/NGN", "EUR/NGN", "USD/KES", "USD/GHS", "USD/ZAR", "USD/GBP", "USD/EUR"
];

export default function FXRateAlerts() {
  const { t } = useTranslation();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [editAlert, setEditAlert] = useState<any>(null);
  const [form, setForm] = useState({
    fromCurrency: "USD",
    toCurrency: "NGN",
    targetRate: "",
    direction: "above" as "above" | "below",
    notifySms: true,
    notifyEmail: true,
    notifyPush: true,
  });

  const utils = trpc.useUtils();

  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts } = trpc.rateAlerts.list.useQuery();
  const { data: currentRates, isLoading: ratesLoading, refetch: refetchRates } = trpc.rateAlerts.currentRates.useQuery({
    pairs: DEFAULT_PAIRS,
  });
  const { data: checkResult, refetch: checkNow } = trpc.rateAlerts.checkNow.useQuery(undefined, { enabled: false });

  const createMutation = trpc.rateAlerts.create.useMutation({
    onSuccess: () => {
      toast.success("Rate alert created successfully");
      utils.rateAlerts.list.invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.rateAlerts.update.useMutation({
    onSuccess: () => {
      toast.success("Alert updated");
      utils.rateAlerts.list.invalidate();
      setEditAlert(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.rateAlerts.remove.useMutation({
    onSuccess: () => {
      toast.success("Alert removed");
      utils.rateAlerts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => setForm({
    fromCurrency: "USD", toCurrency: "NGN", targetRate: "",
    direction: "above", notifySms: true, notifyEmail: true, notifyPush: true,
  });

  const handleCreate = () => {
    if (!form.targetRate || isNaN(Number(form.targetRate))) {
      toast.error("Please enter a valid target rate"); return;
    }
    if (form.fromCurrency === form.toCurrency) {
      toast.error("From and To currencies must be different"); return;
    }
    createMutation.mutate({
      fromCurrency: form.fromCurrency,
      toCurrency: form.toCurrency,
      targetRate: Number(form.targetRate),
      direction: form.direction,
      notifySms: form.notifySms,
      notifyEmail: form.notifyEmail,
      notifyPush: form.notifyPush,
    });
  };

  const handleToggleActive = (alert: any) => {
    updateMutation.mutate({ id: alert.id, isActive: !alert.is_active });
  };

  const handleCheckNow = async () => {
    const result = await checkNow();
    if (result.data) {
      toast.success(`Checked ${result.data.checked} alerts — ${result.data.triggered} triggered`);
      utils.rateAlerts.list.invalidate();
    }
  };

  const [activeTab, setActiveTab] = useState<"alerts" | "history">("alerts");
  const [liveTriggered, setLiveTriggered] = useState<Array<{ pair: string; rate: number; direction: string; ts: string }>>([]);

  // ── Real-time FX streaming via /api/fx/stream SSE endpoint ────────────────
  const [streamRates, setStreamRates] = useState<Record<string, FxTick>>({});
  const [streamConnected, setStreamConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const pairs = DEFAULT_PAIRS.join(",");
    const es = new EventSource(`/api/fx/stream?pairs=${encodeURIComponent(pairs)}`);
    streamRef.current = es;
    es.onopen = () => setStreamConnected(true);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { ts: number; rates: Record<string, FxTick> };
        setStreamRates(prev => ({ ...prev, ...data.rates }));
        setLastUpdated(new Date(data.ts));
        setStreamConnected(true);
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => setStreamConnected(false);
    return () => { es.close(); setStreamConnected(false); };
  }, []);

  // SSE listener for real-time FX alert triggers (user notification channel)
  useEffect(() => {
    const es = new EventSource("/api/sse/notifications", { withCredentials: true });
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "fx_alert_triggered") {
          const p = data.payload;
          setLiveTriggered(prev => [{ pair: `${p.fromCurrency}/${p.toCurrency}`, rate: p.currentRate, direction: p.direction, ts: new Date().toISOString() }, ...prev.slice(0, 19)]);
          toast.success(`💱 FX Alert: ${p.fromCurrency}/${p.toCurrency} hit ${p.currentRate}`, { duration: 8000 });
          utils.rateAlerts.list.invalidate();
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [utils]);

  const activeAlerts = (alerts ?? []).filter((a: any) => a.is_active);
  const inactiveAlerts = (alerts ?? []).filter((a: any) => !a.is_active);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-7 w-7 text-amber-500" />
              FX Rate Alerts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Get notified when exchange rates hit your target</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchRates(); refetchAlerts(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleCheckNow}>
              <Zap className="h-4 w-4 mr-1" /> Check Now
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Alert
            </Button>
          </div>
        </div>

        {/* Live Rates Grid — real-time SSE streaming ticker */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Live Exchange Rates</h2>
            <div className="flex items-center gap-3">
              {streamConnected ? (
                <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <Wifi className="h-3 w-3" /> Live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <WifiOff className="h-3 w-3" /> Connecting...
                </span>
              )}
              {lastUpdated && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {DEFAULT_PAIRS.map((pair) => {
              const tick = streamRates[pair];
              const fallback = (currentRates ?? []).find((r: any) => r.pair === pair);
              const rate = tick?.rate ?? fallback?.rate ?? null;
              const change = tick?.change ?? 0;
              const changePercent = tick?.changePercent ?? 0;
              const trend = tick?.trend ?? (Number(change) >= 0 ? "up" : "down");
              const bid = tick?.bid;
              const ask = tick?.ask;
              const isLoading = !tick && ratesLoading;
              return (
                <Card key={pair} className={`hover:shadow-md transition-all ${
                  trend === "up" ? "border-green-200 dark:border-green-900" :
                  trend === "down" ? "border-red-200 dark:border-red-900" : ""
                }`}>
                  <CardContent className="pt-3 pb-3">
                    {isLoading ? (
                      <div className="animate-pulse">
                        <div className="h-4 bg-muted rounded w-16 mb-2" />
                        <div className="h-6 bg-muted rounded w-24" />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-muted-foreground">{pair}</span>
                          <div className="flex items-center gap-1">
                            {streamConnected && <Activity className="h-2.5 w-2.5 text-green-500 animate-pulse" />}
                            {trend === "up" ? <ArrowUp className="h-3 w-3 text-green-500" /> : <ArrowDown className="h-3 w-3 text-red-500" />}
                          </div>
                        </div>
                        <p className={`text-lg font-bold tabular-nums ${
                          trend === "up" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                        }`}>
                          {rate != null
                            ? Number(rate) >= 100 ? Number(rate).toFixed(2)
                              : Number(rate) >= 1 ? Number(rate).toFixed(4)
                              : Number(rate).toFixed(6)
                            : "—"}
                        </p>
                        <p className={`text-xs mt-0.5 tabular-nums ${change >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {change >= 0 ? "+" : ""}{change.toFixed(4)}
                          {changePercent !== 0 && <span className="ml-1 opacity-70">({changePercent > 0 ? "+" : ""}{changePercent.toFixed(2)}%)</span>}
                        </p>
                        {bid != null && ask != null && (
                          <div className="flex gap-2 mt-1 text-xs text-muted-foreground tabular-nums">
                            <span>B: {bid.toFixed(4)}</span>
                            <span>A: {ask.toFixed(4)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 border-b pb-0">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${ activeTab === "alerts" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("alerts")}
          >
            My Alerts ({(alerts ?? []).length})
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${ activeTab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("history")}
          >
            Trigger History {liveTriggered.length > 0 && <span className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full bg-amber-500 text-white">{liveTriggered.length}</span>}
          </button>
        </div>

        {activeTab === "history" && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Live Trigger History (this session)</h2>
            {liveTriggered.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No triggers yet this session</p>
                  <p className="text-sm">Triggers appear here in real-time when your target rates are hit</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {liveTriggered.map((t, i) => (
                  <Card key={i} className="border-amber-200 bg-amber-50/20">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                          <Zap className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{t.pair}</p>
                          <p className="text-xs text-muted-foreground">
                            Rate {t.direction} {t.rate >= 100 ? Number(t.rate).toFixed(2) : Number(t.rate).toFixed(4)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(t.ts).toLocaleTimeString()}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "alerts" && (
          <>
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Active Alerts ({activeAlerts.length})
          </h2>
          {alertsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading alerts...</div>
          ) : activeAlerts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No active alerts</p>
                <p className="text-sm">Create an alert to get notified when rates hit your target</p>
                <Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Create Alert
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {activeAlerts.map((alert: any) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  currentRates={currentRates ?? []}
                  onToggle={() => handleToggleActive(alert)}
                  onEdit={() => setEditAlert(alert)}
                  onRemove={() => {
                    if (confirm("Remove this alert?")) removeMutation.mutate({ id: alert.id });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Inactive / Triggered Alerts */}
        {inactiveAlerts.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Inactive / Triggered ({inactiveAlerts.length})
            </h2>
            <div className="grid gap-3 opacity-70">
              {inactiveAlerts.map((alert: any) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  currentRates={currentRates ?? []}
                  onToggle={() => handleToggleActive(alert)}
                  onEdit={() => setEditAlert(alert)}
                  onRemove={() => {
                    if (confirm("Remove this alert?")) removeMutation.mutate({ id: alert.id });
                  }}
                />
              ))}
            </div>
          </div>
        )}
          </>
        )}

        {/* Create Alert Modal */}
        <AlertFormModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="Create Rate Alert"
          form={form}
          setForm={setForm}
          onSubmit={handleCreate}
          isPending={createMutation.isPending}
          onCancel={() => { setCreateOpen(false); resetForm(); }}
        />

        {/* Edit Alert Modal */}
        {editAlert && (
          <AlertFormModal
            open={!!editAlert}
            onOpenChange={(open) => !open && setEditAlert(null)}
            title="Edit Rate Alert"
            form={{
              fromCurrency: editAlert.from_currency,
              toCurrency: editAlert.to_currency,
              targetRate: String(editAlert.target_rate),
              direction: editAlert.direction,
              notifySms: !!editAlert.notify_sms,
              notifyEmail: !!editAlert.notify_email,
              notifyPush: !!editAlert.notify_push,
            }}
            setForm={(updater: any) => setEditAlert((prev: any) => {
              const updated = typeof updater === "function" ? updater({
                fromCurrency: prev.from_currency, toCurrency: prev.to_currency,
                targetRate: String(prev.target_rate), direction: prev.direction,
                notifySms: !!prev.notify_sms, notifyEmail: !!prev.notify_email, notifyPush: !!prev.notify_push,
              }) : updater;
              return {
                ...prev,
                from_currency: updated.fromCurrency, to_currency: updated.toCurrency,
                target_rate: updated.targetRate, direction: updated.direction,
                notify_sms: updated.notifySms, notify_email: updated.notifyEmail, notify_push: updated.notifyPush,
              };
            })}
            onSubmit={() => {
              updateMutation.mutate({
                id: editAlert.id,
                targetRate: Number(editAlert.target_rate),
                direction: editAlert.direction,
                notifySms: !!editAlert.notify_sms,
                notifyEmail: !!editAlert.notify_email,
                notifyPush: !!editAlert.notify_push,
              });
            }}
            isPending={updateMutation.isPending}
            onCancel={() => setEditAlert(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function AlertCard({ alert, currentRates, onToggle, onEdit, onRemove }: {
  alert: any;
  currentRates: any[];
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const pair = `${alert.from_currency}/${alert.to_currency}`;
  const currentRate = currentRates.find((r: any) => r.pair === pair);
  const target = Number(alert.target_rate);
  const current = currentRate ? Number(currentRate.rate) : null;
  const isTriggered = current !== null && (
    alert.direction === "above" ? current >= target : current <= target
  );

  return (
    <Card className={`${!alert.is_active ? "opacity-60" : ""} ${isTriggered ? "border-amber-400 bg-amber-50/30" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base">{pair}</span>
              <Badge variant="outline" className={`text-xs ${alert.direction === "above" ? "text-green-700 border-green-300" : "text-red-700 border-red-300"}`}>
                {alert.direction === "above" ? <ArrowUp className="h-3 w-3 mr-1 inline" /> : <ArrowDown className="h-3 w-3 mr-1 inline" />}
                {alert.direction} {Number(alert.target_rate) >= 100 ? Number(alert.target_rate).toFixed(2) : Number(alert.target_rate).toFixed(4)}
              </Badge>
              {isTriggered && (
                <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300">
                  <CheckCircle className="h-3 w-3 mr-1 inline" /> Triggered
                </Badge>
              )}
              {!alert.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
            </div>
            {/* Progress bar toward target */}
            {current !== null && (() => {
              const baseline = alert.direction === "above" ? current * 0.97 : current * 1.03;
              const rangeMin = alert.direction === "above" ? baseline : target;
              const rangeMax = alert.direction === "above" ? target : baseline;
              const range = rangeMax - rangeMin;
              const rawPct = range > 0 ? Math.min(100, Math.max(0, ((current - rangeMin) / range) * 100)) : (isTriggered ? 100 : 0);
              const displayPct = alert.direction === "above" ? rawPct : 100 - rawPct;
              return (
                <div className="mt-2 mb-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Current: <span className="font-semibold text-foreground">{current >= 100 ? current.toFixed(2) : current.toFixed(4)}</span></span>
                    <span>{Math.round(displayPct)}% to target</span>
                    <span>Target: <span className="font-semibold text-foreground">{target >= 100 ? target.toFixed(2) : target.toFixed(4)}</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${isTriggered ? "bg-amber-500" : displayPct > 80 ? "bg-green-500" : "bg-primary"}`}
                      style={{ width: `${displayPct}%` }}
                    />
                  </div>
                </div>
              );
            })()}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              {current !== null && (
                <span>
                  Current: <span className="font-semibold text-foreground">
                    {current >= 100 ? Number(current).toFixed(2) : Number(current).toFixed(4)}
                  </span>
                </span>
              )}
              {alert.trigger_count > 0 && (
                <span>Triggered {alert.trigger_count}x</span>
              )}
              {alert.triggered_at && (
                <span>Last: {new Date(alert.triggered_at).toLocaleDateString()}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              {!!alert.notify_sms && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="h-3 w-3" /> SMS
                </span>
              )}
              {!!alert.notify_email && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" /> Email
                </span>
              )}
              {!!alert.notify_push && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Smartphone className="h-3 w-3" /> Push
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={!!alert.is_active}
              onCheckedChange={onToggle}
              className="data-[state=checked]:bg-green-500"
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertFormModal({ open, onOpenChange, title, form, setForm, onSubmit, isPending, onCancel }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: any;
  setForm: any;
  onSubmit: () => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-500" /> {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From Currency</Label>
              <Select value={form.fromCurrency} onValueChange={(v) => setForm((f: any) => ({ ...f, fromCurrency: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>To Currency</Label>
              <Select value={form.toCurrency} onValueChange={(v) => setForm((f: any) => ({ ...f, toCurrency: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Target Rate</Label>
              <Input
                type="number"
                step="any"
                placeholder="e.g. 1400"
                value={form.targetRate}
                onChange={(e) => setForm((f: any) => ({ ...f, targetRate: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Direction</Label>
              <Select value={form.direction} onValueChange={(v) => setForm((f: any) => ({ ...f, direction: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">
                    <span className="flex items-center gap-1"><ArrowUp className="h-3 w-3 text-green-500" /> Above target</span>
                  </SelectItem>
                  <SelectItem value="below">
                    <span className="flex items-center gap-1"><ArrowDown className="h-3 w-3 text-red-500" /> Below target</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Notification Channels</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded border">
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  <span>SMS</span>
                </div>
                <Switch
                  checked={form.notifySms}
                  onCheckedChange={(v) => setForm((f: any) => ({ ...f, notifySms: v }))}
                />
              </div>
              <div className="flex items-center justify-between p-2 rounded border">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-purple-500" />
                  <span>Email</span>
                </div>
                <Switch
                  checked={form.notifyEmail}
                  onCheckedChange={(v) => setForm((f: any) => ({ ...f, notifyEmail: v }))}
                />
              </div>
              <div className="flex items-center justify-between p-2 rounded border">
                <div className="flex items-center gap-2 text-sm">
                  <Smartphone className="h-4 w-4 text-green-500" />
                  <span>Push Notification</span>
                </div>
                <Switch
                  checked={form.notifyPush}
                  onCheckedChange={(v) => setForm((f: any) => ({ ...f, notifyPush: v }))}
                />
              </div>
            </div>
          </div>
          {form.fromCurrency && form.toCurrency && form.targetRate && (
            <div className="bg-muted/50 rounded-md p-3 text-sm">
              <p className="text-muted-foreground">
                You will be notified when <strong>{form.fromCurrency}/{form.toCurrency}</strong> goes{" "}
                <strong>{form.direction}</strong>{" "}
                <strong>{Number(form.targetRate).toLocaleString()}</strong>
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? "Saving..." : title.startsWith("Edit") ? "Update Alert" : "Create Alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
