import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Monitor, Plus, Search, Wifi, WifiOff, MapPin, Activity, DollarSign, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function POSManagement() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [newForm, setNewForm] = useState({ location: "", merchantName: "", serialNumber: "" });
  const { data: terminals, refetch } = trpc.pos.terminals.useQuery();
  const { data: txns } = trpc.pos.transactions.useQuery({ limit: 20 });
  const registerMutation = trpc.pos.register.useMutation({
    onSuccess: (data) => { toast.success(`Terminal ${data.terminalId} provisioned (ID: ${data.id})`); setAddOpen(false); setNewForm({ location: "", merchantName: "", serialNumber: "" }); refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const updateStatusMutation = trpc.pos.updateStatus.useMutation({
    onSuccess: () => { toast.success("Terminal status updated"); setSelected(null); refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const restartMutation = trpc.pos.restart.useMutation({
    onSuccess: (data) => { toast.success(data.message ?? "Terminal restarted"); setSelected(null); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const filtered = (terminals ?? []).filter((t: any) =>
    !search ||
    t.location?.toLowerCase().includes(search.toLowerCase()) ||
    (t.terminalId ?? t.serialNumber ?? "").toLowerCase().includes(search.toLowerCase())
  );
  const totalVolume = (terminals ?? []).reduce((s: number, t: any) => s + (t.dailyVolume ?? 0), 0);
  const totalTxns = (terminals ?? []).reduce((s: number, t: any) => s + (t.transactionCount ?? 0), 0);
  const onlineCount = (terminals ?? []).filter((t: any) => t.status === "active" || t.status === "online").length;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              <Monitor className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">POS Management</h1>
              <p className="text-muted-foreground text-sm">Manage point-of-sale terminals and transactions</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />Add Terminal
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Terminals", value: (terminals ?? []).length, icon: Monitor, color: "text-foreground" },
            { label: "Online", value: onlineCount, icon: Wifi, color: "text-emerald-500" },
            { label: "Today Volume", value: `₦${(totalVolume / 1000).toFixed(0)}K`, icon: DollarSign, color: "text-blue-500" },
            { label: "Transactions", value: totalTxns, icon: Activity, color: "text-purple-500" },
          ].map(s => {
            const Icon = s.icon;
            return (
              <Card key={s.label}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Icon className={`h-5 w-5 ${s.color}`} />
                  <div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by location or terminal ID..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Terminal List */}
        <div className="space-y-2">
          {filtered.map((t: any) => {
            const isOnline = t.status === "active" || t.status === "online";
            return (
              <Card key={t.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelected(t)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isOnline ? "bg-emerald-100" : "bg-red-100"}`}>
                    {isOnline ? <Wifi className="h-5 w-5 text-emerald-600" /> : <WifiOff className="h-5 w-5 text-red-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{t.terminalId ?? t.serialNumber}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{t.location}
                    </div>
                    <div className="text-xs text-muted-foreground">Merchant: {t.merchant ?? t.merchantName ?? "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">₦{(t.dailyVolume ?? 0).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">{t.transactionCount ?? 0} txns today</div>
                    <Badge variant={isOnline ? "default" : "secondary"} className="text-xs capitalize mt-1">{t.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No terminals found{search ? ` matching "${search}"` : ""}</p>
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        {(txns ?? []).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />Recent POS Transactions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(txns ?? []).slice(0, 8).map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="text-sm font-medium">{tx.description ?? "POS Payment"}</div>
                    <div className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{tx.currency} {Number(tx.amount).toLocaleString()}</div>
                    <Badge variant="outline" className="text-xs capitalize">{tx.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Add Terminal Dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Provision New Terminal</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Terminal serial number (e.g. POS-004-NG)" value={newForm.serialNumber} onChange={e => setNewForm(p => ({ ...p, serialNumber: e.target.value }))} />
              <Input placeholder="Merchant name" value={newForm.merchantName} onChange={e => setNewForm(p => ({ ...p, merchantName: e.target.value }))} />
              <Input placeholder="Location (e.g. Kano Branch)" value={newForm.location} onChange={e => setNewForm(p => ({ ...p, location: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button disabled={!newForm.serialNumber || !newForm.location || registerMutation.isPending} onClick={() => registerMutation.mutate({ terminalId: newForm.serialNumber, merchantName: newForm.merchantName || newForm.serialNumber, location: newForm.location, serialNumber: newForm.serialNumber })}>{registerMutation.isPending ? "Provisioning…" : "Provision"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Terminal Detail Dialog */}
        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Terminal: {selected?.terminalId ?? selected?.serialNumber}</DialogTitle></DialogHeader>
            {selected && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { l: "Location", v: selected.location },
                    { l: "Status", v: selected.status },
                    { l: "Daily Volume", v: `₦${(selected.dailyVolume ?? 0).toLocaleString()}` },
                    { l: "Transactions", v: selected.transactionCount ?? 0 },
                    { l: "Last Transaction", v: selected.lastTransaction ? new Date(selected.lastTransaction).toLocaleString() : "—" },
                    { l: "Serial", v: selected.serialNumber ?? "—" },
                  ].map(r => (
                    <div key={r.l} className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">{r.l}</div>
                      <div className="font-medium">{String(r.v)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => updateStatusMutation.mutate({ id: selected.id, status: "suspended" })}>Suspend</Button>
                <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate({ id: selected.id, status: "active" })}>Activate</Button>
                </div>
                <Button className="w-full" variant="outline" disabled={restartMutation.isPending} onClick={() => restartMutation.mutate({ id: selected.id })}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${restartMutation.isPending ? "animate-spin" : ""}`} />{restartMutation.isPending ? "Restarting…" : "Restart Terminal"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
