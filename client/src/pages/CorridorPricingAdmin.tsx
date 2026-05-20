import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowRightLeft,
  TrendingUp,
  Clock,
  DollarSign,
  Activity,
  Settings2,
  RefreshCw,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  History,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Corridor {
  id: number | string;
  from: string;
  to: string;
  rate: number;
  fee: number;
  minAmount: number;
  maxAmount: number;
  deliveryTime: string;
  provider: string;
  popular: boolean;
  enabled?: boolean;
  marginPercent?: number;
  slaMinutes?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currencyFlag(code: string) {
  const flags: Record<string, string> = {
    USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", NGN: "🇳🇬",
    KES: "🇰🇪", GHS: "🇬🇭", ZAR: "🇿🇦", TZS: "🇹🇿",
  };
  return flags[code] ?? "🌐";
}

function deliveryTimeToMinutes(dt: string): number {
  if (dt.toLowerCase().includes("instant")) return 5;
  if (dt.toLowerCase().includes("1-2 hour")) return 90;
  if (dt.toLowerCase().includes("2-4 hour")) return 180;
  if (dt.toLowerCase().includes("same day")) return 480;
  if (dt.toLowerCase().includes("1-2 day")) return 1440;
  return 120;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CorridorPricingAdmin() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [editingCorridor, setEditingCorridor] = useState<Corridor | null>(null);
  const [editMode, setEditMode] = useState<"margin" | "delivery" | null>(null);
  const [newMargin, setNewMargin] = useState(0.5);
  const [marginReason, setMarginReason] = useState("");
  const [newDeliveryTime, setNewDeliveryTime] = useState("");
  const [newSlaMinutes, setNewSlaMinutes] = useState(120);
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<Corridor>>>({});

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: corridorsData, isLoading: corridorsLoading, refetch: refetchCorridors } =
    trpc.corridorPricing.list.useQuery();

  const { data: adminStats, isLoading: statsLoading, refetch: refetchStats } =
    trpc.corridorPricingV2.getAdminStats.useQuery();

  const { data: fxRates } = trpc.corridorPricingV2.getFXRates.useQuery();
  const [historyCorridorFilter, setHistoryCorridorFilter] = useState<string | undefined>(undefined);
  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } =
    trpc.corridorPricingV2.getMarginHistory.useQuery({ limit: 50, corridorId: historyCorridorFilter });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateMarginMutation = trpc.corridorPricingV2.updateMargin.useMutation({
    onSuccess: () => {
      if (editingCorridor) {
        setLocalOverrides(prev => ({
          ...prev,
          [editingCorridor.id]: {
            ...prev[editingCorridor.id],
            marginPercent: newMargin,
            fee: newMargin / 100,
          },
        }));
      }
      toast.success(`Corridor margin set to ${newMargin}%`);
      setEditingCorridor(null);
      setEditMode(null);
      refetchStats();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const setDeliveryMutation = trpc.corridorPricingV2.setDeliveryTime.useMutation({
    onSuccess: () => {
      if (editingCorridor) {
        setLocalOverrides(prev => ({
          ...prev,
          [editingCorridor.id]: {
            ...prev[editingCorridor.id],
            deliveryTime: newDeliveryTime,
            slaMinutes: newSlaMinutes,
          },
        }));
      }
      toast.success(`Delivery time set to ${newDeliveryTime}`);
      setEditingCorridor(null);
      setEditMode(null);
      refetchStats();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const [lastToggle, setLastToggle] = useState<{ corridorId: string; enabled: boolean } | null>(null);
  const toggleMutation = trpc.corridorPricingV2.toggleCorridor.useMutation({
    onSuccess: () => {
      if (lastToggle) {
        const { corridorId, enabled } = lastToggle;
        setLocalOverrides(prev => ({
          ...prev,
          [corridorId]: { ...prev[corridorId], enabled },
        }));
        toast.success(`Corridor ${corridorId} is now ${enabled ? "active" : "paused"}.`);
      }
      refetchStats();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // ── Derived data ───────────────────────────────────────────────────────────
  const corridors: Corridor[] = (corridorsData ?? []).map((c: Corridor) => ({
    ...c,
    enabled: localOverrides[c.id]?.enabled ?? true,
    marginPercent: localOverrides[c.id]?.marginPercent ?? (c.fee * 100),
    deliveryTime: localOverrides[c.id]?.deliveryTime ?? c.deliveryTime,
    slaMinutes: localOverrides[c.id]?.slaMinutes ?? deliveryTimeToMinutes(c.deliveryTime),
  }));

  // ── Handlers ───────────────────────────────────────────────────────────────
  function openMarginEdit(corridor: Corridor) {
    setEditingCorridor(corridor);
    setNewMargin(corridor.marginPercent ?? corridor.fee * 100);
    setMarginReason("");
    setEditMode("margin");
  }

  function openDeliveryEdit(corridor: Corridor) {
    setEditingCorridor(corridor);
    setNewDeliveryTime(corridor.deliveryTime);
    setNewSlaMinutes(corridor.slaMinutes ?? deliveryTimeToMinutes(corridor.deliveryTime));
    setEditMode("delivery");
  }

  function handleMarginSave() {
    if (!editingCorridor) return;
    updateMarginMutation.mutate({
      corridorId: editingCorridor.id.toString(),
      marginPercent: newMargin,
      reason: marginReason || undefined,
    });
  }

  function handleDeliverySave() {
    if (!editingCorridor) return;
    setDeliveryMutation.mutate({
      corridorId: editingCorridor.id.toString(),
      deliveryTime: newDeliveryTime,
      slaMinutes: newSlaMinutes,
    });
  }

  function handleToggle(corridor: Corridor) {
    const newEnabled = !(corridor.enabled ?? true);
    setLastToggle({ corridorId: corridor.id.toString(), enabled: newEnabled });
    toggleMutation.mutate({
      corridorId: corridor.id.toString(),
      enabled: newEnabled,
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-6 h-6 text-primary" />
              Corridor Pricing Admin
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage FX margins, delivery SLAs, and corridor availability in real time.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchCorridors(); refetchStats(); }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={BarChart3}
            label="Total Corridors"
            value={statsLoading ? "—" : (adminStats as any)?.totalCorridors ?? corridors.length}
          />
          <StatCard
            icon={CheckCircle2}
            label="Active"
            value={statsLoading ? "—" : (adminStats as any)?.activeCorridors ?? corridors.filter(c => c.enabled !== false).length}
            color="text-green-500"
          />
          <StatCard
            icon={PauseCircle}
            label="Paused"
            value={statsLoading ? "—" : (adminStats as any)?.pausedCorridors ?? corridors.filter(c => c.enabled === false).length}
            color="text-yellow-500"
          />
          <StatCard
            icon={TrendingUp}
            label="Avg Margin"
            value={statsLoading ? "—" : `${((adminStats as any)?.avgMarginPercent ?? 0.5).toFixed(2)}%`}
            sub="across all corridors"
          />
        </div>

        {/* FX Rates Banner */}
        {fxRates && (fxRates as any).rates && (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Activity className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs font-medium text-muted-foreground">Live FX Rates:</span>
                {Object.entries((fxRates as any).rates as Record<string, number>).slice(0, 8).map(([pair, rate]) => (
                  <Badge key={pair} variant="secondary" className="text-xs font-mono">
                    {pair}: {typeof rate === "number" ? rate.toFixed(4) : rate}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Corridors Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Corridor Configuration</CardTitle>
            <CardDescription>
              Click the margin or SLA buttons to edit. Toggle the switch to enable/disable a corridor.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {corridorsLoading ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                Loading corridors…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corridor</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead>Delivery SLA</TableHead>
                    <TableHead className="text-right">Min / Max</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corridors.map((corridor) => {
                    const isEnabled = corridor.enabled !== false;
                    return (
                      <TableRow key={corridor.id} className={!isEnabled ? "opacity-50" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {currencyFlag(corridor.from)}{currencyFlag(corridor.to)}
                            </span>
                            <div>
                              <p className="font-semibold text-sm">
                                {corridor.from} → {corridor.to}
                              </p>
                              {corridor.popular && (
                                <Badge variant="secondary" className="text-xs mt-0.5">Popular</Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {corridor.rate.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <button
                            onClick={() => openMarginEdit(corridor)}
                            className="font-mono text-sm text-primary hover:underline"
                          >
                            {((corridor.marginPercent ?? corridor.fee * 100)).toFixed(2)}%
                          </button>
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => openDeliveryEdit(corridor)}
                            className="flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            {corridor.deliveryTime}
                          </button>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          ${corridor.minAmount} / ${corridor.maxAmount.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={() => handleToggle(corridor)}
                              disabled={toggleMutation.isPending}
                            />
                            <span className="text-xs text-muted-foreground">
                              {isEnabled ? "Active" : "Paused"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openMarginEdit(corridor)}
                              title="Edit margin"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openDeliveryEdit(corridor)}
                              title="Edit delivery SLA"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Margin Edit Dialog */}
        <Dialog open={editMode === "margin"} onOpenChange={(o) => { if (!o) { setEditMode(null); setEditingCorridor(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-primary" />
                Edit FX Margin
              </DialogTitle>
              <DialogDescription>
                {editingCorridor && (
                  <>
                    {currencyFlag(editingCorridor.from)} {editingCorridor.from} →{" "}
                    {currencyFlag(editingCorridor.to)} {editingCorridor.to}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Margin Percentage</Label>
                  <span className="text-2xl font-bold text-primary">{newMargin.toFixed(2)}%</span>
                </div>
                <Slider
                  min={0}
                  max={5}
                  step={0.05}
                  value={[newMargin]}
                  onValueChange={([v]) => setNewMargin(v)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0% (no margin)</span>
                  <span>2.5% (standard)</span>
                  <span>5% (max)</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="margin-reason">Reason for change (optional)</Label>
                <Input
                  id="margin-reason"
                  placeholder="e.g. Market volatility adjustment"
                  value={marginReason}
                  onChange={(e) => setMarginReason(e.target.value)}
                />
              </div>

              {newMargin > 3 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    Margins above 3% may reduce conversion rates. Consider competitive benchmarking before applying.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditMode(null); setEditingCorridor(null); }}>
                Cancel
              </Button>
              <Button onClick={handleMarginSave} disabled={updateMarginMutation.isPending}>
                {updateMarginMutation.isPending ? "Saving…" : "Save Margin"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delivery SLA Edit Dialog */}
        <Dialog open={editMode === "delivery"} onOpenChange={(o) => { if (!o) { setEditMode(null); setEditingCorridor(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Edit Delivery SLA
              </DialogTitle>
              <DialogDescription>
                {editingCorridor && (
                  <>
                    {currencyFlag(editingCorridor.from)} {editingCorridor.from} →{" "}
                    {currencyFlag(editingCorridor.to)} {editingCorridor.to}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <Label htmlFor="delivery-label">Display Label</Label>
                <Input
                  id="delivery-label"
                  placeholder="e.g. 1-2 hours, Instant, Same day"
                  value={newDeliveryTime}
                  onChange={(e) => setNewDeliveryTime(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  This label is shown to customers in the send-money flow.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>SLA (minutes)</Label>
                  <span className="text-xl font-bold text-primary">
                    {newSlaMinutes < 60
                      ? `${newSlaMinutes}m`
                      : `${Math.floor(newSlaMinutes / 60)}h ${newSlaMinutes % 60 > 0 ? `${newSlaMinutes % 60}m` : ""}`}
                  </span>
                </div>
                <Slider
                  min={5}
                  max={10080}
                  step={5}
                  value={[newSlaMinutes]}
                  onValueChange={([v]) => setNewSlaMinutes(v)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5 min</span>
                  <span>4 hours</span>
                  <span>7 days</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditMode(null); setEditingCorridor(null); }}>
                Cancel
              </Button>
              <Button onClick={handleDeliverySave} disabled={setDeliveryMutation.isPending || !newDeliveryTime.trim()}>
                {setDeliveryMutation.isPending ? "Saving…" : "Save SLA"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      {/* Change Log Panel */}
      <Card className="mt-2">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Corridor Change Log</CardTitle>
            {historyData && (
              <Badge variant="secondary" className="text-xs">{historyData.total} entries</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="text-xs border rounded px-2 py-1 bg-background"
              value={historyCorridorFilter ?? ""}
              onChange={e => setHistoryCorridorFilter(e.target.value || undefined)}
            >
              <option value="">All corridors</option>
              {["USD-NGN","GBP-NGN","EUR-NGN","USD-GHS","USD-KES","USD-ZAR","USD-TZS","USD-UGX"].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={() => refetchHistory()}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading history…</div>
          ) : !historyData?.rows?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No changes recorded yet. Margin, SLA, and toggle changes will appear here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Corridor</TableHead>
                  <TableHead className="text-xs">Change</TableHead>
                  <TableHead className="text-xs">Old Value</TableHead>
                  <TableHead className="text-xs">New Value</TableHead>
                  <TableHead className="text-xs">Changed By</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.rows.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-mono font-medium">{row.corridorId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {row.changeType.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.oldValue ?? "—"}</TableCell>
                    <TableCell className="text-xs font-medium">{row.newValue}</TableCell>
                    <TableCell className="text-xs">{row.changedByName ?? `User #${row.changedBy}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{row.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {historyData && historyData.total > 50 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
              Showing 50 of {historyData.total} entries
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </DashboardLayout>
  );
}
