import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Wallet, ArrowUpRight, ArrowDownLeft, Plus, Eye, EyeOff, TrendingUp, RefreshCw, Send, Download, RefreshCcw, Receipt, Building2, ArrowLeftRight, Info, CheckCircle2, ExternalLink, CreditCard } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

// PayPal SVG icon
function PayPalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" fill="#003087"/>
    </svg>
  );
}

// Flutterwave SVG icon
function FlutterwaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#F5A623"/>
      <path d="M8 8.5c1.5-1 3.5-1 5 0s3 2.5 3 4-1 3-2.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M7 11c1-1.5 2.5-2 4-1.5s2.5 2 2 3.5-1.5 2.5-3 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export default function WalletPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = trpc.wallet.balances.useQuery();
  const { data: history } = trpc.wallet.history.useQuery();

  // Mutations
  const topupMutation = trpc.wallet.topup.useMutation({
    onSuccess: (res) => {
      toast.success(`Top-up successful! New balance: ${res.currency} ${Number(res.newBalance).toLocaleString()}`);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const paypalTopupMutation = trpc.wallet.paypalTopup.useMutation({
    onSuccess: (res) => {
      setPaypalOrderId(res.orderId);
      setPaypalApprovalUrl(res.approvalUrl);
      toast.success("PayPal order created! Click the link to approve payment.");
      window.open(res.approvalUrl, "_blank");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const paypalCaptureMutation = trpc.wallet.paypalCapture.useMutation({
    onSuccess: (res) => {
      toast.success(`PayPal payment confirmed! New balance: ${selectedCurrency} ${Number(res.newBalance).toLocaleString()}`);
      setPaypalOrderId(null);
      setPaypalApprovalUrl(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const flutterwaveTopupMutation = trpc.wallet.flutterwaveTopup.useMutation({
    onSuccess: (res) => {
      setFlwTxRef(res.txRef);
      setFlwPaymentLink(res.paymentLink);
      toast.success("Flutterwave checkout created! Click the link to pay.");
      window.open(res.paymentLink, "_blank");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const stripeTopupMutation = trpc.wallet.stripeTopup.useMutation({
    onSuccess: (res) => {
      if (res.checkoutUrl) {
        toast.success("Redirecting to Stripe checkout…");
        window.open(res.checkoutUrl, "_blank");
      }
    },
    onError: (e: any) => toast.error("Stripe error: " + e.message),
  });
  const flutterwaveVerifyMutation = trpc.wallet.flutterwaveVerify.useMutation({
    onSuccess: (res) => {
      toast.success(`Flutterwave payment verified! New balance: ${selectedCurrency} ${Number(res.newBalance).toLocaleString()}`);
      setFlwTxRef(null);
      setFlwPaymentLink(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const withdrawMutation = trpc.wallet.withdraw.useMutation({
    onSuccess: () => { toast.success("Withdrawal initiated!"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [hideBalances, setHideBalances] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("NGN");
  // PayPal state
  const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null);
  const [paypalApprovalUrl, setPaypalApprovalUrl] = useState<string | null>(null);
  // Flutterwave state
  const [flwTxRef, setFlwTxRef] = useState<string | null>(null);
  const [flwPaymentLink, setFlwPaymentLink] = useState<string | null>(null);
  const [flwCurrency, setFlwCurrency] = useState("NGN");
  // Stripe state
  const [stripeCurrency, setStripeCurrency] = useState("usd");

  // Currency conversion calculator
  const { data: fxRates } = trpc.fx.rates.useQuery();
  const conversionTargets = ["USD", "GBP", "EUR", "NGN", "KES", "GHS"].filter(c => c !== selectedCurrency);
  const conversions = useMemo(() => {
    if (!fxRates || !topupAmount || parseFloat(topupAmount) <= 0) return [];
    const amount = parseFloat(topupAmount);
    const rateMap: Record<string, number> = {};
    (fxRates as any[]).forEach((r: any) => { rateMap[r.currency] = r.rate; });
    const baseRate = rateMap[selectedCurrency] ?? 1;
    return conversionTargets.map(target => {
      const targetRate = rateMap[target] ?? 1;
      const converted = (amount / baseRate) * targetRate;
      return { currency: target, amount: converted };
    });
  }, [fxRates, topupAmount, selectedCurrency, conversionTargets]);

  const feeEstimate = useMemo(() => {
    const amt = parseFloat(topupAmount) || 0;
    if (amt <= 0) return null;
    const paypalFee = amt * 0.0349 + 0.49;
    const flwFee = amt * 0.014;
    return {
      paypalFee: parseFloat(paypalFee.toFixed(2)), paypalFeePercent: "3.49% + $0.49",
      flwFee: parseFloat(flwFee.toFixed(2)), flwFeePercent: "1.4%",
    };
  }, [topupAmount]);

  // Handle redirect callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("topup");
    if (status === "success") {
      toast.success("Payment successful! Your wallet will be credited shortly.", { duration: 6000 });
      refetch();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "cancelled") {
      toast.info("Payment cancelled. No charge was made.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "paypal_success") {
      toast.success("PayPal payment approved! Please confirm to credit your wallet.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "flw_success") {
      toast.success("Flutterwave payment completed! Please verify to credit your wallet.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const totalUSD = data?.reduce((sum: any, b: any) => sum + b.usdEquivalent, 0) ?? 0;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">My Wallet</h1>
              <p className="text-muted-foreground text-sm">Multi-currency balances</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setHideBalances(!hideBalances)}>
            {hideBalances ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </Button>
        </div>

        {/* Total Balance Card */}
        <Card className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-0">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 opacity-80" />
              <span className="text-sm opacity-80">Total Portfolio Value</span>
            </div>
            <div className="text-4xl font-bold mb-1">
              {hideBalances ? "••••••" : `$${totalUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
            </div>
            <div className="text-sm opacity-70">Across all currencies</div>
            {/* Quick Actions */}
            <div className="grid grid-cols-4 gap-2 mt-5">
              {[
                { icon: Send, label: "Send", path: "/send" },
                { icon: Download, label: "Receive", path: "/receive" },
                { icon: RefreshCcw, label: "Exchange", path: "/exchange" },
                { icon: Receipt, label: "Bills", path: "/bills" },
              ].map(({ icon: Icon, label, path }) => (
                <button key={label} onClick={() => setLocation(path)}
                  className="flex flex-col items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors py-2.5 px-1">
                  <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <span className="text-[11px] text-white/90 font-medium">{label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-3">
              {/* Top-Up Dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary" className="bg-white/20 hover:bg-white/30 text-white border-0">
                    <Plus className="h-4 w-4 mr-1" /> Top Up
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Plus className="h-5 w-5 text-indigo-600" /> Top Up Wallet
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    {/* Amount + Currency */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Currency</Label>
                        <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background text-sm" value={selectedCurrency} onChange={e => setSelectedCurrency(e.target.value)}>
                          {["NGN","USD","GBP","EUR","KES","GHS"].map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label>Amount</Label>
                        <Input type="number" placeholder="0.00" min="1" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} className="mt-1" />
                      </div>
                    </div>

                    {/* Live Currency Conversion Calculator */}
                    {conversions.length > 0 && (
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-medium text-muted-foreground">Live Conversion</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">Live rates</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {conversions.map(conv => (
                            <div key={conv.currency} className="flex items-center justify-between bg-background rounded px-2 py-1.5">
                              <span className="text-xs font-medium text-muted-foreground">{conv.currency}</span>
                              <span className="text-xs font-bold">
                                {conv.amount >= 1000 ? conv.amount.toLocaleString("en", { maximumFractionDigits: 0 }) : conv.amount.toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fee Breakdown */}
                    {feeEstimate && (
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Info className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-muted-foreground">Fee Breakdown</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">PayPal fee</span>
                            <span className="font-medium">{selectedCurrency} {feeEstimate.paypalFee.toFixed(2)} <span className="text-muted-foreground">({feeEstimate.paypalFeePercent})</span></span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Flutterwave fee</span>
                            <span className="font-medium">{selectedCurrency} {feeEstimate.flwFee.toFixed(2)} <span className="text-muted-foreground">({feeEstimate.flwFeePercent})</span></span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Bank transfer fee</span>
                            <span className="font-medium text-green-600">Free</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Payment Method Tabs */}
                    <Tabs defaultValue="stripe" className="w-full">
                      <TabsList className="w-full grid grid-cols-4">
                        <TabsTrigger value="stripe" className="text-xs px-1"><CreditCard className="h-3.5 w-3.5 mr-1" /> Card</TabsTrigger>
                        <TabsTrigger value="paypal" className="text-xs px-1"><PayPalIcon className="h-3.5 w-3.5 mr-1" /> PayPal</TabsTrigger>
                        <TabsTrigger value="flutterwave" className="text-xs px-1"><FlutterwaveIcon className="h-3.5 w-3.5 mr-1" /> Flutterwave</TabsTrigger>
                        <TabsTrigger value="bank" className="text-xs px-1"><Building2 className="h-3.5 w-3.5 mr-1" /> Bank</TabsTrigger>
                      </TabsList>

                      {/* Stripe Card Tab */}
                      <TabsContent value="stripe" className="space-y-3 pt-3">
                        <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-3 text-sm text-violet-700 dark:text-violet-300">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Pay by Card (Stripe)</p>
                            <span className="text-[10px] bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-300 px-1.5 py-0.5 rounded-full font-medium">Secure</span>
                          </div>
                          <p className="text-xs opacity-80">Visa, Mastercard, and more. Powered by Stripe.</p>
                        </div>
                        <div>
                          <Label className="text-xs">Charge Currency</Label>
                          <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background text-sm" value={stripeCurrency} onChange={e => setStripeCurrency(e.target.value)}>
                            {["usd","eur","gbp","ngn","kes","ghs","zar"].map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                          </select>
                        </div>
                        <Button
                          className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                          onClick={() => {
                            const amt = parseFloat(topupAmount);
                            if (!amt || amt < 1) { toast.error("Minimum top-up is $1.00"); return; }
                            // Stripe amount is in smallest currency unit (cents)
                            const unitAmount = Math.round(amt * 100);
                            stripeTopupMutation.mutate({
                              amount: unitAmount,
                              currency: stripeCurrency,
                              walletCurrency: selectedCurrency,
                              origin: window.location.origin,
                            });
                          }}
                          disabled={stripeTopupMutation.isPending}
                        >
                          {stripeTopupMutation.isPending
                            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Creating Checkout…</>
                            : <><CreditCard className="h-4 w-4 mr-2" /> Pay with Card</>}
                        </Button>
                        {feeEstimate && (
                          <p className="text-[10px] text-muted-foreground text-center">Stripe fee: ~2.9% + $0.30 per transaction</p>
                        )}
                      </TabsContent>

                      {/* PayPal Tab */}
                      <TabsContent value="paypal" className="space-y-3 pt-3">
                        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium">Pay with PayPal</p>
                            <Badge variant="outline" className="text-[10px] bg-yellow-50 text-yellow-700 border-yellow-300">Sandbox</Badge>
                          </div>
                          <p className="text-xs">You'll be redirected to PayPal to approve the payment. Return here to confirm.</p>
                        </div>
                        {!paypalOrderId ? (
                          <Button className="w-full bg-[#003087] hover:bg-[#002070] text-white" onClick={() => {
                            if (!topupAmount || parseFloat(topupAmount) < 1) { toast.error("Minimum top-up is $1.00"); return; }
                            paypalTopupMutation.mutate({ amount: parseFloat(topupAmount), currency: "USD", walletCurrency: selectedCurrency });
                          }} disabled={paypalTopupMutation.isPending}>
                            {paypalTopupMutation.isPending
                              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Creating Order…</>
                              : <><PayPalIcon className="h-4 w-4 mr-2" /> Pay with PayPal</>}
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 p-3">
                              <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                                PayPal order created. Approve the payment in the new tab, then click Confirm below.
                              </p>
                              <a href={paypalApprovalUrl ?? "#"} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <ExternalLink className="h-3 w-3" /> Open PayPal approval page
                              </a>
                            </div>
                            <Button className="w-full" variant="default" onClick={() => {
                              if (!paypalOrderId) return;
                              paypalCaptureMutation.mutate({ orderId: paypalOrderId, walletCurrency: selectedCurrency, amount: parseFloat(topupAmount) || 0 });
                            }} disabled={paypalCaptureMutation.isPending}>
                              {paypalCaptureMutation.isPending
                                ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Confirming…</>
                                : <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirm PayPal Payment</>}
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => { setPaypalOrderId(null); setPaypalApprovalUrl(null); }}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </TabsContent>

                      {/* Flutterwave Tab */}
                      <TabsContent value="flutterwave" className="space-y-3 pt-3">
                        <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 text-sm text-orange-700 dark:text-orange-300">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium">Pay with Flutterwave</p>
                            <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-300">Test Mode</Badge>
                          </div>
                          <p className="text-xs">Supports NGN, KES, GHS and 30+ African currencies. You'll be redirected to Flutterwave checkout.</p>
                        </div>
                        <div>
                          <Label className="text-xs">Payment Currency</Label>
                          <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background text-sm" value={flwCurrency} onChange={e => setFlwCurrency(e.target.value)}>
                            {["NGN", "KES", "GHS", "ZAR", "UGX", "TZS", "XOF", "XAF"].map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        {!flwTxRef ? (
                          <Button className="w-full bg-[#F5A623] hover:bg-[#e09415] text-white" onClick={() => {
                            if (!topupAmount || parseFloat(topupAmount) < 100) { toast.error("Minimum top-up is 100 units"); return; }
                            flutterwaveTopupMutation.mutate({ amount: parseFloat(topupAmount), currency: flwCurrency, walletCurrency: selectedCurrency });
                          }} disabled={flutterwaveTopupMutation.isPending}>
                            {flutterwaveTopupMutation.isPending
                              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Creating Checkout…</>
                              : <><FlutterwaveIcon className="h-4 w-4 mr-2" /> Pay with Flutterwave</>}
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-3">
                              <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-2">
                                Flutterwave checkout created. Complete payment in the new tab, then click Verify below.
                              </p>
                              <a href={flwPaymentLink ?? "#"} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <ExternalLink className="h-3 w-3" /> Open Flutterwave checkout
                              </a>
                              <p className="text-[10px] text-muted-foreground mt-1">Ref: <code>{flwTxRef}</code></p>
                            </div>
                            <Button className="w-full" variant="default" onClick={() => {
                              if (!flwTxRef) return;
                              flutterwaveVerifyMutation.mutate({ txRef: flwTxRef, amount: parseFloat(topupAmount) || 0, walletCurrency: selectedCurrency });
                            }} disabled={flutterwaveVerifyMutation.isPending}>
                              {flutterwaveVerifyMutation.isPending
                                ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying…</>
                                : <><CheckCircle2 className="h-4 w-4 mr-2" /> Verify Flutterwave Payment</>}
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => { setFlwTxRef(null); setFlwPaymentLink(null); }}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </TabsContent>

                      {/* Bank Transfer Tab */}
                      <TabsContent value="bank" className="space-y-3 pt-3">
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-sm text-emerald-700 dark:text-emerald-300">
                          <p className="font-medium mb-1">Instant bank transfer (demo)</p>
                          <p className="text-xs">Funds credited immediately in demo mode. Production uses Flutterwave/Paystack.</p>
                        </div>
                        <Button className="w-full" variant="outline" onClick={() => {
                          if (!topupAmount || parseFloat(topupAmount) <= 0) { toast.error("Enter a valid amount"); return; }
                          topupMutation.mutate({ currency: selectedCurrency, amount: parseFloat(topupAmount), method: "bank_transfer" });
                        }} disabled={topupMutation.isPending}>
                          {topupMutation.isPending
                            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
                            : <><Building2 className="h-4 w-4 mr-2" /> Confirm Bank Transfer</>}
                        </Button>
                      </TabsContent>
                    </Tabs>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Withdraw Dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary" className="bg-white/20 hover:bg-white/30 text-white border-0">
                    <ArrowUpRight className="h-4 w-4 mr-1" /> Withdraw
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Withdraw Funds</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div>
                      <Label>Currency</Label>
                      <select className="w-full border rounded-md px-3 py-2 mt-1 bg-background" value={selectedCurrency} onChange={e => setSelectedCurrency(e.target.value)}>
                        {["NGN","USD","GBP","EUR","KES","GHS"].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Amount</Label>
                      <Input type="number" placeholder="0.00" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} className="mt-1" />
                    </div>
                    <Button className="w-full" onClick={() => withdrawMutation.mutate({ currency: selectedCurrency, amount: parseFloat(withdrawAmount) || 0, bankAccount: "default" })} disabled={withdrawMutation.isPending}>
                      {withdrawMutation.isPending ? "Processing…" : "Confirm Withdrawal"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        {/* Currency Balances */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Currency Balances</h2>
          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data?.map((bal: any) => (
                <Card key={bal.currency} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">{bal.flag}</div>
                        <div>
                          <div className="font-semibold text-sm">{bal.currency}</div>
                          <div className="text-xs text-muted-foreground">{bal.name}</div>
                        </div>
                      </div>
                      <Badge variant={Number(bal.change) >= 0 ? "default" : "destructive"} className="text-xs">
                        {Number(bal.change) >= 0 ? "+" : ""}{bal.change}%
                      </Badge>
                    </div>
                    <div className="text-xl font-bold">
                      {hideBalances ? "••••••" : `${bal.symbol}${Number(bal.balance ?? 0).toLocaleString()}`}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      ≈ ${hideBalances ? "••••" : Number(bal.usdEquivalent).toFixed(2)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            {history?.slice(0, 8).map((tx: any, i: any) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 border-b last:border-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${tx.type === "credit" ? "bg-emerald-100" : "bg-red-100"}`}>
                  {tx.type === "credit" ? <ArrowDownLeft className="h-4 w-4 text-emerald-600" /> : <ArrowUpRight className="h-4 w-4 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{tx.description}</div>
                  <div className="text-xs text-muted-foreground">{new Date(tx.date).toLocaleDateString()}</div>
                </div>
                <div className={`font-semibold text-sm ${tx.type === "credit" ? "text-emerald-600" : "text-red-500"}`}>
                  {tx.type === "credit" ? "+" : "-"}{tx.currency} {Number(tx.amount ?? 0).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
