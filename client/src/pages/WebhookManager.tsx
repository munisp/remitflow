import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Webhook, Plus, Trash2, RefreshCw, Eye, EyeOff, Copy, CheckCircle, XCircle, Clock } from "lucide-react";
import { useTranslation } from 'react-i18next';

const AVAILABLE_EVENTS = [
  "payment.completed", "payment.failed", "payment.refunded",
  "transfer.sent", "transfer.received",
  "kyc.approved", "kyc.rejected",
  "wallet.topup", "wallet.withdrawal",
  "card.created", "card.frozen",
  "user.created", "user.updated",
];

const STATUS_ICON: Record<string, any> = {
  delivered: CheckCircle,
  failed: XCircle,
  pending: Clock,
  retrying: RefreshCw,
};

export default function WebhookManager() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [deliveryOffset, setDeliveryOffset] = useState(0);

  const [form, setForm] = useState({ url: "", events: [] as string[], description: "" });

  const { data: endpoints, isLoading } = trpc.webhooks.listEndpoints.useQuery();
  const { data: deliveriesData } = trpc.webhooks.listDeliveries.useQuery(
    { endpointId: selectedEndpoint!, limit: 20, offset: deliveryOffset },
    { enabled: selectedEndpoint !== null }
  );

  const createMutation = trpc.webhooks.createEndpoint.useMutation({
    onSuccess: (data) => {
      toast.success("Webhook endpoint created");
      setRevealedSecret(data.secretRevealed);
      utils.webhooks.listEndpoints.invalidate();
      setForm({ url: "", events: [], description: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.webhooks.updateEndpoint.useMutation({
    onSuccess: () => { toast.success("Endpoint updated"); utils.webhooks.listEndpoints.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.webhooks.deleteEndpoint.useMutation({
    onSuccess: () => { toast.success("Endpoint deleted"); utils.webhooks.listEndpoints.invalidate(); setSelectedEndpoint(null); },
    onError: (e) => toast.error(e.message),
  });

  const rotateMutation = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: (data) => { toast.success("Secret rotated"); setRevealedSecret(data.secretRevealed); setShowSecret(true); },
    onError: (e) => toast.error(e.message),
  });

  const toggleEvent = (event: string) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event],
    }));
  };

  const handleCreate = () => {
    if (!form.url || form.events.length === 0) {
      toast.error("URL and at least one event are required");
      return;
    }
    createMutation.mutate(form);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Webhook Manager</h1>
            <p className="text-muted-foreground text-sm mt-1">Receive real-time event notifications via HTTP callbacks</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> Add Endpoint</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Webhook Endpoint</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Endpoint URL *</Label>
                  <Input placeholder="https://your-app.com/webhooks/remitflow" value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input placeholder="Optional description" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <Label>Events to Subscribe *</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto">
                    {AVAILABLE_EVENTS.map(event => (
                      <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={form.events.includes(event)} onChange={() => toggleEvent(event)}
                          className="rounded" />
                        <span className="text-muted-foreground">{event}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? "Creating..." : "Create Endpoint"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Secret reveal banner */}
        {revealedSecret && (
          <Card className="border-yellow-500/30 bg-yellow-500/10">
            <CardContent className="p-4">
              <p className="text-yellow-400 text-sm font-medium mb-2">
                ⚠️ Save this webhook secret — it will not be shown again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-black/30 rounded px-3 py-2 font-mono">
                  {showSecret ? revealedSecret : "whsec_" + "•".repeat(40)}
                </code>
                <Button variant="ghost" size="sm" onClick={() => setShowSecret(!showSecret)}>
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(revealedSecret)}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground"
                onClick={() => setRevealedSecret(null)}>
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Endpoints List */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Endpoints ({endpoints?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted/30 rounded animate-pulse" />)}</div>
              ) : (endpoints?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Webhook className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No endpoints configured</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {endpoints?.map((ep: any) => (
                    <div key={ep.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedEndpoint === ep.id ? "border-primary bg-primary/5" : "border-border hover:border-border/80"}`}
                      onClick={() => setSelectedEndpoint(ep.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ep.url}</p>
                          {ep.description && <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(ep.events as string[]).slice(0, 3).map((e: string) => (
                              <span key={e} className="text-xs bg-muted/50 rounded px-1.5 py-0.5">{e}</span>
                            ))}
                            {ep.events.length > 3 && <span className="text-xs text-muted-foreground">+{ep.events.length - 3} more</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch checked={ep.isActive}
                            onCheckedChange={v => updateMutation.mutate({ id: ep.id, isActive: v })} />
                          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 h-7 w-7 p-0"
                            onClick={e => { e.stopPropagation(); deleteMutation.mutate({ id: ep.id }); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      {ep.failureCount > 0 && (
                        <p className="text-xs text-red-400 mt-1">{ep.failureCount} delivery failures</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Delivery History */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                {selectedEndpoint ? "Delivery History" : "Select an endpoint"}
                {selectedEndpoint && (
                  <Button variant="ghost" size="sm" onClick={() => rotateMutation.mutate({ id: selectedEndpoint })}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Rotate Secret
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedEndpoint ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">Click an endpoint to view delivery history</p>
                </div>
              ) : (deliveriesData?.deliveries?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No deliveries yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {deliveriesData?.deliveries?.map((d: any) => {
                    const Icon = STATUS_ICON[d.status] ?? Clock;
                    return (
                      <div key={d.id} className="flex items-center gap-3 p-2 rounded border border-border/50 text-sm">
                        <Icon className={`w-4 h-4 shrink-0 ${d.status === "delivered" ? "text-green-400" : d.status === "failed" ? "text-red-400" : "text-yellow-400"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{d.eventType}</p>
                          <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</p>
                        </div>
                        {d.responseStatus && (
                          <span className={`text-xs font-mono ${d.responseStatus >= 200 && d.responseStatus < 300 ? "text-green-400" : "text-red-400"}`}>
                            {d.responseStatus}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">#{d.attemptCount}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                    <Button variant="ghost" size="sm" disabled={deliveryOffset === 0} onClick={() => setDeliveryOffset(Math.max(0, deliveryOffset - 20))}>Previous</Button>
                    <Button variant="ghost" size="sm" disabled={deliveryOffset + 20 >= (deliveriesData?.total ?? 0)} onClick={() => setDeliveryOffset(deliveryOffset + 20)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
