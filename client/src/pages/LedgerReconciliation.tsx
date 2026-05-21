import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Scale, AlertTriangle, CheckCircle, RefreshCw, DollarSign } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function LedgerReconciliation() {
  const { t } = useTranslation();
  const [reconcileDate, setReconcileDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: summary, refetch: refetchSummary } = trpc.v98.ledger.reconciliationSummary.useQuery();
  const { data: discrepancies, refetch: refetchDisc } = trpc.v98.ledger.discrepancies.useQuery();

  const runReconciliation = trpc.v98.ledger.runReconciliation.useMutation({
    onSuccess: () => {
      toast.success("Reconciliation complete");
      refetchSummary();
      refetchDisc();
    },
    onError: (e) => toast.error(e.message),
  });

  const resolveDiscrepancy = trpc.v98.ledger.resolveDiscrepancy.useMutation({
    onSuccess: () => {
      toast.success("Discrepancy resolved");
      refetchDisc();
    },
    onError: (e) => toast.error(e.message),
  });

  const txns = (summary as any)?.transactions;
  const walletData = (summary as any)?.wallets;
  const totalSent = txns?.totalSent ?? 0;
  const totalReceived = txns?.totalReceived ?? 0;
  const balance = totalSent - totalReceived;
  const discrepancyCount = Array.isArray(discrepancies) ? discrepancies.length : 0;
  const lastRunAt = (summary as any)?.lastReconciled;

  return (

    <DashboardLayout>
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" /> Ledger Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Double-entry verification and discrepancy management
          </p>
        </div>
        <Button onClick={() => runReconciliation.mutate()} disabled={runReconciliation.isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${runReconciliation.isPending ? "animate-spin" : ""}`} />
          Run Reconciliation
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Transactions</p>
            <p className="text-2xl font-bold">{(txns?.total ?? 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Volume Sent</p>
            <p className="text-2xl font-bold">${(totalSent).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Fees Collected</p>
            <p className="text-2xl font-bold">${(txns?.totalFees ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Discrepancies</p>
            <p className={`text-2xl font-bold ${discrepancyCount > 0 ? "text-red-500" : "text-green-500"}`}>
              {discrepancyCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Balance Status */}
      <Card className={balance === 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            {balance === 0 ? (
              <CheckCircle className="h-6 w-6 text-green-500" />
            ) : (
              <AlertTriangle className="h-6 w-6 text-red-500" />
            )}
            <div>
              <p className="font-semibold">
                {balance === 0
                  ? "Ledger is balanced — all debits equal credits"
                  : `Ledger imbalance detected: $${Math.abs(balance).toLocaleString()} difference`}
              </p>
              <p className="text-sm text-muted-foreground">
                {txns?.total ?? 0} entries checked ·{" "}
                {lastRunAt ? `Last run: ${new Date(lastRunAt).toLocaleString()}` : "Not yet run"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discrepancies */}
      <Tabs defaultValue="discrepancies">
        <TabsList>
          <TabsTrigger value="discrepancies">
            Discrepancies ({discrepancyCount})
          </TabsTrigger>
          <TabsTrigger value="wallets">Wallet Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="discrepancies">
          <Card>
            <CardContent className="pt-4">
              {!discrepancyCount ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-30 text-green-500" />
                  <p>No discrepancies found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-3">ID</th>
                        <th className="text-left pr-3">Type</th>
                        <th className="text-left pr-3">Description</th>
                        <th className="text-right pr-3">Amount</th>
                        <th className="text-left pr-3">Status</th>
                        <th className="text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(discrepancies as any[]).map((d: any) => (
                        <tr key={d.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="py-2 pr-3 font-mono text-xs">#{d.id}</td>
                          <td className="pr-3">
                            <Badge variant="outline" className="text-xs">{d.type}</Badge>
                          </td>
                          <td className="pr-3 text-xs max-w-[200px] truncate">{d.description}</td>
                          <td className="text-right pr-3 font-mono text-xs">
                            ${Number(d.amount ?? 0).toLocaleString()}
                          </td>
                          <td className="pr-3">
                            <Badge variant={d.resolved ? "default" : "destructive"} className="text-xs">
                              {d.resolved ? "Resolved" : "Open"}
                            </Badge>
                          </td>
                          <td className="text-right">
                            {!d.resolved && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => resolveDiscrepancy.mutate({ id: d.id })}
                                disabled={resolveDiscrepancy.isPending}
                              >
                                Resolve
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="wallets">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Wallets</p>
                  <p className="text-xl font-bold">{(walletData?.total ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Wallets</p>
                  <p className="text-xl font-bold">{(walletData?.active ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Balance</p>
                  <p className="text-xl font-bold">${(walletData?.totalBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
