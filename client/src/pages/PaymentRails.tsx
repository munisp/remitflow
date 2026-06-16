import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowRightLeft, RefreshCw, TrendingUp, Globe, Zap, Clock,
  CheckCircle2, AlertCircle, Search, Send, DollarSign, Activity
} from "lucide-react";

const RAILS = [
  { id: "cips", name: "CIPS", fullName: "China Interbank Payment System", flag: "🇨🇳", currency: "CNY", color: "bg-red-500", settlementTime: "2h", region: "China" },
  { id: "upi", name: "UPI", fullName: "Unified Payments Interface", flag: "🇮🇳", currency: "INR", color: "bg-orange-500", settlementTime: "30s", region: "India" },
  { id: "pix", name: "PIX", fullName: "Brazil Instant Payment", flag: "🇧🇷", currency: "BRL", color: "bg-green-500", settlementTime: "10s", region: "Brazil" },
  { id: "mojaloop", name: "Mojaloop", fullName: "Open-Source FSPIOP", flag: "🌍", currency: "KES", color: "bg-blue-500", settlementTime: "60s", region: "Africa" },
  { id: "swift", name: "SWIFT", fullName: "Society for Worldwide Interbank Financial Telecommunication", flag: "🌐", currency: "USD", color: "bg-purple-500", settlementTime: "1-2d", region: "Global" },
  { id: "sepa", name: "SEPA", fullName: "Single Euro Payments Area", flag: "🇪🇺", currency: "EUR", color: "bg-indigo-500", settlementTime: "4h", region: "Europe" },
  { id: "ach", name: "ACH", fullName: "Automated Clearing House", flag: "🇺🇸", currency: "USD", color: "bg-sky-500", settlementTime: "1-3d", region: "USA" },
  { id: "faster_payments", name: "Faster Payments", fullName: "UK Faster Payments Scheme", flag: "🇬🇧", currency: "GBP", color: "bg-teal-500", settlementTime: "5s", region: "UK" },
];

const RAIL_CURRENCIES: Record<string, string[]> = {
  cips: ["CNY", "HKD", "TWD", "SGD", "MYR"],
  upi: ["INR", "USD", "GBP", "EUR", "AED"],
  pix: ["BRL", "USD", "EUR", "GBP"],
  mojaloop: ["KES", "TZS", "UGX", "RWF", "NGN", "GHS"],
  swift: ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD"],
  sepa: ["EUR", "DKK", "SEK", "NOK", "CHF", "PLN"],
  ach: ["USD", "MXN", "CAD"],
  faster_payments: ["GBP", "EUR", "USD"],
};

export default function PaymentRails() {
  const { t } = useTranslation();
  const [selectedRail, setSelectedRail] = useState("cips");
  const [fromAmount, setFromAmount] = useState("1000");
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("CNY");
  const [recipientId, setRecipientId] = useState("");
  const [form, setForm] = useState({ recipientId: "", amount: "", rail: "cips", toCurrency: "CNY", reference: "" });
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const { data: ratesData, refetch: refetchRates, isFetching: ratesFetching } = trpc.v90.paymentRails.getLiveRates.useQuery(
    { from: fromCurrency },
    { refetchInterval: 30000 } // Auto-refresh every 30s
  );

  const { data: supportedRails } = trpc.v90.paymentRails.getSupportedRails.useQuery();

  const [lookupInput, setLookupInput] = useState<{rail: "cips"|"upi"|"pix"|"mojaloop", recipientId: string, bankCode?: string} | null>(null);
  const { data: lookupData, isFetching: lookupFetching } = trpc.v90.paymentRails.lookupRecipient.useQuery(
    lookupInput ?? { rail: "cips", recipientId: "" },
    {
      enabled: !!lookupInput && !!lookupInput.recipientId,
    }
  );
  // Handle lookup result changes
  const prevLookupData = (lookupData as any);
  React.useEffect(() => {
    if (lookupData) {
      setLookupResult(lookupData as any);
      toast.success("Recipient found", { description: `${(lookupData as any).name} — ${(lookupData as any).accountType}` });
    }
  }, [lookupData]);
  const lookup = { mutate: (input: any) => setLookupInput(input), isPending: lookupFetching,
    onError: (err: any) => toast.error("Lookup failed", { description: err.message }),
  };

  const transfer = trpc.v90.paymentRails.initiateRailTransfer.useMutation({
    onSuccess: (data) => {
      toast.success("Transfer Initiated", { description: `Reference: ${data.externalRef || data.status}` });
      setForm({ recipientId: "", amount: "", rail: "cips", toCurrency: "CNY", reference: "" });
      setLookupResult(null);
    },
    onError: (err) => toast.error("Transfer Failed", { description: err.message }),
  });

  const handleRefreshRates = useCallback(() => {
    refetchRates();
    setLastRefresh(new Date());
  }, [refetchRates]);

  // Auto-update toCurrency when rail changes
  useEffect(() => {
    const rail = RAILS.find((r) => r.id === selectedRail);
    if (rail) {
      setToCurrency(rail.currency);
      setForm((f) => ({ ...f, rail: selectedRail, toCurrency: rail.currency }));
    }
  }, [selectedRail]);

  // Compute converted amount
  const rate = ratesData?.rates?.[toCurrency]?.rate ?? 1;
  const convertedAmount = fromAmount ? (parseFloat(fromAmount) * rate).toFixed(2) : "0.00";
  const change24h = ratesData?.rates?.[toCurrency]?.change24h ?? 0;
  const rateSource = ratesData?.rates?.[toCurrency]?.source ?? "fallback";

  const currentRail = RAILS.find((r) => r.id === selectedRail)!;
  const availableCurrencies = RAIL_CURRENCIES[selectedRail] || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6" />
              Payment Rails
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              CIPS · UPI · PIX · Mojaloop · SWIFT · SEPA · ACH · Faster Payments
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefreshRates} disabled={ratesFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${ratesFetching ? "animate-spin" : ""}`} />
            {ratesFetching ? "Refreshing..." : `Rates · ${lastRefresh.toLocaleTimeString()}`}
          </Button>
        </div>

        {/* Rail Selector Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {RAILS.map((rail) => (
            <button
              key={rail.id}
              onClick={() => setSelectedRail(rail.id)}
              className={`rounded-lg border p-2 text-center transition-all hover:shadow-md ${
                selectedRail === rail.id
                  ? "border-primary bg-primary/10 shadow-md"
                  : "border-muted bg-card hover:border-primary/50"
              }`}
            >
              <div className="text-xl">{rail.flag}</div>
              <div className="text-xs font-bold mt-1">{rail.name}</div>
              <div className="text-xs text-muted-foreground">{rail.region}</div>
            </button>
          ))}
        </div>

        {/* Current Rail Info */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-3xl">{currentRail.flag}</div>
              <div>
                <div className="font-bold text-lg">{currentRail.name} — {currentRail.fullName}</div>
                <div className="text-sm text-muted-foreground">{currentRail.region}</div>
              </div>
              <div className="flex gap-3 ml-auto flex-wrap">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Settlement</div>
                  <div className="font-semibold flex items-center gap-1"><Clock className="h-3 w-3" />{currentRail.settlementTime}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Currency</div>
                  <div className="font-semibold">{currentRail.currency}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Rate Source</div>
                  <Badge variant={rateSource === "live" ? "default" : "secondary"} className="text-xs">
                    {rateSource === "live" ? "🟢 Live" : "🟡 Fallback"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="convert">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="convert"><ArrowRightLeft className="h-4 w-4 mr-2" />Convert</TabsTrigger>
            <TabsTrigger value="send"><Send className="h-4 w-4 mr-2" />Send</TabsTrigger>
            <TabsTrigger value="rates"><TrendingUp className="h-4 w-4 mr-2" />All Rates</TabsTrigger>
          </TabsList>

          {/* ─── Live Currency Conversion ─────────────────────────────────────── */}
          <TabsContent value="convert" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  Real-Time Currency Conversion
                </CardTitle>
                <CardDescription>
                  Live rates via ExchangeRate-API · Auto-refreshes every 30 seconds
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* From */}
                  <div className="space-y-2">
                    <Label>You Send</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={fromAmount}
                        onChange={(e) => setFromAmount(e.target.value)}
                        placeholder="Amount"
                        className="flex-1"
                      />
                      <Select value={fromCurrency} onValueChange={setFromCurrency}>
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"].map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* To */}
                  <div className="space-y-2">
                    <Label>Recipient Gets</Label>
                    <div className="flex gap-2">
                      <Input
                        value={ratesFetching ? "..." : convertedAmount}
                        readOnly
                        className="flex-1 bg-muted font-bold text-lg"
                      />
                      <Select value={toCurrency} onValueChange={setToCurrency}>
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCurrencies.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Rate display */}
                <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exchange Rate</span>
                    <span className="font-mono font-semibold">1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">24h Change</span>
                    <span className={change24h >= 0 ? "text-green-600" : "text-red-600"}>
                      {change24h >= 0 ? "+" : ""}{change24h.toFixed(3)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rail</span>
                    <span>{currentRail.flag} {currentRail.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Settlement</span>
                    <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-yellow-500" />{currentRail.settlementTime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Platform Fee</span>
                    <span className="text-green-600">0.5% (min $1.99)</span>
                  </div>
                </div>

                <Button className="w-full" onClick={() => {
                  setForm((f) => ({ ...f, amount: fromAmount, toCurrency, rail: selectedRail }));
                  toast("Rates copied to Send form — switch to Send tab to proceed.");
                }}>
                  <Send className="h-4 w-4 mr-2" />
                  Use This Rate — Send {fromAmount} {fromCurrency}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Send Transfer ────────────────────────────────────────────────── */}
          <TabsContent value="send" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Recipient Lookup */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Recipient Lookup
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>
                      {selectedRail === "upi" ? "UPI VPA (e.g. user@upi)" :
                       selectedRail === "pix" ? "Pix Key (CPF/CNPJ/email/phone)" :
                       selectedRail === "cips" ? "CNAPS Account Number" :
                       selectedRail === "mojaloop" ? "MSISDN or Account ID" :
                       "Account / IBAN / Routing"}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={recipientId}
                        onChange={(e) => setRecipientId(e.target.value)}
                        placeholder={
                          selectedRail === "upi" ? "user@okaxis" :
                          selectedRail === "pix" ? "user@email.com" :
                          selectedRail === "cips" ? "6228480402564890018" :
                          "Enter recipient ID"
                        }
                      />
                      <Button
                        variant="outline"
                        onClick={() => lookup.mutate({ rail: selectedRail, recipientId })}
                        disabled={lookup.isPending || !recipientId.trim()}
                      >
                        {lookup.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {lookupResult && (
                    <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-3 space-y-1 text-sm">
                      <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Recipient Verified
                      </div>
                      <div className="text-muted-foreground">Name: <span className="text-foreground font-medium">{lookupResult.name}</span></div>
                      <div className="text-muted-foreground">Bank: <span className="text-foreground">{lookupResult.bankName || lookupResult.institution}</span></div>
                      <div className="text-muted-foreground">Type: <span className="text-foreground">{lookupResult.accountType}</span></div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Transfer Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Initiate Transfer
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!form.amount || !form.recipientId) {
                        toast.error("Fill all required fields");
                        return;
                      }
                      transfer.mutate({
                        rail: form.rail as "mojaloop" | "cips" | "upi" | "pix" | "swift" | "sepa",
                        recipientId: form.recipientId,
                        amount: parseFloat(form.amount),
                        fromCurrency: "USD",
                        toCurrency: form.toCurrency,
                        reference: form.reference || undefined,
                      });
                    }}
                  >
                    <div className="space-y-1">
                      <Label>Recipient ID</Label>
                      <Input
                        value={form.recipientId}
                        onChange={(e) => setForm((f) => ({ ...f, recipientId: e.target.value }))}
                        placeholder="Account / VPA / Pix Key"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label>Amount (USD)</Label>
                        <Input
                          type="number"
                          value={form.amount}
                          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                          placeholder="0.00"
                          min="1"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>To Currency</Label>
                        <Select value={form.toCurrency} onValueChange={(v) => setForm((f) => ({ ...f, toCurrency: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {availableCurrencies.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Reference (optional)</Label>
                      <Input
                        value={form.reference}
                        onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                        placeholder="Invoice #, purpose, etc."
                      />
                    </div>
                    {form.amount && (
                      <div className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                        {form.amount} USD → ~{(parseFloat(form.amount || "0") * rate).toFixed(2)} {form.toCurrency}
                        {" · "}Fee: ${Math.max(1.99, parseFloat(form.amount || "0") * 0.005).toFixed(2)}
                      </div>
                    )}
                    <Button type="submit" className="w-full" disabled={transfer.isPending}>
                      {transfer.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      Send via {currentRail.name}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── All Rates Table ──────────────────────────────────────────────── */}
          <TabsContent value="rates" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Live Exchange Rates — {currentRail.name} Rail
                </CardTitle>
                <CardDescription>
                  Base: {fromCurrency} · Source: {rateSource === "live" ? "🟢 ExchangeRate-API (live)" : "🟡 Fallback rates"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4">Currency</th>
                        <th className="text-right py-2 pr-4">Rate</th>
                        <th className="text-right py-2 pr-4">Inverse</th>
                        <th className="text-right py-2">24h Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableCurrencies.map((currency) => {
                        const r = ratesData?.rates?.[currency];
                        if (!r) return null;
                        return (
                          <tr key={currency} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                            onClick={() => { setToCurrency(currency); }}>
                            <td className="py-2 pr-4 font-medium">{currency}</td>
                            <td className="py-2 pr-4 text-right font-mono">{r.rate.toFixed(4)}</td>
                            <td className="py-2 pr-4 text-right font-mono text-muted-foreground">{r.inverse.toFixed(6)}</td>
                            <td className={`py-2 text-right font-medium ${r.change24h >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {r.change24h >= 0 ? "+" : ""}{r.change24h.toFixed(3)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {ratesFetching && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
                    Refreshing rates...
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Supported Rails Overview */}
        {supportedRails && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">All Supported Payment Rails</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {((supportedRails as any)?.rails ?? [] as any[]).map((rail: any) => (
                  <div key={rail.id} className="flex items-center gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full ${rail.status === "active" ? "bg-green-500" : "bg-yellow-500"}`} />
                    <span className="font-medium">{rail.name}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{rail.status}</Badge>
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
