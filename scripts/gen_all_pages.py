#!/usr/bin/env python3
"""Generate all remaining RemitFlow page files."""
import os

PAGES_DIR = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(PAGES_DIR, exist_ok=True)

pages = {}

# ─── Transactions ─────────────────────────────────────────────────────────────
pages["Transactions"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpRight, ArrowDownLeft, Search, Filter, Download, Eye } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  pending: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
  processing: "bg-blue-100 text-blue-700",
};

export default function Transactions() {
  const { data, isLoading } = trpc.transactions.list.useQuery({ page: 1, limit: 20 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<typeof data extends { transactions: infer T } ? T extends Array<infer U> ? U : never : never | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const txns = data?.transactions ?? [];
  const filtered = txns.filter((t: { description: string; status: string; reference: string }) =>
    (statusFilter === "all" || t.status === statusFilter) &&
    (t.description.toLowerCase().includes(search.toLowerCase()) || t.reference.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Transactions</h1>
            <p className="text-muted-foreground text-sm">Your complete payment history</p>
          </div>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search transactions…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2">
              {["all","completed","pending","failed"].map(s => (
                <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)} className="capitalize">{s}</Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{filtered.length} transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
            ) : filtered.map((tx: { id: number; type: string; description: string; amount: number; currency: string; status: string; reference: string; date: string; fee: number; exchangeRate: number; recipient: string }) => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 border-b last:border-0 cursor-pointer" onClick={() => { setSelected(tx as typeof selected); setDetailOpen(true); }}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${tx.type === "credit" ? "bg-emerald-100" : "bg-slate-100"}`}>
                  {tx.type === "credit" ? <ArrowDownLeft className="h-4 w-4 text-emerald-600" /> : <ArrowUpRight className="h-4 w-4 text-slate-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{tx.description}</div>
                  <div className="text-xs text-muted-foreground">{tx.reference} · {new Date(tx.date).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold text-sm ${tx.type === "credit" ? "text-emerald-600" : ""}`}>
                    {tx.type === "credit" ? "+" : "-"}{tx.currency} {tx.amount.toLocaleString()}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[tx.status] ?? "bg-muted text-muted-foreground"}`}>{tx.status}</span>
                </div>
                <Eye className="h-4 w-4 text-muted-foreground ml-1" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transaction Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              {[
                ["Reference", (selected as { reference: string }).reference],
                ["Description", (selected as { description: string }).description],
                ["Amount", `${(selected as { currency: string }).currency} ${(selected as { amount: number }).amount.toLocaleString()}`],
                ["Fee", `${(selected as { currency: string }).currency} ${(selected as { fee: number }).fee}`],
                ["Status", (selected as { status: string }).status],
                ["Date", new Date((selected as { date: string }).date).toLocaleString()],
                ["Recipient", (selected as { recipient: string }).recipient],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-b pb-2 last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium capitalize">{v as string}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

# ─── ExchangeRates ─────────────────────────────────────────────────────────────
pages["ExchangeRates"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, RefreshCw, Lock, Calculator } from "lucide-react";

export default function ExchangeRates() {
  const { data: rates, isLoading, refetch } = trpc.fx.rates.useQuery();
  const lockMutation = trpc.fx.lockRate.useMutation({ onSuccess: () => toast.success("Rate locked for 30 minutes!") });
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [amount, setAmount] = useState("100");
  const calcQuery = trpc.fx.calculate.useQuery({ from, to, amount: parseFloat(amount) || 0 });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Exchange Rates</h1>
            <p className="text-muted-foreground text-sm">Live FX rates updated every 60 seconds</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
        </div>

        {/* Calculator */}
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-5 w-5 text-indigo-600" />Rate Calculator</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-sm font-medium block mb-1">Amount</label>
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">From</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background" value={from} onChange={e => setFrom(e.target.value)}>
                  {["USD","GBP","EUR","NGN","KES","GHS","ZAR","CAD","AUD"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">To</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background" value={to} onChange={e => setTo(e.target.value)}>
                  {["NGN","USD","GBP","EUR","KES","GHS","ZAR","CAD","AUD"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {calcQuery.data && (
              <div className="bg-white rounded-lg p-4 border flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{to} {calcQuery.data.result.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className="text-sm text-muted-foreground">Rate: 1 {from} = {calcQuery.data.rate} {to}</div>
                </div>
                <Button onClick={() => lockMutation.mutate({ from, to, amount: parseFloat(amount) || 0, duration: 30 })} disabled={lockMutation.isPending}>
                  <Lock className="h-4 w-4 mr-1" />{lockMutation.isPending ? "Locking…" : "Lock Rate"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rate Table */}
        <Card>
          <CardHeader><CardTitle className="text-base">All Rates</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-12 rounded" />)}</div>
            ) : (rates ?? []).map((r: { pair: string; rate: number; change: number; high24h: number; low24h: number; volume: string }) => (
              <div key={r.pair} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">{r.pair.split("/")[0]}</div>
                <div className="flex-1">
                  <div className="font-semibold">{r.pair}</div>
                  <div className="text-xs text-muted-foreground">Vol: {r.volume} · H: {r.high24h} · L: {r.low24h}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{r.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  <div className={`text-xs flex items-center justify-end gap-1 ${r.change >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {r.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {r.change >= 0 ? "+" : ""}{r.change}%
                  </div>
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

# ─── Receive ─────────────────────────────────────────────────────────────────
pages["Receive"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, QrCode, Plus, Building2, ArrowDownLeft } from "lucide-react";

export default function Receive() {
  const { data } = trpc.virtualAccount.list.useQuery();
  const createMutation = trpc.virtualAccount.create.useMutation({ onSuccess: () => toast.success("Virtual account created!") });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center">
            <ArrowDownLeft className="h-5 w-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Receive Money</h1>
            <p className="text-muted-foreground text-sm">Share your account details to receive payments</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => createMutation.mutate({ currency: "NGN", bank: "Wema Bank" })} disabled={createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" />{createMutation.isPending ? "Creating…" : "New Virtual Account"}
          </Button>
        </div>

        <div className="space-y-4">
          {(data ?? []).map((acc: { id: number; currency: string; bankName: string; accountNumber: string; accountName: string; status: string }) => (
            <Card key={acc.id} className="border-l-4 border-l-indigo-500">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-indigo-600" />
                    <div>
                      <div className="font-semibold">{acc.bankName}</div>
                      <Badge variant="outline" className="text-xs mt-0.5">{acc.currency}</Badge>
                    </div>
                  </div>
                  <Badge className={acc.status === "active" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-muted text-muted-foreground border-0"}>{acc.status}</Badge>
                </div>
                <div className="space-y-3">
                  <div className="bg-muted rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">Account Number</div>
                      <div className="font-mono font-bold text-lg tracking-wider">{acc.accountNumber}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(acc.accountNumber, "Account number")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="bg-muted rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">Account Name</div>
                      <div className="font-semibold">{acc.accountName}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(acc.accountName, "Account name")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-3" size="sm">
                  <QrCode className="h-4 w-4 mr-1" />Show QR Code
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── Airtime ─────────────────────────────────────────────────────────────────
pages["Airtime"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Smartphone, Wifi, CheckCircle2, Loader2 } from "lucide-react";

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export default function Airtime() {
  const { data: providers } = trpc.airtime.providers.useQuery();
  const topupMutation = trpc.airtime.topup.useMutation({ onSuccess: () => { toast.success("Airtime sent!"); setPhone(""); setAmount(""); } });
  const [tab, setTab] = useState<"airtime" | "data">("airtime");
  const [provider, setProvider] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const { data: bundles } = trpc.airtime.dataBundles.useQuery({ provider: provider || "MTN" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Airtime & Data</h1>
            <p className="text-muted-foreground text-sm">Top up any network instantly</p>
          </div>
        </div>

        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          <button onClick={() => setTab("airtime")} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${tab === "airtime" ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}>
            <Smartphone className="h-4 w-4 inline mr-1" />Airtime
          </button>
          <button onClick={() => setTab("data")} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${tab === "data" ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}>
            <Wifi className="h-4 w-4 inline mr-1" />Data Bundle
          </button>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <Label>Network Provider</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {(providers ?? []).map((p: { id: string; name: string; logo: string; color: string }) => (
                  <button key={p.id} onClick={() => setProvider(p.id)}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${provider === p.id ? "border-indigo-500 bg-indigo-50" : "border-border hover:border-indigo-300"}`}>
                    <div className="text-xl">{p.logo}</div>
                    <div className="text-xs font-medium mt-1">{p.name}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Phone Number</Label>
              <Input className="mt-1" placeholder="+234 800 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            {tab === "airtime" ? (
              <div>
                <Label>Amount (NGN)</Label>
                <div className="grid grid-cols-3 gap-2 mt-2 mb-3">
                  {QUICK_AMOUNTS.map(a => (
                    <button key={a} onClick={() => setAmount(String(a))}
                      className={`py-2 rounded-lg border text-sm font-medium transition-all ${amount === String(a) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-border hover:border-indigo-300"}`}>
                      ₦{a.toLocaleString()}
                    </button>
                  ))}
                </div>
                <Input type="number" placeholder="Or enter custom amount" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
            ) : (
              <div>
                <Label>Select Bundle</Label>
                <div className="space-y-2 mt-2">
                  {(bundles ?? []).map((b: { id: string; name: string; size: string; validity: string; price: number }) => (
                    <button key={b.id} onClick={() => setAmount(String(b.price))}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${amount === String(b.price) ? "border-indigo-500 bg-indigo-50" : "border-border hover:border-indigo-300"}`}>
                      <div className="text-left">
                        <div className="font-medium text-sm">{b.name}</div>
                        <div className="text-xs text-muted-foreground">{b.size} · {b.validity}</div>
                      </div>
                      <div className="font-bold text-indigo-600">₦{b.price.toLocaleString()}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button className="w-full" disabled={!provider || !phone || !amount || topupMutation.isPending}
              onClick={() => topupMutation.mutate({ provider, phone, amount: parseFloat(amount), currency: "NGN" })}>
              {topupMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing…</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Buy {tab === "airtime" ? "Airtime" : "Data"}</>}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ─── Bills ─────────────────────────────────────────────────────────────────
pages["Bills"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Zap, Droplets, Tv, Wifi, GraduationCap, ShieldCheck, Loader2, ArrowLeft } from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  electricity: <Zap className="h-6 w-6" />, water: <Droplets className="h-6 w-6" />,
  cable: <Tv className="h-6 w-6" />, internet: <Wifi className="h-6 w-6" />,
  education: <GraduationCap className="h-6 w-6" />, insurance: <ShieldCheck className="h-6 w-6" />,
};
const COLORS: Record<string, string> = {
  electricity: "bg-yellow-100 text-yellow-600", water: "bg-blue-100 text-blue-600",
  cable: "bg-purple-100 text-purple-600", internet: "bg-cyan-100 text-cyan-600",
  education: "bg-green-100 text-green-600", insurance: "bg-rose-100 text-rose-600",
};

export default function Bills() {
  const { data: categories } = trpc.bills.categories.useQuery();
  const payMutation = trpc.bills.pay.useMutation({ onSuccess: () => { toast.success("Bill payment successful!"); setStep("categories"); } });
  const [step, setStep] = useState<"categories" | "pay">("categories");
  const [selectedCat, setSelectedCat] = useState<{ id: string; name: string; providers: string[] } | null>(null);
  const [provider, setProvider] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
            <Zap className="h-5 w-5 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Pay Bills</h1>
            <p className="text-muted-foreground text-sm">Utilities, subscriptions & more</p>
          </div>
        </div>

        {step === "categories" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(categories ?? []).map((cat: { id: string; name: string; providers: string[] }) => (
              <button key={cat.id} onClick={() => { setSelectedCat(cat); setStep("pay"); }}
                className="p-4 rounded-xl border hover:border-indigo-400 hover:bg-indigo-50/50 transition-all text-center group">
                <div className={`w-12 h-12 rounded-xl ${COLORS[cat.id] ?? "bg-muted text-muted-foreground"} flex items-center justify-center mx-auto mb-2`}>
                  {ICONS[cat.id] ?? <Zap className="h-6 w-6" />}
                </div>
                <div className="font-medium text-sm">{cat.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{cat.providers.length} providers</div>
              </button>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-5 space-y-4">
              <button onClick={() => setStep("categories")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />{selectedCat?.name}
              </button>
              <div>
                <Label>Provider</Label>
                <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background" value={provider} onChange={e => setProvider(e.target.value)}>
                  <option value="">Select provider</option>
                  {selectedCat?.providers.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <Label>Account / Meter Number</Label>
                <Input className="mt-1" placeholder="Enter account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
              </div>
              <div>
                <Label>Amount (NGN)</Label>
                <Input type="number" className="mt-1" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <Button className="w-full" disabled={!provider || !accountNumber || !amount || payMutation.isPending}
                onClick={() => payMutation.mutate({ category: selectedCat?.id ?? "", provider, accountNumber, amount: parseFloat(amount), currency: "NGN" })}>
                {payMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing…</> : "Pay Bill"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
'''

# ─── Cards ─────────────────────────────────────────────────────────────────
pages["Cards"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CreditCard, Plus, Snowflake, Ban, Eye, EyeOff, Wifi } from "lucide-react";

export default function Cards() {
  const { data: cards, refetch } = trpc.cards.list.useQuery();
  const freezeMutation = trpc.cards.freeze.useMutation({ onSuccess: () => { toast.success("Card frozen"); refetch(); } });
  const unfreezeMutation = trpc.cards.unfreeze.useMutation({ onSuccess: () => { toast.success("Card unfrozen"); refetch(); } });
  const cancelMutation = trpc.cards.cancel.useMutation({ onSuccess: () => { toast.success("Card cancelled"); refetch(); } });
  const createMutation = trpc.cards.create.useMutation({ onSuccess: () => { toast.success("Card created!"); refetch(); } });
  const [showNumbers, setShowNumbers] = useState<Record<number, boolean>>({});

  const CARD_GRADIENTS = ["from-indigo-600 to-purple-600", "from-slate-700 to-slate-900", "from-emerald-600 to-teal-700", "from-rose-500 to-pink-600"];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">My Cards</h1>
              <p className="text-muted-foreground text-sm">Virtual & physical payment cards</p>
            </div>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />New Card</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New Card</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                {[
                  { type: "virtual" as const, brand: "visa" as const, currency: "USD", label: "Virtual Visa (USD)" },
                  { type: "virtual" as const, brand: "mastercard" as const, currency: "NGN", label: "Virtual Mastercard (NGN)" },
                  { type: "physical" as const, brand: "verve" as const, currency: "NGN", label: "Physical Verve (NGN)" },
                ].map(opt => (
                  <Button key={opt.label} variant="outline" className="w-full justify-start" onClick={() => createMutation.mutate(opt)} disabled={createMutation.isPending}>
                    <CreditCard className="h-4 w-4 mr-2" />{opt.label}
                  </Button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-4">
          {(cards ?? []).map((card: { id: number; type: string; brand: string; last4: string; expiryMonth: string; expiryYear: string; status: string; cardholderName: string; currency: string; balance?: number }, idx: number) => (
            <div key={card.id} className="space-y-3">
              {/* Card Visual */}
              <div className={`bg-gradient-to-br ${CARD_GRADIENTS[idx % CARD_GRADIENTS.length]} rounded-2xl p-5 text-white relative overflow-hidden`}>
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -translate-y-8 translate-x-8" />
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="text-xs opacity-70 uppercase tracking-wider">{card.type} card</div>
                    <div className="font-bold text-lg capitalize">{card.brand}</div>
                  </div>
                  <div className="flex items-center gap-1 opacity-80"><Wifi className="h-5 w-5" /></div>
                </div>
                <div className="font-mono text-lg tracking-widest mb-4">
                  {showNumbers[card.id] ? `4532 8812 ${card.last4.slice(0,2)}XX ${card.last4}` : `•••• •••• •••• ${card.last4}`}
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs opacity-70">Cardholder</div>
                    <div className="font-semibold text-sm">{card.cardholderName}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs opacity-70">Expires</div>
                    <div className="font-semibold text-sm">{card.expiryMonth}/{card.expiryYear.slice(-2)}</div>
                  </div>
                </div>
              </div>

              {/* Card Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={card.status === "active" ? "bg-emerald-100 text-emerald-700 border-0" : card.status === "frozen" ? "bg-blue-100 text-blue-700 border-0" : "bg-red-100 text-red-700 border-0"}>
                  {card.status}
                </Badge>
                <span className="text-sm text-muted-foreground">{card.currency}</span>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowNumbers(p => ({ ...p, [card.id]: !p[card.id] }))}>
                    {showNumbers[card.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  {card.status === "active" ? (
                    <Button variant="outline" size="sm" onClick={() => freezeMutation.mutate({ id: card.id })} disabled={freezeMutation.isPending}>
                      <Snowflake className="h-4 w-4 mr-1" />Freeze
                    </Button>
                  ) : card.status === "frozen" ? (
                    <Button variant="outline" size="sm" onClick={() => unfreezeMutation.mutate({ id: card.id })} disabled={unfreezeMutation.isPending}>
                      Unfreeze
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600" onClick={() => cancelMutation.mutate({ id: card.id })} disabled={cancelMutation.isPending}>
                    <Ban className="h-4 w-4 mr-1" />Cancel
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── SavingsGoals ─────────────────────────────────────────────────────────────
pages["SavingsGoals"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Target, Plus, PiggyBank, TrendingUp, Calendar } from "lucide-react";

export default function SavingsGoals() {
  const { data: goals, refetch } = trpc.savings.list.useQuery();
  const createMutation = trpc.savings.create.useMutation({ onSuccess: () => { toast.success("Goal created!"); refetch(); setOpen(false); } });
  const topupMutation = trpc.savings.topup.useMutation({ onSuccess: () => { toast.success("Savings added!"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [topupId, setTopupId] = useState<number | null>(null);
  const [topupAmt, setTopupAmt] = useState("");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <PiggyBank className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Savings Goals</h1>
              <p className="text-muted-foreground text-sm">Track and grow your savings</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />New Goal</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div><Label>Goal Name</Label><Input className="mt-1" placeholder="e.g. Emergency Fund" value={name} onChange={e => setName(e.target.value)} /></div>
                <div><Label>Target Amount (NGN)</Label><Input type="number" className="mt-1" placeholder="0.00" value={target} onChange={e => setTarget(e.target.value)} /></div>
                <Button className="w-full" onClick={() => createMutation.mutate({ name, targetAmount: parseFloat(target), currency: "NGN", autoSave: false })} disabled={createMutation.isPending || !name || !target}>
                  {createMutation.isPending ? "Creating…" : "Create Goal"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {(goals ?? []).map((g: { id: number; name: string; targetAmount: number; currentAmount: number; currency: string; status: string; targetDate?: string; autoSave: boolean; autoSaveAmount?: number }) => {
            const pct = Math.min(100, (g.currentAmount / g.targetAmount) * 100);
            return (
              <Card key={g.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                        <Target className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div>
                        <div className="font-semibold">{g.name}</div>
                        {g.targetDate && <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(g.targetDate).toLocaleDateString()}</div>}
                      </div>
                    </div>
                    <Badge className={g.status === "active" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-muted text-muted-foreground border-0"}>{g.status}</Badge>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-semibold">{pct.toFixed(0)}%</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>{g.currency} {g.currentAmount.toLocaleString()}</span>
                      <span>{g.currency} {g.targetAmount.toLocaleString()}</span>
                    </div>
                  </div>
                  {topupId === g.id ? (
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Amount" value={topupAmt} onChange={e => setTopupAmt(e.target.value)} className="flex-1" />
                      <Button size="sm" onClick={() => { topupMutation.mutate({ id: g.id, amount: parseFloat(topupAmt) }); setTopupId(null); setTopupAmt(""); }} disabled={topupMutation.isPending}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTopupId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setTopupId(g.id)}>
                      <TrendingUp className="h-4 w-4 mr-1" />Add Savings
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── FXAlerts ─────────────────────────────────────────────────────────────────
pages["FXAlerts"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Bell, Plus, TrendingUp, TrendingDown, Trash2 } from "lucide-react";

export default function FXAlerts() {
  const { data: alerts, refetch } = trpc.fx.alerts.useQuery();
  const createMutation = trpc.fx.createAlert.useMutation({ onSuccess: () => { toast.success("Alert created!"); refetch(); setOpen(false); } });
  const deleteMutation = trpc.fx.deleteAlert.useMutation({ onSuccess: () => { toast.success("Alert deleted"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [rate, setRate] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Bell className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">FX Rate Alerts</h1>
              <p className="text-muted-foreground text-sm">Get notified when rates hit your target</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />New Alert</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Rate Alert</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>From</Label>
                    <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background" value={from} onChange={e => setFrom(e.target.value)}>
                      {["USD","GBP","EUR","CAD","AUD"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><Label>To</Label>
                    <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background" value={to} onChange={e => setTo(e.target.value)}>
                      {["NGN","KES","GHS","ZAR","UGX"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div><Label>Target Rate</Label><Input type="number" className="mt-1" placeholder="e.g. 1600" value={rate} onChange={e => setRate(e.target.value)} /></div>
                <div>
                  <Label>Alert when rate goes</Label>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => setDirection("above")} className={`flex-1 py-2 rounded-lg border text-sm font-medium ${direction === "above" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-border"}`}>
                      <TrendingUp className="h-4 w-4 inline mr-1" />Above
                    </button>
                    <button onClick={() => setDirection("below")} className={`flex-1 py-2 rounded-lg border text-sm font-medium ${direction === "below" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-border"}`}>
                      <TrendingDown className="h-4 w-4 inline mr-1" />Below
                    </button>
                  </div>
                </div>
                <Button className="w-full" onClick={() => createMutation.mutate({ fromCurrency: from, toCurrency: to, targetRate: parseFloat(rate), direction })} disabled={createMutation.isPending || !rate}>
                  {createMutation.isPending ? "Creating…" : "Create Alert"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-3">
          {(alerts ?? []).map((a: { id: number; fromCurrency: string; toCurrency: string; targetRate: number; direction: string; currentRate: number; status: string; createdAt: string }) => (
            <Card key={a.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${a.direction === "above" ? "bg-emerald-100" : "bg-red-100"}`}>
                  {a.direction === "above" ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
                </div>
                <div className="flex-1">
                  <div className="font-semibold">{a.fromCurrency}/{a.toCurrency}</div>
                  <div className="text-sm text-muted-foreground">
                    Alert when {a.direction} <strong>{a.targetRate.toLocaleString()}</strong> · Current: {a.currentRate.toLocaleString()}
                  </div>
                </div>
                <Badge className={a.status === "active" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-muted text-muted-foreground border-0"}>{a.status}</Badge>
                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => deleteMutation.mutate({ id: a.id })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
          {(alerts ?? []).length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No alerts yet. Create your first FX rate alert.</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── BatchPayments ─────────────────────────────────────────────────────────────
pages["BatchPayments"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, Plus, Upload, CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  processing: <Clock className="h-4 w-4 text-blue-600" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
};

export default function BatchPayments() {
  const { data: batches, refetch } = trpc.batch.list.useQuery();
  const createMutation = trpc.batch.create.useMutation({ onSuccess: () => { toast.success("Batch created!"); refetch(); } });
  const [batchName, setBatchName] = useState("");
  const [recipients, setRecipients] = useState([{ recipient: "", amount: "", currency: "NGN" }]);

  const addRecipient = () => setRecipients(r => [...r, { recipient: "", amount: "", currency: "NGN" }]);
  const updateRecipient = (i: number, field: string, value: string) =>
    setRecipients(r => r.map((rec, idx) => idx === i ? { ...rec, [field]: value } : rec));

  const handleCreate = () => {
    createMutation.mutate({
      name: batchName,
      payments: recipients.filter(r => r.recipient && r.amount).map(r => ({ recipient: r.recipient, amount: parseFloat(r.amount), currency: r.currency })),
    });
    setBatchName("");
    setRecipients([{ recipient: "", amount: "", currency: "NGN" }]);
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Users className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Batch Payments</h1>
            <p className="text-muted-foreground text-sm">Send to multiple recipients at once</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Create New Batch */}
          <Card>
            <CardHeader><CardTitle className="text-base">New Batch</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Batch name (e.g. March Payroll)" value={batchName} onChange={e => setBatchName(e.target.value)} />
              <div className="space-y-2">
                {recipients.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <Input placeholder="Account / Name" value={r.recipient} onChange={e => updateRecipient(i, "recipient", e.target.value)} className="flex-1" />
                    <Input type="number" placeholder="Amount" value={r.amount} onChange={e => updateRecipient(i, "amount", e.target.value)} className="w-24" />
                    <select className="border rounded-md px-2 text-sm bg-background" value={r.currency} onChange={e => updateRecipient(i, "currency", e.target.value)}>
                      {["NGN","USD","GBP","KES"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addRecipient}><Plus className="h-4 w-4 mr-1" />Add Row</Button>
                <Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-1" />Import CSV</Button>
              </div>
              <Button className="w-full" onClick={handleCreate} disabled={createMutation.isPending || !batchName}>
                {createMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</> : "Create Batch"}
              </Button>
            </CardContent>
          </Card>

          {/* Batch History */}
          <Card>
            <CardHeader><CardTitle className="text-base">Batch History</CardTitle></CardHeader>
            <CardContent className="p-0">
              {(batches ?? []).map((b: { id: number; name: string; totalAmount: number; currency: string; recipientCount: number; status: string; createdAt: string }) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40">
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                    {STATUS_ICONS[b.status] ?? <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{b.name}</div>
                    <div className="text-xs text-muted-foreground">{b.recipientCount} recipients · {new Date(b.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{b.currency} {b.totalAmount.toLocaleString()}</div>
                    <Badge className={b.status === "completed" ? "bg-emerald-100 text-emerald-700 border-0" : b.status === "processing" ? "bg-blue-100 text-blue-700 border-0" : "bg-red-100 text-red-700 border-0"} variant="outline">{b.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── TransferTracking ─────────────────────────────────────────────────────────────
pages["TransferTracking"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, CheckCircle2, Clock, AlertCircle, Package } from "lucide-react";

export default function TransferTracking() {
  const [ref, setRef] = useState("RF20240316001");
  const [query, setQuery] = useState("RF20240316001");
  const { data, isLoading } = trpc.tracking.track.useQuery({ reference: query });

  const STEP_ICONS = [Package, Clock, CheckCircle2, MapPin, CheckCircle2];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Track Transfer</h1>
            <p className="text-muted-foreground text-sm">Real-time transfer status tracking</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2">
              <Input placeholder="Enter transfer reference (e.g. RF20240316001)" value={ref} onChange={e => setRef(e.target.value)} className="flex-1" />
              <Button onClick={() => setQuery(ref)} disabled={isLoading}><Search className="h-4 w-4 mr-1" />Track</Button>
            </div>
          </CardContent>
        </Card>

        {data && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Reference</div>
                    <div className="font-mono font-bold text-lg">{data.reference}</div>
                  </div>
                  <Badge className={data.status === "completed" ? "bg-emerald-100 text-emerald-700 border-0" : data.status === "processing" ? "bg-blue-100 text-blue-700 border-0" : "bg-yellow-100 text-yellow-700 border-0"}>
                    {data.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Amount</span><div className="font-semibold">{data.fromCurrency} {data.amount?.toLocaleString()}</div></div>
                  <div><span className="text-muted-foreground">Recipient gets</span><div className="font-semibold text-emerald-600">{data.toCurrency} {data.convertedAmount?.toLocaleString()}</div></div>
                  <div><span className="text-muted-foreground">Recipient</span><div className="font-semibold">{data.recipient}</div></div>
                  <div><span className="text-muted-foreground">ETA</span><div className="font-semibold">{data.estimatedArrival}</div></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Transfer Timeline</CardTitle></CardHeader>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {(data.timeline ?? []).map((step: { step: string; status: string; timestamp: string; description: string }, i: number) => {
                    const Icon = STEP_ICONS[i] ?? CheckCircle2;
                    return (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step.status === "completed" ? "bg-emerald-100" : step.status === "active" ? "bg-blue-100" : "bg-muted"}`}>
                            <Icon className={`h-4 w-4 ${step.status === "completed" ? "text-emerald-600" : step.status === "active" ? "text-blue-600" : "text-muted-foreground"}`} />
                          </div>
                          {i < (data.timeline?.length ?? 0) - 1 && <div className="w-0.5 h-6 bg-border mt-1" />}
                        </div>
                        <div className="pb-4">
                          <div className={`font-medium text-sm ${step.status === "pending" ? "text-muted-foreground" : ""}`}>{step.step}</div>
                          <div className="text-xs text-muted-foreground">{step.description}</div>
                          {step.timestamp && <div className="text-xs text-muted-foreground mt-0.5">{new Date(step.timestamp).toLocaleString()}</div>}
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

# ─── KYC ─────────────────────────────────────────────────────────────────
pages["KYC"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ShieldCheck, Upload, CheckCircle2, Lock, AlertCircle, FileText, Camera } from "lucide-react";

export default function KYC() {
  const { data } = trpc.kyc.status.useQuery();
  const submitMutation = trpc.kyc.submit.useMutation({ onSuccess: () => toast.success("Document submitted for review!") });
  const [uploading, setUploading] = useState<string | null>(null);

  const handleUpload = async (docType: string) => {
    setUploading(docType);
    await new Promise(r => setTimeout(r, 1200));
    submitMutation.mutate({ docType, fileUrl: `https://storage.example.com/${docType}-${Date.now()}.jpg` });
    setUploading(null);
  };

  const TIER_COLORS: Record<string, string> = { approved: "bg-emerald-100 text-emerald-700", pending: "bg-yellow-100 text-yellow-700", locked: "bg-muted text-muted-foreground", rejected: "bg-red-100 text-red-700" };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">KYC Verification</h1>
            <p className="text-muted-foreground text-sm">Verify your identity to unlock higher limits</p>
          </div>
        </div>

        {/* Current Level */}
        <Card className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white border-0">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm opacity-80">Current Level</div>
                <div className="text-2xl font-bold capitalize">{data?.level} KYC</div>
              </div>
              <ShieldCheck className="h-10 w-10 opacity-60" />
            </div>
            <div className="text-sm opacity-80">Complete higher tiers to unlock unlimited transfers</div>
          </CardContent>
        </Card>

        {/* Tiers */}
        <div className="space-y-4">
          {(data?.tiers ?? []).map((tier: { tier: string; label: string; status: string; requirements: string[]; limit: string }) => (
            <Card key={tier.tier} className={`${tier.status === "approved" ? "border-emerald-200" : tier.status === "pending" ? "border-yellow-200" : ""}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {tier.status === "approved" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : tier.status === "locked" ? <Lock className="h-5 w-5 text-muted-foreground" /> : <AlertCircle className="h-5 w-5 text-yellow-600" />}
                    <div>
                      <div className="font-semibold">{tier.label}</div>
                      <div className="text-xs text-muted-foreground">Limit: {tier.limit}</div>
                    </div>
                  </div>
                  <Badge className={`${TIER_COLORS[tier.status] ?? "bg-muted"} border-0`}>{tier.status}</Badge>
                </div>
                <div className="space-y-2">
                  {tier.requirements.map((req: string) => (
                    <div key={req} className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{req}</span>
                      {tier.status !== "approved" && tier.status !== "locked" && (
                        <Button size="sm" variant="outline" onClick={() => handleUpload(req.toLowerCase().replace(/\s+/g, "_"))} disabled={uploading === req.toLowerCase().replace(/\s+/g, "_")}>
                          {uploading === req.toLowerCase().replace(/\s+/g, "_") ? "Uploading…" : <><Upload className="h-3 w-3 mr-1" />Upload</>}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── Mojaloop ─────────────────────────────────────────────────────────────────
pages["Mojaloop"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Network, ArrowRightLeft, Users, DollarSign, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function Mojaloop() {
  const { data: transfers, isLoading: tLoading } = trpc.mojaloop.transfers.useQuery();
  const { data: participants } = trpc.mojaloop.participants.useQuery();
  const { data: windows } = trpc.mojaloop.settlementWindows.useQuery();
  const initMutation = trpc.mojaloop.initiateTransfer.useMutation({ onSuccess: (d) => toast.success(`Transfer ${d.transferId} initiated!`) });
  const [tab, setTab] = useState<"transfers" | "participants" | "settlement">("transfers");
  const [payerFsp, setPayerFsp] = useState("FSP_NIGERIA");
  const [payeeFsp, setPayeeFsp] = useState("FSP_KENYA");
  const [amount, setAmount] = useState("1000");

  const STATUS_COLORS: Record<string, string> = { COMMITTED: "bg-emerald-100 text-emerald-700", RESERVED: "bg-blue-100 text-blue-700", ABORTED: "bg-red-100 text-red-700", PENDING: "bg-yellow-100 text-yellow-700" };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <Network className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Mojaloop Hub</h1>
            <p className="text-muted-foreground text-sm">ISO 20022 · ILP · FSPIOP v1.1</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Transfers", value: transfers?.length ?? 0, icon: <ArrowRightLeft className="h-4 w-4" />, color: "text-violet-600 bg-violet-100" },
            { label: "Participants", value: participants?.length ?? 0, icon: <Users className="h-4 w-4" />, color: "text-blue-600 bg-blue-100" },
            { label: "Settlement Windows", value: windows?.length ?? 0, icon: <DollarSign className="h-4 w-4" />, color: "text-emerald-600 bg-emerald-100" },
            { label: "Committed", value: (transfers ?? []).filter((t: { status: string }) => t.status === "COMMITTED").length, icon: <CheckCircle2 className="h-4 w-4" />, color: "text-teal-600 bg-teal-100" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${s.color}`}>{s.icon}</div>
                <div>
                  <div className="text-xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {(["transfers","participants","settlement"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${tab === t ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>

        {tab === "transfers" && (
          <div className="space-y-4">
            {/* Initiate Transfer */}
            <Card className="border-violet-200 bg-violet-50/50">
              <CardHeader><CardTitle className="text-base">Initiate FSPIOP Transfer</CardTitle></CardHeader>
              <CardContent className="grid sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Payer FSP</label>
                  <Input value={payerFsp} onChange={e => setPayerFsp(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Payee FSP</label>
                  <Input value={payeeFsp} onChange={e => setPayeeFsp(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Amount (NGN)</label>
                  <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button className="w-full" onClick={() => initMutation.mutate({ payerFsp, payeeFsp, amount: parseFloat(amount), currency: "NGN" })} disabled={initMutation.isPending}>
                    {initMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Initiate"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Transfer Log</CardTitle></CardHeader>
              <CardContent className="p-0">
                {tLoading ? <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded" />)}</div> :
                  (transfers ?? []).map((t: { transferId: string; payerFsp: string; payeeFsp: string; amount: number; currency: string; status: string; ilpCondition: string; createdAt: string }) => (
                    <div key={t.transferId} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40">
                      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                        <ArrowRightLeft className="h-4 w-4 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">{t.transferId}</div>
                        <div className="text-xs text-muted-foreground">{t.payerFsp} → {t.payeeFsp}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{t.currency} {t.amount.toLocaleString()}</div>
                        <Badge className={`${STATUS_COLORS[t.status] ?? "bg-muted text-muted-foreground"} border-0 text-xs`}>{t.status}</Badge>
                      </div>
                    </div>
                  ))
                }
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "participants" && (
          <div className="grid sm:grid-cols-2 gap-4">
            {(participants ?? []).map((p: { fspId: string; name: string; currency: string; status: string; balance: number; country: string }) => (
              <Card key={p.fspId}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.fspId}</div>
                    </div>
                    <Badge className={p.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-muted text-muted-foreground border-0"}>{p.status}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Currency</span><div className="font-medium">{p.currency}</div></div>
                    <div><span className="text-muted-foreground">Country</span><div className="font-medium">{p.country}</div></div>
                    <div><span className="text-muted-foreground">Balance</span><div className="font-medium">{p.balance.toLocaleString()}</div></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "settlement" && (
          <div className="space-y-3">
            {(windows ?? []).map((w: { id: number; status: string; openedAt: string; closedAt?: string; totalAmount: number; currency: string; participantCount: number }) => (
              <Card key={w.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ${w.status === "OPEN" ? "bg-emerald-100" : "bg-muted"}`}>
                    {w.status === "OPEN" ? <Clock className="h-4 w-4 text-emerald-600" /> : <CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Window #{w.id}</div>
                    <div className="text-xs text-muted-foreground">Opened: {new Date(w.openedAt).toLocaleString()} · {w.participantCount} participants</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{w.currency} {w.totalAmount.toLocaleString()}</div>
                    <Badge className={w.status === "OPEN" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-muted text-muted-foreground border-0"}>{w.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
'''

# ─── CBDC ─────────────────────────────────────────────────────────────────
pages["CBDC"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Landmark, ArrowRightLeft, Shield, Zap, Loader2 } from "lucide-react";

export default function CBDC() {
  const { data: balances } = trpc.cbdc.balances.useQuery();
  const { data: txns } = trpc.cbdc.transactions.useQuery();
  const transferMutation = trpc.cbdc.transfer.useMutation({ onSuccess: (d) => toast.success(`CBDC transfer ${d.txId} sent!`) });
  const [currency, setCurrency] = useState("eNaira");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Landmark className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">CBDC Wallet</h1>
            <p className="text-muted-foreground text-sm">Central Bank Digital Currencies</p>
          </div>
        </div>

        {/* CBDC Balances */}
        <div className="grid sm:grid-cols-3 gap-3">
          {(balances ?? []).map((b: { id: number; currency: string; balance: number; symbol: string; issuer: string; status: string }) => (
            <Card key={b.id} className={`cursor-pointer border-2 transition-all ${currency === b.currency ? "border-emerald-500 bg-emerald-50" : "border-border hover:border-emerald-300"}`} onClick={() => setCurrency(b.currency)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xl font-bold">{b.symbol}</div>
                  <Badge className={b.status === "active" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-yellow-100 text-yellow-700 border-0"}>{b.status}</Badge>
                </div>
                <div className="font-bold text-lg">{b.balance.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">{b.currency}</div>
                <div className="text-xs text-muted-foreground">{b.issuer}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Features */}
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { icon: <Shield className="h-5 w-5 text-blue-600" />, title: "Offline Capable", desc: "Works without internet via NFC", color: "bg-blue-100" },
            { icon: <Zap className="h-5 w-5 text-yellow-600" />, title: "Instant Settlement", desc: "Atomic, final settlement", color: "bg-yellow-100" },
            { icon: <ArrowRightLeft className="h-5 w-5 text-purple-600" />, title: "Cross-border", desc: "mBridge compatible", color: "bg-purple-100" },
          ].map(f => (
            <Card key={f.title}>
              <CardContent className="p-4 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full ${f.color} flex items-center justify-center shrink-0`}>{f.icon}</div>
                <div>
                  <div className="font-semibold text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.desc}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Transfer */}
        <Card>
          <CardHeader><CardTitle className="text-base">CBDC Transfer</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1">Currency</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background" value={currency} onChange={e => setCurrency(e.target.value)}>
                  {(balances ?? []).map((b: { currency: string }) => <option key={b.currency}>{b.currency}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Amount</label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Recipient</label>
                <Input placeholder="Wallet address or phone" value={recipient} onChange={e => setRecipient(e.target.value)} />
              </div>
            </div>
            <Button className="w-full" onClick={() => transferMutation.mutate({ currency, amount: parseFloat(amount), recipient })} disabled={transferMutation.isPending || !amount || !recipient}>
              {transferMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : "Send CBDC"}
            </Button>
          </CardContent>
        </Card>

        {/* Transactions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent CBDC Transactions</CardTitle></CardHeader>
          <CardContent className="p-0">
            {(txns ?? []).map((t: { id: number; type: string; amount: number; currency: string; counterparty: string; status: string; timestamp: string }) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${t.type === "receive" ? "bg-emerald-100" : "bg-slate-100"}`}>
                  <ArrowRightLeft className={`h-4 w-4 ${t.type === "receive" ? "text-emerald-600" : "text-slate-600"}`} />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">{t.type === "receive" ? "Received from" : "Sent to"} {t.counterparty}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.timestamp).toLocaleString()}</div>
                </div>
                <div className={`font-semibold text-sm ${t.type === "receive" ? "text-emerald-600" : ""}`}>
                  {t.type === "receive" ? "+" : "-"}{t.currency} {t.amount.toLocaleString()}
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

# ─── BNPL ─────────────────────────────────────────────────────────────────
pages["BNPL"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ShoppingCart, CreditCard, CheckCircle2, Clock, Loader2 } from "lucide-react";

export default function BNPL() {
  const { data: plans } = trpc.bnpl.plans.useQuery();
  const { data: eligibility } = trpc.bnpl.eligibility.useQuery();
  const applyMutation = trpc.bnpl.applyPlan.useMutation({ onSuccess: (d) => toast.success(d.approved ? `Plan approved! Pay ${d.installmentAmount?.toFixed(2)} per installment` : "Application under review") });
  const [merchant, setMerchant] = useState("Amazon");
  const [item, setItem] = useState("MacBook Pro");
  const [amount, setAmount] = useState("500000");
  const [installments, setInstallments] = useState(6);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Buy Now, Pay Later</h1>
            <p className="text-muted-foreground text-sm">Flexible installment payments</p>
          </div>
        </div>

        {/* Eligibility */}
        {eligibility && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="p-4 flex items-center gap-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">You are eligible for BNPL</div>
                <div className="text-sm text-muted-foreground">Credit limit: NGN {eligibility.limit?.toLocaleString()} · Score: {eligibility.score} ({eligibility.tier})</div>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 border-0">Active</Badge>
            </CardContent>
          </Card>
        )}

        {/* Apply */}
        <Card>
          <CardHeader><CardTitle className="text-base">New BNPL Purchase</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="text-sm font-medium block mb-1">Merchant</label><Input value={merchant} onChange={e => setMerchant(e.target.value)} /></div>
              <div><label className="text-sm font-medium block mb-1">Item</label><Input value={item} onChange={e => setItem(e.target.value)} /></div>
              <div><label className="text-sm font-medium block mb-1">Amount (NGN)</label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
              <div>
                <label className="text-sm font-medium block mb-1">Installments</label>
                <div className="flex gap-2">
                  {(eligibility?.availableInstallments ?? [3,6,9,12]).map((n: number) => (
                    <button key={n} onClick={() => setInstallments(n)} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${installments === n ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-border"}`}>{n}x</button>
                  ))}
                </div>
              </div>
            </div>
            {amount && (
              <div className="bg-muted rounded-lg p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Per installment</span><span className="font-bold">NGN {(parseFloat(amount) / installments).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">Total ({installments} payments)</span><span>NGN {parseFloat(amount).toLocaleString()}</span></div>
              </div>
            )}
            <Button className="w-full" onClick={() => applyMutation.mutate({ merchant, item, amount: parseFloat(amount), currency: "NGN", installments })} disabled={applyMutation.isPending || !merchant || !item || !amount}>
              {applyMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing…</> : "Apply for BNPL"}
            </Button>
          </CardContent>
        </Card>

        {/* Active Plans */}
        <Card>
          <CardHeader><CardTitle className="text-base">Active Plans</CardTitle></CardHeader>
          <CardContent className="p-0">
            {(plans ?? []).map((p: { id: number; merchant: string; item: string; totalAmount: number; currency: string; paidInstallments: number; totalInstallments: number; nextPayment: string; nextAmount: number; status: string }) => {
              const pct = (p.paidInstallments / p.totalInstallments) * 100;
              return (
                <div key={p.id} className="p-4 border-b last:border-0">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold text-sm">{p.item}</div>
                      <div className="text-xs text-muted-foreground">{p.merchant}</div>
                    </div>
                    <Badge className={p.status === "active" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-muted text-muted-foreground border-0"}>{p.status}</Badge>
                  </div>
                  <Progress value={pct} className="h-1.5 mb-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{p.paidInstallments}/{p.totalInstallments} paid</span>
                    <span>Next: {p.currency} {p.nextAmount?.toLocaleString()} on {new Date(p.nextPayment).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ─── FCACompliance ─────────────────────────────────────────────────────────────
pages["FCACompliance"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, AlertTriangle, CheckCircle2, Clock, FileText, TrendingUp } from "lucide-react";

export default function FCACompliance() {
  const { data } = trpc.compliance.fcaDashboard.useQuery();

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">FCA Compliance</h1>
            <p className="text-muted-foreground text-sm">Financial Conduct Authority regulatory dashboard</p>
          </div>
        </div>

        {/* Overall Score */}
        {data && (
          <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-0">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm opacity-80">Compliance Score</div>
                  <div className="text-4xl font-bold">{data.overallScore}/100</div>
                </div>
                <div className="text-right">
                  <Badge className="bg-white/20 text-white border-0 text-sm">{data.status}</Badge>
                  <div className="text-sm opacity-70 mt-1">Last reviewed: {data.lastReview}</div>
                </div>
              </div>
              <Progress value={data.overallScore} className="h-2 bg-white/20" />
            </CardContent>
          </Card>
        )}

        {/* Metrics Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(data?.metrics ?? []).map((m: { label: string; value: string | number; status: string; trend: string }) => (
            <Card key={m.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
                <div className="text-xl font-bold">{m.value}</div>
                <div className="flex items-center gap-1 mt-1">
                  <Badge className={m.status === "good" ? "bg-emerald-100 text-emerald-700 border-0 text-xs" : m.status === "warning" ? "bg-yellow-100 text-yellow-700 border-0 text-xs" : "bg-red-100 text-red-700 border-0 text-xs"}>{m.status}</Badge>
                  <span className="text-xs text-muted-foreground">{m.trend}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Requirements */}
        <Card>
          <CardHeader><CardTitle className="text-base">Regulatory Requirements</CardTitle></CardHeader>
          <CardContent className="p-0">
            {(data?.requirements ?? []).map((r: { id: string; name: string; status: string; dueDate: string; priority: string; description: string }) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3 border-b last:border-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${r.status === "compliant" ? "bg-emerald-100" : r.status === "in_progress" ? "bg-blue-100" : "bg-red-100"}`}>
                  {r.status === "compliant" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : r.status === "in_progress" ? <Clock className="h-4 w-4 text-blue-600" /> : <AlertTriangle className="h-4 w-4 text-red-500" />}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Due: {r.dueDate}</div>
                </div>
                <Badge className={r.priority === "high" ? "bg-red-100 text-red-700 border-0" : r.priority === "medium" ? "bg-yellow-100 text-yellow-700 border-0" : "bg-muted text-muted-foreground border-0"}>{r.priority}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Reports */}
        <Card>
          <CardHeader><CardTitle className="text-base">Regulatory Reports</CardTitle></CardHeader>
          <CardContent className="p-0">
            {(data?.reports ?? []).map((r: { name: string; period: string; status: string; dueDate: string }) => (
              <div key={r.name} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.period} · Due: {r.dueDate}</div>
                </div>
                <Badge className={r.status === "submitted" ? "bg-emerald-100 text-emerald-700 border-0" : r.status === "draft" ? "bg-blue-100 text-blue-700 border-0" : "bg-yellow-100 text-yellow-700 border-0"}>{r.status}</Badge>
                <Button variant="outline" size="sm">View</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ─── TravelRule ─────────────────────────────────────────────────────────────────
pages["TravelRule"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, CheckCircle2, XCircle, Clock, Globe, ArrowRightLeft } from "lucide-react";

export default function TravelRule() {
  const { data } = trpc.compliance.travelRule.useQuery();

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Travel Rule</h1>
            <p className="text-muted-foreground text-sm">FATF Travel Rule compliance for cross-border transfers</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Transfers", value: data?.totalTransfers ?? 0, color: "bg-blue-100 text-blue-700" },
            { label: "Compliant", value: data?.compliantTransfers ?? 0, color: "bg-emerald-100 text-emerald-700" },
            { label: "Pending Review", value: data?.pendingReview ?? 0, color: "bg-yellow-100 text-yellow-700" },
            { label: "Rejected", value: data?.rejectedTransfers ?? 0, color: "bg-red-100 text-red-700" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{s.value}</div>
                <Badge className={`${s.color} border-0 mt-1`}>{s.label}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Transfer Records */}
        <Card>
          <CardHeader><CardTitle className="text-base">Travel Rule Records</CardTitle></CardHeader>
          <CardContent className="p-0">
            {(data?.transfers ?? []).map((t: { id: string; originatorName: string; originatorVasp: string; beneficiaryName: string; beneficiaryVasp: string; amount: number; currency: string; status: string; createdAt: string }) => (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${t.status === "compliant" ? "bg-emerald-100" : t.status === "pending" ? "bg-yellow-100" : "bg-red-100"}`}>
                  {t.status === "compliant" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : t.status === "pending" ? <Clock className="h-4 w-4 text-yellow-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium truncate">{t.originatorName}</span>
                    <ArrowRightLeft className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{t.beneficiaryName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{t.originatorVasp} → {t.beneficiaryVasp}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-sm">{t.currency} {t.amount.toLocaleString()}</div>
                  <Badge className={t.status === "compliant" ? "bg-emerald-100 text-emerald-700 border-0 text-xs" : t.status === "pending" ? "bg-yellow-100 text-yellow-700 border-0 text-xs" : "bg-red-100 text-red-700 border-0 text-xs"}>{t.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* VASP Directory */}
        <Card>
          <CardHeader><CardTitle className="text-base">VASP Directory</CardTitle></CardHeader>
          <CardContent className="p-0">
            {(data?.vaspDirectory ?? []).map((v: { name: string; country: string; status: string; lei: string }) => (
              <div key={v.name} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{v.country} · LEI: {v.lei}</div>
                </div>
                <Badge className={v.status === "verified" ? "bg-emerald-100 text-emerald-700 border-0" : "bg-yellow-100 text-yellow-700 border-0"}>{v.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ─── AuditLogs ─────────────────────────────────────────────────────────────────
pages["AuditLogs"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Search, Download, AlertCircle, Info, AlertTriangle } from "lucide-react";

const SEVERITY_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  info: { color: "bg-blue-100 text-blue-700", icon: <Info className="h-3 w-3" /> },
  warning: { color: "bg-yellow-100 text-yellow-700", icon: <AlertTriangle className="h-3 w-3" /> },
  error: { color: "bg-red-100 text-red-700", icon: <AlertCircle className="h-3 w-3" /> },
};

export default function AuditLogs() {
  const { data, isLoading } = trpc.audit.logs.useQuery({ page: 1, limit: 20 });
  const [search, setSearch] = useState("");

  const logs = data?.logs ?? [];
  const filtered = logs.filter((l: { action: string; description: string }) =>
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    l.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              <FileText className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Audit Logs</h1>
              <p className="text-muted-foreground text-sm">Complete activity trail for your account</p>
            </div>
          </div>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search actions or descriptions…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded" />)}</div>
            ) : filtered.map((log: { id: number; action: string; description: string; ipAddress: string; userAgent: string; severity: string; createdAt: string }) => {
              const cfg = SEVERITY_CONFIG[log.severity] ?? SEVERITY_CONFIG.info;
              return (
                <div key={log.id} className="flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40">
                  <Badge className={`${cfg.color} border-0 flex items-center gap-1 mt-0.5 shrink-0`}>
                    {cfg.icon}{log.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{log.action}</div>
                    <div className="text-xs text-muted-foreground truncate">{log.description}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">IP: {log.ipAddress} · {log.userAgent}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">{new Date(log.createdAt).toLocaleString()}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ─── Profile ─────────────────────────────────────────────────────────────────
pages["Profile"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { User, Mail, Phone, MapPin, Camera, Edit2, Save } from "lucide-react";

export default function Profile() {
  const { user } = useAuth();
  const { data: profile } = trpc.profile.get.useQuery();
  const updateMutation = trpc.profile.update.useMutation({ onSuccess: () => toast.success("Profile updated!") });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");

  const handleSave = () => {
    updateMutation.mutate({ name: name || undefined, phone: phone || undefined, country: country || undefined });
    setEditing(false);
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <User className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">My Profile</h1>
            <p className="text-muted-foreground text-sm">Manage your personal information</p>
          </div>
        </div>

        {/* Avatar */}
        <Card>
          <CardContent className="p-6 flex items-center gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold">
                {(user?.name ?? profile?.name ?? "U")[0].toUpperCase()}
              </div>
              <button className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-white border-2 border-border flex items-center justify-center hover:bg-muted">
                <Camera className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <div>
              <div className="text-xl font-bold">{user?.name ?? profile?.name}</div>
              <div className="text-sm text-muted-foreground">{user?.email ?? profile?.email}</div>
              <div className="flex gap-2 mt-2">
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Verified</Badge>
                <Badge className="bg-indigo-100 text-indigo-700 border-0 capitalize">{profile?.kycLevel ?? "Basic"} KYC</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Personal Information</CardTitle>
            <Button variant="outline" size="sm" onClick={() => { setEditing(!editing); setName(profile?.name ?? ""); setPhone(profile?.phone ?? ""); setCountry(profile?.country ?? ""); }}>
              {editing ? <><Save className="h-4 w-4 mr-1" />Cancel</> : <><Edit2 className="h-4 w-4 mr-1" />Edit</>}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Full Name", value: profile?.name ?? user?.name ?? "", icon: <User className="h-4 w-4" />, field: "name", setter: setName, state: name },
              { label: "Email", value: profile?.email ?? user?.email ?? "", icon: <Mail className="h-4 w-4" />, field: "email", setter: null, state: "" },
              { label: "Phone", value: profile?.phone ?? "", icon: <Phone className="h-4 w-4" />, field: "phone", setter: setPhone, state: phone },
              { label: "Country", value: profile?.country ?? "", icon: <MapPin className="h-4 w-4" />, field: "country", setter: setCountry, state: country },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">{f.icon}</div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">{f.label}</Label>
                  {editing && f.setter ? (
                    <Input value={f.state} onChange={e => f.setter!(e.target.value)} className="mt-0.5 h-8" />
                  ) : (
                    <div className="font-medium text-sm">{f.value || <span className="text-muted-foreground italic">Not set</span>}</div>
                  )}
                </div>
              </div>
            ))}
            {editing && (
              <Button className="w-full" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Member since", value: profile?.memberSince ?? "2024" },
            { label: "Total transfers", value: profile?.totalTransfers ?? "0" },
            { label: "Countries sent", value: profile?.countriesSent ?? "0" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <div className="text-xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ─── Security ─────────────────────────────────────────────────────────────────
pages["Security"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Shield, Smartphone, Key, Monitor, AlertTriangle, CheckCircle2, LogOut } from "lucide-react";

export default function Security() {
  const { data } = trpc.security.settings.useQuery();
  const revokeMutation = trpc.security.revokeSession.useMutation({ onSuccess: () => toast.success("Session revoked") });
  const changePwMutation = trpc.security.changePassword.useMutation({ onSuccess: () => toast.success("Password changed!") });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Shield className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Security</h1>
            <p className="text-muted-foreground text-sm">Manage your account security settings</p>
          </div>
        </div>

        {/* Security Score */}
        <Card className={`border-l-4 ${(data?.securityScore ?? 0) >= 80 ? "border-l-emerald-500" : (data?.securityScore ?? 0) >= 50 ? "border-l-yellow-500" : "border-l-red-500"}`}>
          <CardContent className="p-4 flex items-center gap-3">
            {(data?.securityScore ?? 0) >= 80 ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> : <AlertTriangle className="h-8 w-8 text-yellow-600" />}
            <div>
              <div className="font-bold text-lg">Security Score: {data?.securityScore ?? 0}/100
