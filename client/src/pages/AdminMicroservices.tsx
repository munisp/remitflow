import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, AlertTriangle, CheckCircle, XCircle, Shield, Cpu, Brain,
  TrendingUp, RefreshCw, Search, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

// ─── Service Health Badge ─────────────────────────────────────────────────────
function ServiceBadge({ status }: { status: string }) {
  if (status === "up") return (
    <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
      <CheckCircle className="w-3 h-3" /> Online
    </Badge>
  );
  return (
    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1">
      <XCircle className="w-3 h-3" /> Offline
    </Badge>
  );
}

// ─── Severity Badge ───────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  return <Badge className={map[severity] ?? ""}>{severity}</Badge>;
}

// ─── Decision Badge ───────────────────────────────────────────────────────────
function DecisionBadge({ decision }: { decision: string }) {
  if (decision === "PASS") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">PASS</Badge>;
  if (decision === "REVIEW") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">REVIEW</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">BLOCK</Badge>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
import DashboardLayout from "@/components/DashboardLayout";
export default function AdminMicroservices() {
  const { t } = useTranslation();
  const { data: health, refetch: refetchHealth, isFetching: healthFetching } =
    trpc.microservices.healthAll.useQuery(undefined, { refetchInterval: 30_000 });

  const { data: amlRulesData } = trpc.microservices.amlRules.useQuery();
  const { data: corridorStats } = trpc.microservices.fraudCorridorStats.useQuery();

  // ─── AML Screen form ─────────────────────────────────────────────────────
  const [screenForm, setScreenForm] = useState({
    transactionId: `TXN-${Date.now()}`,
    amountUsd: "500",
    senderCountry: "NG",
    receiverCountry: "US",
    senderName: "",
    receiverName: "",
    velocity1h: "1",
    velocity24h: "3",
    isNewBeneficiary: false,
    isRoundNumber: false,
  });
  const [screenResult, setScreenResult] = useState<any>(null);

  const amlScreenMutation = trpc.microservices.amlScreen.useMutation({
    onSuccess: (data) => {
      setScreenResult(data);
      toast[data.decision === "BLOCK" ? "error" : data.decision === "REVIEW" ? "warning" : "success"](
        `AML Decision: ${data.decision} (risk score: ${(data.risk_score * 100).toFixed(0)}%)`
      );
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Sanctions check form ─────────────────────────────────────────────────
  const [sanctionsName, setSanctionsName] = useState("");
  const [sanctionsResult, setSanctionsResult] = useState<any>(null);
  const sanctionsMutation = trpc.microservices.sanctionsCheck.useMutation({
    onSuccess: (data) => {
      setSanctionsResult(data);
      toast[data.is_match ? "error" : "success"](
        data.is_match ? `MATCH: "${data.name}" found in sanctions list` : `CLEAR: "${data.name}" not on sanctions list`
      );
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── FX Quote form ────────────────────────────────────────────────────────
  const [quoteForm, setQuoteForm] = useState({ from: "USD", to: "NGN", amount: "100" });
  const { data: quoteData, refetch: refetchQuote, isFetching: quoteFetching } =
    trpc.microservices.fxQuote.useQuery(
      { from: quoteForm.from, to: quoteForm.to, amount: parseFloat(quoteForm.amount) || 100 },
      { enabled: false }
    );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Polyglot Microservices</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Go FX Engine · Python Fraud ML · Rust AML Rules Engine
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchHealth()} disabled={healthFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${healthFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Service Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Go FX Engine */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">Go FX Engine</CardTitle>
                  <p className="text-xs text-muted-foreground">Port 8081 · Gin/HTTP</p>
                </div>
              </div>
              <ServiceBadge status={health?.fx?.status ?? "down"} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Live FX rates · Quote engine · Corridor management</p>
              <p>Spread: 1.5% · Fee: $3.99 flat</p>
              <p className="mt-2 font-mono text-[10px] bg-muted/30 rounded px-2 py-1">
                GET /rates · POST /quote · POST /execute
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Python Fraud ML */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Brain className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">Python Fraud ML</CardTitle>
                  <p className="text-xs text-muted-foreground">Port 8082 · FastAPI</p>
                </div>
              </div>
              <ServiceBadge status={health?.fraud?.status ?? "down"} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>RandomForest + SHAP · Velocity features · Risk profiling</p>
              <p>Model: v1.0 · Threshold: 0.65</p>
              <p className="mt-2 font-mono text-[10px] bg-muted/30 rounded px-2 py-1">
                POST /score · POST /explain · GET /analytics/*
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Rust AML Engine */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Shield className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">Rust AML Engine</CardTitle>
                  <p className="text-xs text-muted-foreground">Port 8083 · Axum/Tokio</p>
                </div>
              </div>
              <ServiceBadge status={health?.aml?.status ?? "down"} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>10 FATF rules · Sanctions · PEP screening</p>
              <p>BLOCK / REVIEW / PASS decisions</p>
              <p className="mt-2 font-mono text-[10px] bg-muted/30 rounded px-2 py-1">
                POST /screen · POST /sanctions-check · GET /rules
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="aml">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="aml" className="gap-2"><Shield className="w-4 h-4" />AML Rules</TabsTrigger>
          <TabsTrigger value="screen" className="gap-2"><Activity className="w-4 h-4" />Live Screen</TabsTrigger>
          <TabsTrigger value="sanctions" className="gap-2"><AlertTriangle className="w-4 h-4" />Sanctions</TabsTrigger>
          <TabsTrigger value="fraud" className="gap-2"><Brain className="w-4 h-4" />Fraud Stats</TabsTrigger>
          <TabsTrigger value="fx" className="gap-2"><Zap className="w-4 h-4" />FX Quote</TabsTrigger>
        </TabsList>

        {/* AML Rules Table */}
        <TabsContent value="aml">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active AML Rules ({amlRulesData?.count ?? 0})</CardTitle>
              {(amlRulesData as any)?._fallback && (
                <p className="text-xs text-yellow-400">⚠ Rust AML service offline — showing cached rule definitions</p>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Threshold</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(amlRulesData?.rules ?? []).map((rule: any) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono text-xs">{rule.id}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{rule.name}</p>
                          <p className="text-xs text-muted-foreground">{rule.description}</p>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{rule.category}</Badge></TableCell>
                      <TableCell><SeverityBadge severity={rule.severity} /></TableCell>
                      <TableCell className="font-mono text-xs">
                        {rule.threshold != null ? `$${Number(rule.threshold ?? 0).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={rule.active ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}>
                          {rule.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(amlRulesData?.rules ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No rules loaded — start the Rust AML service to see rules
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Live AML Screen */}
        <TabsContent value="screen">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Run AML Screen</CardTitle>
                <p className="text-xs text-muted-foreground">Proxied to Rust AML Engine (port 8083)</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Transaction ID</Label>
                    <Input value={screenForm.transactionId} onChange={e => setScreenForm(f => ({ ...f, transactionId: e.target.value }))} className="text-xs h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">Amount (USD)</Label>
                    <Input type="number" value={screenForm.amountUsd} onChange={e => setScreenForm(f => ({ ...f, amountUsd: e.target.value }))} className="text-xs h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">Sender Country</Label>
                    <Input value={screenForm.senderCountry} onChange={e => setScreenForm(f => ({ ...f, senderCountry: e.target.value }))} className="text-xs h-8" placeholder="NG" />
                  </div>
                  <div>
                    <Label className="text-xs">Receiver Country</Label>
                    <Input value={screenForm.receiverCountry} onChange={e => setScreenForm(f => ({ ...f, receiverCountry: e.target.value }))} className="text-xs h-8" placeholder="US" />
                  </div>
                  <div>
                    <Label className="text-xs">Sender Name</Label>
                    <Input value={screenForm.senderName} onChange={e => setScreenForm(f => ({ ...f, senderName: e.target.value }))} className="text-xs h-8" placeholder="Optional" />
                  </div>
                  <div>
                    <Label className="text-xs">Receiver Name</Label>
                    <Input value={screenForm.receiverName} onChange={e => setScreenForm(f => ({ ...f, receiverName: e.target.value }))} className="text-xs h-8" placeholder="Optional" />
                  </div>
                  <div>
                    <Label className="text-xs">Velocity 1h</Label>
                    <Input type="number" value={screenForm.velocity1h} onChange={e => setScreenForm(f => ({ ...f, velocity1h: e.target.value }))} className="text-xs h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">Velocity 24h</Label>
                    <Input type="number" value={screenForm.velocity24h} onChange={e => setScreenForm(f => ({ ...f, velocity24h: e.target.value }))} className="text-xs h-8" />
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={screenForm.isNewBeneficiary} onChange={e => setScreenForm(f => ({ ...f, isNewBeneficiary: e.target.checked }))} />
                    New Beneficiary
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={screenForm.isRoundNumber} onChange={e => setScreenForm(f => ({ ...f, isRoundNumber: e.target.checked }))} />
                    Round Number
                  </label>
                </div>
                <Button
                  className="w-full"
                  onClick={() => amlScreenMutation.mutate({
                    transactionId: screenForm.transactionId,
                    amountUsd: parseFloat(screenForm.amountUsd) || 100,
                    senderCountry: screenForm.senderCountry || undefined,
                    receiverCountry: screenForm.receiverCountry || undefined,
                    senderName: screenForm.senderName || undefined,
                    receiverName: screenForm.receiverName || undefined,
                    velocity1h: parseInt(screenForm.velocity1h) || undefined,
                    velocity24h: parseInt(screenForm.velocity24h) || undefined,
                    isNewBeneficiary: screenForm.isNewBeneficiary,
                    isRoundNumber: screenForm.isRoundNumber,
                  })}
                  disabled={amlScreenMutation.isPending}
                >
                  <Search className="w-4 h-4 mr-2" />
                  {amlScreenMutation.isPending ? "Screening..." : "Run AML Screen"}
                </Button>
              </CardContent>
            </Card>

            {/* Screen Result */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Screen Result</CardTitle>
              </CardHeader>
              <CardContent>
                {!screenResult ? (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm">
                    <Shield className="w-8 h-8 mb-2 opacity-30" />
                    Run a screen to see results
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <DecisionBadge decision={screenResult.decision} />
                      <span className="text-xs text-muted-foreground font-mono">{screenResult.screen_id?.slice(0, 8)}</span>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Risk Score</span>
                        <span className="font-semibold">{(screenResult.risk_score * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={screenResult.risk_score * 100} className="h-2" />
                    </div>
                    {screenResult._fallback && (
                      <p className="text-xs text-yellow-400">⚠ Fallback mode — Rust service offline</p>
                    )}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Matched Rules ({screenResult.matched_rules?.length ?? 0})
                      </p>
                      {(screenResult.matched_rules ?? []).map((r: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded bg-muted/20 border border-border">
                          <SeverityBadge severity={r.severity} />
                          <div>
                            <p className="text-xs font-medium">{r.rule_name}</p>
                            <p className="text-xs text-muted-foreground">{r.detail}</p>
                          </div>
                        </div>
                      ))}
                      {(screenResult.matched_rules ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground">No rules matched — transaction is clean</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Sanctions Check */}
        <TabsContent value="sanctions">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Sanctions Name Check</CardTitle>
              <p className="text-xs text-muted-foreground">Proxied to Rust AML Engine — OFAC/UN list fuzzy match</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={sanctionsName}
                  onChange={e => setSanctionsName(e.target.value)}
                  placeholder="Enter full name to check..."
                  className="text-sm"
                  onKeyDown={e => e.key === "Enter" && sanctionsMutation.mutate({ name: sanctionsName })}
                />
                <Button onClick={() => sanctionsMutation.mutate({ name: sanctionsName })} disabled={!sanctionsName || sanctionsMutation.isPending}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
              {sanctionsResult && (
                <div className={`p-4 rounded-lg border ${sanctionsResult.is_match ? "border-red-500/30 bg-red-500/10" : "border-green-500/30 bg-green-500/10"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {sanctionsResult.is_match
                      ? <XCircle className="w-5 h-5 text-red-400" />
                      : <CheckCircle className="w-5 h-5 text-green-400" />}
                    <span className={`font-semibold ${sanctionsResult.is_match ? "text-red-400" : "text-green-400"}`}>
                      {sanctionsResult.is_match ? "SANCTIONS MATCH FOUND" : "CLEAR — Not on list"}
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-muted-foreground">
                    <p>Name: <span className="text-foreground font-medium">{sanctionsResult.name}</span></p>
                    <p>Confidence: <span className="text-foreground">{(sanctionsResult.confidence * 100).toFixed(0)}%</span></p>
                    {sanctionsResult.match_type && <p>Match type: <span className="text-foreground">{sanctionsResult.match_type}</span></p>}
                    <p>Screened at: {new Date(sanctionsResult.screened_at).toLocaleString()}</p>
                    {sanctionsResult._fallback && <p className="text-yellow-400">⚠ Fallback mode</p>}
                  </div>
                </div>
              )}
              <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-3">
                <p className="font-medium">Test names (will trigger a match):</p>
                {["JOHN DOE SANCTIONED", "ACME SHELL CORP", "IRAN PETROLEUM"].map(n => (
                  <button key={n} className="block text-blue-400 hover:underline" onClick={() => { setSanctionsName(n); sanctionsMutation.mutate({ name: n }); }}>
                    {n}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fraud Corridor Stats */}
        <TabsContent value="fraud">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fraud Corridor Analytics</CardTitle>
              <p className="text-xs text-muted-foreground">Proxied to Python Fraud ML service</p>
              {(corridorStats as any)?._fallback && (
                <p className="text-xs text-yellow-400">⚠ Python service offline — no data available</p>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Transactions</TableHead>
                    <TableHead>Avg Amount</TableHead>
                    <TableHead>Total Volume</TableHead>
                    <TableHead>Fraud Rate</TableHead>
                    <TableHead>Avg Fraud Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(corridorStats?.corridors ?? []).map((c: any) => (
                    <TableRow key={c.corridor}>
                      <TableCell className="font-mono font-semibold">{c.corridor}</TableCell>
                      <TableCell>{c.transaction_count.toLocaleString()}</TableCell>
                      <TableCell>${c.avg_amount_usd.toFixed(0)}</TableCell>
                      <TableCell>${c.total_volume_usd.toLocaleString()}</TableCell>
                      <TableCell>
                        <span className={c.fraud_rate > 0.05 ? "text-red-400" : "text-green-400"}>
                          {(c.fraud_rate * 100).toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={c.avg_fraud_score * 100} className="h-1.5 w-16" />
                          <span className="text-xs">{(c.avg_fraud_score * 100).toFixed(0)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(corridorStats?.corridors ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No corridor data — start the Python Fraud ML service
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FX Quote */}
        <TabsContent value="fx">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Live FX Quote</CardTitle>
              <p className="text-xs text-muted-foreground">Proxied to Go FX Engine (port 8081) — falls back to internal rate engine</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input value={quoteForm.from} onChange={e => setQuoteForm(f => ({ ...f, from: e.target.value }))} className="text-sm h-9" placeholder="USD" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input value={quoteForm.to} onChange={e => setQuoteForm(f => ({ ...f, to: e.target.value }))} className="text-sm h-9" placeholder="NGN" />
                </div>
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" value={quoteForm.amount} onChange={e => setQuoteForm(f => ({ ...f, amount: e.target.value }))} className="text-sm h-9" />
                </div>
              </div>
              <Button className="w-full" onClick={() => refetchQuote()} disabled={quoteFetching}>
                <Zap className="w-4 h-4 mr-2" />
                {quoteFetching ? "Fetching..." : "Get Quote"}
              </Button>
              {quoteData && (
                <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-2">
                  {quoteData._fallback && (
                    <p className="text-xs text-yellow-400">⚠ Go FX service offline — using internal rate engine</p>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">You send</span>
                    <span className="font-semibold">{quoteData.sendAmount} {quoteData.from}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Recipient gets</span>
                    <span className="font-semibold text-green-400">{quoteData.receiveAmount} {quoteData.to}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>FX Rate</span>
                    <span>1 {quoteData.from} = {quoteData.fxRate} {quoteData.to}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Fee</span>
                    <span>${quoteData.fee}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Spread</span>
                    <span>{((quoteData.spread ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground border-t border-border pt-2">
                    <span>Expires</span>
                    <span>{new Date((quoteData.expiresAt ?? 0) * 1000).toLocaleTimeString()}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Architecture note */}
      <Card className="border-border bg-card/50">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <Cpu className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Polyglot Architecture</p>
              <p>All three microservices run as independent processes alongside the Node.js tRPC server. Each service exposes a REST/JSON API and is called via typed HTTP clients in <code className="bg-muted px-1 rounded">server/services/</code>. Every call has a graceful fallback so the platform remains fully operational even when individual services are offline.</p>
              <p className="font-mono text-[10px] mt-2">Go (port 8081) · Python (port 8082) · Rust (port 8083) · Node.js (port 3000)</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
