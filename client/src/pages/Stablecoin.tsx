import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Coins, ArrowRightLeft, TrendingUp, Send, Download, History, Zap, Shield,
  Banknote, CreditCard, RefreshCw, AlertTriangle, ArrowUpDown, Globe, Receipt,
  CalendarClock, Link2, Wallet
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const STABLECOINS = ["USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"] as const;
const FIATS = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF"] as const;
const CHAINS = ["ethereum", "polygon", "bsc", "solana", "tron", "arbitrum", "optimism", "base", "avalanche"] as const;
type Stablecoin = (typeof STABLECOINS)[number];
type Chain = (typeof CHAINS)[number];
const BILLERS = ["electricity", "water", "internet", "rent", "phone", "insurance", "tax"];

const STABLECOIN_INFO: Record<string, { name: string; apy: number; networks: string[]; color: string }> = {
  USDT: { name: "Tether USD", apy: 4.2, networks: ["Ethereum", "BSC", "Polygon", "Tron"], color: "text-emerald-500" },
  USDC: { name: "USD Coin", apy: 4.5, networks: ["Ethereum", "Polygon", "Solana", "Avalanche"], color: "text-blue-500" },
  BUSD: { name: "Binance USD", apy: 3.5, networks: ["BSC", "Ethereum"], color: "text-yellow-500" },
  DAI:  { name: "Dai Stablecoin", apy: 3.8, networks: ["Ethereum", "Polygon", "Optimism"], color: "text-orange-500" },
  NGNT: { name: "Nigerian Naira Token", apy: 0, networks: ["Ethereum"], color: "text-green-500" },
  cUSD: { name: "Celo Dollar", apy: 0, networks: ["Celo"], color: "text-teal-500" },
  PYUSD: { name: "PayPal USD", apy: 4.0, networks: ["Ethereum"], color: "text-indigo-500" },
};

export default function Stablecoin() {
  const { t } = useTranslation();
  const { data: balances } = trpc.stablecoin.balances.useQuery();
  const { data: yieldRates } = trpc.stablecoinPlatform.yieldRates.useQuery();
  const { data: priceStatus } = trpc.stablecoinPlatform.priceStatus.useQuery();
  const { data: dcaPlans } = trpc.stablecoinPlatform.listDcaPlans.useQuery();
  const { data: virtualCardsData } = trpc.stablecoinPlatform.listVirtualCards.useQuery();
  const virtualCards = virtualCardsData && "cards" in virtualCardsData ? virtualCardsData.cards : (virtualCardsData ?? []) as any[];
  const { data: txHistory } = trpc.transactions.list.useQuery({ limit: 20 });

  const swapMutation = trpc.stablecoin.swap.useMutation({
    onSuccess: (d: any) => toast.success(`Swapped! Tx: ${d.txHash?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const buyMutation = trpc.stablecoinPlatform.buyWithFiat.useMutation({
    onSuccess: (d: any) => toast.success(`On-ramp complete! Operation: ${d.operationId?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const sellMutation = trpc.stablecoinPlatform.sellToFiat.useMutation({
    onSuccess: (d: any) => toast.success(`Off-ramp complete! Operation: ${d.operationId?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const withdrawMutation = trpc.stablecoinPlatform.withdrawToBank.useMutation({
    onSuccess: (d: any) => toast.success(`Withdrawal initiated! Operation: ${d.operationId?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const stakeMutation = trpc.stablecoinPlatform.stakeForYield.useMutation({
    onSuccess: () => toast.success("Staked successfully!"),
    onError: (e: any) => toast.error(e.message),
  });
  const unstakeMutation = trpc.stablecoinPlatform.unstake.useMutation({
    onSuccess: () => toast.success("Unstaked successfully!"),
    onError: (e: any) => toast.error(e.message),
  });
  const bridgeMutation = trpc.stablecoinPlatform.bridgeChain.useMutation({
    onSuccess: (d: any) => toast.success(`Bridge initiated! Tx: ${d.txHash?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const sendMutation = trpc.stablecoin.send.useMutation({
    onSuccess: (d: any) => { toast.success(`Sent! Tx: ${d.txHash?.slice(0, 12)}...`); setSendAddr(""); setSendAmount(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const sendContactMutation = trpc.stablecoinPlatform.sendToContact.useMutation({
    onSuccess: (d: any) => toast.success(d.claimLink ? `Claim link: ${d.claimLink}` : "Sent to contact!"),
    onError: (e: any) => toast.error(e.message),
  });
  const billMutation = trpc.stablecoinPlatform.payBill.useMutation({
    onSuccess: (d: any) => toast.success(`Bill paid! Ref: ${d.paymentRef?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const dcaMutation = trpc.stablecoinPlatform.createDcaPlan.useMutation({
    onSuccess: () => toast.success("DCA plan created!"),
    onError: (e: any) => toast.error(e.message),
  });
  const cardMutation = trpc.stablecoinPlatform.createVirtualCard.useMutation({
    onSuccess: (d: any) => toast.success(`Card created: ****${d.last4}`),
    onError: (e: any) => toast.error(e.message),
  });

  // Form state
  const [from, setFrom] = useState<Stablecoin>("USDT");
  const [to, setTo] = useState<Stablecoin>("USDC");
  const [amount, setAmount] = useState("");
  const [sendAddr, setSendAddr] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendSymbol, setSendSymbol] = useState<Stablecoin>("USDT");
  // On-ramp
  const [buyFiat, setBuyFiat] = useState("USD");
  const [buyStable, setBuyStable] = useState<Stablecoin>("USDC");
  const [buyAmount, setBuyAmount] = useState("");
  // Off-ramp
  const [sellStable, setSellStable] = useState<Stablecoin>("USDC");
  const [sellFiat, setSellFiat] = useState("USD");
  const [sellAmount, setSellAmount] = useState("");
  // Withdraw
  const [wdStable, setWdStable] = useState<Stablecoin>("USDC");
  const [wdAmount, setWdAmount] = useState("");
  const [wdBankAcct, setWdBankAcct] = useState("");
  const [wdBankCode, setWdBankCode] = useState("");
  // Yield
  const [stakeSymbol, setStakeSymbol] = useState<Stablecoin>("USDC");
  const [stakeAmount, setStakeAmount] = useState("");
  // Bridge
  const [bridgeSymbol, setBridgeSymbol] = useState<Stablecoin>("USDC");
  const [bridgeFrom, setBridgeFrom] = useState<Chain>("ethereum");
  const [bridgeTo, setBridgeTo] = useState<Chain>("polygon");
  const [bridgeAmount, setBridgeAmount] = useState("");
  // P2P
  const [p2pContact, setP2pContact] = useState("");
  const [p2pStable, setP2pStable] = useState<Stablecoin>("USDC");
  const [p2pAmount, setP2pAmount] = useState("");
  // Bill
  const [billBiller, setBillBiller] = useState("electricity");
  const [billAcct, setBillAcct] = useState("");
  const [billStable, setBillStable] = useState<Stablecoin>("USDC");
  const [billAmount, setBillAmount] = useState("");
  // DCA
  const [dcaStable, setDcaStable] = useState<Stablecoin>("USDC");
  const [dcaFiat, setDcaFiat] = useState("USD");
  const [dcaAmount, setDcaAmount] = useState("");
  const [dcaFreq, setDcaFreq] = useState<"daily" | "weekly" | "biweekly" | "monthly">("weekly");
  // Card
  const [cardStable, setCardStable] = useState<Stablecoin>("USDC");
  const [cardLimit, setCardLimit] = useState("1000");
  const [cardNetwork, setCardNetwork] = useState<"visa" | "mastercard">("visa");

  const totalUSD = (balances ?? []).reduce((s: number, b: any) => s + (b.balance ?? 0), 0);
  const stablecoinHistory = (txHistory ?? []).filter((t: any) =>
    STABLECOINS.includes(t.fromCurrency ?? "") || STABLECOINS.includes(t.toCurrency ?? "")
  );

  const depegAlerts = priceStatus && "prices" in priceStatus
    ? Object.entries(priceStatus.prices).filter(([, p]) => (p as any).depegged).map(([sym, p]) => ({ symbol: sym, ...(p as any) }))
    : [];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center"><Coins className="h-5 w-5 text-teal-600" /></div>
          <div>
            <h1 className="text-2xl font-bold">Stablecoins</h1>
            <p className="text-muted-foreground text-sm">On-ramp, off-ramp, yield, bridge, DCA, virtual card & more</p>
          </div>
        </div>

        {/* De-Peg Alert Banner */}
        {depegAlerts.length > 0 && (
          <Card className="border-red-500/50 bg-red-500/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-sm text-red-400">De-Peg Alert</div>
                {depegAlerts.map((a: any) => (
                  <div key={a.symbol} className="text-xs text-muted-foreground mt-1">
                    {a.symbol} at ${a.price?.toFixed(4)} — {((1 - a.price) * 100).toFixed(2)}% deviation
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Portfolio Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Total Balance</div>
              <div className="text-2xl font-bold">${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </CardContent>
          </Card>
          <Card className="bg-emerald-500/5 border-emerald-500/20">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Active DCA Plans</div>
              <div className="text-2xl font-bold text-emerald-500">{(dcaPlans ?? []).filter((p: any) => p.status === "active").length}</div>
            </CardContent>
          </Card>
          <Card className="bg-blue-500/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Virtual Cards</div>
              <div className="text-2xl font-bold text-blue-500">{(virtualCards ?? []).length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Balances */}
        <div className="grid gap-3 sm:grid-cols-2">
          {(balances ?? []).map((b: any) => {
            const info = STABLECOIN_INFO[b.symbol] ?? { name: b.symbol, apy: 0, networks: ["Multi-chain"], color: "text-foreground" };
            return (
              <Card key={b.symbol}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`font-bold text-lg ${info.color}`}>{b.symbol}</div>
                    <Badge variant="outline" className="text-xs">{info.networks[0]}</Badge>
                  </div>
                  <div className="text-2xl font-bold mb-1">{(b.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className="text-xs text-muted-foreground mb-2">{info.name}</div>
                  {info.apy > 0 && (
                    <div className="flex items-center gap-1 text-xs text-emerald-500"><TrendingUp className="h-3 w-3" />{info.apy}% APY</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Feature Tabs */}
        <Tabs defaultValue="onramp">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent">
            <TabsTrigger value="onramp" className="text-xs"><Download className="h-3 w-3 mr-1" />On-Ramp</TabsTrigger>
            <TabsTrigger value="offramp" className="text-xs"><Banknote className="h-3 w-3 mr-1" />Off-Ramp</TabsTrigger>
            <TabsTrigger value="swap" className="text-xs"><ArrowRightLeft className="h-3 w-3 mr-1" />Swap</TabsTrigger>
            <TabsTrigger value="send" className="text-xs"><Send className="h-3 w-3 mr-1" />Send</TabsTrigger>
            <TabsTrigger value="yield" className="text-xs"><Zap className="h-3 w-3 mr-1" />Yield</TabsTrigger>
            <TabsTrigger value="bridge" className="text-xs"><Globe className="h-3 w-3 mr-1" />Bridge</TabsTrigger>
            <TabsTrigger value="dca" className="text-xs"><CalendarClock className="h-3 w-3 mr-1" />DCA</TabsTrigger>
            <TabsTrigger value="card" className="text-xs"><CreditCard className="h-3 w-3 mr-1" />Card</TabsTrigger>
            <TabsTrigger value="bill" className="text-xs"><Receipt className="h-3 w-3 mr-1" />Bill Pay</TabsTrigger>
            <TabsTrigger value="p2p" className="text-xs"><Link2 className="h-3 w-3 mr-1" />P2P</TabsTrigger>
            <TabsTrigger value="history" className="text-xs"><History className="h-3 w-3 mr-1" />History</TabsTrigger>
          </TabsList>

          {/* On-Ramp (Fiat → Stablecoin) */}
          <TabsContent value="onramp">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Buy Stablecoin with Fiat</CardTitle></CardHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Fiat Currency</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={buyFiat} onChange={e => setBuyFiat(e.target.value)}>
                    {FIATS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Stablecoin</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={buyStable} onChange={e => setBuyStable(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Input type="number" placeholder={`Amount in ${buyFiat}`} value={buyAmount} onChange={e => setBuyAmount(e.target.value)} />
              {buyAmount && parseFloat(buyAmount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.5%)</span><span>{(parseFloat(buyAmount) * 0.005).toFixed(2)} {buyFiat}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>Circle / Yellow Card</span></div>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded-lg">
                <Shield className="h-3.5 w-3.5 text-blue-400" />
                Compliance pipeline: KYC, AML, sanctions screening on every on-ramp
              </div>
              <Button className="w-full" disabled={!buyAmount || buyMutation.isPending}
                onClick={() => buyMutation.mutate({ fiatCurrency: buyFiat, stablecoin: buyStable, fiatAmount: parseFloat(buyAmount) })}>
                <Download className="h-4 w-4 mr-2" />{buyMutation.isPending ? "Processing..." : `Buy ${buyStable} with ${buyFiat}`}
              </Button>
            </CardContent></Card>
          </TabsContent>

          {/* Off-Ramp (Stablecoin → Fiat) */}
          <TabsContent value="offramp">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Sell Stablecoin to Fiat</CardTitle></CardHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Stablecoin</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={sellStable} onChange={e => setSellStable(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Fiat Currency</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={sellFiat} onChange={e => setSellFiat(e.target.value)}>
                    {FIATS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <Input type="number" placeholder={`Amount in ${sellStable}`} value={sellAmount} onChange={e => setSellAmount(e.target.value)} />
              {sellAmount && parseFloat(sellAmount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.75%)</span><span>{(parseFloat(sellAmount) * 0.0075).toFixed(4)} {sellStable}</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!sellAmount || sellMutation.isPending}
                onClick={() => sellMutation.mutate({ stablecoin: sellStable, fiatCurrency: sellFiat, stablecoinAmount: parseFloat(sellAmount) })}>
                <Banknote className="h-4 w-4 mr-2" />{sellMutation.isPending ? "Processing..." : `Sell ${sellStable} → ${sellFiat}`}
              </Button>
              <div className="border-t pt-4 mt-2">
                <CardHeader className="p-0 mb-3"><CardTitle className="text-base">Withdraw to Bank</CardTitle></CardHeader>
                <div className="space-y-3">
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={wdStable} onChange={e => setWdStable(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <Input type="number" placeholder="Amount" value={wdAmount} onChange={e => setWdAmount(e.target.value)} />
                  <Input placeholder="Bank account number" value={wdBankAcct} onChange={e => setWdBankAcct(e.target.value)} />
                  <Input placeholder="Bank code / routing number" value={wdBankCode} onChange={e => setWdBankCode(e.target.value)} />
                  <Button className="w-full" variant="outline" disabled={!wdAmount || !wdBankAcct || withdrawMutation.isPending}
                    onClick={() => withdrawMutation.mutate({ stablecoin: wdStable, stablecoinAmount: parseFloat(wdAmount), fiatCurrency: sellFiat, bankName: "Bank", accountNumber: wdBankAcct, accountHolderName: "Account Holder", routingNumber: wdBankCode })}>
                    <Wallet className="h-4 w-4 mr-2" />{withdrawMutation.isPending ? "Processing..." : "Withdraw to Bank"}
                  </Button>
                </div>
              </div>
            </CardContent></Card>
          </TabsContent>

          {/* Swap */}
          <TabsContent value="swap">
            <Card><CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium">From</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={from} onChange={e => setFrom(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <Button variant="ghost" size="icon" className="mt-5" onClick={() => { const t = from; setFrom(to); setTo(t); }}>
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium">To</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={to} onChange={e => setTo(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Input type="number" placeholder="Amount to swap" value={amount} onChange={e => setAmount(e.target.value)} />
              {amount && parseFloat(amount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">You receive</span><span className="font-semibold">{(parseFloat(amount) * 0.998).toFixed(4)} {to}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.2%)</span><span>{(parseFloat(amount) * 0.002).toFixed(4)} {from}</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!amount || from === to || swapMutation.isPending}
                onClick={() => swapMutation.mutate({ from, to, amount: parseFloat(amount) })}>
                {swapMutation.isPending ? "Swapping..." : `Swap ${from} → ${to}`}
              </Button>
            </CardContent></Card>
          </TabsContent>

          {/* Send */}
          <TabsContent value="send">
            <Card><CardContent className="p-4 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium">Token</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={sendSymbol} onChange={e => setSendSymbol(e.target.value as Stablecoin)}>
                  {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Input placeholder="Recipient wallet address (0x...)" value={sendAddr} onChange={e => setSendAddr(e.target.value)} />
              <Input type="number" placeholder="Amount" value={sendAmount} onChange={e => setSendAmount(e.target.value)} />
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded-lg">
                <Shield className="h-3.5 w-3.5 text-blue-400" />
                Address validated against sanctions lists before transfer
              </div>
              <Button className="w-full" disabled={!sendAddr || !sendAmount || sendMutation.isPending}
                onClick={() => sendMutation.mutate({ symbol: sendSymbol, toAddress: sendAddr, amount: parseFloat(sendAmount) })}>
                <Send className="h-4 w-4 mr-2" />{sendMutation.isPending ? "Sending..." : `Send ${sendSymbol}`}
              </Button>
            </CardContent></Card>
          </TabsContent>

          {/* Yield */}
          <TabsContent value="yield">
            <Card><CardContent className="p-4 space-y-4">
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                <div className="font-semibold text-sm mb-1">DeFi Yield Opportunities</div>
                <div className="text-xs text-muted-foreground">Stake stablecoins in vetted DeFi protocols for yield. Yields are compounded and credited to your wallet.</div>
              </div>
              {Object.entries(STABLECOIN_INFO).filter(([_, v]) => v.apy > 0).map(([sym, info]) => (
                <div key={sym} className="flex items-center justify-between p-3 border rounded-xl">
                  <div>
                    <div className="font-medium text-sm">{sym}</div>
                    <div className="text-xs text-muted-foreground">{info.apy}% APY</div>
                  </div>
                  <Badge variant="outline" className="text-xs text-emerald-500">{info.apy}%</Badge>
                </div>
              ))}
              <div className="border-t pt-4 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Stablecoin</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={stakeSymbol} onChange={e => setStakeSymbol(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Amount</label>
                  <Input type="number" placeholder="Amount" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1" disabled={!stakeAmount || stakeMutation.isPending}
                  onClick={() => stakeMutation.mutate({ stablecoin: stakeSymbol, amount: parseFloat(stakeAmount) })}>
                  {stakeMutation.isPending ? "Staking..." : "Stake"}
                </Button>
                <Button className="flex-1" variant="outline" disabled={!stakeAmount || unstakeMutation.isPending}
                  onClick={() => unstakeMutation.mutate({ stablecoin: stakeSymbol, amount: parseFloat(stakeAmount) })}>
                  {unstakeMutation.isPending ? "Unstaking..." : "Unstake"}
                </Button>
              </div>
            </CardContent></Card>
          </TabsContent>

          {/* Bridge */}
          <TabsContent value="bridge">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Cross-Chain Bridge</CardTitle></CardHeader>
              <div className="space-y-1">
                <label className="text-xs font-medium">Stablecoin</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={bridgeSymbol} onChange={e => setBridgeSymbol(e.target.value as Stablecoin)}>
                  {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">From Chain</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={bridgeFrom} onChange={e => setBridgeFrom(e.target.value as Chain)}>
                    {CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">To Chain</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={bridgeTo} onChange={e => setBridgeTo(e.target.value as Chain)}>
                    {CHAINS.filter(c => c !== bridgeFrom).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <Input type="number" placeholder="Amount" value={bridgeAmount} onChange={e => setBridgeAmount(e.target.value)} />
              {bridgeAmount && parseFloat(bridgeAmount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Bridge fee (0.1% + gas)</span><span>{(parseFloat(bridgeAmount) * 0.001).toFixed(4)} {bridgeSymbol}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Route</span><span>Across / Stargate</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!bridgeAmount || bridgeFrom === bridgeTo || bridgeMutation.isPending}
                onClick={() => bridgeMutation.mutate({ stablecoin: bridgeSymbol, fromChain: bridgeFrom, toChain: bridgeTo, amount: parseFloat(bridgeAmount) })}>
                <Globe className="h-4 w-4 mr-2" />{bridgeMutation.isPending ? "Bridging..." : `Bridge ${bridgeSymbol}`}
              </Button>
            </CardContent></Card>
          </TabsContent>

          {/* DCA */}
          <TabsContent value="dca">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Dollar-Cost Averaging</CardTitle></CardHeader>
              <div className="text-xs text-muted-foreground">Automatically buy stablecoins on a schedule to average your entry cost.</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Fiat</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={dcaFiat} onChange={e => setDcaFiat(e.target.value)}>
                    {FIATS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Target Stablecoin</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={dcaStable} onChange={e => setDcaStable(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Input type="number" placeholder={`Amount per buy (${dcaFiat})`} value={dcaAmount} onChange={e => setDcaAmount(e.target.value)} />
              <div className="space-y-1">
                <label className="text-xs font-medium">Frequency</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={dcaFreq} onChange={e => setDcaFreq(e.target.value as typeof dcaFreq)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 Weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <Button className="w-full" disabled={!dcaAmount || dcaMutation.isPending}
                onClick={() => dcaMutation.mutate({ fiatCurrency: dcaFiat, stablecoin: dcaStable, fiatAmountPerPurchase: parseFloat(dcaAmount), frequency: dcaFreq })}>
                <CalendarClock className="h-4 w-4 mr-2" />{dcaMutation.isPending ? "Creating..." : "Create DCA Plan"}
              </Button>
              {(dcaPlans ?? []).length > 0 && (
                <div className="border-t pt-4 space-y-2">
                  <div className="text-sm font-medium">Active DCA Plans</div>
                  {(dcaPlans ?? []).map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 border rounded-xl text-sm">
                      <div>
                        <div className="font-medium">{p.fiatAmountPerExecution} {p.fiatCurrency} → {p.stablecoin}</div>
                        <div className="text-xs text-muted-foreground">{p.frequency}</div>
                      </div>
                      <Badge variant={p.status === "active" ? "default" : "outline"}>{p.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          {/* Virtual Card */}
          <TabsContent value="card">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Stablecoin Virtual Card</CardTitle></CardHeader>
              <div className="text-xs text-muted-foreground">Create a Visa/Mastercard virtual card funded by your stablecoin balance for online purchases.</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Fund from</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={cardStable} onChange={e => setCardStable(e.target.value as Stablecoin)}>
                    {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Card Network</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={cardNetwork} onChange={e => setCardNetwork(e.target.value as typeof cardNetwork)}>
                    <option value="visa">Visa</option>
                    <option value="mastercard">Mastercard</option>
                  </select>
                </div>
              </div>
              <Input type="number" placeholder="Monthly spend limit (USD)" value={cardLimit} onChange={e => setCardLimit(e.target.value)} />
              <Button className="w-full" disabled={cardMutation.isPending}
                onClick={() => cardMutation.mutate({ stablecoin: cardStable, spendLimitUsd: parseFloat(cardLimit), cardNetwork })}>
                <CreditCard className="h-4 w-4 mr-2" />{cardMutation.isPending ? "Creating..." : "Create Virtual Card"}
              </Button>
              {(virtualCards ?? []).length > 0 && (
                <div className="border-t pt-4 space-y-2">
                  <div className="text-sm font-medium">Your Cards</div>
                  {(virtualCards ?? []).map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 border rounded-xl text-sm">
                      <div>
                        <div className="font-medium">**** **** **** {c.last4}</div>
                        <div className="text-xs text-muted-foreground">{c.network} · ${c.spendLimitUsd} limit</div>
                      </div>
                      <Badge variant={c.status === "active" ? "default" : "outline"}>{c.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          {/* Bill Pay */}
          <TabsContent value="bill">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Pay Bills with Stablecoin</CardTitle></CardHeader>
              <div className="space-y-1">
                <label className="text-xs font-medium">Biller Type</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={billBiller} onChange={e => setBillBiller(e.target.value)}>
                  {BILLERS.map(b => <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>)}
                </select>
              </div>
              <Input placeholder="Account / Reference number" value={billAcct} onChange={e => setBillAcct(e.target.value)} />
              <div className="space-y-1">
                <label className="text-xs font-medium">Pay with</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={billStable} onChange={e => setBillStable(e.target.value as Stablecoin)}>
                  {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Input type="number" placeholder="Amount" value={billAmount} onChange={e => setBillAmount(e.target.value)} />
              {billAmount && parseFloat(billAmount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.25%)</span><span>{(parseFloat(billAmount) * 0.0025).toFixed(4)} {billStable}</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!billAcct || !billAmount || billMutation.isPending}
                onClick={() => billMutation.mutate({ billType: billBiller as any, billerName: billBiller, billerAccountNumber: billAcct, stablecoin: billStable, amount: parseFloat(billAmount) })}>
                <Receipt className="h-4 w-4 mr-2" />{billMutation.isPending ? "Paying..." : "Pay Bill"}
              </Button>
            </CardContent></Card>
          </TabsContent>

          {/* P2P Send */}
          <TabsContent value="p2p">
            <Card><CardContent className="p-4 space-y-4">
              <CardHeader className="p-0"><CardTitle className="text-base">Send to Contact (P2P)</CardTitle></CardHeader>
              <div className="text-xs text-muted-foreground">Send stablecoins to a phone number or email. If they're not on the platform, they'll get a 30-day claim link.</div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Stablecoin</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={p2pStable} onChange={e => setP2pStable(e.target.value as Stablecoin)}>
                  {STABLECOINS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Input placeholder="Email or phone number" value={p2pContact} onChange={e => setP2pContact(e.target.value)} />
              <Input type="number" placeholder="Amount" value={p2pAmount} onChange={e => setP2pAmount(e.target.value)} />
              {p2pAmount && parseFloat(p2pAmount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.2%)</span><span>{(parseFloat(p2pAmount) * 0.002).toFixed(4)} {p2pStable}</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!p2pContact || !p2pAmount || sendContactMutation.isPending}
                onClick={() => {
                  const isEmail = p2pContact.includes("@");
                  sendContactMutation.mutate({
                    stablecoin: p2pStable,
                    amount: parseFloat(p2pAmount),
                    ...(isEmail ? { recipientEmail: p2pContact } : { recipientPhone: p2pContact }),
                  });
                }}>
                <Link2 className="h-4 w-4 mr-2" />{sendContactMutation.isPending ? "Sending..." : "Send to Contact"}
              </Button>
            </CardContent></Card>
          </TabsContent>

          {/* History */}
          <TabsContent value="history">
            <Card><CardContent className="p-4 space-y-3">
              {stablecoinHistory.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">No stablecoin transactions yet</div>
              ) : stablecoinHistory.map((h: any) => (
                <div key={h.id} className="flex items-start justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="font-medium text-sm capitalize">{h.description ?? h.type}</div>
                    <div className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{h.fromAmount} {h.fromCurrency}</div>
                    <Badge className="text-xs bg-green-500/10 text-green-400">{h.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
