import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Calculator, DollarSign } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function FXOptionsPricingPage() {
  const { t } = useTranslation();
  const [params, setParams] = useState({
    baseCurrency: "USD",
    quoteCurrency: "NGN",
    notional: 100000,
    strikeRate: 1600,
    expiryDays: 30,
    optionType: "call" as "call" | "put",
    volatility: 0.12,
  });
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, isError } = trpc.v101.fxOptions.price.useQuery(params, { enabled: submitted });

  const currencies = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF"];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">FX Options Pricing</h1>
        <p className="text-muted-foreground">Black-Scholes model for FX option valuation</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="w-5 h-5" />Option Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Base Currency</Label>
                <Select value={params.baseCurrency} onValueChange={v => setParams(p => ({ ...p, baseCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quote Currency</Label>
                <Select value={params.quoteCurrency} onValueChange={v => setParams(p => ({ ...p, quoteCurrency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notional Amount (USD)</Label>
              <Input type="number" value={params.notional} onChange={e => setParams(p => ({ ...p, notional: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Strike Rate</Label>
              <Input type="number" step="0.0001" value={params.strikeRate} onChange={e => setParams(p => ({ ...p, strikeRate: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Expiry (Days)</Label>
              <Input type="number" value={params.expiryDays} onChange={e => setParams(p => ({ ...p, expiryDays: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Implied Volatility (%)</Label>
              <Input type="number" step="0.01" value={params.volatility * 100} onChange={e => setParams(p => ({ ...p, volatility: Number(e.target.value) / 100 }))} />
            </div>
            <div>
              <Label>Option Type</Label>
              <Select value={params.optionType} onValueChange={v => setParams(p => ({ ...p, optionType: v as "call" | "put" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Call (Right to Buy)</SelectItem>
                  <SelectItem value="put">Put (Right to Sell)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={() => setSubmitted(true)} disabled={isLoading}>
              {isLoading ? "Pricing..." : "Price Option"}
            </Button>
          </CardContent>
        </Card>

        {data && (
          <div className="space-y-4">
            <Card className="border-primary">
              <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" />Option Premium</CardTitle></CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-primary">${data.premium.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {data.optionType.toUpperCase()} option on {data.baseCurrency}/{data.quoteCurrency}
                </div>
                <div className="mt-2">
                  <Badge variant={data.optionType === "call" ? "default" : "secondary"}>
                    {data.optionType === "call" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {data.optionType.toUpperCase()}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Greeks</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Delta (Δ)", value: data.delta, desc: "Price sensitivity" },
                    { label: "Gamma (Γ)", value: data.gamma, desc: "Delta change rate" },
                    { label: "Theta (Θ)", value: data.theta, desc: "Time decay/day" },
                    { label: "Vega (ν)", value: data.vega, desc: "Volatility sensitivity" },
                  ].map(g => (
                    <div key={g.label} className="p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground">{g.label}</div>
                      <div className="text-lg font-semibold">{g.value}</div>
                      <div className="text-xs text-muted-foreground">{g.desc}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Market Data</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Spot Rate", value: data.spotRate },
                  { label: "Strike Rate", value: data.strikeRate },
                  { label: "Implied Volatility", value: (data.impliedVolatility * 100).toFixed(1) + "%" },
                  { label: "Expiry", value: data.expiryDays + " days" },
                  { label: "Notional", value: "$" + data.notional.toLocaleString() },
                ].map(item => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  

    </DashboardLayout>

  );
}
