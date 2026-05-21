import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function FXAlerts() {
  const { t } = useTranslation();
  
  const { data: alerts, refetch, isError } = trpc.fx.alerts.useQuery();
  const createMutation = trpc.fx.createAlert.useMutation({ onSuccess: () => { toast.success("Alert created!"); refetch(); setOpen(false); } });
  const deleteMutation = trpc.fx.deleteAlert.useMutation({ onSuccess: () => { toast.success("Alert deleted"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fromCurrency: "USD", toCurrency: "NGN", targetRate: "", direction: "above" });

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">FX Rate Alerts</h1><p className="text-muted-foreground text-sm">Get notified when rates hit your target</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Alert</Button>
        </div>
        <div className="space-y-3">
          {(alerts ?? []).map((alert: any) => (
            <Card key={alert.id} className={alert.triggered ? "border-emerald-300 bg-emerald-50/50" : ""}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${alert.direction === "above" ? "bg-emerald-100" : "bg-red-50"}`}>
                  {alert.direction === "above" ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{alert.fromCurrency}/{alert.toCurrency}</div>
                  <div className="text-sm text-muted-foreground">
                    Alert when rate goes {alert.direction} {Number(alert.targetRate).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Current: {Number(alert.currentRate ?? 0).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  {alert.triggered && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Triggered!</Badge>}
                  <Badge variant={alert.isActive ? "default" : "secondary"} className="text-xs">{alert.isActive ? "Active" : "Paused"}</Badge>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate({ id: alert.id })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!alerts || alerts.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No alerts set. Create one to get notified when rates move.</p>
            </div>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Rate Alert</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">From</label>
                <Select value={form.fromCurrency} onValueChange={v => setForm(p => ({ ...p, fromCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["USD","GBP","EUR","CAD","AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">To</label>
                <Select value={form.toCurrency} onValueChange={v => setForm(p => ({ ...p, toCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["NGN","KES","GHS","ZAR","TZS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Target Rate</label>
              <Input type="number" placeholder="e.g. 1600" value={form.targetRate} onChange={e => setForm(p => ({ ...p, targetRate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Alert Direction</label>
              <Select value={form.direction} onValueChange={v => setForm(p => ({ ...p, direction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="above">Rate goes above target</SelectItem><SelectItem value="below">Rate goes below target</SelectItem></SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={!form.targetRate || createMutation.isPending}
              onClick={() => createMutation.mutate({ fromCurrency: form.fromCurrency, toCurrency: form.toCurrency, targetRate: parseFloat(form.targetRate), direction: form.direction as "above" | "below" })}>
              {createMutation.isPending ? "Creating..." : "Create Alert"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
