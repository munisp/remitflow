import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2, Plus, CheckCircle, Clock, XCircle, AlertTriangle,
  DollarSign, TrendingUp, ArrowRightLeft, RefreshCw, Shield,
  FileText, Banknote, Globe, Activity, History, Filter
} from "lucide-react";

// ─── Status Helpers ────────────────────────────────────────────────────────────

function PartnerStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    approved:       { label: "Approved",        variant: "default" },
    pending_review: { label: "Pending Review",  variant: "secondary" },
    suspended:      { label: "Suspended",       variant: "destructive" },
    rejected:       { label: "Rejected",        variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

function LiquidityStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending:   { label: "Pending",   color: "bg-yellow-100 text-yellow-800" },
    approved:  { label: "Approved",  color: "bg-green-100 text-green-800" },
    rejected:  { label: "Rejected",  color: "bg-red-100 text-red-800" },
    fulfilled: { label: "Fulfilled", color: "bg-blue-100 text-blue-800" },
  };
  const { label, color } = map[status] ?? { label: status, color: "bg-gray-100 text-gray-800" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>{label}</span>;
}

// ─── Register Partner Form ─────────────────────────────────────────────────────

function RegisterPartnerDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", cbnLicenceNumber: "", adbName: "", adbCode: "",
    contactEmail: "", contactPhone: "", maxDailyFxUsd: 100000, notes: "",
  });

  const create = trpc.cbnCompliance.createBdcPartner.useMutation({
    onSuccess: () => {
      toast("BDC Partner Registered", { description: "Application submitted for compliance review." });
      setOpen(false);
      onSuccess();
    },
    onError: (e) => toast.error("Registration Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" />Register BDC Partner</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register BDC Partner</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>BDC Name *</Label>
              <Input placeholder="e.g. Apex BDC Ltd" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>CBN Licence Number *</Label>
              <Input placeholder="BDC/2024/001" value={form.cbnLicenceNumber}
                onChange={e => setForm(f => ({ ...f, cbnLicenceNumber: e.target.value }))} />
            </div>
            <div>
              <Label>ADB Name *</Label>
              <Input placeholder="e.g. Zenith Bank" value={form.adbName}
                onChange={e => setForm(f => ({ ...f, adbName: e.target.value }))} />
            </div>
            <div>
              <Label>ADB Code</Label>
              <Input placeholder="e.g. 057" value={form.adbCode}
                onChange={e => setForm(f => ({ ...f, adbCode: e.target.value }))} />
            </div>
            <div>
              <Label>Max Daily FX (USD)</Label>
              <Input type="number" value={form.maxDailyFxUsd}
                onChange={e => setForm(f => ({ ...f, maxDailyFxUsd: parseInt(e.target.value) || 100000 }))} />
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input type="email" placeholder="compliance@bdcname.com" value={form.contactEmail}
                onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
            </div>
            <div>
              <Label>Contact Phone</Label>
              <Input placeholder="+234 800 000 0000" value={form.contactPhone}
                onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea placeholder="Additional compliance notes..." value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.name || !form.cbnLicenceNumber || !form.adbName}>
              {create.isPending ? "Submitting..." : "Submit Application"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Liquidity Request Form ────────────────────────────────────────────────────

function LiquidityRequestDialog({ partners, onSuccess }: { partners: any[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    bdcPartnerId: 0, requestedAmountUsd: 50000,
    bmatchRateAtRequest: "", settlementAccountId: undefined as number | undefined,
  });

  const create = trpc.cbnCompliance.createBdcLiquidityRequest.useMutation({
    onSuccess: () => {
      toast("Liquidity Request Submitted", { description: "Your FX liquidity request has been sent to the ADB." });
      setOpen(false);
      onSuccess();
    },
    onError: (e) => toast.error("Request Failed"),
  });

  const approvedPartners = partners.filter(p => p.status === "approved");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><ArrowRightLeft className="w-4 h-4 mr-2" />Request FX Liquidity</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request FX Liquidity</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>BDC Partner *</Label>
            <Select onValueChange={v => setForm(f => ({ ...f, bdcPartnerId: parseInt(v) }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select approved BDC partner" />
              </SelectTrigger>
              <SelectContent>
                {approvedPartners.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.adbName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Requested Amount (USD) *</Label>
            <Input type="number" value={form.requestedAmountUsd}
              onChange={e => setForm(f => ({ ...f, requestedAmountUsd: parseInt(e.target.value) || 0 }))} />
          </div>
          <div>
            <Label>BMATCH Rate at Request</Label>
            <Input placeholder="e.g. 1580.00" value={form.bmatchRateAtRequest}
              onChange={e => setForm(f => ({ ...f, bmatchRateAtRequest: e.target.value }))} />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Per CBN Circular March 24 2026, all FX liquidity must be sourced at BMATCH-aligned rates
            from your registered Authorised Dealer Bank (ADB).
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.bdcPartnerId || !form.requestedAmountUsd}>
              {create.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Approve Partner (Admin) ───────────────────────────────────────────────────

function ApprovePartnerButton({ partnerId, partnerName, onSuccess }: { partnerId: number; partnerName: string; onSuccess: () => void }) {
  const [onboardingCredentials, setOnboardingCredentials] = useState<any>(null);
  const approve = trpc.cbnCompliance.approveBdcPartner.useMutation({
    onSuccess: (data: any) => {
      toast("Partner Approved", { description: `${partnerName} is now an approved BDC partner. Onboarding email sent.` });
      if (data?.onboardingCredentials) setOnboardingCredentials(data.onboardingCredentials);
      onSuccess();
    },
    onError: (e) => toast.error("Approval Failed"),
  });
  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => approve.mutate({ id: partnerId })} disabled={approve.isPending}>
        <CheckCircle className="w-3 h-3 mr-1" />
        {approve.isPending ? "Approving..." : "Approve"}
      </Button>
      {onboardingCredentials && (
        <div className="mt-2 p-3 rounded-md bg-green-50 border border-green-200 text-xs space-y-1">
          <p className="font-semibold text-green-800">Onboarding Credentials Sent</p>
          <p className="text-green-700">Client ID: <span className="font-mono">{onboardingCredentials.keycloakClientId}</span></p>
          <p className="text-green-700">Gateway: <span className="font-mono">{onboardingCredentials.apisixGatewayUrl}</span></p>
          <p className="text-green-600 text-xs">Full credentials emailed to compliance officer.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function BDCPartnerPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const { data: partnersData, isLoading: loadingPartners, refetch: refetchPartners } = trpc.cbnCompliance.listBdcPartners.useQuery({});
  const partners = (partnersData as any[]) ?? [];

  const { data: dashboardData } = trpc.cbnCompliance.getComplianceDashboard.useQuery();
  const dashboard = dashboardData as any;

  const { data: ratesData } = trpc.cbnCompliance.getAllRatePairs.useQuery();
  const rates = (ratesData as any[]) ?? [];

  const { data: corridorsData } = trpc.cbnCompliance.getCbnCorridors.useQuery();
  const corridors = (corridorsData as any[]) ?? [];

  // Transfer History state
  const [historyStatus, setHistoryStatus] = useState<string>("all");
  const [historyPartnerId, setHistoryPartnerId] = useState<number | undefined>(undefined);
  const { data: liquidityHistoryData, isLoading: loadingHistory, refetch: refetchHistory } =
    trpc.cbnCompliance.listBdcLiquidityRequests.useQuery({
      status: historyStatus === "all" ? undefined : historyStatus as any,
      bdcPartnerId: historyPartnerId,
      limit: 100,
    });
  const liquidityHistory = (liquidityHistoryData as any)?.rows ?? [];
  const liquidityTotal = (liquidityHistoryData as any)?.total ?? 0;

  const approveLiquidity = trpc.cbnCompliance.approveLiquidityRequest.useMutation({
    onSuccess: () => {
      toast("Request Updated", { description: "Liquidity request status updated." });
      refetchHistory();
    },
    onError: (e) => toast.error("Update Failed"),
  });

  const bulkDisburse = trpc.cbnCompliance.bulkDisburseLiquidityRequests.useMutation({
    onSuccess: (data: any) => {
      toast("Bulk Disburse Complete", { description: `${data.disbursed} requests disbursed. Total: $${(data.totalUsd ?? 0).toLocaleString()} USD. Batch: ${data.batchRef}` });
      refetchHistory();
    },
    onError: (e) => toast.error("Bulk Disburse Failed"),
  });

  const liquidityApprovedCount = liquidityHistory.filter((r: any) => r.status === "approved").length;
  const [showDisburseDialog, setShowDisburseDialog] = useState(false);
  const [exportingCbn, setExportingCbn] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);

  // CBN filing CSV export (lazy — triggered on button click)
  const exportCbnFiling = trpc.cbnCompliance.exportCbnFilingCsv.useQuery(
    {},
    { enabled: false }
  );

  // Bulk approve pending BDC partners
  const bulkApprove = trpc.cbnCompliance.bulkApproveBdcPartners.useMutation({
    onSuccess: (data: any) => {
      toast("Bulk Approval Complete", { description: `${data.approved} partners approved, ${data.failed} skipped.` });
      refetchPartners();
    },
    onError: (e: any) => toast.error("Bulk Approval Failed", { description: e.message }),
  });

  const refresh = () => {
    refetchPartners();
    utils.cbnCompliance.getComplianceDashboard.invalidate();
  };

  // Stats
  const approvedCount = partners.filter((p: any) => p.status === "approved").length;
  const pendingCount = partners.filter((p: any) => p.status === "pending_review").length;
  const totalDailyCapacityUSD = partners
    .filter((p: any) => p.status === "approved")
    .reduce((sum: number, p: any) => sum + (p.maxDailyFxUsd ?? 0), 0);

  return (
    <div className="container py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            BDC Partner Portal
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Bureau de Change partner management — CBN Circular March 24 2026 compliant
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4 mr-1" />Refresh
          </Button>
          <LiquidityRequestDialog partners={partners} onSuccess={refresh} />
          {isAdmin && <RegisterPartnerDialog onSuccess={refresh} />}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <CheckCircle className="w-3 h-3 text-green-500" />Approved Partners
            </div>
            <p className="text-2xl font-bold">{approvedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="w-3 h-3 text-yellow-500" />Pending Review
            </div>
            <p className="text-2xl font-bold">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="w-3 h-3 text-blue-500" />Daily FX Capacity
            </div>
            <p className="text-2xl font-bold">${(totalDailyCapacityUSD / 1000).toFixed(0)}K</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Globe className="w-3 h-3 text-purple-500" />Active Corridors
            </div>
            <p className="text-2xl font-bold">{corridors.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* CBN Compliance Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex gap-3">
        <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-900">CBN Circular March 24 2026 — IMTO Compliance</p>
          <p className="text-xs text-blue-700 mt-1">
            All FX transactions for the Nigeria corridor must be routed through CBN-licensed BDC partners
            at rates benchmarked against Bloomberg BMATCH. Each BDC partner must be registered with a
            valid CBN licence number and an Authorised Dealer Bank (ADB) for settlement.
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="partners">
        <TabsList className="mb-4">
          <TabsTrigger value="partners">Partners ({partners.length})</TabsTrigger>
          <TabsTrigger value="rates">Live ADB Rates</TabsTrigger>
          <TabsTrigger value="corridors">Corridors</TabsTrigger>
          {isAdmin && <TabsTrigger value="history">Transfer History</TabsTrigger>}
          {isAdmin && <TabsTrigger value="admin">Admin Actions</TabsTrigger>}
        </TabsList>

        {/* Partners Tab */}
        <TabsContent value="partners">
          {loadingPartners ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : partners.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No BDC partners registered yet.</p>
                {isAdmin && (
                  <div className="mt-4">
                    <RegisterPartnerDialog onSuccess={refresh} />
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {partners.map((partner: any) => (
                <Card key={partner.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold">{partner.name}</h3>
                          <PartnerStatusBadge status={partner.status} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs text-muted-foreground mt-2">
                          <div>
                            <span className="font-medium text-foreground">CBN Licence:</span>
                            <br />{partner.cbnLicenceNumber}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">ADB:</span>
                            <br />{partner.adbName} {partner.adbCode ? `(${partner.adbCode})` : ""}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Daily FX Limit:</span>
                            <br />${(partner.maxDailyFxUsd ?? 0).toLocaleString()} USD
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Contact:</span>
                            <br />{partner.contactEmail ?? "—"}
                          </div>
                        </div>
                        {partner.notes && (
                          <p className="text-xs text-muted-foreground mt-2 italic">{partner.notes}</p>
                        )}
                      </div>
                      {isAdmin && partner.status === "pending_review" && (
                        <div className="ml-4 flex-shrink-0">
                          <ApprovePartnerButton
                            partnerId={partner.id}
                            partnerName={partner.name}
                            onSuccess={refresh}
                          />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Live ADB Rates Tab */}
        <TabsContent value="rates">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />Live ADB FX Rates
              </CardTitle>
              <CardDescription>
                Rates sourced from BMATCH-aligned ADB quotes. Updated every 60 seconds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rates.length === 0 ? (
                <p className="text-muted-foreground text-sm">Loading rates...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4">Pair</th>
                        <th className="text-right py-2 pr-4">Mid Rate</th>
                        <th className="text-right py-2 pr-4">Bid</th>
                        <th className="text-right py-2 pr-4">Offer</th>
                        <th className="text-right py-2 pr-4">Spread (bps)</th>
                        <th className="text-left py-2">Session</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map((r: any) => (
                        <tr key={r.pair} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-mono font-medium">{r.pair}</td>
                          <td className="py-2 pr-4 text-right font-mono">{Number(r.mid ?? r.midRate ?? 0).toFixed(4)}</td>
                          <td className="py-2 pr-4 text-right font-mono text-red-600">{Number(r.bid ?? 0).toFixed(4)}</td>
                          <td className="py-2 pr-4 text-right font-mono text-green-600">{Number(r.offer ?? r.ask ?? 0).toFixed(4)}</td>
                          <td className="py-2 pr-4 text-right">{r.spreadBps ?? r.spread_bps ?? "—"}</td>
                          <td className="py-2 text-xs text-muted-foreground capitalize">{r.session ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Corridors Tab */}
        <TabsContent value="corridors">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {corridors.length === 0 ? (
              <Card className="col-span-3">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No corridors configured.
                </CardContent>
              </Card>
            ) : corridors.map((c: any) => (
              <Card key={c.id ?? c.corridorCode}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-lg">{c.corridorCode ?? c.corridor_code}</span>
                    <Badge variant={c.isActive ? "default" : "secondary"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Send Country:</span>
                      <span className="font-medium text-foreground">{c.sendCountry ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Receive Country:</span>
                      <span className="font-medium text-foreground">{c.receiveCountry ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Min Transfer:</span>
                      <span className="font-medium text-foreground">${c.minTransferUsd ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Max Transfer:</span>
                      <span className="font-medium text-foreground">${(c.maxTransferUsd ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CBN Approved:</span>
                      <span>{c.cbnApproved ? "✓ Yes" : "✗ No"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Transfer History Tab */}
        {isAdmin && (
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="w-4 h-4" />
                    BDC Liquidity Transfer History
                    <Badge variant="secondary" className="ml-2">{liquidityTotal} total</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={historyStatus} onValueChange={setHistoryStatus}>
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="disbursed">Disbursed</SelectItem>
                      </SelectContent>
                    </Select>
                    {liquidityApprovedCount > 0 && (
                      <AlertDialog open={showDisburseDialog} onOpenChange={setShowDisburseDialog}>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            disabled={bulkDisburse.isPending}
                          >
                            <DollarSign className="w-3 h-3 mr-1" />
                            {bulkDisburse.isPending ? "Disbursing..." : `Disburse All Approved (${liquidityApprovedCount})`}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Bulk Disburse</AlertDialogTitle>
                            <AlertDialogDescription>
                              You are about to disburse <strong>{liquidityApprovedCount} approved</strong> liquidity request{liquidityApprovedCount !== 1 ? "s" : ""}.
                              Each request will be assigned an ADB transfer reference and marked as disbursed.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                setShowDisburseDialog(false);
                                bulkDisburse.mutate({});
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                              Confirm Disburse
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
                      <RefreshCw className="w-3 h-3 mr-1" />Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading history...
                  </div>
                ) : liquidityHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No liquidity requests found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2 px-3">Date</th>
                          <th className="text-left py-2 px-3">Partner</th>
                          <th className="text-right py-2 px-3">Requested (USD)</th>
                          <th className="text-right py-2 px-3">Approved (USD)</th>
                          <th className="text-left py-2 px-3">Corridor</th>
                          <th className="text-right py-2 px-3">BMATCH Rate</th>
                          <th className="text-left py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Settlement Ref</th>
                          {isAdmin && <th className="text-left py-2 px-3">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {liquidityHistory.map((req: any) => (
                          <tr key={req.id} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {new Date(req.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3 font-medium">{req.partnerName ?? `BDC #${req.bdcPartnerId}`}</td>
                            <td className="py-2 px-3 text-right font-mono">
                              ${(req.requestedAmountUsd ?? 0).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-green-700">
                              {req.approvedAmountUsd != null ? `$${req.approvedAmountUsd.toLocaleString()}` : "—"}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant="outline" className="text-xs">{req.corridorCode ?? "—"}</Badge>
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-xs">
                              {req.bmatchRateAtRequest ?? "—"}
                            </td>
                            <td className="py-2 px-3">
                              <LiquidityStatusBadge status={req.status} />
                            </td>
                            <td className="py-2 px-3 text-xs font-mono text-muted-foreground">
                              {req.adbTransferReference ?? "—"}
                            </td>
                            {isAdmin && (
                              <td className="py-2 px-3">
                                {req.status === "pending" && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-xs px-2 text-green-700 border-green-300"
                                      disabled={approveLiquidity.isPending}
                                      onClick={() => approveLiquidity.mutate({
                                        requestId: req.id,
                                        approvedAmountUsd: req.requestedAmountUsd,
                                        action: "approve",
                                      })}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-xs px-2 text-red-700 border-red-300"
                                      disabled={approveLiquidity.isPending}
                                      onClick={() => approveLiquidity.mutate({
                                        requestId: req.id,
                                        approvedAmountUsd: 0,
                                        action: "reject",
                                      })}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                )}
                                {req.status === "approved" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs px-2 text-blue-700 border-blue-300"
                                    disabled={approveLiquidity.isPending}
                                    onClick={() => approveLiquidity.mutate({
                                      requestId: req.id,
                                      approvedAmountUsd: req.approvedAmountUsd ?? req.requestedAmountUsd,
                                      adbTransferReference: `ADB-${Date.now()}`,
                                      action: "disburse",
                                    })}
                                  >
                                    Mark Disbursed
                                  </Button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Admin Tab */}
        {isAdmin && (
          <TabsContent value="admin">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4" />Compliance Dashboard
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dashboard ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Settlement Accounts:</span>
                        <span className="font-medium">{dashboard.settlementAccountCount ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">BDC Partners:</span>
                        <span className="font-medium">{dashboard.bdcPartnerCount ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pending Filings:</span>
                        <span className="font-medium text-yellow-600">{dashboard.pendingFilingCount ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Compliance Score:</span>
                        <span className="font-medium text-green-600">{dashboard.complianceScore ?? "—"}%</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Loading dashboard...</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" size="sm"
                    disabled={exportingCbn}
                    onClick={async () => {
                      setExportingCbn(true);
                      try {
                        const result = await exportCbnFiling.refetch();
                        if (result.data) {
                          const blob = new Blob([result.data.csv], { type: "text/csv" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = result.data.filename;
                          a.click();
                          URL.revokeObjectURL(url);
                          toast("CBN Filing Exported", { description: `${result.data.rowCount} BDC partners exported to CSV.` });
                        }
                      } catch (e: any) {
                        toast.error("Export Failed", { description: e.message });
                      } finally {
                        setExportingCbn(false);
                      }
                    }}>
                    <Banknote className="w-4 h-4 mr-2" />{exportingCbn ? "Exporting..." : "Export CBN Filing Report"}
                  </Button>
                  <Button variant="outline" className="w-full justify-start" size="sm"
                    disabled={bulkApproving || bulkApprove.isPending}
                    onClick={async () => {
                      const pendingIds = partners.filter((p: any) => p.status === "pending_review").map((p: any) => p.id as number);
                      if (pendingIds.length === 0) { toast("No Pending Partners", { description: "All BDC partners are already approved or reviewed." }); return; }
                      setBulkApproving(true);
                      try {
                        await bulkApprove.mutateAsync({ partnerIds: pendingIds });
                      } finally {
                        setBulkApproving(false);
                      }
                    }}>
                    <CheckCircle className="w-4 h-4 mr-2" />{bulkApproving ? `Approving ${partners.filter((p: any) => p.status === "pending_review").length}...` : "Bulk Approve Pending Partners"}
                  </Button>
                  <Button variant="outline" className="w-full justify-start" size="sm"
                    onClick={() => window.open("/admin/cbn-compliance", "_self")}>
                    <Shield className="w-4 h-4 mr-2" />Full Compliance Dashboard
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
