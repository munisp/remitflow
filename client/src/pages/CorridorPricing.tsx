import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { TrendingUp, ArrowRight, DollarSign, Activity } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const CURRENCY_PAIRS = [
  { from: "USD", to: "NGN" }, { from: "USD", to: "KES" }, { from: "USD", to: "GHS" },
  { from: "GBP", to: "NGN" }, { from: "EUR", to: "NGN" }, { from: "USD", to: "TZS" },
];

export default function CorridorPricing() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [days, setDays] = useState(30);
  const [selectedPair, setSelectedPair] = useState({ fromCurrency: "USD", toCurrency: "NGN" });

  const { data: topCorridors, isLoading, isError } = trpc.corridorAnalytics.topCorridors.useQuery(
    { days, limit: 10 }, { enabled: isAdmin }
  );
  const { data: performance } = trpc.corridorAnalytics.performance.useQuery(
    { ...selectedPair, days }, { enabled: isAdmin }
  );
  const { data: liveRatesRaw } = trpc.fx.liveRates.useQuery({});
  const liveRates = liveRatesRaw ? Object.entries((liveRatesRaw as any)?.rates ?? {}).map(([currency, rate]) => ({ to_currency: currency, rate, from_currency: "USD" })) : [];

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg"><TrendingUp className="h-6 w-6 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Corridor Pricing</h1><p className="text-muted-foreground">Live exchange rates for all supported corridors</p></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {liveRates.slice(0, 12).map((rate: any) => (
            <Card key={`${rate.from_currency}-${rate.to_currency}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold">{rate.from_currency}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-bold">{rate.to_currency}</span>
                </div>
                <div className="text-2xl font-bold">{Number(rate.rate).toFixed(4)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (

    <DashboardLayout>
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg"><TrendingUp className="h-6 w-6 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Corridor Analytics</h1><p className="text-muted-foreground">Transfer volume, rates, and performance by corridor</p></div>
        </div>
        <Select value={days.toString()} onValueChange={v => setDays(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top">Top Corridors</TabsTrigger>
          <TabsTrigger value="performance">Corridor Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="top" className="mt-4 space-y-4">
          {topCorridors && topCorridors.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topCorridors.map((c: any) => ({ name: `${c.from_currency}→${c.to_currency}`, volume: Number(c.total_volume), count: Number(c.transaction_count) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="volume" fill="#7C3AED" name="Volume ($)" />
                </BarChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {(topCorridors as any[]).map((c: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-600">{i+1}</div>
                        <div>
                          <div className="font-semibold">{c.from_currency} → {c.to_currency}</div>
                          <div className="text-sm text-muted-foreground">{c.to_country} · {c.transaction_count} transfers</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">${Number(c.total_volume).toLocaleString()}</div>
                        <div className="text-sm text-muted-foreground">Avg rate: {Number(c.avg_rate).toFixed(4)}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : <Card><CardContent className="py-12 text-center text-muted-foreground">No corridor data for the selected period.</CardContent></Card>}
        </TabsContent>

        <TabsContent value="performance" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <Select value={`${selectedPair.fromCurrency}-${selectedPair.toCurrency}`} onValueChange={v => { const [f,to] = v.split("-"); setSelectedPair({ fromCurrency: f, toCurrency: to }); }}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCY_PAIRS.map(p => <SelectItem key={`${p.from}-${p.to}`} value={`${p.from}-${p.to}`}>{p.from} → {p.to}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {performance && performance.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={(performance as any[]).map((d: any) => ({ date: d.day, volume: Number(d.volume), rate: Number(d.avg_rate), count: Number(d.count) }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Line yAxisId="left" type="monotone" dataKey="volume" stroke="#7C3AED" name="Volume ($)" />
                <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#10B981" name="Avg Rate" />
              </LineChart>
            </ResponsiveContainer>
          ) : <Card><CardContent className="py-12 text-center text-muted-foreground">No performance data for this corridor.</CardContent></Card>}
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
