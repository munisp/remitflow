import { useTranslation } from 'react-i18next';
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Search, Star, StarOff, ShoppingCart,
  BarChart2, Eye, RefreshCw, AlertCircle, BookOpen, Building2
} from "lucide-react";

function PriceChange({ pct }: { pct: string | null }) {
  if (!pct) return <span className="text-muted-foreground">—</span>;
  const n = parseFloat(pct);
  const isUp = n >= 0;
  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${isUp ? "text-emerald-500" : "text-red-500"}`}>
      {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isUp ? "+" : ""}{n.toFixed(2)}%
    </span>
  );
}

function formatNGN(val: string | null | undefined) {
  if (!val) return "—";
  return `₦${parseFloat(val).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBillions(val: string | null | undefined) {
  if (!val) return "—";
  const n = parseFloat(val);
  if (n >= 1e12) return `₦${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(2)}M`;
  return formatNGN(val);
}

export default function NGXStockMarket() {
  const { t } = useTranslation();
  
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [tab, setTab] = useState("market");
  const [selectedStock, setSelectedStock] = useState<number | null>(null);
  const [orderDialog, setOrderDialog] = useState(false);
  const [orderType, setOrderType] = useState<"buy" | "sell" | "limit_buy" | "limit_sell">("buy");
  const [quantity, setQuantity] = useState("100");
  const [broker, setBroker] = useState<"Bamboo" | "Trove" | "Chaka" | "Stanbic" | "GTB">("Bamboo");

  const { data: stocks, isLoading: stocksLoading, refetch } = trpc.ngxStocks.list.useQuery({
    search: search || undefined,
    sector: sector === "all" ? undefined : sector,
    limit: 100,
  });

  const { data: sectors } = trpc.ngxStocks.sectors.useQuery();
  const { data: watchlist, refetch: refetchWatchlist } = trpc.ngxStocks.getWatchlist.useQuery();
  const { data: orders } = trpc.ngxStocks.getOrders.useQuery({ limit: 20 });
  const { data: selectedStockData } = trpc.ngxStocks.getById.useQuery(
    { id: selectedStock! },
    { enabled: !!selectedStock }
  );

  const addToWatchlist = trpc.ngxStocks.addToWatchlist.useMutation({
    onSuccess: () => { refetchWatchlist(); toast.success("Added to watchlist"); },
    onError: (e) => toast.error(e.message),
  });

  const removeFromWatchlist = trpc.ngxStocks.removeFromWatchlist.useMutation({
    onSuccess: () => { refetchWatchlist(); toast.success("Removed from watchlist"); },
    onError: (e) => toast.error(e.message),
  });

  const placeOrder = trpc.ngxStocks.placeOrder.useMutation({
    onSuccess: () => {
      setOrderDialog(false);
      toast.success("Your order has been submitted to the broker.");
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelOrder = trpc.ngxStocks.cancelOrder.useMutation({
    onSuccess: () => toast.success("Order cancelled"),
    onError: (e) => toast.error(e.message),
  });

  const watchlistIds = useMemo(() => new Set(watchlist?.map((w: any) => w.stockId) ?? []), [watchlist]);
  const watchlistMap = useMemo(() => {
    const m = new Map<number, number>();
    watchlist?.forEach((w: any) => m.set(w.stockId, w.id));
    return m;
  }, [watchlist]);

  const currentPrice = selectedStockData?.currentPriceNgn ?? "0";
  const totalNGN = parseFloat(quantity || "0") * parseFloat(currentPrice);
  const totalUSD = totalNGN / 1600;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-emerald-500" />
              NGX Stock Market
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Invest in Nigerian Exchange Group (NGX) listed companies from anywhere in the world
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>

        {/* Info Banner */}
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">How Diaspora Stock Investing Works</p>
                <p className="text-muted-foreground mt-1">
                  Orders are routed through SEC-licensed Nigerian brokers (Bamboo, Trove, Chaka, Stanbic, GTB). 
                  Funds are converted from USD to NGN at the live rate. Settlement takes T+3 business days per NGX rules.
                  Dividends are paid in NGN and auto-converted to USD into your wallet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="market">Market</TabsTrigger>
            <TabsTrigger value="watchlist">
              Watchlist {watchlist && watchlist.length > 0 && <Badge className="ml-1 h-4 px-1 text-xs">{watchlist.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="orders">My Orders</TabsTrigger>
            <TabsTrigger value="education">How It Works</TabsTrigger>
          </TabsList>

          {/* Market Tab */}
          <TabsContent value="market" className="space-y-4">
            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search ticker or company..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Sectors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sectors</SelectItem>
                  {sectors?.map((s: any) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Stock Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left p-3 font-medium">Ticker</th>
                        <th className="text-left p-3 font-medium">Company</th>
                        <th className="text-left p-3 font-medium">Sector</th>
                        <th className="text-right p-3 font-medium">Price (NGN)</th>
                        <th className="text-right p-3 font-medium">Change</th>
                        <th className="text-right p-3 font-medium">Mkt Cap</th>
                        <th className="text-right p-3 font-medium">P/E</th>
                        <th className="text-right p-3 font-medium">Div Yield</th>
                        <th className="text-center p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stocksLoading
                        ? Array.from({ length: 8 }).map((_, i) => (
                            <tr key={i} className="border-b">
                              {Array.from({ length: 9 }).map((_, j) => (
                                <td key={j} className="p-3"><Skeleton className="h-4 w-full" /></td>
                              ))}
                            </tr>
                          ))
                        : stocks?.map((stock: any) => {
                            const inWatchlist = watchlistIds.has(stock.id);
                            return (
                              <tr key={stock.id} className="border-b hover:bg-muted/20 transition-colors">
                                <td className="p-3">
                                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{stock.ticker}</span>
                                </td>
                                <td className="p-3">
                                  <button
                                    className="text-left hover:underline font-medium"
                                    onClick={() => { setSelectedStock(stock.id); setOrderDialog(false); }}
                                  >
                                    {stock.name}
                                  </button>
                                </td>
                                <td className="p-3">
                                  <Badge variant="outline" className="text-xs">{stock.sector}</Badge>
                                </td>
                                <td className="p-3 text-right font-mono">{formatNGN(stock.currentPriceNgn)}</td>
                                <td className="p-3 text-right"><PriceChange pct={stock.changePercent} /></td>
                                <td className="p-3 text-right text-muted-foreground">{formatBillions(stock.marketCapNgn)}</td>
                                <td className="p-3 text-right text-muted-foreground">{stock.peRatio ? parseFloat(stock.peRatio).toFixed(1) : "—"}</td>
                                <td className="p-3 text-right text-muted-foreground">
                                  {stock.dividendYield ? `${parseFloat(stock.dividendYield).toFixed(2)}%` : "—"}
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => {
                                        if (inWatchlist) {
                                          const wid = watchlistMap.get(stock.id);
                                          if (wid) removeFromWatchlist.mutate({ watchlistId: wid });
                                        } else {
                                          addToWatchlist.mutate({ stockId: stock.id });
                                        }
                                      }}
                                    >
                                      {inWatchlist
                                        ? <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                                        : <Star className="h-4 w-4 text-muted-foreground" />}
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                      onClick={() => {
                                        setSelectedStock(stock.id);
                                        setOrderType("buy");
                                        setOrderDialog(true);
                                      }}
                                    >
                                      Buy
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                    </tbody>
                  </table>
                  {!stocksLoading && (!stocks || stocks.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground">
                      <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>No stocks found matching your criteria</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Watchlist Tab */}
          <TabsContent value="watchlist" className="space-y-4">
            {!watchlist || watchlist.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Star className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground">Your watchlist is empty. Star stocks from the Market tab.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {watchlist.map((item: any) => (
                  <Card key={item.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{item.ticker}</span>
                              <Badge variant="outline" className="text-xs">{item.sector}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{item.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono font-bold">{formatNGN(item.currentPriceNgn)}</p>
                            <PriceChange pct={item.changePercent} />
                          </div>
                          {item.alertPriceNgn && (
                            <div className="text-right text-xs text-muted-foreground">
                              <p>Alert at</p>
                              <p className="font-mono">{formatNGN(item.alertPriceNgn)}</p>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => {
                                setSelectedStock(item.stockId);
                                setOrderType("buy");
                                setOrderDialog(true);
                              }}
                            >
                              Buy
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeFromWatchlist.mutate({ watchlistId: item.id })}
                            >
                              <StarOff className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-4">
            {!orders || orders.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground">No orders yet. Buy your first NGX stock.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-3 font-medium">Stock</th>
                          <th className="text-left p-3 font-medium">Type</th>
                          <th className="text-right p-3 font-medium">Qty</th>
                          <th className="text-right p-3 font-medium">Price</th>
                          <th className="text-right p-3 font-medium">Total NGN</th>
                          <th className="text-right p-3 font-medium">Total USD</th>
                          <th className="text-left p-3 font-medium">Broker</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          <th className="text-left p-3 font-medium">Date</th>
                          <th className="text-center p-3 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((order: any) => (
                          <tr key={order.id} className="border-b hover:bg-muted/20">
                            <td className="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{order.ticker}</td>
                            <td className="p-3">
                              <Badge variant={order.orderType.includes("buy") ? "default" : "secondary"} className="text-xs capitalize">
                                {order.orderType.replace("_", " ")}
                              </Badge>
                            </td>
                            <td className="p-3 text-right font-mono">{parseFloat(order.quantityUnits).toLocaleString()}</td>
                            <td className="p-3 text-right font-mono">{formatNGN(order.pricePerUnitNgn)}</td>
                            <td className="p-3 text-right font-mono">{formatNGN(order.totalAmountNgn)}</td>
                            <td className="p-3 text-right font-mono">${parseFloat(order.totalAmountUsd ?? "0").toFixed(2)}</td>
                            <td className="p-3 text-muted-foreground">{order.brokerName}</td>
                            <td className="p-3">
                              <Badge
                                variant={order.status === "executed" ? "default" : order.status === "cancelled" ? "destructive" : "outline"}
                                className="text-xs capitalize"
                              >
                                {order.status}
                              </Badge>
                            </td>
                            <td className="p-3 text-muted-foreground text-xs">
                              {new Date(order.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-center">
                              {order.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-500 hover:text-red-600 h-7 text-xs"
                                  onClick={() => cancelOrder.mutate({ orderId: order.id })}
                                >
                                  Cancel
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Education Tab */}
          <TabsContent value="education" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {[
                {
                  icon: BookOpen,
                  title: "What is NGX?",
                  body: "The Nigerian Exchange Group (NGX) is Nigeria's premier stock exchange, listing over 150 companies across banking, telecoms, oil & gas, consumer goods, and more. It operates under SEC Nigeria regulation.",
                },
                {
                  icon: Building2,
                  title: "Licensed Brokers",
                  body: "RemitFlow routes orders through SEC-licensed stockbrokers: Bamboo, Trove, Chaka, Stanbic IBTC, and GTBank. Each broker holds client funds in segregated accounts regulated by the CBN.",
                },
                {
                  icon: TrendingUp,
                  title: "Settlement & Dividends",
                  body: "NGX operates on T+3 settlement (3 business days). Dividends declared in NGN are auto-converted to USD at the prevailing rate and credited to your RemitFlow wallet.",
                },
                {
                  icon: AlertCircle,
                  title: "Tax Obligations",
                  body: "US residents may owe taxes on dividends and capital gains from Nigerian stocks. Nigeria withholds 10% on dividends at source. Consult a tax advisor familiar with US-Nigeria tax treaty obligations.",
                },
              ].map((item) => (
                <Card key={item.title}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <item.icon className="h-5 w-5 text-emerald-500" />
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{item.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Order Dialog */}
      <Dialog open={orderDialog} onOpenChange={setOrderDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Place Stock Order</DialogTitle>
            <DialogDescription>
              {selectedStockData
                ? `${selectedStockData.ticker} — ${selectedStockData.name}`
                : "Loading..."}
            </DialogDescription>
          </DialogHeader>
          {selectedStockData && (
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Current Price</p>
                  <p className="font-mono font-bold text-lg">{formatNGN(selectedStockData.currentPriceNgn)}</p>
                </div>
                <PriceChange pct={selectedStockData.changePercent} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Order Type</Label>
                  <Select value={orderType} onValueChange={(v) => setOrderType(v as typeof orderType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">Market Buy</SelectItem>
                      <SelectItem value="sell">Market Sell</SelectItem>
                      <SelectItem value="limit_buy">Limit Buy</SelectItem>
                      <SelectItem value="limit_sell">Limit Sell</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Broker</Label>
                  <Select value={broker} onValueChange={(v) => setBroker(v as typeof broker)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["Bamboo", "Trove", "Chaka", "Stanbic", "GTB"].map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Number of Shares</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 100"
                />
              </div>

              <div className="p-3 bg-muted/30 rounded-lg space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total (NGN)</span>
                  <span className="font-mono font-bold">{formatNGN(totalNGN.toFixed(2))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Approx. USD (@ ₦1,600)</span>
                  <span className="font-mono font-bold">${totalUSD.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Settlement</span>
                  <span>T+3 business days</span>
                </div>
              </div>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={placeOrder.isPending || !quantity || parseFloat(quantity) < 1}
                onClick={() =>
                  placeOrder.mutate({
                    stockId: selectedStockData.id,
                    orderType,
                    quantityUnits: quantity,
                    pricePerUnitNgn: selectedStockData.currentPriceNgn,
                    brokerName: broker,
                  })
                }
              >
                {placeOrder.isPending ? "Placing Order..." : `Place ${orderType.replace("_", " ")} Order`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
