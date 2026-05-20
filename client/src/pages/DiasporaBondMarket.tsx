import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  TrendingUp, DollarSign, Calendar, Shield, Globe2, ChevronRight,
  BookOpen, Percent, Clock, Award, ArrowUpRight, ArrowDownRight,
  Landmark, Building2, Leaf, Coins, BarChart3, RefreshCw, Star,
  CheckCircle2, AlertTriangle, Info, Plus, Eye, Send
} from "lucide-react";

// ─── Types & Config ────────────────────────────────────────────────────────────

const BOND_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  sovereign: { label: "Sovereign", icon: <Landmark className="w-4 h-4" />, color: "bg-blue-100 text-blue-700" },
  corporate: { label: "Corporate", icon: <Building2 className="w-4 h-4" />, color: "bg-purple-100 text-purple-700" },
  green: { label: "Green Bond", icon: <Leaf className="w-4 h-4" />, color: "bg-green-100 text-green-700" },
  infrastructure: { label: "Infrastructure", icon: <Globe2 className="w-4 h-4" />, color: "bg-orange-100 text-orange-700" },
  diaspora: { label: "Diaspora", icon: <Star className="w-4 h-4" />, color: "bg-emerald-100 text-emerald-700" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  upcoming: { label: "Coming Soon", color: "bg-slate-100 text-slate-700" },
  open: { label: "Open", color: "bg-green-100 text-green-700" },
  fully_subscribed: { label: "Fully Subscribed", color: "bg-yellow-100 text-yellow-700" },
  closed: { label: "Closed", color: "bg-slate-100 text-slate-600" },
  matured: { label: "Matured", color: "bg-blue-100 text-blue-700" },
};

const SUB_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending_payment: { label: "Pending Payment", color: "bg-yellow-100 text-yellow-700", icon: <Clock className="w-3 h-3" /> },
  payment_received: { label: "Payment Received", color: "bg-blue-100 text-blue-700", icon: <CheckCircle2 className="w-3 h-3" /> },
  active: { label: "Active", color: "bg-green-100 text-green-700", icon: <TrendingUp className="w-3 h-3" /> },
  matured: { label: "Matured", color: "bg-purple-100 text-purple-700", icon: <Award className="w-3 h-3" /> },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700", icon: <AlertTriangle className="w-3 h-3" /> },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number | string, currency = "USD") {
  const n = Number(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

function daysUntil(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  return Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000));
}

function yearsUntil(date: string | Date) {
  return (daysUntil(date) / 365).toFixed(1);
}

// ─── Bond Card ────────────────────────────────────────────────────────────────

function BondCard({ bond, onSubscribe }: { bond: any; onSubscribe: (bond: any) => void }) {
  const tc = BOND_TYPE_CONFIG[bond.bondType] ?? BOND_TYPE_CONFIG.corporate;
  const sc = STATUS_CONFIG[bond.status] ?? STATUS_CONFIG.upcoming;
  const raised = Number(bond.raisedAmount ?? 0);
  const target = Number(bond.targetRaise ?? 1);
  const pct = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
  const daysLeft = daysUntil(bond.offerCloseDate);

  return (
    <Card className="border hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${tc.color}`}>{tc.icon}</div>
            <div>
              <div className="font-semibold text-sm leading-tight">{bond.name}</div>
              <div className="text-xs text-muted-foreground">{bond.issuer}</div>
            </div>
          </div>
          <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Coupon Rate</div>
            <div className="text-lg font-bold text-emerald-600">{(Number(bond.couponRate) * 100).toFixed(2)}%</div>
            <div className="text-xs text-muted-foreground capitalize">{bond.couponFrequency?.replace("_", "-")}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">YTM</div>
            <div className="text-lg font-bold">{bond.yieldToMaturity ? (Number(bond.yieldToMaturity) * 100).toFixed(2) + "%" : "—"}</div>
            <div className="text-xs text-muted-foreground">{bond.creditRating ?? "—"} {bond.ratingAgency ? `(${bond.ratingAgency})` : ""}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Maturity</div>
            <div className="text-lg font-bold">{yearsUntil(bond.maturityDate)}y</div>
            <div className="text-xs text-muted-foreground">{new Date(bond.maturityDate).getFullYear()}</div>
          </div>
        </div>

        {bond.targetRaise && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Raised: {formatCurrency(raised, bond.currency)}</span>
              <span>{pct.toFixed(0)}% of {formatCurrency(target, bond.currency)}</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Min: {formatCurrency(bond.minSubscription, bond.currency)} · {daysLeft > 0 ? `${daysLeft}d left` : "Closed"}
            {bond.isTaxExempt && <span className="ml-2 text-emerald-600 font-medium">Tax-Exempt</span>}
          </div>
          {bond.status === "open" && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7"
              onClick={(e) => { e.stopPropagation(); onSubscribe(bond); }}
            >
              Subscribe <ChevronRight className="w-3 h-3 ml-0.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Subscribe Dialog ─────────────────────────────────────────────────────────

function SubscribeDialog({ bond, onSuccess }: { bond: any; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState(String(bond.minSubscription ?? 500));
  const [channel, setChannel] = useState("wallet");

  const units = Number(amount) / Number(bond.faceValue);
  const couponPerPeriod = (Number(amount) * Number(bond.couponRate)) / (bond.couponFrequency === "monthly" ? 12 : bond.couponFrequency === "quarterly" ? 4 : bond.couponFrequency === "semi_annual" ? 2 : 1);
  const totalCoupons = couponPerPeriod * (bond.couponFrequency === "monthly" ? 12 : bond.couponFrequency === "quarterly" ? 4 : bond.couponFrequency === "semi_annual" ? 2 : 1) * Number(yearsUntil(bond.maturityDate));
  const totalReturn = totalCoupons + Number(amount);
  const platformFee = Number(amount) * 0.001;

  const subscribe = trpc.diasporaBond.subscribe.useMutation({
    onSuccess: (data) => {
      toast("Subscription confirmed!", { description: "Ref: ${data.subscriptionRef}. ${formatCurrency(amount, bond.currency)} invested in ${bond.name}." });
      onSuccess();
    },
    onError: (e) => toast.error("Subscription failed"),
  });

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-1.5 rounded-lg ${BOND_TYPE_CONFIG[bond.bondType]?.color}`}>{BOND_TYPE_CONFIG[bond.bondType]?.icon}</div>
          <div>
            <div className="font-semibold">{bond.name}</div>
            <div className="text-xs text-muted-foreground">{bond.issuer} · {bond.creditRating}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mt-3">
          <div><div className="text-xs text-muted-foreground">Coupon</div><div className="font-bold text-emerald-600">{(Number(bond.couponRate) * 100).toFixed(2)}%</div></div>
          <div><div className="text-xs text-muted-foreground">Maturity</div><div className="font-bold">{new Date(bond.maturityDate).toLocaleDateString()}</div></div>
          <div><div className="text-xs text-muted-foreground">Currency</div><div className="font-bold">{bond.currency}</div></div>
        </div>
      </div>

      <div>
        <Label>Investment Amount ({bond.currency}) *</Label>
        <Input
          type="number"
          value={amount}
          min={bond.minSubscription}
          max={bond.maxSubscription ?? undefined}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Min: {formatCurrency(bond.minSubscription, bond.currency)}
          {bond.maxSubscription ? ` · Max: ${formatCurrency(bond.maxSubscription, bond.currency)}` : ""}
        </p>
      </div>

      <div>
        <Label>Payment Channel</Label>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="wallet">RemitFlow Wallet</SelectItem>
            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
            <SelectItem value="card">Debit/Credit Card</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Return Projection */}
      <div className="p-4 rounded-xl bg-slate-50 border space-y-2">
        <div className="text-sm font-semibold text-slate-700 mb-2">Return Projection</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">Units:</span><span className="font-mono">{units.toFixed(4)}</span>
          <span className="text-muted-foreground">Coupon per period:</span><span className="font-mono text-emerald-600">{formatCurrency(couponPerPeriod, bond.currency)}</span>
          <span className="text-muted-foreground">Total coupons:</span><span className="font-mono text-emerald-600">{formatCurrency(totalCoupons, bond.currency)}</span>
          <span className="text-muted-foreground">Principal at maturity:</span><span className="font-mono">{formatCurrency(amount, bond.currency)}</span>
          <span className="text-muted-foreground font-semibold">Total return:</span><span className="font-mono font-bold text-emerald-700">{formatCurrency(totalReturn, bond.currency)}</span>
          <span className="text-muted-foreground">Platform fee (0.1%):</span><span className="font-mono text-red-500">{formatCurrency(platformFee, bond.currency)}</span>
        </div>
        {bond.isTaxExempt && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2 mt-2">
            <Shield className="w-3 h-3" /> Tax-exempt bond — no withholding tax on coupon payments
          </div>
        )}
      </div>

      <Button
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        disabled={subscribe.isPending || Number(amount) < Number(bond.minSubscription)}
        onClick={() => subscribe.mutate({ bondId: bond.id, amountUsd: Number(amount), acceptedTerms: true, paymentSource: channel as any })}
      >
        {subscribe.isPending ? "Processing..." : `Confirm Subscription — ${formatCurrency(amount, bond.currency)}`}
      </Button>
    </div>
  );
}

// ─── Coupon History Dialog ────────────────────────────────────────────────────

function CouponHistoryDialog({ subscriptionId }: { subscriptionId: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.diasporaBond.getCouponHistory.useQuery({ subscriptionId }, { enabled: open });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 text-xs"><Coins className="w-3 h-3 mr-1" /> Coupons</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Coupon Payment History</DialogTitle></DialogHeader>
        {isLoading && <div className="py-6 text-center text-muted-foreground">Loading...</div>}
        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-green-50">
                <div className="text-xs text-muted-foreground">Total Received</div>
                <div className="font-bold text-green-600">{formatCurrency(data.totalReceived)}</div>
              </div>
              <div className="p-3 rounded-lg bg-blue-50">
                <div className="text-xs text-muted-foreground">Payments</div>
                <div className="font-bold">{data.coupons.filter((c: any) => c.status === "paid").length}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50">
                <div className="text-xs text-muted-foreground">Scheduled</div>
                <div className="font-bold">{data.coupons.filter((c: any) => c.status === "scheduled").length}</div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>#</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.coupons.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.couponNumber}</TableCell>
                    <TableCell className="text-sm">{new Date(c.scheduledDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(c.grossAmount, c.currency)}</TableCell>
                    <TableCell className="text-right font-mono text-green-600">{formatCurrency(c.netAmount, c.currency)}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${c.status === "paid" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                        {c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Sell Bond Dialog ────────────────────────────────────────────────────────

function SellBondDialog({ subscription, onSuccess }: { subscription: any; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState("");
  const [askPrice, setAskPrice] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");

  const createSellOrder = trpc.diasporaBond.createSellOrder.useMutation({
    onSuccess: (data) => {
      toast.success("Sell order listed!", {
        description: `Ref: ${data.order.orderRef} · ${units} units @ ${formatCurrency(askPrice)} · Net proceeds: ${formatCurrency(data.netProceeds)}`,
      });
      setOpen(false);
      setUnits("");
      setAskPrice("");
      onSuccess();
    },
    onError: (e) => toast.error("Failed to list sell order", { description: e.message }),
  });

  const maxUnits = Number(subscription.units ?? 0);
  const totalAsk = Number(units || 0) * Number(askPrice || 0);
  const platformFee = totalAsk * 0.005; // 0.5% fee
  const netProceeds = totalAsk - platformFee;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs h-7 border-orange-300 text-orange-700 hover:bg-orange-50">
          Sell
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>List Bond for Sale</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="p-3 rounded-lg bg-slate-50 text-sm space-y-1">
            <div className="font-medium">{subscription.bond?.name ?? `Bond #${subscription.bondId}`}</div>
            <div className="text-muted-foreground">Issuer: {subscription.bond?.issuer}</div>
            <div className="text-muted-foreground">Available units: <span className="font-mono font-medium text-foreground">{maxUnits.toFixed(4)}</span></div>
          </div>
          <div className="space-y-1">
            <Label>Units to Sell</Label>
            <Input
              type="number"
              placeholder={`Max ${maxUnits.toFixed(4)}`}
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              min="0.0001"
              max={maxUnits}
              step="0.0001"
            />
          </div>
          <div className="space-y-1">
            <Label>Ask Price per Unit (USD)</Label>
            <Input
              type="number"
              placeholder="e.g. 1050.00"
              value={askPrice}
              onChange={(e) => setAskPrice(e.target.value)}
              min="0.01"
              step="0.01"
            />
            {subscription.bond?.faceValue && (
              <p className="text-xs text-muted-foreground">Face value: {formatCurrency(subscription.bond.faceValue)}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Listing Expires In</Label>
            <Select value={expiresInDays} onValueChange={setExpiresInDays}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 day</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {units && askPrice && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Ask</span><span className="font-mono">{formatCurrency(totalAsk)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Platform Fee (0.5%)</span><span className="font-mono text-red-600">-{formatCurrency(platformFee)}</span></div>
              <div className="flex justify-between font-semibold"><span>Net Proceeds</span><span className="font-mono text-emerald-700">{formatCurrency(netProceeds)}</span></div>
            </div>
          )}
          <Button
            className="w-full bg-orange-600 hover:bg-orange-700 text-white"
            disabled={!units || !askPrice || Number(units) <= 0 || Number(units) > maxUnits || Number(askPrice) <= 0 || createSellOrder.isPending}
            onClick={() => createSellOrder.mutate({
              subscriptionId: subscription.id,
              unitsToSell: Number(units),
              askPriceUsd: Number(askPrice),
              expiresInDays: Number(expiresInDays),
            })}
          >
            {createSellOrder.isPending ? "Listing..." : "List for Sale"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DiasporaBondMarket() {
  const [activeTab, setActiveTab] = useState("marketplace");
  const [selectedBond, setSelectedBond] = useState<any>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [buyingOrderId, setBuyingOrderId] = useState<number | null>(null);

  const { data: bonds, refetch: refetchBonds } = trpc.diasporaBond.listBonds.useQuery({ status: "open" });
  const { data: portfolioData, refetch: refetchPortfolio } = trpc.diasporaBond.getMySubscriptions.useQuery();
  const portfolio = portfolioData?.subscriptions ?? [];
  const { data: secondaryOrders, refetch: refetchSecondary } = trpc.diasporaBond.listSecondaryOrders.useQuery({ side: "sell" });

  const fillBuyOrder = trpc.diasporaBond.fillBuyOrder.useMutation({
    onSuccess: (data) => {
      toast.success("Bond purchased!", { description: `Ref: ${data.buyerSubscriptionRef} · Settlement T+2` });
      setBuyingOrderId(null);
      refetchPortfolio();
      refetchSecondary();
      setActiveTab("portfolio");
    },
    onError: (e) => { toast.error("Purchase failed", { description: e.message }); setBuyingOrderId(null); },
  });

  const filteredBonds = useMemo(() => {
    if (!bonds) return [];
    if (typeFilter === "all") return bonds;
    return bonds.filter((b: any) => b.bondType === typeFilter);
  }, [bonds, typeFilter]);

  const portfolioStats = useMemo(() => {
    if (!portfolio) return { totalInvested: 0, totalValue: 0, totalCoupons: 0, activeCount: 0 };
    return {
      totalInvested: portfolio.reduce((s: number, p: any) => s + Number(p.totalPaid), 0),
      totalValue: portfolio.reduce((s: number, p: any) => s + Number(p.currentValue ?? p.totalPaid), 0),
      totalCoupons: portfolio.reduce((s: number, p: any) => s + Number(p.totalCouponsReceived ?? 0), 0),
      activeCount: portfolio.filter((p: any) => p.status === "active").length,
    };
  }, [portfolio]);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-600" /> Diaspora Bond Marketplace
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Invest in sovereign, corporate, green, and infrastructure bonds from your home country
            </p>
          </div>
        </div>

        {/* Portfolio Summary (if any holdings) */}
        {portfolio && portfolio.length > 0 && (
          <div className="grid grid-cols-4 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm text-muted-foreground">Total Invested</span>
                </div>
                <div className="text-2xl font-bold">{formatCurrency(portfolioStats.totalInvested)}</div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  <span className="text-sm text-muted-foreground">Current Value</span>
                </div>
                <div className="text-2xl font-bold">{formatCurrency(portfolioStats.totalValue)}</div>
                <div className={`text-xs mt-0.5 ${portfolioStats.totalValue >= portfolioStats.totalInvested ? "text-green-600" : "text-red-500"}`}>
                  {portfolioStats.totalValue >= portfolioStats.totalInvested ? <ArrowUpRight className="inline w-3 h-3" /> : <ArrowDownRight className="inline w-3 h-3" />}
                  {formatCurrency(Math.abs(portfolioStats.totalValue - portfolioStats.totalInvested))} unrealised
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Coins className="w-4 h-4 text-yellow-600" />
                  <span className="text-sm text-muted-foreground">Coupons Received</span>
                </div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(portfolioStats.totalCoupons)}</div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="w-4 h-4 text-purple-600" />
                  <span className="text-sm text-muted-foreground">Active Holdings</span>
                </div>
                <div className="text-2xl font-bold">{portfolioStats.activeCount}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{portfolio.length} total subscriptions</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="marketplace"><Globe2 className="w-4 h-4 mr-1" /> Marketplace</TabsTrigger>
            <TabsTrigger value="portfolio"><BarChart3 className="w-4 h-4 mr-1" /> My Portfolio</TabsTrigger>
            <TabsTrigger value="secondary"><RefreshCw className="w-4 h-4 mr-1" /> Secondary Market</TabsTrigger>
          </TabsList>

          {/* ── Marketplace ── */}
          <TabsContent value="marketplace" className="space-y-4">
            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              {["all", "sovereign", "corporate", "green", "infrastructure", "diaspora"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-all capitalize ${
                    typeFilter === t ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-medium" : "border-border hover:border-emerald-300"
                  }`}
                >
                  {t === "all" ? "All Bonds" : BOND_TYPE_CONFIG[t]?.label ?? t}
                </button>
              ))}
            </div>

            {/* Bond Grid */}
            {!filteredBonds || filteredBonds.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center">
                  <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
                  <h3 className="text-lg font-semibold">No bonds available</h3>
                  <p className="text-muted-foreground text-sm mt-1">Check back soon for new bond offerings.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredBonds.map((bond: any) => (
                  <BondCard
                    key={bond.id}
                    bond={bond}
                    onSubscribe={(b) => { setSelectedBond(b); setSubscribeOpen(true); }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Portfolio ── */}
          <TabsContent value="portfolio">
            {!portfolio || portfolio.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center">
                  <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
                  <h3 className="text-lg font-semibold">No bond holdings yet</h3>
                  <p className="text-muted-foreground text-sm mt-1 mb-4">Browse the marketplace and subscribe to your first bond.</p>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setActiveTab("marketplace")}>
                    Browse Bonds
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>Bond</TableHead>
                        <TableHead>Ref</TableHead>
                        <TableHead className="text-right">Invested</TableHead>
                        <TableHead className="text-right">Current Value</TableHead>
                        <TableHead className="text-right">Coupons Received</TableHead>
                        <TableHead>Maturity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolio.map((sub: any) => {
                        const sc = SUB_STATUS_CONFIG[sub.status] ?? SUB_STATUS_CONFIG.active;
                        const gain = Number(sub.currentValue ?? sub.totalPaid) - Number(sub.totalPaid);
                        return (
                          <TableRow key={sub.id}>
                            <TableCell>
                              <div className="font-medium text-sm">{sub.bond?.name ?? `Bond #${sub.bondId}`}</div>
                              <div className="text-xs text-muted-foreground">{sub.bond?.issuer}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{sub.subscriptionRef}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(sub.totalPaid, sub.currency)}</TableCell>
                            <TableCell className="text-right font-mono">
                              <div>{formatCurrency(sub.currentValue ?? sub.totalPaid, sub.currency)}</div>
                              <div className={`text-xs ${gain >= 0 ? "text-green-600" : "text-red-500"}`}>
                                {gain >= 0 ? "+" : ""}{formatCurrency(gain, sub.currency)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-green-600">
                              {formatCurrency(sub.totalCouponsReceived ?? 0, sub.currency)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {sub.bond?.maturityDate ? new Date(sub.bond.maturityDate).toLocaleDateString() : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs flex items-center gap-1 w-fit ${sc.color}`}>
                                {sc.icon} {sc.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <CouponHistoryDialog subscriptionId={sub.id} />
                                {sub.status === "active" && (
                                  <SellBondDialog
                                    subscription={sub}
                                    onSuccess={() => { refetchPortfolio(); refetchSecondary(); }}
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Secondary Market ── */}
          <TabsContent value="secondary">
            <div className="mb-4 p-4 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-700 flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <strong>Secondary Market:</strong> Buy and sell bonds before maturity at market-determined prices. Prices reflect current yield curve and accrued interest. Settlement T+2.
              </div>
            </div>
            {!secondaryOrders || secondaryOrders.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>No secondary market orders at this time.</p>
                  <p className="text-xs mt-1">Holders can list their bonds for sale from their portfolio.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>Bond</TableHead>
                        <TableHead className="text-right">Units</TableHead>
                        <TableHead className="text-right">Ask Price</TableHead>
                        <TableHead className="text-right">Face Value</TableHead>
                        <TableHead className="text-right">Accrued Interest</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {secondaryOrders.map((order: any) => (
                        <TableRow key={order.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{order.bond?.name ?? `Bond #${order.bondId}`}</div>
                            <div className="text-xs text-muted-foreground">{order.bond?.issuer}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">{order.units}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">{formatCurrency(order.askPrice, order.currency)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(order.faceValue, order.currency)}</TableCell>
                          <TableCell className="text-right font-mono text-emerald-600">{formatCurrency(order.accruedInterest ?? 0, order.currency)}</TableCell>
                          <TableCell className="text-sm">{order.expiresAt ? new Date(order.expiresAt).toLocaleDateString() : "GTC"}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7"
                              disabled={buyingOrderId === order.id || fillBuyOrder.isPending}
                              onClick={() => {
                                setBuyingOrderId(order.id);
                                fillBuyOrder.mutate({ orderId: order.id });
                              }}
                            >
                              {buyingOrderId === order.id ? "Processing..." : (<>Buy <ChevronRight className="w-3 h-3 ml-0.5" /></>)}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Subscribe Dialog */}
        <Dialog open={subscribeOpen} onOpenChange={setSubscribeOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Subscribe to Bond</DialogTitle>
            </DialogHeader>
            {selectedBond && (
              <SubscribeDialog
                bond={selectedBond}
                onClose={() => setSubscribeOpen(false)}
                onSuccess={() => { setSubscribeOpen(false); refetchPortfolio(); refetchBonds(); setActiveTab("portfolio"); }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
