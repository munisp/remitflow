/**
 * BillingEngineDashboard.tsx
 *
 * Real-time billing engine dashboard for RemitFlow platform operators.
 * Shows per-transaction economics, P&L by corridor, platform/IMTO split,
 * billing config management, and full audit trail.
 *
 * Access: admin + billing:analyst roles only
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMinor(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatPct(value: number | string): string {
  return `${parseFloat(String(value)).toFixed(2)}%`;
}

function PnLCard({ label, value, sub, color = "text-foreground" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BillingEngineDashboard() {
  const { user } = useAuth();
  const [periodDays, setPeriodDays] = useState("30");
  const [tenantId] = useState("default");
  const [configChangeReason, setConfigChangeReason] = useState("");
  const [newFeePercentage, setNewFeePercentage] = useState("");
  const [newPlatformShare, setNewPlatformShare] = useState("");
  const [newFxSpread, setNewFxSpread] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────
  const pnlQuery = trpc.billingEngine.getTenantPnL.useQuery({
    tenantId,
    periodDays: parseInt(periodDays),
  });

  const corridorQuery = trpc.billingEngine.getCorridorBreakdown.useQuery({
    tenantId,
    periodDays: parseInt(periodDays),
  });

  const eventsQuery = trpc.billingEngine.listBillingEvents.useQuery({
    tenantId,
    limit: 50,
    offset: 0,
  });

  const configQuery = trpc.billingEngine.getBillingConfig.useQuery({ tenantId });

  const auditQuery = trpc.billingEngine.getAuditLog.useQuery({
    tenantId,
    limit: 30,
    offset: 0,
  });

  const healthQuery = trpc.billingEngine.health.useQuery();

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateConfig = trpc.billingEngine.updateBillingConfig.useMutation({
    onSuccess: () => {
      toast.success("Billing config updated — Changes saved and audit log recorded.");
      configQuery.refetch();
      auditQuery.refetch();
      setConfigChangeReason("");
      setNewFeePercentage("");
      setNewPlatformShare("");
      setNewFxSpread("");
    },
    onError: (err) => {
      toast.error(`Update failed: ${err.message}`);
    },
  });

  const handleConfigUpdate = () => {
    if (!configChangeReason || configChangeReason.length < 10) {
      toast.error("Change reason required — Please provide at least 10 characters explaining the change.");
      return;
    }
    const updates: Record<string, string | number> = { tenantId, changeReason: configChangeReason };
    if (newFeePercentage) updates.feePercentage = newFeePercentage;
    if (newPlatformShare) updates.platformFeeSharePct = newPlatformShare;
    if (newFxSpread) updates.fxSpreadPercentage = newFxSpread;
    updateConfig.mutate(updates as Parameters<typeof updateConfig.mutate>[0]);
  };

  const pnl = pnlQuery.data;
  const config = configQuery.data;

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Access restricted to admin users.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Billing Engine</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time per-transaction economics, P&amp;L, and IMTO partner profit sharing
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={healthQuery.data?.goEngine === "connected" ? "default" : "secondary"}>
              Go Engine: {healthQuery.data?.goEngine ?? "checking..."}
            </Badge>
            <Select value={periodDays} onValueChange={setPeriodDays}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* P&L KPI Cards */}
        {pnl && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <PnLCard
              label="Total Volume"
              value={formatMinor(pnl.totalSendVolumeMinor)}
              sub={`${pnl.totalTransactions.toLocaleString()} transactions`}
            />
            <PnLCard
              label="Total Fees Collected"
              value={formatMinor(pnl.totalFeeMinor)}
              sub="Transfer fee revenue"
            />
            <PnLCard
              label="Platform Fee Share"
              value={formatMinor(pnl.platformFeeMinor)}
              color="text-emerald-500"
              sub="Platform's cut of fees"
            />
            <PnLCard
              label="IMTO Partner Share"
              value={formatMinor(pnl.partnerFeeMinor)}
              sub="Partner's cut of fees"
            />
            <PnLCard
              label="Net FX Revenue"
              value={formatMinor(pnl.netFxRevenueMinor)}
              color="text-blue-500"
              sub={`After ${formatMinor(pnl.fxHedgeCostMinor)} hedge cost`}
            />
            <PnLCard
              label="Net Platform Profit"
              value={formatMinor(pnl.netProfitMinor)}
              color={pnl.netProfitMinor >= 0 ? "text-emerald-500" : "text-red-500"}
              sub={`${pnl.avgMarginPct}% avg margin`}
            />
          </div>
        )}

        {/* Cost Breakdown */}
        {pnl && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cost Breakdown (Last {periodDays} days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">FX Hedge Cost</p>
                  <p className="font-semibold text-orange-500">{formatMinor(pnl.fxHedgeCostMinor)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payout Network Cost</p>
                  <p className="font-semibold text-orange-500">{formatMinor(pnl.payoutCostMinor)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Allocated Overhead</p>
                  <p className="font-semibold text-orange-500">{formatMinor(pnl.overheadMinor)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Costs</p>
                  <p className="font-semibold text-red-500">
                    {formatMinor(pnl.fxHedgeCostMinor + pnl.payoutCostMinor + pnl.overheadMinor)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="corridors">
          <TabsList>
            <TabsTrigger value="corridors">Corridor P&amp;L</TabsTrigger>
            <TabsTrigger value="events">Billing Events</TabsTrigger>
            <TabsTrigger value="config">Billing Config</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          {/* Corridor Breakdown */}
          <TabsContent value="corridors">
            <Card>
              <CardHeader>
                <CardTitle>Per-Corridor Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {corridorQuery.isLoading ? (
                  <p className="text-muted-foreground text-sm">Loading...</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Corridor</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Total Volume</TableHead>
                        <TableHead className="text-right">Avg Send</TableHead>
                        <TableHead className="text-right">Total Fees</TableHead>
                        <TableHead className="text-right">Net FX Revenue</TableHead>
                        <TableHead className="text-right">Net Profit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(corridorQuery.data ?? []).map((row: any) => (
                        <TableRow key={`${row.corridor}-${row.sendCurrency}`}>
                          <TableCell className="font-medium">{row.corridor}</TableCell>
                          <TableCell>{row.sendCurrency}</TableCell>
                          <TableCell className="text-right">{Number(row.transactionCount).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{formatMinor(Number(row.totalSendMinor), row.sendCurrency ?? "GBP")}</TableCell>
                          <TableCell className="text-right">{formatMinor(Number(row.avgSendMinor), row.sendCurrency ?? "GBP")}</TableCell>
                          <TableCell className="text-right">{formatMinor(Number(row.totalFeeMinor), row.sendCurrency ?? "GBP")}</TableCell>
                          <TableCell className="text-right">{formatMinor(Number(row.netFxRevenueMinor), row.sendCurrency ?? "GBP")}</TableCell>
                          <TableCell className={`text-right font-semibold ${Number(row.netProfitMinor) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {formatMinor(Number(row.netProfitMinor), row.sendCurrency ?? "GBP")}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(corridorQuery.data ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                            No billing events yet. Events are created automatically when transfers are processed.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Events */}
          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>Recent Billing Events ({eventsQuery.data?.total ?? 0} total)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event ID</TableHead>
                      <TableHead>Corridor</TableHead>
                      <TableHead>Send Amount</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Platform Share</TableHead>
                      <TableHead>Partner Share</TableHead>
                      <TableHead>FX Spread</TableHead>
                      <TableHead>Net Profit</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(eventsQuery.data?.events ?? []).map((ev: any) => (
                      <TableRow key={ev.eventId}>
                        <TableCell className="font-mono text-xs">{ev.eventId.slice(0, 12)}…</TableCell>
                        <TableCell>{ev.corridor}</TableCell>
                        <TableCell>{formatMinor(ev.sendAmountMinor, ev.sendCurrency ?? "GBP")}</TableCell>
                        <TableCell>{formatMinor(ev.transferFeeMinor, ev.sendCurrency ?? "GBP")}</TableCell>
                        <TableCell className="text-emerald-600">{formatMinor(ev.platformFeeShareMinor, ev.sendCurrency ?? "GBP")}</TableCell>
                        <TableCell className="text-blue-600">{formatMinor(ev.partnerFeeShareMinor, ev.sendCurrency ?? "GBP")}</TableCell>
                        <TableCell>{formatMinor(ev.fxSpreadMinor, ev.sendCurrency ?? "GBP")}</TableCell>
                        <TableCell className={`font-semibold ${ev.netPlatformProfitMinor >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {formatMinor(ev.netPlatformProfitMinor, ev.sendCurrency ?? "GBP")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ev.settlementStatus === "SETTLED" ? "default" : "secondary"}>
                            {ev.settlementStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(ev.eventTimestampMs).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(eventsQuery.data?.events ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          No billing events yet. Events are created automatically when transfers are processed.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Config */}
          <TabsContent value="config">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Current Config */}
              <Card>
                <CardHeader>
                  <CardTitle>Current Billing Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {config ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fee Mode</span>
                        <Badge>{config.feeMode}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fee Percentage</span>
                        <span className="font-semibold">{formatPct(config.feePercentage ?? "1.5")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fee Floor / Cap</span>
                        <span>{formatMinor(config.feeFloorMinor ?? 100)} / {formatMinor(config.feeCapMinor ?? 2000)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">FX Spread</span>
                        <span className="font-semibold">{formatPct(config.fxSpreadPercentage ?? "0.8")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hedge Cost</span>
                        <span>{formatPct(config.hedgeCostPercentage ?? "0.15")}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Platform Fee Share</span>
                        <span className="font-semibold text-emerald-600">{formatPct(config.platformFeeSharePct ?? "40")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IMTO Partner Fee Share</span>
                        <span className="font-semibold text-blue-600">
                          {formatPct(100 - parseFloat(String(config.platformFeeSharePct ?? "40")))}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Platform FX Share</span>
                        <span>{formatPct(config.platformFxSharePct ?? "100")}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Overhead per Tx</span>
                        <span>{formatMinor(config.overheadPerTxMinor ?? 50)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Config Version</span>
                        <span className="font-mono text-xs">{config.version}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">No active config found. Default values will be used.</p>
                  )}
                </CardContent>
              </Card>

              {/* Update Config */}
              <Card>
                <CardHeader>
                  <CardTitle>Update Billing Config</CardTitle>
                  <p className="text-xs text-muted-foreground">All changes are audited and trigger admin notifications.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <Label>New Fee Percentage (e.g. 1.5000)</Label>
                    <Input
                      placeholder={`Current: ${config?.feePercentage ?? "1.5000"}`}
                      value={newFeePercentage}
                      onChange={(e) => setNewFeePercentage(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Platform Fee Share % (e.g. 40.0000)</Label>
                    <Input
                      placeholder={`Current: ${config?.platformFeeSharePct ?? "40.0000"}`}
                      value={newPlatformShare}
                      onChange={(e) => setNewPlatformShare(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>FX Spread % (e.g. 0.8000)</Label>
                    <Input
                      placeholder={`Current: ${config?.fxSpreadPercentage ?? "0.8000"}`}
                      value={newFxSpread}
                      onChange={(e) => setNewFxSpread(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Change Reason (required, min 10 chars)</Label>
                    <Input
                      placeholder="e.g. Adjusting fee for UK-NG corridor Q3 2026"
                      value={configChangeReason}
                      onChange={(e) => setConfigChangeReason(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleConfigUpdate}
                    disabled={updateConfig.isPending || !configChangeReason}
                    className="w-full"
                  >
                    {updateConfig.isPending ? "Saving..." : "Save Config Changes"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Audit Log */}
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle>Billing Audit Log</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Every billing config change is immutably recorded here. Notifications are sent to the platform owner.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event Type</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(auditQuery.data?.entries ?? []).map((entry: any) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <Badge variant={entry.eventType === "TENANT_PROVISIONED" ? "default" : "secondary"}>
                            {entry.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{entry.entityType}/{entry.entityId.slice(0, 16)}</TableCell>
                        <TableCell className="text-xs">{entry.actorUserId}</TableCell>
                        <TableCell><Badge variant="outline">{entry.actorRole}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(entry.occurredAtMs).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(auditQuery.data?.entries ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No audit entries yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
