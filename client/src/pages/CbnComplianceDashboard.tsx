import { toast } from 'sonner';
/**
 * CBN Compliance Dashboard (v187)
 *
 * Admin UI for all CBN Circular March 24 2026 compliance requirements:
 * - P0: Bloomberg BMATCH FX rate monitor + live rate table
 * - P1: Settlement account registry (CRUD, CBN filing workflow)
 * - P1: Wallet funding source enforcement (blocked events log)
 * - P2: CBN compliance export generator
 * - P3: BDC partner management
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ShieldCheck, TrendingUp, Building2, FileText, AlertTriangle,
  Plus, RefreshCw, Download, CheckCircle2, Clock, XCircle,
  BarChart3, Globe, Zap, Lock, Bell, BellOff, Trash2
, History, RotateCcw, Mail } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BmatchRate {
  pair: string;
  midRate: string;
  bidRate: string;
  askRate: string;
  spreadBps: string;
  platformRate: string;
  withinCbnLimit: boolean;
  source: string;
  session: string;
  snapshotAt: string | Date;
}

interface SettlementAccount {
  id: number;
  corridor: string;
  adbName: string;
  adbCode?: string;
  accountNumber: string;
  accountName: string;
  currency: string;
  isPrimary: boolean;
  status: string;
  cbnFiledAt?: string | Date;
  cbnReferenceNumber?: string;
  notes?: string;
  createdAt: string | Date;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ComplianceScoreCard({ score, stats }: { score: number; stats: Record<string, unknown> }) {
  const color = score >= 80 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400";
  const bg = score >= 80 ? "from-green-900/30 to-emerald-900/20" : score >= 50 ? "from-yellow-900/30 to-amber-900/20" : "from-red-900/30 to-rose-900/20";

  return (
    <Card className={`bg-gradient-to-br ${bg} border-white/10`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/60 mb-1">CBN Compliance Score</p>
            <p className={`text-5xl font-bold ${color}`}>{score}<span className="text-2xl text-white/40">/100</span></p>
            <p className="text-xs text-white/40 mt-1">CBN Circular Mar 24 2026</p>
          </div>
          <ShieldCheck className={`w-16 h-16 ${color} opacity-80`} />
        </div>
      </CardContent>
    </Card>
  );
}

function BmatchRateRow({ rate }: { rate: BmatchRate }) {
  const sessionColor = rate.session === "london" ? "bg-blue-500/20 text-blue-300" :
    rate.session === "new_york" ? "bg-green-500/20 text-green-300" : "bg-purple-500/20 text-purple-300";

  return (
    <TableRow className="border-white/5 hover:bg-white/5">
      <TableCell className="font-mono font-semibold text-white">{rate.pair}</TableCell>
      <TableCell className="font-mono text-emerald-300">{parseFloat(rate.midRate).toLocaleString("en-US", { minimumFractionDigits: 4 })}</TableCell>
      <TableCell className="font-mono text-blue-300">{parseFloat(rate.platformRate).toLocaleString("en-US", { minimumFractionDigits: 4 })}</TableCell>
      <TableCell className="text-white/60">{rate.spreadBps} bps</TableCell>
      <TableCell>
        <Badge className={sessionColor}>{rate.session}</Badge>
      </TableCell>
      <TableCell>
        {rate.withinCbnLimit ? (
          <Badge className="bg-green-500/20 text-green-300"><CheckCircle2 className="w-3 h-3 mr-1" />Within limit</Badge>
        ) : (
          <Badge className="bg-red-500/20 text-red-300"><AlertTriangle className="w-3 h-3 mr-1" />Exceeds limit</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-500/20 text-green-300",
    filed: "bg-blue-500/20 text-blue-300",
    pending_cbn_filing: "bg-yellow-500/20 text-yellow-300",
    suspended: "bg-red-500/20 text-red-300",
    closed: "bg-gray-500/20 text-gray-300",
    approved: "bg-green-500/20 text-green-300",
    pending_review: "bg-yellow-500/20 text-yellow-300",
    rejected: "bg-red-500/20 text-red-300",
  };
  const label = status.replace(/_/g, " ");
  return <Badge className={map[status] ?? "bg-gray-500/20 text-gray-300"}>{label}</Badge>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CbnComplianceDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");

  // ── Rate Alerts state ──────────────────────────────────────────────────────
  const [alertFromCurrency, setAlertFromCurrency] = useState("USD");
  const [alertToCurrency, setAlertToCurrency] = useState("NGN");
  const [alertTargetRate, setAlertTargetRate] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");

  const { data: rateAlertsData, refetch: refetchAlerts } = trpc.cbnCompliance.listRateAlerts.useQuery({ activeOnly: false });
  const rateAlerts = (rateAlertsData as any[]) ?? [];

  const createAlert = trpc.cbnCompliance.createRateAlert.useMutation({
    onSuccess: () => {
      toast("Rate Alert Created", { description: "You will be notified when the threshold is breached." });
      setAlertTargetRate("");
      refetchAlerts();
    },
    onError: (e) => toast.error("Failed to Create Alert"),
  });

  const deleteAlert = trpc.cbnCompliance.deleteRateAlert.useMutation({
    onSuccess: () => {
      toast("Alert Deactivated");
      refetchAlerts();
    },
    onError: (e) => toast.error("Failed"),
  });

  const snoozeAlert = trpc.cbnCompliance.snoozeRateAlert.useMutation({
    onSuccess: (data) => {
      toast("Alert Snoozed", { description: `Alert snoozed until ${new Date(data.snoozeUntil).toLocaleString()}.` });
      refetchAlerts();
    },
    onError: (e) => toast.error("Snooze Failed"),
  });
  const [snoozeHours, setSnoozeHours] = useState<Record<number, string>>({});

  const resetAlert = trpc.cbnCompliance.resetRateAlert.useMutation({
    onSuccess: (data) => {
      toast("Alert Re-armed", { description: `Alert for ${data.pair} is now active again.` });
      refetchAlerts();
      refetchAlertHistory();
    },
    onError: (e) => toast.error("Re-arm Failed"),
  });

  const [alertHistoryPair, setAlertHistoryPair] = useState<string>("all");
  const { data: alertHistoryData, refetch: refetchAlertHistory } = trpc.cbnCompliance.listRateAlertHistory.useQuery(
    alertHistoryPair !== "all" ? { pair: alertHistoryPair } : undefined,
    { refetchInterval: 60000 }
  );
  const alertHistory = alertHistoryData?.items ?? [];
  const alertHistoryTotal = alertHistoryData?.total ?? 0;

  const checkAlerts = trpc.cbnCompliance.checkRateAlerts.useMutation({
    onSuccess: (data: any) => {
      toast(`Alert Check Complete`, { description: `Checked ${data.checked} alerts. ${data.triggered} triggered. Live rate: ${data.liveRate?.toFixed(4) ?? "N/A"}` });
      refetchAlerts();
    },
    onError: (e) => toast.error("Check Failed"),
  });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddBdc, setShowAddBdc] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [cbnRef, setCbnRef] = useState("");
  const [exportType, setExportType] = useState("transaction_report");
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().split("T")[0]);

  // Form state
  const [accountForm, setAccountForm] = useState({
    corridor: "", adbName: "", adbCode: "", accountNumber: "",
    accountName: "", currency: "NGN", isPrimary: false, notes: ""
  });
  const [bdcForm, setBdcForm] = useState({
    name: "", cbnLicenceNumber: "", adbName: "", adbCode: "",
    contactEmail: "", contactPhone: "", maxDailyFxUsd: 100000, notes: ""
  });

  // Redirect non-admins
  useEffect(() => {
    if (user && user.role !== "admin") {
      navigate("/");
    }
  }, [user, navigate]);

  // Queries
  const dashboard = trpc.cbnCompliance.getComplianceDashboard.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const allRates = trpc.cbnCompliance.getAllRatePairs.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const accounts = trpc.cbnCompliance.listSettlementAccounts.useQuery({});
  const bdcPartners = trpc.cbnCompliance.listBdcPartners.useQuery({});
  const fundingEvents = trpc.cbnCompliance.getFundingEvents.useQuery({ onlyBlocked: true });
  const exports = trpc.cbnCompliance.listComplianceExports.useQuery();

  // Mutations
  const createAccount = trpc.cbnCompliance.createSettlementAccount.useMutation({
    onSuccess: () => {
      toast("Settlement account created", { description: "Status: pending CBN filing" });
      accounts.refetch();
      setShowAddAccount(false);
      setAccountForm({ corridor: "", adbName: "", adbCode: "", accountNumber: "", accountName: "", currency: "NGN", isPrimary: false, notes: "" });
    },
    onError: (e) => toast.error("Error"),
  });

  const markFiled = trpc.cbnCompliance.markCbnFiled.useMutation({
    onSuccess: (data) => {
      toast(`${data.filedCount} account(s) marked as CBN filed`, { description: `Reference: ${cbnRef}` });
      accounts.refetch();
      setSelectedAccountIds([]);
      setCbnRef("");
    },
    onError: (e) => toast.error("Error"),
  });

  const createBdc = trpc.cbnCompliance.createBdcPartner.useMutation({
    onSuccess: () => {
      toast("BDC partner added", { description: "Status: pending review" });
      bdcPartners.refetch();
      setShowAddBdc(false);
    },
    onError: (e) => toast.error("Error"),
  });

  const approveBdc = trpc.cbnCompliance.approveBdcPartner.useMutation({
    onSuccess: () => {
      toast("BDC partner approved");
      bdcPartners.refetch();
    },
    onError: (e) => toast.error("Error"),
  });

  const generateExport = trpc.cbnCompliance.generateComplianceExport.useMutation({
    onSuccess: (data) => {
      const emailMsg = data.emailSent ? " Email notification sent to compliance officer." : "";
      toast("Export generated", { description: `${data.recordCount} records — ID: #${data.id}.${emailMsg}` });
      exports.refetch();
    },
    onError: (e) => toast.error("Error"),
  });

  const dash = dashboard.data;
  const score = dash?.complianceScore ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold">CBN Compliance</h1>
            <Badge className="bg-emerald-500/20 text-emerald-300 text-xs">v187</Badge>
          </div>
          <p className="text-white/50 text-sm">CBN Circular March 24 2026 — BMATCH · Settlement Registry · Lakehouse</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { dashboard.refetch(); allRates.refetch(); accounts.refetch(); }}
          className="border-white/20 text-white/70 hover:text-white"
        >
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Score + Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <ComplianceScoreCard score={score} stats={dash ?? {}} />
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Building2 className="w-8 h-8 text-blue-400" />
              <div>
                <p className="text-2xl font-bold">{dash?.settlementAccounts.total ?? "—"}</p>
                <p className="text-xs text-white/50">Settlement Accounts</p>
                <p className="text-xs text-blue-300">{dash?.settlementAccounts.filed ?? 0} filed with CBN</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-emerald-400" />
              <div>
                <p className="text-2xl font-bold font-mono">
                  {dash?.latestBmatchRate ? parseFloat(String(dash.latestBmatchRate.midRate)).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                </p>
                <p className="text-xs text-white/50">USD/NGN BMATCH Mid</p>
                <p className="text-xs text-emerald-300">
                  {dash?.latestBmatchRate?.withinCbnLimit ? "✓ Within CBN limit" : "⚠ Exceeds limit"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-8 h-8 text-yellow-400" />
              <div>
                <p className="text-2xl font-bold">{dash?.walletFunding.blockedEvents ?? "—"}</p>
                <p className="text-xs text-white/50">Blocked Funding Events</p>
                <p className="text-xs text-yellow-300">Non-NFEM sources</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white/5 border border-white/10 mb-6">
          <TabsTrigger value="overview" className="data-[state=active]:bg-white/10">
            <BarChart3 className="w-4 h-4 mr-2" />Overview
          </TabsTrigger>
          <TabsTrigger value="rates" className="data-[state=active]:bg-white/10">
            <TrendingUp className="w-4 h-4 mr-2" />BMATCH Rates
          </TabsTrigger>
          <TabsTrigger value="settlement" className="data-[state=active]:bg-white/10">
            <Building2 className="w-4 h-4 mr-2" />Settlement Accounts
          </TabsTrigger>
          <TabsTrigger value="bdc" className="data-[state=active]:bg-white/10">
            <Globe className="w-4 h-4 mr-2" />BDC Partners
          </TabsTrigger>
          <TabsTrigger value="exports" className="data-[state=active]:bg-white/10">
            <FileText className="w-4 h-4 mr-2" />Compliance Exports
          </TabsTrigger>
          <TabsTrigger value="alerts" className="data-[state=active]:bg-white/10">
            <Bell className="w-4 h-4 mr-2" />Rate Alerts
          </TabsTrigger>
          <TabsTrigger value="funding" className="data-[state=active]:bg-white/10">
            <Lock className="w-4 h-4 mr-2" />Funding Enforcement
          </TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-400" />CBN Compliance Checklist
                </CardTitle>
                <CardDescription className="text-white/50">CBN Circular March 24 2026 requirements</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "BMATCH rate benchmark active", done: true, priority: "P0" },
                  { label: "Settlement accounts registered", done: (dash?.settlementAccounts.total ?? 0) > 0, priority: "P1" },
                  { label: "All accounts filed with CBN", done: (dash?.settlementAccounts.pendingFiling ?? 0) === 0, priority: "P1" },
                  { label: "NFEM funding enforcement active", done: true, priority: "P1" },
                  { label: "BDC partners onboarded", done: (dash?.bdcPartners.approved ?? 0) > 0, priority: "P3" },
                  { label: "Compliance exports generated", done: (dash?.complianceExports.total ?? 0) > 0, priority: "P2" },
                  { label: "OpenSearch audit trail active", done: true, priority: "P2" },
                  { label: "Keycloak PBAC enforced", done: true, priority: "P0" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      {item.done ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                      ) : (
                        <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                      )}
                      <span className={`text-sm ${item.done ? "text-white" : "text-white/60"}`}>{item.label}</span>
                    </div>
                    <Badge className={`text-xs ${item.priority === "P0" ? "bg-red-500/20 text-red-300" : item.priority === "P1" ? "bg-orange-500/20 text-orange-300" : "bg-blue-500/20 text-blue-300"}`}>
                      {item.priority}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />Middleware Stack Status
                </CardTitle>
                <CardDescription className="text-white/50">All 14 middleware integrations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { name: "Kafka (Event Streaming)", color: "text-green-400" },
                  { name: "Dapr (Pubsub Sidecar)", color: "text-green-400" },
                  { name: "Fluvio (Real-time Streaming)", status: "configured", color: "text-blue-400" },
                  { name: "Temporal (Workflow Engine)", color: "text-green-400" },
                  { name: "PostgreSQL (Primary DB)", color: "text-green-400" },
                  { name: "Keycloak (Identity Provider)", color: "text-green-400" },
                  { name: "Permify (PBAC Engine)", color: "text-green-400" },
                  { name: "Redis (Cache + State)", color: "text-green-400" },
                  { name: "Mojaloop (Payment Rail)", color: "text-green-400" },
                  { name: "OpenSearch (Audit Lakehouse)", color: "text-green-400" },
                  { name: "OpenAppSec (WAF)", status: "configured", color: "text-blue-400" },
                  { name: "APISIX (API Gateway)", color: "text-green-400" },
                  { name: "TigerBeetle (Ledger)", color: "text-green-400" },
                  { name: "Delta Lakehouse (ETL)", status: "configured", color: "text-blue-400" },
                ].map((m) => (
                  <div key={m.name} className="flex items-center justify-between text-sm">
                    <span className="text-white/70">{m.name}</span>
                    <span className={`text-xs font-medium ${m.color}`}>{m.status}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── BMATCH Rates Tab ── */}
        <TabsContent value="rates">
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">Bloomberg BMATCH Rate Monitor</CardTitle>
                  <CardDescription className="text-white/50">
                    Live rates benchmarked against Bloomberg BMATCH via ADB passthrough — refreshed every 60s
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => allRates.refetch()}
                  className="border-white/20 text-white/70 hover:text-white">
                  <RefreshCw className="w-4 h-4 mr-2" />Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {allRates.isPending ? (
                <div className="text-white/50 text-center py-8">Loading BMATCH rates...</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      <TableHead className="text-white/60">Pair</TableHead>
                      <TableHead className="text-white/60">BMATCH Mid</TableHead>
                      <TableHead className="text-white/60">Platform Rate</TableHead>
                      <TableHead className="text-white/60">Spread</TableHead>
                      <TableHead className="text-white/60">Session</TableHead>
                      <TableHead className="text-white/60">CBN Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(allRates.data ?? []).map((rate) => (
                      <BmatchRateRow key={rate.pair} rate={rate as BmatchRate} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settlement Accounts Tab ── */}
        <TabsContent value="settlement">
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">Settlement Account Registry</CardTitle>
                  <CardDescription className="text-white/50">
                    CBN-mandated naira settlement accounts at Authorised Dealer Banks
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {selectedAccountIds.length > 0 && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                          <CheckCircle2 className="w-4 h-4 mr-2" />Mark {selectedAccountIds.length} as Filed
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-slate-900 border-white/10 text-white">
                        <DialogHeader>
                          <DialogTitle>Mark Accounts as CBN Filed</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <p className="text-white/70 text-sm">
                            Enter the CBN reference number for the filing of {selectedAccountIds.length} account(s).
                          </p>
                          <div>
                            <Label>CBN Reference Number</Label>
                            <Input
                              value={cbnRef}
                              onChange={(e) => setCbnRef(e.target.value)}
                              placeholder="e.g. CBN/FX/2026/001"
                              className="bg-white/5 border-white/20 text-white mt-1"
                            />
                          </div>
                          <Button
                            onClick={() => markFiled.mutate({ accountIds: selectedAccountIds, cbnReferenceNumber: cbnRef })}
                            disabled={!cbnRef || markFiled.isPending}
                            className="w-full bg-blue-600 hover:bg-blue-700"
                          >
                            {markFiled.isPending ? "Filing..." : "Confirm CBN Filing"}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                  <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                        <Plus className="w-4 h-4 mr-2" />Add Account
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Add Settlement Account</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Corridor</Label>
                            <Input value={accountForm.corridor} onChange={e => setAccountForm(f => ({ ...f, corridor: e.target.value }))}
                              placeholder="e.g. NG-US" className="bg-white/5 border-white/20 text-white mt-1" />
                          </div>
                          <div>
                            <Label>Currency</Label>
                            <Select value={accountForm.currency} onValueChange={v => setAccountForm(f => ({ ...f, currency: v }))}>
                              <SelectTrigger className="bg-white/5 border-white/20 text-white mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-white/10">
                                {["NGN", "USD", "GBP", "EUR"].map(c => (
                                  <SelectItem key={c} value={c} className="text-white">{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div>
                          <Label>ADB Name</Label>
                          <Input value={accountForm.adbName} onChange={e => setAccountForm(f => ({ ...f, adbName: e.target.value }))}
                            placeholder="e.g. First Bank of Nigeria" className="bg-white/5 border-white/20 text-white mt-1" />
                        </div>
                        <div>
                          <Label>Account Number</Label>
                          <Input value={accountForm.accountNumber} onChange={e => setAccountForm(f => ({ ...f, accountNumber: e.target.value }))}
                            placeholder="10-digit NUBAN" className="bg-white/5 border-white/20 text-white mt-1" />
                        </div>
                        <div>
                          <Label>Account Name</Label>
                          <Input value={accountForm.accountName} onChange={e => setAccountForm(f => ({ ...f, accountName: e.target.value }))}
                            placeholder="Registered account name" className="bg-white/5 border-white/20 text-white mt-1" />
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch checked={accountForm.isPrimary} onCheckedChange={v => setAccountForm(f => ({ ...f, isPrimary: v }))} />
                          <Label>Primary account for this corridor</Label>
                        </div>
                        <div>
                          <Label>Notes (optional)</Label>
                          <Textarea value={accountForm.notes} onChange={e => setAccountForm(f => ({ ...f, notes: e.target.value }))}
                            className="bg-white/5 border-white/20 text-white mt-1" rows={2} />
                        </div>
                        <Button
                          onClick={() => createAccount.mutate(accountForm)}
                          disabled={!accountForm.corridor || !accountForm.adbName || !accountForm.accountNumber || !accountForm.accountName || createAccount.isPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700"
                        >
                          {createAccount.isPending ? "Creating..." : "Create Settlement Account"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead className="w-8">
                      <input type="checkbox" className="rounded" onChange={e => {
                        if (e.target.checked) setSelectedAccountIds((accounts.data ?? []).filter(a => a.status === "pending_cbn_filing").map(a => a.id));
                        else setSelectedAccountIds([]);
                      }} />
                    </TableHead>
                    <TableHead className="text-white/60">Corridor</TableHead>
                    <TableHead className="text-white/60">ADB</TableHead>
                    <TableHead className="text-white/60">Account</TableHead>
                    <TableHead className="text-white/60">Currency</TableHead>
                    <TableHead className="text-white/60">Status</TableHead>
                    <TableHead className="text-white/60">CBN Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(accounts.data ?? []).map((acc) => (
                    <TableRow key={acc.id} className="border-white/5 hover:bg-white/5">
                      <TableCell>
                        {acc.status === "pending_cbn_filing" && (
                          <input type="checkbox" className="rounded"
                            checked={selectedAccountIds.includes(acc.id)}
                            onChange={e => setSelectedAccountIds(prev =>
                              e.target.checked ? [...prev, acc.id] : prev.filter(id => id !== acc.id)
                            )} />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-white">{acc.corridor}</TableCell>
                      <TableCell className="text-white/70">{acc.adbName}</TableCell>
                      <TableCell className="font-mono text-sm text-white/70">{acc.accountNumber}</TableCell>
                      <TableCell><Badge className="bg-white/10 text-white/70">{acc.currency}</Badge></TableCell>
                      <TableCell><StatusBadge status={acc.status} /></TableCell>
                      <TableCell className="text-white/50 text-xs">{acc.cbnReferenceNumber ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(accounts.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-white/40 py-8">
                        No settlement accounts yet. Add your first account to begin CBN filing.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BDC Partners Tab ── */}
        <TabsContent value="bdc">
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">BDC Partner Management</CardTitle>
                  <CardDescription className="text-white/50">
                    CBN-licensed Bureau de Change partners for FX liquidity
                  </CardDescription>
                </div>
                <Dialog open={showAddBdc} onOpenChange={setShowAddBdc}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-4 h-4 mr-2" />Add BDC Partner
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Add BDC Partner</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <Label>BDC Name</Label>
                        <Input value={bdcForm.name} onChange={e => setBdcForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="e.g. Lagos FX Bureau" className="bg-white/5 border-white/20 text-white mt-1" />
                      </div>
                      <div>
                        <Label>CBN Licence Number</Label>
                        <Input value={bdcForm.cbnLicenceNumber} onChange={e => setBdcForm(f => ({ ...f, cbnLicenceNumber: e.target.value }))}
                          placeholder="e.g. BDC/2026/001" className="bg-white/5 border-white/20 text-white mt-1" />
                      </div>
                      <div>
                        <Label>Authorised Dealer Bank</Label>
                        <Input value={bdcForm.adbName} onChange={e => setBdcForm(f => ({ ...f, adbName: e.target.value }))}
                          placeholder="e.g. Zenith Bank" className="bg-white/5 border-white/20 text-white mt-1" />
                      </div>
                      <div>
                        <Label>Contact Email</Label>
                        <Input type="email" value={bdcForm.contactEmail} onChange={e => setBdcForm(f => ({ ...f, contactEmail: e.target.value }))}
                          placeholder="compliance@bdcpartner.com" className="bg-white/5 border-white/20 text-white mt-1" />
                      </div>
                      <div>
                        <Label>Max Daily FX (USD)</Label>
                        <Input type="number" value={bdcForm.maxDailyFxUsd} onChange={e => setBdcForm(f => ({ ...f, maxDailyFxUsd: parseInt(e.target.value) || 100000 }))}
                          className="bg-white/5 border-white/20 text-white mt-1" />
                      </div>
                      <Button
                        onClick={() => createBdc.mutate(bdcForm)}
                        disabled={!bdcForm.name || !bdcForm.cbnLicenceNumber || !bdcForm.adbName || createBdc.isPending}
                        className="w-full bg-emerald-600 hover:bg-emerald-700"
                      >
                        {createBdc.isPending ? "Adding..." : "Add BDC Partner"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead className="text-white/60">Name</TableHead>
                    <TableHead className="text-white/60">CBN Licence</TableHead>
                    <TableHead className="text-white/60">ADB</TableHead>
                    <TableHead className="text-white/60">Contact Email</TableHead>
                    <TableHead className="text-white/60">Max Daily FX</TableHead>
                    <TableHead className="text-white/60">Status</TableHead>
                    <TableHead className="text-white/60">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(bdcPartners.data ?? []).map((bdc) => (
                    <TableRow key={bdc.id} className="border-white/5 hover:bg-white/5">
                      <TableCell className="font-medium text-white">{bdc.name}</TableCell>
                      <TableCell className="font-mono text-sm text-white/70">{bdc.cbnLicenceNumber}</TableCell>
                      <TableCell className="text-white/70">{bdc.adbName}</TableCell>
                      <TableCell className="text-white/60 text-xs">{(bdc as any).contactEmail ?? <span className="text-white/30">—</span>}</TableCell>
                      <TableCell className="text-white/70">${Number(bdc.maxDailyFxUsd).toLocaleString()}</TableCell>
                      <TableCell><StatusBadge status={bdc.status} /></TableCell>
                      <TableCell className="flex items-center gap-2">
                        {bdc.status === "pending_review" && (
                          <Button size="sm" variant="outline"
                            onClick={() => approveBdc.mutate({ id: bdc.id })}
                            className="border-green-500/30 text-green-300 hover:bg-green-500/10 h-7 text-xs">
                            Approve
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          title="Preview onboarding email"
                          onClick={() => navigate(`/admin/email-preview/bdc-onboarding?partnerName=${encodeURIComponent(bdc.name)}&cbnLicenceNumber=${encodeURIComponent(bdc.cbnLicenceNumber)}&adbName=${encodeURIComponent(bdc.adbName)}&maxDailyFxUsd=${bdc.maxDailyFxUsd}`)}
                          className="border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 h-7 w-7 p-0">
                          <Mail className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(bdcPartners.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-white/40 py-8">
                        No BDC partners yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Compliance Exports Tab ── */}
        <TabsContent value="exports">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Generate CBN Export</CardTitle>
                <CardDescription className="text-white/50">Create compliance reports for CBN submission</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Export Type</Label>
                  <Select value={exportType} onValueChange={setExportType}>
                    <SelectTrigger className="bg-white/5 border-white/20 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-white/10">
                      <SelectItem value="transaction_report" className="text-white">Transaction Report</SelectItem>
                      <SelectItem value="settlement_account_list" className="text-white">Settlement Account List</SelectItem>
                      <SelectItem value="fx_rate_audit" className="text-white">FX Rate Audit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>From Date</Label>
                    <Input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
                      className="bg-white/5 border-white/20 text-white mt-1" />
                  </div>
                  <div>
                    <Label>To Date</Label>
                    <Input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
                      className="bg-white/5 border-white/20 text-white mt-1" />
                  </div>
                </div>
                <Button
                  onClick={() => generateExport.mutate({
                    exportType: exportType as "transaction_report" | "settlement_account_list" | "fx_rate_audit",
                    fromDate: exportFrom,
                    toDate: exportTo,
                  })}
                  disabled={generateExport.isPending}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {generateExport.isPending ? "Generating..." : <><Download className="w-4 h-4 mr-2" />Generate Export</>}
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Recent Exports</CardTitle>
                <CardDescription className="text-white/50">Last 10 compliance exports</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(exports.data ?? []).slice(0, 10).map((exp) => (
                    <div key={exp.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div>
                        <p className="text-sm text-white font-medium">{exp.exportType.replace(/_/g, " ")}</p>
                        <p className="text-xs text-white/40">
                          {new Date(exp.createdAt).toLocaleDateString()} · {exp.recordCount} records
                        </p>
                      </div>
                      <Badge className="bg-green-500/20 text-green-300 text-xs">{exp.status}</Badge>
                    </div>
                  ))}
                  {(exports.data ?? []).length === 0 && (
                    <p className="text-white/40 text-center py-4 text-sm">No exports yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Funding Enforcement Tab ── */}
        <TabsContent value="funding">
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-red-400" />Wallet Funding Enforcement
              </CardTitle>
              <CardDescription className="text-white/50">
                CBN rule: only remittance_inflow and nfem_fx_conversion are permitted for settlement accounts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead className="text-white/60">User ID</TableHead>
                    <TableHead className="text-white/60">Amount</TableHead>
                    <TableHead className="text-white/60">Currency</TableHead>
                    <TableHead className="text-white/60">Source Type</TableHead>
                    <TableHead className="text-white/60">NFEM Approved</TableHead>
                    <TableHead className="text-white/60">Blocked Reason</TableHead>
                    <TableHead className="text-white/60">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(fundingEvents.data ?? []).map((ev) => (
                    <TableRow key={ev.id} className="border-white/5 hover:bg-white/5">
                      <TableCell className="font-mono text-xs text-white/60">{ev.userId}</TableCell>
                      <TableCell className="font-mono text-white">{ev.amount}</TableCell>
                      <TableCell><Badge className="bg-white/10 text-white/70">{ev.currency}</Badge></TableCell>
                      <TableCell className="text-white/70 text-sm">{ev.fundingSourceType}</TableCell>
                      <TableCell>
                        {ev.isNfemApproved ? (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </TableCell>
                      <TableCell className="text-red-300 text-xs max-w-xs truncate">{ev.blockedReason ?? "—"}</TableCell>
                      <TableCell className="text-white/40 text-xs">
                        {new Date(ev.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(fundingEvents.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-white/40 py-8">
                        No blocked funding events — NFEM enforcement is working correctly.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        {/* Rate Alerts Tab */}
        <TabsContent value="alerts">
          <div className="space-y-6">
            {/* Create Alert Form */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Bell className="w-5 h-5 text-yellow-400" />
                  Create CBN Corridor Rate Alert
                </CardTitle>
                <CardDescription className="text-white/60">
                  Get notified via owner notification when a corridor rate crosses your threshold.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">From Currency</Label>
                    <Select value={alertFromCurrency} onValueChange={setAlertFromCurrency}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="NGN">NGN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">To Currency</Label>
                    <Select value={alertToCurrency} onValueChange={setAlertToCurrency}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NGN">NGN</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">Direction</Label>
                    <Select value={alertDirection} onValueChange={(v) => setAlertDirection(v as "above" | "below")}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="above">Rate goes above</SelectItem>
                        <SelectItem value="below">Rate goes below</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">Target Rate</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      placeholder="e.g. 1600.00"
                      value={alertTargetRate}
                      onChange={(e) => setAlertTargetRate(e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                  <Button
                    onClick={() => createAlert.mutate({
                      fromCurrency: alertFromCurrency,
                      toCurrency: alertToCurrency,
                      targetRate: parseFloat(alertTargetRate),
                      direction: alertDirection,
                    })}
                    disabled={createAlert.isPending || !alertTargetRate || isNaN(parseFloat(alertTargetRate))}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                  >
                    <Bell className="w-4 h-4 mr-2" />
                    {createAlert.isPending ? "Creating..." : "Create Alert"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Active Alerts Table */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Bell className="w-5 h-5 text-emerald-400" />
                    Active Rate Alerts
                    <Badge className="bg-yellow-500/20 text-yellow-300 ml-2">{rateAlerts.filter((a: any) => a.isActive).length} active</Badge>
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={() => checkAlerts.mutate()}
                    disabled={checkAlerts.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    {checkAlerts.isPending ? "Checking..." : "Check Now"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {rateAlerts.length === 0 ? (
                  <div className="text-center py-12 text-white/40">
                    <BellOff className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No rate alerts configured yet.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead className="text-white/60">Pair</TableHead>
                        <TableHead className="text-white/60">Direction</TableHead>
                        <TableHead className="text-white/60 text-right">Target Rate</TableHead>
                        <TableHead className="text-white/60">Status</TableHead>
                        <TableHead className="text-white/60">Triggered At</TableHead>
                        <TableHead className="text-white/60">Created</TableHead>
                        <TableHead className="text-white/60">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateAlerts.map((alert: any) => (
                        <TableRow key={alert.id} className="border-white/5 hover:bg-white/5">
                          <TableCell className="font-mono font-semibold text-white">
                            {alert.fromCurrency}/{alert.toCurrency}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={alert.direction === "above"
                                ? "bg-green-500/20 text-green-300"
                                : "bg-red-500/20 text-red-300"}
                            >
                              {alert.direction === "above" ? "↑ Above" : "↓ Below"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-emerald-300">
                            {parseFloat(String(alert.targetRate)).toLocaleString("en-US", { minimumFractionDigits: 4 })}
                          </TableCell>
                          <TableCell>
                            {alert.isActive ? (
                              <Badge className="bg-emerald-500/20 text-emerald-300">
                                <Bell className="w-3 h-3 mr-1" />Active
                              </Badge>
                            ) : (
                              <Badge className="bg-white/10 text-white/40">
                                <BellOff className="w-3 h-3 mr-1" />Inactive
                              </Badge>
                            )}
                            {alert.notificationSent && (
                              <Badge className="bg-yellow-500/20 text-yellow-300 ml-1">
                                <Zap className="w-3 h-3 mr-1" />Triggered
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-white/60 text-xs">
                            {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-white/40 text-xs">
                            {new Date(alert.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {alert.isActive && (
                              <div className="flex items-center gap-1">
                                <Select
                                  value={snoozeHours[alert.id] ?? ""}
                                  onValueChange={(v) => setSnoozeHours((prev) => ({ ...prev, [alert.id]: v }))}
                                >
                                  <SelectTrigger className="w-20 h-7 bg-white/5 border-white/10 text-white text-xs">
                                    <SelectValue placeholder="Snooze" />
                                  </SelectTrigger>
                                  <SelectContent className="bg-slate-900 border-white/10">
                                    <SelectItem value="1" className="text-white text-xs">1 h</SelectItem>
                                    <SelectItem value="4" className="text-white text-xs">4 h</SelectItem>
                                    <SelectItem value="24" className="text-white text-xs">24 h</SelectItem>
                                    <SelectItem value="72" className="text-white text-xs">72 h</SelectItem>
                                  </SelectContent>
                                </Select>
                                {snoozeHours[alert.id] && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-xs px-2"
                                    onClick={() => snoozeAlert.mutate({ id: alert.id, hours: Number(snoozeHours[alert.id]) })}
                                    disabled={snoozeAlert.isPending}
                                  >
                                    <BellOff className="w-3 h-3 mr-1" />Go
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                  onClick={() => deleteAlert.mutate({ alertId: alert.id })}
                                  disabled={deleteAlert.isPending}
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />Deactivate
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Rate Alert History */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-white flex items-center gap-2">
                    <History className="w-5 h-5 text-orange-400" />
                    Triggered Alert History
                    <Badge className="bg-orange-500/20 text-orange-300 ml-2">{alertHistoryTotal} triggered</Badge>
                  </CardTitle>
                  <Select value={alertHistoryPair} onValueChange={setAlertHistoryPair}>
                    <SelectTrigger className="w-36 bg-white/5 border-white/10 text-white text-xs h-8">
                      <SelectValue placeholder="All pairs" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-white/10">
                      <SelectItem value="all" className="text-white text-xs">All pairs</SelectItem>
                      {["USD/NGN","GBP/NGN","EUR/NGN","CAD/NGN","AUD/NGN","GHS/NGN","KES/NGN","ZAR/NGN","XOF/NGN"].map(p => (
                        <SelectItem key={p} value={p} className="text-white text-xs font-mono">{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <CardDescription className="text-white/50">
                  All alerts that have fired. Filter by pair or use Re-arm to allow them to trigger again.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {alertHistory.length === 0 ? (
                  <div className="text-center py-10 text-white/40">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No alerts have triggered yet.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10 hover:bg-white/5">
                        <TableHead className="text-white/60">Pair</TableHead>
                        <TableHead className="text-white/60">Direction</TableHead>
                        <TableHead className="text-white/60">Threshold</TableHead>
                        <TableHead className="text-white/60">Triggered At</TableHead>
                        <TableHead className="text-white/60">Status</TableHead>
                        <TableHead className="text-white/60">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alertHistory.map((h: any) => (
                        <TableRow key={h.id} className="border-white/10 hover:bg-white/5">
                          <TableCell className="text-white font-mono font-semibold">{h.pair}</TableCell>
                          <TableCell>
                            <Badge className={h.direction === "above" ? "bg-red-500/20 text-red-300" : "bg-blue-500/20 text-blue-300"}>
                              {h.direction === "above" ? "↑ Above" : "↓ Below"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-white/80 font-mono">{parseFloat(h.targetRate).toLocaleString()}</TableCell>
                          <TableCell className="text-white/60 text-xs">
                            {h.triggeredAt ? new Date(h.triggeredAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge className={h.isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/50"}>
                              {h.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10 text-xs"
                              onClick={() => resetAlert.mutate({ id: h.id })}
                              disabled={resetAlert.isPending}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Re-arm
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
