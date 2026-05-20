import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Coins, ArrowRightLeft, TrendingUp, Send, Download, History, Zap, Shield } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const STABLECOIN_INFO: Record<string, { name: string; apy: number; networks: string[]; color: string }> = {
  USDT: { name: "Tether USD", apy: 4.2, networks: ["Ethereum", "BSC", "Polygon", "Tron"], color: "text-emerald-500" },
  USDC: { name: "USD Coin", apy: 4.8, networks: ["Ethereum", "Polygon", "Solana", "Avalanche"], color: "text-blue-500" },
  BUSD: { name: "Binance USD", apy: 3.9, networks: ["BSC", "Ethereum"], color: "text-yellow-500" },
  DAI:  { name: "Dai Stablecoin", apy: 5.1, networks: ["Ethereum", "Polygon", "Optimism"], color: "text-orange-500" },
  NGNT: { name: "Nigerian Naira Token", apy: 8.5, networks: ["Ethereum"], color: "text-green-500" },
};



export default function Stablecoin() {
  const { t } = useTranslation();
  const { data: balances } = trpc.stablecoin.balances.useQuery();
  const swapMutation = trpc.stablecoin.swap.useMutation({
    onSuccess: (d: any) => toast.success(`Swapped! Tx: ${d.txHash?.slice(0, 12)}...`),
    onError: (e: any) => toast.error(e.message),
  });
  const sendMutation = trpc.stablecoin.send.useMutation({
    onSuccess: (d: any) => { toast.success(`Sent! Tx: ${d.txHash?.slice(0, 12)}...`); setSendAddr(""); setSendAmount(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const [from, setFrom] = useState("USDT");
  const [to, setTo] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [sendAddr, setSendAddr] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendSymbol, setSendSymbol] = useState("USDT");
  const { data: txHistory } = trpc.transactions.list.useQuery({ limit: 20 });
  const stablecoinHistory = (txHistory ?? []).filter((t: any) => ["USDT","USDC","BUSD","DAI","NGNT"].includes(t.fromCurrency ?? "") || ["USDT","USDC","BUSD","DAI","NGNT"].includes(t.toCurrency ?? ""));

  const totalUSD = (balances ?? []).reduce((s: number, b: any) => s + (b.balance ?? 0), 0);
  const estimatedYield = (balances ?? []).reduce((s: number, b: any) => {
    const info = STABLECOIN_INFO[b.symbol];
    return s + (b.balance ?? 0) * (info?.apy ?? 4) / 100 / 12;
  }, 0);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center"><Coins className="h-5 w-5 text-teal-600" /></div>
          <div>
            <h1 className="text-2xl font-bold">Stablecoins</h1>
            <p className="text-muted-foreground text-sm">Multi-chain stablecoin wallet, swaps, and yield</p>
          </div>
        </div>

        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Total Balance</div>
              <div className="text-2xl font-bold">${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-xs text-muted-foreground mt-1">Across {(balances ?? []).length} stablecoins</div>
            </CardContent>
          </Card>
          <Card className="bg-emerald-500/5 border-emerald-500/20">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Est. Monthly Yield</div>
              <div className="text-2xl font-bold text-emerald-500">+${estimatedYield.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground mt-1">Auto-compounded daily</div>
            </CardContent>
          </Card>
        </div>

        {/* Balances */}
        <div className="grid gap-3 sm:grid-cols-2">
          {(balances ?? []).map((b: any) => {
            const info = STABLECOIN_INFO[b.symbol] ?? { name: b.symbol, apy: 4, networks: ["Multi-chain"], color: "text-foreground" };
            return (
              <Card key={b.symbol}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`font-bold text-lg ${info.color}`}>{b.symbol}</div>
                    <Badge variant="outline" className="text-xs">{info.networks[0]}</Badge>
                  </div>
                  <div className="text-2xl font-bold mb-1">{(b.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className="text-xs text-muted-foreground mb-2">{info.name}</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-emerald-500"><TrendingUp className="h-3 w-3" />{info.apy}% APY</div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setSendSymbol(b.symbol); }}><Send className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => toast.info("Deposit address generation requires wallet connection. Please connect your wallet to get your deposit address.")}><Download className="h-3 w-3" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs: Swap / Send / Yield / History */}
        <Tabs defaultValue="swap">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="swap"><ArrowRightLeft className="h-3.5 w-3.5 mr-1" />Swap</TabsTrigger>
            <TabsTrigger value="send"><Send className="h-3.5 w-3.5 mr-1" />Send</TabsTrigger>
            <TabsTrigger value="yield"><Zap className="h-3.5 w-3.5 mr-1" />Yield</TabsTrigger>
            <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
          </TabsList>

          <TabsContent value="swap">
            <Card><CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium">From</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={from} onChange={e => setFrom(e.target.value)}>
                    {(balances ?? []).map((b: any) => <option key={b.symbol} value={b.symbol}>{b.symbol}</option>)}
                  </select>
                </div>
                <Button variant="ghost" size="icon" className="mt-5" onClick={() => { const t = from; setFrom(to); setTo(t); }}>
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium">To</label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={to} onChange={e => setTo(e.target.value)}>
                    {(balances ?? []).map((b: any) => <option key={b.symbol} value={b.symbol}>{b.symbol}</option>)}
                  </select>
                </div>
              </div>
              <Input type="number" placeholder="Amount to swap" value={amount} onChange={e => setAmount(e.target.value)} />
              {amount && parseFloat(amount) > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">You receive</span><span className="font-semibold">{(parseFloat(amount) * 0.998).toFixed(4)} {to}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.2%)</span><span>{(parseFloat(amount) * 0.002).toFixed(4)} {from}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Est. time</span><span>~30 seconds</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!amount || from === to || swapMutation.isPending}
                onClick={() => swapMutation.mutate({ from, to, amount: parseFloat(amount) })}>
                {swapMutation.isPending ? "Swapping..." : `Swap ${from} → ${to}`}
              </Button>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="send">
            <Card><CardContent className="p-4 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium">Token</label>
                <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={sendSymbol} onChange={e => setSendSymbol(e.target.value)}>
                  {(balances ?? []).map((b: any) => <option key={b.symbol} value={b.symbol}>{b.symbol}</option>)}
                </select>
              </div>
              <Input placeholder="Recipient wallet address (0x...)" value={sendAddr} onChange={e => setSendAddr(e.target.value)} />
              <Input type="number" placeholder="Amount" value={sendAmount} onChange={e => setSendAmount(e.target.value)} />
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded-lg">
                <Shield className="h-3.5 w-3.5 text-blue-400" />
                Address is validated against sanctions lists before transfer
              </div>
              <Button className="w-full" disabled={!sendAddr || !sendAmount || sendMutation.isPending} onClick={() => sendMutation.mutate({ symbol: sendSymbol, toAddress: sendAddr, amount: parseFloat(sendAmount) })}>
                <Send className="h-4 w-4 mr-2" />{sendMutation.isPending ? "Sending…" : `Send ${sendSymbol}`}
              </Button>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="yield">
            <Card><CardContent className="p-4 space-y-4">
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                <div className="font-semibold text-sm mb-1">Auto-Yield is Active</div>
                <div className="text-xs text-muted-foreground">Your stablecoin balances are automatically earning yield through DeFi lending protocols. Yields are compounded daily and credited to your wallet.</div>
              </div>
              {(balances ?? []).map((b: any) => {
                const info = STABLECOIN_INFO[b.symbol] ?? { apy: 4 };
                const monthlyYield = (b.balance ?? 0) * info.apy / 100 / 12;
                return (
                  <div key={b.symbol} className="flex items-center justify-between p-3 border rounded-xl">
                    <div>
                      <div className="font-medium text-sm">{b.symbol}</div>
                      <div className="text-xs text-muted-foreground">{info.apy}% APY · Daily compounding</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm text-emerald-500">+${monthlyYield.toFixed(2)}/mo</div>
                      <div className="text-xs text-muted-foreground">est. monthly</div>
                    </div>
                  </div>
                );
              })}
            </CardContent></Card>
          </TabsContent>

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
              {stablecoinHistory.length > 0 && (
                <div className="text-xs text-muted-foreground text-center pt-2">Showing last {stablecoinHistory.length} stablecoin transactions</div>
              )}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
