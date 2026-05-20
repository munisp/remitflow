#!/usr/bin/env python3
"""Generate pages - Part 2: Mojaloop, CBDC, BNPL, Stablecoin, BatchPayments, TransferTracking, Recurring, Referral"""
import os

D = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(D, exist_ok=True)

pages = {}

pages["Mojaloop"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Network, ArrowRightLeft, Users, Layers, Send, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_ICON: Record<string, any> = { COMMITTED: CheckCircle2, RESERVED: Clock, ABORTED: XCircle };
const STATUS_COLOR: Record<string, string> = { COMMITTED: "text-emerald-600", RESERVED: "text-yellow-600", ABORTED: "text-red-500" };

export default function Mojaloop() {
  const { data: transfers } = trpc.mojaloop.transfers.useQuery();
  const { data: participants } = trpc.mojaloop.participants.useQuery();
  const { data: windows } = trpc.mojaloop.settlementWindows.useQuery();
  const initMutation = trpc.mojaloop.initiateTransfer.useMutation({ onSuccess: () => toast.success("ILP transfer initiated!") });
  const [form, setForm] = useState({ payerFsp: "FSP_KENYA", payeeFsp: "FSP_NIGERIA", amount: "", currency: "KES" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Network className="h-5 w-5 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Mojaloop Hub</h1><p className="text-muted-foreground text-sm">FSPIOP transfers, ILP packets, and settlement</p></div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Transfers", value: transfers?.length ?? 0, color: "text-blue-600" },
            { label: "Committed", value: (transfers ?? []).filter((t: any) => t.transferState === "COMMITTED").length, color: "text-emerald-600" },
            { label: "Participants", value: participants?.length ?? 0, color: "text-purple-600" },
            { label: "Open Windows", value: (windows ?? []).filter((w: any) => w.state === "OPEN").length, color: "text-orange-600" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{s.label}</div><div className={"text-2xl font-bold " + s.color}>{s.value}</div></CardContent></Card>
          ))}
        </div>

        <Tabs defaultValue="transfers">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="transfers">Transfers</TabsTrigger>
            <TabsTrigger value="participants">Participants</TabsTrigger>
            <TabsTrigger value="settlement">Settlement</TabsTrigger>
            <TabsTrigger value="initiate">Initiate</TabsTrigger>
          </TabsList>

          <TabsContent value="transfers" className="space-y-2 mt-4">
            {(transfers ?? []).map((t: any) => {
              const Icon = STATUS_ICON[t.transferState] ?? Clock;
              return (
                <Card key={t.transferId}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <Icon className={"h-5 w-5 " + (STATUS_COLOR[t.transferState] ?? "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-muted-foreground truncate">{t.transferId}</div>
                      <div className="text-sm font-medium">{t.payerFsp} → {t.payeeFsp}</div>
                      <div className="text-xs text-muted-foreground">{t.createdAt}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{t.currency} {Number(t.amount).toLocaleString()}</div>
                      <Badge variant="outline" className="text-xs">{t.transferState}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="participants" className="space-y-2 mt-4">
            {(participants ?? []).map((p: any) => (
              <Card key={p.fspId}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center font-bold text-purple-700 text-sm">{p.fspId?.slice(4, 6)}</div>
                  <div className="flex-1">
                    <div className="font-medium">{p.fspId}</div>
                    <div className="text-xs text-muted-foreground">{p.name} · {p.country}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{p.currency} {p.balance?.toLocaleString()}</div>
                    <Badge variant={p.isActive ? "default" : "secondary"} className="text-xs">{p.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="settlement" className="space-y-2 mt-4">
            {(windows ?? []).map((w: any) => (
              <Card key={w.settlementWindowId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium">Window #{w.settlementWindowId}</div>
                    <Badge variant={w.state === "OPEN" ? "default" : "secondary"} className="text-xs">{w.state}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div><div className="text-muted-foreground text-xs">Transfers</div><div className="font-semibold">{w.transferCount}</div></div>
                    <div><div className="text-muted-foreground text-xs">Volume</div><div className="font-semibold">{w.currency} {w.totalAmount?.toLocaleString()}</div></div>
                    <div><div className="text-muted-foreground text-xs">Opened</div><div className="font-semibold text-xs">{w.openedDate}</div></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="initiate" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Initiate ILP Transfer</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><label className="text-xs font-medium">Payer FSP</label>
                    <Input value={form.payerFsp} onChange={e => setForm(p => ({ ...p, payerFsp: e.target.value }))} /></div>
                  <div className="space-y-1"><label className="text-xs font-medium">Payee FSP</label>
                    <Input value={form.payeeFsp} onChange={e => setForm(p => ({ ...p, payeeFsp: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><label className="text-xs font-medium">Amount</label>
                    <Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
                  <div className="space-y-1"><label className="text-xs font-medium">Currency</label>
                    <Input value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} /></div>
                </div>
                <Button className="w-full" disabled={!form.amount || initMutation.isPending}
                  onClick={() => initMutation.mutate({ payerFsp: form.payerFsp, payeeFsp: form.payeeFsp, amount: parseFloat(form.amount), currency: form.currency })}>
                  <Send className="h-4 w-4 mr-2" />{initMutation.isPending ? "Initiating..." : "Initiate Transfer"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
'''

pages["CBDC"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Coins, ArrowRightLeft, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";

export default function CBDC() {
  const { data: balances } = trpc.cbdc.balances.useQuery();
  const { data: txns } = trpc.cbdc.transactions.useQuery();
  const transferMutation = trpc.cbdc.transfer.useMutation({ onSuccess: () => toast.success("CBDC transfer complete!") });
  const [form, setForm] = useState({ currency: "eNGN", amount: "", recipient: "" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center"><Coins className="h-5 w-5 text-violet-600" /></div>
          <div><h1 className="text-2xl font-bold">CBDC Wallet</h1><p className="text-muted-foreground text-sm">Central Bank Digital Currency balances</p></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(balances ?? []).map((b: any) => (
            <Card key={b.symbol} className="bg-gradient-to-br from-violet-600 to-purple-700 text-white border-0">
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <div><div className="text-sm opacity-80">{b.name}</div><div className="text-3xl font-bold">{b.symbol}</div></div>
                  <Badge className="bg-white/20 text-white border-0 text-xs">{b.network}</Badge>
                </div>
                <div className="text-2xl font-bold mb-1">{b.balance.toLocaleString()}</div>
                <div className="text-xs opacity-70 font-mono truncate">{b.address}</div>
                <div className="mt-2 text-sm opacity-80">APY: {b.apy}%</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Transfer CBDC</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><label className="text-xs font-medium">Currency</label>
              <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                {(balances ?? []).map((b: any) => <option key={b.symbol} value={b.symbol}>{b.symbol} — {b.name}</option>)}
              </select>
            </div>
            <div className="space-y-1"><label className="text-xs font-medium">Recipient Address</label>
              <Input placeholder="0x..." value={form.recipient} onChange={e => setForm(p => ({ ...p, recipient: e.target.value }))} /></div>
            <div className="space-y-1"><label className="text-xs font-medium">Amount</label>
              <Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
            <Button className="w-full" disabled={!form.amount || !form.recipient || transferMutation.isPending}
              onClick={() => transferMutation.mutate({ currency: form.currency, amount: parseFloat(form.amount), recipient: form.recipient })}>
              <Zap className="h-4 w-4 mr-2" />{transferMutation.isPending ? "Transferring..." : "Transfer CBDC"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent CBDC Transactions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(txns ?? []).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <div className="text-sm font-medium">{t.type === "credit" ? "Received" : "Sent"} {t.symbol}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">{t.hash ?? t.reference}</div>
                </div>
                <div className={`font-semibold text-sm ${t.type === "credit" ? "text-emerald-600" : "text-red-500"}`}>
                  {t.type === "credit" ? "+" : "-"}{t.amount}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

pages["BNPL"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShoppingBag, CreditCard, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

export default function BNPL() {
  const { data: plans } = trpc.bnpl.plans.useQuery();
  const { data: eligibility } = trpc.bnpl.eligibility.useQuery();
  const applyMutation = trpc.bnpl.applyPlan.useMutation({ onSuccess: () => toast.success("BNPL plan activated!") });
  const [form, setForm] = useState({ merchant: "", item: "", amount: "", currency: "NGN", installments: 3 });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center"><ShoppingBag className="h-5 w-5 text-orange-600" /></div>
          <div><h1 className="text-2xl font-bold">Buy Now, Pay Later</h1><p className="text-muted-foreground text-sm">Split purchases into easy installments</p></div>
        </div>

        {/* Eligibility */}
        <Card className={`border-2 ${eligibility?.eligible ? "border-emerald-300 bg-emerald-50/50" : "border-orange-200 bg-orange-50/50"}`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Credit Eligibility</div>
              <Badge className={eligibility?.eligible ? "bg-emerald-100 text-emerald-700 border-0" : "bg-orange-100 text-orange-700 border-0"}>
                {eligibility?.eligible ? "Eligible" : "Building Credit"}
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Credit Score</span><span className="font-semibold">{eligibility?.creditScore ?? 0}/850</span></div>
              <Progress value={((eligibility?.creditScore ?? 0) / 850) * 100} className="h-2" />
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Credit Limit</span><span className="font-semibold">{eligibility?.currency ?? "NGN"} {(eligibility?.creditLimit ?? 0).toLocaleString()}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Active Plans */}
        <div>
          <h2 className="font-semibold mb-3">Active Plans</h2>
          <div className="space-y-3">
            {(plans ?? []).map((plan: any) => {
              const pct = (plan.paidInstallments / plan.totalInstallments) * 100;
              return (
                <Card key={plan.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-medium">{plan.item}</div>
                        <div className="text-xs text-muted-foreground">{plan.merchant}</div>
                      </div>
                      <Badge variant={plan.status === "active" ? "default" : "secondary"} className="text-xs capitalize">{plan.status}</Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Installments</span>
                        <span className="font-medium">{plan.paidInstallments}/{plan.totalInstallments} paid</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Next payment</span>
                        <span className="font-semibold">{plan.currency} {plan.installmentAmount?.toLocaleString()} on {plan.nextPaymentDate}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* New Plan */}
        <Card>
          <CardHeader><CardTitle className="text-base">New BNPL Purchase</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Merchant" value={form.merchant} onChange={e => setForm(p => ({ ...p, merchant: e.target.value }))} />
              <Input placeholder="Item description" value={form.item} onChange={e => setForm(p => ({ ...p, item: e.target.value }))} />
            </div>
            <Input type="number" placeholder="Amount" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            <div className="space-y-1">
              <label className="text-xs font-medium">Installments</label>
              <div className="flex gap-2">
                {[3, 6, 9, 12].map(n => (
                  <button key={n} onClick={() => setForm(p => ({ ...p, installments: n }))}
                    className={"flex-1 py-2 rounded-lg border text-sm font-medium transition-all " + (form.installments === n ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {n}x
                  </button>
                ))}
              </div>
            </div>
            <Button className="w-full" disabled={!form.merchant || !form.amount || applyMutation.isPending}
              onClick={() => applyMutation.mutate({ merchant: form.merchant, item: form.item, amount: parseFloat(form.amount), currency: form.currency, installments: form.installments })}>
              {applyMutation.isPending ? "Processing..." : `Split into ${form.installments} payments`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

pages["Stablecoin"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Coins, ArrowRightLeft, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function Stablecoin() {
  const { data: balances } = trpc.stablecoin.balances.useQuery();
  const swapMutation = trpc.stablecoin.swap.useMutation({ onSuccess: () => toast.success("Swap executed!") });
  const [from, setFrom] = useState("USDT");
  const [to, setTo] = useState("USDC");
  const [amount, setAmount] = useState("");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center"><Coins className="h-5 w-5 text-teal-600" /></div>
          <div><h1 className="text-2xl font-bold">Stablecoins</h1><p className="text-muted-foreground text-sm">USDT, USDC, BUSD balances and swaps</p></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {(balances ?? []).map((b: any) => (
            <Card key={b.symbol}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-lg">{b.symbol}</div>
                  <Badge variant="outline" className="text-xs">{b.network}</Badge>
                </div>
                <div className="text-2xl font-bold mb-1">{b.balance.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{b.name}</div>
                <div className="mt-2 flex items-center gap-1 text-sm text-emerald-600"><TrendingUp className="h-3 w-3" />{b.apy}% APY</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Swap Stablecoins</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium">From</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={from} onChange={e => setFrom(e.target.value)}>
                  {(balances ?? []).map((b: any) => <option key={b.symbol} value={b.symbol}>{b.symbol}</option>)}
                </select>
              </div>
              <ArrowRightLeft className="h-5 w-5 text-muted-foreground mt-5" />
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium">To</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={to} onChange={e => setTo(e.target.value)}>
                  {(balances ?? []).map((b: any) => <option key={b.symbol} value={b.symbol}>{b.symbol}</option>)}
                </select>
              </div>
            </div>
            <Input type="number" placeholder="Amount to swap" value={amount} onChange={e => setAmount(e.target.value)} />
            {amount && <div className="p-3 bg-muted/50 rounded-lg text-sm"><span className="text-muted-foreground">You receive: </span><span className="font-semibold">{(parseFloat(amount) * 0.998).toFixed(4)} {to}</span><span className="text-muted-foreground ml-2">(0.2% fee)</span></div>}
            <Button className="w-full" disabled={!amount || from === to || swapMutation.isPending}
              onClick={() => swapMutation.mutate({ from, to, amount: parseFloat(amount) })}>
              {swapMutation.isPending ? "Swapping..." : `Swap ${from} → ${to}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

pages["BatchPayments"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layers, Plus, Trash2, Upload, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  processing: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-blue-100 text-blue-700",
};

export default function BatchPayments() {
  const { data: batches, refetch } = trpc.batch.list.useQuery();
  const createMutation = trpc.batch.create.useMutation({ onSuccess: () => { toast.success("Batch payment created!"); refetch(); } });
  const [name, setName] = useState("");
  const [rows, setRows] = useState([{ recipient: "", amount: "", currency: "NGN" }]);

  const addRow = () => setRows(p => [...p, { recipient: "", amount: "", currency: "NGN" }]);
  const removeRow = (i: number) => setRows(p => p.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string) => setRows(p => p.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center"><Layers className="h-5 w-5 text-indigo-600" /></div>
          <div><h1 className="text-2xl font-bold">Batch Payments</h1><p className="text-muted-foreground text-sm">Send to multiple recipients at once</p></div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">New Batch</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Batch name (e.g. March Salaries)" value={name} onChange={e => setName(e.target.value)} />
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input className="flex-1" placeholder="Recipient account" value={row.recipient} onChange={e => updateRow(i, "recipient", e.target.value)} />
                  <Input className="w-28" type="number" placeholder="Amount" value={row.amount} onChange={e => updateRow(i, "amount", e.target.value)} />
                  <select className="border rounded-md px-2 py-2 bg-background text-sm" value={row.currency} onChange={e => updateRow(i, "currency", e.target.value)}>
                    {["NGN","USD","GBP","EUR","KES"].map(c => <option key={c}>{c}</option>)}
                  </select>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeRow(i)} disabled={rows.length === 1}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Add Row</Button>
              <div className="text-sm text-muted-foreground">Total: <span className="font-bold text-foreground">{total.toLocaleString()}</span></div>
            </div>
            <Button className="w-full" disabled={!name || rows.every(r => !r.recipient) || createMutation.isPending}
              onClick={() => createMutation.mutate({ name, payments: rows.filter(r => r.recipient && r.amount).map(r => ({ recipient: r.recipient, amount: parseFloat(r.amount), currency: r.currency })) })}>
              {createMutation.isPending ? "Creating..." : `Send Batch (${rows.filter(r => r.recipient).length} payments)`}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="font-semibold">Recent Batches</h2>
          {(batches ?? []).map((b: any) => (
            <Card key={b.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.paymentCount} payments · {b.currency} {b.totalAmount?.toLocaleString()} · {b.createdAt}</div>
                </div>
                <Badge className={"text-xs border-0 " + (STATUS_STYLES[b.status] ?? "")}>{b.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

pages["TransferTracking"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, CheckCircle2, Clock, AlertCircle, Package } from "lucide-react";

export default function TransferTracking() {
  const [ref, setRef] = useState("RF2024031601");
  const [query, setQuery] = useState("RF2024031601");
  const { data: tracking, isLoading } = trpc.tracking.track.useQuery({ reference: query }, { enabled: !!query });

  const STEP_ICONS: Record<string, any> = { completed: CheckCircle2, processing: Clock, pending: AlertCircle };
  const STEP_COLORS: Record<string, string> = { completed: "text-emerald-600 bg-emerald-100", processing: "text-yellow-600 bg-yellow-100", pending: "text-gray-400 bg-gray-100" };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center"><Package className="h-5 w-5 text-cyan-600" /></div>
          <div><h1 className="text-2xl font-bold">Track Transfer</h1><p className="text-muted-foreground text-sm">Real-time transfer status and timeline</p></div>
        </div>

        <div className="flex gap-2">
          <Input placeholder="Enter reference number (e.g. RF2024031601)" value={ref} onChange={e => setRef(e.target.value)} />
          <Button onClick={() => setQuery(ref)} disabled={isLoading}><Search className="h-4 w-4" /></Button>
        </div>

        {tracking && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Reference</div>
                    <div className="font-mono font-bold">{tracking.reference}</div>
                  </div>
                  <Badge className="capitalize">{tracking.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><div className="text-muted-foreground">Amount</div><div className="font-semibold">{tracking.fromCurrency} {tracking.amount?.toLocaleString()}</div></div>
                  <div><div className="text-muted-foreground">Recipient gets</div><div className="font-semibold">{tracking.toCurrency} {tracking.toAmount?.toLocaleString()}</div></div>
                  <div><div className="text-muted-foreground">Recipient</div><div className="font-semibold">{tracking.recipientName}</div></div>
                  <div><div className="text-muted-foreground">ETA</div><div className="font-semibold">{tracking.estimatedArrival}</div></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Transfer Timeline</CardTitle></CardHeader>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {(tracking.timeline ?? []).map((step: any, i: number) => {
                    const Icon = STEP_ICONS[step.status] ?? Clock;
                    return (
                      <div key={i} className="flex gap-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${STEP_COLORS[step.status]}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 pb-4 border-b last:border-0">
                          <div className="font-medium text-sm">{step.label}</div>
                          <div className="text-xs text-muted-foreground">{step.description}</div>
                          {step.timestamp && <div className="text-xs text-muted-foreground mt-1">{new Date(step.timestamp).toLocaleString()}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
'''

pages["Recurring"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Plus, Pause, X, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function Recurring() {
  const { data: recurring, refetch } = trpc.recurring.list.useQuery();
  const createMutation = trpc.recurring.create.useMutation({ onSuccess: () => { toast.success("Recurring payment created!"); refetch(); setOpen(false); } });
  const pauseMutation = trpc.recurring.pause.useMutation({ onSuccess: () => { toast.success("Paused"); refetch(); } });
  const cancelMutation = trpc.recurring.cancel.useMutation({ onSuccess: () => { toast.success("Cancelled"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", currency: "NGN", frequency: "monthly", recipient: "" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><RefreshCw className="h-5 w-5 text-green-600" /></div>
            <div><h1 className="text-2xl font-bold">Recurring Payments</h1><p className="text-muted-foreground text-sm">Automated scheduled transfers</p></div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New</Button>
        </div>

        <div className="space-y-3">
          {(recurring ?? []).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.recipient} · {r.frequency}</div>
                  <div className="text-xs text-muted-foreground">Next: {r.nextDate}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{r.currency} {r.amount?.toLocaleString()}</div>
                  <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs capitalize">{r.status}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => pauseMutation.mutate({ id: r.id })}><Pause className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => cancelMutation.mutate({ id: r.id })}><X className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Recurring Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Payment name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Input placeholder="Recipient" value={form.recipient} onChange={e => setForm(p => ({ ...p, recipient: e.target.value }))} />
            <div className="flex gap-2">
              <Input type="number" placeholder="Amount" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{["NGN","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
            <Button className="w-full" disabled={!form.name || !form.amount || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: form.name, amount: parseFloat(form.amount), currency: form.currency, frequency: form.frequency, recipient: form.recipient })}>
              {createMutation.isPending ? "Creating..." : "Create Recurring Payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

pages["Referral"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Gift, Copy, Share2, Trophy, Users, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function Referral() {
  const { data: info } = trpc.referral.info.useQuery();

  const copyCode = () => { navigator.clipboard.writeText(info?.code ?? ""); toast.success("Code copied!"); };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center"><Gift className="h-5 w-5 text-pink-600" /></div>
          <div><h1 className="text-2xl font-bold">Refer & Earn</h1><p className="text-muted-foreground text-sm">Earn rewards for every friend you invite</p></div>
        </div>

        {/* Referral Code */}
        <Card className="bg-gradient-to-br from-pink-500 to-rose-600 text-white border-0">
          <CardContent className="p-6 text-center">
            <div className="text-sm opacity-80 mb-2">Your Referral Code</div>
            <div className="text-4xl font-bold tracking-widest mb-4">{info?.code ?? "REMIT2024"}</div>
            <div className="flex gap-3 justify-center">
              <Button variant="secondary" className="bg-white/20 hover:bg-white/30 text-white border-0" onClick={copyCode}>
                <Copy className="h-4 w-4 mr-1" />Copy Code
              </Button>
              <Button variant="secondary" className="bg-white/20 hover:bg-white/30 text-white border-0" onClick={() => toast.success("Share link copied!")}>
                <Share2 className="h-4 w-4 mr-1" />Share Link
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4 text-center"><Users className="h-5 w-5 mx-auto mb-1 text-blue-500" /><div className="text-2xl font-bold">{info?.totalReferrals ?? 0}</div><div className="text-xs text-muted-foreground">Referrals</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><TrendingUp className="h-5 w-5 mx-auto mb-1 text-emerald-500" /><div className="text-2xl font-bold">₦{((info?.totalEarned ?? 0)).toLocaleString()}</div><div className="text-xs text-muted-foreground">Earned</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><Trophy className="h-5 w-5 mx-auto mb-1 text-yellow-500" /><div className="text-2xl font-bold">#{info?.rank ?? "-"}</div><div className="text-xs text-muted-foreground">Rank</div></CardContent></Card>
        </div>

        {/* Tiers */}
        <Card>
          <CardHeader><CardTitle className="text-base">Reward Tiers</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(info?.tiers ?? []).map((tier: any) => (
              <div key={tier.name} className="flex items-center gap-4">
                <div className="text-2xl">{tier.emoji ?? "🏅"}</div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{tier.name}</span>
                    <span className="text-muted-foreground">{tier.referrals} referrals</span>
                  </div>
                  <Progress value={Math.min(100, ((info?.totalReferrals ?? 0) / tier.referrals) * 100)} className="h-1.5" />
                </div>
                <div className="text-sm font-semibold text-emerald-600">+₦{tier.reward?.toLocaleString()}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Leaderboard */}
        <Card>
          <CardHeader><CardTitle className="text-base">Top Referrers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(info?.leaderboard ?? []).map((user: any, i: number) => (
              <div key={user.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">#{i + 1}</div>
                <div className="flex-1 font-medium text-sm">{user.name}</div>
                <div className="text-sm text-muted-foreground">{user.referrals} refs</div>
                <div className="font-semibold text-sm">₦{user.earned?.toLocaleString()}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

for name, content in pages.items():
    path = os.path.join(D, f"{name}.tsx")
    with open(path, "w") as f:
        f.write(content)
    print(f"Written: {name}.tsx")

print(f"\nDone! Written {len(pages)} pages.")
