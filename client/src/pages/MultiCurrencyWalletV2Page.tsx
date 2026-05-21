import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Wallet, ArrowLeftRight, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF", "CAD", "AUD"];

export default function MultiCurrencyWalletV2Page() {
  const { t } = useTranslation();
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [amount, setAmount] = useState(1000);

  // getBalances returns { wallets, totalUsdEquivalent, currency, updatedAt }
  const { data: wallets, refetch } = trpc.v101.multiCurrencyWalletV2.getBalances.useQuery();
  // getTransactionHistory returns { transactions, total }
  const { data: history } = trpc.v101.multiCurrencyWalletV2.getTransactionHistory.useQuery({ currency: fromCurrency, limit: 10, offset: 0 });

  // convert returns { fromAmount, fromCurrency, toAmount, toCurrency, rate, fee, convertedAt, userId }
  const exchange = trpc.v101.multiCurrencyWalletV2.convert.useMutation({
    onSuccess: (d) => {
      toast.success(`Exchanged ${d.fromAmount} ${d.fromCurrency} → ${d.toAmount} ${d.toCurrency}`);
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Multi-Currency Wallet V2</h1>
        <p className="text-muted-foreground">
          Manage balances across 12+ currencies with instant exchange
        </p>
      </div>

      {/* Portfolio summary */}
      {wallets && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total Balance (USD)</div>
                <div className="text-2xl font-bold">
                  ${(wallets.totalUsdEquivalent ?? 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Base Currency</div>
                <div className="text-2xl font-bold">{wallets.currency}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last Updated</div>
                <div className="text-sm font-medium">
                  {wallets.updatedAt ? new Date(wallets.updatedAt).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Wallet balances */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Wallet Balances
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(wallets?.wallets ?? []).map((w: { currency: string; balance: number; usdEquivalent: number | null }) => (
              <Card key={w.currency}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">{w.currency}</span>
                    <Badge variant={Number(w.balance) > 0 ? "default" : "outline"} className="text-xs">
                      {Number(w.balance) > 0 ? "Active" : "Empty"}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold">{Number(w.balance).toLocaleString()}</div>
                  {w.usdEquivalent != null && (
                    <div className="text-xs text-muted-foreground">≈ ${w.usdEquivalent.toFixed(2)} USD</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Exchange panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5" />
              Exchange Currency
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>From Currency</Label>
              <Select value={fromCurrency} onValueChange={setFromCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To Currency</Label>
              <Select value={toCurrency} onValueChange={setToCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.filter((c) => c !== fromCurrency).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min={1}
              />
            </div>
            <Button
              className="w-full"
              onClick={() =>
                exchange.mutate({ fromCurrency, toCurrency, amount })
              }
              disabled={exchange.isPending}
            >
              {exchange.isPending ? "Converting..." : "Convert"}
            </Button>

            {exchange.data && (
              <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rate</span>
                  <span className="font-medium">{exchange.data.rate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fee</span>
                  <span className="font-medium">{exchange.data.fee} {exchange.data.fromCurrency}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>You receive</span>
                  <span className="text-green-600">{exchange.data.toAmount} {exchange.data.toCurrency}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transaction history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Recent Transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(history?.transactions ?? []).slice(0, 10).map((tx: { id: number; fromAmount: string | number; fromCurrency: string; toAmount: string | number; toCurrency: string; status: string; createdAt: Date | string }) => (
              <div key={tx.id} className="flex items-center justify-between p-2 rounded-lg border">
                <div>
                  <span className="font-medium text-sm">
                    {Number(tx.fromAmount).toLocaleString()} {tx.fromCurrency}
                  </span>
                  <span className="text-muted-foreground text-sm mx-2">→</span>
                  <span className="font-medium text-sm">
                    {Number(tx.toAmount).toLocaleString()} {tx.toCurrency}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{tx.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : "—"}
                  </span>
                </div>
              </div>
            ))}
            {(history?.transactions ?? []).length === 0 && (
              <div className="text-center py-6 text-muted-foreground">No transactions yet</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
