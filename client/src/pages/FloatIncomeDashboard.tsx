import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, DollarSign, BarChart3, RefreshCw } from "lucide-react";

export default function FloatIncomeDashboard() {
  const [days, setDays] = useState(30);
  const [currency, setCurrency] = useState<string | undefined>(undefined);

  const { data: summary, isLoading: summaryLoading } = trpc.floatIncome.summary.useQuery();
  const { data: history, isLoading: historyLoading } = trpc.floatIncome.history.useQuery({ days, currency });

  const fmt = (n: number, decimals = 2) =>
    new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  const fmtCurrency = (n: number, curr = "USD") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: curr, minimumFractionDigits: 2 }).format(n);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Float Income Treasury</h1>
          <p className="text-muted-foreground mt-1">Real-time float pool balances, yield accrual, and treasury P&L</p>
        </div>
        <Badge variant="outline" className="text-green-600 border-green-600">
          <TrendingUp className="w-3 h-3 mr-1" /> Live
        </Badge>
      </div>

      {/* KPI Cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-6"><div className="h-12 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><DollarSign className="w-4 h-4" /> Total Float Pool</div>
              <div className="text-2xl font-bold">{fmtCurrency(summary.totals.totalFloatBalance)}</div>
              <div className="text-xs text-muted-foreground mt-1">USD equivalent</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><TrendingUp className="w-4 h-4" /> Daily Yield</div>
              <div className="text-2xl font-bold text-green-600">{fmtCurrency(summary.totals.totalDailyYield)}</div>
              <div className="text-xs text-muted-foreground mt-1">All currencies combined</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><BarChart3 className="w-4 h-4" /> Monthly Yield</div>
              <div className="text-2xl font-bold text-blue-600">{fmtCurrency(summary.totals.totalMonthlyYield)}</div>
              <div className="text-xs text-muted-foreground mt-1">Projected this month</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><RefreshCw className="w-4 h-4" /> Annual Yield</div>
              <div className="text-2xl font-bold text-purple-600">{fmtCurrency(summary.totals.projectedAnnualYield)}</div>
              <div className="text-xs text-muted-foreground mt-1">Projected annual income</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">Pool Balances</TabsTrigger>
          <TabsTrigger value="history">Yield History</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Float Pool Balances by Currency</CardTitle></CardHeader>
            <CardContent>
              {summaryLoading ? <div className="h-40 bg-muted animate-pulse rounded" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Annual Rate</TableHead>
                      <TableHead className="text-right">Daily Yield</TableHead>
                      <TableHead className="text-right">Monthly Yield</TableHead>
                      <TableHead className="text-right">Annual Yield</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.currencies?.map((c: any) => (
                      <TableRow key={c.currency}>
                        <TableCell className="font-medium">
                          <Badge variant="outline">{c.currency}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{fmt(c.balance, 0)} {c.currency}</TableCell>
                        <TableCell className="text-right text-blue-600">{fmt(c.annualRate * 100, 2)}%</TableCell>
                        <TableCell className="text-right text-green-600">{fmt(c.dailyYield, 2)}</TableCell>
                        <TableCell className="text-right text-green-600">{fmt(c.monthlyYield, 2)}</TableCell>
                        <TableCell className="text-right text-green-600 font-semibold">{fmt(c.annualYield, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Yield History</CardTitle>
                <div className="flex gap-2">
                  <Select value={currency || "all"} onValueChange={v => setCurrency(v === "all" ? undefined : v)}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {["USD", "GBP", "EUR", "CAD", "AED"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="60">60 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {historyLoading ? <div className="h-40 bg-muted animate-pulse rounded" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Daily Yield</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history?.records?.slice(0, 50).map((r: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm">{r.date}</TableCell>
                        <TableCell><Badge variant="outline">{r.currency}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{fmt(r.balance, 0)}</TableCell>
                        <TableCell className="text-right text-blue-600">{fmt(r.rate * 100, 2)}%</TableCell>
                        <TableCell className="text-right text-green-600 font-semibold">{fmt(r.yieldAmount, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
