import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RefreshCw, BookOpen, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function MultiCurrencyLedgerPage() {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState("USD");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const positionsQuery = trpc.v89.multiCurrencyLedger.getPositions.useQuery();
  const volumeQuery = trpc.v89.multiCurrencyLedger.getVolume.useQuery({ currency: currency || undefined, days: 30 });
  const entriesQuery = trpc.v89.multiCurrencyLedger.getLedgerEntries.useQuery({
    currency: currency || "USD",
    limit: PAGE_SIZE,
  });
  const isError = entriesQuery.isError;

  const positions = Array.isArray(positionsQuery.data) ? positionsQuery.data : [];
  const volumes = Array.isArray(volumeQuery.data) ? volumeQuery.data : [];
  const entries = Array.isArray(entriesQuery.data) ? entriesQuery.data : [];
  const total = entries.length;

  const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "INR", "PHP", "MXN", "BRL"];

  const selectedPosition = positions.find((p) => p.currency === currency);

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Multi-Currency Ledger</h1>
          <p className="text-muted-foreground text-sm mt-1">Double-entry accounting ledger across all currencies</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { positionsQuery.refetch(); entriesQuery.refetch(); volumeQuery.refetch(); }}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Currency Positions Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {positionsQuery.isPending ? (
          <div className="col-span-4 text-center text-muted-foreground py-4">Loading positions...</div>
        ) : positions.slice(0, 8).map((pos) => (
          <Card key={pos.currency} className={`bg-card border-border cursor-pointer transition-colors ${currency === pos.currency ? "border-primary" : "hover:border-primary/50"}`}
            onClick={() => setCurrency(pos.currency)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-blue-400" />
                <p className="text-xs text-muted-foreground font-mono">{pos.currency}</p>
              </div>
              <p className="text-xl font-bold text-foreground">
                {pos.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{pos.walletCount} wallets</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Selected Currency Stats */}
      {selectedPosition && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <p className="text-xs text-muted-foreground">Total Balance ({currency})</p>
              </div>
              <p className="text-2xl font-bold text-foreground">
                {selectedPosition.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <p className="text-xs text-muted-foreground">Active Wallets</p>
              </div>
              <p className="text-2xl font-bold text-green-400">{selectedPosition.walletCount}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-orange-400" />
                <p className="text-xs text-muted-foreground">30d Volume Pairs</p>
              </div>
              <p className="text-2xl font-bold text-orange-400">{volumes.length}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen className="w-4 h-4 text-purple-400" />
                <p className="text-xs text-muted-foreground">Ledger Entries</p>
              </div>
              <p className="text-2xl font-bold text-purple-400">{total}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="space-y-1">
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(0); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Ledger Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ledger Entries — {currency} ({total.toLocaleString()})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">ID</th>
                  <th className="p-3 text-left">Debit Account</th>
                  <th className="p-3 text-left">Credit Account</th>
                  <th className="p-3 text-right">Debit Amount</th>
                  <th className="p-3 text-right">Credit Amount</th>
                  <th className="p-3 text-right">Fee</th>
                  <th className="p-3 text-right">FX Rate</th>
                  <th className="p-3 text-left">Reference</th>
                  <th className="p-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {entriesQuery.isPending ? (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading ledger...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No ledger entries found for {currency}</td></tr>
                ) : entries.map((e) => (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 text-xs text-muted-foreground">#{e.id}</td>
                    <td className="p-3 text-xs max-w-32 truncate" title={e.debit.account}>{e.debit.account}</td>
                    <td className="p-3 text-xs max-w-32 truncate" title={e.credit.account}>{e.credit.account}</td>
                    <td className="p-3 text-right text-red-400 font-bold">
                      -{e.debit.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {e.debit.currency}
                    </td>
                    <td className="p-3 text-right text-green-400 font-bold">
                      +{e.credit.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {e.credit.currency}
                    </td>
                    <td className="p-3 text-right text-xs text-yellow-400">
                      {e.fee > 0 ? e.fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                    </td>
                    <td className="p-3 text-right text-xs text-muted-foreground">
                      {e.fxRate !== 1 ? e.fxRate.toFixed(4) : "1.0000"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground max-w-32 truncate">{e.reference ?? "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing {entries.length} entries for {currency}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Volume Table */}
      {volumes.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">30-Day Volume by Corridor</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">From</th>
                  <th className="p-3 text-left">To</th>
                  <th className="p-3 text-right">Volume</th>
                  <th className="p-3 text-right">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {volumes.map((v, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-3"><Badge variant="outline">{v.fromCurrency}</Badge></td>
                    <td className="p-3"><Badge variant="outline">{v.toCurrency}</Badge></td>
                    <td className="p-3 text-right font-mono text-green-400">
                      {v.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">{v.txCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
