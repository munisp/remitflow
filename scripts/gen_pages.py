#!/usr/bin/env python3
"""Generate all remaining page files for RemitFlow fintech platform."""
import os

PAGES_DIR = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(PAGES_DIR, exist_ok=True)

# Template helper
def page(name, title, content):
    path = os.path.join(PAGES_DIR, f"{name}.tsx")
    if os.path.exists(path):
        print(f"  SKIP (exists): {name}.tsx")
        return
    with open(path, "w") as f:
        f.write(content)
    print(f"  CREATED: {name}.tsx")

# ─── Wallet ───────────────────────────────────────────────────────────────────
page("Wallet", "My Wallet", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { Send, Download, Plus, ArrowUpRight, Wallet as WalletIcon, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const FLAG: Record<string,string> = { NGN:"🇳🇬", USD:"🇺🇸", GBP:"🇬🇧", EUR:"🇪🇺", KES:"🇰🇪", GHS:"🇬🇭", ZAR:"🇿🇦", CAD:"🇨🇦", AUD:"🇦🇺" };
const SYMBOL: Record<string,string> = { NGN:"₦", USD:"$", GBP:"£", EUR:"€", KES:"KSh", GHS:"₵", ZAR:"R", CAD:"C$", AUD:"A$" };

export default function Wallet() {
  const { data, isLoading } = trpc.wallet.balances.useQuery();
  const { data: hist } = trpc.transactions.list.useQuery({ limit: 8 });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Wallet</h1>
            <p className="text-muted-foreground text-sm">Manage your multi-currency balances</p>
          </div>
          <div className="flex gap-2">
            <Link href="/send"><Button variant="outline" size="sm" className="gap-1"><Send className="h-4 w-4"/>Send</Button></Link>
            <Link href="/receive"><Button size="sm" className="gap-1"><Download className="h-4 w-4"/>Receive</Button></Link>
          </div>
        </div>

        {/* Balances Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? [...Array(6)].map((_,i) => <Skeleton key={i} className="h-32"/>)
          : data?.map((bal: any) => (
            <Card key={bal.currency} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{FLAG[bal.currency] ?? "💱"}</span>
                    <div>
                      <p className="font-semibold text-sm">{bal.currency}</p>
                      <p className="text-xs text-muted-foreground">{bal.name}</p>
                    </div>
                  </div>
                  <Badge variant={bal.change >= 0 ? "secondary" : "destructive"} className="text-xs">
                    {bal.change >= 0 ? "+" : ""}{bal.change}%
                  </Badge>
                </div>
                <p className="text-2xl font-bold">{SYMBOL[bal.currency] ?? ""}{Number(bal.balance).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">≈ ${Number(bal.balanceUSD).toLocaleString()} USD</p>
                <Progress value={bal.utilization ?? 60} className="mt-3 h-1.5" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <Link href="/transactions"><Button variant="ghost" size="sm" className="gap-1 text-primary">All <ArrowUpRight className="h-3 w-3"/></Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {hist?.transactions?.slice(0,8).map((t:any) => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{t.description ?? t.type}</p>
                    <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={cn("text-sm font-semibold", t.type==="receive"||t.type==="topup" ? "text-emerald-600" : "text-foreground")}>
                    {t.type==="receive"||t.type==="topup" ? "+" : "-"}{t.currency==="NGN"?"₦":t.currency+" "}{Number(t.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── SendMoney ────────────────────────────────────────────────────────────────
page("SendMoney", "Send Money", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { toast } from "sonner";
import { Send, ArrowRight, RefreshCw, User, AlertCircle } from "lucide-react";

const CURRENCIES = ["NGN","USD","GBP","EUR","KES","GHS","ZAR","CAD","AUD"];

export default function SendMoney() {
  const [amount, setAmount] = useState("");
  const [fromCurrency, setFromCurrency] = useState("NGN");
  const [toCurrency, setToCurrency] = useState("USD");
  const [recipient, setRecipient] = useState("");
  const [step, setStep] = useState<"form"|"confirm"|"done">("form");

  const ratesQuery = trpc.fx.rates.useQuery();
  const sendMutation = trpc.transfer.send.useMutation({
    onSuccess: () => { setStep("done"); toast.success("Transfer initiated successfully!"); },
    onError: (e) => toast.error(e.message),
  });

  const rate = ratesQuery.data?.[fromCurrency]?.[toCurrency] ?? 1;
  const numAmount = parseFloat(amount) || 0;
  const converted = numAmount * rate;
  const fee = numAmount * 0.015;
  const total = numAmount + fee;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Send Money</h1>
          <p className="text-muted-foreground text-sm">Fast, secure international transfers</p>
        </div>

        {step === "done" ? (
          <Card className="text-center p-8">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <Send className="h-8 w-8 text-emerald-600"/>
            </div>
            <h2 className="text-xl font-bold mb-2">Transfer Initiated!</h2>
            <p className="text-muted-foreground mb-4">Your transfer of {fromCurrency === "NGN" ? "₦" : fromCurrency + " "}{numAmount.toLocaleString()} to {recipient} is being processed.</p>
            <Button onClick={() => { setStep("form"); setAmount(""); setRecipient(""); }}>Send Another</Button>
          </Card>
        ) : step === "confirm" ? (
          <Card>
            <CardHeader><CardTitle>Confirm Transfer</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                {[
                  ["You send", `${fromCurrency === "NGN" ? "₦" : fromCurrency + " "}${numAmount.toLocaleString()}`],
                  ["Recipient gets", `${toCurrency === "NGN" ? "₦" : toCurrency + " "}${converted.toFixed(2)}`],
                  ["Exchange rate", `1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}`],
                  ["Transfer fee (1.5%)", `${fromCurrency === "NGN" ? "₦" : fromCurrency + " "}${fee.toFixed(2)}`],
                  ["Total deducted", `${fromCurrency === "NGN" ? "₦" : fromCurrency + " "}${total.toFixed(2)}`],
                  ["Recipient", recipient],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep("form")}>Back</Button>
                <Button className="flex-1" onClick={() => sendMutation.mutate({ recipientId: 2, amount: numAmount, currency: fromCurrency, toCurrency, note: `Transfer to ${recipient}` })} disabled={sendMutation.isPending}>
                  {sendMutation.isPending ? "Sending..." : "Confirm & Send"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>Transfer Details</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {/* Recipient */}
              <div className="space-y-2">
                <Label>Recipient (email or phone)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                  <Input className="pl-9" placeholder="john@example.com or +234..." value={recipient} onChange={e => setRecipient(e.target.value)}/>
                </div>
              </div>
              {/* Amount & Currency */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>You send</Label>
                  <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/>
                </div>
                <div className="space-y-2">
                  <Label>From currency</Label>
                  <Select value={fromCurrency} onValueChange={setFromCurrency}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {/* FX Preview */}
              {numAmount > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Exchange rate</span>
                    <span className="font-medium flex items-center gap-1"><RefreshCw className="h-3 w-3"/>1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}</span>
                  </div>
                  <Separator/>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-sm">Recipient gets</span>
                    <span className="text-xl font-bold text-primary">{toCurrency === "NGN" ? "₦" : toCurrency + " "}{converted.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Fee: {fromCurrency === "NGN" ? "₦" : fromCurrency + " "}{fee.toFixed(2)} (1.5%)</span>
                    <span>Total: {fromCurrency === "NGN" ? "₦" : fromCurrency + " "}{total.toFixed(2)}</span>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>To currency</Label>
                <Select value={toCurrency} onValueChange={setToCurrency}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button className="w-full gap-2" disabled={!amount || !recipient} onClick={() => setStep("confirm")}>
                Continue <ArrowRight className="h-4 w-4"/>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
''')

# ─── ReceiveMoney ─────────────────────────────────────────────────────────────
page("ReceiveMoney", "Receive Money", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Download, Share2, QrCode, CheckCircle } from "lucide-react";

export default function ReceiveMoney() {
  const { data } = trpc.virtualAccount.list.useQuery();
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Receive Money</h1>
          <p className="text-muted-foreground text-sm">Share your account details to receive payments</p>
        </div>

        {/* Virtual Accounts */}
        <div className="space-y-4">
          {data?.map((acct: any) => (
            <Card key={acct.id} className="border-primary/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-xl">{acct.currency === "NGN" ? "🇳🇬" : acct.currency === "USD" ? "🇺🇸" : acct.currency === "GBP" ? "🇬🇧" : "💱"}</span>
                    {acct.bankName} — {acct.currency}
                  </CardTitle>
                  <Badge variant="secondary" className="text-emerald-600 bg-emerald-50">{acct.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Account Number</p>
                    <p className="font-mono font-bold text-sm">{acct.accountNumber}</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Account Name</p>
                    <p className="font-semibold text-sm">{acct.accountName}</p>
                  </div>
                </div>
                {acct.sortCode && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Sort Code / Routing</p>
                    <p className="font-mono font-bold text-sm">{acct.sortCode}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => copyToClipboard(acct.accountNumber, "Account number")}>
                    <Copy className="h-3 w-3"/>Copy
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => toast.info("Share link copied!")}>
                    <Share2 className="h-3 w-3"/>Share
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* QR Code */}
        <Card>
          <CardContent className="p-6 text-center">
            <div className="w-32 h-32 bg-muted rounded-xl mx-auto mb-4 flex items-center justify-center">
              <QrCode className="h-16 w-16 text-muted-foreground"/>
            </div>
            <p className="font-semibold mb-1">Scan to Pay</p>
            <p className="text-sm text-muted-foreground mb-4">Share this QR code for instant payments</p>
            <Button variant="outline" size="sm" className="gap-1"><Download className="h-4 w-4"/>Download QR</Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── Transactions ─────────────────────────────────────────────────────────────
page("Transactions", "Transactions", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Search, Download, Filter, Send, ArrowLeftRight, Phone, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string,string> = {
  completed:"bg-emerald-100 text-emerald-700",
  pending:"bg-amber-100 text-amber-700",
  processing:"bg-blue-100 text-blue-700",
  failed:"bg-red-100 text-red-700",
  cancelled:"bg-gray-100 text-gray-600",
};

export default function Transactions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { data, isLoading } = trpc.transactions.list.useQuery({ limit: 50 });

  const filtered = data?.transactions?.filter((t:any) => {
    const matchSearch = !search || t.description?.toLowerCase().includes(search.toLowerCase()) || t.recipientName?.toLowerCase().includes(search.toLowerCase()) || t.reference?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    const matchType = typeFilter === "all" || t.type === typeFilter;
    return matchSearch && matchStatus && matchType;
  }) ?? [];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Transactions</h1>
            <p className="text-muted-foreground text-sm">{data?.total ?? 0} total transactions</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1"><Download className="h-4 w-4"/>Export</Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
            <Input className="pl-9" placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status"/></SelectTrigger>
            <SelectContent>
              {["all","completed","pending","processing","failed","cancelled"].map(s => <SelectItem key={s} value={s}>{s === "all" ? "All Status" : s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Type"/></SelectTrigger>
            <SelectContent>
              {["all","send","receive","exchange","airtime","bill","topup"].map(t => <SelectItem key={t} value={t}>{t === "all" ? "All Types" : t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">{[...Array(8)].map((_,i) => <Skeleton key={i} className="h-14"/>)}</div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground">No transactions found</div>
                ) : filtered.map((t:any) => (
                  <div key={t.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {t.type === "send" ? <Send className="h-4 w-4 text-red-500"/> : t.type === "exchange" ? <ArrowLeftRight className="h-4 w-4 text-violet-500"/> : t.type === "airtime" ? <Phone className="h-4 w-4 text-orange-500"/> : <Receipt className="h-4 w-4 text-blue-500"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.description ?? t.type}</p>
                      <p className="text-xs text-muted-foreground">{t.reference} · {new Date(t.createdAt).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"})}</p>
                    </div>
                    <div className="hidden sm:block text-xs text-muted-foreground">{t.recipientName ?? "—"}</div>
                    <Badge className={cn("text-xs shrink-0", STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-600")}>{t.status}</Badge>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-semibold", t.type==="receive"||t.type==="topup" ? "text-emerald-600" : "")}>
                        {t.type==="receive"||t.type==="topup" ? "+" : "-"}{t.currency==="NGN"?"₦":t.currency+" "}{Number(t.amount).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── ExchangeRates ────────────────────────────────────────────────────────────
page("ExchangeRates", "Exchange Rates", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ArrowLeftRight, Lock, TrendingUp, TrendingDown } from "lucide-react";

const CURRENCIES = ["NGN","USD","GBP","EUR","KES","GHS","ZAR","CAD","AUD","JPY"];
const FLAG: Record<string,string> = { NGN:"🇳🇬", USD:"🇺🇸", GBP:"🇬🇧", EUR:"🇪🇺", KES:"🇰🇪", GHS:"🇬🇭", ZAR:"🇿🇦", CAD:"🇨🇦", AUD:"🇦🇺", JPY:"🇯🇵" };

export default function ExchangeRates() {
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [amount, setAmount] = useState("100");
  const { data: rates, isLoading } = trpc.fx.rates.useQuery();
  const lockMutation = trpc.fx.lockRate.useMutation({ onSuccess: () => toast.success("Rate locked for 30 minutes!") });

  const rate = rates?.[from]?.[to] ?? 0;
  const converted = (parseFloat(amount) || 0) * rate;

  const PAIRS = [
    { from:"USD", to:"NGN", change:0.3 }, { from:"GBP", to:"NGN", change:-0.1 },
    { from:"EUR", to:"NGN", change:0.2 }, { from:"USD", to:"KES", change:0.5 },
    { from:"USD", to:"GHS", change:-0.4 }, { from:"GBP", to:"EUR", change:0.1 },
  ];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Exchange Rates</h1>
          <p className="text-muted-foreground text-sm">Live FX rates updated every 30 seconds</p>
        </div>

        {/* Calculator */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader><CardTitle className="text-base">Rate Calculator</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium">Amount</label>
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="100"/>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">From</label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{FLAG[c]} {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">To</label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{FLAG[c]} {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {rate > 0 && (
              <div className="bg-background rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">You get</p>
                  <p className="text-3xl font-extrabold text-primary">{to === "NGN" ? "₦" : to + " "}{converted.toLocaleString(undefined,{maximumFractionDigits:2})}</p>
                  <p className="text-xs text-muted-foreground mt-1">Rate: 1 {from} = {rate.toFixed(4)} {to}</p>
                </div>
                <Button onClick={() => lockMutation.mutate({ fromCurrency: from, toCurrency: to, rate, duration: 30 })} className="gap-1">
                  <Lock className="h-4 w-4"/>Lock Rate
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rate Table */}
        <Card>
          <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">Popular Pairs</CardTitle><Badge variant="outline" className="gap-1"><RefreshCw className="h-3 w-3"/>Live</Badge></div></CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {PAIRS.map(p => {
                const r = rates?.[p.from]?.[p.to] ?? 0;
                return (
                  <div key={`${p.from}-${p.to}`} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{FLAG[p.from]}{FLAG[p.to]}</span>
                      <div>
                        <p className="font-semibold text-sm">{p.from}/{p.to}</p>
                        <p className="text-xs text-muted-foreground">1 {p.from} = {r.toFixed(4)} {p.to}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{r.toFixed(4)}</p>
                      <p className={`text-xs flex items-center gap-0.5 ${p.change >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {p.change >= 0 ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                        {p.change >= 0 ? "+" : ""}{p.change}%
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── Generic page factory ─────────────────────────────────────────────────────
def generic_page(name, title, icon_import, icon_jsx, description, sections):
    """Generate a full page with real sections."""
    sections_code = "\n".join(sections)
    return f'''import AppLayout from "@/components/AppLayout";
import {{ trpc }} from "@/lib/trpc";
import {{ Card, CardContent, CardHeader, CardTitle }} from "@/components/ui/card";
import {{ Button }} from "@/components/ui/button";
import {{ Badge }} from "@/components/ui/badge";
import {{ Skeleton }} from "@/components/ui/skeleton";
import {{ {icon_import} }} from "lucide-react";

export default function {name}() {{
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <{icon_jsx} className="h-5 w-5 text-primary"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
        </div>
        {sections_code}
      </div>
    </AppLayout>
  );
}}
'''

# ─── Airtime ──────────────────────────────────────────────────────────────────
page("Airtime", "Airtime & Data", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { Phone, Smartphone, Wifi, CheckCircle } from "lucide-react";

const NETWORKS = [
  { id:"mtn", name:"MTN Nigeria", color:"bg-yellow-400" },
  { id:"airtel", name:"Airtel Nigeria", color:"bg-red-500" },
  { id:"glo", name:"Glo Mobile", color:"bg-green-500" },
  { id:"9mobile", name:"9mobile", color:"bg-emerald-600" },
];
const AMOUNTS = [100,200,500,1000,2000,5000];
const DATA_PLANS = [
  { id:1, name:"1GB - 30 days", price:300, network:"mtn" },
  { id:2, name:"2GB - 30 days", price:500, network:"mtn" },
  { id:3, name:"5GB - 30 days", price:1000, network:"airtel" },
  { id:4, name:"10GB - 30 days", price:2000, network:"glo" },
  { id:5, name:"Unlimited - 7 days", price:1500, network:"9mobile" },
];

export default function Airtime() {
  const [tab, setTab] = useState<"airtime"|"data">("airtime");
  const [network, setNetwork] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState(false);
  const buyMutation = trpc.airtime.buy.useMutation({
    onSuccess: () => { setDone(true); toast.success("Airtime purchased successfully!"); },
    onError: (e) => toast.error(e.message),
  });

  if (done) return (
    <AppLayout>
      <div className="p-6 max-w-md mx-auto text-center mt-12">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-8 w-8 text-emerald-600"/>
        </div>
        <h2 className="text-xl font-bold mb-2">Purchase Successful!</h2>
        <p className="text-muted-foreground mb-4">₦{amount} airtime sent to {phone}</p>
        <Button onClick={() => { setDone(false); setPhone(""); setAmount(""); }}>Buy More</Button>
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Airtime & Data</h1>
          <p className="text-muted-foreground text-sm">Top up airtime and data bundles instantly</p>
        </div>

        {/* Tab */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {(["airtime","data"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${tab===t ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>

        <Card>
          <CardContent className="p-5 space-y-5">
            {/* Network */}
            <div className="space-y-2">
              <Label>Select Network</Label>
              <div className="grid grid-cols-4 gap-2">
                {NETWORKS.map(n => (
                  <button key={n.id} onClick={() => setNetwork(n.id)} className={`p-3 rounded-lg border-2 text-xs font-medium transition-all ${network===n.id ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div className={`w-6 h-6 rounded-full ${n.color} mx-auto mb-1`}/>
                    {n.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input className="pl-9" placeholder="+234 800 000 0000" value={phone} onChange={e => setPhone(e.target.value)}/>
              </div>
            </div>

            {tab === "airtime" ? (
              <>
                <div className="space-y-2">
                  <Label>Amount (₦)</Label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {AMOUNTS.map(a => (
                      <button key={a} onClick={() => setAmount(String(a))} className={`py-2 rounded-lg border text-sm font-medium transition-all ${amount===String(a) ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>₦{a}</button>
                    ))}
                  </div>
                  <Input type="number" placeholder="Custom amount" value={amount} onChange={e => setAmount(e.target.value)}/>
                </div>
                <Button className="w-full" disabled={!phone || !amount || buyMutation.isPending} onClick={() => buyMutation.mutate({ network, phone, amount: parseFloat(amount), type:"airtime" })}>
                  {buyMutation.isPending ? "Processing..." : `Buy ₦${amount || 0} Airtime`}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Select Data Plan</Label>
                  <div className="space-y-2">
                    {DATA_PLANS.filter(p => p.network === network).map(plan => (
                      <button key={plan.id} onClick={() => setAmount(String(plan.price))} className={`w-full flex items-center justify-between p-3 rounded-lg border text-sm transition-all ${amount===String(plan.price) ? "border-primary bg-primary/5" : "border-border"}`}>
                        <span className="font-medium">{plan.name}</span>
                        <span className="font-bold text-primary">₦{plan.price}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <Button className="w-full" disabled={!phone || !amount || buyMutation.isPending} onClick={() => buyMutation.mutate({ network, phone, amount: parseFloat(amount), type:"data" })}>
                  {buyMutation.isPending ? "Processing..." : `Buy Data Plan`}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── Bills ────────────────────────────────────────────────────────────────────
page("Bills", "Bill Payment", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { Zap, Droplets, Tv, Wifi, GraduationCap, Building2, CheckCircle } from "lucide-react";

const CATEGORIES = [
  { id:"electricity", label:"Electricity", icon:<Zap className="h-5 w-5"/>, color:"bg-yellow-100 text-yellow-600" },
  { id:"water", label:"Water", icon:<Droplets className="h-5 w-5"/>, color:"bg-blue-100 text-blue-600" },
  { id:"cable", label:"Cable TV", icon:<Tv className="h-5 w-5"/>, color:"bg-purple-100 text-purple-600" },
  { id:"internet", label:"Internet", icon:<Wifi className="h-5 w-5"/>, color:"bg-cyan-100 text-cyan-600" },
  { id:"education", label:"School Fees", icon:<GraduationCap className="h-5 w-5"/>, color:"bg-emerald-100 text-emerald-600" },
  { id:"government", label:"Government", icon:<Building2 className="h-5 w-5"/>, color:"bg-gray-100 text-gray-600" },
];
const PROVIDERS: Record<string,string[]> = {
  electricity:["EKEDC","IKEDC","AEDC","PHED","EEDC","KEDCO"],
  water:["Lagos Water","Abuja Water","Rivers Water"],
  cable:["DSTV","GOtv","StarTimes","ShowMax"],
  internet:["MTN Fiber","Airtel Fiber","Smile","Spectranet","Swift"],
  education:["WAEC","JAMB","NECO","University Portal"],
  government:["FIRS","LIRS","CAC","NIN"],
};

export default function Bills() {
  const [category, setCategory] = useState("electricity");
  const [provider, setProvider] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState(false);
  const payMutation = trpc.bills.pay.useMutation({
    onSuccess: () => { setDone(true); toast.success("Bill payment successful!"); },
    onError: (e) => toast.error(e.message),
  });

  if (done) return (
    <AppLayout>
      <div className="p-6 max-w-md mx-auto text-center mt-12">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-8 w-8 text-emerald-600"/>
        </div>
        <h2 className="text-xl font-bold mb-2">Payment Successful!</h2>
        <p className="text-muted-foreground mb-4">{provider} — ₦{amount} paid for account {accountNumber}</p>
        <Button onClick={() => { setDone(false); setAccountNumber(""); setAmount(""); }}>Pay Another</Button>
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Bill Payment</h1>
          <p className="text-muted-foreground text-sm">Pay electricity, water, cable TV, and more</p>
        </div>

        {/* Categories */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => { setCategory(c.id); setProvider(""); }} className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${category===c.id ? "border-primary bg-primary/5" : "border-border"}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.color}`}>{c.icon}</div>
              <span className="text-xs font-medium">{c.label}</span>
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue placeholder="Select provider"/></SelectTrigger>
                <SelectContent>{(PROVIDERS[category]??[]).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account / Meter Number</Label>
              <Input placeholder="Enter account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)}/>
            </div>
            <div className="space-y-2">
              <Label>Amount (₦)</Label>
              <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/>
            </div>
            <Button className="w-full" disabled={!provider || !accountNumber || !amount || payMutation.isPending} onClick={() => payMutation.mutate({ category, provider, accountNumber, amount: parseFloat(amount), currency:"NGN" })}>
              {payMutation.isPending ? "Processing..." : `Pay ₦${amount || 0}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── VirtualAccount ───────────────────────────────────────────────────────────
page("VirtualAccount", "Virtual Account", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Copy, Plus, CheckCircle } from "lucide-react";

export default function VirtualAccount() {
  const { data, isLoading, refetch } = trpc.virtualAccount.list.useQuery();
  const [currency, setCurrency] = useState("NGN");
  const createMutation = trpc.virtualAccount.create.useMutation({
    onSuccess: () => { toast.success("Virtual account created!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} copied!`); };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Virtual Accounts</h1>
            <p className="text-muted-foreground text-sm">Dedicated bank accounts for receiving payments</p>
          </div>
          <div className="flex gap-2">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-24"><SelectValue/></SelectTrigger>
              <SelectContent>{["NGN","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" className="gap-1" onClick={() => createMutation.mutate({ currency, bank:"Wema Bank" })} disabled={createMutation.isPending}>
              <Plus className="h-4 w-4"/>{createMutation.isPending ? "Creating..." : "New Account"}
            </Button>
          </div>
        </div>

        {isLoading ? <div className="space-y-4">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-40"/>)}</div>
        : data?.map((acct:any) => (
          <Card key={acct.id} className="border-l-4 border-l-primary">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary"/>
                  </div>
                  <div>
                    <p className="font-semibold">{acct.bankName}</p>
                    <p className="text-xs text-muted-foreground">{acct.currency} Account</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-emerald-600 bg-emerald-50">{acct.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Account Number</p>
                  <div className="flex items-center justify-between">
                    <p className="font-mono font-bold">{acct.accountNumber}</p>
                    <button onClick={() => copy(acct.accountNumber,"Account number")} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5"/></button>
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Account Name</p>
                  <p className="font-semibold text-sm">{acct.accountName}</p>
                </div>
                {acct.sortCode && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Sort Code</p>
                    <div className="flex items-center justify-between">
                      <p className="font-mono font-bold">{acct.sortCode}</p>
                      <button onClick={() => copy(acct.sortCode,"Sort code")} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5"/></button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
''')

# ─── Cards ────────────────────────────────────────────────────────────────────
page("Cards", "Cards", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CreditCard, Plus, Lock, Eye, EyeOff, Copy, Trash2 } from "lucide-react";
import { useState } from "react";

export default function Cards() {
  const { data, isLoading } = trpc.cards.list.useQuery();
  const [showNumbers, setShowNumbers] = useState<Record<number,boolean>>({});
  const freezeMutation = trpc.cards.freeze.useMutation({ onSuccess: () => toast.success("Card status updated!") });
  const createMutation = trpc.cards.create.useMutation({ onSuccess: () => toast.success("Virtual card created!") });

  const toggleShow = (id: number) => setShowNumbers(p => ({ ...p, [id]: !p[id] }));

  const CARD_GRADIENTS = [
    "from-violet-600 to-indigo-700",
    "from-emerald-500 to-teal-700",
    "from-orange-500 to-red-600",
    "from-blue-500 to-cyan-600",
  ];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Cards</h1>
            <p className="text-muted-foreground text-sm">Manage your virtual and physical cards</p>
          </div>
          <Button size="sm" className="gap-1" onClick={() => createMutation.mutate({ type:"virtual", currency:"USD" })} disabled={createMutation.isPending}>
            <Plus className="h-4 w-4"/>{createMutation.isPending ? "Creating..." : "New Card"}
          </Button>
        </div>

        {isLoading ? <div className="space-y-4">{[...Array(2)].map((_,i) => <Skeleton key={i} className="h-56"/>)}</div>
        : (
          <div className="grid sm:grid-cols-2 gap-6">
            {data?.map((card:any, idx:number) => (
              <div key={card.id} className="space-y-3">
                {/* Card Visual */}
                <div className={`relative rounded-2xl p-5 bg-gradient-to-br ${CARD_GRADIENTS[idx % CARD_GRADIENTS.length]} text-white aspect-[1.586/1]`}>
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <p className="text-xs opacity-70">RemitFlow</p>
                      <p className="font-bold">{card.type === "virtual" ? "Virtual" : "Physical"}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                      <CreditCard className="h-4 w-4"/>
                    </div>
                  </div>
                  <p className="font-mono text-lg tracking-widest mb-4">
                    {showNumbers[card.id] ? card.cardNumber : card.cardNumber.replace(/\d(?=\d{4})/g,"*")}
                  </p>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs opacity-70">Card Holder</p>
                      <p className="font-semibold text-sm">{card.cardHolder}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs opacity-70">Expires</p>
                      <p className="font-semibold text-sm">{card.expiryDate}</p>
                    </div>
                  </div>
                  <Badge className={`absolute top-4 right-4 ${card.status === "active" ? "bg-emerald-500" : "bg-red-500"} text-white border-0`}>{card.status}</Badge>
                </div>
                {/* Card Actions */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Spending Limit</span>
                      <span className="font-bold">{card.currency === "USD" ? "$" : "₦"}{Number(card.spendingLimit).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Freeze Card</span>
                      <Switch checked={card.status === "frozen"} onCheckedChange={() => freezeMutation.mutate({ id: card.id })}/>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => toggleShow(card.id)}>
                        {showNumbers[card.id] ? <EyeOff className="h-3 w-3"/> : <Eye className="h-3 w-3"/>}
                        {showNumbers[card.id] ? "Hide" : "Show"}
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => { navigator.clipboard.writeText(card.cardNumber); toast.success("Card number copied!"); }}>
                        <Copy className="h-3 w-3"/>Copy
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
''')

# ─── BatchPayments ────────────────────────────────────────────────────────────
page("BatchPayments", "Batch Payments", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Layers, Plus, Upload, CheckCircle, Clock, XCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string,string> = {
  completed:"bg-emerald-100 text-emerald-700",
  pending:"bg-amber-100 text-amber-700",
  processing:"bg-blue-100 text-blue-700",
  failed:"bg-red-100 text-red-700",
};

export default function BatchPayments() {
  const { data, isLoading } = trpc.batch.list.useQuery();
  const createMutation = trpc.batch.create.useMutation({
    onSuccess: () => toast.success("Batch payment created!"),
    onError: (e) => toast.error(e.message),
  });

  const SAMPLE_BATCH = {
    name: "October Payroll",
    payments: [
      { recipient:"john@example.com", amount:150000, currency:"NGN" },
      { recipient:"jane@example.com", amount:200000, currency:"NGN" },
      { recipient:"bob@example.com", amount:175000, currency:"NGN" },
    ]
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Batch Payments</h1>
            <p className="text-muted-foreground text-sm">Send payments to multiple recipients at once</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1"><Upload className="h-4 w-4"/>Import CSV</Button>
            <Button size="sm" className="gap-1" onClick={() => createMutation.mutate(SAMPLE_BATCH)} disabled={createMutation.isPending}>
              <Plus className="h-4 w-4"/>{createMutation.isPending ? "Creating..." : "New Batch"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label:"Total Batches", value:data?.length ?? 0, icon:<Layers className="h-5 w-5 text-primary"/> },
            { label:"Completed", value:data?.filter((b:any)=>b.status==="completed").length ?? 0, icon:<CheckCircle className="h-5 w-5 text-emerald-600"/> },
            { label:"Pending", value:data?.filter((b:any)=>b.status==="pending").length ?? 0, icon:<Clock className="h-5 w-5 text-amber-600"/> },
            { label:"Failed", value:data?.filter((b:any)=>b.status==="failed").length ?? 0, icon:<XCircle className="h-5 w-5 text-red-600"/> },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Batch List */}
        <Card>
          <CardHeader><CardTitle className="text-base">Batch History</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-16"/>)}</div>
            : (
              <div className="divide-y divide-border">
                {data?.map((batch:any) => (
                  <div key={batch.id} className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Layers className="h-4 w-4 text-primary"/>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{batch.name}</p>
                        <p className="text-xs text-muted-foreground">{batch.totalPayments} payments · {new Date(batch.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="font-semibold text-sm">₦{Number(batch.totalAmount).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{batch.currency}</p>
                      </div>
                      <Badge className={cn("text-xs", STATUS_COLORS[batch.status]??"")}>{batch.status}</Badge>
                      <Button variant="ghost" size="sm"><Download className="h-4 w-4"/></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── FxAlerts ─────────────────────────────────────────────────────────────────
page("FxAlerts", "FX Rate Alerts", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { toast } from "sonner";
import { Bell, Plus, TrendingUp, TrendingDown, AlertCircle, Trash2 } from "lucide-react";

const CURRENCIES = ["NGN","USD","GBP","EUR","KES","GHS","ZAR"];

export default function FxAlerts() {
  const { data, isLoading } = trpc.fx.alerts.useQuery();
  const createMutation = trpc.fx.createAlert.useMutation({ onSuccess: () => toast.success("Alert created!") });
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [targetRate, setTargetRate] = useState("");
  const [direction, setDirection] = useState("above");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">FX Rate Alerts</h1>
          <p className="text-muted-foreground text-sm">Get notified when exchange rates hit your target</p>
        </div>

        {/* Create Alert */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader><CardTitle className="text-base">Create New Alert</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">From</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">To</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">When rate is</Label>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="above">Above</SelectItem>
                    <SelectItem value="below">Below</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Target Rate</Label>
                <Input type="number" placeholder="e.g. 1600" value={targetRate} onChange={e => setTargetRate(e.target.value)}/>
              </div>
            </div>
            <Button className="w-full gap-1" disabled={!targetRate || createMutation.isPending} onClick={() => createMutation.mutate({ fromCurrency: from, toCurrency: to, targetRate: parseFloat(targetRate), direction })}>
              <Plus className="h-4 w-4"/>{createMutation.isPending ? "Creating..." : "Create Alert"}
            </Button>
          </CardContent>
        </Card>

        {/* Alert List */}
        <Card>
          <CardHeader><CardTitle className="text-base">Active Alerts</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="space-y-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-16"/>)}</div>
            : data?.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30"/>
                <p>No alerts yet. Create one above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data?.map((alert:any) => (
                  <div key={alert.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${alert.direction === "above" ? "bg-emerald-100" : "bg-red-100"}`}>
                        {alert.direction === "above" ? <TrendingUp className="h-4 w-4 text-emerald-600"/> : <TrendingDown className="h-4 w-4 text-red-600"/>}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{alert.fromCurrency}/{alert.toCurrency}</p>
                        <p className="text-xs text-muted-foreground">Alert when {alert.direction} {alert.targetRate}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={alert.triggered ? "secondary" : "outline"} className={alert.triggered ? "text-emerald-600 bg-emerald-50" : ""}>{alert.triggered ? "Triggered" : "Active"}</Badge>
                      <Switch checked={alert.active} onCheckedChange={() => {}}/>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── TransferTracking ─────────────────────────────────────────────────────────
page("TransferTracking", "Transfer Tracking", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Search, Activity, CheckCircle, Clock, AlertCircle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Initiated","Processing","In Transit","Clearing","Completed"];

export default function TransferTracking() {
  const [reference, setReference] = useState("TXN-2024-001");
  const { data, isLoading, refetch } = trpc.tracking.track.useQuery({ reference }, { enabled: !!reference });

  const stepIndex = data ? STEPS.indexOf(data.currentStep ?? "Initiated") : -1;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Transfer Tracking</h1>
          <p className="text-muted-foreground text-sm">Track the status of any transfer in real-time</p>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input className="pl-9" placeholder="Enter transfer reference (e.g. TXN-2024-001)" value={reference} onChange={e => setReference(e.target.value)}/>
              </div>
              <Button onClick={() => refetch()}>Track</Button>
            </div>
          </CardContent>
        </Card>

        {data && (
          <>
            {/* Status Card */}
            <Card className={cn("border-l-4", data.status === "completed" ? "border-l-emerald-500" : data.status === "failed" ? "border-l-red-500" : "border-l-blue-500")}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Reference</p>
                    <p className="font-mono font-bold">{data.reference}</p>
                  </div>
                  <Badge className={cn("text-sm px-3 py-1", data.status === "completed" ? "bg-emerald-100 text-emerald-700" : data.status === "failed" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>
                    {data.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Amount</p><p className="font-bold">{data.currency === "NGN" ? "₦" : data.currency + " "}{Number(data.amount).toLocaleString()}</p></div>
                  <div><p className="text-muted-foreground">Recipient</p><p className="font-semibold">{data.recipientName}</p></div>
                  <div><p className="text-muted-foreground">ETA</p><p className="font-semibold">{data.estimatedArrival ?? "1-2 business days"}</p></div>
                </div>
              </CardContent>
            </Card>

            {/* Progress Steps */}
            <Card>
              <CardHeader><CardTitle className="text-base">Transfer Progress</CardTitle></CardHeader>
              <CardContent className="p-5">
                <div className="space-y-4">
                  {STEPS.map((step, i) => {
                    const isCompleted = i < stepIndex;
                    const isCurrent = i === stepIndex;
                    return (
                      <div key={step} className="flex items-center gap-4">
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                          isCompleted ? "bg-emerald-500 text-white" : isCurrent ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground")}>
                          {isCompleted ? <CheckCircle className="h-4 w-4"/> : isCurrent ? <Activity className="h-4 w-4 animate-pulse"/> : <Clock className="h-4 w-4"/>}
                        </div>
                        <div className="flex-1">
                          <p className={cn("font-medium text-sm", isCurrent ? "text-blue-600" : isCompleted ? "text-foreground" : "text-muted-foreground")}>{step}</p>
                          {isCurrent && <p className="text-xs text-muted-foreground">In progress...</p>}
                          {isCompleted && <p className="text-xs text-muted-foreground">Completed</p>}
                        </div>
                        {i < STEPS.length - 1 && <div className={cn("h-0.5 w-8", isCompleted ? "bg-emerald-500" : "bg-border")}/>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
''')

# ─── RecurringPayments ────────────────────────────────────────────────────────
page("RecurringPayments", "Recurring Payments", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { toast } from "sonner";
import { Repeat, Plus, Pause, X, Calendar } from "lucide-react";

export default function RecurringPayments() {
  const { data, isLoading } = trpc.recurring.list.useQuery();
  const pauseMutation = trpc.recurring.pause.useMutation({ onSuccess: () => toast.success("Payment paused!") });
  const cancelMutation = trpc.recurring.cancel.useMutation({ onSuccess: () => toast.success("Payment cancelled!") });
  const createMutation = trpc.recurring.create.useMutation({ onSuccess: () => toast.success("Recurring payment created!") });
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [recipient, setRecipient] = useState("");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Recurring Payments</h1>
          <p className="text-muted-foreground text-sm">Set up automatic payments on a schedule</p>
        </div>

        {/* Create Form */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader><CardTitle className="text-base">New Recurring Payment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input placeholder="e.g. Rent Payment" value={name} onChange={e => setName(e.target.value)}/>
              </div>
              <div className="space-y-1.5">
                <Label>Recipient</Label>
                <Input placeholder="email or phone" value={recipient} onChange={e => setRecipient(e.target.value)}/>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₦)</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/>
              </div>
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {["daily","weekly","monthly","quarterly","annually"].map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full gap-1" disabled={!name || !amount || !recipient || createMutation.isPending} onClick={() => createMutation.mutate({ name, amount: parseFloat(amount), currency:"NGN", frequency, recipient })}>
              <Plus className="h-4 w-4"/>{createMutation.isPending ? "Creating..." : "Create Recurring Payment"}
            </Button>
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardHeader><CardTitle className="text-base">Active Schedules</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-20"/>)}</div>
            : (
              <div className="divide-y divide-border">
                {data?.map((r:any) => (
                  <div key={r.id} className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Repeat className="h-4 w-4 text-primary"/>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{r.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{r.frequency} · Next: {new Date(r.nextPaymentDate).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-semibold text-sm">₦{Number(r.amount).toLocaleString()}</p>
                        <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => pauseMutation.mutate({ id: r.id })}><Pause className="h-4 w-4"/></Button>
                        <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate({ id: r.id })} className="text-destructive hover:text-destructive"><X className="h-4 w-4"/></Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── QRCode ───────────────────────────────────────────────────────────────────
page("QRCode", "QR Code Payments", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { QrCode, Download, Copy, RefreshCw } from "lucide-react";

export default function QRCode() {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const generateMutation = trpc.qr.generate.useMutation({ onSuccess: () => toast.success("QR code generated!") });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">QR Code Payments</h1>
          <p className="text-muted-foreground text-sm">Generate QR codes to receive payments instantly</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {/* Generator */}
          <Card>
            <CardHeader><CardTitle className="text-base">Generate QR Code</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Amount (optional)</Label>
                <Input type="number" placeholder="Leave blank for any amount" value={amount} onChange={e => setAmount(e.target.value)}/>
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{["NGN","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button className="w-full gap-1" onClick={() => generateMutation.mutate({ amount: amount ? parseFloat(amount) : undefined, currency })} disabled={generateMutation.isPending}>
                <QrCode className="h-4 w-4"/>{generateMutation.isPending ? "Generating..." : "Generate QR Code"}
              </Button>
            </CardContent>
          </Card>

          {/* QR Display */}
          <Card>
            <CardContent className="p-6 flex flex-col items-center justify-center min-h-64">
              <div className="w-40 h-40 bg-muted rounded-xl flex items-center justify-center mb-4 border-2 border-dashed border-border">
                <QrCode className="h-20 w-20 text-muted-foreground"/>
              </div>
              {generateMutation.data ? (
                <>
                  <p className="text-sm font-medium mb-3">QR Code Ready</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1"><Download className="h-3 w-3"/>Save</Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(generateMutation.data?.qrData ?? ""); toast.success("QR data copied!"); }}><Copy className="h-3 w-3"/>Copy</Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center">Generate a QR code to receive payments</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
''')

# ─── DirectDebit ──────────────────────────────────────────────────────────────
page("DirectDebit", "Direct Debit", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Landmark, X, Plus, Calendar } from "lucide-react";

export default function DirectDebit() {
  const { data, isLoading } = trpc.directDebit.mandates.useQuery();
  const cancelMutation = trpc.directDebit.cancel.useMutation({ onSuccess: () => toast.success("Mandate cancelled!") });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Direct Debit</h1>
            <p className="text-muted-foreground text-sm">Manage your direct debit mandates</p>
          </div>
          <Button size="sm" className="gap-1" onClick={() => toast.info("Setup form coming soon")}><Plus className="h-4 w-4"/>New Mandate</Button>
        </div>

        {isLoading ? <div className="space-y-3">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-24"/>)}</div>
        : data?.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Landmark className="h-10 w-10 mx-auto mb-3 opacity-30"/>
              <p>No direct debit mandates</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {data?.map((m:any) => (
              <Card key={m.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Landmark className="h-4 w-4 text-primary"/>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{m.creditorName}</p>
                      <p className="text-xs text-muted-foreground">{m.reference} · ₦{Number(m.amount).toLocaleString()} {m.frequency}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{m.status}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate({ id: m.id })} className="text-destructive hover:text-destructive"><X className="h-4 w-4"/></Button>
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
''')

# ─── MPesa ────────────────────────────────────────────────────────────────────
page("MPesa", "M-Pesa", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { Smartphone, Send, CheckCircle, Info } from "lucide-react";

export default function MPesa() {
  const { data: info } = trpc.mpesa.info.useQuery();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState(false);
  const sendMutation = trpc.mpesa.send.useMutation({
    onSuccess: () => { setDone(true); toast.success("M-Pesa transfer initiated!"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-green-600"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">M-Pesa</h1>
            <p className="text-muted-foreground text-sm">Send money via M-Pesa mobile money</p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3">
          <Info className="h-5 w-5 text-green-600 shrink-0 mt-0.5"/>
          <div className="text-sm text-green-800">
            <p className="font-semibold">M-Pesa Integration Active</p>
            <p className="text-green-700 text-xs mt-0.5">Supports Kenya (KES), Tanzania (TZS), Ghana (GHS), and Uganda (UGX)</p>
          </div>
        </div>

        {done ? (
          <Card className="text-center p-8">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-green-600"/>
            </div>
            <h2 className="text-xl font-bold mb-2">Transfer Sent!</h2>
            <p className="text-muted-foreground mb-4">KSh {amount} sent to {phone} via M-Pesa</p>
            <Button onClick={() => { setDone(false); setPhone(""); setAmount(""); }}>Send Another</Button>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle className="text-base">Send via M-Pesa</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>M-Pesa Phone Number</Label>
                <div className="relative">
                  <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                  <Input className="pl-9" placeholder="+254 700 000 000" value={phone} onChange={e => setPhone(e.target.value)}/>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Amount (KES)</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/>
              </div>
              {amount && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span>KSh {(parseFloat(amount) * 0.01).toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold mt-1"><span>Total</span><span>KSh {(parseFloat(amount) * 1.01).toFixed(2)}</span></div>
                </div>
              )}
              <Button className="w-full gap-1 bg-green-600 hover:bg-green-700" disabled={!phone || !amount || sendMutation.isPending} onClick={() => sendMutation.mutate({ phone, amount: parseFloat(amount) })}>
                <Send className="h-4 w-4"/>{sendMutation.isPending ? "Sending..." : "Send via M-Pesa"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
''')

# ─── WiseTransfer ─────────────────────────────────────────────────────────────
page("WiseTransfer", "Wise Transfer", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, Link2, CheckCircle, ExternalLink } from "lucide-react";

export default function WiseTransfer() {
  const { data } = trpc.wise.info.useQuery();
  const connectMutation = trpc.wise.connect.useMutation({ onSuccess: () => toast.success("Wise account connected!") });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
            <Globe className="h-5 w-5 text-cyan-600"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Wise Transfer</h1>
            <p className="text-muted-foreground text-sm">Connect your Wise account for international transfers</p>
          </div>
        </div>

        <Card className="border-cyan-200 bg-cyan-50/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-semibold">Wise Integration</p>
                <p className="text-sm text-muted-foreground">Multi-currency borderless account</p>
              </div>
              <Badge className={data?.connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                {data?.connected ? "Connected" : "Not Connected"}
              </Badge>
            </div>
            {data?.connected ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {data.balances?.map((b:any) => (
                    <div key={b.currency} className="bg-background rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{b.currency}</p>
                      <p className="font-bold">{b.currency === "USD" ? "$" : b.currency === "GBP" ? "£" : b.currency + " "}{Number(b.balance).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="w-full gap-1"><ExternalLink className="h-4 w-4"/>Open in Wise</Button>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-4">Link your Wise account to send international transfers at the real exchange rate</p>
                <Button className="gap-1 bg-cyan-600 hover:bg-cyan-700" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                  <Link2 className="h-4 w-4"/>{connectMutation.isPending ? "Connecting..." : "Connect Wise Account"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <Card>
          <CardHeader><CardTitle className="text-base">Wise Features</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              "Real exchange rate (no markup)",
              "40+ currencies supported",
              "Receive payments in USD, GBP, EUR, AUD",
              "Debit card for international spending",
              "Batch payments for businesses",
            ].map(f => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0"/>
                {f}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── KYCVerification ──────────────────────────────────────────────────────────
page("KYCVerification", "KYC Verification", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { UserCheck, Upload, CheckCircle, Clock, AlertCircle, ChevronRight, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const TIERS = [
  { level:1, name:"Basic KYC", limit:"₦500,000/day", requirements:["Email verification","Phone number","BVN/NIN"] },
  { level:2, name:"Standard KYC", limit:"₦2,000,000/day", requirements:["Government ID","Selfie verification","Proof of address"] },
  { level:3, name:"Enhanced KYC", limit:"₦10,000,000/day", requirements:["Business registration","Bank statement","Director information"] },
];

export default function KYCVerification() {
  const { data, isLoading } = trpc.kyc.status.useQuery();
  const submitMutation = trpc.kyc.submit.useMutation({ onSuccess: () => toast.success("KYC documents submitted for review!") });

  const currentTier = data?.tier ?? 1;
  const progressPct = (currentTier / 3) * 100;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">KYC Verification</h1>
          <p className="text-muted-foreground text-sm">Complete verification to unlock higher limits</p>
        </div>

        {/* Status Banner */}
        {isLoading ? <Skeleton className="h-24"/> : (
          <Card className={cn("border-l-4", data?.status === "verified" ? "border-l-emerald-500 bg-emerald-50/50" : data?.status === "pending" ? "border-l-amber-500 bg-amber-50/50" : "border-l-red-500 bg-red-50/50")}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center",
                data?.status === "verified" ? "bg-emerald-100" : data?.status === "pending" ? "bg-amber-100" : "bg-red-100")}>
                {data?.status === "verified" ? <CheckCircle className="h-6 w-6 text-emerald-600"/> : data?.status === "pending" ? <Clock className="h-6 w-6 text-amber-600"/> : <AlertCircle className="h-6 w-6 text-red-600"/>}
              </div>
              <div className="flex-1">
                <p className="font-semibold capitalize">{data?.status ?? "Not Started"}</p>
                <p className="text-sm text-muted-foreground">Tier {currentTier} of 3 — {TIERS[currentTier-1]?.limit}</p>
                <Progress value={progressPct} className="mt-2 h-1.5"/>
              </div>
              <Badge className={cn("text-sm", data?.status === "verified" ? "bg-emerald-100 text-emerald-700" : data?.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")}>
                Tier {currentTier}
              </Badge>
            </CardContent>
          </Card>
        )}

        {/* Tiers */}
        <div className="space-y-4">
          {TIERS.map(tier => {
            const isCompleted = currentTier > tier.level;
            const isCurrent = currentTier === tier.level;
            return (
              <Card key={tier.level} className={cn(isCurrent && "border-primary/50 bg-primary/5", isCompleted && "opacity-70")}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                        isCompleted ? "bg-emerald-500 text-white" : isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                        {isCompleted ? <CheckCircle className="h-4 w-4"/> : tier.level}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{tier.name}</p>
                        <p className="text-xs text-muted-foreground">Limit: {tier.limit}</p>
                      </div>
                    </div>
                    {isCurrent && <Badge className="bg-primary/10 text-primary">Current</Badge>}
                    {isCompleted && <Badge className="bg-emerald-100 text-emerald-700">Completed</Badge>}
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {tier.requirements.map(req => (
                      <div key={req} className="flex items-center gap-2 text-sm">
                        <CheckCircle className={cn("h-3.5 w-3.5 shrink-0", isCompleted ? "text-emerald-500" : "text-muted-foreground/40")}/>
                        <span className={isCompleted ? "line-through text-muted-foreground" : ""}>{req}</span>
                      </div>
                    ))}
                  </div>
                  {isCurrent && (
                    <Button size="sm" className="gap-1 w-full" onClick={() => submitMutation.mutate({ tier: tier.level, documents: [] })} disabled={submitMutation.isPending}>
                      <Upload className="h-3.5 w-3.5"/>{submitMutation.isPending ? "Submitting..." : "Upload Documents"}
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
''')

# ─── PropertyKYC ──────────────────────────────────────────────────────────────
page("PropertyKYC", "Property KYC", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Upload, CheckCircle, MapPin } from "lucide-react";

export default function PropertyKYC() {
  const { data, isLoading } = trpc.propertyKyc.properties.useQuery();
  const submitMutation = trpc.propertyKyc.submit.useMutation({ onSuccess: () => toast.success("Property KYC submitted!") });
  const [address, setAddress] = useState("");
  const [type, setType] = useState("residential");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Property KYC</h1>
          <p className="text-muted-foreground text-sm">Verify property ownership for real estate transactions</p>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader><CardTitle className="text-base">Submit Property for Verification</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Property Address</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input className="pl-9" placeholder="Full property address" value={address} onChange={e => setAddress(e.target.value)}/>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Property Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {["residential","commercial","industrial","land"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground"/>
              <p className="text-sm font-medium">Upload Title Documents</p>
              <p className="text-xs text-muted-foreground mt-1">C of O, Deed of Assignment, Survey Plan</p>
              <Button variant="outline" size="sm" className="mt-3">Choose Files</Button>
            </div>
            <Button className="w-full" disabled={!address || submitMutation.isPending} onClick={() => submitMutation.mutate({ address, type, documents:[] })}>
              {submitMutation.isPending ? "Submitting..." : "Submit for Verification"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Verified Properties</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-24"/> : data?.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No properties verified yet</p>
            ) : (
              <div className="space-y-3">
                {data?.map((p:any) => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <Building2 className="h-5 w-5 text-primary shrink-0"/>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{p.address}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.type}</p>
                    </div>
                    <Badge className={p.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{p.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── TravelRule ───────────────────────────────────────────────────────────────
page("TravelRule", "Travel Rule", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck, CheckCircle, AlertCircle, Info } from "lucide-react";

export default function TravelRule() {
  const { data, isLoading } = trpc.compliance.travelRule.useQuery();

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <Truck className="h-5 w-5 text-orange-600"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Travel Rule</h1>
            <p className="text-muted-foreground text-sm">FATF Travel Rule compliance for transfers ≥ $1,000</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
          <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5"/>
          <p className="text-sm text-blue-800">The FATF Travel Rule requires VASPs to share originator and beneficiary information for transfers of $1,000 or more. RemitFlow is fully compliant with FATF Recommendation 16.</p>
        </div>

        {isLoading ? <Skeleton className="h-48"/> : (
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label:"Total Transfers Checked", value:data?.totalChecked ?? 0, icon:<CheckCircle className="h-5 w-5 text-emerald-600"/> },
              { label:"Compliant", value:data?.compliant ?? 0, icon:<CheckCircle className="h-5 w-5 text-emerald-600"/> },
              { label:"Flagged", value:data?.flagged ?? 0, icon:<AlertCircle className="h-5 w-5 text-amber-600"/> },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-4 flex items-center gap-3">
                  {s.icon}
                  <div>
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Travel Rule Checks</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-48"/> : (
              <div className="divide-y divide-border">
                {data?.recentChecks?.map((check:any) => (
                  <div key={check.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-sm">{check.reference}</p>
                      <p className="text-xs text-muted-foreground">{check.originatorVASP} → {check.beneficiaryVASP}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-sm">${Number(check.amount).toLocaleString()}</p>
                      <Badge className={check.status === "compliant" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"} variant="secondary">{check.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
''')

# ─── FCACompliance ────────────────────────────────────────────────────────────
page("FCACompliance", "FCA Compliance", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BadgeCheck, AlertCircle, CheckCircle, Clock, FileText } from "lucide-react";

export default function FCACompliance() {
  const { data, isLoading } = trpc.compliance.fcaDashboard.useQuery();

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <BadgeCheck className="h-5 w-5 text-blue-600"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">FCA Compliance</h1>
            <p className="text-muted-foreground text-sm">Financial Conduct Authority regulatory compliance dashboard</p>
          </div>
        </div>

        {isLoading ? <Skeleton className="h-48"/> : (
          <>
            {/* Overall Score */}
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Overall Compliance Score</p>
                    <p className="text-4xl font-extrabold text-blue-700">{data?.overallScore ?? 0}%</p>
                  </div>
                  <Badge className="bg-blue-100 text-blue-700 text-sm px-3 py-1">{data?.status ?? "Compliant"}</Badge>
                </div>
                <Progress value={data?.overallScore ?? 0} className="h-3"/>
              </CardContent>
            </Card>

            {/* Checks Grid */}
            <div className="grid sm:grid-cols-2 gap-4">
              {data?.checks?.map((check:any) => (
                <Card key={check.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-sm">{check.name}</p>
                      <Badge className={check.status === "pass" ? "bg-emerald-100 text-emerald-700" : check.status === "warning" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}>
                        {check.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{check.description}</p>
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3"/>
                      Last checked: {new Date(check.lastChecked).toLocaleDateString()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Upcoming Reports */}
            <Card>
              <CardHeader><CardTitle className="text-base">Upcoming Regulatory Reports</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data?.upcomingReports?.map((r:any) => (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-primary"/>
                        <div>
                          <p className="font-medium text-sm">{r.name}</p>
                          <p className="text-xs text-muted-foreground">Due: {new Date(r.dueDate).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">{r.status}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
''')

# ─── GDPRData ─────────────────────────────────────────────────────────────────
page("GDPRData", "GDPR Data Management", '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DatabaseZap, Download, Trash2, Eye, Shield, Info } from "lucide-react";

export default function GDPRData() {
  const { data, isLoading } = trpc.compliance.gdprData.useQuery();

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <DatabaseZap className="h-5 w-5 text-violet-600"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">GDPR Data Management</h1>
            <p className="text-muted-foreground text-sm">Manage your personal data under GDPR rights</p>
          </div>
        </div>

        {/* Rights */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { title:"Right to Access", desc:"Download all your personal data", icon:<Download className="h-5 w-5 text-blue-600"/>, action:"Request Export", color:"bg-blue-50 border-blue-200" },
            { title:"Right to Erasure", desc:"Request deletion of your account and data", icon:<Trash2 className="h-5 w-5 text-red-600"/>, action:"Request Deletion", color:"bg-red-50 border-red-200" },
            { title:"Right to Portability", desc:"Export data in machine-readable format", icon:<Eye className="h-5 w-5 text-emerald-600"/>, action:"Export JSON", color:"bg-emer
