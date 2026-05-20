import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarChart2, ShoppingCart } from "lucide-react";

export default function BondSecondaryMarket() {
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [buyUnits, setBuyUnits] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const utils = trpc.useUtils();
  // listOpenOrders requires { bondId: number } — use bondId=1 as default market view
  const [selectedBondId, setSelectedBondId] = useState(1);
  const { data: listings, isLoading } = trpc.bondSecondaryMarket.listOpenOrders.useQuery({ bondId: selectedBondId });
  const { data: pricing } = trpc.bondSecondaryMarket.getPricing.useQuery({ bondId: selectedBondId, marketPriceUsd: 100 });

  const buyOrder = trpc.bondSecondaryMarket.buy.useMutation({
    onSuccess: () => {
      toast("Purchase complete", { description: "Bond units transferred to your portfolio." });
      utils.bondSecondaryMarket.listOpenOrders.invalidate();
      setSelectedOrder(null);
      setBuyUnits("");
      setMaxPrice("");
    },
    onError: (e) => toast.error("Purchase failed", { description: e.message }),
  });

  const bondIds = [1, 2, 3, 4, 5];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Bond Secondary Market</h1>
        <p className="text-muted-foreground text-sm mt-1">Buy and sell diaspora bond units — price-time priority order book</p>
      </div>

      {/* Bond selector */}
      <div className="flex gap-2 flex-wrap">
        {bondIds.map(id => (
          <Button key={id} variant={selectedBondId === id ? "default" : "outline"} size="sm"
            onClick={() => setSelectedBondId(id)}>
            Bond #{id}
          </Button>
        ))}
      </div>

      {/* Pricing summary */}
      {pricing && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Best Ask</p>
            <p className="text-lg font-bold">${Number(pricing.bestAsk ?? 0).toFixed(2)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Best Bid</p>
            <p className="text-lg font-bold">${Number(pricing.bestBid ?? 0).toFixed(2)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Open Orders</p>
            <p className="text-lg font-bold">{pricing.openOrderCount ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">24h Volume</p>
            <p className="text-lg font-bold">${Number(pricing.volume24h ?? 0).toLocaleString()}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Market listings */}
      <Card>
        <CardHeader><CardTitle className="text-base">Live Ask Orders — Bond #{selectedBondId}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !listings?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No active ask orders for Bond #{selectedBondId}. Try another bond.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-4">Order ID</th>
                    <th className="text-right py-2 pr-4">Ask Price</th>
                    <th className="text-right py-2 pr-4">Units Available</th>
                    <th className="text-right py-2 pr-4">Status</th>
                    <th className="text-right py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {listings?.map((order: any) => (
                    <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4 font-medium">#{order.id}</td>
                      <td className="py-3 pr-4 text-right font-semibold">${Number(order.askPrice ?? 0).toFixed(2)}</td>
                      <td className="py-3 pr-4 text-right">{Number(order.unitsAvailable ?? 0).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right">
                        <Badge variant="outline" className="text-xs">{order.status}</Badge>
                      </td>
                      <td className="py-3 text-right">
                        <Button size="sm" className="h-7 text-xs"
                          onClick={() => { setSelectedOrder(order); setBuyUnits(""); setMaxPrice(String(order.askPrice ?? 0)); }}>
                          <ShoppingCart className="w-3 h-3 mr-1" />Buy
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Buy Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Buy Bond Units</DialogTitle></DialogHeader>
          {selectedOrder && (
            <div className="space-y-4 mt-2">
              <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Bond</span><span className="font-medium">Bond #{selectedOrder.bondId}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ask Price</span><span className="font-semibold">${Number(selectedOrder.askPrice ?? 0).toFixed(2)} / unit</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Available</span><span>{Number(selectedOrder.unitsAvailable ?? 0).toLocaleString()} units</span></div>
              </div>
              <div>
                <Label className="text-xs">Units to Buy</Label>
                <Input type="number" placeholder="100" value={buyUnits}
                  onChange={e => setBuyUnits(e.target.value)}
                  min={1} max={selectedOrder.unitsAvailable} />
              </div>
              <div>
                <Label className="text-xs">Max Price per Unit (USD)</Label>
                <Input type="number" placeholder="1.00" value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value)} step="0.01" />
              </div>
              {buyUnits && maxPrice && (
                <p className="text-xs text-muted-foreground">
                  Max total: <span className="font-semibold text-foreground">${(Number(buyUnits) * Number(maxPrice)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </p>
              )}
              <Button className="w-full"
                onClick={() => buyOrder.mutate({
                  bondId: selectedOrder.bondId,
                  units: parseInt(buyUnits) || 1,
                  maxPriceUsd: parseFloat(maxPrice) || 0,
                })}
                disabled={buyOrder.isPending || !buyUnits || Number(buyUnits) < 1 || !maxPrice}>
                {buyOrder.isPending ? "Processing..." : "Confirm Purchase"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
