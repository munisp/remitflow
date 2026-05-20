import { toast } from 'sonner';
/**
 * AgentPOS — Agent Cash-In / Cash-Out Terminal
 * Allows registered agents to:
 *  - View their float balance and commission earned
 *  - Initiate cash-in (customer deposits cash, agent credits wallet)
 *  - Initiate cash-out (customer withdraws, agent debits wallet)
 *  - View today's transaction log
 *  - Print/share receipts
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp, Users,
  Receipt, RefreshCw, CheckCircle2, AlertTriangle, ArrowLeft,
  Phone, DollarSign, Banknote, Clock, Shield
} from "lucide-react";
import { useLocation } from "wouter";

const CURRENCIES = ["NGN", "KES", "GHS", "ZAR", "XOF", "UGX", "TZS", "ETB", "RWF"];

type TxType = "cash_in" | "cash_out";

interface PosTransaction {
  id: string;
  type: TxType;
  amount: number;
  currency: string;
  customerPhone: string;
  status: "completed" | "pending" | "failed";
  createdAt: Date;
  reference: string;
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: any; color: string;
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={"text-xl font-bold " + color}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + color.replace("text-", "bg-").replace("500", "500/10")}>
            <Icon className={"h-5 w-5 " + color} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgentPOS() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  // Form state
  const [txType, setTxType] = useState<TxType>("cash_in");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [reference, setReference] = useState("");
  const [lastTx, setLastTx] = useState<PosTransaction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch agent account
  const { data: agentData, refetch: refetchAgent } = trpc.posAgentCashFlow.agentStats.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  const agent = (agentData as any)?.agent;

  // Fetch POS terminals
  const { data: terminals } = trpc.posAgentCashFlow.agentStats.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });

  // Fetch today's transactions
  const { data: todayTxs, refetch: refetchTxs } = trpc.posAgentCashFlow.todayTransactions.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30_000,
  });

  // Cash-in mutation
  const cashInMutation = trpc.posAgentCashFlow.cashIn.useMutation({
    onSuccess: (data: any) => {
      toast("Cash-In Successful ✔", { description: `₦${Number(amount).toLocaleString()} credited. Commission: ${data?.commissionRate ?? 0} — Printing receipt…` });
      setLastTx(data.transaction);
      setAmount(""); setCustomerPhone(""); setCustomerName(""); setReference("");
      refetchAgent(); refetchTxs();
      setIsProcessing(false);
      // Auto-print receipt immediately after success
      if (data.transaction) setTimeout(() => handlePrintReceipt(data.transaction), 600);
    },
    onError: (err: any) => {
      toast.error("Cash-In Failed");
      setIsProcessing(false);
    },
  });

  // Cash-out mutation
  const cashOutMutation = trpc.posAgentCashFlow.cashOut.useMutation({
    onSuccess: (data: any) => {
      toast("Cash-Out Successful ✔", { description: `${currency} ${Number(amount).toLocaleString()} disbursed. Commission: ${data?.commissionRate ?? 0} — Printing receipt…` });
      setLastTx(data.transaction);
      setAmount(""); setCustomerPhone(""); setCustomerName(""); setReference("");
      refetchAgent(); refetchTxs();
      setIsProcessing(false);
      // Auto-print receipt immediately after success
      if (data.transaction) setTimeout(() => handlePrintReceipt(data.transaction), 600);
    },
    onError: (err: any) => {
      toast.error("Cash-Out Failed");
      setIsProcessing(false);
    },
  });

  // Receipt generation mutation
  const receiptMutation = trpc.posReceipt.generate.useMutation({
    onSuccess: (data: any) => {
      // Use srcdoc iframe instead of document.write to avoid XSS
      const html = atob(data.receiptBase64);
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:420px;height:640px;";
      iframe.srcdoc = html;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try { iframe.contentWindow?.print(); } finally {
          setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 3000);
        }
      };
    },
    onError: (err: any) => toast.error("Receipt Error"),
  });

  const handlePrintReceipt = useCallback((tx: PosTransaction) => {
    receiptMutation.mutate({
      transactionId: tx.id,
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency,
      customerPhone: tx.customerPhone,
      agentCode: (agentData as any)?.(agentData as any)?.agent?.agentCode ?? "AGT-UNKNOWN",
      agentName: (agentData as any)?.(agentData as any)?.agent?.businessName ?? user?.name ?? "Agent",
      reference: tx.reference,
      customerName: tx.customerPhone ? `Customer` : "Customer",
      timestamp: Date.now()
    });
  }, [agent, receiptMutation, user]);

  const handleSubmit = useCallback(() => {
    if (!amount || !customerPhone) {
      toast.error("Missing fields", { description: "Amount and customer phone are required." });
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Invalid amount", { description: "Please enter a valid amount." });
      return;
    }
    setIsProcessing(true);
    const payload = { amount: amountNum, currency, customerPhone, customerName, reference };
    if (txType === "cash_in") cashInMutation.mutate(payload);
    else cashOutMutation.mutate(payload);
  }, [amount, currency, customerPhone, customerName, reference, txType, cashInMutation, cashOutMutation, toast]);

  const stats = (agentData as any)?.stats;
  const txList: PosTransaction[] = (todayTxs as any) ?? [];
  const terminalList = (terminals as any) ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Banknote className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Agent POS Terminal</h1>
              <p className="text-xs text-muted-foreground">
                {(agentData as any)?.agent ? `${agent.businessName ?? "Agent"} · ${agent.agentCode}` : "Loading..."}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {agent && (
              <Badge variant="secondary" className="text-xs capitalize">{agent.tier} tier</Badge>
            )}
            <Badge variant={(agentData as any)?.agent?.status === "active" ? "default" : "destructive"} className="text-xs">
              {(agentData as any)?.agent?.status ?? "unknown"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Float Balance" value={`₦${Number(stats?.floatBalance ?? 0).toLocaleString()}`} sub="Available liquidity" icon={Wallet} color="text-green-500" />
          <StatCard label="Today's Volume" value={`₦${Number(stats?.todayVolume ?? 0).toLocaleString()}`} sub={`${stats?.todayCount ?? 0} transactions`} icon={TrendingUp} color="text-blue-500" />
          <StatCard label="Commission Earned" value={`₦${Number(stats?.totalCommission ?? 0).toLocaleString()}`} sub={`${(agentData as any)?.agent?.commissionRate ?? 1.5}% rate`} icon={DollarSign} color="text-amber-500" />
          <StatCard label="Customers Served" value={String(stats?.totalCustomers ?? 0)} sub="All time" icon={Users} color="text-purple-500" />
        </div>

        {/* Active Terminals */}
        {terminalList.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Active terminals:</span>
            {terminalList.slice(0, 4).map((t: any) => (
              <Badge key={t.id} variant="outline" className="text-xs">
                {t.terminalId} · {t.model ?? "POS"}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Transaction Form */}
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                New Transaction
              </CardTitle>
              <CardDescription className="text-xs">Process cash-in or cash-out for a customer</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Transaction type toggle */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={txType === "cash_in" ? "default" : "outline"}
                  className="w-full gap-2"
                  onClick={() => setTxType("cash_in")}
                >
                  <ArrowDownLeft className="h-4 w-4" />
                  Cash In
                </Button>
                <Button
                  variant={txType === "cash_out" ? "default" : "outline"}
                  className="w-full gap-2"
                  onClick={() => setTxType("cash_out")}
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Cash Out
                </Button>
              </div>

              <div className={`text-xs px-3 py-2 rounded-lg ${txType === "cash_in" ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                {txType === "cash_in"
                  ? "Customer gives you cash → you credit their RemitFlow wallet"
                  : "Customer requests cash → you debit their RemitFlow wallet"}
              </div>

              <Separator />

              {/* Amount & Currency */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 flex-wrap">
                {[1000, 5000, 10000, 50000].map(v => (
                  <Button key={v} variant="outline" size="sm" className="text-xs h-7 px-2" onClick={() => setAmount(String(v))}>
                    ₦{v.toLocaleString()}
                  </Button>
                ))}
              </div>

              {/* Customer details */}
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Phone className="h-3 w-3" />Customer Phone *</Label>
                <Input
                  type="tel"
                  placeholder="+234 800 000 0000"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Customer Name (optional)</Label>
                <Input
                  placeholder="Amara Okafor"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Reference / Note (optional)</Label>
                <Input
                  placeholder="e.g. school fees, rent"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                />
              </div>

              {/* Commission preview */}
              {amount && parseFloat(amount) > 0 && (
                <div className="bg-muted rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Your commission ({(agentData as any)?.agent?.commissionRate ?? 1.5}%)</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    ₦{(parseFloat(amount) * (parseFloat((agentData as any)?.agent?.commissionRate ?? "1.5") / 100)).toLocaleString("en", { maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={handleSubmit}
                disabled={isProcessing || !amount || !customerPhone}
              >
                {isProcessing ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" />Processing...</>
                ) : txType === "cash_in" ? (
                  <><ArrowDownLeft className="h-4 w-4" />Confirm Cash In</>
                ) : (
                  <><ArrowUpRight className="h-4 w-4" />Confirm Cash Out</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Right panel: last receipt + today's log */}
          <div className="space-y-4">
            {/* Last transaction receipt */}
            {lastTx && (
              <Card className="border-green-500/30 bg-green-500/5 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Transaction Successful
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {[
                    ["Reference", lastTx.reference],
                    ["Type", lastTx.type === "cash_in" ? "Cash In" : "Cash Out"],
                    ["Amount", `${lastTx.currency} ${Number(lastTx.amount).toLocaleString()}`],
                    ["Customer", lastTx.customerPhone],
                    ["Commission", `₦${Number((lastTx as any)?.commissionRate ?? 0).toLocaleString()}`],
                    ["Status", lastTx.status],
                    ["Time", new Date(lastTx.createdAt).toLocaleTimeString()],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-xs gap-1"
                    onClick={() => lastTx && handlePrintReceipt(lastTx)}
                    disabled={!lastTx || receiptMutation.isPending}
                  >
                    <Receipt className="h-3 w-3" />
                    {receiptMutation.isPending ? "Generating..." : "Print / Share Receipt"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Today's transaction log */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Today's Transactions
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchTxs()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {txList.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-xs">
                    No transactions today yet. Start processing!
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {txList.map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-2">
                          {tx.type === "cash_in"
                            ? <ArrowDownLeft className="h-3.5 w-3.5 text-green-500" />
                            : <ArrowUpRight className="h-3.5 w-3.5 text-amber-500" />
                          }
                          <div>
                            <p className="text-xs font-medium">{tx.customerPhone}</p>
                            <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleTimeString()}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold">{tx.currency} {Number(tx.amount).toLocaleString()}</p>
                          <Badge variant={tx.status === "completed" ? "default" : tx.status === "failed" ? "destructive" : "secondary"} className="text-xs px-1 py-0 h-4">
                            {tx.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Float warning */}
            {stats?.floatBalance !== undefined && Number(stats.floatBalance) < 10000 && (
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium text-amber-700 dark:text-amber-400">Low float balance</p>
                  <p className="text-muted-foreground">Top up your float to continue processing cash-out transactions.</p>
                </div>
              </div>
            )}

            {/* Compliance note */}
            <div className="flex items-start gap-2 bg-muted rounded-lg px-3 py-2">
              <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                All transactions are AML-screened and audit-logged. Daily limit: ₦{Number((agentData as any)?.agent?.dailyLimit ?? 1000000).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
