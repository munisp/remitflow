import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { DollarSign, TrendingDown, Award, History, Calculator, Zap, Star, ChevronRight } from "lucide-react";

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "UGX", "TZS"];

export default function FeeNegotiationPage() {
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [amount, setAmount] = useState("1000");
  const [queryEnabled, setQueryEnabled] = useState(false);

  const { data: tiers, isLoading: tiersLoading } = trpc.v99.feeNegotiation.getFeeTiers.useQuery(
    { fromCurrency, toCurrency, amount: parseFloat(amount) || 1000 },
    { enabled: queryEnabled && parseFloat(amount) > 0 }
  );

  const { data: history } = trpc.v99.feeNegotiation.history.useQuery({ days: 30 });

  const negotiateMutation = trpc.v99.feeNegotiation.negotiate.useMutation({
    onSuccess: (data) => {
      toast.success(`Fee negotiated! ${data.loyaltyDiscount}% loyalty discount applied`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCalculate = () => {
    if (!parseFloat(amount) || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    setQueryEnabled(true);
  };

  const handleNegotiate = () => {
    negotiateMutation.mutate({ fromCurrency, toCurrency, amount: parseFloat(amount) });
  };

  const tierColors: Record<string, string> = {
    standard: "bg-slate-100 text-slate-700 border-slate-200",
    preferred: "bg-blue-50 text-blue-700 border-blue-200",
    premium: "bg-purple-50 text-purple-700 border-purple-200",
    enterprise: "bg-amber-50 text-amber-700 border-amber-200",
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Fee Negotiation Engine</h1>
            <p className="text-muted-foreground text-sm">Dynamic fee tiers, loyalty discounts, and corridor pricing</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Calculator */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4 text-primary" /> Fee Calculator
              </CardTitle>
              <CardDescription>Calculate fees and negotiate loyalty discounts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From Currency</Label>
                  <Select value={fromCurrency} onValueChange={setFromCurrency}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>To Currency</Label>
                  <Select value={toCurrency} onValueChange={setToCurrency}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Transfer Amount ({fromCurrency})</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setQueryEnabled(false); }}
                  placeholder="1000"
                  min="1"
                />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleCalculate} disabled={tiersLoading}>
                  <Calculator className="h-4 w-4 mr-2" /> Calculate Fees
                </Button>
                <Button variant="outline" onClick={handleNegotiate} disabled={negotiateMutation.isPending}>
                  <Star className="h-4 w-4 mr-2" /> Negotiate
                </Button>
              </div>

              {/* Negotiation result */}
              {negotiateMutation.data && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-emerald-700">
                    <Award className="h-4 w-4" /> Negotiated Fee
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Loyalty Discount</span>
                    <Badge className="bg-emerald-100 text-emerald-700">{negotiateMutation.data.loyaltyDiscount}% off</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Original Rate</span>
                    <span>{(negotiateMutation.data.originalFeeRate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-muted-foreground">Your Rate</span>
                    <span className="text-emerald-700">{(negotiateMutation.data.negotiatedFeeRate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Final Fee</span>
                    <span className="text-emerald-700">{negotiateMutation.data.fee.toFixed(2)} {fromCurrency}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{negotiateMutation.data.message}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fee Tiers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="h-4 w-4 text-primary" /> Fee Tiers
              </CardTitle>
              <CardDescription>Volume-based pricing for {fromCurrency}→{toCurrency}</CardDescription>
            </CardHeader>
            <CardContent>
              {tiers ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Corridor</span>
                    <Badge variant="outline">{tiers.corridor}</Badge>
                  </div>
                  {tiers.tiers.map((tier) => (
                    <div
                      key={tier.tier}
                      className={`rounded-lg border p-3 ${tier.tier === tiers.applicableTier ? tierColors[tier.tier] + " ring-2 ring-primary/30" : "bg-muted/30 border-border"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{tier.label}</span>
                          {tier.tier === tiers.applicableTier && (
                            <Badge className="text-xs bg-primary text-primary-foreground">Your Tier</Badge>
                          )}
                        </div>
                        <span className="font-bold text-sm">{(tier.feeRate * 100).toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>${tier.minAmount.toLocaleString()} – ${tier.maxAmount.toLocaleString()}</span>
                        <span>Min fee: ${tier.flatFee}</span>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Your Fee</span>
                    <span className="text-primary">{tiers.calculatedFee.toFixed(2)} {fromCurrency}</span>
                  </div>
                  {tiers.savings > 0 && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <Zap className="h-3.5 w-3.5" />
                      You save {tiers.savings.toFixed(2)} {fromCurrency} vs standard rate ({tiers.discountPct}% off)
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <Calculator className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Enter an amount and click Calculate to see fee tiers</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Fee History */}
        {history && history.summary.count > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-primary" /> Fee History (Last 30 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-3 rounded-lg bg-muted/40">
                  <p className="text-2xl font-bold">{history.summary.count}</p>
                  <p className="text-xs text-muted-foreground">Transfers</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/40">
                  <p className="text-2xl font-bold">${history.summary.totalFees.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Total Fees Paid</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/40">
                  <p className="text-2xl font-bold">{history.summary.avgFeeRate}%</p>
                  <p className="text-xs text-muted-foreground">Avg Fee Rate</p>
                </div>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.transactions.slice(0, 10).map((tx, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <span className="text-muted-foreground">{new Date(tx.date!).toLocaleDateString()}</span>
                    <span>{tx.amount.toFixed(2)} {tx.currency}</span>
                    <span className="font-medium">${tx.fee.toFixed(2)} fee</span>
                    <Badge variant="outline" className="text-xs">{(tx.feeRate * 100).toFixed(2)}%</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
