import { useState, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import PriceChart from "@/components/PriceChart";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Wallet, Star, StarOff, BarChart3, Brain,
  DollarSign, Activity, Globe, Shield, RefreshCw, ChevronRight,
  Bitcoin, Gem, Leaf, Building2, ArrowUpRight, ArrowDownRight, Info,
  Calculator, PieChart, Zap,
} from "lucide-react";
import { useTranslation } from 'react-i18next';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ASSET_TYPE_ICONS: Record<string, React.ReactNode> = {
  stock: <Building2 className="h-4 w-4" />,
  etf: <PieChart className="h-4 w-4" />,
  commodity: <Gem className="h-4 w-4" />,
  crypto: <Bitcoin className="h-4 w-4" />,
  mining_share: <Leaf className="h-4 w-4" />,
  real_estate: <Building2 className="h-4 w-4" />,
  bond: <Shield className="h-4 w-4" />,
  index_fund: <BarChart3 className="h-4 w-4" />,
};

const ASSET_TYPE_COLORS: Record<string, string> = {
  stock: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  etf: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  commodity: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  crypto: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  mining_share: "bg-green-500/10 text-green-400 border-green-500/20",
  real_estate: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  bond: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  index_fund: "bg-teal-500/10 text-teal-400 border-teal-500/20",
};

function formatCurrency(v: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function PnlBadge({ value, pct }: { value: number; pct: number }) {
  const isPos = value >= 0;
  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${isPos ? "text-emerald-400" : "text-red-400"}`}>
      {isPos ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {formatCurrency(Math.abs(value))} ({Math.abs(pct).toFixed(2)}%)
    </span>
  );
}

// ─── Buy Dialog (Stripe Checkout two-step) ───────────────────────────────────

function BuyDialog({ asset, open, onClose }: { asset: any; open: boolean; onClose: () => void }) {
  const [qty, setQty] = useState("1");
  const [step, setStep] = useState<"configure" | "confirm">("configure");
  const utils = trpc.useUtils();

  // Stripe checkout — opens Stripe in new tab
  const checkout = trpc.investment.createInvestmentCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.success("Redirecting to Stripe", { description: `Secure checkout for ${data.symbol}` });
        window.open(data.checkoutUrl, "_blank");
        utils.investment.getPortfolio.invalidate();
        handleClose();
      }
    },
    onError: (e) => toast.error("Checkout Failed", { description: e.message }),
  });

  // Demo/fallback direct buy (no payment)
  const buy = trpc.investment.buyAsset.useMutation({
    onSuccess: (data) => {
      toast.success("Demo Purchase Recorded", { description: `Bought ${data.quantity} ${data.symbol} for ${formatCurrency(data.total)}` });
      utils.investment.getPortfolio.invalidate();
      utils.investment.getWatchlist.invalidate();
      handleClose();
    },
    onError: (e) => toast.error("Purchase Failed", { description: e.message }),
  });

  const price = Number(asset?.currentPrice ?? 0);
  const quantity = parseFloat(qty) || 0;
  const subtotal = price * quantity;
  const fee = subtotal * 0.001;
  const total = subtotal + fee;

  function handleClose() {
    setStep("configure");
    setQty("1");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ASSET_TYPE_ICONS[asset?.assetType ?? "stock"]}
            {step === "configure" ? `Buy ${asset?.symbol}` : "Confirm & Pay"}
          </DialogTitle>
          <DialogDescription className="text-slate-400">{asset?.name}</DialogDescription>
        </DialogHeader>

        {step === "configure" ? (
          <div className="space-y-4 py-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Current Price</span>
              <span className="font-semibold text-emerald-400">{formatCurrency(price)}</span>
            </div>
            <div>
              <Label className="text-slate-300">Quantity</Label>
              <Input
                type="number" min="0.001" step="0.001" value={qty}
                onChange={e => setQty(e.target.value)}
                className="mt-1 bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="rounded-lg bg-slate-800 p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Platform Fee (0.1%)</span>
                <span>{formatCurrency(fee)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-slate-700 pt-1 mt-1">
                <span>Total</span>
                <span className="text-emerald-400">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-slate-800 border border-emerald-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Asset</span>
                <span className="font-semibold">{asset?.name} ({asset?.symbol})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Quantity</span>
                <span className="font-semibold">{quantity}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Price per unit</span>
                <span className="font-semibold">{formatCurrency(price)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Platform Fee (0.1%)</span>
                <span className="text-slate-300">{formatCurrency(fee)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-700 pt-2">
                <span className="font-semibold">Total Charge</span>
                <span className="text-xl font-bold text-emerald-400">{formatCurrency(total)}</span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-300">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>You will be redirected to Stripe's secure checkout. Test card: <strong>4242 4242 4242 4242</strong>, any future date, any CVC.</span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "configure" ? (
            <>
              <Button variant="outline" onClick={handleClose} className="border-slate-600">Cancel</Button>
              <Button
                onClick={() => quantity > 0 && setStep("confirm")}
                disabled={quantity <= 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                Review Order
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("configure")} className="border-slate-600">Back</Button>
              <Button
                variant="outline"
                onClick={() => buy.mutate({ assetId: asset.id, quantity })}
                disabled={buy.isPending || checkout.isPending}
                className="border-slate-500 text-slate-300"
              >
                {buy.isPending ? "Processing..." : "Demo Buy"}
              </Button>
              <Button
                onClick={() => checkout.mutate({ assetId: asset.id, quantity, origin: window.location.origin })}
                disabled={checkout.isPending || buy.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {checkout.isPending ? "Opening Stripe..." : "Pay with Stripe"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DCA Calculator ───────────────────────────────────────────────────────────

function DcaCalculator() {
  const [monthly, setMonthly] = useState("100");
  const [price, setPrice] = useState("50000");
  const [months, setMonths] = useState("24");
  const [annualReturn, setAnnualReturn] = useState("10");
  const dca = trpc.investment.dcaProjection.useMutation({
    onError: (e) => toast.error("Calculation failed", { description: e.message }),
  });

  const handleCalculate = () => {
    dca.mutate({
      monthlyAmount: parseFloat(monthly) || 100,
      currentPrice: parseFloat(price) || 50000,
      months: parseInt(months) || 24,
      expectedAnnualReturn: parseFloat(annualReturn) || 10,
    });
  };

  const result = dca.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-slate-300">Monthly Investment (USD)</Label>
          <Input value={monthly} onChange={e => setMonthly(e.target.value)} className="mt-1 bg-slate-800 border-slate-600 text-white" type="number" />
        </div>
        <div>
          <Label className="text-slate-300">Current Asset Price (USD)</Label>
          <Input value={price} onChange={e => setPrice(e.target.value)} className="mt-1 bg-slate-800 border-slate-600 text-white" type="number" />
        </div>
        <div>
          <Label className="text-slate-300">Duration (months)</Label>
          <Input value={months} onChange={e => setMonths(e.target.value)} className="mt-1 bg-slate-800 border-slate-600 text-white" type="number" min="1" max="360" />
        </div>
        <div>
          <Label className="text-slate-300">Expected Annual Return (%)</Label>
          <Input value={annualReturn} onChange={e => setAnnualReturn(e.target.value)} className="mt-1 bg-slate-800 border-slate-600 text-white" type="number" />
        </div>
      </div>
      <Button onClick={handleCalculate} disabled={dca.isPending} className="w-full bg-violet-600 hover:bg-violet-700">
        <Calculator className="h-4 w-4 mr-2" />
        {dca.isPending ? "Calculating..." : "Calculate DCA Projection"}
      </Button>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Total Invested", value: formatCurrency(result.total_invested), color: "text-blue-400" },
              { label: "Projected Value", value: formatCurrency(result.projected_value), color: "text-emerald-400" },
              { label: "Projected Gain", value: formatCurrency(result.projected_gain), color: "text-yellow-400" },
              { label: "Return", value: `${result.projected_gain_pct.toFixed(1)}%`, color: "text-purple-400" },
            ].map(s => (
              <div key={s.label} className="rounded-lg bg-slate-800 p-3">
                <p className="text-xs text-slate-400">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-slate-800 p-3 max-h-48 overflow-y-auto">
            <p className="text-xs text-slate-400 mb-2">Monthly Projections</p>
            <div className="space-y-1">
              {result.projections.filter((_, i) => i % 3 === 2).map(p => (
                <div key={p.month} className="flex justify-between text-xs">
                  <span className="text-slate-400">Month {p.month}</span>
                  <span className="text-white">{formatCurrency(p.portfolio_value)}</span>
                  <span className="text-slate-500">{p.units_held.toFixed(4)} units</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
import DashboardLayout from "@/components/DashboardLayout";

export default function BeyondRemittance() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("markets");
  const [search, setSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [buyAsset, setBuyAsset] = useState<any>(null);
  const [sellId, setSellId] = useState<number | null>(null);
  const [chartAsset, setChartAsset] = useState<any>(null);

  // Data queries — assets refresh every 30 seconds for live prices
  const { data: assets = [], isLoading: assetsLoading } = trpc.investment.listAssets.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const { data: portfolio } = trpc.investment.getPortfolio.useQuery(undefined, { enabled: !!user, refetchInterval: 60_000 });
  const { data: portfolioHistoryData } = trpc.investment.portfolioHistory.useQuery({ days: 90 }, { enabled: !!user });
  const portfolioHistory = portfolioHistoryData?.dataPoints ?? [];
  const { data: watchlist = [] } = trpc.investment.getWatchlist.useQuery(undefined, { enabled: !!user });
  const { data: recommendations } = trpc.investment.getRecommendations.useQuery({ riskTolerance: "moderate", horizon: "medium", monthlyBudget: 200 }, { enabled: !!user });
  const { data: analysis } = trpc.investment.analyzePortfolio.useQuery(undefined, { enabled: !!user });
  const { data: orderHistory = [] } = trpc.investment.getOrderHistory.useQuery(undefined, { enabled: !!user });

  // Sentiment for featured symbols
  const featuredSymbols = useMemo(() => assets.filter(a => a.isFeatured).map(a => a.symbol).slice(0, 6), [assets]);
  const { data: sentiment } = trpc.investment.getSentiment.useQuery(
    { symbols: featuredSymbols.length > 0 ? featuredSymbols : ["BTC", "ETH", "AAPL"] },
    { enabled: featuredSymbols.length > 0 }
  );

  // Mutations
  const addWatch = trpc.investment.addToWatchlist.useMutation({
    onSuccess: () => { toast.success("Added to Watchlist"); utils.investment.getWatchlist.invalidate(); },
  });
  const removeWatch = trpc.investment.removeFromWatchlist.useMutation({
    onSuccess: () => { toast.success("Removed from Watchlist"); utils.investment.getWatchlist.invalidate(); },
  });
  const sell = trpc.investment.sellAsset.useMutation({
    onSuccess: (d) => {
      toast.success("Sold Successfully", { description: `Sold ${d.symbol} for ${formatCurrency(d.total ?? 0)}` });
      utils.investment.getPortfolio.invalidate();
      setSellId(null);
    },
    onError: (e) => toast.error("Sell Failed", { description: e.message }),
  });

  const watchlistAssetIds = new Set(watchlist.map((w: any) => w.asset.id));

  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      if (assetTypeFilter !== "all" && a.assetType !== assetTypeFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!a.symbol.toLowerCase().includes(s) && !a.name.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [assets, assetTypeFilter, search]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-900/40 via-slate-900 to-emerald-900/30 border-b border-slate-800 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-violet-500/20 border border-violet-500/30">
              <TrendingUp className="h-6 w-6 text-violet-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Beyond Remittance</h1>
              <p className="text-slate-400 text-sm">Invest in stocks, crypto, commodities & mining — grow your diaspora wealth</p>
            </div>
          </div>
          {/* Portfolio summary bar */}
          {portfolio && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Portfolio Value", value: formatCurrency(portfolio.totalValue), icon: <Wallet className="h-4 w-4" />, color: "text-emerald-400" },
                { label: "Total Invested", value: formatCurrency(portfolio.totalCost), icon: <DollarSign className="h-4 w-4" />, color: "text-blue-400" },
                { label: "Unrealized P&L", value: formatCurrency(portfolio.totalPnl), icon: <TrendingUp className="h-4 w-4" />, color: portfolio.totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
                { label: "Return", value: `${Number(portfolio.totalPnlPct).toFixed(2)}%`, icon: <Activity className="h-4 w-4" />, color: portfolio.totalPnlPct >= 0 ? "text-emerald-400" : "text-red-400" },
              ].map(s => (
                <div key={s.label} className="rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2 flex items-center gap-2">
                  <span className={s.color}>{s.icon}</span>
                  <div>
                    <p className="text-xs text-slate-400">{s.label}</p>
                    <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-slate-800 border border-slate-700 mb-6">
            <TabsTrigger value="markets" className="data-[state=active]:bg-violet-600">
              <Globe className="h-4 w-4 mr-1" /> Markets
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="data-[state=active]:bg-violet-600">
              <Wallet className="h-4 w-4 mr-1" /> Portfolio
            </TabsTrigger>
            <TabsTrigger value="watchlist" className="data-[state=active]:bg-violet-600">
              <Star className="h-4 w-4 mr-1" /> Watchlist
            </TabsTrigger>
            <TabsTrigger value="ai" className="data-[state=active]:bg-violet-600">
              <Brain className="h-4 w-4 mr-1" /> AI Insights
            </TabsTrigger>
            <TabsTrigger value="dca" className="data-[state=active]:bg-violet-600">
              <Calculator className="h-4 w-4 mr-1" /> DCA Calc
            </TabsTrigger>
          </TabsList>

          {/* ── Markets Tab ── */}
          <TabsContent value="markets">
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <Input
                placeholder="Search assets..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white max-w-xs"
              />
              <Select value={assetTypeFilter} onValueChange={setAssetTypeFilter}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-44">
                  <SelectValue placeholder="Asset Type" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 text-white">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="stock">Stocks</SelectItem>
                  <SelectItem value="etf">ETFs</SelectItem>
                  <SelectItem value="commodity">Commodities</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="mining_share">Mining</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => utils.investment.listAssets.invalidate()} className="border-slate-600">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {assetsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-36 rounded-xl bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No assets found. Seed data may be loading.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAssets.map(asset => {
                  const price = Number(asset.currentPrice ?? 0);
                  const change = Number(asset.priceChange24h ?? 0);
                  const changePct = Number(asset.priceChangePct24h ?? 0);
                  const isWatched = watchlistAssetIds.has(asset.id);
                  const sentData = sentiment?.sentiments?.find(s => s.symbol === asset.symbol);

                  return (
                    <Card key={asset.id} className="bg-slate-900 border-slate-700 hover:border-violet-500/50 transition-all group">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg border ${ASSET_TYPE_COLORS[asset.assetType] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
                              {ASSET_TYPE_ICONS[asset.assetType] ?? <BarChart3 className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-1">
                                <CardTitle className="text-sm text-white">{asset.symbol}</CardTitle>
                                {asset.isFeatured && <Zap className="h-3 w-3 text-yellow-400" />}
                              </div>
                              <CardDescription className="text-xs text-slate-400 truncate max-w-[140px]">{asset.name}</CardDescription>
                            </div>
                          </div>
                          <button
                            onClick={() => isWatched ? removeWatch.mutate({ assetId: asset.id }) : addWatch.mutate({ assetId: asset.id })}
                            className="text-slate-500 hover:text-yellow-400 transition-colors"
                          >
                            {isWatched ? <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /> : <StarOff className="h-4 w-4" />}
                          </button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-end justify-between mb-2">
                          <span className="text-xl font-bold text-white">{formatCurrency(price)}</span>
                          <span className={`flex items-center gap-0.5 text-sm ${changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {changePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(changePct).toFixed(2)}%
                          </span>
                        </div>
                        {/* Inline sparkline */}
                        <div
                          className="cursor-pointer rounded overflow-hidden mb-2"
                          onClick={() => setChartAsset(asset)}
                          title="Click to view full chart"
                        >
                          <PriceChart symbol={asset.symbol} currentPrice={price} compact />
                        </div>
                        {sentData && (
                          <div className="flex items-center gap-1 mb-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${sentData.sentiment_label === "Bullish" ? "bg-emerald-500/20 text-emerald-400" : sentData.sentiment_label === "Bearish" ? "bg-red-500/20 text-red-400" : "bg-slate-700 text-slate-400"}`}>
                              {sentData.sentiment_label}
                            </span>
                            <span className="text-xs text-slate-500">Diaspora demand: {sentData.diaspora_demand_index.toFixed(0)}</span>
                          </div>
                        )}
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            onClick={() => setBuyAsset(asset)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs h-7"
                            disabled={!user}
                          >
                            Buy
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setChartAsset(asset)}
                            className="border-slate-600 text-slate-300 h-7 text-xs"
                          >
                            Chart
                          </Button>
                          <Badge variant="outline" className={`text-xs ${ASSET_TYPE_COLORS[asset.assetType] ?? ""}`}>
                            {asset.assetType.replace("_", " ")}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Portfolio Tab ── */}
          <TabsContent value="portfolio">
            {!user ? (
              <Card className="bg-slate-900 border-slate-700 text-center py-12">
                <CardContent>
                  <Wallet className="h-12 w-12 mx-auto mb-3 text-slate-500" />
                  <p className="text-slate-400">Sign in to view your portfolio</p>
                </CardContent>
              </Card>
            ) : !portfolio?.holdings?.length ? (
              <Card className="bg-slate-900 border-slate-700 text-center py-12">
                <CardContent>
                  <TrendingUp className="h-12 w-12 mx-auto mb-3 text-slate-500" />
                  <p className="text-slate-400 mb-3">No investments yet. Start building your diaspora portfolio.</p>
                  <Button onClick={() => setTab("markets")} className="bg-violet-600 hover:bg-violet-700">
                    Browse Markets <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Portfolio History Chart */}
                {portfolioHistory.length > 0 && (
                  <Card className="bg-slate-900 border-slate-700">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-400" /> Portfolio Value (90 Days)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={portfolioHistory} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                          <Tooltip
                            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                            labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                            formatter={(v: any) => [formatCurrency(v), "Value"]}
                          />
                          <Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#portfolioGrad)" strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
                {/* Analysis card */}
                {analysis && (
                  <Card className="bg-slate-900 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-violet-400" /> Portfolio Analysis (Rust Engine)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Risk Score</p>
                          <p className="text-xl font-bold text-yellow-400">{analysis.risk_metrics.risk_score}</p>
                          <p className="text-xs text-slate-500">{analysis.risk_metrics.risk_label}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Volatility</p>
                          <p className="text-xl font-bold text-orange-400">{analysis.risk_metrics.estimated_volatility.toFixed(1)}%</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Top Performer</p>
                          <p className="text-xl font-bold text-emerald-400">{analysis.top_performer ?? "—"}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Worst Performer</p>
                          <p className="text-xl font-bold text-red-400">{analysis.worst_performer ?? "—"}</p>
                        </div>
                      </div>
                      {analysis.rebalance_suggestions.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-400 mb-2">Rebalancing Suggestions</p>
                          <div className="space-y-1">
                            {analysis.rebalance_suggestions.slice(0, 3).map(s => (
                              <div key={s.symbol} className="flex items-center justify-between text-xs bg-slate-800 rounded px-2 py-1">
                                <span className="text-slate-300">{s.symbol}</span>
                                <span className={`px-1.5 py-0.5 rounded ${s.action === "buy" ? "bg-emerald-500/20 text-emerald-400" : s.action === "sell" ? "bg-red-500/20 text-red-400" : "bg-slate-700 text-slate-400"}`}>
                                  {s.action.toUpperCase()}
                                </span>
                                <span className="text-slate-400">{formatCurrency(s.amount_usd)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Holdings */}
                <div className="space-y-2">
                  {portfolio.holdings.map((h: any) => {
                    const currentVal = Number(h.asset.currentPrice ?? 0) * Number(h.inv.quantity);
                    const costBasis = Number(h.inv.purchasePrice) * Number(h.inv.quantity);
                    const pnl = currentVal - costBasis;
                    const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
                    return (
                      <Card key={h.inv.id} className="bg-slate-900 border-slate-700">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded-lg border ${ASSET_TYPE_COLORS[h.asset.assetType] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
                                {ASSET_TYPE_ICONS[h.asset.assetType] ?? <BarChart3 className="h-4 w-4" />}
                              </div>
                              <div>
                                <p className="font-semibold text-white">{h.asset.symbol}</p>
                                <p className="text-xs text-slate-400">{Number(h.inv.quantity).toFixed(4)} units @ {formatCurrency(Number(h.inv.purchasePrice))}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-white">{formatCurrency(currentVal)}</p>
                              <PnlBadge value={pnl} pct={pnlPct} />
                            </div>
                            <Button
                              size="sm" variant="outline"
                              onClick={() => sell.mutate({ investmentId: h.inv.id })}
                              disabled={sell.isPending}
                              className="border-red-500/50 text-red-400 hover:bg-red-500/10 ml-3"
                            >
                              Sell
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Order history */}
                {orderHistory.length > 0 && (
                  <Card className="bg-slate-900 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-sm">Order History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {orderHistory.slice(0, 20).map((o: any) => (
                          <div key={o.order.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800">
                            <span className={`px-1.5 py-0.5 rounded ${o.order.orderType === "buy" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                              {o.order.orderType.toUpperCase()}
                            </span>
                            <span className="text-slate-300">{o.asset.symbol}</span>
                            <span className="text-slate-400">{Number(o.order.quantity).toFixed(4)} units</span>
                            <span className="text-white">{formatCurrency(Number(o.order.totalAmount))}</span>
                            <span className="text-slate-500">{new Date(o.order.createdAt).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── Watchlist Tab ── */}
          <TabsContent value="watchlist">
            {!user ? (
              <Card className="bg-slate-900 border-slate-700 text-center py-12">
                <CardContent>
                  <Star className="h-12 w-12 mx-auto mb-3 text-slate-500" />
                  <p className="text-slate-400">Sign in to manage your watchlist</p>
                </CardContent>
              </Card>
            ) : watchlist.length === 0 ? (
              <Card className="bg-slate-900 border-slate-700 text-center py-12">
                <CardContent>
                  <Star className="h-12 w-12 mx-auto mb-3 text-slate-500" />
                  <p className="text-slate-400 mb-3">Your watchlist is empty. Star assets from the Markets tab.</p>
                  <Button onClick={() => setTab("markets")} className="bg-violet-600 hover:bg-violet-700">
                    Browse Markets
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {watchlist.map((w: any) => {
                  const price = Number(w.asset.currentPrice ?? 0);
                  const changePct = Number(w.asset.priceChangePct24h ?? 0);
                  return (
                    <DashboardLayout>
                    <Card key={w.watchlist.id} className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-1.5 rounded-lg border ${ASSET_TYPE_COLORS[w.asset.assetType] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
                              {ASSET_TYPE_ICONS[w.asset.assetType] ?? <BarChart3 className="h-4 w-4" />}
                            </div>
                            <div>
                              <p className="font-semibold text-white">{w.asset.symbol}</p>
                              <p className="text-xs text-slate-400">{w.asset.name}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-white">{formatCurrency(price)}</p>
                            <span className={`text-xs ${changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                            </span>
                          </div>
                          <div className="flex gap-2 ml-3">
                            <Button size="sm" onClick={() => setBuyAsset(w.asset)} className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs">Buy</Button>
                            <Button size="sm" variant="outline" onClick={() => removeWatch.mutate({ assetId: w.asset.id })} className="border-slate-600 h-7 text-xs">
                              <StarOff className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  
                    </DashboardLayout>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── AI Insights Tab ── */}
          <TabsContent value="ai">
            <div className="space-y-4">
              {!user ? (
                <Card className="bg-slate-900 border-slate-700 text-center py-12">
                  <CardContent>
                    <Brain className="h-12 w-12 mx-auto mb-3 text-slate-500" />
                    <p className="text-slate-400">Sign in to get AI investment recommendations</p>
                  </CardContent>
                </Card>
              ) : recommendations ? (
                <>
                  <Card className="bg-gradient-to-r from-violet-900/30 to-slate-900 border-violet-500/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-violet-300">
                        <Brain className="h-5 w-5" /> AI Portfolio Strategy
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-slate-300 mb-2">{recommendations.portfolio_strategy}</p>
                      {recommendations.diaspora_insight && (
                        <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
                          <Info className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                          <p className="text-sm text-violet-200">{recommendations.diaspora_insight}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {recommendations.recommendations.map((rec: any) => (
                      <Card key={rec.symbol} className="bg-slate-900 border-slate-700">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-bold text-white">{rec.symbol}</p>
                              <p className="text-xs text-slate-400">{rec.name}</p>
                            </div>
                            <div className="text-right">
                              <Badge className={`text-xs ${ASSET_TYPE_COLORS[rec.asset_type] ?? ""}`}>
                                {rec.asset_type.replace("_", " ")}
                              </Badge>
                              <p className="text-xs text-emerald-400 mt-1">+{rec.expected_return_1y}% est.</p>
                            </div>
                          </div>
                          <p className="text-xs text-slate-400 mb-2">{rec.reason}</p>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-slate-500">Confidence</p>
                              <Progress value={rec.confidence_score * 100} className="h-1.5 w-20 mt-1" />
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-slate-500">Suggested allocation</p>
                              <p className="text-sm font-semibold text-violet-400">{rec.suggested_allocation_pct.toFixed(1)}%</p>
                            </div>
                            <Button size="sm" onClick={() => {
                              const asset = assets.find(a => a.symbol === rec.symbol);
                              if (asset) setBuyAsset(asset);
                            }} className="bg-violet-600 hover:bg-violet-700 h-7 text-xs">
                              Invest
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <Brain className="h-12 w-12 mx-auto mb-3 opacity-30 animate-pulse" />
                  <p>Loading AI recommendations...</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── DCA Calculator Tab ── */}
          <TabsContent value="dca">
            <Card className="bg-slate-900 border-slate-700 max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-violet-400" />
                  Dollar-Cost Averaging Calculator
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Project your investment growth using the Rust portfolio engine
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DcaCalculator />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Buy Dialog */}
      {buyAsset && (
        <BuyDialog asset={buyAsset} open={!!buyAsset} onClose={() => setBuyAsset(null)} />
      )}
      {/* Asset Detail / Chart Dialog */}
      {chartAsset && (
        <Dialog open={!!chartAsset} onOpenChange={() => setChartAsset(null)}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg border ${ASSET_TYPE_COLORS[chartAsset.assetType] ?? "bg-slate-700 border-slate-600"}`}>
                  {ASSET_TYPE_ICONS[chartAsset.assetType] ?? <BarChart3 className="h-4 w-4" />}
                </div>
                {chartAsset.name}
                <Badge variant="outline" className={`text-xs ml-1 ${ASSET_TYPE_COLORS[chartAsset.assetType] ?? ""}`}>
                  {chartAsset.symbol}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {chartAsset.assetType.replace("_", " ")} · {chartAsset.exchange ?? "Global"} · {chartAsset.country ?? ""}
              </DialogDescription>
            </DialogHeader>
            <div className="py-2 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-white">{formatCurrency(Number(chartAsset.currentPrice ?? 0))}</span>
                <span className={`flex items-center gap-1 text-sm font-medium ${
                  Number(chartAsset.priceChangePct24h ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {Number(chartAsset.priceChangePct24h ?? 0) >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {Math.abs(Number(chartAsset.priceChangePct24h ?? 0)).toFixed(2)}% (24h)
                </span>
              </div>
              <PriceChart symbol={chartAsset.symbol} currentPrice={Number(chartAsset.currentPrice ?? 0)} />
              {chartAsset.description && (
                <p className="text-sm text-slate-400 leading-relaxed">{chartAsset.description}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setChartAsset(null)} className="border-slate-600">Close</Button>
              {user && (
                <Button
                  onClick={() => { setChartAsset(null); setBuyAsset(chartAsset); }}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  Buy {chartAsset.symbol}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
