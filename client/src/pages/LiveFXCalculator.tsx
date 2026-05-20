import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeftRight, TrendingUp, RefreshCw, Tag, Calculator, Clock, Info } from "lucide-react";

const CURRENCIES = [
  { code: "USD", flag: "🇺🇸", name: "US Dollar" },
  { code: "GBP", flag: "🇬🇧", name: "British Pound" },
  { code: "EUR", flag: "🇪🇺", name: "Euro" },
  { code: "NGN", flag: "🇳🇬", name: "Nigerian Naira" },
  { code: "KES", flag: "🇰🇪", name: "Kenyan Shilling" },
  { code: "GHS", flag: "🇬🇭", name: "Ghanaian Cedi" },
  { code: "ZAR", flag: "🇿🇦", name: "South African Rand" },
  { code: "UGX", flag: "🇺🇬", name: "Ugandan Shilling" },
  { code: "TZS", flag: "🇹🇿", name: "Tanzanian Shilling" },
  { code: "XOF", flag: "🌍", name: "West African CFA" },
  { code: "EGP", flag: "🇪🇬", name: "Egyptian Pound" },
  { code: "MAD", flag: "🇲🇦", name: "Moroccan Dirham" },
  { code: "SAR", flag: "🇸🇦", name: "Saudi Riyal" },
  { code: "AED", flag: "🇦🇪", name: "UAE Dirham" },
  { code: "CAD", flag: "🇨🇦", name: "Canadian Dollar" },
  { code: "AUD", flag: "🇦🇺", name: "Australian Dollar" },
  { code: "INR", flag: "🇮🇳", name: "Indian Rupee" },
  { code: "CNY", flag: "🇨🇳", name: "Chinese Yuan" },
];

function getCurrencyMeta(code: string) {
  return CURRENCIES.find(c => c.code === code) ?? { code, flag: "💱", name: code };
}

export default function LiveFXCalculator() {
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [sendAmount, setSendAmount] = useState("100");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const { data: calcResult, isLoading, refetch } = trpc.fxCalculator.convert.useQuery(
    { fromCurrency, toCurrency, amount: Number(sendAmount) || 100, promoCode: appliedPromo },
    { enabled: !!(fromCurrency && toCurrency && Number(sendAmount) > 0), refetchInterval: 30_000 }
  );

  const { data: promoResult } = trpc.promoValidate.validate.useQuery(
    { code: promoCode, amount: Number(sendAmount) || 100, fromCurrency },
    { enabled: !!(promoCode && promoCode.length >= 3) }
  );

  useEffect(() => {
    if (calcResult) setLastUpdated(new Date());
  }, [calcResult]);

  const handleSwap = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  const handleRefresh = () => {
    refetch();
    setLastUpdated(new Date());
    toast.success("Rates refreshed");
  };

  const handleApplyPromo = () => {
    if (!promoCode) return;
    if (promoResult?.valid) {
      setAppliedPromo(promoCode);
      toast.success(`Promo applied!`);
    } else {
      toast.error(promoResult?.message ?? "Invalid promo code");
    }
  };

  const fromMeta = getCurrencyMeta(fromCurrency);
  const toMeta = getCurrencyMeta(toCurrency);

  const convertedAmount = calcResult?.convertedAmount ?? 0;
  const rate = calcResult?.rate ?? 0;
  const finalFee = calcResult?.finalFee ?? 0;
  const discount = calcResult?.discount ?? 0;
  const totalDeducted = calcResult?.totalDeducted ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calculator className="h-6 w-6 text-primary" />
              Live FX Calculator
            </h1>
            <p className="text-muted-foreground">Real-time exchange rates with fee preview</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Calculator Card */}
        <Card className="border-primary/20">
          <CardContent className="p-6 space-y-6">
            {/* Send Amount */}
            <div>
              <Label className="text-base font-semibold mb-2 block">You Send</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={sendAmount}
                  onChange={e => setSendAmount(e.target.value)}
                  className="text-xl font-bold h-14 flex-1"
                  min="1"
                />
                <Select value={fromCurrency} onValueChange={setFromCurrency}>
                  <SelectTrigger className="w-36 h-14">
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        <span>{fromMeta.flag}</span>
                        <span className="font-semibold">{fromCurrency}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        <span className="flex items-center gap-2">{c.flag} {c.code} — {c.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Swap Button + Rate */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-border" />
              <div className="flex flex-col items-center gap-1">
                <Button variant="outline" size="icon" className="rounded-full h-10 w-10" onClick={handleSwap}>
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
                {rate > 0 && (
                  <div className="text-xs text-muted-foreground text-center">
                    <span className="font-medium">1 {fromCurrency} = {rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {toCurrency}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Receive Amount */}
            <div>
              <Label className="text-base font-semibold mb-2 block">Recipient Gets</Label>
              <div className="flex gap-2">
                <div className="flex-1 bg-muted/50 rounded-md border h-14 flex items-center px-4">
                  {isLoading ? (
                    <span className="text-muted-foreground">Calculating...</span>
                  ) : (
                    <span className="text-xl font-bold text-primary">
                      {convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <Select value={toCurrency} onValueChange={setToCurrency}>
                  <SelectTrigger className="w-36 h-14">
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        <span>{toMeta.flag}</span>
                        <span className="font-semibold">{toCurrency}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        <span className="flex items-center gap-2">{c.flag} {c.code} — {c.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Promo Code */}
            <div>
              <Label className="flex items-center gap-1.5 mb-2">
                <Tag className="h-3.5 w-3.5 text-green-500" />
                Promo Code
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter promo code"
                  value={promoCode}
                  onChange={e => setPromoCode(e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  onClick={handleApplyPromo}
                  disabled={!promoCode}
                >
                  Apply
                </Button>
                {appliedPromo && (
                  <Button variant="ghost" onClick={() => { setAppliedPromo(undefined); setPromoCode(""); }}>Clear</Button>
                )}
              </div>
              {promoResult?.valid && promoCode && (
                <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5" /> Valid promo code
                </p>
              )}
              {promoResult && !promoResult.valid && promoCode && (
                <p className="text-sm text-red-500 mt-1">{promoResult.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fee Breakdown */}
        {calcResult && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                Fee Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Send amount</span>
                <span className="font-medium">{Number(sendAmount).toFixed(2)} {fromCurrency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transfer fee</span>
                <span className="font-medium">{finalFee.toFixed(2)} {fromCurrency}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Promo discount</span>
                  <span className="font-medium">-{discount.toFixed(2)} {fromCurrency}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Total deducted</span>
                <span>{totalDeducted.toFixed(2)} {fromCurrency}</span>
              </div>
              <div className="flex justify-between text-primary font-bold text-base">
                <span>Recipient receives</span>
                <span>{convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {toCurrency}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last updated</span>
                <span>{lastUpdated.toLocaleTimeString()}</span>
              </div>
              {calcResult.estimatedArrival && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Estimated arrival</span>
                  <Badge variant="outline" className="text-xs py-0">{calcResult.estimatedArrival}</Badge>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Popular Corridors */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Popular Corridors</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["USD", "NGN"], ["GBP", "NGN"], ["EUR", "NGN"],
                ["USD", "KES"], ["USD", "GHS"], ["USD", "ZAR"],
              ].map(([from, to]) => (
                <button
                  key={`${from}-${to}`}
                  className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50 transition-colors text-sm"
                  onClick={() => { setFromCurrency(from); setToCurrency(to); }}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{getCurrencyMeta(from).flag}</span>
                    <span className="font-medium">{from}</span>
                    <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                    <span>{getCurrencyMeta(to).flag}</span>
                    <span className="font-medium">{to}</span>
                  </span>
                  <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="flex gap-3">
          <Button className="flex-1" size="lg" onClick={() => window.location.href = "/send-money"}>
            Send Money Now
          </Button>
          <Button variant="outline" className="flex-1" size="lg" onClick={() => window.location.href = "/rate-alerts"}>
            Set Rate Alert
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
